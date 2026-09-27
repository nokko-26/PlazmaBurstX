// 01 · Approach, played through: node levels/play-01.js [--mortal]
// Loads the level in the editor, plays it as tester, and takes the route a player takes: along the pontoon, aboard the
// boat (E), east under the three arches past the patrol boats, onto the shore pontoon, up the steps, across the quay to
// the exit. By default the player (and the boat) are kept at full health: this pass checks the route — nothing stuck,
// the boat fits under every arch and can leave, the steps climb, the exit counts — and logs the damage each stretch
// would have done. --mortal plays it for real. Screenshots (overview, eye line, each tier, the lane) and a report go to
// levels/results/.
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const { LABKIT } = require( '../labkit' );
const { shoot, release } = require( '../shots' );
const OUT = path.join( __dirname, 'results' );
const mortal = process.argv.includes( '--mortal' );
const PRE = mortal ? '01-mortal-' : '01-';                                  // (a mortal run's files beside the route's)
const log = ( ...a )=>console.log( new Date().toISOString().slice( 11, 19 ), ...a );

( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	const report = { mortal, steps: [], shots: [], errors: [] };
	page.on( 'pageerror', ( e )=>{ if ( !/pb2Settings is not defined|AppendSoundsArray/.test( e.message ) && report.errors.length < 8 ) report.errors.push( ( e.stack || e.message ).slice( 0, 800 ) ); } );
	const ev = ( fn, ...a )=>page.evaluate( fn, ...a );
	const step = ( name, data )=>{ report.steps.push( Object.assign( { name }, data ) ); log( name, JSON.stringify( data ) ); };
	const shot = async ( name, spot )=>{ const f = path.join( OUT, PRE + name + '.png' ); if ( spot ) await shoot( page, f, spot ); else await page.screenshot( { path: f } ); report.shots.push( name ); };
	try
	{
		await openEditor( page );
		await importLevel( page, '01' );
		await playTest( page );
		await page.evaluate( LABKIT );
		// the watcher: god mode (unless mortal), damage taken, frame times, the boat, the patrols
		await ev( ( mortal )=>
		{
			const W = window.__watch = { dmg: 0, dmgBoat: 0, frames: [], last: performance.now(), zone: 'start', byZone: {}, bigHits: [] };
			// the boat's death: who called it
			try
			{
				const C = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT ).constructor;
				for ( const k of [ '_bsy', '_eTJ', 'Kill', 'remove' ] )
				{
					const o = C.prototype[ k ];
					if ( typeof o !== 'function' ) continue;
					C.prototype[ k ] = function() { if ( !W.deaths ) W.deaths = []; const bx = this.box2d_bodies && this.box2d_bodies[ 0 ] ? Math.round( this.box2d_bodies[ 0 ].GetPosX() * 30 ) : null; if ( W.deaths.length < 30 && bx !== null && bx < 3000 + 99999 && !this.is_being_removed ) W.deaths.push( { k, x: bx, hea: this.hea, stack: new Error().stack.split( '\n' ).slice( 2, 12 ).join( ' < ' ).replace( /\(?(chrome-extension|https?):[^)]*\//g, '' ).slice( 0, 900 ) } ); return o.apply( this, arguments ); };
				}
			}
			catch ( e ) { W.deathHookError = String( e ); }
			// god mode: a player's limbs take no damage (what they'd have taken is counted, the big hits noted by source)
			if ( !mortal )
			{
				const R = pb2Ragdoll.prototype, hurt = R._beb;
				R._beb = function( atom, dmg, ...rest )
				{
					const ch = this.owner_character;
					if ( dmg > 0 && ch && ch.controller && ch.controller.player_connection )
					{
						W.blocked = ( W.blocked || 0 ) + dmg;
						const by = rest[ 1 ], who = by && by.name && by.name.text !== undefined ? String( by.name.text ) : by && by.owner_character && by.owner_character.ragdoll ? String( by.owner_character.ragdoll.name && by.owner_character.ragdoll.name.text ) : by ? String( by.constructor && by.constructor.name ) : null;
						if ( dmg >= 40 && ( W.playerHits || ( W.playerHits = [] ) ).length < 16 ) W.playerHits.push( { dmg: Math.round( dmg ), zone: W.zone, x: Math.round( ch.x ), by: who } );
						dmg = 0;
					}
					return hurt.call( this, atom, dmg, ...rest );
				};
			}
			// big hits on boats: what, by whom, from where; and god mode for the players' boat (unless mortal): its damage
			// is stopped where it comes in, before any of its parts can break (a critical part broken in one hit — a
			// rocket — sinks it at the next, whatever its health)
			const aboard = ( e )=>Array.from( e.gO || [] ).some( ( r )=>r && r.owner_character && r.owner_character.controller && r.owner_character.controller.player_connection );
			const shield = ( e, dmg )=>{ if ( mortal || !( dmg > 0 ) || e.type !== pb2Entity.TYPE_BOAT || !aboard( e ) ) return dmg; W.dmgBoat += dmg; return 0; };
			const DD = pb2Entity.prototype.DealDamage;
			pb2Entity.prototype.DealDamage = function( dmg, x, y, cause, attacker, ...rest )
			{
				if ( this.type === pb2Entity.TYPE_BOAT && dmg > 100 && W.bigHits.length < 12 )
					W.bigHits.push( { dmg: Math.round( dmg ), hea: Math.round( this.hea ), x: Math.round( x ), y: Math.round( y ), cause: String( cause ).slice( 0, 40 ), by: attacker ? String( ( attacker.ragdoll && attacker.ragdoll.name && attacker.ragdoll.name.text ) || attacker.constructor && attacker.constructor.name || attacker ).slice( 0, 40 ) : null, stack: new Error().stack.split( '\n' ).slice( 2, 7 ).join( ' < ' ).replace( /https?:[^)]*\//g, '' ).slice( 0, 400 ) } );
				return DD.call( this, shield( this, dmg ), x, y, cause, attacker, ...rest );
			};
			try
			{
				const C = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT ).constructor, own = C.prototype.DealDamage;
				C.prototype.DealDamage = function( dmg, ...rest ) { return own.call( this, shield( this, dmg ), ...rest ); };
			}
			catch ( e ) { W.shieldHookError = String( e ); }
			const tick = ()=>
			{
				requestAnimationFrame( tick );
				const now = performance.now(); W.frames.push( now - W.last ); if ( W.frames.length > 600 ) W.frames.shift(); W.last = now;
				const me = __lab.me();
				if ( me && me.hea > 0 )
				{
					const lost = Math.max( 0, 150 - me.hea );
					if ( lost > 0 ) { W.dmg += lost; W.byZone[ W.zone ] = ( W.byZone[ W.zone ] || 0 ) + lost; if ( !mortal ) { me.hmax = 150; me.hea = 150; } }
				}
				const boat = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed && Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === me ) );
				// the auto-gunner: at the nearest enemy, trigger held
				if ( W.gunner && me && me.hea > 0 )
				{
					// (a patrol boat's hull first — its crew ride inside it — then soldiers)
					let aim = null, bd = 1400;
					for ( const e of pb2Entity.entities ) { if ( !e || e.type !== pb2Entity.TYPE_BOAT || !( e.hea > 0 ) || e.is_being_removed || Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === me ) ) continue; const B = e.box2d_bodies[ 0 ], x = B.GetPosX() * 30, y = B.GetPosY() * 30; if ( !Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character && s.owner_character.hea > 0 ) ) continue; const d = Math.abs( x - me.x ); if ( d < bd ) { bd = d; aim = [ x, y - 40 ]; } }
					if ( !aim ) { const t = __lab.nearestEnemy( 1400 ); if ( t ) aim = [ t.x, t.y - 16 ]; }
					if ( aim ) { __lab.aimAt( aim[ 0 ], aim[ 1 ] ); __lab.trigger( true ); } else __lab.trigger( false );
				}
				const preHea = boat ? boat.hea : null;
				// (a vehicle's parts have health of their own — a critical one gone kills it outright: kept full too)
				if ( boat && !mortal )
				{
					if ( !W.full || W.full.boat !== boat ) W.full = { boat, hea: boat.hea, parts: Array.from( boat.hG || [] ) };
					if ( boat.hea < W.full.hea ) { W.dmgBoat += W.full.hea - boat.hea; boat.hea = W.full.hea; }
					if ( boat.hG ) for ( let i = 0; i < W.full.parts.length; i++ ) if ( boat.hG[ i ] > 0 && boat.hG[ i ] < W.full.parts[ i ] ) boat.hG[ i ] = W.full.parts[ i ];     // (never a part that broke: breaking it twice throws)
				}
				// the boat's last moments, frame by frame
				if ( boat ) { const B = boat.box2d_bodies[ 0 ], v = B.GetLinearVelocity(); ( W.hist || ( W.hist = [] ) ).push( [ Math.round( now ), Math.round( B.GetPosX() * 30 ), Math.round( B.GetPosY() * 30 ), Math.round( preHea ), +B.GetAngle().toFixed( 2 ), Math.round( v.x * 30 ), Math.round( v.y * 30 ) ] ); if ( W.hist.length > 90 ) W.hist.shift(); W.boatId = boat; }
				else if ( W.boatId && !W.lostInfo ) { const b = W.boatId; W.lostInfo = { hea: b.hea, removed: !!b.is_being_removed, inList: pb2Entity.entities.indexOf( b ) !== -1, x: b.box2d_bodies && b.box2d_bodies[ 0 ] ? Math.round( b.box2d_bodies[ 0 ].GetPosX() * 30 ) : null, meSeat: me ? String( me.driver_of || me.bpg || '' ).slice( 0, 30 ) : 'no me', meHea: me ? me.hea : null }; }
			};
			requestAnimationFrame( tick );
		}, mortal );
		const me = ()=>ev( ()=>{ const c = __lab.me(); return c ? { x: Math.round( c.x ), y: Math.round( c.y ), hea: Math.round( c.hea ) } : null; } );
		const zone = ( z )=>ev( ( z )=>{ window.__watch.zone = z; }, z );
		const fps = ()=>ev( ()=>{ const f = window.__watch.frames.slice( -120 ), m = f.reduce( ( a, b )=>a + b, 0 ) / f.length; return { msPerFrame: Math.round( m ), worst: Math.round( Math.max( ...f ) ) }; } );
		const key = ( type, code )=>ev( ( [ t, c ] )=>__lab.key( t, c ), [ type, code ] );
		const hold = async ( code, ms )=>{ await key( 'keydown', code ); await page.waitForTimeout( ms ); await key( 'keyup', code ); };

		// ---- the overview: the whole level, pulled back ----
		await page.waitForTimeout( 3000 );
		await shot( 'eye-start' );
		for ( const [ name, x, y, z ] of [ [ 'overview-start', 1000, -300, 3.2 ], [ 'overview-arches', 4300, -350, 4.2 ], [ 'overview-shore', 8300, -350, 3.2 ], [ 'overview-tower', 9000, -700, 1.6 ] ] ) await shot( name, { x, y, zoom: z, frames: 40 } );
		await release( page );
		await page.waitForTimeout( 1500 );

		// ---- along the pontoon to the boat, aboard ----
		await zone( 'pontoon' );
		await hold( 'KeyD', 1500 );
		let p = await me();
		step( 'walked the pontoon', p );
		// (at the pontoon's end: the boat within 220 px — E boards it)
		for ( let i = 0; i < 6; i++ )
		{
			const aboard = await ev( ()=>{ const m = __lab.me(); return pb2Entity.entities.some( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === m ) ); } );
			if ( aboard ) break;
			await hold( 'KeyE', 200 );
			await page.waitForTimeout( 800 );
			if ( i === 2 ) await hold( 'KeyD', 400 );
		}
		const aboard = await ev( ()=>{ const m = __lab.me(); const b = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === m ) ); return b ? { seat: ( ()=>{ const g = Array.from( b.gO || [] ); for ( let i = 0; i < g.length; i++ ) if ( g[ i ] && g[ i ].owner_character === m ) return i; return -1; } )(), x: Math.round( b.box2d_bodies[ 0 ].GetPosX() * 30 ) } : null; } );
		step( 'boarded', { aboard } );
		if ( !aboard ) throw new Error( 'could not board the boat' );
		await shot( 'eye-aboard' );

		// ---- east: hold D, watch the boat, shoot back; screenshots under each arch and in the open ----
		await zone( 'lane' );
		await ev( ()=>{ window.__watch.gunner = true; } );
		await key( 'keydown', 'KeyD' );
		const boatPos = ()=>ev( ()=>{ const m = __lab.me(); const b = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === m ) ); if ( !b ) return null; const B = b.box2d_bodies[ 0 ]; return { x: Math.round( B.GetPosX() * 30 ), y: Math.round( B.GetPosY() * 30 ), hea: Math.round( b.hea ) }; } );
		const marks = [ [ 2700, 'lane-arch-a', 'arch A' ], [ 4050, 'lane-reef', 'reef' ], [ 5000, 'lane-arch-b', 'arch B' ], [ 6500, 'lane-arch-c', 'arch C' ], [ 7200, 'lane-shore', 'shore' ] ];
		let lastX = -1, still = 0, t0 = Date.now(), done = new Set();
		const track = [];
		while ( Date.now() - t0 < 240000 )
		{
			await page.waitForTimeout( 1000 );
			const b = await boatPos();
			if ( !b ) { step( 'lost the boat', Object.assign( await me(), { deaths: await ev( ()=>window.__watch.deaths || window.__watch.deathHookError ), scuttled: await ev( ()=>window.__csTower.scuttled ), bigHits: await ev( ()=>window.__watch.bigHits ), info: await ev( ()=>window.__watch.lostInfo ), last: await ev( ()=>window.__watch.hist.slice( -14 ) ) } ) ); await shot( 'lost-boat' ); break; }
			track.push( b );
			for ( const [ mx, name, z ] of marks ) if ( b.x >= mx && !done.has( name ) ) { done.add( name ); await zone( z ); await shot( name ); step( 'passed ' + z, Object.assign( { fps: await fps() }, b ) ); }
			if ( b.x >= 7300 ) break;                                         // (docked: its bow at the landing pontoon)
			if ( Math.abs( b.x - lastX ) < 15 ) { if ( ++still >= 6 )
			{
				// (what's in front of the bow: every physics body within 300 px ahead)
				const ahead = await ev( ( bx )=>
				{
					const out = [];
					for ( let body = pb2_mp.world.GetBodyList(); body; body = body.GetNext() )
					{
						const x = body.GetPosX() * 30, y = body.GetPosY() * 30;
						if ( x < bx + 120 || x > bx + 520 || y < -200 || y > 200 ) continue;
						const u = body.GetUserData && body.GetUserData(); let fx = 0; for ( let f = body.GetFixtureList(); f; f = f.GetNext() ) fx++;
						out.push( { x: Math.round( x ), y: Math.round( y ), type: body.GetType(), fx, mass: +body.GetMass().toFixed( 2 ), user: u ? String( u.constructor && u.constructor.name || typeof u ).slice( 0, 30 ) : null } );
					}
					return out.slice( 0, 20 );
				}, b.x );
				step( 'boat stuck', Object.assign( { ahead }, b ) ); await shot( 'boat-stuck' ); break;
			} } else still = 0;
			lastX = b.x;
		}
		await key( 'keyup', 'KeyD' );
		report.boatTrack = track;
		step( 'patrol boats', await ev( ()=>pb2Entity.entities.filter( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed ).map( ( e )=>( { x: Math.round( e.box2d_bodies[ 0 ].GetPosX() * 30 ), hea: Math.round( e.hea ), crew: Array.from( e.gO || [] ).filter( ( s )=>s && s.owner_character ).length } ) ) ) );

		// ---- ashore: out of the boat (E), onto the pontoon, up the steps, along the quay to the exit ----
		await zone( 'landing' );
		await hold( 'KeyE', 200 );
		await page.waitForTimeout( 1200 );
		step( 'left the boat', await me() );
		await shot( 'tier-landing', { x: 7620, y: -170, zoom: 1.25, frames: 20 } ); await release( page );
		await key( 'keydown', 'KeyD' );
		let reached = false, swimming = false;
		t0 = Date.now(); lastX = -1; still = 0;
		while ( Date.now() - t0 < 180000 )
		{
			await page.waitForTimeout( 700 );
			let m = await me();
			if ( !m )
			{
				// (dead: the mod brings you back after 5 s — at the last checkpoint)
				step( 'died', { at: await ev( ()=>window.__csTower.checkpoint ), host: await ev( ()=>window.__csTower.host ) } );
				await key( 'keyup', 'KeyD' );
				for ( let i = 0; i < 20 && !m; i++ ) { await page.waitForTimeout( 1000 ); m = await me(); if ( i % 5 === 4 ) step( 'waiting', { host: await ev( ()=>window.__csTower.host ), respawns: await ev( ()=>window.__csTower.respawns ), err: await ev( ()=>window.__csTower.error ), ctl: await ev( ()=>{ const k = pb2Controller.controllers.find( ( k )=>k && k.player_connection === pb2GameWorld ); return k ? ( k.character ? 'char hea ' + Math.round( k.character.hea ) : 'no char' ) : 'no controller'; } ) } ); }
				step( 'back', m || {} );
				if ( !m ) break;
				// (back aboard a boat — the team's, or a new one at the berth: out of it first)
				if ( await ev( ()=>{ const c = __lab.me(); return !!( c && c.ragdoll.driver_of ); } ) ) { await hold( 'KeyE', 200 ); await page.waitForTimeout( 900 ); step( 'out of the boat', await me() ); }
				await key( 'keydown', 'KeyD' );
				report.respawned = ( report.respawned || 0 ) + 1;
				if ( report.respawned > 4 ) break;
			}
			if ( m.x > 7560 && m.x < 7900 && !done.has( 'steps' ) ) { done.add( 'steps' ); await shot( 'tier-steps' ); }
			if ( m.x > 7950 && !done.has( 'quay' ) ) { done.add( 'quay' ); await zone( 'quay' ); await shot( 'tier-quay' ); step( 'on the quay', Object.assign( { fps: await fps() }, m ) ); }
			// (in the water: W held, as a player swims up and climbs out; stuck against something: a jump)
			if ( m.y > -5 !== swimming ) { swimming = m.y > -5; await key( swimming ? 'keydown' : 'keyup', 'KeyW' ); if ( swimming ) report.swam = ( report.swam || 0 ) + 1; }
			if ( Math.abs( m.x - lastX ) < 6 ) { still++; if ( still % 3 === 2 && !swimming ) await hold( 'KeyW', 150 ); if ( still > 14 ) { step( 'stuck ashore', m ); break; } } else still = 0;
			lastX = m.x;
			if ( await ev( ()=>window.__csTower.complete ) ) { reached = true; break; }
		}
		await key( 'keyup', 'KeyD' ); await key( 'keyup', 'KeyW' );
		await page.waitForTimeout( 1500 );
		await shot( 'exit' );
		step( 'exit', { reached, complete: await ev( ()=>window.__csTower.complete ), banner: await ev( ()=>window.__csTower.lastBanner ), at: await me() } );
		report.watch = await ev( ()=>( { dmg: Math.round( window.__watch.dmg ), blocked: Math.round( window.__watch.blocked || 0 ), dmgBoat: Math.round( window.__watch.dmgBoat ), byZone: window.__watch.byZone, playerHits: window.__watch.playerHits || [] } ) );
		report.tower = await ev( ()=>( { status: window.__csTower.status, error: window.__csTower.error, coop: window.__csTower.coop, checkpoint: window.__csTower.checkpoint, respawns: window.__csTower.respawns } ) );
		report.enemies = await ev( ()=>pb2Character.characters.filter( ( c )=>c && !c.controller.player_connection ).map( ( c )=>( { name: String( ( c.ragdoll.name || {} ).text || '' ), x: Math.round( c.x ), y: Math.round( c.y ), hea: Math.round( c.hea ) } ) ) );
	}
	catch ( e ) { report.failed = e.message.slice( 0, 1200 ); log( 'FAILED', report.failed ); await page.screenshot( { path: path.join( OUT, PRE + 'failed.png' ) } ).catch( ()=>{} ); }
	fs.writeFileSync( path.join( OUT, PRE + 'report.json' ), JSON.stringify( report, null, 1 ) );
	log( 'report:', JSON.stringify( { watch: report.watch, tower: report.tower, errors: report.errors.length } ) );
	await ctx.close();
} )();
