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

const T_TOWER = 120, T_SEARCHLIGHT = 121, T_CHECKPOINT = 122, T_EXIT = 123, T_LADDER = 124, T_OBJECTIVE = 125, T_BRIDGE = 126;
const TYPES = [
	{ id: T_TOWER, konst: 'pb2Entity.TYPE_CS_TOWER', name: 'Coastal Tower backdrop', list: true },
	{ id: T_SEARCHLIGHT, konst: 'pb2Entity.TYPE_CS_SEARCHLIGHT', name: 'Searchlight', list: true },
	{ id: T_CHECKPOINT, konst: 'pb2Entity.TYPE_CS_CHECKPOINT', name: 'Checkpoint', list: true },
	{ id: T_EXIT, konst: 'pb2Entity.TYPE_CS_EXIT', name: 'Level exit', list: true },
	{ id: T_LADDER, konst: 'pb2Entity.TYPE_CS_LADDER', name: 'Ladder', list: true },
	{ id: T_OBJECTIVE, konst: 'pb2Entity.TYPE_CS_OBJECTIVE', name: 'Objective', list: true },
	{ id: T_BRIDGE, konst: 'pb2Entity.TYPE_CS_BRIDGE', name: 'Underhang bridge set', list: true }
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
// All are markers the level places: no body to bump into, never moved, can't be hurt. What they are is drawn by this
// mod (the tower, the beams, the beacons, ladders, consoles, the Underhang bridge) and what they do runs on the host
// (see the host logic below). A ladder runs from its marker (the top) down to its To Y; an objective is a console.

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
	estate.set( e, { kind, style: style | 0 || 1, side: ( +params.side || 1 ) < 0 ? -1 : 1, rot: +params.rotation || 0, x: +params.x || 0, y: +params.y || 0, on: 0,
		toy: isFinite( +params.toy ) && params.toy !== null && params.toy !== '' ? +params.toy : null } );
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
	const kind = { [ T_TOWER ]: 'tower', [ T_SEARCHLIGHT ]: 'searchlight', [ T_CHECKPOINT ]: 'checkpoint', [ T_EXIT ]: 'exit', [ T_LADDER ]: 'ladder', [ T_OBJECTIVE ]: 'objective', [ T_BRIDGE ]: 'bridge' }[ t.id ];
	const title = { tower: 'Coastal Tower', searchlight: 'Searchlight', checkpoint: 'Checkpoint', exit: 'Exit', ladder: 'Ladder', objective: 'Objective', bridge: 'Underhang bridge' }[ kind ];
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
// objectives: Style ID 1 the cliff facility's power, 2 the command room, 3 the bunker basement
const OBJ = { hold: 5, reach: 60, names: [ '', 'Cliff power', 'Command room', 'Basement' ], verbs: [ '', 'Cutting the power', 'Taking the command room', 'Sabotaging the basement' ] };
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
	// (not one with a living bot anywhere aboard: a patrol whose helm is dead but whose gunner fights on is still theirs)
	const boats = ents.filter( ( e )=>isBoat( e ) && !e.team && !seatsOf( e ).some( ( st )=>st && alive( st.owner_character ) && !isPlayer( st.owner_character ) ) );
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
	for ( const e of marked ) { const s = estate.get( e ); if ( s && ( s.kind === 'checkpoint' || s.kind === 'objective' ) ) { s.on = 0; s.progress = 0; } }
	state.objectives = null;
}
function hostTick( dt )
{
	const players = livingPlayers();
	// who plays as what: the first player character is the template for those who come back
	// (a character's skin and team are its ragdoll's)
	if ( !host.template && players.length ) { const c = players[ 0 ]; host.template = { skin: opt( ()=>c.ragdoll.kN ), team: opt( ()=>c.ragdoll.team ), hmax: c.hmax || 150 }; }
	// co-op strength, once the match has settled (its players connected)
	if ( !host.scaled && clock() - host.since > 4 ) { host.scaled = true; coopScale( Math.max( 1, connections().length ) ); }
	// checkpoints: lit by the first player to pass them where they are — a berth by a player on the water at or past it,
	// one on foot by a player on its floor at it (or crossing it between two frames). By x alone, a player on the deck
	// would light the berths and caps below it and come back among enemies they never met.
	const cps = markers( 'checkpoint' ).sort( ( a, b )=>estate.get( a ).x - estate.get( b ).x );
	const passes = ( s )=>( c )=>
	{
		const dy = Math.abs( c.y + 44 - s.y );
		if ( s.style === 1 ) return dy < 260 && c.x >= s.x - 40;
		const was = host.lastX.get( c );
		return dy < 120 && ( Math.abs( c.x - s.x ) < 150 || ( was !== undefined && ( was - s.x ) * ( c.x - s.x ) <= 0 ) );
	};
	for ( const e of cps )
	{
		const s = estate.get( e );
		if ( s.on ) continue;
		if ( players.some( passes( s ) ) )
		{
			s.on = 1; state.checkpoint = { x: s.x, y: s.y, style: s.style };
			banner( 'Checkpoint', 2.2 );
			sfx( 's_corvette_alert', s.x, s.y, 0.5, 1.2 );
		}
	}
	// objectives: a player holds position at the console for OBJ.hold s (the time runs back slowly when nobody's there)
	const objs = markers( 'objective' );
	for ( const e of objs )
	{
		const s = estate.get( e );
		if ( s.on >= 100 ) continue;
		const here = players.some( ( c )=>Math.abs( c.x - s.x ) < OBJ.reach && Math.abs( c.y + 44 - s.y ) < 90 );
		// (on the clock, not the frame's dt: that's capped, and a slow machine would take far longer than OBJ.hold)
		const now = clock(), step = Math.min( 3, Math.max( 0, now - ( s.tick || now ) ) ); s.tick = now;
		s.progress = clamp( ( s.progress || 0 ) + ( here ? step : -step * 0.25 ), 0, OBJ.hold );
		s.on = s.progress >= OBJ.hold ? 100 : Math.floor( 99 * s.progress / OBJ.hold );
		if ( s.on >= 100 )
		{
			const left = objs.filter( ( o )=>estate.get( o ).on < 100 ).length;
			banner( OBJ.names[ s.style ] + ' — done' + ( left ? ' (' + left + ' to go)' : ': get to the extraction' ), 4 );
			sfx( 's_corvette_alert', s.x, s.y, 0.7, 0.8 );
			state.objectives = objs.map( ( o )=>estate.get( o ).on );
		}
		else if ( here && clock() - ( s.said || 0 ) > 0.6 ) { s.said = clock(); banner( OBJ.verbs[ s.style ] + ' ' + s.on + '%', 0.9 ); }
	}
	const openObjectives = objs.filter( ( e )=>estate.get( e ).on < 100 ).length;
	// the exit: reached by a living player (or crossed: between two frames a runner can cover more than its width), once
	// every objective is done
	for ( const e of markers( 'exit' ) )
	{
		const s = estate.get( e );
		const at = ( c )=>{ const was = host.lastX.get( c ); return Math.abs( c.y - s.y ) < 140 && ( Math.abs( c.x - s.x ) < 70 || ( was !== undefined && ( was - s.x ) * ( c.x - s.x ) <= 0 ) ); };
		s.locked = openObjectives > 0;
		if ( !state.complete ) s.on = s.locked ? 2 : 0;                            // (guests see the lock through on)
		if ( state.complete || !players.some( at ) ) continue;
		if ( s.locked ) { if ( clock() - ( s.said || 0 ) > 3 ) { s.said = clock(); banner( 'The extraction opens when every objective is done (' + openObjectives + ' to go)', 2.5 ); } continue; }
		state.complete = true; s.on = 1; host.completeAt = clock();
		banner( LEVEL_TITLE[ state.level ] ? LEVEL_TITLE[ state.level ] + ' — cleared' : 'Level cleared', 6 );
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
			// (at the furthest berth reached; the first one before any)
			const berths = markers( 'checkpoint' ).map( ( e )=>estate.get( e ) ).filter( ( c )=>c.style === 1 );
			const cp = berths.filter( ( c )=>c.on ).sort( ( a, b )=>b.x - a.x )[ 0 ] || berths.sort( ( a, b )=>a.x - b.x )[ 0 ];
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
		try { ladders(); } catch ( e ) { err( 'ladders', e ); }
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
		for ( const c of players ) { const d = Math.hypot( c.x - p[ 0 ], ( c.y - p[ 1 ] ) * 1.5 ); if ( d < best ) { best = d; tgt = c; } }
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
// ---- ladders ----
//
// A ladder runs from its marker (its top) down to its To Y. A character in its shaft who holds up (W) or down (S) takes
// hold: then up and down climb at LAD.speed, nothing held keeps them where they are, and left / right move them off it
// (onto a floor beside the top, or away). The engine has no climbing of its own, so the character's body is moved
// straight: shifted by speed × the time since the last tick (the wall clock: a slow machine takes big physics steps,
// and a velocity set once a tick is lost to gravity between them), its velocity zeroed. The host moves everyone; a guest
// moves its own character too, so its view doesn't wait for the host.
const LAD = { half: 28, water: 55, speed: 260, side: 150, pull: 8, below: 90 };
const onLadder = new WeakMap(), ladderT = new WeakMap(), ghosted = new WeakMap();
// (a climber passes through nothing but its shaft; while it climbs its body and gun collide with nothing, so a gun held
// out sideways can't snag a hatch's edge. Put back when it lets go.)
function ghost( ch, on )
{
	if ( on === ghosted.has( ch ) ) return;
	if ( on )
	{
		const saved = [];
		for ( const b of charBodies( ch ) ) for ( const f of fixtures( b ) ) { saved.push( [ f, f.GetFilterData() ] ); f.SetFilterData( pb2_mp.Box2D_filter_nothing ); }
		ghosted.set( ch, saved );
	}
	else { for ( const [ f, d ] of ghosted.get( ch ) || [] ) opt( ()=>f.SetFilterData( d ) ); ghosted.delete( ch ); }
}
// every physics body a character has: its ragdoll's atoms, and the character's own (its capsule and the joints' bodies)
function charBodies( ch )
{
	const out = [];
	for ( const a of opt( ()=>ch.ragdoll.local_atoms ) || [] ) if ( a && a.box2d_body && out.indexOf( a.box2d_body ) === -1 ) out.push( a.box2d_body );
	for ( const k of [ 'box2d_body', 'gy', 'lS' ] ) { const b = opt( ()=>ch[ k ] ); if ( b && typeof b.GetFixtureList === 'function' && out.indexOf( b ) === -1 ) out.push( b ); }
	return out;
}
function setVel( ch, vx, vy )
{
	for ( const b of charBodies( ch ) )
	{
		try { b.SetLinearVelocity( new b2Vec2( vx / 30, vy / 30 ) ); } catch ( e ) { try { b.SetVel( vx / 30, vy / 30 ); } catch ( e2 ) { /* no body */ } }
		opt( ()=>b.SetAwake( true ) );
	}
}
// letting go of a ladder, however it happens: its clock forgotten (else the next climb's first step is a jump), the
// climber solid again
function letGo( ch ) { onLadder.delete( ch ); ladderT.delete( ch ); ghost( ch, false ); }
function ladders()
{
	const list = markers( 'ladder' );
	if ( !list.length ) return;
	const host_ = isHost(), mine = opt( ()=>pb2_mp.my_controller.character ) || null;
	let n = 0;
	for ( const ch of opt( ()=>pb2Character.characters ) || [] )
	{
		if ( !alive( ch ) || ( !host_ && ch !== mine ) ) { if ( onLadder.has( ch ) ) letGo( ch ); continue; }
		const ctl = ch.controller || controllerOf( ch );
		if ( !ctl || !isPlayer( ch ) || opt( ()=>ch.ragdoll.driver_of ) ) { if ( onLadder.has( ch ) ) letGo( ch ); continue; }
		const feet = ch.y + 44;
		let L = onLadder.get( ch ) || null;
		// (a swimmer bobs and drifts: in the water a ladder catches from further off, and pulls them in)
		const inShaft = ( s )=>Math.abs( ch.x - s.x ) < ( feet > -20 ? LAD.water : LAD.half ) && feet > s.y - 40 && feet < ( s.toy === null ? s.y + 300 : s.toy ) + LAD.below;
		if ( L && ( !estate.get( L ) || !inShaft( estate.get( L ) ) ) ) { letGo( ch ); L = null; }
		if ( !L )
		{
			if ( !ctl.act_y ) continue;
			L = list.find( ( e )=>inShaft( estate.get( e ) ) ) || null;
			if ( !L ) continue;
			onLadder.set( ch, L );
		}
		const s = estate.get( L ), bottom = s.toy === null ? s.y + 300 : s.toy;
		const now = clock(), step = clamp( now - ( ladderT.get( ch ) || now ), 0, 0.25 );
		ladderT.set( ch, now );
		let vy = ( ctl.act_y || 0 ) * LAD.speed;
		if ( vy < 0 && feet <= s.y ) vy = 0;                                        // (at the top: step off sideways)
		if ( vy < 0 ) vy = Math.max( vy, ( s.y - feet ) / Math.max( step, 1e-3 ) );   // (and never past it)
		if ( vy > 0 && feet >= bottom ) { letGo( ch ); continue; }                   // (off the foot of it)
		const vx = ctl.act_x ? ctl.act_x * LAD.side : clamp( ( s.x - ch.x ) * LAD.pull, -LAD.side, LAD.side );
		if ( ctl.act_x && !ctl.act_y && Math.abs( ch.x - s.x ) > LAD.half - 6 ) { letGo( ch ); continue; }
		ghost( ch, true );
		opt( ()=>ch.ragdoll.Teleport( vx * step, vy * step ) );
		setVel( ch, 0, 0 );
		n++;
	}
	state.onLadder = n;
}
// ---- far away: out of mind and out of sight ----
//
// A long level holds many Civil Security soldiers, and the engine draws and thinks for every one of them wherever they
// are: in the Underhang the soldiers were two thirds of every frame's draw calls (measured: 1706 with them, 544
// without), most of them off screen. So a soldier far from every player doesn't think (its controller skips its turn,
// its inputs left at rest) until a player comes within FAR.think px, and one off the camera isn't drawn (its meshes
// hidden just before each render, put back as it comes into view).
const FAR = { thinkX: 2600, thinkY: 1500, margin: 320 };
// (the game's objects are sealed: nothing is added to them — what we keep about them lives in these maps)
const asleep = new WeakSet(), hidByUs = new WeakSet();
function hookSleep()
{
	const P = opt( ()=>pb2Controller.prototype );
	if ( !P || typeof P._bm !== 'function' ) return;
	hookFn( P, '_bm', ( orig )=>function()
	{
		if ( asleep.has( this ) ) { this.act_x = 0; this.act_y = 0; this.act_fire = 0; this.act_fire2 = 0; return; }
		return orig.apply( this, arguments );
	} );
}
function sleepFar()
{
	hookSleep();
	const players = livingPlayers();
	let n = 0;
	for ( const c of opt( ()=>pb2Character.characters ) || [] )
	{
		if ( !alive( c ) || isPlayer( c ) ) continue;
		const k = c.controller;
		if ( !k ) continue;
		const near = !players.length || players.some( ( p )=>Math.abs( p.x - c.x ) < FAR.thinkX && Math.abs( p.y - c.y ) < FAR.thinkY );
		if ( near ) asleep.delete( k ); else { asleep.add( k ); n++; }
	}
	state.asleep = n;
}
// The game draws every object wherever it is (its meshes are marked not to be frustum culled), so what's far off the
// camera — our ladders, beacons, consoles and searchlights, and the vehicles' models — is hidden just before each render
// and shown again as it comes into view (only what we hid is shown again). The soldiers are left to the engine: it shows
// and hides their parts itself, and they're a small share once the far ones are asleep.
function cullFar()
{
	const cam = camera();
	if ( !cam ) return;
	cullOwn( cam );
}

const offCam = ( cam, x, y, extra = 0 )=>{ const k = Math.max( 1, cam.position.z ) / 820 * ( window.__shotZoom || 1 ); return Math.abs( x - cam.position.x ) > 604 * k + FAR.margin + extra || Math.abs( -y - cam.position.y ) > 340 * k + FAR.margin + extra; };
function cullOwn( cam )
{
	// ours: shown or hidden outright (a ladder by its middle, its half-length allowed for)
	ladderGfx.forEach( ( G, e )=>{ const s = estate.get( e ); if ( s ) G.grp.visible = !offCam( cam, s.x, s.y + G.len / 2, G.len / 2 ); } );
	for ( const m of [ consoles, beacons, lights ] ) m.forEach( ( G, e )=>{ const s = estate.get( e ), g = G.grp; if ( s && g ) g.visible = !offCam( cam, s.x, s.y, m === lights ? SL.len : 0 ); } );
	// everything else that is a compact model at the top of the scene — a vehicle (the More vehicles mod draws each with
	// groups of its own), a prop — by where it stands; the level's own geometry spans the level and is never touched,
	// nor are single meshes (effects come and go on their own). Put back only if we hid it.
	const now = clock();
	for ( const o of opt( ()=>pb2_mp.scene.children ) || [] )
	{
		if ( !o || ( o.userData && o.userData.csOwn ) ) continue;
		let E = extent.get( o );
		if ( !E || now - E.at > 5 )
		{
			let n = 0; o.traverse( ( m )=>{ if ( m.isMesh ) n++; } );
			let r = Infinity;
			if ( n >= 3 ) { const b = new THREE.Box3().setFromObject( o ); if ( !b.isEmpty() ) r = Math.max( b.max.x - b.min.x, b.max.y - b.min.y ); }
			E = { n, r, at: now }; extent.set( o, E );
		}
		if ( E.n < 3 || !( E.r < 1500 ) ) continue;
		const m = o.matrixWorld.elements;
		// (the whole model at its root: the vehicle mods show and hide their models' parts, never the roots — and this
		// game's renderer ignores layer masks, so visible it is)
		const off = offCam( cam, m[ 12 ], -m[ 13 ], 600 );
		if ( off ) { if ( o.visible && !hidByUs.has( o ) ) { o.visible = false; hidByUs.add( o ); } }
		else if ( hidByUs.has( o ) ) { o.visible = true; hidByUs.delete( o ); }
	}
}
const extent = new WeakMap();
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
	root.userData.csOwn = true;
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
		try { placeTowers(); placeBridge(); } catch ( e ) { err( 'placeTowers', e ); }
		try { if ( markers( 'bridge' ).length ) cullFar(); } catch ( e ) { err( 'cullFar', e ); }
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
		grp.userData.csOwn = true;
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
		grp.userData.csOwn = true;
		B = { grp, lamp, halo };
		beacons.set( e, B );
	}
	if ( B.grp.parent !== scene ) scene.add( B.grp );
	B.grp.position.set( s.x, -s.y, 10 );
	const col = s.kind === 'exit' ? ( s.on === 1 ? 0x40ff80 : s.on === 2 ? 0xff3020 : 0x40c0ff ) : ( s.on ? 0x40ff80 : 0xffb030 );
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

// ---- ladders: two rails and rungs, just behind the characters ----
const ladderGfx = new Map();
function ladderVisual( e, scene )
{
	const s = estate.get( e );
	let G = ladderGfx.get( e );
	const bottom = s.toy === null ? s.y + 300 : s.toy, len = Math.max( 40, bottom - s.y );
	if ( !G || G.len !== len )
	{
		if ( G ) ladderDispose( e );
		const grp = new THREE.Group(), m = unlitMat( 0x9a8540 ), dark = unlitMat( 0x5a5448 );
		for ( const dx of [ -16, 16 ] ) { const r = new THREE.Mesh( new THREE.BoxBufferGeometry( 4, len, 4 ), m ); r.position.set( dx, -len / 2, 0 ); grp.add( r ); }
		for ( let y = 14; y < len; y += 30 ) { const r = new THREE.Mesh( new THREE.BoxBufferGeometry( 32, 3, 3 ), dark ); r.position.set( 0, -y, 0 ); grp.add( r ); }
		mergeStatic( grp, new Set() );
		grp.userData.csOwn = true;
		G = { grp, len, mats: [ m, dark ] };
		ladderGfx.set( e, G );
	}
	if ( G.grp.parent !== scene ) scene.add( G.grp );
	G.grp.position.set( s.x, -s.y, -26 );
}
function ladderDispose( e )
{
	const G = ladderGfx.get( e );
	if ( !G ) return;
	if ( G.grp.parent ) G.grp.parent.remove( G.grp );
	G.grp.traverse( ( o )=>{ if ( o.geometry ) o.geometry.dispose(); } );
	for ( const m of G.mats ) m.dispose();
	ladderGfx.delete( e );
}

// ---- objectives: a console, its screen red until it's done (then green), a column of light over it ----
const consoles = new Map();
function consoleVisual( e, scene, dt, t )
{
	const s = estate.get( e );
	let C = consoles.get( e );
	if ( !C )
	{
		const grp = new THREE.Group();
		const body = new THREE.Mesh( new THREE.BoxBufferGeometry( 50, 56, 30 ), unlitMat( 0x2c2e33 ) ); body.position.set( 0, 28, -20 );
		const screen = new THREE.Mesh( new THREE.PlaneBufferGeometry( 38, 24 ), unlitMat( 0xff3020 ) ); screen.position.set( 0, 40, -4 );
		const bar = new THREE.Mesh( new THREE.PlaneBufferGeometry( 38, 4 ), unlitMat( 0x40ff80 ) ); bar.position.set( 0, 22, -4 );
		const beam = new THREE.Mesh( new THREE.CylinderBufferGeometry( 22, 22, 260, 16, 1, true ), beamMat( 0xff4030, 0.6 ) ); beam.position.set( 0, 150, -20 );
		grp.add( body ); grp.add( screen ); grp.add( bar ); grp.add( beam );
		grp.userData.csOwn = true;
		C = { grp, screen, bar, beam };
		consoles.set( e, C );
	}
	if ( C.grp.parent !== scene ) scene.add( C.grp );
	C.grp.position.set( s.x, -s.y, 0 );
	const done = s.on >= 100, k = Math.min( 1, s.on / 100 );
	setColor( C.screen.material, done ? 0x40ff80 : ( ( t * 2 ) % 1 < 0.5 ? 0xff3020 : 0x9a1810 ) );
	C.bar.scale.x = Math.max( 0.001, k ); C.bar.position.x = -19 * ( 1 - k );
	setColor( C.beam.material, done ? 0x40ff80 : 0xff4030, HALF * ( done ? 0.35 : 0.6 ) );
}
function consoleDispose( e )
{
	const C = consoles.get( e );
	if ( !C ) return;
	if ( C.grp.parent ) C.grp.parent.remove( C.grp );
	consoles.delete( e );
}

// ---- the Underhang bridge (Style ID 6): what the walls can't be ----
//
// The walls are the level: floors, pier caps, slabs, rooms. This draws the bridge around them, from the level's own
// layout (LAYOUTS): each leg's twin columns and bracing standing on a massive footing at the waterline — behind the boat
// lane (in side view a footing in the lane would block it: it's drawn behind, where the concept has it) — the soffit's
// girders, pipes and lamps, the cables of the hanging containers, yellow railings, the cranes, the crown of the tower
// numbered 4 with its orange CS banners, and the dusk hills far behind in the mist. Built once, merged into one mesh
// per material. Nothing here collides: it's all behind the play plane (z < −150) or thin.
const DUSK = { key: 0xe0b894, dir: [ -0.55, 0.5, 0.65 ], sky: 0x6a6272, haze: 0xa2949e };
function duskU( hazeAmt )
{
	return { moon: { value: new THREE.Color( DUSK.key ) }, moonDir: { value: new THREE.Vector3( DUSK.dir[ 0 ], DUSK.dir[ 1 ], DUSK.dir[ 2 ] ) }, sky: { value: new THREE.Color( DUSK.sky ) },
		haze: { value: new THREE.Color( DUSK.haze ) }, hazeAmt: { value: hazeAmt } };
}
// the tower's number, stencilled
const numberTex = ( n )=>canvasTex( 'number' + n, 256, 256, ( g, w, h )=>
{
	g.fillStyle = '#3a3a3e'; g.fillRect( 0, 0, w, h );
	g.fillStyle = '#4a4a50'; g.fillRect( 12, 12, w - 24, h - 24 );
	g.fillStyle = '#d8d4cc'; g.font = 'bold 190px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
	g.fillText( String( n ), w / 2, h / 2 + 10 );
	g.fillStyle = '#4a4a50'; for ( let y = 40; y < h; y += 46 ) g.fillRect( 0, y, w, 5 );                 // (stencil bridges)
}, [ 1, 1 ] );
// the CS banner in the concept's orange
const orangeBannerTex = ()=>canvasTex( 'banner-orange', 128, 512, ( g, w, h )=>
{
	g.fillStyle = '#a8440e'; g.fillRect( 0, 0, w, h );
	g.fillStyle = '#d8641c'; g.fillRect( 8, 0, w - 16, h );
	g.fillStyle = '#f4ece4'; g.font = 'bold 64px Arial, sans-serif'; g.textAlign = 'center'; g.fillText( 'CS', w / 2, 150 );
	g.strokeStyle = '#f4ece4'; g.lineWidth = 6; g.beginPath(); g.moveTo( 26, 200 ); g.lineTo( w / 2, 300 ); g.lineTo( w - 26, 200 ); g.stroke();
	g.beginPath(); g.moveTo( 26, 250 ); g.lineTo( w / 2, 350 ); g.lineTo( w - 26, 250 ); g.stroke();
	g.fillStyle = 'rgba(0,0,0,0.25)'; for ( let y = 0; y < h; y += 5 ) g.fillRect( 0, y, w, 1 );
}, [ 1, 1 ] );
// hills in the mist: three ridges, each lighter (further) than the one in front
const hillsTex = ( seed, tone )=>canvasTex( 'hills' + seed, 2048, 256, ( g, w, h )=>
{
	g.clearRect( 0, 0, w, h );
	let r = seed; const rnd = ()=>( r = ( r * 16807 ) % 2147483647 ) / 2147483647;
	g.fillStyle = tone;
	g.beginPath(); g.moveTo( 0, h );
	let y = h * 0.55;
	for ( let x = 0; x <= w; x += 16 ) { y = clamp( y + ( rnd() - 0.5 ) * 26 + Math.sin( x / 190 + seed ) * 4, h * 0.12, h * 0.85 ); g.lineTo( x, y ); }
	g.lineTo( w, h ); g.closePath(); g.fill();
	// (a few pines on the ridge)
	// (a few soft pines on the ridge, half lost in the mist)
	g.globalAlpha = 0.55;
	for ( let i = 0; i < 36; i++ ) { const x = rnd() * w, b = h * ( 0.4 + rnd() * 0.45 ); g.beginPath(); g.moveTo( x - 7, b ); g.lineTo( x, b - 14 - rnd() * 12 ); g.lineTo( x + 7, b ); g.fill(); }
	g.globalAlpha = 1;
}, [ 1, 1 ] );
const bridges = new Map();
function buildBridge( L )
{
	const U = duskU( 0.14 ), Uback = duskU( 0.32 );
	const root = new THREE.Group(), far = new THREE.Group(), mats = [];
	const mat = ( c, u = U )=>{ const m = towerMat( c, u ); mats.push( m ); return m; };
	const M = { concrete: mat( 0x8a847c ), dark: mat( 0x4a4640 ), steel: mat( 0x6a655e ), rust: mat( 0x7a5a44 ), black: mat( 0x26241f ), yellow: mat( 0xb89a3a ), orange: mat( 0xb0582a ),
		back: mat( 0x5c5750, Uback ), backDark: mat( 0x3c3935, Uback ) };
	const glows = {}, glow = ( c, o = 1 )=>glows[ c + '/' + o ] || ( glows[ c + '/' + o ] = mats[ mats.push( unlitMat( c, o, true ) ) - 1 ] );
	// a box by its extents in game px (y down) and z (towards the camera)
	const B = ( x0, y0, x1, y1, z0, z1, m, parent = root )=>
	{
		const o = new THREE.Mesh( new THREE.BoxBufferGeometry( Math.abs( x1 - x0 ), Math.abs( y1 - y0 ), Math.abs( z1 - z0 ) ), m );
		o.position.set( ( x0 + x1 ) / 2, -( y0 + y1 ) / 2, ( z0 + z1 ) / 2 ); parent.add( o ); return o;
	};
	// a strut from (x0, y0) to (x1, y1) at depth z
	const strut = ( x0, y0, x1, y1, z, t, m )=>
	{
		const len = Math.hypot( x1 - x0, y1 - y0 );
		const o = new THREE.Mesh( new THREE.BoxBufferGeometry( len, t, t ), m );
		o.position.set( ( x0 + x1 ) / 2, -( y0 + y1 ) / 2, z ); o.rotation.z = -Math.atan2( y1 - y0, x1 - x0 ); root.add( o ); return o;
	};
	const cyl = ( r, x0, x1, y, z, m )=>{ const o = new THREE.Mesh( new THREE.CylinderBufferGeometry( r, r, x1 - x0, 10 ), m ); o.rotation.z = Math.PI / 2; o.position.set( ( x0 + x1 ) / 2, -y, z ); root.add( o ); return o; };
	const [ x0, x1 ] = L.bridge, S = L.soffit, R = L.road;
	// the legs: footing, twin columns, bracing, knee braces up to the soffit, lamps
	for ( const c of L.legs )
	{
		B( c - 540, -34, c + 540, 140, -560, -190, M.concrete );                                   // (the footing at the waterline)
		B( c - 560, -44, c + 560, -30, -570, -180, M.dark );                                       // (its deck edge)
		// (no fender row: its high-contrast dashes read as busy against the calm water the concept has there)
		for ( const x of [ c - 420, c + 420 ] ) B( x - 10, -70, x + 10, -44, -300, -280, M.yellow ); // (bollards)
		for ( const sx of [ -1, 1 ] )
		{
			const cx = c + sx * 300;
			B( cx - 64, S, cx + 64, -30, -470, -300, M.concrete );                                  // (a column)
			B( cx - 72, -150, cx + 72, -120, -478, -292, M.dark );                                  // (its collars)
			B( cx - 72, -420, cx + 72, -390, -478, -292, M.dark );
			for ( const y of [ -110, -260, -470 ] ) B( cx - sx * 50 - 10, y - 10, cx - sx * 50 + 10, y + 10, -296, -290, glow( 0xffc27a ) );
			strut( cx, -470, cx + sx * 260, S + 4, -385, 22, M.steel );                             // (knee braces)
			strut( cx, -470, cx - sx * 200, S + 4, -385, 18, M.steel );
		}
		for ( const [ ya, yb ] of [ [ -60, -300 ], [ -300, -540 ] ] )
		{
			strut( c - 236, ya, c + 236, yb, -385, 16, M.steel ); strut( c - 236, yb, c + 236, ya, -385, 16, M.steel );
		}
		B( c - 236, -310, c + 236, -290, -400, -370, M.steel );                                    // (a tie between the twins)
		B( c - 460, S - 30, c + 460, S + 6, -500, -280, M.dark );                                   // (the pier head under the soffit)
		glowLamp( c, -20, -560 );
	}
	function glowLamp( x, y, z ) { B( x - 40, y - 3, x + 40, y + 3, z - 2, z + 2, glow( 0xffc27a, 0.8 ) ); }
	// the soffit: longitudinal girders behind the slab, cross beams, pipes, cable trays, lamps
	B( x0, S - 40, x1, S + 26, -520, -150, M.dark );
	B( x0, S + 20, x1, S + 34, -520, -150, M.steel );
	for ( let x = x0 + 75; x < x1; x += 150 ) B( x - 7, S, x + 7, S + 48, -500, -150, M.steel );
	cyl( 9, x0, x1, S + 40, -230, M.rust ); cyl( 13, x0, x1, S + 58, -310, M.steel ); cyl( 6, x0, x1, S + 34, -180, M.black );
	for ( let x = x0 + 150; x < x1; x += 300 ) B( x - 26, S + 44, x + 26, S + 52, -174, -160, glow( 0xffd9a0 ) );
	// the deck's side and the tower behind the rooms (depth, for the angled view)
	B( x0, R, x1, S, -600, -170, M.back );
	const T = L.tower;
	B( T.x0, T.roof, T.x1, R, -600, -170, M.backDark );
	// the deck's rooms, furnished behind the play plane: cabinets, consoles with lit screens, pipes under the ceiling,
	// strip lights (red in the security rooms, hazard-yellow in the vehicle bay)
	let seed = 11; const rnd = ()=>( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	const Fl = L.floor, Ce = L.ceil;
	for ( const [ rx0, rx1, bg ] of L.rooms || [] )
	{
		const red = bg === 'bg_sec', bay = bg === 'bg_bay';
		cyl( 6, rx0 + 10, rx1 - 10, Ce + 16, -20, M.rust ); cyl( 4, rx0 + 10, rx1 - 10, Ce + 30, -14, M.steel );
		B( rx0 + 20, Ce + 6, rx1 - 20, Ce + 10, -12, -8, glow( red ? 0xff3020 : bay ? 0xd8b030 : 0xffd9a0, red ? 0.9 : 0.55 ) );
		for ( let x = rx0 + 60; x < rx1 - 80; x += 150 + rnd() * 90 )
		{
			const k = rnd();
			if ( k < 0.4 ) { const h = 90 + rnd() * 50; B( x, Fl - h, x + 50, Fl, -24, -8, M.dark ); B( x + 8, Fl - h + 10, x + 42, Fl - h + 18, -7, -6, glow( 0x9fd0ff, 0.35 ) ); }
			else if ( k < 0.7 ) { B( x, Fl - 60, x + 70, Fl, -24, -8, M.steel ); B( x + 10, Fl - 110, x + 60, Fl - 72, -22, -18, glow( red ? 0xff5040 : 0x80e0ff, 0.7 ) ); }
			else { B( x, Fl - 40, x + 60, Fl, -24, -8, M.rust ); B( x + 10, Fl - 76, x + 50, Fl - 40, -22, -10, M.rust ); }
		}
	}
	// the hanging containers' cables and hooks
	for ( const k of L.hanging )
	{
		const cx = ( k[ 0 ] + k[ 1 ] ) / 2;
		for ( const dx of [ -60, 60 ] ) strut( cx, S + 26, cx + dx, k[ 2 ], -30, 3, M.black );
		B( cx - 14, S + 26, cx + 14, S + 50, -40, -20, M.yellow );
	}
	// yellow railings: along the road's edge (front and back) and round the pier caps (behind)
	const rail = ( a, b, y, z )=>{ B( a, y - 42, b, y - 38, z - 2, z + 2, M.yellow ); B( a, y - 22, b, y - 19, z - 2, z + 2, M.yellow ); for ( let x = a; x <= b; x += 120 ) B( x - 2, y - 42, x + 2, y, z - 2, z + 2, M.yellow ); };
	rail( x0, T.x0 - 20, R, -150 ); rail( T.x1 + 20, x1, R, -150 );
	for ( const c of L.legs ) rail( c - L.cap.half, c + L.cap.half, L.cap.top, -150 );
	// cranes on the road deck: mast, cab, jib out over the water, a load on its cable
	for ( const cr of L.cranes )
	{
		const cx = cr.x, top = R - 700, dir = cr.dir;
		for ( const dx of [ -28, 28 ] ) for ( const dz of [ -120, -64 ] ) B( cx + dx - 4, top, cx + dx + 4, R - 100, dz - 4, dz + 4, M.orange );
		for ( let y = R - 100; y > top; y -= 60 ) { strut( cx - 28, y, cx + 28, y - 60, -120, 4, M.orange ); strut( cx - 28, y, cx + 28, y - 60, -64, 4, M.orange ); }
		B( cx - 70, R - 100, cx + 70, R, -150, -40, M.dark );                                       // (its base, behind the pedestal)
		B( cx - 50, top - 70, cx + 50, top, -130, -50, M.orange );                                  // (the cab)
		B( cx - 44, top - 60, cx + 20, top - 34, -48, -46, glow( 0xffe0b0, 0.8 ) );
		B( Math.min( cx, cx + dir * 760 ), top - 96, Math.max( cx, cx + dir * 760 ), top - 70, -110, -70, M.orange );   // (the jib)
		B( Math.min( cx, cx - dir * 260 ), top - 92, Math.max( cx, cx - dir * 260 ), top - 70, -110, -70, M.orange );
		B( cx - dir * 260 - 40, top - 70, cx - dir * 200 + 40, top + 10, -120, -60, M.dark );        // (the counterweight)
		strut( cx, top - 170, cx + dir * 760, top - 96, -90, 3, M.black ); strut( cx, top - 170, cx - dir * 260, top - 92, -90, 3, M.black );
		B( cx - 8, top - 180, cx + 8, top - 96, -98, -82, M.orange );
		const lx = cx + dir * 700, ly = cr.load;
		strut( lx, top - 70, lx, ly - 70, -90, 3, M.black );
		B( lx - 90, ly - 70, lx + 90, ly, -130, -50, M.rust );                                     // (its load: a container)
	}
	// the tower numbered 4: its crown above the roof, the number, security lights, the orange banners, masts, a beacon
	const cx = ( T.x0 + T.x1 ) / 2, rf = T.roof;
	B( T.x0 + 40, rf - 700, T.x1 - 40, rf, -300, -60, M.concrete );
	B( T.x0 - 40, rf - 520, T.x0 + 70, rf, -260, -80, M.steel ); B( T.x1 - 70, rf - 520, T.x1 + 40, rf, -260, -80, M.steel );
	B( T.x0 + 20, rf - 30, T.x1 - 20, rf, -320, -40, M.dark );
	B( T.x0 + 60, rf - 720, T.x1 - 60, rf - 700, -310, -70, M.dark );
	const numMat = unlitMat( 0xffffff, 1, false, numberTex( 4 ), 0.75 ); numMat.transparent = false; numMat.depthWrite = true; mats.push( numMat );
	const num = new THREE.Mesh( new THREE.PlaneBufferGeometry( 280, 280 ), numMat ); num.position.set( cx, -( rf - 470 ), -58 ); root.add( num );
	const win = unlitMat( 0xffffff, 1, true, windowsTex(), 0.9 ); mats.push( win );
	for ( const [ y0, y1 ] of [ [ rf - 300, rf - 190 ], [ rf - 170, rf - 60 ] ] ) { const p = new THREE.Mesh( new THREE.PlaneBufferGeometry( T.x1 - T.x0 - 200, y1 - y0 ), win ); p.position.set( cx, -( y0 + y1 ) / 2, -57 ); root.add( p ); }
	for ( const y of [ rf - 330, rf - 40 ] ) B( T.x0 + 60, y - 4, T.x1 - 60, y + 4, -58, -54, glow( 0xff3020, 0.9 ) );
	const banMat = unlitMat( 0xffffff, 1, false, orangeBannerTex() ); banMat.transparent = false; banMat.depthWrite = true; mats.push( banMat );
	const banners = [];
	for ( const x of [ T.x0 + 5, T.x1 - 5 ] ) { const b = new THREE.Mesh( new THREE.PlaneBufferGeometry( 100, 400, 1, 8 ), banMat ); b.position.set( x, -( rf - 280 ), -30 ); root.add( b ); banners.push( b ); }
	for ( const [ dx, h ] of [ [ -200, 420 ], [ 90, 560 ], [ 250, 300 ] ] ) { const m = new THREE.Mesh( new THREE.CylinderBufferGeometry( 5, 9, h, 8 ), M.steel ); m.position.set( cx + dx, -( rf - 720 - h / 2 ), -180 ); root.add( m ); }
	const beacon = B( cx + 84, rf - 1296, cx + 96, rf - 1284, -186, -174, glow( 0xff2a1a ) );
	// small control towers at the bridge's ends, on the road deck (behind it)
	for ( const tx of L.watchtowers )
	{
		B( tx - 60, R - 380, tx + 60, R, -330, -200, M.steel );
		B( tx - 80, R - 470, tx + 80, R - 380, -345, -185, M.dark );
		B( tx - 70, R - 450, tx + 70, R - 400, -186, -184, glow( 0xffc27a, 0.7 ) );
		const m = new THREE.Mesh( new THREE.CylinderBufferGeometry( 3, 5, 220, 6 ), M.steel ); m.position.set( tx + 30, -( R - 580 ), -260 ); root.add( m );
	}
	// the far shore: three ridges of hills in the mist, far behind (placed each frame so they sit on the horizon)
	const hills = [];
	for ( const [ i, tone, depth, w, h ] of [ [ 0, '#8f8490', 14000, 80000, 4200 ], [ 2, '#76697a', 7000, 52000, 2600 ] ] )
	{
		const m = unlitMat( 0xffffff, 1, false, hillsTex( 7 + i * 13, tone ), 0.5 ); mats.push( m );
		const p = new THREE.Mesh( new THREE.PlaneBufferGeometry( w, h ), m );
		p.userData = { depth, h }; far.add( p ); hills.push( p );
	}
	mergeStatic( root, new Set( [ beacon, ...banners, num ] ) );
	root.userData.csOwn = far.userData.csOwn = true;
	return { root, far, hills, mats, beacon, banners };
}
function bridgeVisual( e, scene, dt, t )
{
	const s = estate.get( e ), L = LAYOUTS[ s.style ];
	if ( !L ) return;
	let G = bridges.get( e );
	if ( !G ) { G = buildBridge( L ); bridges.set( e, G ); }
	if ( G.root.parent !== scene ) scene.add( G.root );
	if ( G.far.parent !== scene ) scene.add( G.far );
	placeBridge();
	G.beacon.visible = ( t % 1.4 ) < 0.3;
	G.banners.forEach( ( b, i )=>{ b.rotation.y = Math.sin( t * 0.8 + i * 2 ) * 0.1; } );
}
// the hills stay on the horizon wherever the camera is (as the tower backdrop does)
function placeBridge()
{
	const cam = camera();
	if ( !cam || !bridges.size ) return;
	const cx = cam.position.x, cy = cam.position.y, camZ = Math.max( 1, cam.position.z );
	bridges.forEach( ( G )=>
	{
		for ( const p of G.hills )
		{
			const k = ( camZ + p.userData.depth ) / camZ;
			p.position.set( cx, cy + ( 0 - cy ) * k + p.userData.h / 2 * 0.62, -p.userData.depth );
		}
	} );
}
function bridgeDispose( e )
{
	const G = bridges.get( e );
	if ( !G ) return;
	for ( const g of [ G.root, G.far ] ) { if ( g.parent ) g.parent.remove( g ); g.traverse( ( o )=>{ if ( o.geometry ) o.geometry.dispose(); } ); }
	for ( const m of G.mats ) m.dispose();
	bridges.delete( e );
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

const LEVEL_TITLE = { '01': '01 · Approach', '06': '06 · Underhang' };
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
// ---- 06 · Underhang ----
//
// Under the Civil Security sea bridge. The tower numbered 4 stands on its deck; its legs stand in the sea on twin
// columns. The fight is under the deck, on five layers: the water lane (the boat), the pier caps on each leg (the
// pitstop fights: 330 px up, the boat passes under them; ladders come up out of the water at both ends), the hanging
// containers between them (a jump route from cap to cap), the deck interior (a run of rooms: services, red security
// rooms, a vehicle bay with CS tanks), and the road deck and the tower on top. Each leg has a ladder shaft from its cap
// through hatches in the deck to the road. Three objectives in any order open the extraction on the hilltop: the power
// in the cliff facility (left: rooms cut into the rock where the deck meets the cliff, a ledge and a catwalk out to the
// first cap), the command room in the tower (middle), and the basement of the shore bunker (right: a lower corridor at
// cap level, an upper one at deck level, stairs between them, a shaft down to the basement below the sea, a shaft up to
// the hilltop where the extraction waits).
//
// (Seen side-on the sea is one lane: a footing at the waterline would block the boat. The footings are drawn behind the
// lane, where the concept has them, and the caps are high enough for the boat to pass under: ≥ 290 px clear.)
const L06 = {
	style: 6,
	sea: 0, bed: 700,
	ends: [ 0, 15800 ],
	bridge: [ 1300, 13700 ],
	legs: [ 2100, 3900, 5700, 7500, 9300, 11100, 12900 ],
	cap: { half: 450, top: -330, t: 30 },
	soffit: -580, floor: -620, ceil: -820, road: -860, header: 40,
	shaft: -120,                                                              // (each leg's ladder shaft, from its centre)
	hatch: 70,                                                                // (half the hatch it climbs through: room for a climber's arms and gun)
	containerH: 90, containerTop: -400,
	partitions: [ 1900, 2800, 3450, 4350, 5250, 6150, 6850, 7050, 7950, 8850, 9750, 10650, 11550, 12450, 13350 ],
	rooms: [ [ 1300, 1900, 'bg_room', 'Store' ], [ 1900, 2800, 'bg_room', 'Services' ], [ 2800, 3450, 'bg_sec', 'Security' ], [ 3450, 4350, 'bg_room', 'Services' ],
		[ 4350, 5250, 'bg_room', 'Store' ], [ 5250, 6150, 'bg_room', 'Services' ], [ 6150, 6850, 'bg_sec', 'Security' ], [ 6850, 7050, 'bg_room', 'Vestibule' ],
		[ 7050, 7950, 'bg_tower', 'Tower base' ], [ 7950, 8850, 'bg_bay', 'Vehicle bay' ], [ 8850, 9750, 'bg_room', 'Services' ], [ 9750, 10650, 'bg_sec', 'Security' ],
		[ 10650, 11550, 'bg_room', 'Services' ], [ 11550, 12450, 'bg_sec', 'Security' ], [ 12450, 13350, 'bg_room', 'Services' ], [ 13350, 13700, 'bg_room', 'Vestibule' ] ],
	tower: { x0: 7100, x1: 7900, wall: 40, l2: -1100, l3: -1340, slab: 20, roof: -1600, roofT: 40, doorTop: -1020, l3Open: -1520, shaft: 7780 },
	cranes: [ { x: 2250, dir: -1, load: -1180 }, { x: 5850, dir: -1, load: -1180 }, { x: 8900, dir: 1, load: -1180 }, { x: 13050, dir: 1, load: -1180 } ],
	watchtowers: [ 1450, 4880, 10150, 13550 ],
	start: { dock: [ 1200, 1300 ], boat: 1560 },
	// the cliff facility (left): the rock from the level's left edge to the bridge, cut into rooms
	cliff: { x0: 0, x1: 1300, top: -1300, ledge: -330, dockBack: 1150, tunnel: [ 700, 1300, -490 ], facility: [ 300, 1300 ], shaft: 1000, ladder: 1200, power: 450 },
	// the shore bunker (right): lower corridor (cap level), stairs up to the upper corridor (deck level), the basement
	// under the sea, the hilltop
	shore: { x0: 13700, x1: 15800, dock: [ 13550, 13700 ], lower: [ 13700, 14400, -490 ], stairs: 14400, upper: [ 13700, 15200 ], basement: [ 13900, 14700, 100, 300 ],
		baseShaft: 14100, hillShaft: 15100, hill: [ [ 13700, 14400, -860 ], [ 14400, 14700, -940 ], [ 14700, 15800, -1020 ] ], exit: 15600, objective: 14550 },
	hanging: []
};
( ()=>
{
	for ( let i = 0; i < L06.legs.length - 1; i++ )
	{
		const a = L06.legs[ i ] + L06.cap.half, b = L06.legs[ i + 1 ] - L06.cap.half;
		L06.hanging.push( [ a + 170, a + 370, L06.containerTop ], [ b - 370, b - 170, L06.containerTop ] );
	}
} )();
const LAYOUTS = { 6: L06 };
state.layouts = { '06': L06 };
function level06()
{
	const B = levelBuilder(), L = L06, T = L.tower, [ bx0, bx1 ] = L.bridge, SF = L.soffit, R = L.road;
	// dusk in the mist: a low warm sun, a mauve sky; the lamps are sodium, the security rooms red
	B.world( { sun_color: '0xe8b48c', sun_intensity: '0.34', sky_color: '0x6e6478', sky_intensity: '0.46', fog_intensity: '0', brightness: '1', raining: 'false', snowing: 'false',
		foreground_snow: 'false', background_snow: 'false', terrain_enabled: 'false', generate_shadowmap: 'true', camera_collisions: 'false', wind_amplitude: '-0.8', wind_random_part: '0.4' } );
	B.call( 'pb2GameWorld.EnableSimplePlayerAssignmentLogic' );
	B.skin( 'skin_raider', 1 ); B.skin( 'skin_cs_lite', 8 ); B.skin( 'skin_cs_heavy', 7 ); B.skin( 'skin_cs_ghost', 12 ); B.skin( 'skin_cs_boss', 11 );
	const metal = { debris_material: 'pb2Entity.MATERIAL_METAL' };
	B.surface( 'cliff', 'mat_cliff', 'Headland', '0x8a8a90', { debris_material: 'pb2Entity.MATERIAL_ROCK' } );
	B.surface( 'seabed', 'mat_sand', 'Seabed', '0x55606a' );
	B.surface( 'pier', 'platform_texture', 'Pier concrete', '0x9a948c' );
	B.surface( 'slab', 'platform_texture', 'Deck steel', '0x8e8a84', metal );
	B.surface( 'road', 'platform_texture', 'Road deck', '0x86827c' );
	B.surface( 'shell', 'mat_panel_tile', 'Tower panels', '0x8e8e94', metal );
	B.surface( 'box_rust', 'mat_panel_tile', 'Container (rust)', '0xc0703c', metal );
	B.surface( 'box_blue', 'mat_panel_tile', 'Container (blue)', '0x587c98', metal );
	B.surface( 'box_red', 'mat_panel_tile', 'Container (red)', '0xa84436', metal );
	B.surface( 'plant', 'mat_panel3_tile', 'Machinery', '0x8a8470', metal );
	B.backSurface( 'bg_room', 'mat_plate1_bg', 'Deck rooms (behind)', '0x6e6a64' );
	B.backSurface( 'bg_sec', 'mat_plate2_bg', 'Security rooms (behind)', '0x6a4644' );
	B.backSurface( 'bg_bay', 'mat_plate3_bg', 'Vehicle bay (behind)', '0x5e605e' );
	B.backSurface( 'bg_tower', 'mat_plate2_bg', 'Tower (behind)', '0x5a5a60' );
	// (no reflection: the mirror is a second drawing of the whole scene every frame — measured, it doubled the draw calls)
	B.liquid( 'sea', { color: '0x1a2028', opacity: '0.92', reflection: '0' } );
	B.team( 'raiders', { title: Q( 'Raiders' ), hud_color: 'new pb2HighRangeColor( 0x6a94ff )', friendly_fire: 'false' } );
	B.team( 'cs', { ai_in_team: 'true', title: Q( 'Civil Security' ), hud_color: 'new pb2HighRangeColor( 0xff4a3a )', friendly_fire: 'false', overheads_visibility: 'pb2OverheadHUD.OVERHEAD_VISIBILITY_TEAMMATES_ONLY' } );
	B.ai( 'cs_post', { skill: '0.75', behavior: 'pb2AIModule.BEHAVIOR_IDLE', hear_range: '700', hunt_random_known_threats_range: '0' } );
	B.ai( 'cs_hunter', { skill: '0.8', behavior: 'pb2AIModule.BEHAVIOR_MPBOT', hear_range: '800', hunt_random_known_threats_range: '1400' } );
	B.ai( 'cs_crew', { skill: '0.7', behavior: 'pb2AIModule.BEHAVIOR_IDLE', hear_range: '900', hunt_random_known_threats_range: '0' } );
	// rock with rooms cut out of it: the box [ x0, x1 ] × [ y0, y1 ] less each hole [ x0, x1, y0, y1 ], as columns of walls
	// (neighbouring columns cut alike are merged)
	const carve = ( x0, y0, x1, y1, holes, m )=>
	{
		const xs = [ x0, x1 ];
		for ( const h of holes ) for ( const x of [ h[ 0 ], h[ 1 ] ] ) if ( x > x0 && x < x1 ) xs.push( x );
		xs.sort( ( a, b )=>a - b );
		let prev = null;
		for ( let i = 0; i < xs.length - 1; i++ )
		{
			const a = xs[ i ], b = xs[ i + 1 ];
			if ( b - a < 1 ) continue;
			let ivs = [ [ y0, y1 ] ];
			for ( const h of holes ) if ( h[ 0 ] < b && h[ 1 ] > a ) { const out = []; for ( const [ p, q ] of ivs ) { if ( h[ 3 ] <= p || h[ 2 ] >= q ) { out.push( [ p, q ] ); continue; } if ( h[ 2 ] > p ) out.push( [ p, h[ 2 ] ] ); if ( h[ 3 ] < q ) out.push( [ h[ 3 ], q ] ); } ivs = out; }
			const key = JSON.stringify( ivs );
			if ( prev && prev.key === key && prev.b === a ) { prev.b = b; continue; }
			if ( prev ) for ( const [ p, q ] of prev.ivs ) B.wall( prev.a, p, prev.b - prev.a, q - p, m );
			prev = { a, b, ivs, key };
		}
		if ( prev ) for ( const [ p, q ] of prev.ivs ) B.wall( prev.a, p, prev.b - prev.a, q - p, m );
	};
	const slabAt = ( x0, x1, y, h, m, holes )=>
	{
		let segs = [ [ x0, x1 ] ];
		for ( const [ a, b ] of holes ) { const out = []; for ( const [ p, q ] of segs ) { if ( b <= p || a >= q ) { out.push( [ p, q ] ); continue; } if ( a > p ) out.push( [ p, a ] ); if ( b < q ) out.push( [ b, q ] ); } segs = out; }
		for ( const [ p, q ] of segs ) B.wall( p, y, q - p, h, m );
	};
	const bot = L.bed + 250, C = L.cliff, H = L.shore;
	// the cliff facility: rock from the level's edge to the bridge. The dock at its foot (the start) under a ledge; a
	// ladder up through the ledge; the ledge's tunnel into the rock; a shaft up to the facility (the deck's level, where the
	// deck interior runs in); the power room at its back; the cliff's top level with the road, a peak behind
	carve( C.x0, C.top, C.x1, bot, [
		[ C.dockBack, C.x1, -48 - 400, -48 ],                                                    // (over the dock, under the ledge)
		[ C.tunnel[ 0 ], C.tunnel[ 1 ], C.tunnel[ 2 ], C.ledge ],                               // (the ledge's tunnel)
		[ C.shaft - L.hatch, C.shaft + L.hatch, L.floor, C.tunnel[ 2 ] ],                      // (the shaft up to the facility)
		[ C.facility[ 0 ], C.facility[ 1 ], L.ceil, L.floor ],                                  // (the facility's rooms)
		[ C.x0 + 400, C.x1, C.top, R ]                                                          // (open sky over the cliff's top, left of the peak)
	], 'cliff' );
	// (the ledge over the dock: a slab with a hatch for the ladder; the dock level with a boat's deck, solid to the bed)
	slabAt( C.dockBack, C.x1, C.ledge, 20, 'pier', [ [ C.ladder - L.hatch, C.ladder + L.hatch ] ] );
	B.wall( L.start.dock[ 0 ], -48, L.start.dock[ 1 ] - L.start.dock[ 0 ], L.bed + 48, 'pier' );
	B.entity( C.ladder, C.ledge - 70, 'pb2Entity.TYPE_CS_LADDER', { toy: '-48' } );
	B.wall( C.x1, C.ledge, L.legs[ 0 ] - L.cap.half - C.x1, 20, 'pier' );                      // (the catwalk out to the first cap)
	B.entity( C.shaft, L.floor - 60, 'pb2Entity.TYPE_CS_LADDER', { toy: S( C.ledge ) } );
	B.back( C.facility[ 0 ], L.ceil, C.facility[ 1 ] - C.facility[ 0 ], L.floor - L.ceil, 'bg_sec' );
	B.back( C.tunnel[ 0 ], C.tunnel[ 2 ], C.tunnel[ 1 ] - C.tunnel[ 0 ], C.ledge - C.tunnel[ 2 ], 'bg_room' );
	B.wall( 640, L.ceil, 30, L.header, 'slab' );                                                // (the power room's door header)
	// the shore bunker: the rock from the bridge's end to the level's right edge; the hill above it
	const hills = H.hill;
	for ( const [ x0, x1, t ] of hills )
		carve( x0, t, x1, bot, [
			[ H.lower[ 0 ], H.lower[ 1 ], H.lower[ 2 ], L.cap.top ],                                 // (the lower corridor)
			[ H.stairs + 72, H.stairs + 360, L.floor, H.lower[ 2 ] ],                              // (the stairwell, open from the third step up)
			[ H.stairs, H.stairs + 360, H.lower[ 2 ], L.cap.top ],                                 // (the stairs' room)
			[ H.upper[ 0 ], H.upper[ 1 ], L.ceil, L.floor ],                                       // (the upper corridor)
			[ H.baseShaft - L.hatch, H.baseShaft + L.hatch, L.cap.top, H.basement[ 2 ] ],         // (the shaft to the basement)
			[ H.basement[ 0 ], H.basement[ 1 ], H.basement[ 2 ], H.basement[ 3 ] ],               // (the basement)
			[ H.hillShaft - L.hatch, H.hillShaft + L.hatch, -1100, L.ceil ]                         // (the shaft to the hilltop)
		], 'cliff' );
	for ( let k = 1; k <= 10; k++ ) B.wall( H.stairs + 36 * ( k - 1 ), Math.round( L.cap.top - ( L.cap.top - L.floor ) * k / 10 ), 36, Math.round( ( L.cap.top - L.floor ) * k / 10 ), 'slab' );
	B.wall( H.dock[ 0 ], -48, H.dock[ 1 ] - H.dock[ 0 ], L.bed + 48, 'pier' );
	slabAt( bx1 - 350, H.x0, L.cap.top, 20, 'pier', [ [ H.dock[ 0 ] + 50 - L.hatch, H.dock[ 0 ] + 50 + L.hatch ] ] );   // (the catwalk from the last cap)
	B.entity( H.dock[ 0 ] + 50, L.cap.top - 70, 'pb2Entity.TYPE_CS_LADDER', { toy: '-48' } );
	B.entity( H.baseShaft, L.cap.top - 60, 'pb2Entity.TYPE_CS_LADDER', { toy: S( H.basement[ 3 ] ) } );
	B.entity( H.hillShaft, hills[ 2 ][ 2 ] - 60, 'pb2Entity.TYPE_CS_LADDER', { toy: S( L.floor ) } );
	B.back( H.lower[ 0 ], H.lower[ 2 ], H.stairs + 360 - H.lower[ 0 ], L.cap.top - H.lower[ 2 ], 'bg_room' );
	B.back( H.upper[ 0 ], L.ceil, H.upper[ 1 ] - H.upper[ 0 ], L.floor - L.ceil, 'bg_sec' );
	B.back( H.basement[ 0 ], H.basement[ 2 ], H.basement[ 1 ] - H.basement[ 0 ], H.basement[ 3 ] - H.basement[ 2 ], 'bg_bay' );
	for ( const [ x, y, c, pw ] of [ [ 900, C.ledge - 80, '0xffc890', 0.5 ], [ 480, L.ceil + 60, '0xff3020', 0.6 ], [ 1000, L.ceil + 60, '0xffd0a0', 0.5 ],
		[ 14000, H.lower[ 2 ] + 50, '0xffd0a0', 0.5 ], [ 14300, H.basement[ 2 ] + 60, '0xff3020', 0.65 ], [ 14200, L.ceil + 60, '0xffd0a0', 0.5 ], [ 14900, L.ceil + 60, '0xff3020', 0.55 ], [ 15450, hills[ 2 ][ 2 ] - 140, '0xffb070', 0.5 ] ] )
		B.lamp( x, y, c, pw, 5 );
	// the seabed, the sea (between the dock at the cliff's foot and the bunker's dock)
	B.wall( bx0, L.bed, bx1 - bx0, bot - L.bed, 'seabed' );
	for ( const [ x, w, h ] of [ [ 2600, 380, 110 ], [ 5300, 420, 120 ], [ 6500, 300, 90 ], [ 8200, 460, 140 ], [ 9900, 280, 100 ], [ 11800, 360, 120 ] ] ) B.wall( x, L.bed - h, w, h, 'seabed' );
	B.water( bx0, L.sea, bx1 - bx0, L.bed, 'sea' );
	// a slab with hatches: a floor [ x0, x1 ] at y (thickness h), open over each leg's shaft
	const hatches = L.legs.map( ( c )=>[ c + L.shaft - L.hatch, c + L.shaft + L.hatch ] );
	const slab = ( x0, x1, y, h, m, holes )=>
	{
		let segs = [ [ x0, x1 ] ];
		for ( const [ a, b ] of holes ) { const out = []; for ( const [ p, q ] of segs ) { if ( b <= p || a >= q ) { out.push( [ p, q ] ); continue; } if ( a > p ) out.push( [ p, a ] ); if ( b < q ) out.push( [ b, q ] ); } segs = out; }
		for ( const [ p, q ] of segs ) B.wall( p, y, q - p, h, m );
	};
	// the legs' pier caps (330 up: the lane runs under them), their ladders out of the water, their lamps
	for ( const c of L.legs )
	{
		B.wall( c - L.cap.half, L.cap.top, 2 * L.cap.half, L.cap.t, 'pier' );
		// (down into the water: a swimmer's feet hang low. The first and last caps' outer ends have catwalks instead)
		for ( const sx of [ -1, 1 ] ) if ( !( c === L.legs[ 0 ] && sx < 0 ) && !( c === L.legs[ L.legs.length - 1 ] && sx > 0 ) ) B.entity( c + sx * ( L.cap.half + 20 ), L.cap.top - 70, 'pb2Entity.TYPE_CS_LADDER', { toy: S( L.bed - 20 ) } );
		B.entity( c + L.shaft, R - 60, 'pb2Entity.TYPE_CS_LADDER', { toy: S( L.cap.top ) } );
		B.lamp( c - 300, L.cap.top - 90, '0xffc890', 0.45, 4 ); B.lamp( c + 300, L.cap.top - 90, '0xffc890', 0.45, 4 );
		B.entity( c - L.cap.half + 50, L.cap.top, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '2' } );   // (by the ladder you come up: clear of the posts)
		// (cover on the cap: a crate to crouch behind and a machinery block, clear of the shaft and the ladders)
		B.wall( c - 40, L.cap.top - 60, 50, 60, 'box_blue' );
		B.wall( c + 120, L.cap.top - 70, 50, 70, 'plant' );
	}
	// the hanging containers between the caps (≥ 290 px over the water)
	L.hanging.forEach( ( [ x0, x1, y ], i )=>B.wall( x0, y, x1 - x0, L.containerH, [ 'box_rust', 'box_blue', 'box_red', 'box_rust' ][ i % 4 ] ) );
	// the deck: the soffit slab (the interior's floor), the road slab (its ceiling), headers between the rooms
	slab( bx0, bx1, L.floor, SF - L.floor, 'slab', hatches );
	slab( bx0, bx1, R, L.ceil - R, 'road', hatches );
	for ( const p of L.partitions ) B.wall( p - 15, L.ceil, 30, L.header, 'slab' );
	for ( const [ x0, x1, bg ] of L.rooms ) B.back( x0, L.ceil, x1 - x0, L.floor - L.ceil, bg );
	for ( const [ x0, x1, bg ] of L.rooms )
	{
		const red = bg === 'bg_sec', cx = ( x0 + x1 ) / 2;
		B.lamp( cx, L.ceil + 60, red ? '0xff3020' : '0xffd0a0', red ? 0.65 : 0.5, 5 );
		if ( red ) B.lamp( cx + ( x1 - x0 ) / 4, L.floor - 40, '0xff2010', 0.4, 3 );
	}
	// cover in the rooms (none in the tank run: the tower base, the vehicle bay, the services beyond it)
	for ( const [ x, w, h, m ] of [ [ 4800, 90, 60, 'box_blue' ], [ 5000, 60, 60, 'plant' ], [ 5420, 70, 60, 'plant' ], [ 5960, 90, 60, 'box_rust' ], [ 6320, 60, 60, 'box_red' ], [ 6620, 60, 60, 'box_red' ], [ 9900, 70, 60, 'plant' ], [ 10180, 90, 60, 'box_blue' ] ] )
		B.wall( x, L.floor - h, w, h, m );
	// the road deck: crane pedestals, container stacks, a utility module
	for ( const cr of L.cranes ) B.wall( cr.x - 60, R - 100, 120, 100, 'plant' );
	// (stacks of two, the upper one set back: climb the first, then the second)
	for ( const [ x, y, w, h, m ] of [ [ 6300, R - 90, 240, 90, 'box_rust' ], [ 6360, R - 180, 180, 90, 'box_blue' ], [ 8480, R - 90, 240, 90, 'box_red' ], [ 8480, R - 180, 180, 90, 'box_rust' ], [ 5120, R - 130, 180, 130, 'plant' ],
		[ 2900, R - 90, 240, 90, 'box_blue' ], [ 2960, R - 180, 180, 90, 'box_red' ], [ 11900, R - 90, 240, 90, 'box_rust' ], [ 11960, R - 180, 180, 90, 'box_blue' ], [ 4300, R - 130, 180, 130, 'plant' ] ] )
		B.wall( x, y, w, h, m );
	for ( let x = bx0 + 300; x < bx1; x += 900 ) if ( x < T.x0 - 60 || x > T.x1 + 60 ) B.lamp( x, R - 130, '0xffb070', 0.45, 5 );
	for ( let x = bx0 + 200; x < bx1; x += 900 ) B.lamp( x, SF + 40, '0xffb070', 0.6, 8 );          // (the soffit's lamps, over the lane)
	// the tower numbered 4: lobby (road level: doors each side), the command room (closed), the observation deck
	// (open sides), the roof; a ladder shaft on its right from the lobby to the roof
	const th = [ [ T.shaft - L.hatch, T.shaft + L.hatch ] ];
	slab( T.x0, T.x1, T.l2, T.slab, 'slab', th );
	slab( T.x0, T.x1, T.l3, T.slab, 'slab', th );
	slab( T.x0 - 40, T.x1 + 40, T.roof - T.roofT, T.roofT, 'shell', th );
	for ( const x of [ T.x0, T.x1 - T.wall ] )
	{
		B.wall( x, T.roof, T.wall, T.l3Open - T.roof, 'shell' );
		B.wall( x, T.l3 + T.slab, T.wall, T.doorTop - T.l3 - T.slab, 'shell' );
	}
	B.back( T.x0, T.roof, T.x1 - T.x0, R - T.roof, 'bg_tower' );
	B.entity( T.shaft, T.roof - T.roofT - 60, 'pb2Entity.TYPE_CS_LADDER', { toy: S( R ) } );
	B.lamp( ( T.x0 + T.x1 ) / 2, T.l2 + 60, '0xffd0a0', 0.5, 5 );
	B.lamp( T.x0 + 200, T.l3 + 70, '0xff3020', 0.6, 5 ); B.lamp( T.x1 - 200, T.l3 + 70, '0xffd0a0', 0.4, 4 );
	B.lamp( ( T.x0 + T.x1 ) / 2, T.l3 - 130, '0xffd0a0', 0.4, 5 );
	B.lamp( ( T.x0 + T.x1 ) / 2, T.roof - 160, '0xff3020', 0.5, 6 );
	// the command room's console: the middle objective
	B.entity( T.x0 + 300, T.l2, 'pb2Entity.TYPE_CS_OBJECTIVE', { style_id: '2' } );
	B.entity( T.x0 + 60, R, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '2' } );
	// the set pieces: the bridge's legs, soffit, cranes, the tower's crown, the hills
	B.entity( ( bx0 + bx1 ) / 2, 0, 'pb2Entity.TYPE_CS_BRIDGE', { style_id: String( L.style ) } );
	// the raiders: on the dock, their boat moored off it (a berth here), a rifle and a pistol
	const sx0 = ( L.start.dock[ 0 ] + L.start.dock[ 1 ] ) / 2;
	B.char( sx0, -48 - 44, { id: 'raider1', skin: 'skin_raider', team: 'raiders', player_controllable: 'true', hmax: '150', side: '1' } );
	B.gun( sx0 - 20, -48 - 20, 'gun_real_rifle' ); B.gun( sx0 + 20, -48 - 20, 'gun_pistol2' );
	B.entity( L.start.boat, -60, 'pb2Entity.TYPE_BOAT', { id: 'raider_boat', style_id: '1', side: '1', multiply_health: '3' } );
	B.entity( L.start.boat + 25, 0, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '1' } );
	for ( let i = 0; i < L.legs.length - 1; i++ ) B.entity( ( L.legs[ i ] + L.legs[ i + 1 ] ) / 2, 0, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '1' } );
	// the CS tanks in the vehicle bay (unmanned: the raiders can take them) and guns to find
	// (sturdy: they wait out the fighting in the bay until the raiders get there)
	B.entity( 8250, L.floor - 80, 'pb2Entity.TYPE_TANK', { style_id: '3', side: '-1', multiply_health: '4' } );
	B.entity( 8620, L.floor - 80, 'pb2Entity.TYPE_TANK', { style_id: '4', side: '-1', multiply_health: '4' } );
	B.gun( 5600, L.floor - 20, 'gun_real_shotgun' ); B.gun( 7200, R - 20, 'gun_rl' ); B.gun( 9500, L.cap.top - 20, 'gun_sniper' );
	// Civil Security: the pier caps and the containers (they shoot down at the lane), the rooms, the road, the tower
	const cap = L.cap.top, fl = L.floor;
	const [ c1, c2, c3 ] = L.legs;
	B.cs( c1 - 200, cap, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( c1 + 260 + 80, cap, 'skin_cs_lite', 'gun_real_shotgun', 'cs_post', 'CS Trooper [2+]', -1 );
	B.cs( L.hanging[ 1 ][ 0 ] + 100, L.containerTop, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman', -1 );
	B.cs( c2 - 200, cap, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy', -1 );
	B.cs( c2 + 200, cap, 'skin_cs_lite', 'gun_rl', 'cs_post', 'CS Rocketeer', -1 );
	B.cs( c2 + 40, cap, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper [3+]', -1 );
	B.cs( L.hanging[ 2 ][ 0 ] + 100, L.containerTop, 'skin_cs_lite', 'gun_gl', 'cs_post', 'CS Grenadier', -1 );
	B.cs( c3 - 200, cap, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( c3 + 200 + 150, cap, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman [2+]', -1 );
	B.cs( 5500, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 5850, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper [2+]', -1 );
	B.cs( 6480, fl, 'skin_cs_heavy', 'gun_flame', 'cs_post', 'CS Heavy', -1 );
	B.cs( 6760, fl, 'skin_cs_lite', 'gun_real_shotgun', 'cs_post', 'CS Trooper [2+]', -1 );
	B.cs( 7250, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( 7700, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper [3+]', -1 );
	B.cs( 8420, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Tank crew', -1 );
	B.cs( 8760, fl, 'skin_cs_lite', 'gun_real_shotgun', 'cs_hunter', 'CS Trooper [2+]', -1 );
	B.cs( 9000, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 10020, fl, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy [3+]', -1 );
	B.cs( 10300, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( 5300, R - 130, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman', -1 );
	B.cs( 6080, R, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 6450, R - 180, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman [2+]', -1 );
	B.cs( 8200, R, 'skin_cs_lite', 'gun_rl', 'cs_post', 'CS Rocketeer', -1 );
	B.cs( 9050, R, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 9700, R, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy [2+]', -1 );
	B.cs( T.x0 + 460, R, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Tower guard', -1 );
	B.cs( T.x1 - 180, R, 'skin_cs_lite', 'gun_real_shotgun', 'cs_post', 'CS Tower guard [2+]', -1 );
	B.cs( T.x1 - 220, T.l2, 'skin_cs_boss', 'gun_oicw', 'cs_post', 'CS Commander', -1 );
	B.cs( T.x0 + 160, T.l2, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Command guard', -1 );
	B.cs( T.x0 + 200, T.l3, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Observer', -1 );
	B.cs( T.x1 - 240, T.l3, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Observer [3+]', 1 );
	B.cs( ( T.x0 + T.x1 ) / 2 - 150, T.roof - T.roofT, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Roof sniper [2+]', -1 );
	// CS patrol boats (the autopilot drives them): a helmsman and a gunner each
	const eboat = ( id, x, name )=>
	{
		B.entity( x, -60, 'pb2Entity.TYPE_BOAT', { id, style_id: '1', side: '-1', multiply_health: '0.5' } );
		B.cs( x, -60, 'skin_cs_lite', null, 'cs_crew', name + ' helm', -1, { driver_of: id } );
		B.cs( x, -60, 'skin_cs_lite', null, 'cs_crew', name + ' gunner', -1, { driver_of: id } );
	};
	eboat( 'cs_boat1', 7000, 'Patrol 1' );
	eboat( 'cs_boat2', 8900, 'Patrol 2' );
	eboat( 'cs_boat3', 9900, 'Patrol 3 [2+]' );
	eboat( 'cs_boat0', 4400, 'Patrol 0' );                                           // (out of wake range of the start)
	eboat( 'cs_boat4', 12000, 'Patrol 4' );
	// the left chunk: the cliff facility's power room (the first objective), its ledge, caps 1 and 2, the deck and road
	B.entity( C.power, L.floor, 'pb2Entity.TYPE_CS_OBJECTIVE', { style_id: '1' } );
	B.cs( 520, fl, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Power guard', 1 );
	B.cs( 850, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 1150, fl, 'skin_cs_lite', 'gun_real_shotgun', 'cs_post', 'CS Engineer [2+]', -1 );
	// (cap 1's guards at its far end, out of sight of the start: the level opens quiet)
	B.cs( 2420, cap, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( 2500, cap, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman [2+]', -1 );
	B.cs( 3700, cap, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy [3+]', -1 );
	B.cs( 4150, cap, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( L.hanging[ 1 ][ 0 ] + 100, L.containerTop, 'skin_cs_lite', 'gun_gl', 'cs_post', 'CS Grenadier', -1 );
	B.cs( 2300, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 3100, fl, 'skin_cs_heavy', 'gun_flame', 'cs_post', 'CS Heavy', -1 );
	B.cs( 3350, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper [2+]', -1 );
	B.cs( 4100, fl, 'skin_cs_lite', 'gun_real_shotgun', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 1600, R, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman', -1 );
	B.cs( 2700, R, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 3040, R - 180, 'skin_cs_lite', 'gun_rl', 'cs_post', 'CS Rocketeer [2+]', -1 );
	// the right chunk: caps 6 and 7, the containers, the deck and road, the bunker (both corridors, the basement: the
	// third objective), the hilltop
	B.cs( 10900, cap, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper', -1 );
	B.cs( 11350, cap, 'skin_cs_lite', 'gun_rl', 'cs_post', 'CS Rocketeer', -1 );
	B.cs( 12700, cap, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman', -1 );
	B.cs( 13150, cap, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy [2+]', -1 );
	B.cs( L.hanging[ 11 ][ 0 ] + 100, L.containerTop, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman [3+]', -1 );
	B.cs( 11800, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Trooper [2+]', -1 );
	B.cs( 12050, fl, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy', -1 );
	B.cs( 12600, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 10850, R, 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Trooper', -1 );
	B.cs( 12050, R - 180, 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Marksman', -1 );
	B.cs( 13300, R, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Heavy [3+]', -1 );
	B.cs( 13900, cap, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Bunker guard', -1 );
	B.cs( 14250, cap, 'skin_cs_lite', 'gun_real_shotgun', 'cs_hunter', 'CS Bunker trooper', -1 );
	B.cs( 13950, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Bunker guard', -1 );
	B.cs( 14950, fl, 'skin_cs_heavy', 'gun_minigun', 'cs_post', 'CS Bunker heavy', -1 );
	B.cs( 15070, fl, 'skin_cs_lite', 'gun_real_rifle', 'cs_post', 'CS Bunker guard [2+]', -1 );
	B.cs( 14250, H.basement[ 3 ], 'skin_cs_boss', 'gun_oicw', 'cs_post', 'CS Basement chief', -1 );
	B.cs( 14000, H.basement[ 3 ], 'skin_cs_lite', 'gun_real_shotgun', 'cs_post', 'CS Basement guard [2+]', 1 );
	B.cs( 15300, hills[ 2 ][ 2 ], 'skin_cs_ghost', 'gun_sniper', 'cs_post', 'CS Hill sniper', -1 );
	B.cs( 15720, hills[ 2 ][ 2 ], 'skin_cs_lite', 'gun_real_rifle', 'cs_hunter', 'CS Hill trooper', -1 );
	B.entity( H.objective, H.basement[ 3 ], 'pb2Entity.TYPE_CS_OBJECTIVE', { style_id: '3' } );
	// the extraction: the hilltop above the bunker, a CS-4 Ranger (the raiders' ride out) beside it
	B.entity( H.exit, hills[ 2 ][ 2 ], 'pb2Entity.TYPE_CS_EXIT', { style_id: '1' } );
	B.entity( 15420, hills[ 2 ][ 2 ] - 80, 'pb2Entity.TYPE_TANK', { style_id: '4', side: '1' } );
	B.entity( 13760, L.cap.top, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '2' } );
	B.entity( 14800, L.floor, 'pb2Entity.TYPE_CS_CHECKPOINT', { style_id: '2' } );
	B.call( 'pb2GameWorld.FinalizeWorld', true );
	return B.out;
}
const LEVELS = { '01': level01, '06': level06 };

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
state.debug = { buildTower, towerMat, unlitMat, beamMat, glowMat,
	// (the set pieces shown or hidden, for measuring what they cost: returns how many groups)
	sets( on ) { let n = 0; for ( const m of [ towers, bridges, ladderGfx, consoles, lights, beacons ] ) m.forEach( ( G )=>{ for ( const g of [ G.root, G.far, G.grp ] ) if ( g ) { g.visible = on; n++; } } ); return n; } };                  // (the set pieces' makers, for tests in the page)
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
		[ 'Level exit', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_EXIT', 0, 0 ), 'Level exit (on the floor)' ) ],
		[ 'Ladder', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_LADDER', 0, 0, { toy: '300' } ), 'Ladder (placed by its top; To Y is its foot)' ) ],
		[ 'Objective console', ()=>placeInEditor( editorObject( 'pb2Entity.TYPE_CS_OBJECTIVE', 0, 0, { style_id: '2' } ), 'Objective (on the floor; Style ID 1 power, 2 command room, 3 basement)' ) ]
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
				towerDispose( e ); searchlightDispose( e ); beaconDispose( e ); ladderDispose( e ); consoleDispose( e ); bridgeDispose( e );
				if ( !s || e.is_being_removed || ents.indexOf( e ) === -1 ) marked.delete( e );
				continue;
			}
			hideBase( e );
			const p = bodyPos( e );
			if ( p && isFinite( p[ 0 ] ) && Math.abs( p[ 0 ] ) < 1e7 ) { s.x = p[ 0 ]; s.y = p[ 1 ]; }
			if ( s.kind === 'tower' ) towerVisual( e, scene, dt, t );
			else if ( s.kind === 'searchlight' ) searchlightVisual( e, scene, dt, t );
			else if ( s.kind === 'ladder' ) ladderVisual( e, scene );
			else if ( s.kind === 'objective' ) consoleVisual( e, scene, dt, t );
			else if ( s.kind === 'bridge' ) bridgeVisual( e, scene, dt, t );
			else beaconVisual( e, scene, dt, t );
		}
		if ( isHost() && scene && ents.length ) hostTick( dt );
		if ( isHost() && scene && markers( 'bridge' ).length && t - ( state.sleptAt || 0 ) > 0.25 ) { state.sleptAt = t; sleepFar(); }
		if ( bannerEl && bannerUntil && t > bannerUntil ) { bannerEl.style.opacity = '0'; bannerUntil = 0; }
		if ( state.registered && state.status === 'waiting for the game engine' ) state.status = 'ready';
	}
	catch ( e ) { err( 'frame', e ); }
}
requestAnimationFrame( frame );

state.dispose = ()=>
{
	state.disposed = true;
	for ( const e of [ ...marked ] ) { towerDispose( e ); searchlightDispose( e ); beaconDispose( e ); ladderDispose( e ); consoleDispose( e ); bridgeDispose( e ); }
	closeMenu(); if ( ED.btn ) opt( ()=>ED.btn.remove() );
	if ( bannerEl ) bannerEl.remove();
	unhookAll();
};
