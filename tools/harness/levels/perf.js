// What a level costs to draw, against the editor's own starting map, in the same browser: node levels/perf.js [01]
// At set camera spots: the frame time (rAF to rAF) and the draw calls and triangles per frame (every render the
// frame's passes make, summed). The build container's GPU is SwiftShader (software): the frame times compare, they
// aren't what a real GPU gives. Writes levels/results/<level>-perf.json.
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { startMap, previewMap } = require( '../game' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const OUT = path.join( __dirname, 'results' );
const LEVEL = process.argv[ 2 ] || '01';
const SPOTS = { '01': [ [ 'start', 800, -300 ], [ 'arch B', 5300, -350 ], [ 'shore', 8400, -420 ] ],
	'06': [ [ 'start', 1500, -250 ], [ 'tower span', 7500, -600 ], [ 'deck', 8400, -700 ], [ 'road', 6500, -950 ] ] };
// (where the player stands at each spot, feet: the soldiers around it wake and fight as they do in play — measured with
// the player elsewhere, the far ones would be asleep and the level cheaper than it is)
const STAND = { '06': { start: [ 1250, -48 ], 'tower span': [ 7300, -330 ], deck: [ 8300, -620 ], road: [ 6600, -860 ] } };
const log = ( ...a )=>console.log( new Date().toISOString().slice( 11, 19 ), ...a );

// hold the camera on a spot for `secs` and measure
async function measure( page, x, y, secs = 8 )
{
	return page.evaluate( async ( [ x, y, secs ] )=>
	{
		const c = pb2_mp.my_controller;
		if ( x !== null ) { c.camera_position_forced = true; c.camera_position_target_x = x; c.camera_position_target_y = y; }
		const r = pb2_mp.XM.renderer, render = r.render;
		let calls = 0, tris = 0;
		r.render = function() { const out = render.apply( this, arguments ); calls += r.info.render.calls; tris += r.info.render.triangles !== undefined ? r.info.render.triangles : r.info.render.faces || 0; return out; };
		const frames = [], perFrame = [];
		await new Promise( ( done )=>{ let n = 0; const warm = ()=>{ if ( ++n < 20 ) requestAnimationFrame( warm ); else done(); }; requestAnimationFrame( warm ); } );
		await new Promise( ( done )=>
		{
			const t0 = performance.now(); let last = t0; calls = 0; tris = 0;
			const f = ( now )=>
			{
				frames.push( now - last ); perFrame.push( [ calls, tris ] ); calls = 0; tris = 0; last = now;
				if ( now - t0 < secs * 1000 ) requestAnimationFrame( f ); else done();
			};
			requestAnimationFrame( f );
		} );
		r.render = render;
		if ( x !== null ) c.camera_position_forced = false;
		frames.shift(); perFrame.shift();
		const sorted = frames.slice().sort( ( a, b )=>a - b ), mean = frames.reduce( ( a, b )=>a + b, 0 ) / frames.length;
		const avg = ( i )=>Math.round( perFrame.reduce( ( a, p )=>a + p[ i ], 0 ) / perFrame.length );
		return { frames: frames.length, msMean: Math.round( mean ), msMedian: Math.round( sorted[ sorted.length >> 1 ] ), ms95: Math.round( sorted[ Math.floor( sorted.length * 0.95 ) ] ), drawCalls: avg( 0 ), triangles: avg( 1 ) };
	}, [ x, y, secs ] );
}

( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	const out = { level: LEVEL, viewport: '1600x900', renderer: null, baseline: null, spots: {} };
	const open = ()=>launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	// the baseline: the Level Editor's own new map (terrain, grass, two characters), mods on as for the level
	{
		const { ctx, page } = await open();
		try
		{
			await startMap( page, previewMap() );
			await page.waitForTimeout( 3000 );
			out.renderer = await page.evaluate( ()=>{ const gl = pb2_mp.XM.renderer.getContext(), d = gl.getExtension( 'WEBGL_debug_renderer_info' ); return d ? gl.getParameter( d.UNMASKED_RENDERER_WEBGL ) : gl.getParameter( gl.RENDERER ); } );
			out.baseline = await measure( page, null, null );
			log( 'baseline (editor starting map)', JSON.stringify( out.baseline ) );
		}
		catch ( e ) { out.baselineFailed = e.message.slice( 0, 800 ); log( 'baseline FAILED', out.baselineFailed ); }
		await ctx.close();
	}
	// the level, played as tester
	const { ctx, page } = await open();
	try
	{
		await openEditor( page );
		await importLevel( page, LEVEL );
		await playTest( page );
		await page.waitForTimeout( 5000 );
		if ( STAND[ LEVEL ] )
		{
			const { LABKIT } = require( '../labkit' );
			await page.evaluate( LABKIT );
			// (the player unhurt: this measures the frame, not the fight)
			await page.evaluate( ()=>{ const R = pb2Ragdoll.prototype, hurt = R._beb; R._beb = function( atom, dmg, ...rest ) { const ch = this.owner_character; if ( dmg > 0 && ch && ch.controller && ch.controller.player_connection ) dmg = 0; return hurt.call( this, atom, dmg, ...rest ); }; } );
		}
		for ( const [ name, x, y ] of SPOTS[ LEVEL ] )
		{
			const at = STAND[ LEVEL ] && STAND[ LEVEL ][ name ];
			if ( at ) { await page.evaluate( ( [ px, feet ] )=>{ const m = __lab.me(); if ( !m ) return; const v = m.ragdoll.driver_of; if ( v && v.ExcludeRagdoll ) v.ExcludeRagdoll( m.ragdoll, true ); __lab.teleport( px, feet - 44 ); }, at ); await page.waitForTimeout( 3000 ); }
			out.spots[ name ] = await measure( page, x, y );
			if ( at ) out.spots[ name ].player = at;
			log( name, JSON.stringify( out.spots[ name ] ) );
		}
		out.mod = await page.evaluate( ()=>( { status: window.__csTower.status, error: window.__csTower.error } ) );
	}
	catch ( e ) { out.failed = e.message.slice( 0, 800 ); log( 'FAILED', out.failed ); }
	// (the busiest spot against the editor's starting map: what the levels' frame-cost rule reads)
	const medians = Object.keys( out.spots ).map( ( k )=>out.spots[ k ].msMedian ).filter( ( v )=>v > 0 );
	if ( out.baseline && out.baseline.msMedian > 0 && medians.length ) out.worstRatio = +( Math.max( ...medians ) / out.baseline.msMedian ).toFixed( 2 );
	fs.writeFileSync( path.join( OUT, LEVEL + '-perf.json' ), JSON.stringify( out, null, 1 ) );
	log( 'renderer:', out.renderer );
	await ctx.close();
} )();
