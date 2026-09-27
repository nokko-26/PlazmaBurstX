// Start an offline game with a map script (the mod's "direct" preview path) and wait for it.
const fs = require( 'fs' ), path = require( 'path' );
function previewMap()
{
	const src = fs.readFileSync( path.resolve( __dirname, '../../pb3x-extension/pb3x.js' ), 'utf8' );
	const m = src.match( /const PREVIEW_MAP = ("(?:[^"\\]|\\.)*");/ );
	return JSON.parse( m[ 1 ] );
}
async function startMap( page, mapJs, { timeout = 300000 } = {} )
{
	await page.waitForFunction( ()=>typeof pb2Web !== 'undefined' && typeof pb2Web.RunGame === 'function', null, { timeout: 120000 } );
	await page.evaluate( ( map )=>
	{
		window.__h = { began: false, err: null };
		const begin = ()=>
		{
			try
			{
				pb2GameWorld.first_JS_map = '';
				pb2GameWorld.modules = [ { user_data_uid: -1, content: '/* Module -1 (harness) */' + map } ];
				pb2Multiplayer.startup_details = { modules: [] };
				pb2Multiplayer.startup_details_initial = Object.assign( {}, pb2Multiplayer.startup_details );
				pb2Multiplayer.StartOffline();
				pb2GameWorld.onMapLoaded();
				window.__h.began = true;
			}
			catch ( e ) { window.__h.err = String( e && e.stack || e ); }
		};
		const up = typeof pb2GameWorld !== 'undefined' && typeof pb2_mp !== 'undefined' && pb2_mp.renderer;
		const run = ()=>{ try { pb2Web.RunGame( null, begin, null ); } catch ( e ) { window.__h.err = String( e.stack || e ); } };
		if ( up ) pb2GameWorld.DestroyEverythingAsync( run );
		else { if ( !pb2Web.game_version_info ) pb2Web.game_version_info = { branch: 'beta', version: 'latest' }; run(); }
	}, mapJs );
	const t0 = Date.now();
	for ( ;; )
	{
		const s = await page.evaluate( ()=>
		{
			const o = { h: window.__h };
			try { o.errs = ( pb2GameWorld.errors || [] ).map( e=>String( e.error && e.error.message || e.error ) ); } catch ( e ) {}
			try { o.loading = pb2_mp.game_pauses.indexOf( 'level_loading' ) !== -1; o.rag = pb2Ragdoll.ragdolls.length; } catch ( e ) {}
			try { o.me = !!pb2Controller.controllers.find( c=>c && c.player_connection === pb2GameWorld ).character; } catch ( e ) {}
			return o;
		} );
		if ( s.h.err ) throw new Error( 'start: ' + s.h.err );
		if ( s.errs && s.errs.length ) throw new Error( 'map: ' + s.errs.join( '; ' ) );
		if ( s.h.began && s.loading === false && s.me ) return s;
		if ( Date.now() - t0 > timeout ) throw new Error( 'timeout ' + JSON.stringify( s ) );
		await page.waitForTimeout( 1000 );
	}
}
module.exports = { startMap, previewMap };
