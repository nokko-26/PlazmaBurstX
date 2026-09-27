// A CS Coastal Tower level, played the way a player gets it: the Level Editor opened, the level loaded through the
// mod (its own editor objects), then the editor's "Play as tester". Needs the More vehicles and CS Coastal Tower mods.
const MODS = [ 'builtin/more-vehicles.user.js', 'builtin/cs-coastal-tower.user.js' ];
async function openEditor( page )
{
	await page.waitForFunction( ()=>typeof pb2Web !== 'undefined' && typeof pb2Web.StartLevelEditor === 'function', null, { timeout: 120000 } );
	await page.evaluate( ()=>{ if ( !pb2Web.game_version_info ) pb2Web.game_version_info = { branch: 'beta', version: 'latest' }; pb2Web.StartLevelEditor(); } );
	await page.waitForFunction( ()=>typeof pb2LevelEditor !== 'undefined' && pb2LevelEditor.the_only_instance && pb2LevelEditor.bWn && pb2LevelEditor.bWn.length > 20 &&
		!( pb2_mp.game_pauses || [] ).includes( 'level_loading' ), null, { timeout: 300000, polling: 1000 } );
	await page.waitForFunction( ()=>window.__csTower && window.__csTower.registered && window.__moreVehicles, null, { timeout: 60000, polling: 500 } );
}
// the level into the editor (straight from the mod's objects: no save-first question in a fresh editor)
async function importLevel( page, id )
{
	const n = await page.evaluate( ( id )=>
	{
		const objs = __csTower.levelObjects( id );
		pb2LevelEditor.Import( '', objs, true, false, true );
		__csTower.level = id;
		return objs.length;
	}, id );
	await page.waitForTimeout( 1500 );
	return n;
}
// the editor's Play as tester, and the world up with you in it
async function playTest( page, { timeout = 300000 } = {} )
{
	await page.evaluate( ()=>
	{
		for ( const k of Object.getOwnPropertyNames( pb2Interfaces ) )
		{
			const v = pb2Interfaces[ k ];
			if ( v && typeof v.onClick === 'function' && String( v.onClick ).indexOf( 'preview_mode_tester' ) !== -1 ) { v.onClick(); return; }
		}
		throw new Error( 'Play as tester button not found' );
	} );
	await page.waitForFunction( ()=>
	{
		try
		{
			if ( ( pb2GameWorld.errors || [] ).length ) return true;
			const c = pb2Controller.controllers.find( ( k )=>k && k.player_connection === pb2GameWorld );
			return !!( c && c.character && !pb2_mp.game_pauses.includes( 'level_loading' ) );
		}
		catch ( e ) { return false; }
	}, null, { timeout, polling: 1000 } );
	const errs = await page.evaluate( ()=>( pb2GameWorld.errors || [] ).map( ( e )=>String( e.error && e.error.stack || e.error ).slice( 0, 600 ) ) );
	if ( errs.length ) throw new Error( 'map errors: ' + errs.join( ' | ' ) );
}
module.exports = { MODS, openEditor, importLevel, playTest };
