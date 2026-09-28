// Where a level's frame goes, measured the honest way: node levels/perf-matrix.js <level> <camX> <camY> <standX> <standFeet>
// The editor's starting map first (the baseline, in its own session), then the level played as tester with the player
// standing at the spot — out of any vehicle, stilled, unhurt (healed every frame: fire doesn't come through the
// ragdoll's damage), its place checked — and the frame measured as the level is, then with one thing changed at a time:
// every character drawn (the mod's hiding of the far ones off), the wider wake window it had before, every soldier asleep, no
// enemies, then (with no enemies) each kind of set piece hidden in turn, all of them, and half resolution. Each step is
// three 6 s windows (the median of their medians: the software renderer is noisy). Also counts shader programs linked
// while measuring. Writes levels/results/<level>-perf-matrix.json.
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { startMap, previewMap } = require( '../game' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const { LABKIT } = require( '../labkit' );
const OUT = path.join( __dirname, 'results' );
const LEVEL = process.argv[ 2 ] || '06';
const CAM = [ +( process.argv[ 3 ] || 8400 ), +( process.argv[ 4 ] || -700 ) ], STAND = [ +( process.argv[ 5 ] || 8300 ), +( process.argv[ 6 ] || -620 ) ];
const log = ( ...a )=>console.log( new Date().toISOString().slice( 11, 19 ), ...a );
async function window1( page, cam, secs )
{
	return page.evaluate( async ( [ cam, secs ] )=>
	{
		const c = pb2_mp.my_controller;
		if ( cam ) { c.camera_position_forced = true; c.camera_position_target_x = cam[ 0 ]; c.camera_position_target_y = cam[ 1 ]; }
		const r = pb2_mp.XM.renderer, render = r.render, gl = r.getContext();
		let calls = 0, links = 0;
		const lp = gl.linkProgram; gl.linkProgram = function() { links++; return lp.apply( this, arguments ); };
		r.render = function() { const out = render.apply( this, arguments ); calls += r.info.render.calls; return out; };
		await new Promise( ( done )=>{ let n = 0; const w = ()=>{ if ( ++n < 10 ) requestAnimationFrame( w ); else done(); }; requestAnimationFrame( w ); } );
		const frames = [], draws = [];
		await new Promise( ( done )=>{ const t0 = performance.now(); let last = t0; calls = 0; links = 0; const f = ( now )=>{ frames.push( now - last ); draws.push( calls ); calls = 0; last = now; if ( now - t0 < secs * 1000 ) requestAnimationFrame( f ); else done(); }; requestAnimationFrame( f ); } );
		r.render = render; gl.linkProgram = lp;
		frames.shift(); draws.shift();
		const med = ( a )=>{ const s = a.slice().sort( ( p, q )=>p - q ); return s.length ? Math.round( s[ s.length >> 1 ] ) : null; };
		return { ms: med( frames ), draws: med( draws ), frames: frames.length, links };
	}, [ cam, secs ] );
}
async function measure( page, cam )
{
	const w = [];
	for ( let i = 0; i < 3; i++ ) w.push( await window1( page, cam, 6 ) );
	const med = ( a )=>a.slice().sort( ( p, q )=>p - q )[ 1 ];
	return { ms: med( w.map( ( x )=>x.ms ) ), draws: med( w.map( ( x )=>x.draws ) ), windows: w.map( ( x )=>x.ms ), links: w.reduce( ( a, x )=>a + x.links, 0 ) };
}
( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	const out = { level: LEVEL, cam: CAM, stand: STAND, steps: {} };
	const open = ()=>launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	{
		const { ctx, page } = await open();
		try { await startMap( page, previewMap() ); await page.waitForTimeout( 3000 ); out.baseline = await measure( page, null ); log( 'baseline', JSON.stringify( out.baseline ) ); }
		catch ( e ) { out.failed = 'baseline: ' + e.message.slice( 0, 600 ); }
		await ctx.close();
	}
	const { ctx, page } = await open();
	const ev = ( fn, ...a )=>page.evaluate( fn, ...a );
	try
	{
		await openEditor( page ); await importLevel( page, LEVEL ); await page.waitForTimeout( 3000 );
		await playTest( page ); await page.evaluate( LABKIT ); await page.waitForTimeout( 3000 );
		await ev( ()=>{ const R = pb2Ragdoll.prototype, hurt = R._beb; R._beb = function( atom, dmg, ...rest ) { const ch = this.owner_character; if ( dmg > 0 && ch && ch.controller && ch.controller.player_connection ) dmg = 0; return hurt.call( this, atom, dmg, ...rest ); };
			const W = window.__pm = { deaths: 0 }; const tick = ()=>{ requestAnimationFrame( tick ); const m = __lab.me(); if ( !m || !( m.hea > 0 ) ) { W.deaths++; return; } m.hmax = 150; m.hea = 150; }; tick(); } );
		const place = ()=>ev( ( [ x, feet ] )=>{ const m = __lab.me(); const v = m.ragdoll.driver_of; if ( v && v.ExcludeRagdoll ) v.ExcludeRagdoll( m.ragdoll, true ); __lab.teleport( x, feet - 44 );
			const bodies = ( m.ragdoll.local_atoms || [] ).filter( Boolean ).map( ( a )=>a.box2d_body ); for ( const k of [ 'box2d_body', 'gy', 'lS' ] ) bodies.push( m[ k ] ); for ( const b of bodies ) { if ( !b || typeof b.SetLinearVelocity !== 'function' ) continue; try { b.SetLinearVelocity( new b2Vec2( 0, 0 ) ); } catch ( e ) {} } }, STAND );
		const where = ()=>ev( ()=>{ const m = __lab.me(); return m && m.hea > 0 ? [ Math.round( m.x ), Math.round( m.y + 44 ), !!m.ragdoll.driver_of ] : null; } );
		const D = ( name, ...a )=>ev( ( [ name, a ] )=>window.__csTower.debug[ name ]( ...a ), [ name, a ] );
		const step = async ( name, setup, settle = 1500 )=>
		{
			if ( setup ) await setup();
			await place(); await page.waitForTimeout( 100 ); await place();
			await page.waitForTimeout( settle );
			const before = await where(), d0 = await ev( ()=>window.__pm.deaths );
			const m = await measure( page, CAM );
			const after = await where(), deaths = await ev( ()=>window.__pm.deaths ) - d0;
			const st = await ev( ()=>( { asleep: window.__csTower.asleep, charsOffCam: window.__csTower.charsOffCam, chars: pb2Character.characters.length } ) );
			out.steps[ name ] = Object.assign( m, st, { ratio: out.baseline ? +( m.ms / out.baseline.ms ).toFixed( 2 ) : null, before, after, deaths } );
			log( name, JSON.stringify( out.steps[ name ] ) );
		};
		await step( 'asIs', null, 3000 );
		await step( 'charsDrawnAll', ()=>D( 'charsDrawnAll', true ) );
		await D( 'charsDrawnAll', false );
		await step( 'wideWake', ()=>D( 'far', 1700, 800 ) );
		await D( 'far', 1100, 640 );
		await step( 'allAsleep', ()=>D( 'sleepAll', true ) );
		await D( 'sleepAll', false );
		await step( 'noEnemies', ()=>ev( ()=>{ let n = 0; for ( const c of pb2Character.characters.slice() ) if ( c && !( c.controller && c.controller.player_connection ) ) { try { c.ragdoll.remove(); n++; } catch ( e ) {} } return n; } ), 2500 );
		for ( const kind of [ 'towers', 'bridges', 'dressing', 'hills', 'ladders', 'consoles', 'lights', 'beacons' ] )
		{
			await step( 'noEnemies-' + kind, ()=>D( 'setsOf', kind, false ) );
			await D( 'setsOf', kind, true );
		}
		await step( 'noEnemies-noSets', ()=>D( 'sets', false ) );
		await D( 'sets', true );
		await step( 'noEnemies-halfRes', ()=>ev( ()=>pb2_mp.XM.renderer.setPixelRatio( pb2_mp.XM.renderer.getPixelRatio() / 2 ) ) );
		out.mod = await ev( ()=>( { status: window.__csTower.status, error: window.__csTower.error } ) );
	}
	catch ( e ) { out.failed = ( out.failed ? out.failed + '; ' : '' ) + String( e && e.stack || e ).slice( 0, 900 ); log( 'FAILED', out.failed ); }
	fs.writeFileSync( path.join( OUT, LEVEL + '-perf-matrix.json' ), JSON.stringify( out, null, 1 ) );
	await ctx.close();
} )();
