#!/usr/bin/env python3
"""Build the cs-assets sounds from Freesound (CC0 entries only).

    python3 tools/assets/sounds.py search "heavy rain loop"   # list CC0 candidates
    python3 tools/assets/sounds.py                             # download the chosen set

Each chosen sound's page is re-read at build time and it is refused unless it is licensed CC0. The file used is
Freesound's high-quality MP3 preview (128 kbps), cut to at most MAX_SECONDS (with short fades) and re-encoded
mono 96 kbps (the game plays them positioned, in mono) to pb3x-extension/assets/sounds/<id>.mp3. Needs imageio-ffmpeg.
"""
import html, json, os, re, subprocess, sys, tempfile, urllib.parse, urllib.request

ROOT = os.path.abspath( os.path.join( os.path.dirname( __file__ ), '..', '..' ) )
OUT = os.path.join( ROOT, 'pb3x-extension', 'assets', 'sounds' )
META = '/tmp/cs-snd-meta.json'
UA = { 'User-Agent': 'Mozilla/5.0 (cs-assets-build/1.0)' }
CC0 = 'creativecommons.org/publicdomain/zero/1.0'

MAX_SECONDS = 36

# id: ( Freesound user, sound id, what it is for )
SOUNDS = {
	'rain_heavy':    ( 'Rubaoliva',     624645, 'storm rain bed (loop)' ),
	'rain_night':    ( 'jgxxx',         704395, 'lighter night rain (loop)' ),
	'thunder':       ( 'BlueDelta',     446753, 'lightning strikes' ),
	'thunder_rain':  ( 'FlatHill',      237729, 'distant storm bed' ),
	'surf_rocks':    ( 'felix.blume',   411509, 'waves on the pillars and rocks (loop)' ),
	'wind_strong':   ( 'florianreichelt', 459981, 'gusts on the upper platform (loop)' ),
	'metal_door':    ( 'Olichite',      238891, 'hatches, heavy doors, metal creaks' ),
	'siren':         ( 'Poligonstudio', 412171, 'tower alarm' ),
	'siren_distant': ( 'ivolipa',       337099, 'far sirens across the water' ),
	'foghorn':       ( 'kathol',        37915,  'foghorn (wet)' ),
	'machinery':     ( 'IanStarGem',    271096, 'service-level fans and machinery (loop)' ),
	'crane':         ( 'craigsmith',    438133, 'overhead crane in the maintenance bay' ),
	'cave_drips':    ( 'Sclolex',       177958, 'water channels: drips' ),
	'sea_cave':      ( 'Andy_Gardner',  196713, 'water channels: sea cave swell' ),
}

def get( url, binary=False ):
	for i in range( 5 ):
		try:
			with urllib.request.urlopen( urllib.request.Request( url, headers=UA ), timeout=120 ) as r:
				d = r.read()
				return d if binary else d.decode( 'utf8', 'replace' )
		except Exception as e: print( '  retry', i + 1, e )
	raise RuntimeError( 'download failed: ' + url )

def search( q, pages=1 ):
	for p in range( 1, pages + 1 ):
		u = 'https://freesound.org/search/?' + urllib.parse.urlencode( { 'q': q, 'f': 'license:"Creative Commons 0"', 's': 'Downloads (most first)', 'page': p } )
		h = get( u )
		for m in re.finditer( r'href="/people/([^/]+)/sounds/(\d+)/"[^>]*>\s*([^<]{1,120})<', h ):
			print( '%-24s %8s  %s' % ( m.group( 1 ), m.group( 2 ), html.unescape( m.group( 3 ).strip() ) ) )

def page( user, sid ):
	h = get( 'https://freesound.org/people/%s/sounds/%s/' % ( user, sid ) )
	title = html.unescape( re.search( r'<title>Freesound - (.*?)</title>', h ).group( 1 ) )
	lic = CC0 in h and not re.search( r'creativecommons.org/licenses/', h )
	mp3 = re.search( r'https://cdn\.freesound\.org/previews/[^"]*-hq\.mp3', h )
	dur = re.search( r'data-duration="([\d.]+)"', h )
	return title, lic, mp3.group( 0 ) if mp3 else None, float( dur.group( 1 ) ) if dur else None

def build():
	os.makedirs( OUT, exist_ok=True )
	meta = []
	for key, ( user, sid, use ) in SOUNDS.items():
		title, cc0, mp3, dur = page( user, sid )
		if not cc0 or not mp3: raise RuntimeError( '%s (%s/%s) is not CC0 or has no preview' % ( key, user, sid ) )
		data = get( mp3, True )
		out = os.path.join( OUT, key + '.mp3' )
		with tempfile.NamedTemporaryFile( suffix='.mp3' ) as t:
			t.write( data ); t.flush()
			n = min( dur or MAX_SECONDS, MAX_SECONDS )
			fade = min( 0.6, n / 6 )
			import imageio_ffmpeg
			subprocess.run( [ imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error', '-i', t.name, '-t', str( n ), '-ac', '1', '-b:a', '96k',
				'-af', 'afade=t=in:d=%.2f,afade=t=out:st=%.2f:d=%.2f' % ( min( 0.05, fade ), max( 0, n - fade ), fade ), out ], check=True )
		data = open( out, 'rb' ).read()
		print( '%-16s %-44s %5.1fs %5.2f MB' % ( key, title[ :44 ], dur or 0, len( data ) / 1e6 ) )
		meta.append( dict( id=key, title=title, author=user, url='https://freesound.org/people/%s/sounds/%s/' % ( user, sid ), use=use, seconds=dur ) )
	with open( META, 'w' ) as f: json.dump( meta, f, indent=1 )

if __name__ == '__main__':
	if len( sys.argv ) > 2 and sys.argv[ 1 ] == 'search': search( ' '.join( sys.argv[ 2: ] ) )
	else: build()
