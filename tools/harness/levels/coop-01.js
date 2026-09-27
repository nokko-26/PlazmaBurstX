// 01 · Approach with more than one player: node levels/coop-01.js [--players 2|3|4]
// The host plays in the browser; the others join as stand-in connections, set up the way the engine sets up a
// joining peer (pb2Multiplayer's own SetToController), with no network under them (no byte_shifter: the engine skips
// sending to those). The engine's player assignment and the mod's host logic treat them like any guest: the mod
// scales the enemies to the head count, gives each guest a character aboard the raiders' boat, and brings back
// whoever dies. The guests' controllers are driven directly (nothing overwrites a remote controller's inputs).
// Checks: every guest gets a character, on the raiders' team, aboard; the [N+] enemies stay for N players; the boat
// carries everyone to the shore (a guest at the helm); everyone gets off and up to the quay; a guest killed on the
// quay comes back; the exit counts. Screenshots and a report go to levels/results/.
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const { LABKIT } = require( '../labkit' );
const { shoot } = require( '../shots' );
const OUT = path.join( __dirname, 'results' );
const arg = ( k, d )=>{ const i = process.argv.indexOf( k ); return i === -1 ? d : process.argv[ i + 1 ]; };
const PLAYERS = Math.max( 2, Math.min( 4, +arg( '--players', 2 ) ) );
const log = ( ...a )=>console.log( new Date().toISOString().slice( 11, 19 ), ...a );

( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	const report = { players: PLAYERS, steps: [], shots: [], errors: [] };
	page.on( 'pageerror', ( e )=>{ if ( !/pb2Settings is not defined|AppendSoundsArray/.test( e.message ) && report.errors.length < 8 ) report.errors.push( ( e.stack || e.message ).slice( 0, 800 ) ); } );
	const ev = ( fn, ...a )=>page.evaluate( fn, ...a );
	const step = ( name, data )=>{ report.steps.push( Object.assign( { name }, data ) ); log( name, JSON.stringify( data ) ); };
	const tag = 'coop' + PLAYERS;
	const shot = async ( name, spot )=>{ const f = path.join( OUT, '01-' + tag + '-' + name + '.png' ); if ( spot ) await shoot( page, f, spot ); else await page.screenshot( { path: f } ); report.shots.push( name ); };
	try
	{
		await openEditor( page );
		await importLevel( page, '01' );
		await playTest( page );
		await page.evaluate( LABKIT );
		// the guests join straight away (before the mod counts heads, 4 s into the level)
		step( 'guests join', await ev( ( n )=>
		{
			const G = window.__guests = [];
			for ( let i = 0; i < n; i++ )
			{
				const dc = { is_being_removed: false, isHost: false, byte_shifter: null, controller: null, _BL: null, spectated_ragdoll: null, cVZ: false, loaded: true, bqE: null, user_uid: -100 - i, guest: i + 1 };
				dc.personal_virtual_controller = pb2Controller.CreateController( { character: null, player_controllable: true } );
				// (as pb2Multiplayer sets up a joining peer)
				dc.SetToController = ( controller, soft = true )=>
				{
					if ( controller === dc.controller ) return;
					if ( controller && controller.player_connection !== null ) throw new Error( 'pb2Controller is already controlled by some connection (stand-in guest)' );
					if ( dc.controller !== null ) { dc.controller.player_connection = null; dc.controller.bqL(); if ( soft && controller ) controller.CopyStateFrom( dc.controller ); }
					dc.controller = controller;
					if ( dc.controller !== null )
					{
						dc.controller.player_connection = dc; dc.controller.bqT();
						dc.spectated_ragdoll = dc.controller.character && dc.controller.character.ragdoll || null;
					}
				};
				dc.SetToSpectateRagdoll = ( r )=>{ dc.spectated_ragdoll = r; };
				dc.settings = typeof pb2Controller.bqD === 'function' ? pb2Controller.bqD() : pb2GameWorld.settings;
				dc.PauseTrustedControlsTemporarily = ()=>{};
				dc.ShowChatMessage = ()=>{};
				dc.remove = ()=>{ dc.is_being_removed = true; const j = pb2Multiplayer.connected_dataConnections.indexOf( dc ); if ( j !== -1 ) pb2Multiplayer.connected_dataConnections.splice( j, 1 ); if ( dc.controller ) dc.controller.player_connection = null; };
				dc.SetToController( dc.personal_virtual_controller );
				pb2Multiplayer.connected_dataConnections.push( dc );
				G.push( dc );
			}
			return { connections: pb2Multiplayer.connected_dataConnections.length };
		}, PLAYERS - 1 ) );
		// god mode for every player and their boat (what they'd have taken is counted: this pass checks co-op, not the
		// balance), the host's gun on the nearest enemy (as in play-01), frame times, the guests' inputs each frame
		await ev( ()=>
		{
			const W = window.__watch = { blocked: 0, dmgBoat: 0, frames: [], last: performance.now(), drive: {}, gunner: false };
			const isPlayer = ( ch )=>!!( ch && ch.controller && ch.controller.player_connection );
			const playersBoat = ()=>pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed && Array.from( e.gO || [] ).some( ( r )=>r && isPlayer( r.owner_character ) ) );
			// (the boat's damage stopped where it comes in, before a part can break: a critical part broken in one hit sinks
			// it at the next, whatever its health)
			const shield = ( e, dmg )=>{ if ( !( dmg > 0 ) || e.type !== pb2Entity.TYPE_BOAT || !Array.from( e.gO || [] ).some( ( r )=>r && isPlayer( r.owner_character ) ) ) return dmg; W.dmgBoat += dmg; return 0; };
			const DD = pb2Entity.prototype.DealDamage;
			pb2Entity.prototype.DealDamage = function( dmg, ...rest ) { return DD.call( this, shield( this, dmg ), ...rest ); };
			try { const C = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT ).constructor, own = C.prototype.DealDamage; C.prototype.DealDamage = function( dmg, ...rest ) { return own.call( this, shield( this, dmg ), ...rest ); }; }
			catch ( e ) { W.shieldHookError = String( e ); }
			const R = pb2Ragdoll.prototype, hurt = R._beb;
			R._beb = function( atom, dmg, ...rest )
			{
				const ch = this.owner_character, pc = ch && ch.controller && ch.controller.player_connection;
				if ( dmg > 0 && pc && !( W.mortalGuest && pc.guest ) ) { W.blocked += dmg; dmg = 0; }
				return hurt.call( this, atom, dmg, ...rest );
			};
			const tick = ()=>
			{
				requestAnimationFrame( tick );
				const now = performance.now(); W.frames.push( now - W.last ); if ( W.frames.length > 600 ) W.frames.shift(); W.last = now;
				// (a guest walking on its own does what a player would: holds up in the water to surface and climb out, and
				// jumps when something stops it)
				for ( const dc of window.__guests )
				{
					const k = dc.controller, d = W.drive[ dc.guest ], ch = k && k.character;
					if ( !k || !d ) continue;
					k.act_x = d.x || 0;
					if ( d.y !== 'auto' || !ch ) { k.act_y = d.y || 0; continue; }
					const g = W.walk || ( W.walk = {} ), m = g[ dc.guest ] || ( g[ dc.guest ] = { x: ch.x, t: now, hop: 0 } );
					if ( Math.abs( ch.x - m.x ) > 6 ) { m.x = ch.x; m.t = now; }
					else if ( now - m.t > 900 ) { m.hop = now + 350; m.t = now; }
					k.act_y = ch.y > -8 || now < m.hop ? -1 : 0;
				}
				// (the boat's hull and its parts kept whole — a part that broke stays broken: breaking it twice throws)
				const boat = playersBoat();
				if ( boat )
				{
					if ( !W.full || W.full.boat !== boat ) W.full = { boat, hea: boat.hea, parts: Array.from( boat.hG || [] ) };
					if ( boat.hea < W.full.hea ) { W.dmgBoat += W.full.hea - boat.hea; boat.hea = W.full.hea; }
					if ( boat.hG ) for ( let i = 0; i < W.full.parts.length; i++ ) if ( boat.hG[ i ] > 0 && boat.hG[ i ] < W.full.parts[ i ] ) boat.hG[ i ] = W.full.parts[ i ];
				}
				// everyone aboard shoots: the host with the mouse, each guest through its controller (aim, trigger)
				const me = __lab.me() || ( window.__guests.map( ( dc )=>dc.controller && dc.controller.character ).find( ( c )=>c && c.hea > 0 ) );
				if ( !W.gunner ) for ( const dc of window.__guests ) { if ( dc.controller ) dc.controller.act_fire = 0; }
				if ( W.gunner && me && me.hea > 0 )
				{
					let aim = null, bd = 1400;
					for ( const e of pb2Entity.entities )
					{
						if ( !e || e.type !== pb2Entity.TYPE_BOAT || !( e.hea > 0 ) || e.is_being_removed || e === boat ) continue;
						if ( !Array.from( e.gO || [] ).some( ( r )=>r && r.owner_character && r.owner_character.hea > 0 ) ) continue;
						const B = e.box2d_bodies[ 0 ], x = B.GetPosX() * 30, y = B.GetPosY() * 30, d = Math.abs( x - me.x );
						if ( d < bd ) { bd = d; aim = [ x, y - 40 ]; }
					}
					if ( !aim ) { const t = __lab.nearestEnemy( 1400 ); if ( t ) aim = [ t.x, t.y - 16 ]; }
					if ( aim ) { __lab.aimAt( aim[ 0 ], aim[ 1 ] ); __lab.trigger( true ); } else __lab.trigger( false );
					for ( const dc of window.__guests )
					{
						const k = dc.controller;
						if ( !k || !k.character ) continue;
						if ( aim ) { k.look_x = aim[ 0 ]; k.look_y = aim[ 1 ]; k.act_fire = 1; } else k.act_fire = 0;
					}
				}
			};
			requestAnimationFrame( tick );
		} );
		const who = ()=>ev( ()=>
		{
			const boatOf = ( ch )=>pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed && Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character === ch ) );
			const seat = ( b, ch )=>{ const g = Array.from( b.gO || [] ); for ( let i = 0; i < g.length; i++ ) if ( g[ i ] && g[ i ].owner_character === ch ) return i; return -1; };
			const one = ( label, ch )=>
			{
				if ( !ch || !( ch.hea > 0 ) ) return { who: label, char: null };
				const b = boatOf( ch );
				return { who: label, x: Math.round( ch.x ), y: Math.round( ch.y ), hea: Math.round( ch.hea ), team: String( ch.ragdoll.team && ch.ragdoll.team.title || ch.ragdoll.team ), seat: b ? seat( b, ch ) : null };
			};
			return [ one( 'host', __lab.me() ) ].concat( window.__guests.map( ( dc )=>one( 'guest' + dc.guest, dc.controller && dc.controller.character ) ) );
		} );
		const fps = ()=>ev( ()=>{ const f = window.__watch.frames.slice( -120 ), m = f.reduce( ( a, b )=>a + b, 0 ) / f.length; return { msPerFrame: Math.round( m ), worst: Math.round( Math.max( ...f ) ) }; } );
		const key = ( type, code )=>ev( ( [ t, c ] )=>__lab.key( t, c ), [ type, code ] );
		const hold = async ( code, ms )=>{ await key( 'keydown', code ); await page.waitForTimeout( ms ); await key( 'keyup', code ); };
		const drive = ( g, x, y = 0 )=>ev( ( [ g, x, y ] )=>{ window.__watch.drive[ g ] = { x, y }; }, [ g, x, y ] );

		// ---- the head count and the guests' characters ----
		await page.waitForTimeout( 7500 );
		step( 'co-op scaling', await ev( ()=>window.__csTower.coop ) );
		let all = await who();
		step( 'players', { all, host: await ev( ()=>window.__csTower.host ) } );
		report.enemiesAtStart = await ev( ()=>pb2Character.characters.filter( ( c )=>c && c.hea > 0 && !c.controller.player_connection ).map( ( c )=>String( ( c.ragdoll.name || {} ).text || '' ) ) );
		await shot( 'start' );

		// ---- the host walks the pontoon (into the boat's 220 px boarding range) and boards; a guest has the helm ----
		await key( 'keydown', 'KeyD' );
		for ( let i = 0; i < 20 && ( await who() )[ 0 ].x < 1150; i++ ) await page.waitForTimeout( 250 );
		await key( 'keyup', 'KeyD' );
		for ( let i = 0; i < 8; i++ )
		{
			all = await who();
			if ( all[ 0 ].seat !== null && all[ 0 ].seat !== undefined ) break;
			await hold( 'KeyE', 200 ); await page.waitForTimeout( 800 );
			if ( i === 3 ) await hold( 'KeyD', 300 );
		}
		all = await who();
		step( 'aboard', { all } );
		if ( all.some( ( p )=>p.seat === null || p.seat === undefined ) ) throw new Error( 'not everyone aboard' );
		await shot( 'aboard' );
		const helm = all.find( ( p )=>p.seat === 0 );
		if ( !helm ) throw new Error( 'nobody at the helm' );
		// whoever has the helm drives east (the host with D; a guest through its controller)
		const east = async ( on )=>{ if ( helm.who === 'host' ) await key( on ? 'keydown' : 'keyup', 'KeyD' ); else await drive( +helm.who.slice( 5 ), on ? 1 : 0 ); };
		await ev( ()=>{ window.__watch.gunner = true; } );
		await east( true );
		const boatX = ()=>ev( ()=>{ const b = pb2Entity.entities.find( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed && Array.from( e.gO || [] ).some( ( s )=>s && s.owner_character && s.owner_character.controller && s.owner_character.controller.player_connection ) ); return b ? { x: Math.round( b.box2d_bodies[ 0 ].GetPosX() * 30 ), hea: Math.round( b.hea ) } : null; } );
		let lastX = -1, still = 0, t0 = Date.now();
		const marks = [ [ 2700, 'arch-a' ], [ 5000, 'arch-b' ] ], done = new Set();
		while ( Date.now() - t0 < 240000 )
		{
			await page.waitForTimeout( 1000 );
			const b = await boatX();
			if ( !b ) { step( 'lost the boat', { all: await who() } ); break; }
			for ( const [ mx, name ] of marks ) if ( b.x >= mx && !done.has( name ) ) { done.add( name ); await shot( name ); step( 'passed ' + name, Object.assign( { fps: await fps() }, b ) ); }
			// (docked: its bow at the landing pontoon; held up anywhere else, e.g. by a patrol in the lane, it waits for
			// the gunners, and gives up after 30 s)
			if ( Math.abs( b.x - lastX ) < 15 ) { still++; if ( b.x >= 7250 && still >= 3 ) break; if ( still >= 30 ) { step( 'held up', { boat: b, patrols: await ev( ()=>pb2Entity.entities.filter( ( e )=>e && e.type === pb2Entity.TYPE_BOAT && !e.is_being_removed && e.hea > 0 ).map( ( e )=>( { x: Math.round( e.box2d_bodies[ 0 ].GetPosX() * 30 ), hea: Math.round( e.hea ) } ) ) ) } ); break; } } else still = 0;
			lastX = b.x;
		}
		await east( false );
		all = await who();
		step( 'docked', { boat: await boatX(), all } );

		// ---- everyone off, up to the quay ----
		await ev( ()=>{ window.__watch.gunner = false; __lab.trigger( false ); } );
		await hold( 'KeyE', 200 );
		await ev( ()=>{ for ( const dc of window.__guests ) { const ch = dc.controller && dc.controller.character; const d = ch && ch.ragdoll.driver_of; if ( d ) d.ExcludeRagdoll( ch.ragdoll, true ); } } );
		await page.waitForTimeout( 1200 );
		step( 'ashore', { all: await who() } );
		await shot( 'landing' );
		await key( 'keydown', 'KeyD' );
		for ( let g = 1; g < PLAYERS; g++ ) await drive( g, 1, 'auto' );
		let killed = false, reached = false, hostX = -1, hostStill = 0, hostSwim = false;
		t0 = Date.now();
		while ( Date.now() - t0 < 150000 )
		{
			await page.waitForTimeout( 800 );
			all = await who();
			// (the host in the water: W held, as a player swims up and climbs out; stopped against something: a jump)
			const wet = all[ 0 ].char !== null && all[ 0 ].y > -5;
			if ( wet !== hostSwim ) { hostSwim = wet; await key( wet ? 'keydown' : 'keyup', 'KeyW' ); }
			if ( all[ 0 ].char !== null && Math.abs( all[ 0 ].x - hostX ) < 6 ) { if ( ++hostStill % 2 === 0 && !wet ) await hold( 'KeyW', 150 ); } else hostStill = 0;
			if ( all[ 0 ].char !== null ) hostX = all[ 0 ].x;
			if ( !killed && all[ 1 ].char !== null && all[ 1 ].x > 8100 )
			{
				// a guest killed on the quay: back in RESPAWN s (aboard the boat at the pontoon, or at the checkpoint)
				killed = true;
				await ev( ()=>{ window.__watch.mortalGuest = true; const ch = window.__guests[ 0 ].controller.character; ch.ragdoll.DealLimbDamage( ch.ragdoll.local_atoms[ pb2Ragdoll.b_body ], 5000 ); window.__watch.mortalGuest = false; } );
				step( 'guest 1 killed', { all: await who() } );
				let back = null;
				for ( let i = 0; i < 12 && !back; i++ ) { await page.waitForTimeout( 1000 ); const a = await who(); if ( a[ 1 ].char !== null ) back = a[ 1 ]; }
				step( 'guest 1 back', { back, respawns: await ev( ()=>window.__csTower.respawns ), error: await ev( ()=>window.__csTower.error ) } );
				report.guestRespawn = back;
				await ev( ()=>{ for ( const dc of window.__guests ) { const ch = dc.controller && dc.controller.character; const d = ch && ch.ragdoll.driver_of; if ( d ) d.ExcludeRagdoll( ch.ragdoll, true ); } } );
				await shot( 'quay' );
			}
			if ( await ev( ()=>window.__csTower.complete ) ) { reached = true; break; }
		}
		await key( 'keyup', 'KeyD' ); await key( 'keyup', 'KeyW' );
		for ( let g = 1; g < PLAYERS; g++ ) await drive( g, 0 );
		await page.waitForTimeout( 1200 );
		await shot( 'exit' );
		step( 'exit', { reached, all: await who(), fps: await fps() } );
		report.tower = await ev( ()=>( { status: window.__csTower.status, error: window.__csTower.error, coop: window.__csTower.coop, host: window.__csTower.host, respawns: window.__csTower.respawns, complete: window.__csTower.complete } ) );
		report.blocked = await ev( ()=>( { players: Math.round( window.__watch.blocked ), boat: Math.round( window.__watch.dmgBoat ) } ) );
	}
	catch ( e ) { report.failed = e.message.slice( 0, 1200 ); log( 'FAILED', report.failed ); await page.screenshot( { path: path.join( OUT, '01-' + tag + '-failed.png' ) } ).catch( ()=>{} ); }
	fs.writeFileSync( path.join( OUT, '01-' + tag + '-report.json' ), JSON.stringify( report, null, 1 ) );
	log( 'report:', JSON.stringify( { tower: report.tower, errors: report.errors.length, failed: report.failed || null } ) );
	await ctx.close();
} )();
