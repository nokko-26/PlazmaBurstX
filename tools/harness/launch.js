// Shared launcher: the real game in Chromium with pb3x-extension loaded.
const path = require( 'path' );
const { chromium } = require( 'playwright' );
const EXT = path.resolve( __dirname, '../../pb3x-extension' );
async function launch( { profile = '/tmp/pb3x-profile', url = 'https://www.plazmaburst.net/', mods = null, width = 1600, height = 900 } = {} )
{
	const ctx = await chromium.launchPersistentContext( profile, {
		headless: false,
		executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
		viewport: { width, height },
		ignoreHTTPSErrors: true,
		proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
		args: [ `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-quic', '--autoplay-policy=no-user-gesture-required' ],
	} );
	const page = ctx.pages()[ 0 ] || await ctx.newPage();
	page.on( 'pageerror', e=>console.log( 'PAGEERROR', e.message ) );
	// The build container's proxy drops some browser connections (ERR_TOO_MANY_RETRIES), and the site throttles
	// bursts of script loads with 403s. So every request is made from Node with retries: GETs of static files
	// are retried on 403/429/5xx too and cached on disk (keyed without the game's random `&NNNNN` suffix), and
	// other requests (the site's POSTs) are retried only when the connection itself failed.
	const fs = require( 'fs' ), crypto = require( 'crypto' );
	const CACHE = '/tmp/pb3x-cache';
	fs.mkdirSync( CACHE, { recursive: true } );
	const sleep = ( ms )=>new Promise( r=>setTimeout( r, ms ) );
	await ctx.route( '**/*', async route=>
	{
		const req = route.request(), url = req.url();
		if ( !/^https:/.test( url ) ) return route.continue();
		const isGet = req.method() === 'GET';
		const cacheable = isGet && ( !/\.php|\/sections\//.test( url ) || /web_style_by_version/.test( url ) );
		const key = CACHE + '/' + crypto.createHash( 'sha1' ).update( url.replace( /(\.js\?\d+)&\d+$/, '$1' ) ).digest( 'hex' );
		if ( cacheable && fs.existsSync( key + '.json' ) )
		{
			const meta = JSON.parse( fs.readFileSync( key + '.json', 'utf8' ) );
			return route.fulfill( { status: meta.status, headers: meta.headers, body: fs.readFileSync( key ) } ).catch( ()=>{} );
		}
		let last = null;
		for ( let i = 0; i < 7; i++ )
		{
			try
			{
				const r = await route.fetch( { timeout: 90000 } );
				const status = r.status();
				if ( cacheable && ( status === 403 || status === 429 || status >= 500 ) && i < 6 ) { last = r; await sleep( 400 * 2 ** i ); continue; }
				const body = await r.body();
				const headers = r.headers();
				if ( cacheable && status === 200 )
				{
					fs.writeFileSync( key, body );
					fs.writeFileSync( key + '.json', JSON.stringify( { status: 200, headers, url } ) );
				}
				return route.fulfill( { status, headers, body } ).catch( ()=>{} );
			}
			catch ( e ) { if ( /closed|disposed|Target page/.test( e.message ) ) return; await sleep( 400 * 2 ** i ); }
		}
		if ( last ) return route.fulfill( { response: last } ).catch( ()=>{} );
		return route.abort().catch( ()=>{} );
	} );
	// what the site asks its server (its .php calls) and where the page goes: a reload mid-run shows up here
	page.__log = [];
	const note = ( s )=>{ page.__log.push( new Date().toISOString().slice( 11, 19 ) + ' ' + s ); if ( process.env.PB3X_HARNESS_LOG ) console.log( '[site]', s ); };
	page.on( 'framenavigated', ( f )=>{ if ( f === page.mainFrame() ) note( 'navigated ' + f.url() ); } );
	page.on( 'response', async ( r )=>
	{
		const u = r.url();
		if ( !/\.php/.test( u ) || /web_style_by_version/.test( u ) ) return;
		let body = '';
		try { body = ( await r.text() ).replace( /\s+/g, ' ' ); } catch ( e ) {}
		const flag = /JSRetryWithAuth/.test( body ) ? ' AUTH-RETRY' : /JSReject/.test( body ) ? ' REJECT' : '';
		// (never the bodies: they carry session codes)
		note( r.request().method() + ' ' + u.replace( /^https:\/\/www\.plazmaburst\.net/, '' ).slice( 0, 60 ) + ' ' + r.status() + flag );
	} );
	page.__fails = {};
	page.on( 'requestfailed', r=>{ page.__fails[ r.url().slice( 0, 140 ) ] = r.failure().errorText; } );
	page.on( 'response', r=>{ if ( r.status() >= 400 ) page.__fails[ r.url().slice( 0, 140 ) ] = r.status(); } );
	for ( let i = 0; ; i++ )
	{
		try { await page.goto( url, { waitUntil: 'load', timeout: 120000 } ); break; }
		catch ( e ) { if ( i >= 4 ) throw e; console.log( 'goto retry', e.message.split( '\n' )[ 0 ] ); await page.waitForTimeout( 2000 * 2 ** i ); }
	}
	// PB3X mods start switched off: `mods` (ids like 'builtin/more-vehicles.user.js') are switched on for this
	// profile, and the page reloaded so they run
	if ( mods )
	{
		const changed = await page.evaluate( ( ids )=>
		{
			let on = {};
			try { on = JSON.parse( localStorage.getItem( 'pb3x_mods_enabled' ) ) || {}; } catch ( e ) {}
			const want = Object.fromEntries( ids.map( ( id )=>[ id, true ] ) );
			const next = Object.assign( {}, Object.fromEntries( Object.keys( on ).map( ( k )=>[ k, false ] ) ), want );
			const was = JSON.stringify( on ), now = JSON.stringify( next );
			if ( was !== now ) localStorage.setItem( 'pb3x_mods_enabled', now );
			return was !== now;
		}, mods );
		if ( changed ) await page.reload( { waitUntil: 'load', timeout: 120000 } );
	}
	return { ctx, page };
}
module.exports = { launch };
