// In-page measurement kit (runs in the game page: page.evaluate( LABKIT )). Game px, y down; game time in seconds
// (the engine's 30 ticks/s). Runs the game at a fixed step (pb2_mp.DEBUG_FORCE_GSPEED: 0.5 tick a frame, the step
// of a 60 fps player) so what it measures doesn't depend on how fast this machine draws.
const LABKIT = String( function()
{
	// code: [ key, keyCode, location ] — the game binds by keyCode and location (its defaults: W / Space jump, S or left Ctrl
	// crouch, A / D, E use or enter, X fall, left Shift sprint (location 1), C kick, R reload, Q last weapon, 0–9 weapon slots)
	const KEYS = { KeyW: [ 'w', 87 ], KeyA: [ 'a', 65 ], KeyS: [ 's', 83 ], KeyD: [ 'd', 68 ], KeyE: [ 'e', 69 ], KeyX: [ 'x', 88 ], KeyC: [ 'c', 67 ],
		KeyF: [ 'f', 70 ], KeyG: [ 'g', 71 ], KeyQ: [ 'q', 81 ], KeyR: [ 'r', 82 ], KeyZ: [ 'z', 90 ], Space: [ ' ', 32 ], ShiftLeft: [ 'Shift', 16, 1 ], ControlLeft: [ 'Control', 17, 1 ] };
	for ( let i = 0; i <= 9; i++ ) KEYS[ 'Digit' + i ] = [ String( i ), 48 + i ];
	const lab = window.__lab = {
		STEP: 0.5,
		me() { const c = pb2Controller.controllers.find( ( k )=>k && k.player_connection === pb2GameWorld ); return c && c.character; },
		key( type, code )
		{
			const [ key, kc, location = 0 ] = KEYS[ code ] || [ code, 0 ];
			for ( const t of [ window, document, document.body ] ) t.dispatchEvent( new KeyboardEvent( type, { code, key, keyCode: kc, which: kc, location, bubbles: true } ) );
		},
		release() { for ( const k of Object.keys( KEYS ) ) lab.key( 'keyup', k ); },
		// the character's outline from its atoms (their circles): feet = lowest point, head = highest
		state()
		{
			const ch = lab.me();
			if ( !ch || !ch.ragdoll ) return null;
			const at = ch.ragdoll.local_atoms;
			let top = Infinity, bot = -Infinity, l = Infinity, r = -Infinity;
			for ( const a of lab.parts( at ) )
			{
				const rad = ( a.rad || 0 );
				top = Math.min( top, a.y - rad ); bot = Math.max( bot, a.y + rad ); l = Math.min( l, a.x - rad ); r = Math.max( r, a.x + rad );
			}
			const b = at[ pb2Ragdoll.b_body ], v = b.box2d_body ? b.box2d_body.GetLinearVelocity() : { x: 0, y: 0 };
			return { x: b.x, y: b.y, vx: v.x * 30, vy: v.y * 30, top, bot, l, r, hea: ch.hea, hmax: ch.hmax, air: ch.ragdoll.air, stand: ch._stand, slot: ch.curwea_slot, dead: !( ch.hea > 0 ) };
		},
		// the atoms that are the body (b_body_brk1/2 are not: they sit still at a fixed point until the body breaks)
		parts( at ) { return [ 'b_pelvis', 'b_leg1', 'b_leg2', 'b_arm1', 'b_arm2', 'b_body', 'b_head_start', 'b_head_end' ].map( ( k )=>at[ pb2Ragdoll[ k ] ] ).filter( ( a )=>a && a.x !== undefined ); },
		// an atom's own numbers (for the size table)
		atoms()
		{
			const at = lab.me().ragdoll.local_atoms;
			return Object.keys( pb2Ragdoll ).filter( ( k )=>/^b_/.test( k ) ).map( ( k )=>{ const a = at[ pb2Ragdoll[ k ] ]; return { name: k, x: a.x, y: a.y, rad: a.rad }; } );
		},
		// move the character so its body is at (x, y), and still
		teleport( x, y )
		{
			const ch = lab.me(), b = ch.ragdoll.local_atoms[ pb2Ragdoll.b_body ];
			ch.ragdoll.Teleport( x - b.x, y - b.y );
			lab.still();
		},
		still() { for ( const a of lab.me().ragdoll.local_atoms ) if ( a && a.box2d_body ) { try { a.box2d_body.SetVel( 0, 0 ); } catch ( e ) { a.box2d_body.SetLinearVelocity( new b2Vec2( 0, 0 ) ); } } },
		// run a program for `frames` fixed steps: prog = [ [ frame, 'down' | 'up', code ], … ], fn( frame, state ) may
		// return 'stop'. Samples every frame: [ t, x, y, vx, vy, top, bot, hea, air ].
		run( prog, frames, fn )
		{
			return new Promise( ( done )=>
			{
				pb2_mp.DEBUG_FORCE_GSPEED = true; pb2_mp.DEBUG_FORCE_GSPEED_VALUE = lab.STEP;
				const out = [];
				let frame = 0, t = 0;
				// (nothing thrown from here may escape: the site treats an uncaught error as a crash and reloads)
				const tick = ()=>
				{
					let stop = null;
					try
					{
						for ( const [ f, type, code ] of prog ) if ( f === frame ) lab.key( type === 'down' ? 'keydown' : 'keyup', code );
						const s = lab.state();
						if ( s ) out.push( [ +t.toFixed( 4 ), +s.x.toFixed( 1 ), +s.y.toFixed( 1 ), +s.vx.toFixed( 1 ), +s.vy.toFixed( 1 ), +s.top.toFixed( 1 ), +s.bot.toFixed( 1 ), +( +s.hea ).toFixed( 1 ), s.air ] );
						else { out.gone = frame; stop = 'stop'; }                        // (no character: dead and gone)
						if ( s && fn ) stop = fn( frame, s ) || stop;
					}
					catch ( e ) { out.error = String( e && e.message || e ); stop = 'stop'; }
					t += lab.STEP / 30;
					if ( ++frame < frames && stop !== 'stop' ) requestAnimationFrame( tick );
					else { try { lab.release(); } catch ( e ) {} done( { samples: out, gone: out.gone, error: out.error } ); }
				};
				requestAnimationFrame( tick );
			} );
		},
		wait( frames ) { return lab.run( [], frames ); },
		// aim the mouse at a world point (the game reads its screen position each frame), and the trigger (M1)
		aimAt( x, y )
		{
			const cam = pb2_mp.cS, cv = pb2_mp.renderer.domElement;
			if ( !cam || !cv ) return;
			const v = new THREE.Vector3( x, -y, 0 ).project( cam ), r = cv.getBoundingClientRect();
			pb2_mp.screen_mouse_x = r.left + ( v.x + 1 ) / 2 * r.width;
			pb2_mp.screen_mouse_y = r.top + ( 1 - v.y ) / 2 * r.height;
		},
		trigger( on ) { pb2Controls.hold_mouse1 = on ? 1 : 0; },
		// the nearest living enemy within reach (someone not on your team), or null
		nearestEnemy( reach = 1400 )
		{
			const me = lab.me();
			if ( !me ) return null;
			let best = null, bd = reach;
			const team = ( c )=>c && c.ragdoll ? c.ragdoll.team : null;                  // (a character's team is its ragdoll's)
			for ( const c of pb2Character.characters ) { if ( !c || c === me || !( c.hea > 0 ) || team( c ) === team( me ) ) continue; const d = Math.hypot( c.x - me.x, c.y - me.y ); if ( d < bd ) { bd = d; best = c; } }
			return best;
		},
		// pick a weapon slot with its number key and wait until it is in hand
		async slot( n ) { await lab.run( [ [ 0, 'down', 'Digit' + n ], [ 3, 'up', 'Digit' + n ] ], 90, ( f, s )=>f > 6 && s.slot === n ? 'stop' : null ); return lab.me().curwea_slot; },
		free() { pb2_mp.DEBUG_FORCE_GSPEED = false; }
	};
	return 'labkit ready';
} );
module.exports = { LABKIT: '(' + LABKIT + ')()' };
