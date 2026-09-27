// Shared launcher: the real game in Chromium with pb3x-extension loaded.
const path = require( 'path' );
const { chromium } = require( 'playwright' );
const EXT = path.resolve( __dirname, '../../pb3x-extension' );
async function launch( { profile = '/tmp/pb3x-profile', url = 'https://www.plazmaburst.net/' } = {} )
{
	const ctx = await chromium.launchPersistentContext( profile, {
		headless: false,
		executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
		viewport: { width: 1600, height: 900 },
		ignoreHTTPSErrors: true,
		proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
		args: [ `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-quic', '--autoplay-policy=no-user-gesture-required' ],
	} );
	const page = ctx.pages()[ 0 ] || await ctx.newPage();
	page.on( 'pageerror', e=>console.log( 'PAGEERROR', e.message ) );
	// The build container's proxy drops some browser connections (ERR_TOO_MANY_RETRIES), so every
	// GET is fetched from Node with retries and cached on disk; later runs load from the cache.
	const fs = require( 'fs' ), crypto = require( 'crypto' );
	const CACHE = '/tmp/pb3x-cache';
	fs.mkdirSync( CACHE, { recursive: true } );
	await ctx.route( '**/*', async route=>
	{
		const req = route.request();
		if ( req.method() !== 'GET' || !/^https:/.test( req.url() ) ) return route.continue();
		const key = CACHE + '/' + crypto.createHash( 'sha1' ).update( req.url() ).digest( 'hex' );
		const cacheable = !/\.php|\/sections\//.test( req.url() ) || /web_style_by_version/.test( req.url() );
		if ( cacheable && fs.existsSync( key + '.json' ) )
		{
			const meta = JSON.parse( fs.readFileSync( key + '.json', 'utf8' ) );
			return route.fulfill( { status: meta.status, headers: meta.headers, body: fs.readFileSync( key ) } );
		}
		for ( let i = 0; i < 6; i++ )
		{
			try
			{
				const r = await route.fetch( { timeout: 60000 } );
				const body = await r.body();
				const headers = r.headers();
				if ( cacheable && r.status() === 200 )
				{
					fs.writeFileSync( key, body );
					fs.writeFileSync( key + '.json', JSON.stringify( { status: 200, headers, url: req.url() } ) );
				}
				return route.fulfill( { status: r.status(), headers, body } );
			}
			catch ( e ) { if ( /closed|disposed/.test( e.message ) ) return; await new Promise( r=>setTimeout( r, 500 * 2 ** i ) ); }
		}
		return route.abort().catch( ()=>{} );
	} );
	page.__fails = {};
	page.on( 'requestfailed', r=>{ page.__fails[ r.url().slice( 0, 140 ) ] = r.failure().errorText; } );
	page.on( 'response', r=>{ if ( r.status() >= 400 ) page.__fails[ r.url().slice( 0, 140 ) ] = r.status(); } );
	for ( let i = 0; ; i++ )
	{
		try { await page.goto( url, { waitUntil: 'load', timeout: 120000 } ); break; }
		catch ( e ) { if ( i >= 4 ) throw e; console.log( 'goto retry', e.message.split( '\n' )[ 0 ] ); await page.waitForTimeout( 2000 * 2 ** i ); }
	}
	return { ctx, page };
}
module.exports = { launch };
