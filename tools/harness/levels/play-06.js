// 06 · Underhang, played: node levels/play-06.js
// Loads the level in the Level Editor and shoots it there, flat and in the editor's 2.5D angled view (what holding Alt
// and dragging does: the editor camera turned about its x and y axes). Then plays it as tester and checks, one test at
// a time (a failed test is reported, the rest still run):
//   ladders   out of the water up onto a pier cap; up a leg's shaft from the cap through the deck to the road; back down
//   boat      aboard at the dock, the whole underpass east (the auto-gunner deals with the patrols), under every cap,
//             then back west; how far the patrols moved under their autopilot
//   objective the extraction locked; the command room's console held for its 5 s; the extraction then open
//   tower     up the tower's shaft from the lobby to the command room and the observation deck
//   tank      into the CS-2 Bastion in the vehicle bay, driven along the deck
//   respawn   killed on the deck (god mode off for it): back at the last checkpoint, standing
//   frames    frame times throughout; page and map errors; the mod's own error
// The player is kept alive (god mode): this pass checks the level works, not how hard it is. Screenshots and
// levels/results/06-report.json come out.
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const { LABKIT } = require( '../labkit' );
const { shoot, release } = require( '../shots' );
const OUT = path.join( __dirname, 'results' );
const log = ( ...a )=>console.log( new Date().toISOString().slice( 11, 19 ), ...a );

( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	for ( const f of fs.readdirSync( OUT ) ) if ( /^06-.*\.png$/.test( f ) ) fs.unlinkSync( path.join( OUT, f ) );
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	const report = { level: '06', tests: {}, shots: [], errors: [], at: new Date().toISOString() };
	page.on( 'pageerror', ( e )=>{ if ( !/pb2Settings is not defined|AppendSoundsArray/.test( e.message ) && report.errors.length < 12 ) report.errors.push( ( e.stack || e.message ).slice( 0, 800 ) ); } );
	const ev = ( fn, ...a )=>page.evaluate( fn, ...a );
	const shot = async ( name, spot )=>{ const f = path.join( OUT, '06-' + name + '.png' ); if ( spot ) await shoot( page, f, spot ); else await page.screenshot( { path: f } ); report.shots.push( name ); };
	const test = async ( name, fn )=>
	{
		const t0 = Date.now();
		try { const r = await fn(); report.tests[ name ] = Object.assign( { ok: !!( r && r.ok ) }, r, { ms: Date.now() - t0 } ); }
		catch ( e ) { report.tests[ name ] = { ok: false, failed: String( e && e.stack || e ).slice( 0, 900 ), ms: Date.now() - t0 }; await page.screenshot( { path: path.join( OUT, '06-failed-' + name + '.png' ) } ).catch( ()=>{} ); }
		log( name, JSON.stringify( report.tests[ name ] ).slice( 0, 600 ) );
	};
	try
	{
		await openEditor( page );
		report.objects = await importLevel( page, '06' );
		await page.waitForTimeout( 5000 );

		// ---- the editor: flat, then the 2.5D angled views (Alt + drag) ----
		await test( 'editor', async ()=>
		{
			const view = ( x, y, zoom, pitch, yaw )=>ev( ( [ x, y, zoom, pitch, yaw ] )=>
			{
				const c = pb2_mp.my_controller;
				c.camera_position_forced = false; c.cam_x = x; c.cam_y = y; c.zoom = zoom;
				try { c.StartZoomMorph( zoom, 0.01, pb2_mp.FUNCTION_LINEAR ); } catch ( e ) { /* no morph: set directly */ }
				pb2_mp.cS.rotation.set( pitch, yaw, 0 ); pb2_mp.Bf.rotation.set( pitch, yaw, 0 );
				// (the mouse in the middle: the editor slides its panels away)
				const cv = pb2_mp.renderer.domElement.getBoundingClientRect();
				pb2_mp.screen_mouse_x = cv.left + cv.width / 2; pb2_mp.screen_mouse_y = cv.top + cv.height / 2;
			}, [ x, y, zoom, pitch, yaw ] );
			const views = [ [ 'ed-flat-middle', 7500, -700, 0.42, 0, 0 ], [ 'ed-alt-left', 6200, -600, 0.5, -0.12, 0.42 ], [ 'ed-alt-right', 8800, -600, 0.5, -0.12, -0.42 ],
				[ 'ed-alt-under', 7500, -300, 0.62, 0.22, 0.3 ], [ 'ed-alt-tower', 7500, -1300, 0.6, -0.2, -0.3 ], [ 'ed-flat-whole', 7500, -700, 0.24, 0, 0 ] ];
			const got = [];
			for ( const [ name, x, y, z, p, yw ] of views )
			{
				await view( x, y, z, p, yw );
				await page.waitForTimeout( 1800 );
				await shot( name );
				got.push( await ev( ()=>( { cam: [ Math.round( pb2_mp.cS.position.x ), Math.round( pb2_mp.cS.position.y ), Math.round( pb2_mp.cS.position.z ) ], rot: [ +pb2_mp.cS.rotation.x.toFixed( 2 ), +pb2_mp.cS.rotation.y.toFixed( 2 ) ], zoom: pb2_mp.my_controller.zoom } ) ) );
			}
			await view( 7500, -700, 1, 0, 0 );
			return { ok: true, views: got };
		} );

		await playTest( page );
		await page.evaluate( LABKIT );
		await ev( ()=>
		{
			const W = window.__watch = { frames: [], last: performance.now(), dmgBoat: 0 };
			const R = pb2Ragdoll.prototype, hurt = R._beb;
			R._beb = function( atom, dmg, ...rest ) { const ch = this.owner_character; if ( W.god !== false && dmg > 0 && ch && ch.controller && ch.controller.player_connection ) dmg = 0; return hurt.call( this, atom, dmg, ...rest ); };
			const aboard = ( e )=>Array.from( e.gO || [] ).some( ( r )=>r && r.owner_character && r.owner_character.controller && r.owner_character.controller.player_connection );
			const DD = pb2Entity.prototype.DealDamage;
			pb2Entity.prototype.DealDamage = function( dmg, ...rest ) { if ( ( this.type === pb2Entity.TYPE_BOAT || this.type === pb2Entity.TYPE_TANK ) && aboard( this ) ) { W.dmgBoat += dmg > 0 ? dmg : 0; dmg = 0; } return DD.call( this, dmg, ...rest ); };
			const tick = ()=>
			{
				requestAnimationFrame( tick );
				const now = performance.now(); W.frames.push( now - W.last ); if ( W.frames.length > 5000 ) W.frames.shift(); W.last = now;
				const me = __lab.me();
				if ( me && me.hea > 0 && W.god !== false ) { me.hmax = 150; me.hea = 150; }
				if ( W.gunner && me && me.hea > 0 )
				{
					let aim = null, bd = 1400;
					for ( const e of pb2Entity.entities ) { if ( !e || e.type !== pb2Entity.TYPE_BOAT || !( e.hea > 0 ) || e.is_being_removed || Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === me ) ) continue; if ( !Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character && s.owner_character.hea > 0 ) ) continue; const B = e.box2d_bodies[ 0 ], x = B.GetPosX() * 30, y = B.GetPosY() * 30; const d = Math.abs( x - me.x ); if ( d < bd ) { bd = d; aim = [ x, y - 40 ]; } }
					if ( !aim ) { const t = __lab.nearestEnemy( 1100 ); if ( t ) aim = [ t.x, t.y - 16 ]; }
					if ( aim ) { __lab.aimAt( aim[ 0 ], aim[ 1 ] ); __lab.trigger( true ); } else __lab.trigger( false );
				}
			};
			requestAnimationFrame( tick );
		} );
		const me = ()=>ev( ()=>{ const c = __lab.me(); if ( !c ) return null; const s = __lab.state(); return { x: Math.round( c.x ), y: Math.round( c.y ), feet: s ? Math.round( s.bot ) : null, vehicle: !!( c.ragdoll && c.ragdoll.driver_of ) }; } );
		const key = ( type, code )=>ev( ( [ t, c ] )=>__lab.key( t, c ), [ type, code ] );
		const hold = async ( code, ms )=>{ await key( 'keydown', code ); await page.waitForTimeout( ms ); await key( 'keyup', code ); };
		// put the player at (x, feet) standing, and let it settle
		const put = async ( x, feet, settle = 700 )=>{ await ev( ( [ x, y ] )=>{ const m = __lab.me(), v = m && m.ragdoll.driver_of; if ( v && v.ExcludeRagdoll ) v.ExcludeRagdoll( m.ragdoll, true ); __lab.teleport( x, y ); }, [ x, feet - 44 ] ); await page.waitForTimeout( settle ); return me(); };
		const L = await ev( ()=>window.__csTower.layouts[ '06' ] );
		const [ c1, c2, c3 ] = L.legs;
		await page.waitForTimeout( 2500 );
		await shot( 'play-start' );
		// the whole middle, pulled back: like the concept's side view
		for ( const [ name, x, y, z ] of [ [ 'overview-middle', 7500, -900, 2.9 ], [ 'overview-left', 5900, -560, 1.9 ], [ 'overview-right', 9200, -560, 1.9 ], [ 'overview-lane', 7500, -250, 1.45 ] ] ) await shot( name, { x, y, zoom: z, frames: 40 } );
		await release( page );

		// ---- ladders ----
		await test( 'ladders', async ()=>
		{
			const out = {};
			// out of the water beside cap 1's left end, up, then right onto the cap
			let p = await put( c1 - L.cap.half - 20, 30, 900 );
			out.inWater = p;
			await key( 'keydown', 'KeyW' ); await page.waitForTimeout( 2600 );
			out.climbedTo = await me();
			await key( 'keydown', 'KeyD' ); await page.waitForTimeout( 500 ); await key( 'keyup', 'KeyW' ); await page.waitForTimeout( 400 ); await key( 'keyup', 'KeyD' );
			await page.waitForTimeout( 700 );
			out.onCap = await me();
			const capOk = out.onCap && Math.abs( out.onCap.feet - L.cap.top ) < 12 && out.onCap.x > c1 - L.cap.half;
			await shot( 'ladder-cap' );
			// up the shaft: from the cap at the shaft, W held, through the deck to the road, then off to the right
			p = await put( c1 + L.shaft, L.cap.top, 800 );
			await key( 'keydown', 'KeyW' );
			const samples = [];
			for ( let i = 0; i < 12; i++ ) { await page.waitForTimeout( 350 ); samples.push( ( await me() ).feet ); }
			out.shaftTop = await me();
			await shot( 'ladder-shaft' );
			await key( 'keydown', 'KeyD' ); await page.waitForTimeout( 450 ); await key( 'keyup', 'KeyW' ); await page.waitForTimeout( 300 ); await key( 'keyup', 'KeyD' );
			await page.waitForTimeout( 800 );
			out.onRoad = await me();
			out.shaftSamples = samples;
			const roadOk = out.onRoad && Math.abs( out.onRoad.feet - L.road ) < 12;
			// back down: from the road over the hatch, S held, down to the deck floor or the cap
			await put( c1 + L.shaft, L.road, 600 );
			await key( 'keydown', 'KeyS' ); await page.waitForTimeout( 1800 ); await key( 'keyup', 'KeyS' );
			await page.waitForTimeout( 900 );
			out.down = await me();
			const downOk = out.down && out.down.feet > L.floor - 20;
			return { ok: capOk && roadOk && downOk, capOk, roadOk, downOk, ...out };
		} );

		// ---- the command room: the extraction locked, the console held, the extraction open ----
		await test( 'objective', async ()=>
		{
			const T = L.tower;
			await put( L.bridge[ 1 ] - 100, L.road, 1200 );
			const lockedFirst = await ev( ()=>!window.__csTower.complete );
			const bannerLocked = await ev( ()=>window.__csTower.lastBanner );
			await put( T.x0 + 300, T.l2, 400 );
			await page.waitForTimeout( 6500 );
			await shot( 'command-room' );
			const objectives = await ev( ()=>window.__csTower.objectives );
			const bannerDone = await ev( ()=>window.__csTower.lastBanner );
			await put( L.bridge[ 1 ] - 100, L.road, 1500 );
			const complete = await ev( ()=>window.__csTower.complete );
			await shot( 'extraction' );
			return { ok: lockedFirst && !!objectives && objectives.every( ( v )=>v >= 100 ) && complete, lockedFirst, bannerLocked, objectives, bannerDone, complete };
		} );

		// ---- the tower: from the lobby up its shaft to the command room, then on to the observation deck ----
		// (W held until the feet are above the floor aimed at, then A: off the ladder onto that floor)
		const climb = async ( x, fromFeet, toFeet, side )=>
		{
			await put( x, fromFeet, 700 );
			await key( 'keydown', 'KeyW' );
			let p = null;
			for ( let i = 0; i < 30; i++ ) { await page.waitForTimeout( 200 ); p = await me(); if ( p && p.feet <= toFeet - 25 ) break; }
			await key( 'keydown', side ); await page.waitForTimeout( 450 ); await key( 'keyup', 'KeyW' ); await page.waitForTimeout( 300 ); await key( 'keyup', side );
			await page.waitForTimeout( 900 );
			const end = await me();
			return { top: p, end, ok: !!end && Math.abs( end.feet - toFeet ) < 12 };
		};
		await test( 'tower', async ()=>
		{
			const T = L.tower;
			const a = await climb( T.shaft, L.road, T.l2, 'KeyA' );
			await shot( 'tower-l2' );
			const b = await climb( T.shaft, T.l2, T.l3, 'KeyA' );
			await shot( 'tower-l3' );
			return { ok: a.ok && b.ok, l2: a.ok, l3: b.ok, a, b };
		} );

		// ---- the tank in the vehicle bay ----
		await test( 'tank', async ()=>
		{
			const tank = ()=>ev( ()=>{ const t = pb2Entity.entities.filter( ( e )=>e && e.type === pb2Entity.TYPE_TANK && !e.is_being_removed ).map( ( e )=>( { x: Math.round( e.box2d_bodies[ 0 ].GetPosX() * 30 ), y: Math.round( e.box2d_bodies[ 0 ].GetPosY() * 30 ), style: e.style_id, hea: Math.round( e.hea ) } ) ); return t; } );
			const before = await tank();
			const bastion = before.slice().sort( ( a, b )=>a.x - b.x )[ 0 ];
			if ( !bastion ) return { ok: false, why: 'no tank', before };
			await put( bastion.x - 120, L.floor, 800 );
			for ( let i = 0; i < 4 && !( await me() ).vehicle; i++ ) { await hold( 'KeyE', 200 ); await page.waitForTimeout( 700 ); }
			const inside = ( await me() ).vehicle;
			await hold( 'KeyA', 1800 );
			const after = await tank();
			await shot( 'tank' );
			const moved = after.length && Math.abs( after.slice().sort( ( a, b )=>a.x - b.x )[ 0 ].x - bastion.x ) > 60;
			if ( inside ) { await hold( 'KeyE', 200 ); await page.waitForTimeout( 800 ); }
			return { ok: !!inside && !!moved, inside, moved, before, after };
		} );

		// ---- the boat: the whole underpass ----
		await test( 'boat', async ()=>
		{
			await put( 4640, -48, 900 );
			const aboardNow = ()=>ev( ()=>{ const m = __lab.me(); const b = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === m ) ); if ( !b ) return null; const B = b.box2d_bodies[ 0 ]; return { x: Math.round( B.GetPosX() * 30 ), y: Math.round( B.GetPosY() * 30 ), hea: Math.round( b.hea ) }; } );
			for ( let i = 0; i < 6 && !( await aboardNow() ); i++ ) { await hold( 'KeyE', 200 ); await page.waitForTimeout( 800 ); if ( i === 2 ) await hold( 'KeyD', 300 ); }
			const start = await aboardNow();
			if ( !start ) return { ok: false, why: 'could not board' };
			// (the patrols as they start: how far each gets from there)
			await ev( ()=>{ window.__patrols = pb2Entity.entities.filter( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed && !Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === __lab.me() ) ).map( ( e )=>( { e, x0: e.box2d_bodies[ 0 ].GetPosX() * 30, max: 0 } ) ); } );
			const patrolTick = ()=>ev( ()=>{ for ( const p of window.__patrols ) if ( !p.e.is_being_removed && p.e.box2d_bodies && p.e.box2d_bodies[ 0 ] ) p.max = Math.max( p.max, Math.abs( p.e.box2d_bodies[ 0 ].GetPosX() * 30 - p.x0 ) ); } );
			await shot( 'boat-aboard' );
			await ev( ()=>{ window.__watch.gunner = true; } );
			await key( 'keydown', 'KeyD' );
			const marks = [ [ c1 - 100, 'lane-cap1' ], [ ( c1 + c2 ) / 2, 'lane-bay1' ], [ c2 - 100, 'lane-cap2' ], [ ( c2 + c3 ) / 2, 'lane-bay2' ], [ c3 - 100, 'lane-cap3' ] ];
			const done = new Set(), track = [];
			let lastX = start.x, still = 0, stuck = null, lost = false;
			const t0 = Date.now();
			while ( Date.now() - t0 < 200000 )
			{
				await page.waitForTimeout( 1000 );
				const b = await aboardNow();
				if ( !b ) { lost = true; break; }
				track.push( b.x );
				await patrolTick();
				for ( const [ mx, name ] of marks ) if ( b.x >= mx && !done.has( name ) ) { done.add( name ); await shot( name ); }
				if ( b.x >= L.bridge[ 1 ] - 450 ) break;
				if ( Math.abs( b.x - lastX ) < 15 ) { if ( ++still >= 8 ) { stuck = b; break; } } else still = 0;
				lastX = b.x;
			}
			await key( 'keyup', 'KeyD' );
			const east = await aboardNow();
			// (and back: A held, west under the caps)
			let west = east ? east.x : null;
			if ( east )
			{
				await key( 'keydown', 'KeyA' );
				for ( let i = 0; i < 40; i++ ) { await page.waitForTimeout( 1000 ); const b = await aboardNow(); if ( !b ) break; west = Math.min( west, b.x ); await patrolTick(); if ( east.x - west >= 1800 ) break; }
				await key( 'keyup', 'KeyA' );
			}
			await ev( ()=>{ window.__watch.gunner = false; __lab.trigger( false ); } );
			const end = east;
			const patrolsMoved = await ev( ()=>window.__patrols.filter( ( p )=>p.max >= 200 ).length );
			const returned = east && west !== null ? east.x - west : 0;
			const patrols = await ev( ()=>pb2Entity.entities.filter( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed ).map( ( e )=>( { x: Math.round( e.box2d_bodies[ 0 ].GetPosX() * 30 ), hea: Math.round( e.hea ), crew: Array.from( e.gO || [] ).filter( ( s )=>s && s.owner_character ).length } ) ) );
			const reached = end ? end.x : track[ track.length - 1 ];
			// (out of the boat again, wherever it is)
			if ( await aboardNow() ) { await hold( 'KeyE', 200 ); await page.waitForTimeout( 800 ); }
			return { ok: !lost && !stuck && reached >= L.bridge[ 1 ] - 460, start: start.x, reached, returned, patrolsMoved, lost, stuck, passedCaps: [ ...done ], track: track.filter( ( x, i )=>i % 3 === 0 ), patrols, boatDamageBlocked: Math.round( await ev( ()=>window.__watch.dmgBoat ) ) };
		} );

		// ---- the layers, at eye level ----
		for ( const [ name, x, feet ] of [ [ 'eye-cap2', c2 - 300, L.cap.top ], [ 'eye-interior-security', 6500, L.floor ], [ 'eye-interior-bay', 8400, L.floor ], [ 'eye-road-tower', 6900, L.road ], [ 'eye-observation', L.tower.x0 + 200, L.tower.l3 ] ] )
		{
			await put( x, feet, 1500 );
			await shot( name );
		}

		// ---- dying on the deck, coming back ----
		await test( 'respawn', async ()=>
		{
			await put( 6000, L.floor, 800 );
			const cp = await ev( ()=>window.__csTower.checkpoint );
			await ev( ()=>{ window.__watch.god = false; const m = __lab.me(); m.hea = -50; } );
			let gone = false, back = null;
			for ( let i = 0; i < 24; i++ )
			{
				await page.waitForTimeout( 500 );
				const m = await me();
				if ( !m ) gone = true;
				else if ( gone ) { back = m; break; }
			}
			await ev( ()=>{ window.__watch.god = true; } );
			if ( back ) { await page.waitForTimeout( 1500 ); back = await me(); }
			await shot( 'respawned' );
			const standing = !!back && await ev( ()=>{ const s = __lab.state(); return !!s && Math.abs( s.vy ) < 60; } );
			return { ok: gone && !!back && standing, gone, back, standing, checkpoint: cp, respawns: await ev( ()=>window.__csTower.respawns ) };
		} );

		// ---- frame times, errors ----
		await test( 'frames', async ()=>
		{
			const f = await ev( ()=>window.__watch.frames.slice() );
			const s = f.slice().sort( ( a, b )=>a - b );
			const q = ( k )=>s.length ? +s[ Math.min( s.length - 1, Math.floor( s.length * k ) ) ].toFixed( 1 ) : null;
			const mod = await ev( ()=>( { status: window.__csTower.status, error: window.__csTower.error } ) );
			const mapErrors = await ev( ()=>( pb2GameWorld.errors || [] ).length );
			return { ok: !mod.error && !mapErrors && report.errors.length === 0, samples: s.length, median: q( 0.5 ), p95: q( 0.95 ), worst: q( 1 ) === null ? null : +s[ s.length - 1 ].toFixed( 1 ), mod, mapErrors, pageErrors: report.errors.length };
		} );
		report.entities = await ev( ()=>( { characters: pb2Character.characters.length, entities: pb2Entity.entities.length } ) );
	}
	catch ( e ) { report.failed = String( e && e.stack || e ).slice( 0, 1200 ); log( 'FAILED', report.failed ); await page.screenshot( { path: path.join( OUT, '06-failed.png' ) } ).catch( ()=>{} ); }
	report.passed = Object.keys( report.tests ).filter( ( k )=>report.tests[ k ].ok );
	report.ok = !report.failed && [ 'editor', 'ladders', 'objective', 'tower', 'tank', 'boat', 'respawn', 'frames' ].every( ( k )=>report.tests[ k ] && report.tests[ k ].ok );
	fs.writeFileSync( path.join( OUT, '06-report.json' ), JSON.stringify( report, null, 1 ) );
	log( 'report:', JSON.stringify( { ok: report.ok, passed: report.passed, errors: report.errors.length } ) );
	await ctx.close();
} )();
