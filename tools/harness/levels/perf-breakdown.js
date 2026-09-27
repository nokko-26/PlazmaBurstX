// Where a level's frame time goes: node levels/perf-breakdown.js <level> [x y]
// One play session, one camera spot. Measures the frame time and how much of it is the renderer (three.js render
// calls) against everything else (the game's logic: AI, physics, the mods), first as the level is, then with each
// suspect taken away in turn: the mod's set pieces hidden, the lamps turned off, the enemies removed. Writes
// levels/results/<level>-perf-breakdown.json.
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const OUT = path.join( __dirname, 'results' );
const LEVEL = process.argv[ 2 ] || '06';
const X = +( process.argv[ 3 ] || 8400 ), Y = +( process.argv[ 4 ] || -700 );
const log = ( ...a )=>console.log( new Date().toISOString().slice( 11, 19 ), ...a );
async function measure( page, secs = 8 )
{
	return page.evaluate( async ( [ x, y, secs ] )=>
	{
		const c = pb2_mp.my_controller;
		c.camera_position_forced = true; c.camera_position_target_x = x; c.camera_position_target_y = y;
		const XM = pb2_mp.XM, r = XM.renderer, render = r.render;
		let calls = 0, tris = 0, rms = 0;
		r.render = function() { const t = performance.now(); const out = render.apply( this, arguments ); rms += performance.now() - t; calls += r.info.render.calls; tris += r.info.render.triangles || 0; return out; };
		const frames = [], per = [];
		await new Promise( ( done )=>{ let n = 0; const w = ()=>{ if ( ++n < 20 ) requestAnimationFrame( w ); else done(); }; requestAnimationFrame( w ); } );
		await new Promise( ( done )=>
		{
			const t0 = performance.now(); let last = t0; calls = 0; tris = 0; rms = 0;
			const f = ( now )=>{ frames.push( now - last ); per.push( [ calls, tris, rms ] ); calls = 0; tris = 0; rms = 0; last = now; if ( now - t0 < secs * 1000 ) requestAnimationFrame( f ); else done(); };
			requestAnimationFrame( f );
		} );
		r.render = render;
		frames.shift(); per.shift();
		const med = ( a )=>{ const s = a.slice().sort( ( p, q )=>p - q ); return Math.round( s[ s.length >> 1 ] ); };
		return { frames: frames.length, msMedian: med( frames ), renderMs: med( per.map( ( p )=>p[ 2 ] ) ), otherMs: med( frames.map( ( f, i )=>f - per[ i ][ 2 ] ) ), drawCalls: med( per.map( ( p )=>p[ 0 ] ) ), triangles: med( per.map( ( p )=>p[ 1 ] ) ),
			characters: pb2Character.characters.length, entities: pb2Entity.entities.length };
	}, [ X, Y, secs ] );
}
( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	const out = { level: LEVEL, spot: [ X, Y ], steps: {} };
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	try
	{
		await openEditor( page );
		await importLevel( page, LEVEL );
		await playTest( page );
		// (the player at the spot, unhurt: the soldiers around it wake as in play)
		const { LABKIT } = require( '../labkit' );
		await page.evaluate( LABKIT );
		await page.evaluate( ( [ x, feet ] )=>{ const R = pb2Ragdoll.prototype, hurt = R._beb; R._beb = function( atom, dmg, ...rest ) { const ch = this.owner_character; if ( dmg > 0 && ch && ch.controller && ch.controller.player_connection ) dmg = 0; return hurt.call( this, atom, dmg, ...rest ); }; __lab.teleport( x, feet - 44 ); }, [ +( process.argv[ 5 ] || X - 100 ), +( process.argv[ 6 ] || -620 ) ] );
		await page.waitForTimeout( 6000 );
		out.steps.asIs = await measure( page ); log( 'as is', JSON.stringify( out.steps.asIs ) );
		// the mod's set pieces (every mesh drawn with its dusk/tower shader, or its own unlit ones, outside the game's own)
		out.hidden = await page.evaluate( ()=>{ let n = 0; const d = window.__csTower.debug; if ( d && d.sets ) n = d.sets( false ); return n; } );
		out.steps.noSets = await measure( page ); log( 'no set pieces', out.hidden, JSON.stringify( out.steps.noSets ) );
		await page.evaluate( ()=>{ const d = window.__csTower.debug; if ( d && d.sets ) d.sets( true ); } );
		// the lamps: every light the game made, off
		out.lamps = await page.evaluate( ()=>{ let n = 0; pb2_mp.scene.traverse( ( o )=>{ if ( o.isLight && o.visible ) { o.visible = false; o.__off = true; n++; } } ); return n; } );
		out.steps.noLights = await measure( page ); log( 'no lights', out.lamps, JSON.stringify( out.steps.noLights ) );
		await page.evaluate( ()=>{ pb2_mp.scene.traverse( ( o )=>{ if ( o.__off ) { o.visible = true; o.__off = false; } } ); } );
		// every soldier asleep (their thinking gone; their bodies and drawing stay)
		out.sleepAll = await page.evaluate( ()=>{ const d = window.__csTower.debug; return !!( d && d.sleepAll && d.sleepAll( true ) ); } );
		await page.waitForTimeout( 1500 );
		out.steps.allAsleep = await measure( page ); log( 'all asleep', JSON.stringify( out.steps.allAsleep ) );
		await page.evaluate( ()=>{ const d = window.__csTower.debug; if ( d && d.sleepAll ) d.sleepAll( false ); } );
		// the enemies: every character that isn't a player, removed
		out.removed = await page.evaluate( ()=>{ let n = 0; for ( const c of pb2Character.characters.slice() ) if ( c && !( c.controller && c.controller.player_connection ) ) { try { c.ragdoll.remove(); n++; } catch ( e ) {} } return n; } );
		await page.waitForTimeout( 2000 );
		out.steps.noEnemies = await measure( page ); log( 'no enemies', out.removed, JSON.stringify( out.steps.noEnemies ) );
	}
	catch ( e ) { out.failed = String( e && e.stack || e ).slice( 0, 900 ); log( 'FAILED', out.failed ); }
	fs.writeFileSync( path.join( OUT, LEVEL + '-perf-breakdown.json' ), JSON.stringify( out, null, 1 ) );
	await ctx.close();
} )();
