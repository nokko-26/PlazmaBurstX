// 01 · Approach's landing, the boat alone (the enemies taken out): node levels/dock-01.js
// Dock at the jetty (D), back off (A), dock again, step ashore and walk on; then swimmers by the docked boat (in the gap
// under its bow, and behind it) get out. Checks: the boat can leave, you land dry, no swimmer is stuck. Screenshots and a
// report go to levels/results/01-dock-*.
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const { LABKIT } = require( '../labkit' );
const { shoot, release } = require( '../shots' );
const OUT = path.join( __dirname, 'results' );
const report = { steps: [] };
const note = ( name, data )=>{ report.steps.push( { name, data } ); console.log( name, JSON.stringify( data ) ); };
( async ()=>{
	fs.mkdirSync( OUT, { recursive: true } );
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	await openEditor( page ); await importLevel( page, '01' ); await playTest( page );
	await page.evaluate( LABKIT );
	await page.waitForTimeout( 5000 );
	// (the enemies and their boats gone: this is about the berth)
	await page.evaluate( ()=>
	{
		for ( const c of pb2Character.characters.slice() ) if ( c && !c.controller.player_connection ) c.ragdoll.remove();
		for ( const e of pb2Entity.entities.slice() ) if ( e && e.type === pb2Entity.TYPE_BOAT && Math.abs( e.box2d_bodies[ 0 ].GetPosX() * 30 - 1320 ) > 300 ) e.remove();
	} );
	const key = ( t, c )=>page.evaluate( ( [ t, c ] )=>__lab.key( t, c ), [ t, c ] );
	const hold = async ( c, ms )=>{ await key( 'keydown', c ); await page.waitForTimeout( ms ); await key( 'keyup', c ); };
	const boat = ()=>page.evaluate( ()=>
	{
		const b = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed );
		if ( !b ) return null;
		const B = b.box2d_bodies[ 0 ], m = __lab.me();
		return { x: Math.round( B.GetPosX() * 30 ), y: Math.round( B.GetPosY() * 30 ), deg: Math.round( B.GetAngle() * 57.3 ), aboard: !!m && Array.from( b.gO ).some( ( r )=>r && r.owner_character === m ) };
	} );
	await hold( 'KeyD', 1500 );
	for ( let i = 0; i < 6 && !( await boat() ).aboard; i++ ) { await hold( 'KeyE', 200 ); await page.waitForTimeout( 800 ); if ( i === 2 ) await hold( 'KeyD', 400 ); }
	note( 'aboard', await boat() );
	const driveTo = async ( code, stop )=>
	{
		await key( 'keydown', code );
		let last = null, still = 0;
		for ( let i = 0; i < 80; i++ ) { await page.waitForTimeout( 1000 ); const b = await boat(); if ( stop( b ) ) break; if ( last && Math.abs( b.x - last.x ) < 8 ) { if ( ++still >= 3 ) break; } else still = 0; last = b; }
		await key( 'keyup', code );
		await page.waitForTimeout( 2500 );
		return boat();
	};
	note( 'docked', report.docked = await driveTo( 'KeyD', ()=>false ) );
	await shoot( page, path.join( OUT, '01-dock-docked.png' ), { x: 7500, y: -150, zoom: 1, frames: 20 } ); await release( page );
	note( 'backed off (A)', report.backed = await driveTo( 'KeyA', ( b )=>b.x < 6900 ) );
	await shoot( page, path.join( OUT, '01-dock-backed.png' ), { x: 7300, y: -150, zoom: 1, frames: 20 } ); await release( page );
	note( 'docked again', await driveTo( 'KeyD', ()=>false ) );
	await hold( 'KeyE', 200 ); await page.waitForTimeout( 800 );
	await key( 'keydown', 'KeyD' );
	report.ashore = [];
	for ( let i = 0; i < 8; i++ )
	{
		await page.waitForTimeout( 700 );
		const p = await page.evaluate( ()=>{ const m = __lab.me(); return m ? { x: Math.round( m.x ), y: Math.round( m.y ) } : null; } );
		const prev = report.ashore[ report.ashore.length - 1 ];
		report.ashore.push( p );
		if ( p && prev && Math.abs( p.x - prev.x ) < 5 ) await hold( 'KeyW', 150 );                  // (stopped: a jump, as a player would)
	}
	report.wet = report.ashore.some( ( p )=>p && p.y > -5 );
	report.landed = report.ashore.some( ( p )=>p && p.x > 7640 && p.y < -5 );
	note( 'ashore', { path: report.ashore, wet: report.wet } );
	await key( 'keyup', 'KeyD' );
	note( 'boat after', await boat() );
	await shoot( page, path.join( OUT, '01-dock-ashore.png' ), { x: 7600, y: -200, zoom: 1, frames: 20 } );
	// swimmers by the docked boat (as a player knocked in there), in the gap under its bow and behind its stern: the
	// boat covers the water in front of the jetty
	report.swim = {};
	const where = ()=>page.evaluate( ()=>{ const m = __lab.me(); return m ? [ Math.round( m.x ), Math.round( m.y ), !!m.ragdoll.driver_of ] : null; } );
	// (as a player does: a dive under the boat (S) and up again (W) past its bow, into the jetty's bay and out through
	// its hatch — a swimmer can't climb onto a boat, and boarding one (E) takes being at the surface next to it)
	const walkOn = async ( path, secs, up )=>
	{
		await key( 'keydown', 'KeyD' ); if ( up ) await key( 'keydown', 'KeyW' );
		let lastX = null;
		for ( let i = 0; i < secs / 0.6; i++ )
		{
			await page.waitForTimeout( 600 );
			const p = await where(); path.push( p );
			if ( p && p[ 1 ] < -5 && p[ 0 ] > 7640 ) break;
			if ( !up && p && lastX !== null && Math.abs( p[ 0 ] - lastX ) < 5 ) await hold( 'KeyW', 150 );      // (the wheelhouse: over it)
			lastX = p && p[ 0 ];
		}
		await key( 'keyup', 'KeyD' ); await key( 'keyup', 'KeyW' );
		const end = path[ path.length - 1 ];
		return !!end && end[ 1 ] < -5 && end[ 0 ] > 7540;
	};
	{
		// (in the gap under the bow: up and on, into the bay and out through its hatch)
		await page.evaluate( ()=>__lab.teleport( 7548, 40 ) );
		const path = [ await where() ];
		report.swim[ 'under the bow' ] = { path, out: await walkOn( path, 10, true ) };
		note( 'swimmer under the bow', report.swim[ 'under the bow' ] );
	}
	{
		await page.evaluate( ()=>__lab.teleport( 7030, 30 ) );
		const path = [ await where() ];
		await key( 'keydown', 'KeyS' ); await key( 'keydown', 'KeyD' );
		for ( let i = 0; i < 12; i++ ) { await page.waitForTimeout( 500 ); const p = await where(); path.push( p ); if ( p && p[ 0 ] > 7560 ) break; }
		await key( 'keyup', 'KeyS' ); await key( 'keyup', 'KeyD' );
		report.swim[ 'astern, under the boat' ] = { path, out: await walkOn( path, 10, true ) };
		note( 'swimmer astern, under the boat', report.swim[ 'astern, under the boat' ] );
	}
	report.canLeave = !!( report.docked && report.backed && report.docked.x - report.backed.x > 300 );
	fs.writeFileSync( path.join( OUT, '01-dock-report.json' ), JSON.stringify( report, null, 1 ) );
	console.log( 'can leave:', report.canLeave, ' landed dry:', report.landed && !report.wet, ' swimmers out:', JSON.stringify( Object.keys( report.swim ).map( ( k )=>k + ' ' + report.swim[ k ].out ) ) );
	await ctx.close();
} )();
