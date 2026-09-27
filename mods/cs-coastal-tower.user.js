// @name CS Coastal Tower
// @description The CS Coastal Tower: Underhang campaign for the Level Editor and your games. A "CS Tower" button in the Level Editor loads each level as an ordinary editor map (change it, save it as your own). Its pieces: the Coastal Tower on its pillars far out at sea behind the level, searchlights that sweep the water, checkpoints (players who die come back aboard their boat, or on foot at the last one they reached; a lost boat is replaced at the last berth), the level's exit, and Civil Security patrol boats that drive themselves (their crews man the guns). Enemies named with [2+] / [3+] / [4+] only fight when that many players are in the match. Needs the More vehicles mod; everyone playing needs both.
// @version 0.1.0
// @author PB3X
'use strict';

const PB3X = window.PB3X;
if ( !PB3X || window.__csTower ) return;

const opt = ( fn )=>{ try { return fn(); } catch ( e ) { return undefined; } };
const state = window.__csTower = { status: 'waiting for the game engine', error: null, registered: false, editor: false, level: null, checkpoint: null, complete: false, boats: 0, respawns: 0 };
const err = ( where, e )=>{ state.error = where + ': ' + ( e && e.message || e ); console.warn( '[CS Tower]', where, e ); };

// ================================================================================================
// ---------- the basics ----------
// ================================================================================================

const T_TOWER = 120, T_SEARCHLIGHT = 121, T_CHECKPOINT = 122, T_EXIT = 123;
const TYPES = [
	{ id: T_TOWER, konst: 'pb2Entity.TYPE_CS_TOWER', name: 'Coastal Tower backdrop', list: true },
	{ id: T_SEARCHLIGHT, konst: 'pb2Entity.TYPE_CS_SEARCHLIGHT', name: 'Searchlight', list: true },
	{ id: T_CHECKPOINT, konst: 'pb2Entity.TYPE_CS_CHECKPOINT', name: 'Checkpoint', list: true },
	{ id: T_EXIT, konst: 'pb2Entity.TYPE_CS_EXIT', name: 'Level exit', list: true }
];
const SPACER = '── CS Coastal Tower ──';
const SPACER_ID = TYPES[ 0 ].konst + ' /* cs tower */';
const D2R = Math.PI / 180;
const clamp = ( v, a, b )=>Math.max( a, Math.min( b, v ) );
const isHost = ()=>!!opt( ()=>pb2Multiplayer.isServer );
const clock = ()=>performance.now() / 1000;
const camera = ()=>opt( ()=>pb2_mp.cS ) || null;
const fixtures = ( body )=>{ const out = []; for ( let f = body.GetFixtureList(); f; f = f.GetNext() ) out.push( f ); return out; };
const bodyPos = ( e, i = 0 )=>{ const b = e && e.box2d_bodies && e.box2d_bodies[ i ]; return b ? [ b.GetPosX() * 30, b.GetPosY() * 30 ] : null; };
const controllerOf = ( ch )=>opt( ()=>pb2Controller.controllers.find( ( k )=>k && k.character === ch ) ) || null;
const isPlayer = ( ch )=>!!opt( ()=>controllerOf( ch ).player_connection );
const alive = ( ch )=>!!ch && ch.hea > 0 && !ch.is_being_removed;
const livingPlayers = ()=>( opt( ()=>pb2Character.characters ) || [] ).filter( ( c )=>alive( c ) && isPlayer( c ) );
// every connection that plays: the host (unless it's a dedicated server) and its guests. A connection keeps playing
// while its character is dead — its controller doesn't (it goes with the character), so it's the connections we count.
function connections()
{
	const out = [];
	if ( !opt( ()=>pb2Web.headless ) ) out.push( pb2GameWorld );
	for ( const dc of opt( ()=>pb2Multiplayer.connected_dataConnections ) || [] ) if ( dc && !dc.is_being_removed ) out.push( dc );
	return out;
}
const characterOf = ( dc )=>opt( ()=>dc.controller.character ) || null;
function sfx( name, x, y, vol = 1, pitch = 1 )
{
	if ( !isFinite( x ) || !isFinite( y ) ) return;
	const snd = opt( ()=>lib[ name ] );
	if ( snd ) opt( ()=>pb2Sound.PlaySound( { sound: snd, position: new THREE.Vector3( x, -y, 0 ), volume: vol, pitch } ) );
}

// ---- wrapping the game's functions alongside other mods (ours found anywhere down a chain of wrappers is never
// wrapped again; on unload it steps aside) ----
const hooks = [];
const nextIn = ( f )=>typeof f.__orig === 'function' ? f.__orig : typeof f.__original === 'function' ? f.__original : typeof f.__gore_orig === 'function' ? f.__gore_orig : null;
function hookFn( obj, key, make )
{
	const top = obj && obj[ key ];
	if ( typeof top !== 'function' ) return false;
	for ( let f = top, n = 0; f && n < 200; n++, f = nextIn( f ) ) if ( f.__pb3xCsTowerHook === state ) return true;
	const live = { on: true }, inner = make( top );
	const w = function() { return live.on ? inner.apply( this, arguments ) : top.apply( this, arguments ); };
	w.__pb3xCsTowerHook = state; w.__orig = top;
	obj[ key ] = w;
	hooks.push( { obj, key, w, live } );
	return true;
}
function unhookAll() { for ( const h of hooks.splice( 0 ) ) { h.live.on = false; if ( h.obj[ h.key ] === h.w ) h.obj[ h.key ] = h.w.__orig; } }

// ================================================================================================
// ---------- the entities: backdrop, searchlight, checkpoint, exit ----------
// ================================================================================================
//
// All four are markers the level places: no body to bump into, never moved, can't be hurt. What they are is drawn
// by this mod (the tower, the beams, the beacons) and what they do runs on the host (see the host logic below).

const estate = new WeakMap();                                              // entity → { kind, style, x, y, … } (instances are sealed)
const marked = new Set();
function markerInit( e, params, kind, style )
{
	opt( ()=>{ if ( e.p !== null ) { e.p = null; dO.bjR( e ); } } );
	opt( ()=>e._eM( 1e9, 1e9, 0 ) );
	e.driver_can_enter = false;
	const b = e.box2d_bodies && e.box2d_bodies[ 0 ];
	if ( b ) { for ( const f of fixtures( b ) ) f.SetFilterData( pb2_mp.Box2D_filter_nothing ); opt( ()=>b.SetType( 0 ) ); }
	// (where it stands is read from its body every frame: the engine places the body after this constructor)
	estate.set( e, { kind, style: style | 0 || 1, side: ( +params.side || 1 ) < 0 ? -1 : 1, rot: +params.rotation || 0, x: +params.x || 0, y: +params.y || 0, on: 0 } );
	marked.add( e );
}
const hideBase = ( e )=>
{
	for ( const c of e.cF || [] ) if ( c ) for ( const k of c.children ) if ( k.visible ) k.visible = false;
	for ( const c of e.shadow || [] ) if ( c && c.visible ) c.visible = false;
};
const classes = {};
function makeClass( t )
{
	if ( classes[ t.id ] ) return classes[ t.id ];
	const kind = { [ T_TOWER ]: 'tower', [ T_SEARCHLIGHT ]: 'searchlight', [ T_CHECKPOINT ]: 'checkpoint', [ T_EXIT ]: 'exit' }[ t.id ];
	const title = { tower: 'Coastal Tower', searchlight: 'Searchlight', checkpoint: 'Checkpoint', exit: 'Exit' }[ kind ];
	classes[ t.id ] = class pb2EntityCsTowerMarker extends pb2EntityCrate
	{
		// (its Style ID read before the crate's constructor, which forces a crate's to 1)
		constructor( params, _type, uid ) { const style = params && params.style_id; super( params, _type, uid ); opt( ()=>{ this.name = new pb2ColoredText( title ).WhiteColors(); } ); markerInit( this, params, kind, style ); }
		bI() { return pb2Entity.MATERIAL_METAL; }
		_iL() {}
		_cI() {}
		_bR() {}
		_eSO() {}
		_bm() { return false; }
		DealDamage() { return 0; }
		// (its state for the clients: a checkpoint lit, a searchlight's sweep)
		cn() { return 1; }
		ck( arr, offset ) { const s = estate.get( this ); arr[ offset ] = s ? s.on : 0; }
		cg( arr, offset ) { const s = estate.get( this ); if ( s ) s.on = arr[ offset ] | 0; }
	};
	return classes[ t.id ];
}

function register()
{
	if ( typeof pb2Entity === 'undefined' || !pb2Entity.eXd || typeof pb2EntityCrate === 'undefined' ) return false;
	if ( !state.registered )
	{
		for ( const t of TYPES )
		{
			const taken = pb2Entity.eXd[ t.id ];
			if ( taken && !taken.__pb3xCsTower ) { state.error = 'entity type ' + t.id + ' is already taken'; return false; }
		}
		for ( const t of TYPES )
		{
			pb2Entity[ t.konst.split( '.' )[ 1 ] ] = t.id;
			const thunk = ()=>makeClass( t );
			thunk.__pb3xCsTower = true;
			pb2Entity.eXd[ t.id ] = thunk;
			opt( ()=>{ if ( pb2Entity.eu ) delete pb2Entity.eu[ t.id ]; } );
			if ( pb2Entity.ALL_TYPES.indexOf( t.konst ) === -1 ) pb2Entity.ALL_TYPES.push( t.konst );
		}
		state.registered = true;
	}
	addToEditorList();
	hookAutopilot();
	hookRelevance();
	return true;
}

// the entity types in the editor's list, under a heading of their own
function addToEditorList()
{
	const xu = opt( ()=>uK.xu );
	if ( !xu || !xu.children || typeof pb2EditorObject === 'undefined' ) return;
	const list = xu.children;
	const ids = [ SPACER_ID ].concat( TYPES.filter( ( t )=>t.list ).map( ( t )=>t.konst ) );
	const scan = ()=>
	{
		const ours = []; let lastOther = -1;
		for ( let i = 0; i < list.length; i++ )
		{
			const a = list[ i ].attributes;
			if ( !a || a._class !== 'entity_type' ) continue;
			if ( ids.indexOf( a.id ) !== -1 ) ours.push( i ); else lastOther = i;
		}
		return { ours, lastOther };
	};
	let { ours, lastOther } = scan();
	if ( lastOther === -1 ) return;
	let right = ours.length === ids.length;
	for ( let k = 0; right && k < ids.length; k++ ) right = ours[ k ] === lastOther + 1 + k && list[ ours[ k ] ].attributes.id === ids[ k ];
	if ( right ) { state.editor = true; return; }
	for ( let k = ours.length - 1; k >= 0; k-- ) list.splice( ours[ k ], 1 );
	( { lastOther } = scan() );
	const made = ids.map( ( id, k )=>new pb2EditorObject( { _class: 'entity_type', name: k === 0 ? SPACER : ( TYPES.find( ( t )=>t.konst === id ) || {} ).name || id, id } ) );
	for ( const o of made ) xu.push( o );
	for ( const o of made ) list.splice( list.indexOf( o ), 1 );
	list.splice( lastOther + 1, 0, ...made );
	opt( ()=>{ if ( xu._exR && xu._exR.clear ) xu._exR.clear(); } );
	state.editor = true;
}

// The backdrop and the level markers go to every player, wherever they look: the host sends each player only the
// entities on their screen, and the tower is drawn far from its marker.
function hookRelevance()
{
	if ( typeof pb2Vision === 'undefined' ) return;
	const wrap = ( proto )=>hookFn( proto, 'KN', ( orig )=>function( e )
	{
		if ( e && estate.has( e ) ) { if ( 'bto' in pb2Vision ) pb2Vision.bto = 0; return true; }
		return orig.apply( this, arguments );
	} );
	wrap( pb2Vision.prototype );
	hookFn( pb2Vision, 'GetVision', ( orig )=>function()
	{
		const v = orig.apply( this, arguments );
		opt( ()=>{ const p = Object.getPrototypeOf( v ); if ( p && p !== pb2Vision.prototype ) wrap( p ); } );
		return v;
	} );
}

// ================================================================================================
// ---------- the host: checkpoints, coming back, the exit, co-op strength ----------
// ================================================================================================
//
// Checkpoints light up as the first player passes them (left to right). A player whose character is gone comes back
// after RESPAWN seconds: aboard the team's boat while it floats (a free seat) — a berth checkpoint (Style ID 1) brings a
// new boat when the team's is lost — or, once the last checkpoint reached is one on foot (Style ID 2) past the boat,
// there on foot. Enemies named "… [N+]" leave the match at its start when fewer than N play (co-op strength).

const RESPAWN = 5, BOAT_BACK = 8;
const host = { level: 0, since: 0, gone: new Map(), lastX: new WeakMap(), template: null, scaled: false, completeAt: 0 };
const markers = ( kind )=>[ ...marked ].filter( ( e )=>!e.is_being_removed && estate.get( e ) && estate.get( e ).kind === kind );
const BOAT = ()=>opt( ()=>pb2Entity.TYPE_BOAT );
const isBoat = ( e )=>!!e && BOAT() !== undefined && e.type === BOAT() && !e.is_being_removed && e.hea > 0;
const seatsOf = ( e )=>Array.from( opt( ()=>e.gO ) || [] );                   // (the seats: not a real array)
// a boat a bot is steering (a Civil Security patrol: the autopilot drives it)
const botHelm = ( e )=>{ const c = opt( ()=>seatsOf( e )[ 0 ].owner_character ); return alive( c ) && !isPlayer( c ) ? c : null; };
// the players' boat: one with someone of theirs aboard, else the nearest one no bot is steering
function teamBoat()
{
	const ents = opt( ()=>pb2Entity.entities ) || [];
	const boats = ents.filter( ( e )=>isBoat( e ) && !e.team && !botHelm( e ) );
	const players = livingPlayers();
	for ( const b of boats ) if ( seatsOf( b ).some( ( s )=>s && s.owner_character && isPlayer( s.owner_character ) ) ) return b;
	if ( !boats.length ) return null;
	if ( !players.length ) return boats[ 0 ];
	const px = players[ 0 ].x;
	return boats.slice().sort( ( a, b )=>Math.abs( bodyPos( a )[ 0 ] - px ) - Math.abs( bodyPos( b )[ 0 ] - px ) )[ 0 ];
}
function newLevel()
{
	host.level++; host.since = clock(); host.gone.clear(); host.lastX = new WeakMap(); host.template = null; host.scaled = false; host.completeAt = 0;
	state.checkpoint = null; state.complete = false; state.respawns = 0;
	for ( const e of marked ) { const s = estate.get( e ); if ( s && s.kind === 'checkpoint' ) s.on = 0; }
}
function hostTick( dt )
{
	const players = livingPlayers();
	// who plays as what: the first player character is the template for those who come back
	// (a character's skin and team are its ragdoll's)
	if ( !host.template && players.length ) { const c = players[ 0 ]; host.template = { skin: opt( ()=>c.ragdoll.kN ), team: opt( ()=>c.ragdoll.team ), hmax: c.hmax || 150 }; }
	// co-op strength, once the match has settled (its players connected)
	if ( !host.scaled && clock() - host.since > 4 ) { host.scaled = true; coopScale( Math.max( 1, connections().length ) ); }
	// checkpoints: lit by the first player to pass them
	const cps = markers( 'checkpoint' ).sort( ( a, b )=>estate.get( a ).x - estate.get( b ).x );
	for ( const e of cps )
	{
		const s = estate.get( e );
		if ( s.on ) continue;
		if ( players.some( ( c )=>c.x >= s.x - 40 ) )
		{
			s.on = 1; state.checkpoint = { x: s.x, y: s.y, style: s.style };
			banner( 'Checkpoint', 2.2 );
			sfx( 's_corvette_alert', s.x, s.y, 0.5, 1.2 );
		}
	}
	// the exit: reached by a living player (or crossed: between two frames a runner can cover more than its width)
	for ( const e of markers( 'exit' ) )
	{
		const s = estate.get( e );
		const at = ( c )=>{ const was = host.lastX.get( c ); return Math.abs( c.y - s.y ) < 140 && ( Math.abs( c.x - s.x ) < 70 || ( was !== undefined && ( was - s.x ) * ( c.x - s.x ) <= 0 ) ); };
		if ( !state.complete && players.some( at ) )
		{
			state.complete = true; s.on = 1; host.completeAt = clock();
			banner( LEVEL_TITLE[ state.level ] ? LEVEL_TITLE[ state.level ] + ' — cleared' : 'Level cleared', 6 );
		}
	}
	for ( const c of players ) host.lastX.set( c, c.x );
	// the team's boat lost with players still alive (in the water): a new one at the last berth after BOAT_BACK s
	const now = clock();
	if ( players.length && !teamBoat() && ( state.checkpoint || firstCheckpoint() ) )
	{
		if ( !host.boatLostAt ) host.boatLostAt = now;
		else if ( now - host.boatLostAt > BOAT_BACK )
		{
			host.boatLostAt = 0;
			const cp = [ state.checkpoint, firstCheckpoint() ].concat( markers( 'checkpoint' ).map( ( e )=>estate.get( e ) ).filter( ( c )=>c.on && c.style === 1 ).sort( ( a, b )=>b.x - a.x ) ).find( ( c )=>c && c.style === 1 );
			if ( cp ) newBoat( cp );
		}
	}
	else host.boatLostAt = 0;
	// coming back: whoever plays without a living character (dead, or just joined) gets one after RESPAWN s
	const conns = connections();
	state.host = { players: players.length, connections: conns.length, gone: host.gone.size, template: !!host.template };
	for ( const dc of conns )
	{
		if ( alive( characterOf( dc ) ) ) { host.gone.delete( dc ); continue; }
		if ( !host.gone.has( dc ) ) { host.gone.set( dc, now ); continue; }
		if ( now - host.gone.get( dc ) < RESPAWN || !host.template ) continue;
		host.gone.set( dc, now );                                                   // (the next try, if this one doesn't take, is RESPAWN s on)
		try { const ch = respawn(); if ( ch ) { give( dc, ch ); state.respawns++; } } catch ( e ) { err( 'respawn', e ); }
	}
}
// hand a new character to a connection (the engine's simple assignment would, but only for one that still has a
// controller: a player whose character died has none)
function give( dc, ch )
{
	const k = ch.controller;
	if ( !k || k.player_connection || alive( characterOf( dc ) ) ) return;
	try { dc.SetToController( k, true ); } catch ( e ) { err( 'give', e ); }
}
// a new character for someone: aboard the team's boat while the fight is on the water (a new boat at the last berth if
// it's lost), at the last checkpoint once that's one on foot past the boat (ashore: not back in the boat behind)
function respawn()
{
	const T = host.template, cp = state.checkpoint || firstCheckpoint();
	let boat = teamBoat();
	if ( boat && cp && cp.style === 2 && cp.x > ( bodyPos( boat ) || [ -Infinity ] )[ 0 ] ) boat = null;
	if ( !boat && cp && cp.style === 1 ) boat = newBoat( cp );
	const at = boat ? bodyPos( boat ) : cp ? [ cp.x, cp.y ] : null;
	if ( !at ) return null;
	const r = pb2Ragdoll.CreateRagdollComplete( {
		x: at[ 0 ] + ( Math.random() - 0.5 ) * 40, y: at[ 1 ] - ( boat ? 90 : 44 ), skin: T.skin, team: T.team, vision: pb2Vision.VISION_SCREEN_BOX,
		style_boost: pb2StyleBoost.SELFBOOST, style_swords: pb2StyleSwords.BASIC, hmax: T.hmax, player_controllable: true, ai_preset: null, side: 1,
		can_be_revived: false, regen_module: pb2StyleRegen.style_delayed_speedup, drop_guns_on_death: pb2Character.DROP_ALWAYS
	} );
	const ch = r && r.owner_character;
	if ( !ch ) return null;
	opt( ()=>pb2Gun.CreateGun( { type: 'gun_real_rifle', x: ch.x, y: ch.y } ) );
	if ( boat && seatsOf( boat ).some( ( s )=>!s ) ) opt( ()=>boat.AddRagdoll( r ) );          // (a seat holds its rider's ragdoll; a free one is null)
	return ch;
}
function firstCheckpoint()
{
	const e = markers( 'checkpoint' ).sort( ( a, b )=>estate.get( a ).x - estate.get( b ).x )[ 0 ];
	const s = e && estate.get( e );
	return s ? { x: s.x, y: s.y, style: s.style } : null;
}
// a replacement boat at a berth checkpoint (the berth is the checkpoint's spot, on the water)
function newBoat( cp )
{
	const e = opt( ()=>pb2Entity.CreateEntity( { type: BOAT(), style_id: 1, x: cp.x, y: -60, side: 1 } ) );
	if ( e ) banner( 'A new boat at the berth', 2.5 );
	return e || null;
}
// (a character's name is a coloured text: its .text)
const nameOf = ( c )=>{ const n = opt( ()=>c.ragdoll.name ); return n && typeof n === 'object' ? String( n.text ?? '' ) : String( n ?? '' ); };
function coopScale( n )
{
	let gone = 0;
	const emptied = new Set();
	const ents = opt( ()=>pb2Entity.entities ) || [];
	for ( const c of ( opt( ()=>pb2Character.characters ) || [] ).slice() )
	{
		const m = /\[(\d)\+\]/.exec( nameOf( c ) );
		if ( !m || n >= +m[ 1 ] || isPlayer( c ) ) continue;
		// (a patrol boat whose whole crew leaves goes with them)
		for ( const e of ents ) if ( isBoat( e ) && seatsOf( e ).some( ( st )=>st && st.owner_character === c ) ) emptied.add( e );
		opt( ()=>c.ragdoll.remove() );
		gone++;
	}
	for ( const e of emptied ) if ( !seatsOf( e ).some( ( st )=>st && st.owner_character && !st.owner_character.is_being_removed ) ) opt( ()=>e.remove() );
	state.coop = { players: n, removed: gone, boats: emptied.size };
}

// ================================================================================================
// ---------- Civil Security boats that drive themselves ----------
// ================================================================================================
//
// A boat with a bot at its helm (a teamless boat the level seats a Civil Security crew in: a boat given a team has no
// seats in the More vehicles mod). Seen side-on the sea is one lane, so boats can't pass each other: a patrol never
// tries. Once a player comes within AP.wake px it closes to AP.standoff px off the nearest player and holds there
// while its gunner (a bot in the second seat: the weapon station) fires; closer than that it just holds (it would have
// to turn about to back off). It keeps to its water and its beat. A patrol whose whole crew is dead is scuttled after
// AP.scuttle s, so the lane clears. The helm's inputs are set after the game's AI has had its say each frame
// (pb2Controller.ThinkNow), so they are what it obeys.
const AP = { wake: 1900, standoff: 650, slack: 80, edge: 240, scuttle: 3, beat: 1500 };
const apState = new WeakMap();
function hookAutopilot()
{
	if ( typeof pb2Controller === 'undefined' ) return;
	hookFn( pb2Controller, 'ThinkNow', ( orig )=>function()
	{
		const r = orig.apply( this, arguments );
		try { if ( isHost() ) autopilot(); } catch ( e ) { err( 'autopilot', e ); }
		return r;
	} );
}
function autopilot()
{
	const ents = opt( ()=>pb2Entity.entities ) || [];
	const players = livingPlayers();
	let n = 0;
	for ( const e of ents )
	{
		if ( !isBoat( e ) ) continue;
		const p = bodyPos( e );
		if ( !p ) continue;
		let s = apState.get( e );
		const helm = botHelm( e );
		if ( !helm )
		{
			// (a patrol that has lost its crew: scuttled, unless a player has taken it)
			if ( s && s.crewed && !seatsOf( e ).some( ( st )=>st && alive( st.owner_character ) ) )
			{
				if ( !s.emptyAt ) s.emptyAt = clock();
				else if ( clock() - s.emptyAt > AP.scuttle )
				{
					( state.scuttled || ( state.scuttled = [] ) ).push( { x: Math.round( p[ 0 ] ), seats: seatsOf( e ).map( ( st )=>st && st.owner_character ? ( isPlayer( st.owner_character ) ? 'player' : 'bot' ) : '-' ).join( '' ) } );
					opt( ()=>{ e.hea = 0; } ); s.crewed = false;
				}
			}
			continue;
		}
		const ctl = helm.controller || controllerOf( helm );
		if ( !ctl ) continue;
		n++;
		if ( !s ) apState.set( e, s = { awake: false, crewed: true, emptyAt: 0, home: p[ 0 ], face: e.side < 0 ? -1 : 1 } );
		s.crewed = true; s.emptyAt = 0;
		// the nearest player
		let tgt = null, best = Infinity;
		for ( const c of players ) { const d = Math.abs( c.x - p[ 0 ] ); if ( d < best ) { best = d; tgt = c; } }
		ctl.act_x = 0; ctl.act_y = 0; ctl.act_fall = 0;
		if ( !tgt ) continue;
		if ( !s.awake ) { if ( best > AP.wake ) continue; s.awake = true; }
		// its water: where it can go
		const w = waterUnder( p[ 0 ], p[ 1 ] );
		// (and its beat: from where it started up to BEAT px the way it faces — towards the players)
		let lo = w ? w.minx + AP.edge : -Infinity, hi = w ? w.maxx - AP.edge : Infinity;
		if ( s.face < 0 ) { lo = Math.max( lo, s.home - AP.beat ); hi = Math.min( hi, s.home + 150 ); }
		else { hi = Math.min( hi, s.home + AP.beat ); lo = Math.max( lo, s.home - 150 ); }
		const side = p[ 0 ] >= tgt.x ? 1 : -1, dist = Math.abs( p[ 0 ] - tgt.x );
		let ax = 0;
		// (too close: it holds — a boat turns about to go the other way, and turning away under fire is worse; too far: it
		// closes in)
		if ( dist > AP.standoff + AP.slack ) ax = -side;
		if ( ( ax > 0 && p[ 0 ] > hi ) || ( ax < 0 && p[ 0 ] < lo ) ) ax = 0;
		ctl.act_x = ax;
		s.dist = Math.round( dist ); s.ax = ax;
		// its crew look where they shoot: at the target
		for ( const seat of seatsOf( e ) )
		{
			const c = seat && seat.owner_character;
			if ( !c || isPlayer( c ) || !c.controller ) continue;
			c.controller.look_x = tgt.x; c.controller.look_y = tgt.y - 20;
		}
	}
	state.boats = n;
}
function waterUnder( x, y )
{
	const list = opt( ()=>pb2Shape.world_shapes_water ) || [];
	let best = null;
	for ( const w of list ) { if ( !w || x < w.minx || x > w.maxx || y < w.miny - 200 || y > w.maxy ) continue; if ( !best || w.miny < best.miny ) best = w; }
	return best;
}

// ================================================================================================
// ---------- what's drawn: the tower far out at sea, the searchlights' beams, beacons ----------
// ================================================================================================

// The game's final pass doubles colours: our own materials put out half. (Only ShaderMaterials: the game's three.js
// build has none of the library's own materials — a MeshBasicMaterial breaks its shader compile.)
const HALF = 0.5;
// (The renderer is made with a logarithmic depth buffer, but the game's own shaders write ordinary depth: ours do too,
// so they sort against its world — a far backdrop behind the level's walls, a lamp in front of them.)
const UNLIT_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const UNLIT_FS = `uniform vec3 color; uniform float opacity; uniform sampler2D map; uniform float useMap; varying vec2 vUv;
void main(){ vec4 t = useMap > 0.5 ? texture2D( map, vUv ) : vec4( 1.0 ); gl_FragColor = vec4( color * t.rgb, opacity * t.a ); }`;
// a flat colour (× half), optionally textured, optionally added onto what's behind it; set its colour with setColor()
function unlitMat( color, opacity = 1, additive = false, map = null, scale = HALF )
{
	const m = new THREE.ShaderMaterial( {
		uniforms: { color: { value: new THREE.Color( color ).multiplyScalar( scale ) }, opacity: { value: opacity }, map: { value: map }, useMap: { value: map ? 1 : 0 } },
		vertexShader: UNLIT_VS, fragmentShader: UNLIT_FS, side: THREE.DoubleSide,
		transparent: opacity < 1 || additive || !!map, depthWrite: !additive && opacity >= 1 && !map
	} );
	if ( additive ) m.blending = THREE.AdditiveBlending;
	return m;
}
const setColor = ( m, hex, k = HALF )=>m.uniforms.color.value.setHex( hex ).multiplyScalar( k );
// a beam of light: added onto what's behind it, brightest at its lamp (the cone's tip, uv.y = 1) and fading to nothing
// at its far end; only its front faces (no doubled brightness where it overlaps itself)
const BEAM_FS = `uniform vec3 color; uniform float opacity; varying vec2 vUv;
void main(){ float k = pow( clamp( vUv.y, 0.0, 1.0 ), 1.6 ); gl_FragColor = vec4( color * k * opacity, 1.0 ); }`;
function beamMat( color, strength )
{
	const m = new THREE.ShaderMaterial( { uniforms: { color: { value: new THREE.Color( color ).multiplyScalar( HALF * strength ) }, opacity: { value: 1 } },
		vertexShader: UNLIT_VS, fragmentShader: BEAM_FS, side: THREE.FrontSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
	return m;
}
// a soft round glow (a halo behind a lamp, the haze lit round the tower)
const GLOW_FS = `uniform vec3 color; uniform float opacity; varying vec2 vUv;
void main(){ float d = length( vUv - 0.5 ) * 2.0; float k = pow( max( 0.0, 1.0 - d ), 2.2 ); gl_FragColor = vec4( color * k * opacity, 1.0 ); }`;
function glowMat( color, strength )
{
	return new THREE.ShaderMaterial( { uniforms: { color: { value: new THREE.Color( color ).multiplyScalar( HALF * strength ) }, opacity: { value: 1 } },
		vertexShader: UNLIT_VS, fragmentShader: GLOW_FS, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
}
// The backdrop's own light: the moon from above left, the sky's glow, and haze towards the sky's colour with distance.
// (The game's three.js build uploads only projectionMatrix, modelViewMatrix and modelMatrix: viewMatrix and
// normalMatrix stay zero, so the normal is turned into world space with modelMatrix — right for our uniform scales.)
const TOWER_VS = `
varying vec3 vN;
void main(){ vN = mat3( modelMatrix ) * normal; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const TOWER_FS = `
uniform vec3 color; uniform vec3 moon; uniform vec3 moonDir; uniform vec3 sky; uniform vec3 haze; uniform float hazeAmt; uniform float half_;
varying vec3 vN;
void main(){
	float d = max( 0.0, dot( normalize( vN ), normalize( moonDir ) ) );
	vec3 c = color * ( sky + moon * d );
	c = mix( c, haze, hazeAmt );
	gl_FragColor = vec4( c * half_, 1.0 );
}`;
function towerMat( color, U )
{
	return new THREE.ShaderMaterial( { uniforms: { color: { value: new THREE.Color( color ) }, moon: U.moon, moonDir: U.moonDir, sky: U.sky, haze: U.haze, hazeAmt: U.hazeAmt, half_: { value: HALF } },
		vertexShader: TOWER_VS, fragmentShader: TOWER_FS, side: THREE.DoubleSide } );
}
// canvas textures, made once
const texCache = {};
function canvasTex( key, w, h, draw, rep = [ 1, 1 ] )
{
	if ( texCache[ key ] ) return texCache[ key ];
	const c = document.createElement( 'canvas' ); c.width = w; c.height = h;
	draw( c.getContext( '2d' ), w, h );
	const t = new THREE.Texture( c ); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set( rep[ 0 ], rep[ 1 ] ); t.needsUpdate = true;
	return texCache[ key ] = t;
}
// the CS banner: red, the emblem in white
const bannerTex = ()=>canvasTex( 'banner', 128, 512, ( g, w, h )=>
{
	g.fillStyle = '#8e0f12'; g.fillRect( 0, 0, w, h );
	g.fillStyle = '#b3161a'; g.fillRect( 10, 0, w - 20, h );
	g.strokeStyle = '#f2e6e0'; g.lineWidth = 9;
	g.beginPath(); g.arc( w / 2, 150, 38, 0.35 * Math.PI, 1.65 * Math.PI ); g.stroke();                       // C
	g.beginPath(); g.arc( w / 2, 250, 30, 1.1 * Math.PI, 2.35 * Math.PI ); g.arc( w / 2, 300, 30, 0.1 * Math.PI, 1.35 * Math.PI, true ); g.stroke();   // S
	g.fillStyle = '#f2e6e0'; for ( let i = 0; i < 3; i++ ) g.fillRect( 26, 370 + i * 26, w - 52, 8 );
	g.fillStyle = '#5a0a0c'; for ( let y = 0; y < h; y += 4 ) g.fillRect( 0, y, w, 1 );
}, [ 1, 1 ] );
// windows: a grid, some lit
const windowsTex = ()=>canvasTex( 'windows', 256, 256, ( g, w, h )=>
{
	g.fillStyle = '#000'; g.fillRect( 0, 0, w, h );
	let seed = 7; const rnd = ()=>( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	for ( let y = 8; y < h; y += 32 ) for ( let x = 6; x < w; x += 22 ) { const r = rnd(); if ( r < 0.45 ) continue; g.fillStyle = r < 0.8 ? '#ffc98a' : r < 0.93 ? '#cfe4ff' : '#ff6a4a'; g.globalAlpha = 0.35 + rnd() * 0.65; g.fillRect( x, y, 12, 16 ); }
	g.globalAlpha = 1;
}, [ 1, 1 ] );

// ---- the Coastal Tower, far out behind the level ----
//
// Modelled in px, pushed `depth` px behind the level and scaled up so it's drawn at `far`…`near` of its modelled size
// (growing as you close on it): it barely moves as you travel, like a landmark on the horizon. Its base is kept on
// the level's waterline (the marker's y) wherever the camera is, so it stands in the drawn sea instead of floating at
// eye height. Style ID 1: seen from the sea (01 · Approach).
const TW = { depth: 20000, far: 0.3, near: 0.42, approach: 12000,
	pillars: [ -520, -300, -80, 140, 360, 580 ], pillarW: 86, soffit: 560, soffitT: 90, width: 1420, service: 170, deck: 60, spire: 520 };
function buildTower()
{
	const U = { moon: { value: new THREE.Color( 0x6a7ca8 ) }, moonDir: { value: new THREE.Vector3( -0.45, 0.8, 0.4 ) }, sky: { value: new THREE.Color( 0x2a3a58 ) },
		haze: { value: new THREE.Color( 0x1e2a40 ) }, hazeAmt: { value: 0.3 } };
	const root = new THREE.Group(), mats = [];
	const mat = ( c )=>{ const m = towerMat( c, U ); mats.push( m ); return m; };
	// (at night it reads as a dark mass with its lights: dark concrete, bright windows)
	const M = { concrete: mat( 0x4a4e56 ), dark: mat( 0x2c2f35 ), steel: mat( 0x3c4048 ), red: mat( 0x7a1216 ) };
	const glows = {}, glow = ( c, o = 1 )=>glows[ c + '/' + o ] || ( glows[ c + '/' + o ] = mats[ mats.push( unlitMat( c, o, true ) ) - 1 ] );
	const box = ( w, h, d, m, x, y, z = 0 )=>{ const o = new THREE.Mesh( new THREE.BoxBufferGeometry( w, h, d ), m ); o.position.set( x, y, z ); root.add( o ); return o; };
	const cyl = ( r1, r2, h, m, x, y, z = 0, n = 16 )=>{ const o = new THREE.Mesh( new THREE.CylinderBufferGeometry( r1, r2, h, n ), m ); o.position.set( x, y, z ); root.add( o ); return o; };
	// the pillars, from below the waterline up to the soffit, flared at the foot; bracing between them
	// (no Array.prototype.entries: the game's page replaces it)
	for ( let i = 0; i < TW.pillars.length; i++ )
	{
		const px = TW.pillars[ i ];
		const z = ( i % 2 ) * -160;
		box( TW.pillarW, TW.soffit + 40, TW.pillarW, M.concrete, px, TW.soffit / 2 - 20, z );
		box( TW.pillarW * 1.6, 60, TW.pillarW * 1.6, M.dark, px, 10, z );
		for ( const hy of [ 180, 380 ] ) box( 14, 24, 14, glow( 0xffb26a, 0.9 ), px + TW.pillarW / 2 + 4, hy, z + 30 );   // (service lamps)
	}
	for ( const hy of [ 200, 400 ] ) box( TW.width - 200, 22, 30, M.steel, 30, hy, -80 );
	// X-bracing between the pillars
	for ( let i = 0; i < TW.pillars.length - 1; i++ )
	{
		const a = TW.pillars[ i ], b = TW.pillars[ i + 1 ], mx = ( a + b ) / 2, len = Math.hypot( b - a, 200 );
		for ( const s of [ -1, 1 ] ) { const o = box( len, 12, 12, M.steel, mx, 300, -80 ); o.rotation.z = s * Math.atan2( 200, b - a ); }
	}
	// the soffit (the underhang) with its floodlights, pipes, catwalks
	const sy = TW.soffit;
	box( TW.width, TW.soffitT, 420, M.dark, 30, sy + TW.soffitT / 2, -80 );
	box( TW.width + 60, 16, 440, M.steel, 30, sy, -80 );
	for ( let x = -620; x <= 680; x += 130 ) { box( 26, 12, 26, glow( 0xfff0d0 ), x, sy - 10, 60 ); }
	for ( let x = -600; x <= 660; x += 300 ) box( 300, 8, 8, M.steel, x, sy - 40, 70 );                        // (pipes)
	// the service level: modules with lit windows
	const win = unlitMat( 0xffffff, 1, true, windowsTex(), 1.1 ); mats.push( win );
	const svc = sy + TW.soffitT;
	for ( const [ x, w, h ] of [ [ -470, 360, TW.service ], [ -40, 420, TW.service + 40 ], [ 420, 380, TW.service - 20 ] ] )
	{
		box( w, h, 300, M.concrete, x, svc + h / 2, -60 );
		const pane = new THREE.Mesh( new THREE.PlaneBufferGeometry( w - 30, h - 40 ), win ); pane.position.set( x, svc + h / 2, 92 ); root.add( pane );
	}
	// the upper platform, the control tower, masts, a beacon
	const up = svc + TW.service + 60;
	box( TW.width - 120, TW.deck, 380, M.dark, 30, up + TW.deck / 2, -80 );
	box( 360, 260, 220, M.concrete, 120, up + TW.deck + 130, -90 );
	const pane2 = new THREE.Mesh( new THREE.PlaneBufferGeometry( 330, 60 ), win ); pane2.position.set( 120, up + TW.deck + 220, 22 ); root.add( pane2 );
	box( 380, 26, 240, M.dark, 120, up + TW.deck + 270, -90 );
	cyl( 6, 10, TW.spire, M.steel, 220, up + TW.deck + 280 + TW.spire / 2, -90, 8 );
	cyl( 4, 6, TW.spire * 0.6, M.steel, 40, up + TW.deck + 280 + TW.spire * 0.3, -90, 8 );
	const beacon = box( 16, 16, 16, glow( 0xff2a1a ), 220, up + TW.deck + 280 + TW.spire, -90 );
	const dish = new THREE.Mesh( new THREE.SphereBufferGeometry( 60, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4 ), M.steel ); dish.position.set( -300, up + TW.deck + 90, -60 ); dish.rotation.z = 0.6; root.add( dish );
	// the CS banners: long red drops from the service level
	const ban = unlitMat( 0xffffff, 1, false, bannerTex() ); ban.transparent = false; ban.depthWrite = true; mats.push( ban );
	const banners = [];
	for ( const x of [ -330, 60, 460 ] ) { const b = new THREE.Mesh( new THREE.PlaneBufferGeometry( 70, 300, 1, 8 ), ban ); b.position.set( x, svc - 110, 150 ); root.add( b ); banners.push( b ); }
	// floodlight beams down onto the sea from the soffit
	const bm = beamMat( 0xfff0d0, 0.55 ); mats.push( bm );
	for ( const x of [ -500, -120, 260, 620 ] ) { const c = new THREE.Mesh( new THREE.ConeBufferGeometry( 150, sy, 24, 1, true ), bm ); c.position.set( x, sy / 2, 40 ); root.add( c ); }
	// the haze lit round it (so the dark tower reads against the night), warning lights on the pillars
	const halo = glowMat( 0xffb070, 0.35 ); mats.push( halo );
	const hz = new THREE.Mesh( new THREE.PlaneBufferGeometry( TW.width * 2.2, ( sy + 600 ) * 2 ), halo ); hz.position.set( 30, sy + 150, -420 ); root.add( hz );
	const warn = [];
	for ( const px of TW.pillars ) warn.push( box( 12, 12, 12, glow( 0xff2a1a ), px, sy - 20, 60 ) );
	mergeStatic( root, new Set( [ beacon, ...banners, ...warn ] ) );
	return { root, mats, U, beacon, banners, warn, height: up + TW.deck + 280 + TW.spire };
}
// One mesh per material for everything that never moves (the tower is ~80 parts: ~80 draw calls otherwise). Built
// aside first: if anything in the page's three.js differs, the parts are left as they were.
function mergeStatic( root, keep )
{
	const parts = root.children.filter( ( o )=>o.isMesh && !keep.has( o ) ), made = [];
	try
	{
		const groups = new Map();                                          // material → its parts' geometry, in root space
		for ( const o of parts )
		{
			o.updateMatrix();
			let g = o.geometry.clone();
			g.applyMatrix( o.matrix );
			if ( g.index ) { const flat = g.toNonIndexed(); g.dispose(); g = flat; }
			if ( !groups.has( o.material ) ) groups.set( o.material, [] );
			groups.get( o.material ).push( g );
		}
		groups.forEach( ( list, mat )=>
		{
			const merged = new THREE.BufferGeometry();
			for ( const name of [ 'position', 'normal', 'uv' ] )
			{
				let n = 0, all = true;                                     // (plain loops: the game's page strips every / reduce)
				for ( const g of list ) { if ( g.attributes[ name ] ) n += g.attributes[ name ].array.length; else all = false; }
				if ( !all ) continue;
				const arr = new Float32Array( n );
				let at = 0;
				for ( const g of list ) { arr.set( g.attributes[ name ].array, at ); at += g.attributes[ name ].array.length; }
				merged.addAttribute( name, new THREE.BufferAttribute( arr, list[ 0 ].attributes[ name ].itemSize ) );
			}
			for ( const g of list ) g.dispose();
			made.push( new THREE.Mesh( merged, mat ) );
		} );
	}
	catch ( e ) { err( 'mergeStatic', e ); for ( const m of made ) m.geometry.dispose(); return; }
	for ( const o of parts ) { root.remove( o ); o.geometry.dispose(); }
	for ( const m of made ) root.add( m );
}
const towers = new Map();                                                   // entity → built tower
function towerVisual( e, scene, dt, t )
{
	let T = towers.get( e );
	if ( !T ) { T = buildTower(); towers.set( e, T ); }
	if ( T.root.parent !== scene ) scene.add( T.root );
	placeTowers();
	// the map's night: the sky's colour sets the haze
	const sky = opt( ()=>pb2_mp.vI.uniforms.sky_color.value );
	if ( sky ) { T.U.haze.value.setRGB( sky.r, sky.g, sky.b ); T.U.sky.value.setRGB( sky.r, sky.g, sky.b ).multiplyScalar( 0.55 ); }
	T.beacon.visible = ( t % 1.6 ) < 0.35;
	for ( const w of T.warn ) w.visible = ( ( t + 0.8 ) % 1.6 ) < 0.35;
	T.banners.forEach( ( b, i )=>{ b.rotation.y = Math.sin( t * 0.9 + i ) * 0.12; } );
}
// Where each backdrop is drawn for the camera as it is now (run again just before every render, when the game has
// put its camera for the frame, so the base doesn't lag the waterline while the camera moves).
function placeTowers()
{
	const cam = camera();
	if ( !cam || !towers.size ) return;
	const cx = cam.position.x, cy = cam.position.y, camZ = Math.max( 1, cam.position.z ), k = ( camZ + TW.depth ) / camZ;
	towers.forEach( ( T, e )=>
	{
		const s = estate.get( e );
		if ( !s ) return;
		const close = 1 - Math.min( 1, Math.abs( s.x - cx ) / TW.approach );
		T.root.scale.setScalar( k * ( TW.far + ( TW.near - TW.far ) * close ) );
		// the waterline (three.js y is up) seen from here, carried out to the backdrop's depth
		T.root.position.set( s.x, cy + ( -s.y - cy ) * k, -TW.depth );
	} );
}
const renderHooked = new WeakSet();
function hookRender()
{
	const XM = opt( ()=>pb2_mp.XM );
	if ( !XM || renderHooked.has( XM ) ) return;
	renderHooked.add( XM );
	hookFn( XM, 'render', ( orig )=>function()
	{
		try { placeTowers(); } catch ( e ) { err( 'placeTowers', e ); }
		return orig.apply( this, arguments );
	} );
}
function towerDispose( e )
{
	const T = towers.get( e );
	if ( !T ) return;
	if ( T.root.parent ) T.root.parent.remove( T.root );
	T.root.traverse( ( o )=>{ if ( o.geometry ) o.geometry.dispose(); } );
	for ( const m of T.mats ) m.dispose();
	towers.delete( e );
}

// ---- searchlights: a lamp on a post, its beam sweeping the water ----
// Style ID 1 sweeps, 2 holds still. Rotation (degrees) is where it points, round from straight down (+ towards the
// way it faces); it sweeps ±26° about that.
const SL = { len: 1100, r: 120, sweep: 26 * D2R, speed: 0.35 };
const beamGeo = ( ()=>{ let g = null; return ()=>g || ( g = new THREE.ConeBufferGeometry( SL.r, SL.len, 24, 1, true ).translate( 0, -SL.len / 2, 0 ) ); } )();
const lights = new Map();
function searchlightVisual( e, scene, dt, t )
{
	const s = estate.get( e );
	let L = lights.get( e );
	if ( !L )
	{
		const grp = new THREE.Group();
		const beam = new THREE.Mesh( beamGeo(), beamMat( 0xdfeaff, 0.5 ) );
		const head = new THREE.Mesh( new THREE.CylinderBufferGeometry( 16, 22, 30, 12 ), unlitMat( 0x2a2e34 ) );
		const lens = new THREE.Mesh( new THREE.CircleBufferGeometry( 15, 16 ), unlitMat( 0xf4f8ff ) );
		lens.rotation.x = Math.PI / 2; lens.position.y = -15.5;
		const post = new THREE.Mesh( new THREE.BoxBufferGeometry( 8, 60, 8 ), unlitMat( 0x2a2e34 ) ); post.position.y = 42;
		const pivot = new THREE.Group(); pivot.add( beam ); pivot.add( head ); pivot.add( lens );
		grp.add( pivot ); grp.add( post );
		L = { grp, pivot, beam, light: null, phase: Math.random() * 6 };
		lights.set( e, L );
	}
	if ( L.grp.parent !== scene ) scene.add( L.grp );
	L.grp.position.set( s.x, -s.y + 30, 20 );
	const a = s.rot * D2R * s.side + ( s.style === 2 ? 0 : Math.sin( t * SL.speed + L.phase ) * SL.sweep );
	L.pivot.rotation.z = a;
	// its pool of light where the beam meets the water
	const hitY = 0, dy = ( s.y - 30 ) - hitY;
	const hx = s.x - Math.tan( a ) * Math.max( 40, -dy );
	if ( !L.light ) L.light = opt( ()=>pb2Light.CreateLight( { x: hx, y: hitY - 30, color: 0xcfe0ff, power: 0.9, scale: 3, flare: false, is_static: false } ) ) || false;
	if ( L.light ) opt( ()=>{ L.light.x = hx; L.light.y = hitY - 30; } );
	s.beamX = hx;
}
function searchlightDispose( e )
{
	const L = lights.get( e );
	if ( !L ) return;
	if ( L.grp.parent ) L.grp.parent.remove( L.grp );
	if ( L.light ) opt( ()=>L.light.remove() );
	lights.delete( e );
}

// ---- checkpoints and the exit: a beacon on a post (amber waiting, green lit) ----
const beacons = new Map();
function beaconVisual( e, scene, dt, t )
{
	const s = estate.get( e );
	let B = beacons.get( e );
	if ( !B )
	{
		const grp = new THREE.Group();
		const post = new THREE.Mesh( new THREE.CylinderBufferGeometry( 3, 4, 70, 8 ), unlitMat( 0x30343a ) ); post.position.y = 35;
		const lamp = new THREE.Mesh( new THREE.SphereBufferGeometry( 8, 12, 8 ), unlitMat( 0xffb030 ) ); lamp.position.y = 74;
		const halo = new THREE.Mesh( new THREE.SphereBufferGeometry( 26, 16, 8 ), unlitMat( 0xffb030, 0.25, true ) ); halo.position.y = 74;
		grp.add( post ); grp.add( lamp ); grp.add( halo );
		B = { grp, lamp, halo };
		beacons.set( e, B );
	}
	if ( B.grp.parent !== scene ) scene.add( B.grp );
	B.grp.position.set( s.x, -s.y, 10 );
	const col = s.kind === 'exit' ? ( s.on ? 0x40ff80 : 0x40c0ff ) : ( s.on ? 0x40ff80 : 0xffb030 );
	setColor( B.lamp.material, col );
	setColor( B.halo.material, col, HALF * ( 0.6 + 0.4 * Math.sin( t * 4 ) ) );
}
function beaconDispose( e )
{
	const B = beacons.get( e );
	if ( !B ) return;
	if ( B.grp.parent ) B.grp.parent.remove( B.grp );
	beacons.delete( e );
}

// ---- a title across the screen (the host's own screen) ----
let bannerEl = null, bannerUntil = 0;
function banner( text, secs = 3 )
{
	if ( !bannerEl )
	{
		bannerEl = document.createElement( 'div' );
		Object.assign( bannerEl.style, { position: 'fixed', left: '0', right: '0', top: '18%', textAlign: 'center', pointerEvents: 'none', zIndex: 99999,
			font: '600 2.1vw GameFont, Ubuntu, sans-serif', color: '#f3e7df', letterSpacing: '0.2em', textShadow: '0 0 0.6vw #b3161a, 0 0.15vw 0.3vw #000', transition: 'opacity 0.4s', opacity: '0' } );
		document.body.appendChild( bannerEl );
	}
	bannerEl.textContent = text.toUpperCase();
	bannerEl.style.opacity = '1';
	bannerUntil = clock() + secs;
	state.lastBanner = text;
}

// ================================================================================================
// ---------- the levels ----------
// ================================================================================================
//
// Each level is a list of the Level Editor's own objects (every tool's template, our values on top): loaded into the
// editor it is an ordinary map you can change and save. World px, y down; the sea's surface at y = 0. Every size
// follows docs/cs-coastal-tower/metrics.md § 2 (a rifleman: jumps 73 px, climbs 140, clears 300 across, drops 400
// safely, climbs out of water onto ≤ 80).

const LEVEL_TITLE = { '01': '01 · Approach' };
const S = ( v )=>String( v );
const Q = ( v )=>"'" + String( v ).replace( /'/g, "\\'" ) + "'";
function levelBuilder()
{
	const tpl = ( i )=>JSON.parse( JSON.stringify( pb2LevelEditor.bWn[ i ].SP.editor_object ) );
	const out = [ { code: '', editor_object: { operation: 'define_global_vars' } } ];
	const push = ( eo )=>{ out.push( { code: '', editor_object: eo } ); return eo; };
	let ix = 0, iy = -1900;
	const icon = ()=>{ ix += 90; if ( ix > 2600 ) { ix = 90; iy -= 90; } return { x: S( ix ), y: S( iy ) }; };
	const B = {
		out,
		world: ( o )=>push( Object.assign( tpl( 2 ), { x: '40', y: '0' }, o ) ),
		call: ( method, bottom = false )=>push( Object.assign( tpl( 23 ), { x: '0', y: '0', method, keep_at_the_bottom: bottom ? '1' : '0', _visible: '0' } ) ),
		skin: ( id, frame )=>push( Object.assign( tpl( 5 ), icon(), { id, frame: S( frame ) } ) ),
		surface: ( id, tex, name, color, o = {} )=>push( Object.assign( tpl( 3 ), icon(), {
			id, texture_container: "pb2Texture.GetTextureByName('" + tex + "')", name: Q( name ), terrain_generation: 'false', foliage_template: 'null', has_cliff: 'false', has_ground: 'false',
			color: 'new pb2HighRangeColor( ' + color + ' )', debris_material: 'pb2Entity.MATERIAL_CONCRETE' }, o ) ),
		// (a background shape needs a background surface: not for walls)
		backSurface: ( id, tex, name, color, o = {} )=>B.surface( id, tex, name, color, Object.assign( { is_for_wall: 'false', geometry_type: 'pb2SurfaceType.TYPE_SIMPLE_BACKGROUND' }, o ) ),
		liquid: ( id, o = {} )=>push( Object.assign( tpl( 11 ), icon(), { id }, o ) ),
		team: ( id, o )=>push( Object.assign( tpl( 17 ), icon(), { id }, o ) ),
		ai: ( id, o )=>push( Object.assign( tpl( 15 ), icon(), { id }, o ) ),
		wall: ( x, y, w, h, m, o = {} )=>push( Object.assign( tpl( 8 ), { x: S( x ), y: S( y ), w: S( w ), h: S( h ), m }, o ) ),
		back: ( x, y, w, h, m, o = {} )=>push( Object.assign( tpl( 9 ), { x: S( x ), y: S( y ), w: S( w ), h: S( h ), m }, o ) ),
		water: ( x, y, w, h, wc )=>push( Object.assign( tpl( 12 ), { x: S( x ), y: S( y ), w: S( w ), h: S( h ), wc } ) ),
		char: ( x, y, o )=>push( Object.assign( tpl( 18 ), { x: S( x ), y: S( y ) }, o ) ),
		gun: ( x, y, type, o = {} )=>push( Object.assign( tpl( 19 ), { x: S( x ), y: S( y ), type: Q( type ) }, o ) ),
		entity: ( x, y, type, o = {} )=>push( Object.assign( tpl( 21 ), { x: S( x ), y: S( y ), type }, o ) ),
		lamp: ( x, y, color, power, scale, o = {} )=>push( Object.assign( tpl( 22 ), { x: S( x ), y: S( y ), color, power: S( power ), scale: S( scale ), flare: 'false' }, o ) ),
		// a Civil Security soldier (skin, gun, AI) standing at (x, feet y), facing `side`; name "… [N+]" for co-op strength
		cs: ( x, feetY, skin, gun, ai, name, side = -1, extra = {} )=>
		{
			const id = 'cs_' + ( ++B.n );
			B.char( x, feetY - 44, Object.assign( { id, skin, team: 'cs', player_controllable: 'false', ai_preset: ai, name: Q( name ), hmax: '150', side: S( side ) }, extra ) );
			if ( gun ) B.gun( x, feetY - 24, gun, { only_allow_for: id } );
			return id;
		},
		n: 0
	};
	return B;
}

// ---- 01 · Approach ----
//
// Night, a storm coming in. The raiders take a CS patrol boat from a picket pontoon and run it east across open water
// towards the Coastal Tower, which grows on the horizon. Sea arches cross the lane (the boat passes under, ≥ 290 px
// clear) with CS snipers, a minigunner and rocket troops on top and searchlights sweeping the water; CS patrol boats
// come out to meet them; a berth over a reef halfway is where a lost boat is replaced. It ends at the shore checkpoint
// at the tower's foot: a pontoon, steps up to the quay (+220), the guard post, the gate.
const L01 = {
	size: [ 0, -1700, 9600, 1150 ],
	seaX: [ 220, 7900 ], seabed: 950,
	pontoon: [ 380, 1080 ],                                                   // the picket pontoon: its deck 40 px above the water
	boat: [ 1320, -60 ],                                                      // the raiders' boat, moored off its end
	arches: [ [ 2600, 3400, -640, -300 ], [ 4800, 5900, -900, -320 ], [ 6400, 6900, -520, -290 ] ],   // x from … to, top, underside
	reef: [ 3800, 4300, 150 ],                                                // a rock under the lane (deep enough: a boat at speed dips its keel)
	shore: { pontoon: [ 7560, 7900 ], deck: -48, quay: [ 7900, 9400 ], top: -220, steps: 6 },          // (deck: level with a boat's)
	right: 9400
};
function level01()
{
	const B = levelBuilder(), L = L01;
	// night: moonlight (the sun, cold and low), a storm sky; lamps do the rest
	B.world( { sun_color: '0x9fb2dc', sun_intensity: '0.3', sky_color: '0x283650', sky_intensity: '0.55', fog_intensity: '0', brightness: '1', raining: 'true', snowing: 'false',
		foreground_snow: 'false', background_snow: 'false', terrain_enabled: 'false', generate_shadowmap: 'true', camera_collisions: 'false', wind_amplitude: '-1.6', wind_random_part: '0.6' } );
	B.call( 'pb2GameWorld.EnableSimplePlayerAssignmentLogic' );
	// skins: the raiders (Marines), Civil Security (Lite, Heavy, Ghost, Boss)
	B.skin( 'skin_raider', 1 ); B.skin( 'skin_cs_lite', 8 ); B.skin( 'skin_cs_heavy', 7 ); B.skin( 'skin_cs_ghost', 12 ); B.skin( 'skin_cs_boss', 11 );
	// surfaces
	// (no terrain generation: with the map's terrain off, a terrain surface stops the walls' mesh being built at all)
	B.surface( 'sea_rock', 'rock_slice', 'Sea rock', '0x9aa0a8', { debris_material: 'pb2Entity.MATERIAL_ROCK' } );
	B.surface( 'cliff', 'mat_cliff', 'Cliff', '0x8a9098', { debris_material: 'pb2Entity.MATERIAL_ROCK' } );
	B.surface( 'seabed', 'mat_sand', 'Seabed', '0x55606a' );
	B.surface( 'deck', 'metal_slice', 'Pontoon deck', '0x8a9098', { debris_material: 'pb2Entity.MATERIAL_METAL' } );
	B.surface( 'concrete', 'platform_texture', 'Quay concrete', '0x7c8086' );
	B.surface( 'hut', 'mat_panel_tile', 'CS panels', '0x8a93a3', { debris_material: 'pb2Entity.MATERIAL_METAL' } );
	B.backSurface( 'bg_rock', 'rock_slice', 'Sea rock (behind)', '0x6c727a' );
	B.backSurface( 'bg_hut', 'mat_panel_tile', 'CS panels (behind)', '0x6a7382' );
	B.backSurface( 'bg_pile', 'mat_plate2_bg', 'Piles (behind)', '0x3a3e46' );
	B.liquid( 'sea', { color: '0x0a2a36', opacity: '0.78', reflection: '0.55' } );
	// teams, AI
	B.team( 'raiders', { title: Q( 'Raiders' ), hud_color: 'new pb2HighRangeColor( 0x6a94ff )', friendly_fire: 'false' } );
	B.team( 'cs', { ai_in_team: 'true', title: Q( 'Civil Security' ), hud_color: 'new pb2HighRangeColor( 0xff4a3a )', friendly_fire: 'false', overheads_visibility: 'pb2OverheadHUD.OVERHEAD_VISIBILITY_TEAMMATES_ONLY' } );
	B.ai( 'cs_post', { skill: '0.75', behavior: 'pb2AIModule.BEHAVIOR_IDLE', hear_range: '700', hunt_random_known_threats_range: '0' } );
	B.ai( 'cs_hunter', { skill: '0.8', behavior: 'pb2AIModule.BEHAVIOR_MPBOT', hear_range: '800', hunt_random_known_threats_range: '1400' } );
	B.ai( 'cs_crew', { skill: '0.7', behavior: 'pb2AIModule.BEHAVIOR_IDLE', hear_range: '900', hunt_random_known_threats_range: '0' } );
	// the edges: a cliff on the left, the seabed, a wall on the right
	B.wall( 0, L.size[ 1 ], L.seaX[ 0 ], L.size[ 3 ] - L.size[ 1 ], 'cliff' );
	B.wall( 0, L.seabed, L.size[ 2 ], L.size[ 3 ] - L.seabed, 'seabed' );
	B.wall( L.right, L.size[ 1 ], L.size[ 2 ] - L.right, L.size[ 3 ] - L.size[ 1 ], 'cliff' );
	for ( const [ x, w, h ] of [ [ 1500, 380, 150 ], [ 2900, 260, 110 ], [ 5200, 420, 190 ], [ 6300, 300, 120 ] ] ) B.wall( x, L.seabed - h, w, h, 'sea_rock' );
	// the sea
	B.water( L.seaX[ 0 ], 0, L.seaX[ 1 ] - L.seaX[ 0 ], L.seabed, 'sea' );
	// the picket pontoon: its deck 40 px up (a swimmer climbs out onto it), piles down to the seabed, a CS hut
	B.wall( L.pontoon[ 0 ], -40, L.pontoon[ 1 ] - L.pontoon[ 0 ], 50, 'deck' );
	for ( let x = L.pontoon[ 0 ] + 30; x < L.pontoon[ 1 ]; x += 160 ) B.back( x, 10, 22, L.seabed - 10, 'bg_pile' );
	B.back( 860, -175, 200, 135, 'bg_hut' );
	B.lamp( 960, -200, '0xffb070', 0.7, 4 );
	B.lamp( 420, -140, '0xffb070', 0.45, 3 );
	B.lamp( 1300, -160, '0xffc890', 0.35, 4 );
	// the raiders: one start (more come in aboard the boat as they join), a rifle and a pistol at their feet
	B.char( 520, -84, { id: 'raider1', skin: 'skin_raider', team: 'raiders', player_controllable: 'true', hmax: '150', side: '1' } );
	B.gun( 540, -64, 'gun_real_rifle' ); B.gun( 580, -64, 'gun_pistol2' );
	// their boat, moored off the pontoon's end; the first checkpoint (a berth) here
	// (twice as tough as a patrol: its crew are one or four players against a string of gunners)
	B.entity( L.boat[ 0 ], L.boat[ 1 ], 'pb2Entity.TYPE_BOAT', { id: 'raider_boat', style_id: '1', side: '1', multiply_health: '2' } );
	// (a berth checkpoint is where a lost boat is replaced: on open water, clear of the pontoon)
	B.entity( L.boat[ 0 ], 0, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '1' } );
	// the sea arches: rock over the lane (legs drawn behind it), CS posts on top, searchlights
	for ( let i = 0; i < L.arches.length; i++ )
	{
		const [ x0, x1, top, under ] = L.arches[ i ];
		// the span: a slab, its crown sloping down at both ends, haunches under its ends (the lane between them keeps
		// the full clearance), the legs drawn behind the lane
		const slope = Math.min( 160, ( x1 - x0 ) / 5 ), crown = 70, haunch = 70;
		B.wall( x0 + slope, top, x1 - x0 - 2 * slope, crown, 'sea_rock' );
		B.wall( x0, top, slope, crown, 'sea_rock', { corner: 'pb2Shape.CORNER_RIGHT_TOP' } );
		B.wall( x1 - slope, top, slope, crown, 'sea_rock', { corner: 'pb2Shape.CORNER_LEFT_TOP' } );
		B.wall( x0, top + crown, x1 - x0, under - top - crown, 'sea_rock' );
		B.wall( x0, under, 150, haunch, 'sea_rock', { corner: 'pb2Shape.CORNER_LEFT_BOTTOM' } );
		B.wall( x1 - 150, under, 150, haunch, 'sea_rock', { corner: 'pb2Shape.CORNER_RIGHT_BOTTOM' } );
		B.back( x0 + 20, under - 10, 150, L.seabed - under + 10, 'bg_rock' );
		B.back( x1 - 170, under - 10, 150, L.seabed - under + 10, 'bg_rock' );
		// its searchlight at the end the raiders come from, out over the water they come across
		B.entity( x0 + slope + 30, top, 'pb2Entity.TYPE_CS_SEARCHLIGHT', { style_id: '1', rotation: '-48', side: '1' } );
		// a red warning lamp at its end, work lights on top, the lane lit cold under it
		B.lamp( x0 + 60, top - 40, '0xff3020', 0.4, 2 );
		B.lamp( ( x0 + x1 ) / 2 - 120, top - 120, '0xffc080', 0.55, 6 );
		B.lamp( ( x0 + x1 ) / 2, under + 90, '0xa8c0ff', 0.4, 6 );
	}
	const [ A, Bq, C ] = L.arches;
	B.cs( A[ 0 ] + 180, A[ 2 ], 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman', -1 );
	B.cs( A[ 1 ] - 150, A[ 2 ], 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( Bq[ 0 ] + 260, Bq[ 2 ], 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy', -1 );
	B.cs( Bq[ 1 ] - 260, Bq[ 2 ], 'skin_cs_lite', 'gun_rl', 'cs_post', 'CS Rocketeer', -1 );
	B.cs( Bq[ 0 ] + 520, Bq[ 2 ], 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman [2+]', -1 );
	B.cs( C[ 0 ] + 200, C[ 2 ], 'skin_cs_lite', 'gun_gl', 'cs_post', 'CS Grenadier', -1 );
	// a ruined watch post on the big arch: a back wall and a roof to shoot from under
	B.back( Bq[ 0 ] + 380, Bq[ 2 ] - 170, 300, 170, 'bg_hut' );
	B.wall( Bq[ 0 ] + 360, Bq[ 2 ] - 190, 340, 22, 'concrete' );
	B.wall( Bq[ 0 ] + 360, Bq[ 2 ] - 168, 20, 60, 'concrete' );
	// a rock rising under the lane (150 down: a boat at 540 px/s pitches its keel well below its 17 px draft — at 45
	// down it struck); a berth checkpoint over it
	B.wall( L.reef[ 0 ], L.reef[ 2 ], L.reef[ 1 ] - L.reef[ 0 ], L.seabed - L.reef[ 2 ], 'sea_rock' );
	B.lamp( ( L.reef[ 0 ] + L.reef[ 1 ] ) / 2, -60, '0x60ff90', 0.35, 3 );                 // (a buoy light over it)
	B.entity( ( L.reef[ 0 ] + L.reef[ 1 ] ) / 2, 0, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '1' } );
	// CS patrol boats: a helmsman and a gunner each (the boat itself has no team: a boat given one has no seats); the
	// autopilot drives them, the gunner works the boat's gun. Kill the crew and the boat is yours.
	const eboat = ( id, x, name )=>
	{
		B.entity( x, -60, 'pb2Entity.TYPE_BOAT', { id, style_id: '1', side: '-1', multiply_health: '0.5' } );
		B.cs( x, -60, 'skin_cs_lite', null, 'cs_crew', name + ' helm', -1, { driver_of: id } );
		B.cs( x, -60, 'skin_cs_lite', null, 'cs_crew', name + ' gunner', -1, { driver_of: id } );
	};
	// (each keeps to its beat: from its start 1,500 px back towards the players, never forward of its start)
	eboat( 'cs_boat1', 3620, 'Patrol 1' );
	eboat( 'cs_boat2', 6100, 'Patrol 2' );
	eboat( 'cs_boat3', 7000, 'Patrol 3 [2+]' );
	eboat( 'cs_boat4', 5300, 'Patrol 4 [3+]' );
	// the shore: a jetty, its deck 48 px up, then six 29 px steps to the quay (+220), the checkpoint compound.
	// (Level with a Patrol Boat's deck and sheer, so the boat noses up to it by its bow's tip — lower, its raked bow rides
	// up the edge and can't back off — and you walk straight off onto it. Its front is a slab over a water bay, then a
	// hatch open to the sky, then a step up out of the water: a docked boat's bow covers the water in front of the jetty,
	// so a swimmer there — or one who dives under the boat — swims in under the slab (30 px of air), comes up in the
	// hatch and climbs out. Walkers cross the 30 px hatch in their stride. Solid everywhere else, down to the seabed:
	// nowhere under it ends at a wall.)
	const sh = L.shore, top = sh.top, run = 36, x0 = sh.pontoon[ 0 ], slab = 60, hatch = 30, step = 30, x1 = x0 + slab + hatch + step;
	B.wall( x0, sh.deck, slab, 18, 'deck' );                                                   // the slab over the bay
	B.wall( x0 + slab + hatch, sh.deck / 2, step, L.seabed - sh.deck / 2, 'concrete' );          // the step out of the water (24 px)
	B.wall( x1, sh.deck, sh.pontoon[ 1 ] - x1, 25, 'deck' );                                    // the jetty's deck (48 px)
	B.wall( x1, sh.deck + 25, sh.pontoon[ 1 ] - x1, L.seabed - sh.deck - 25, 'concrete' );
	for ( let i = 0; i < sh.steps; i++ )
	{
		const x = sh.pontoon[ 1 ] - ( sh.steps - i ) * run, y = Math.round( sh.deck + ( top - sh.deck ) * ( i + 1 ) / sh.steps );
		B.wall( x, y, run, sh.deck - y, 'concrete' );
	}
	B.wall( sh.quay[ 0 ], top, sh.quay[ 1 ] - sh.quay[ 0 ], L.seabed - top, 'concrete' );
	B.entity( sh.quay[ 0 ] + 120, top, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '2' } );
	B.entity( 7300, 0, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '1' } );                     // (the landing's berth: a boat here clears the jetty)
	// the guard post: cover walls (60 px: a crouched rifleman hides), the booth, a searchlight tower, the gate
	B.wall( 8230, top - 60, 30, 60, 'concrete' ); B.wall( 8760, top - 60, 30, 60, 'concrete' );
	B.back( 8380, top - 170, 220, 170, 'bg_hut' ); B.wall( 8360, top - 190, 260, 22, 'concrete' );
	B.back( 8900, top - 420, 26, 420, 'bg_pile' );
	B.entity( 8913, top - 420, 'pb2Entity.TYPE_CS_SEARCHLIGHT', { style_id: '1', rotation: '-30', side: '1' } );
	B.back( 9150, top - 260, 60, 260, 'bg_hut' ); B.back( 9300, top - 260, 60, 260, 'bg_hut' );
	B.entity( 9255, top, 'pb2Entity.TYPE_CS_EXIT', { style_id: '1' } );
	for ( const x of [ 8050, 8450, 8850, 9250 ] ) B.lamp( x, top - 150, '0xffa050', 0.45, 4 );
	for ( const x of [ 8300, 8330, 8700 ] ) B.entity( x, top - 26, 'pb2Entity.TYPE_BARREL', { style_id: '6' } );
	// (one hunter comes down to the landing — more with more players — and the rest hold the quay behind its cover:
	// with all of them on the jetty, the boat's berth was a place to respawn into gunfire)
	B.cs( 8420, top, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( 9020, top, 'skin_cs_boss', 'gun_oicw', 'cs_post', 'CS Sergeant', -1 );                   // (holds the gate)
	B.cs( 8820, top, 'skin_cs_lite', 'gun_real_shotgun', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 9080, top, 'skin_cs_heavy', 'gun_flame', 'cs_post', 'CS Heavy', -1 );
	B.cs( 8560, top, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper [2+]', -1 );
	B.cs( 8980, top, 'skin_cs_lite', 'gun_real_shotgun', 'cs_hunter', 'CS Trooper [3+]', -1 );
	// the tower, far out beyond the gate
	B.entity( 12000, 0, 'pb2Entity.TYPE_CS_TOWER', { style_id: '1' } );
	// moonlight over the water, the quay's glow
	for ( const x of [ 1000, 2800, 4600, 6400, 8200 ] ) B.lamp( x, -700, '0x8fa6d8', 0.28, 18 );
	B.lamp( 7730, -120, '0xffb070', 0.6, 4 );                                                   // (the shore pontoon)
	B.call( 'pb2GameWorld.FinalizeWorld', true );
	return B.out;
}
const LEVELS = { '01': level01 };

// load a level into the open Level Editor (unsaved changes there are offered for saving first)
function loadLevel( id )
{
	if ( !opt( ()=>pb2LevelEditor.the_only_instance ) ) { opt( ()=>pb2Web.NewNote( 'Open the Level Editor first', pb2Web.note_unset ) ); return false; }
	if ( !window.__moreVehicles ) { opt( ()=>pb2Web.NewNote( 'The CS Coastal Tower levels need the More vehicles mod: switch it on in Mods, then reload', pb2Web.note_unset ) ); return false; }
	register();
	const go = ()=>
	{
		try
		{
			pb2LevelEditor.Import( '', LEVELS[ id ](), true, false, true );
			opt( ()=>{ pb2LevelEditor.unsaved_changes = true; } );
			state.level = id;
			opt( ()=>pb2Web.NewNote( ( LEVEL_TITLE[ id ] || id ) + ' loaded — "Play as tester" to play it, then save it as your own map', pb2Web.note_passive ) );
		}
		catch ( e ) { err( 'level ' + id, e ); opt( ()=>pb2Web.NewNote( 'Could not load the level: ' + e.message, pb2Web.note_unset ) ); }
	};
	const ask = opt( ()=>pb2Interfaces.BasicEditorFileManagementClickFunctions.ask_to_save_and_then );
	if ( typeof ask === 'function' ) ask( null, go, pb2LevelEditor ); else go();
	return true;
}
state.levelObjects = ( id )=>LEVELS[ id ] ? LEVELS[ id ]() : null;
state.loadLevel = loadLevel;
state.levelIds = ()=>Object.keys( LEVELS );
state.debug = { buildTower, towerMat, unlitMat, beamMat, glowMat };                  // (the set pieces' makers, for tests in the page)
state.markers = ()=>[ ...marked ].map( ( e )=>Object.assign( {}, estate.get( e ), { body: bodyPos( e ) } ) );

// ================================================================================================
// ---------- the Level Editor: a "CS Tower" button ----------
// ================================================================================================

const ED = { btn: null, parent: null, box: null };
function closeMenu() { for ( const w of ED.box || [] ) opt( ()=>w.remove() ); ED.box = null; }
function editorObject( type, x, y, extra = {} )
{
	const eo = Object.assign( JSON.parse( JSON.stringify( pb2LevelEditor.bWn[ 21 ].SP.editor_object ) ), { x: String( x ), y: String( y ), type }, extra );
	return { code: '', editor_object: eo };
}
function placeInEditor( obj, what )
{
	register();
	try { pb2LevelEditor.dBz[ 'pb3x_cs_tower' ] = [ obj ]; pb2LevelEditor.dqr( 'pb3x_cs_tower' ); opt( ()=>pb2Web.NewNote( what + ' — click where it goes', pb2Web.note_passive ) ); }
	catch ( e ) { err( 'editor', e ); }
}
function openMenu()
{
	if ( ED.box ) return closeMenu();
	const le = ED.parent;
	const items = Object.keys( LEVELS ).map( ( id )=>[ 'Load ' + ( LEVEL_TITLE[ id ] || id ), ()=>loadLevel( id ) ] ).concat( [
		[ 'Coastal Tower backdrop', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_TOWER', 0, 0 ), 'Coastal Tower backdrop (on the waterline, beyond the level\'s end)' ) ],
		[ 'Searchlight', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_SEARCHLIGHT', 0, 0, { rotation: '0' } ), 'Searchlight (Rotation: where it points, from straight down)' ) ],
		[ 'Checkpoint (berth)', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_CHECKPOINT', 0, 0, { style_id: '1' } ), 'Berth checkpoint (on the water: a lost boat is replaced here)' ) ],
		[ 'Checkpoint (on foot)', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_CHECKPOINT', 0, 0, { style_id: '2' } ), 'Checkpoint (on the floor)' ) ],
		[ 'Level exit', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_EXIT', 0, 0 ), 'Level exit (on the floor)' ) ]
	] );
	const W = 330, H = 29, gap = 5, pad = 8;
	const panel = opt( ()=>pb2Interfaces.bvk );
	const x2 = panel && panel.x > 400 ? panel.x - 8 : ED.btn.x2, x = x2 - W, y = le.y2 - 1;
	const plate = pb2Window.CreateWindow( { x, y, w: W, h: pad * 2 + items.length * ( H + gap ) - gap, parent: le, type: pb2Window.HUD_RECT, corners: [ 8, 0, 8, 0 ], wt: true, fX: new pb2HighRangeColor().setRGB( 0.05, 0.05, 0.07 ) } );
	opt( ()=>{ plate.mat.opacity = 0.92; } );
	ED.box = [ plate ].concat( items.map( ( [ caption, fn ], i )=>pb2Window.CreateWindow( { x: x + pad, y: y + pad + i * ( H + gap ), w: W - pad * 2, h: H, parent: le, type: pb2Window.BUTTON, caption, onClick: ()=>{ setTimeout( ()=>{ closeMenu(); fn(); }, 0 ); } } ) ) );
}
function editorButton()
{
	const le = opt( ()=>pb2LevelEditor.the_only_instance && pb2Interfaces.level_editor ) || null;
	if ( !le ) { if ( ED.box ) closeMenu(); ED.btn = null; ED.parent = null; return; }
	if ( ED.btn && ED.parent === le && !ED.btn.is_being_removed && le.childs.indexOf( ED.btn ) !== -1 ) return;
	for ( const c of ( le.childs || [] ).slice() ) if ( c && c !== ED.btn && c.type === pb2Window.BUTTON && opt( ()=>c.caption_sync_data[ 1 ] ) === 'CS Tower' ) opt( ()=>c.remove() );
	// (after the guide's button, and after the Bosses button when that mod is on)
	let x = 1810;
	const guide = opt( ()=>pb2Interfaces.Rf );
	if ( guide && guide.parent === le ) x = guide.x2 + 10;
	for ( const c of le.childs || [] ) if ( c && c.type === pb2Window.BUTTON && opt( ()=>c.caption_sync_data[ 1 ] ) === 'Bosses' ) x = Math.max( x, c.x2 + 10 );
	try
	{
		ED.btn = pb2Window.CreateWindow( { x, y: 10, w: 110, h: pb2Interfaces.blS, parent: le, type: pb2Window.BUTTON, caption: 'CS Tower', onClick: ()=>{ setTimeout( openMenu, 0 ); } } );
		ED.parent = le;
	}
	catch ( e ) { err( 'editor button', e ); }
}

// ================================================================================================
// ---------- every frame ----------
// ================================================================================================

let lastTicks = 0, lastBoots, lastFrame = performance.now();
function frame( nowMs )
{
	if ( window.__csTower !== state || state.disposed ) return;
	requestAnimationFrame( frame );
	const dt = Math.min( 0.05, Math.max( 0, ( nowMs - lastFrame ) / 1000 ) );
	lastFrame = nowMs;
	try
	{
		if ( !state.registered || !state.editor ) register();
		editorButton();
		hookRender();
		const scene = opt( ()=>pb2_mp.scene ) || null;
		const ents = opt( ()=>pb2Entity.entities ) || [];
		// a new level: the world rebuilt (its clock restarted)
		const ticks = opt( ()=>pb2_mp.ticks_passed ) || 0, boots = opt( ()=>pb2GameWorld.reboots );
		if ( ticks < lastTicks || boots !== lastBoots ) newLevel();
		lastTicks = ticks; lastBoots = boots;
		const t = clock();
		for ( const e of [ ...marked ] )
		{
			const s = estate.get( e );
			if ( !s || e.is_being_removed || ents.indexOf( e ) === -1 || !scene )
			{
				towerDispose( e ); searchlightDispose( e ); beaconDispose( e );
				if ( !s || e.is_being_removed || ents.indexOf( e ) === -1 ) marked.delete( e );
				continue;
			}
			hideBase( e );
			const p = bodyPos( e );
			if ( p && isFinite( p[ 0 ] ) && Math.abs( p[ 0 ] ) < 1e7 ) { s.x = p[ 0 ]; s.y = p[ 1 ]; }
			if ( s.kind === 'tower' ) towerVisual( e, scene, dt, t );
			else if ( s.kind === 'searchlight' ) searchlightVisual( e, scene, dt, t );
			else beaconVisual( e, scene, dt, t );
		}
		if ( isHost() && scene && ents.length ) hostTick( dt );
		if ( bannerEl && bannerUntil && t > bannerUntil ) { bannerEl.style.opacity = '0'; bannerUntil = 0; }
		if ( state.registered && state.status === 'waiting for the game engine' ) state.status = 'ready';
	}
	catch ( e ) { err( 'frame', e ); }
}
requestAnimationFrame( frame );

state.dispose = ()=>
{
	state.disposed = true;
	for ( const e of [ ...marked ] ) { towerDispose( e ); searchlightDispose( e ); beaconDispose( e ); }
	closeMenu(); if ( ED.btn ) opt( ()=>ED.btn.remove() );
	if ( bannerEl ) bannerEl.remove();
	unhookAll();
};
