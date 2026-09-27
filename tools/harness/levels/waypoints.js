// The AI's way through a level, as the game shows it (its "AI waypoints" debug view: the waypoints it builds on every
// floor and the links between them, and each bot's path): node levels/waypoints.js 01
// The player waits, unhurt, where the hunters should come to. Shots at set spots go to
// levels/results/<level>-waypoints-<spot>.png, with how far each enemy moved in 20 s of game time (hunters path; posts hold).
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const { shoot } = require( '../shots' );
const { LABKIT } = require( '../labkit' );
const OUT = path.join( __dirname, 'results' );
const LEVEL = process.argv[ 2 ] || '01';
const SPOTS = { '01': [ [ 'landing', 7950, -250, 1.4 ], [ 'quay', 8700, -300, 1.4 ], [ 'arch-b', 5350, -700, 1.4 ] ],
	'06': [ [ 'services', 5700, -700, 1.4 ], [ 'deck', 8000, -700, 1.6 ], [ 'road', 6300, -950, 1.4 ] ] };
// where the player waits (unhurt) for the hunters to come: the jetty's front slab
const BAIT = { '01': [ 7590, -90 ], '06': [ 5700, -664 ] };
const log = ( ...a )=>console.log( new Date().toISOString().slice( 11, 19 ), ...a );

( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	const out = { level: LEVEL };
	try
	{
		await openEditor( page );
		await importLevel( page, LEVEL );
		await playTest( page );
		// (the player, unhurt, waits where the hunters should come to)
		await page.evaluate( LABKIT );
		await page.waitForTimeout( 5000 );
		// (unhurt whatever hits it — blows, and fire, which doesn't come through the ragdoll's damage: healed every frame
		// too; out of the boat it starts beside, and still: a player who dies here is put back at the dock, and the
		// hunters have no one to come to)
		const place = ()=>page.evaluate( ( bait )=>
		{
			const m = __lab.me(), v = m && m.ragdoll.driver_of;
			if ( v && v.ExcludeRagdoll ) v.ExcludeRagdoll( m.ragdoll, true );
			__lab.teleport( bait[ 0 ], bait[ 1 ] );
			const bodies = ( m.ragdoll.local_atoms || [] ).filter( Boolean ).map( ( a )=>a.box2d_body );
			for ( const k of [ 'box2d_body', 'gy', 'lS' ] ) bodies.push( m[ k ] );
			for ( const b of bodies ) { if ( !b || typeof b.SetLinearVelocity !== 'function' ) continue; try { b.SetLinearVelocity( new b2Vec2( 0, 0 ) ); } catch ( e ) {} }
		}, BAIT[ LEVEL ] );
		await page.evaluate( ()=>
		{
			const R = pb2Ragdoll.prototype, hurt = R._beb;
			R._beb = function( atom, dmg, ...rest ) { const ch = this.owner_character; if ( ch && ch.controller && ch.controller.player_connection ) dmg = 0; return hurt.call( this, atom, dmg, ...rest ); };
			const W = window.__wp = { deaths: 0, game: 0 };
			const tick = ()=>{ requestAnimationFrame( tick ); const m = __lab.me(); if ( !m || !( m.hea > 0 ) ) { W.deaths++; return; } m.hmax = 150; m.hea = 150; };
			tick();
			// (the game's own clock: each think is given its step in 30 fps ticks — on a slow machine the game runs slower
			// than the wall clock, so the wait is counted in game time)
			const T = pb2Controller.ThinkNow;
			pb2Controller.ThinkNow = function( gs ) { if ( gs > 0 ) W.game += gs / 30; return T.apply( this, arguments ); };
		} );
		await place(); await page.waitForTimeout( 100 ); await place();
		await page.waitForTimeout( 400 );
		const start = await page.evaluate( ( bait )=>
		{
			pb2_mp.DEBUG_AI_SHOW_WAY_POINTS_WITH_PARTICLES = pb2_mp.DEBUG_AI_DRAW_PATH_LINES = true;
			// (each enemy remembered as it stands: names repeat)
			window.__wpStart = pb2Character.characters.filter( ( c )=>c && c.hea > 0 && !c.controller.player_connection ).map( ( c )=>( { c, x: c.x, y: c.y, crew: !!c.ragdoll.driver_of } ) );
			return window.__wpStart.length;
		}, BAIT[ LEVEL ] );
		// 20 s of the game's time; the player watched while it waits, twice a second — a waiting player holds its ground,
		// so one knocked more than 100 px off is put back (counted)
		const at = [], bait = BAIT[ LEVEL ];
		let replaced = 0;
		const g0 = await page.evaluate( ()=>window.__wp.game ), w0 = Date.now();
		while ( Date.now() - w0 < 240000 )
		{
			await page.waitForTimeout( 500 );
			const p = await page.evaluate( ()=>{ const m = __lab.me(); return m && m.hea > 0 ? [ Math.round( m.x ), Math.round( m.y ), !!m.ragdoll.driver_of ] : null; } );
			at.push( p );
			if ( p && !p[ 2 ] && Math.hypot( p[ 0 ] - bait[ 0 ], p[ 1 ] - bait[ 1 ] ) > 100 ) { await place(); replaced++; }
			if ( await page.evaluate( ()=>window.__wp.game ) - g0 >= 20 ) break;
		}
		out.gameSecs = +( ( await page.evaluate( ()=>window.__wp.game ) ) - g0 ).toFixed( 1 );
		out.wallSecs = +( ( Date.now() - w0 ) / 1000 ).toFixed( 1 );
		out.enemies = start;
		out.player = { first: at[ 0 ], last: at[ at.length - 1 ], deaths: await page.evaluate( ()=>window.__wp.deaths ), worst: Math.max( ...at.map( ( p )=>p ? Math.hypot( p[ 0 ] - bait[ 0 ], p[ 1 ] - bait[ 1 ] ) : 1e9 ) ) | 0, inVehicle: at.some( ( p )=>p && p[ 2 ] ), replaced };
		// (the probe holds only if the player waited where it says: at the bait — put back when knocked, never thrown
		// more than 400 px — alive, on foot, the whole 20 game seconds)
		out.playerHeld = out.player.worst <= 400 && !out.player.inVehicle && out.player.deaths === 0 && out.gameSecs >= 20;
		if ( !out.playerHeld ) out.failed = 'the player did not stay at the bait: ' + JSON.stringify( out.player );
		out.moved = await page.evaluate( ( bait )=>window.__wpStart.map( ( { c, x, y, crew } )=>{ const alive = c.hea > 0 && !c.is_being_removed; const d0 = Math.hypot( x - bait[ 0 ], y - bait[ 1 ] ), d1 = Math.hypot( c.x - bait[ 0 ], c.y - bait[ 1 ] );
			return { name: String( ( c.ragdoll.name || {} ).text || '' ), from: [ Math.round( x ), Math.round( y ) ], to: alive ? [ Math.round( c.x ), Math.round( c.y ) ] : 'dead', crew, moved: Math.round( Math.hypot( c.x - x, c.y - y ) ), closer: alive ? Math.round( d0 - d1 ) : 0, alive }; } ), BAIT[ LEVEL ] );
		// (hunters walking to the player: alive, on foot — not a boat's crew — and more than 150 px closer to it; a fall
		// into the sea or a body thrown by a blast isn't a hunter pathing)
		out.movedCount = out.moved.filter( ( m )=>m.alive && !m.crew && m.closer > 150 ).length;
		out.anyMoved = out.moved.filter( ( m )=>m.moved > 150 ).length;
		for ( const [ name, x, y, zoom ] of SPOTS[ LEVEL ] ) { await shoot( page, path.join( OUT, LEVEL + '-waypoints-' + name + '.png' ), { x, y, zoom, frames: 40 } ); log( 'shot', name ); }
	}
	catch ( e ) { out.failed = e.message.slice( 0, 800 ); log( 'FAILED', out.failed ); }
	fs.writeFileSync( path.join( OUT, LEVEL + '-waypoints.json' ), JSON.stringify( out, null, 1 ) );
	log( JSON.stringify( out ) );
	await ctx.close();
} )();
