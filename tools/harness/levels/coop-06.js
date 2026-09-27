// 06 · Underhang with more than one player: node levels/coop-06.js [--players 2|3|4]
// The host plays in the browser; the others join as stand-in connections set up the way the engine sets up a joining
// peer (as in coop-01.js). Checks: every guest gets a character on the raiders' side; the mod scales the enemies to the
// head count (the [N+] ones stay for N players and go for fewer); a guest climbs a pier cap's ladder out of the water
// (the mod moves every character on the host from its controller's inputs: a guest's arrive on its controller, not
// from the keyboard); a guest who dies comes back. Screenshots and levels/results/06-coop<N>-report.json come out.
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
	const tag = '06-coop' + PLAYERS;
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	const report = { players: PLAYERS, steps: [], shots: [], errors: [] };
	page.on( 'pageerror', ( e )=>{ if ( !/pb2Settings is not defined|AppendSoundsArray/.test( e.message ) && report.errors.length < 8 ) report.errors.push( ( e.stack || e.message ).slice( 0, 800 ) ); } );
	const ev = ( fn, ...a )=>page.evaluate( fn, ...a );
	const step = ( name, data )=>{ report.steps.push( Object.assign( { name }, data ) ); log( name, JSON.stringify( data ) ); };
	const shot = async ( name, spot )=>{ const f = path.join( OUT, tag + '-' + name + '.png' ); if ( spot ) await shoot( page, f, spot ); else await page.screenshot( { path: f } ); report.shots.push( name ); };
	try
	{
		await openEditor( page );
		await importLevel( page, '06' );
		await playTest( page );
		await page.evaluate( LABKIT );
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
		// god mode for the players (a guest can be made mortal), the guests' inputs each frame
		await ev( ()=>
		{
			const W = window.__watch = { drive: {}, mortalGuest: false };
			const R = pb2Ragdoll.prototype, hurt = R._beb;
			R._beb = function( atom, dmg, ...rest ) { const ch = this.owner_character, pc = ch && ch.controller && ch.controller.player_connection; if ( dmg > 0 && pc && !( W.mortalGuest && pc.guest ) ) dmg = 0; return hurt.call( this, atom, dmg, ...rest ); };
			const tick = ()=>
			{
				requestAnimationFrame( tick );
				const me = __lab.me(); if ( me && me.hea > 0 ) me.hea = Math.max( me.hea, 100 );
				for ( const dc of window.__guests ) { const k = dc.controller, d = W.drive[ dc.guest ]; if ( k && d ) { k.act_x = d.x || 0; k.act_y = d.y || 0; } }
			};
			requestAnimationFrame( tick );
		} );
		await page.waitForTimeout( 7000 );
		const L = await ev( ()=>window.__csTower.layouts[ '06' ] );
		const guests = await ev( ()=>window.__guests.map( ( dc )=>{ const ch = dc.controller && dc.controller.character; const me = __lab.me(); return { guest: dc.guest, character: !!( ch && ch.hea > 0 ), team: ch && me ? ch.ragdoll.team === me.ragdoll.team : null, x: ch ? Math.round( ch.x ) : null, y: ch ? Math.round( ch.y ) : null }; } ) );
		step( 'guests', { guests } );
		report.guests = guests.filter( ( g )=>g.character && g.team ).length;
		report.coop = await ev( ()=>window.__csTower.coop );
		const names = await ev( ()=>pb2Character.characters.filter( ( c )=>c && c.hea > 0 && !( c.controller && c.controller.player_connection ) ).map( ( c )=>String( ( c.ragdoll.name || {} ).text || '' ) ) );
		report.strength = { '2+': names.filter( ( n )=>/\[2\+\]/.test( n ) ).length, '3+': names.filter( ( n )=>/\[3\+\]/.test( n ) ).length, '4+': names.filter( ( n )=>/\[4\+\]/.test( n ) ).length, all: names.length };
		step( 'strength', report.strength );
		await shot( 'start' );
		// a guest up a ladder: in the water beside cap 1's right end, up held, then left onto the cap
		const c1 = L.legs[ 0 ], lx = c1 + L.cap.half + 20;
		await ev( ( [ x, y ] )=>{ const ch = window.__guests[ 0 ].controller.character, v = ch.ragdoll.driver_of; if ( v && v.ExcludeRagdoll ) v.ExcludeRagdoll( ch.ragdoll, true ); const b = ch.ragdoll.local_atoms[ pb2Ragdoll.b_body ]; ch.ragdoll.Teleport( x - b.x, y - b.y ); }, [ lx, 30 - 44 ] );
		await page.waitForTimeout( 150 );
		await ev( ()=>{ window.__watch.drive[ 1 ] = { x: 0, y: -1 }; } );
		await page.waitForTimeout( 2800 );
		await ev( ()=>{ window.__watch.drive[ 1 ] = { x: -1, y: -1 }; } );
		await page.waitForTimeout( 500 );
		await ev( ()=>{ window.__watch.drive[ 1 ] = { x: -1, y: 0 }; } );
		await page.waitForTimeout( 400 );
		await ev( ()=>{ window.__watch.drive[ 1 ] = { x: 0, y: 0 }; } );
		await page.waitForTimeout( 900 );
		const g1 = await ev( ()=>{ const ch = window.__guests[ 0 ].controller.character; return ch ? { x: Math.round( ch.x ), feet: Math.round( ch.y + 44 ) } : null; } );
		report.guestLadder = !!g1 && Math.abs( g1.feet - L.cap.top ) < 14 && g1.x < c1 + L.cap.half;
		step( 'guest ladder', { g1, ok: report.guestLadder } );
		await shot( 'ladder', { x: c1 + 200, y: -300, zoom: 1.2, frames: 20 } );
		// a guest dies and comes back
		await ev( ()=>{ window.__watch.mortalGuest = true; const ch = window.__guests[ 0 ].controller.character; ch.hea = -50; } );
		let back = null;
		for ( let i = 0; i < 26 && !back; i++ ) { await page.waitForTimeout( 500 ); back = await ev( ()=>{ const dc = window.__guests[ 0 ], ch = dc.controller && dc.controller.character; return ch && ch.hea > 0 ? { x: Math.round( ch.x ), y: Math.round( ch.y ) } : null; } ); }
		await ev( ()=>{ window.__watch.mortalGuest = false; } );
		report.guestBack = !!back;
		step( 'guest back', { back, respawns: await ev( ()=>window.__csTower.respawns ) } );
		await shot( 'respawn' );
		report.mod = await ev( ()=>( { status: window.__csTower.status, error: window.__csTower.error } ) );
	}
	catch ( e ) { report.failed = e.message.slice( 0, 1200 ); log( 'FAILED', report.failed ); await page.screenshot( { path: path.join( OUT, tag + '-failed.png' ) } ).catch( ()=>{} ); }
	const expect = { '2+': PLAYERS >= 2, '3+': PLAYERS >= 3, '4+': PLAYERS >= 4 };
	report.scaled = !!report.strength && Object.keys( expect ).every( ( k )=>expect[ k ] ? true : report.strength[ k ] === 0 ) && ( PLAYERS < 2 || report.strength[ '2+' ] > 0 );
	report.ok = !report.failed && report.guests === PLAYERS - 1 && !!report.coop && report.coop.players === PLAYERS && report.scaled && report.guestLadder && report.guestBack && !( report.mod && report.mod.error ) && report.errors.length === 0;
	fs.writeFileSync( path.join( OUT, tag + '-report.json' ), JSON.stringify( report, null, 1 ) );
	log( 'report:', JSON.stringify( { ok: report.ok, guests: report.guests, coop: report.coop, strength: report.strength, guestLadder: report.guestLadder, guestBack: report.guestBack, errors: report.errors.length } ) );
	await ctx.close();
} )();
