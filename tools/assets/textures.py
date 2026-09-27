#!/usr/bin/env python3
"""Build the cs-assets textures from ambientCG materials (CC0).

Downloads each material's 1K-JPG set and writes pb3x-extension/assets/textures/<id>_color.webp and
<id>_normal.webp (OpenGL normals), 1024 x 1024 (plus _opacity for cut-outs). Sources cached in /tmp/cs-tex-src.

    python3 tools/assets/textures.py
"""
import io, json, os, sys, urllib.request, zipfile
from PIL import Image

ROOT = os.path.abspath( os.path.join( os.path.dirname( __file__ ), '..', '..' ) )
OUT = os.path.join( ROOT, 'pb3x-extension', 'assets', 'textures' )
SRC = '/tmp/cs-tex-src'
UA = { 'User-Agent': 'cs-assets-build/1.0 (PB3X mod asset pipeline)' }

# id: ambientCG asset, what it is for
TEXTURES = {
	'tower_concrete':   ( 'Concrete034',        'tower pillars and soffit' ),
	'stained_concrete': ( 'Concrete042A',       'sea-stained pillar bases, dock walls' ),
	'rusted_steel':     ( 'Metal063',           'rusted hull plates, old dock steel' ),
	'corrugated':       ( 'CorrugatedSteel007A','sheds, container sides' ),
	'catwalk':          ( 'MetalWalkway014',    'catwalk and gantry decks' ),
	'grate':            ( 'MetalWalkway001',    'floor grates over water' ),
	'wet_asphalt':      ( 'Asphalt025C',        'dock roadway' ),
	'sea_rock':         ( 'Rock051',            'wet layered rock: channels and islets' ),
	'cliff_rock':       ( 'Rock058',            'cliffs, cave walls' ),
	'deck_plates':      ( 'MetalPlates006',     'service-level floors, hatches' ),
	'painted_steel':    ( 'PaintedMetal004',    'CS red panels, railings, banner frames' ),
	'hazard_stripes':   ( 'PaintedMetal016',    'hazard edges on docks, lifts and cranes' ),
	'chainlink':        ( 'Fence007A',          'fences (cut-out)' ),
}

def get( url ):
	for i in range( 5 ):
		try:
			with urllib.request.urlopen( urllib.request.Request( url, headers=UA ), timeout=180 ) as r: return r.read()
		except Exception as e: print( '  retry', i + 1, e )
	raise RuntimeError( 'download failed: ' + url )

def build( tid ):
	asset, use = TEXTURES[ tid ]
	os.makedirs( SRC, exist_ok=True ); os.makedirs( OUT, exist_ok=True )
	url = 'https://ambientcg.com/get?file=%s_1K-JPG.zip' % asset
	cache = os.path.join( SRC, asset + '_1K-JPG.zip' )
	if not os.path.exists( cache ):
		data = get( url )
		with open( cache, 'wb' ) as f: f.write( data )
	z = zipfile.ZipFile( cache )
	names = z.namelist()
	def pick( key ):
		n = [ x for x in names if x.endswith( '_' + key + '.jpg' ) ]
		return Image.open( io.BytesIO( z.read( n[ 0 ] ) ) ) if n else None
	sizes = 0
	for key, suffix, q in ( ( 'Color', 'color', 82 ), ( 'NormalGL', 'normal', 88 ), ( 'Opacity', 'opacity', 85 ) ):
		im = pick( key )
		if im is None: continue
		im = im.convert( 'L' if key == 'Opacity' else 'RGB' ).resize( ( 1024, 1024 ), Image.LANCZOS )
		p = os.path.join( OUT, '%s_%s.webp' % ( tid, suffix ) )
		im.save( p, 'WEBP', quality=q, method=6 )
		sizes += os.path.getsize( p )
	print( '%-17s %-20s %5.2f MB' % ( tid, asset, sizes / 1e6 ) )
	return dict( id=tid, asset=asset, use=use, url='https://ambientcg.com/view?id=' + asset, file=url )

if __name__ == '__main__':
	ids = sys.argv[ 1: ] or list( TEXTURES )
	meta = [ build( i ) for i in ids ]
	with open( os.path.join( SRC, 'meta.json' ), 'w' ) as f: json.dump( meta, f, indent=1 )
