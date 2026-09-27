#!/usr/bin/env python3
"""Build the cs-skies panoramas from Poly Haven HDRIs (CC0).

Downloads each source HDRI (4K equirectangular .hdr), tonemaps and grades it for its sky, and writes
pb3x-extension/assets/skies/<id>.webp (4096 x 2048) plus <id>_amb.webp (64 x 32, blurred) for the ambient
light. Sources are cached in /tmp/cs-skies-src. Needs numpy, pillow, opencv-python-headless.

    python3 tools/assets/skies.py            # all skies
    python3 tools/assets/skies.py dusk_sea   # one
"""
import json, os, sys, urllib.request
import numpy as np, cv2
from PIL import Image, ImageFilter

ROOT = os.path.abspath( os.path.join( os.path.dirname( __file__ ), '..', '..' ) )
OUT = os.path.join( ROOT, 'pb3x-extension', 'assets', 'skies' )
SRC = '/tmp/cs-skies-src'

# id: Poly Haven asset, key (the upper half's median luminance after exposure — HDRIs differ in absolute level,
# so each is auto-exposed to its key), ev (a trim on top, stops), tint (linear rgb multiplier), saturation, contrast, lift (added black level)
SKIES = {
	'storm_night':      dict( asset='kloofendal_48d_partly_cloudy_puresky', key=0.040, ev=0.0, tint=( 0.60, 0.76, 1.12 ), sat=0.25, con=1.20, lift=( 0.010, 0.013, 0.020 ),
	                          name='Storm night', note='partly cloudy day graded to night (day-for-night, the sun reads as the moon); lightning is drawn over it' ),
	'moonlit_overcast': dict( asset='kloppenheim_07_puresky',       key=0.070, ev=0.0,  tint=( 0.85, 0.92, 1.08 ), sat=0.70, con=1.05, lift=( 0.006, 0.008, 0.012 ),
	                          name='Moonlit overcast', note='' ),
	'clear_starry':     dict( asset='rogland_clear_night',          key=0.030, ev=0.0,  tint=( 0.92, 0.96, 1.05 ), sat=0.85, con=1.10, lift=( 0.0, 0.0, 0.0 ),
	                          name='Clear starry night', note='full HDRI (not a pure-sky edit): its ground sits below the horizon, under the sea' ),
	'dusk_sea':         dict( asset='qwantani_dusk_2_puresky',      key=0.200, ev=0.0, tint=( 1.00, 0.90, 0.95 ), sat=1.00, con=1.08, lift=( 0.004, 0.004, 0.008 ),
	                          name='Dusk over the sea', note='' ),
	'fog_dawn':         dict( asset='kloofendal_misty_morning_puresky', key=0.120, ev=0.0, tint=( 0.84, 0.92, 1.04 ), sat=0.55, con=0.92, lift=( 0.030, 0.034, 0.040 ),
	                          name='Fog-bank dawn', note='misty morning graded cooler and darker' ),
	'squall':           dict( asset='kloppenheim_01_puresky',       key=0.055, ev=0.0, tint=( 0.70, 0.82, 0.86 ), sat=0.30, con=1.30, lift=( 0.012, 0.015, 0.016 ),
	                          name='Heavy squall', note='overcast dusk graded to a dark green-grey storm' ),
}

UA = { 'User-Agent': 'cs-skies-build/1.0 (PB3X mod asset pipeline)' }
def req( url ): return urllib.request.Request( url, headers=UA )

def fetch( url, path ):
	if os.path.exists( path ) and os.path.getsize( path ) > 0: return path
	tmp = path + '.part'
	for i in range( 5 ):
		try:
			with urllib.request.urlopen( req( url ), timeout=120 ) as r, open( tmp, 'wb' ) as f:
				while True:
					b = r.read( 1 << 20 )
					if not b: break
					f.write( b )
			os.replace( tmp, path )
			return path
		except Exception as e:
			print( '  retry', i + 1, e )
	raise RuntimeError( 'download failed: ' + url )

def api( path ):
	with urllib.request.urlopen( req( 'https://api.polyhaven.com/' + path ), timeout=60 ) as r: return json.load( r )

def aces( x ):
	# Narkowicz ACES filmic fit
	return np.clip( ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ), 0, 1 )

def grade( hdr, s ):
	W = np.array( [ 0.2126, 0.7152, 0.0722 ], np.float32 )
	key = float( np.median( ( hdr[ : hdr.shape[ 0 ] // 2 ] * W ).sum( -1 ) ) )
	x = hdr * ( s[ 'key' ] / max( key, 1e-6 ) * 2.0 ** s[ 'ev' ] ) * np.array( s[ 'tint' ], np.float32 )
	lum = ( x * W ).sum( -1, keepdims=True )
	x = lum + ( x - lum ) * s[ 'sat' ]
	x = aces( np.maximum( x, 0 ) )
	x = np.clip( ( x - 0.18 ) * s[ 'con' ] + 0.18, 0, 1 ) + np.array( s[ 'lift' ], np.float32 )
	return np.clip( x, 0, 1 ) ** ( 1 / 2.2 )

def build( sid ):
	s = SKIES[ sid ]
	os.makedirs( SRC, exist_ok=True ); os.makedirs( OUT, exist_ok=True )
	files = api( 'files/' + s[ 'asset' ] )
	url = files[ 'hdri' ][ '4k' ][ 'hdr' ][ 'url' ]
	src = fetch( url, os.path.join( SRC, s[ 'asset' ] + '_4k.hdr' ) )
	hdr = cv2.imread( src, cv2.IMREAD_UNCHANGED )[ :, :, ::-1 ].astype( np.float32 )  # BGR -> RGB
	img = ( grade( hdr, s ) * 255 + 0.5 ).astype( np.uint8 )
	im = Image.fromarray( img ).resize( ( 4096, 2048 ), Image.LANCZOS )
	out = os.path.join( OUT, sid + '.webp' )
	im.save( out, 'WEBP', quality=84, method=6 )
	amb = im.resize( ( 256, 128 ), Image.BOX ).filter( ImageFilter.GaussianBlur( 6 ) ).resize( ( 64, 32 ), Image.BOX )
	amb.save( os.path.join( OUT, sid + '_amb.webp' ), 'WEBP', quality=90 )
	info = api( 'info/' + s[ 'asset' ] )
	print( '%-17s %-34s %5.2f MB' % ( sid, s[ 'asset' ], os.path.getsize( out ) / 1e6 ) )
	return dict( id=sid, name=s[ 'name' ], asset=s[ 'asset' ], title=info[ 'name' ], authors=info[ 'authors' ], url=url, note=s[ 'note' ] )

if __name__ == '__main__':
	ids = sys.argv[ 1: ] or list( SKIES )
	meta = [ build( i ) for i in ids ]
	with open( os.path.join( SRC, 'meta.json' ), 'w' ) as f: json.dump( meta, f, indent=1 )
