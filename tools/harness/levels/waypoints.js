// The AI's way through a level, as the game shows it (its "AI waypoints" debug view: the waypoints it builds on every
// floor and the links between them, and each bot's path): node levels/waypoints.js 01
// The player waits, unhurt, where the hunters should come to. Shots at set spots go to
// levels/results/<level>-waypoints-<spot>.png, with how far each enemy moved in 20 s (hunters path; posts hold).
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
		const start = await page.evaluate( ( bait )=>
		{
			const R = pb2Ragdoll.prototype, hurt = R._beb;
			R._beb = function( atom, dmg, ...rest ) { const ch = this.owner_character; if ( ch && ch.controller && ch.controller.player_connection ) dmg = 0; return hurt.call( this, atom, dmg, ...rest ); };
			__lab.teleport( bait[ 0 ], bait[ 1 ] );
			pb2_mp.DEBUG_AI_SHOW_WAY_POINTS_WITH_PARTICLES = pb2_mp.DEBUG_AI_DRAW_PATH_LINES = true;
			// (each enemy remembered as it stands: names repeat)
			window.__wpStart = pb2Character.characters.filter( ( c )=>c && c.hea > 0 && !c.controller.player_connection ).map( ( c )=>( { c, x: c.x, y: c.y, crew: !!c.ragdoll.driver_of } ) );
			return window.__wpStart.length;
		}, BAIT[ LEVEL ] );
		await page.waitForTimeout( 20000 );
		out.enemies = start;
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
