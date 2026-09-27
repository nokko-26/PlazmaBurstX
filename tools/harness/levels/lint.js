// The static level linter: node levels/lint.js <level id>
// Builds the level's editor objects straight from mods/cs-coastal-tower.user.js (the mod run in a sandbox, with the
// Level Editor's own templates), then checks them against the design rules in docs/cs-coastal-tower/metrics.md § 2.
// Nothing is guessed from pictures: every wall, water box, ladder, character and marker is read from the objects the
// editor would load. Prints one JSON line.
//
// What it measures:
//   floors      every wall top a character can stand on (headroom ≥ 62 px), split where the ceiling changes;
//   moves       walk (≤ 32 px step), hop (≤ 60 up), climb (≤ 140 up, a grab), jump (gap ≤ 240; ≤ 300 at a run),
//               drop (≤ 400), ladders (the mod's ladder markers), swimming (the sea's open water, climb-outs ≤ 80),
//               the boat (it carries you anywhere along its lane);
//   route       everything reachable from the players' start; every objective, exit, foot checkpoint and vehicle
//               must be reachable, every enemy reachable or in sight from somewhere reachable (≤ 1,000 px — about a screen and a half — with a clear line);
//   rules       ceilings ≥ 100 px over walkways, stairs (risers ≤ 30, treads ≥ 30), ≥ 240 px round a berth checkpoint,
//               the boat lane (≥ 290 clear above the water, ≥ 60 deep), no underwater dead end under a wall, nothing
//               standing inside a wall or floating;
//   budget      lamps, walls, enemies (by co-op strength).
const fs = require( 'fs' ), path = require( 'path' ), vm = require( 'vm' );
const ROOT = process.env.PB3X_ROOT || path.join( __dirname, '..', '..', '..' );
const MOD = path.join( ROOT, 'mods', 'cs-coastal-tower.user.js' );
const TEMPLATES = require( '../editor-templates.json' );
const R = { step: 32, riser: 30, tread: 30, hop: 60, climb: 140, gap: 240, runGap: 300, drop: 400, head: 100, fightHead: 170, stand: 80, crouch: 62,
	swimOut: 80, laneClear: 290, laneDepth: 60, berth: 240, boatHalf: 215, boatDeck: 48, sight: 1000 };

function levelObjects( id )
{
	const src = fs.readFileSync( MOD, 'utf8' );
	const win = { PB3X: {} };
	const quiet = { log() {}, warn() {}, error() {}, info() {} };
	const ctx = { window: win, console: quiet, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, setInterval() {},
		performance: { now: ()=>0 }, document: { createElement: ()=>( { getContext: ()=>( {} ), style: {} } ), body: { appendChild() {} } },
		pb2LevelEditor: { bWn: TEMPLATES.map( ( t )=>t.eo ? { SP: { editor_object: t.eo } } : {} ) } };
	vm.createContext( ctx );
	vm.runInContext( '(function(){\n' + src + '\n})()', ctx, { filename: 'cs-coastal-tower.user.js' } );
	const st = win.__csTower;
	if ( !st || typeof st.levelObjects !== 'function' ) throw new Error( 'the mod did not set up window.__csTower.levelObjects' );
	const objs = st.levelObjects( id );
	if ( !objs ) throw new Error( 'no level ' + id + ' (levels: ' + st.levelIds().join( ', ' ) + ')' );
	return { objs, ids: st.levelIds(), layout: st.layouts ? st.layouts[ id ] || null : null };
}

const num = ( v )=>{ const n = parseFloat( v ); return isFinite( n ) ? n : 0; };
const unq = ( v )=>String( v || '' ).replace( /^'|'$/g, '' );
const r1 = ( v )=>Math.round( v * 10 ) / 10;

function parse( objs )
{
	const L = { walls: [], movables: [], water: [], backs: [], regions: [], chars: [], ents: [], guns: [], lamps: [], other: 0 };
	for ( const o of objs )
	{
		const e = o.editor_object || {};
		if ( e.constructor === 'pb2GameWorld.CreateBoxShape' )
		{
			const r = { x: num( e.x ), y: num( e.y ), w: num( e.w ), h: num( e.h ), m: e.m, corner: e.corner || 'pb2Shape.CORNER_NONE', id: e.id };
			r.x1 = r.x + r.w; r.y1 = r.y + r.h;
			if ( e.type === 'pb2Shape.WALL' ) L.walls.push( r );
			else if ( e.type === 'pb2Shape.MOVABLE' ) L.movables.push( r );
			else if ( e.type === 'pb2Shape.WATER' ) L.water.push( r );
			else if ( e.type === 'pb2Shape.BACKGROUND' ) L.backs.push( r );
			else if ( e.type === 'pb2Shape.REGION' ) L.regions.push( r );
		}
		else if ( e.constructor === 'pb2Ragdoll.CreateRagdollComplete' )
			L.chars.push( { id: e.id, x: num( e.x ), y: num( e.y ), feet: num( e.y ) + 44, team: e.team, name: unq( e.name ), player: e.player_controllable === 'true', driverOf: e.driver_of && e.driver_of !== 'null' ? unq( e.driver_of ) : null, skin: e.skin } );
		else if ( e.constructor === 'pb2Entity.CreateEntity' )
			L.ents.push( { id: e.id, type: String( e.type || '' ).replace( 'pb2Entity.', '' ), x: num( e.x ), y: num( e.y ), toy: e.toy !== undefined ? num( e.toy ) : null, tox: e.tox !== undefined ? num( e.tox ) : null, style: num( e.style_id ) || 1, side: num( e.side ) || 1, team: e.team } );
		else if ( e.constructor === 'pb2Gun.CreateGun' ) L.guns.push( { x: num( e.x ), y: num( e.y ), type: unq( e.type ), only: e.only_allow_for } );
		else if ( e.constructor === 'pb2Light.CreateLight' ) L.lamps.push( { x: num( e.x ), y: num( e.y ), power: num( e.power ), scale: num( e.scale ), color: e.color } );
		else L.other++;
	}
	return L;
}

function lint( id )
{
	const { objs, layout } = levelObjects( id );
	const L = parse( objs );
	// (a corner wall is a right triangle: CORNER_<side>_<end> has its upright edge on <side> and its tip at <end>. It's
	// cut into thin slices, so it blocks and carries people like the slope it is)
	const solids = [];
	for ( const s of L.walls.concat( L.movables ) )
	{
		const m = /CORNER_(LEFT|RIGHT)_(TOP|BOTTOM)$/.exec( s.corner );
		if ( !m ) { solids.push( s ); continue; }
		const n = Math.max( 4, Math.ceil( s.w / 16 ) ), sh = s.h / n;
		for ( let k = 0; k < n; k++ )
		{
			const frac = m[ 2 ] === 'TOP' ? ( k + 1 ) / n : ( n - k ) / n, w = s.w * frac;
			const x = m[ 1 ] === 'LEFT' ? s.x : s.x1 - w;
			solids.push( { x, y: s.y + k * sh, w, h: sh, x1: x + w, y1: s.y + ( k + 1 ) * sh, m: s.m, corner: 'slice', of: s } );
		}
	}
	const violations = [], info = [];
	const bad = ( rule, where, detail )=>violations.push( { rule, where, detail } );
	// is any solid inside this box (by more than half a pixel)?
	const blockers = ( x0, y0, x1, y1 )=>solids.filter( ( s )=>s.x < x1 - 0.5 && s.x1 > x0 + 0.5 && s.y < y1 - 0.5 && s.y1 > y0 + 0.5 );
	const blocked = ( x0, y0, x1, y1 )=>blockers( Math.min( x0, x1 ), Math.min( y0, y1 ), Math.max( x0, x1 ), Math.max( y0, y1 ) ).length > 0;

	// ---- floors ----
	const nodes = [];
	for ( const s of solids )
	{
		if ( s.w < 1 ) continue;
		let segs = [ [ s.x, s.x1 ] ];
		for ( const o of solids ) if ( o !== s && o.y < s.y - 0.5 && o.y1 >= s.y - 0.5 && o.x < s.x1 && o.x1 > s.x ) segs = subtract( segs, o.x, o.x1 );
		for ( const [ a, b ] of segs )
		{
			if ( b - a < 6 ) continue;
			// the ceiling over it, piece by piece
			const above = solids.filter( ( o )=>o !== s && o.y1 <= s.y - 0.5 && o.x < b && o.x1 > a );
			const cuts = [ a, b ];
			for ( const o of above ) { if ( o.x > a && o.x < b ) cuts.push( o.x ); if ( o.x1 > a && o.x1 < b ) cuts.push( o.x1 ); }
			cuts.sort( ( p, q )=>p - q );
			for ( let i = 0; i < cuts.length - 1; i++ )
			{
				const x0 = cuts[ i ], x1 = cuts[ i + 1 ];
				if ( x1 - x0 < 1 ) continue;
				let ceil = -Infinity;
				for ( const o of above ) if ( o.x < x1 && o.x1 > x0 ) ceil = Math.max( ceil, o.y1 );
				const head = s.y - ceil;
				if ( head < R.crouch ) continue;
				const prev = nodes[ nodes.length - 1 ];
				if ( prev && prev.wall === s && prev.x1 === x0 && Math.abs( prev.head - head ) < 1 ) { prev.x1 = x1; continue; }
				nodes.push( { i: nodes.length, x0, x1, y: s.y, head, wall: s, crouch: head < R.stand } );
			}
		}
	}
	// ---- the sea: open water column by column (10 px), joined where a swimmer fits through (≥ 30 px) ----
	const cols = [];                                                                // { x, iv: [ [y0, y1] ], surf, comp }
	for ( const w of L.water )
		for ( let x = w.x + 5; x < w.x1; x += 10 )
		{
			let iv = [ [ w.y, w.y1 ] ];
			for ( const s of solids ) if ( s.x < x + 5 && s.x1 > x - 5 ) iv = subtract( iv, s.y, s.y1 );
			iv = iv.filter( ( [ a, b ] )=>b - a >= 30 );
			cols.push( { x, w, iv, surf: iv.length && iv[ 0 ][ 0 ] <= w.y + 0.5 } );
		}
	cols.sort( ( a, b )=>a.x - b.x );
	const parent = [];
	const find = ( k )=>parent[ k ] === k ? k : ( parent[ k ] = find( parent[ k ] ) );
	const cells = [];
	for ( const c of cols ) { c.cells = c.iv.map( ( iv )=>{ const k = cells.length; parent.push( k ); cells.push( { c, iv } ); return k; } ); }
	for ( let i = 1; i < cols.length; i++ )
	{
		const a = cols[ i - 1 ], b = cols[ i ];
		if ( b.x - a.x > 10.5 ) continue;
		a.cells.forEach( ( ka )=>b.cells.forEach( ( kb )=>{ const p = cells[ ka ].iv, q = cells[ kb ].iv; if ( Math.min( p[ 1 ], q[ 1 ] ) - Math.max( p[ 0 ], q[ 0 ] ) >= 30 ) parent[ find( ka ) ] = find( kb ); } ) );
	}
	const surfCell = ( x )=>{ let best = null; for ( const c of cols ) if ( Math.abs( c.x - x ) <= 5 && c.surf ) best = c.cells[ 0 ]; return best; };
	// dead ends: a stretch of water under a wall (no surface) that ends against a wall
	const deadEnds = [];
	for ( let i = 0; i < cols.length; i++ )
	{
		const c = cols[ i ];
		if ( !c.iv.length || c.surf ) continue;
		let j = i; while ( j + 1 < cols.length && cols[ j + 1 ].iv.length && !cols[ j + 1 ].surf && cols[ j + 1 ].x - cols[ j ].x <= 10.5 ) j++;
		const leftOpen = i > 0 && cols[ i - 1 ].surf && c.x - cols[ i - 1 ].x <= 10.5, rightOpen = j + 1 < cols.length && cols[ j + 1 ].surf && cols[ j + 1 ].x - cols[ j ].x <= 10.5;
		if ( !leftOpen || !rightOpen ) deadEnds.push( { from: cols[ i ].x - 5, to: cols[ j ].x + 5, open: leftOpen ? 'left' : rightOpen ? 'right' : 'none' } );
		i = j;
	}
	for ( const d of deadEnds ) bad( 'underwater dead end under a wall', [ d.from, d.to ], 'covered water open only on the ' + d.open + ' side: a swimmer pinned under it drowns' );

	// ---- the boat lane (the players' boat: one no bot is crewing) ----
	const crewed = new Set( L.chars.filter( ( c )=>c.driverOf ).map( ( c )=>c.driverOf ) );
	const boats = L.ents.filter( ( e )=>e.type === 'TYPE_BOAT' );
	const myBoat = boats.find( ( b )=>!crewed.has( unq( b.id ) ) ) || null;
	let boat = null, boatNode = null;
	if ( myBoat )
	{
		const w = L.water.find( ( w )=>myBoat.x >= w.x && myBoat.x <= w.x1 ) || null;
		if ( !w ) bad( 'boat not on water', [ myBoat.x, myBoat.y ], 'the players\' boat is placed over no water' );
		else
		{
			const ok = ( x )=>x - R.boatHalf >= w.x && x + R.boatHalf <= w.x1 && !blocked( x - R.boatHalf, w.y - R.laneClear, x + R.boatHalf, w.y + R.laneDepth );
			let a = Math.round( myBoat.x ), b = a;
			if ( !ok( a ) ) bad( 'boat start blocked', [ myBoat.x ], 'the boat\'s own spot has something within 290 px above the water or 60 below' );
			else
			{
				while ( ok( a - 5 ) ) a -= 5;
				while ( ok( b + 5 ) ) b += 5;
			}
			const why = ( x )=>blockers( x - R.boatHalf, w.y - R.laneClear, x + R.boatHalf, w.y + R.laneDepth ).slice( 0, 2 ).map( ( s )=>[ s.x, s.y, s.w, s.h ] );
			boat = { x: myBoat.x, lane: [ a, b ], hull: [ a - R.boatHalf, b + R.boatHalf ], length: b - a, water: [ w.x, w.x1 ], stopsLeft: why( a - 5 ), stopsRight: why( b + 5 ) };
			// the boat as a floor: its deck (48 px up), anywhere along the lane
			boatNode = { i: nodes.length, x0: a - R.boatHalf + 20, x1: b + R.boatHalf - 20, y: w.y - R.boatDeck, head: 999, boat: true, surface: w.y };
			nodes.push( boatNode );
		}
	}

	// ---- moves ----
	const edges = nodes.map( ()=>[] );
	const add = ( a, b, kind )=>{ if ( a !== b ) edges[ a.i ].push( { to: b.i, kind } ); };
	for ( const A of nodes ) for ( const B of nodes ) { if ( A === B ) continue; const k = move( A, B ); if ( k ) add( A, B, k ); }
	function move( A, B )
	{
		if ( A.crouch && B.crouch ) return Math.abs( B.y - A.y ) <= 16 && ( B.x0 <= A.x1 + 2 && B.x1 >= A.x0 - 2 ) ? 'crawl' : null;
		const dy = B.y - A.y;                                                       // + : B is lower
		const apart = A.x1 <= B.x0 + 1 || B.x1 <= A.x0 + 1;                        // (touching counts: a step up from the next)
		if ( apart )
		{
			const right = B.x0 >= A.x1 - 1, g = Math.max( 0, right ? B.x0 - A.x1 : A.x0 - B.x1 ), ax = right ? A.x1 : A.x0, bx = right ? B.x0 : B.x1;
			if ( Math.abs( dy ) <= R.step && g <= 4 ) return 'walk';
			if ( g > 4 && !A.boat && !B.boat && blocked( Math.min( ax, bx ), Math.min( A.y, B.y ) - 90, Math.max( ax, bx ), Math.max( A.y, B.y ) - 2 ) ) return null;
			if ( g > 4 && ( A.boat || B.boat ) && blocked( Math.min( ax, bx ), Math.min( A.y, B.y ) - 90, Math.max( ax, bx ), Math.min( A.y, B.y ) - 2 ) ) return null;
			if ( dy < -R.step ) { const h = -dy; return h <= R.climb && g <= R.gap ? ( h <= R.hop ? 'hop' : 'climb' ) : null; }
			if ( dy > R.step ) return dy <= R.drop && g <= R.runGap ? 'drop' : null;
			return g <= R.runGap ? ( g <= R.gap ? 'jump' : 'runjump' ) : null;
		}
		if ( Math.abs( dy ) <= R.step ) return B.x0 <= A.x1 && B.x1 >= A.x0 && ( A.boat || B.boat ) ? 'walk' : null;
		if ( dy < 0 )
		{
			// up onto B from under it: at one of B's ends, if A reaches past it and nothing's in the way
			const h = -dy;
			if ( h > R.climb ) return null;
			if ( A.x0 <= B.x0 - 25 && !blocked( B.x0 - 30, B.y - 90, B.x0 - 1, A.y - 2 ) ) return h <= R.hop ? 'hop' : 'climb';
			if ( A.x1 >= B.x1 + 25 && !blocked( B.x1 + 1, B.y - 90, B.x1 + 30, A.y - 2 ) ) return h <= R.hop ? 'hop' : 'climb';
			return null;
		}
		// down off A's end onto B below
		if ( dy > R.drop ) return null;
		if ( B.x0 <= A.x0 - 25 && !blocked( A.x0 - 30, A.y - 90, A.x0 - 1, B.y - 2 ) ) return 'drop';
		if ( B.x1 >= A.x1 + 25 && !blocked( A.x1 + 1, A.y - 90, A.x1 + 30, B.y - 2 ) ) return 'drop';
		return null;
	}
	// ladders: every floor at the ladder, from its top to its bottom, joins every other (both ways)
	const ladders = L.ents.filter( ( e )=>e.type === 'TYPE_CS_LADDER' ).map( ( e )=>( { x: e.x, top: e.y, bottom: e.toy === null ? e.y + 300 : e.toy } ) );
	const W = { i: -1 };                                                                // (water nodes are components, added below)
	for ( const d of ladders )
	{
		if ( d.bottom - d.top < 60 ) bad( 'ladder too short', [ d.x, d.top ], 'top ' + d.top + ' bottom ' + d.bottom );
		if ( blocked( d.x - 10, d.top + 1, d.x + 10, d.bottom - 1 ) ) bad( 'ladder through a wall', [ d.x, d.top, d.bottom ], 'a solid wall crosses its shaft: ' + JSON.stringify( blockers( d.x - 10, d.top + 1, d.x + 10, d.bottom - 1 ).slice( 0, 2 ).map( ( s )=>[ s.x, s.y, s.w, s.h ] ) ) );
		d.nodes = nodes.filter( ( n )=>!n.crouch && n.x0 <= d.x + 80 && n.x1 >= d.x - 80 && n.y >= d.top - 5 && n.y <= d.bottom + 5 );
		for ( const a of d.nodes ) for ( const b of d.nodes ) if ( a !== b ) add( a, b, 'ladder' );
	}

	// swimming: water components are nodes too
	const compNode = new Map();
	const waterNode = ( k )=>{ const r = find( k ); if ( !compNode.has( r ) ) { const n = { i: nodes.length, water: true, comp: r, x0: 0, x1: 0, y: 0 }; nodes.push( n ); edges.push( [] ); compNode.set( r, n ); } return compNode.get( r ); };
	for ( const F of nodes.slice() )
	{
		if ( F.water ) continue;
		for ( const [ ex, dir ] of [ [ F.x0, -1 ], [ F.x1, 1 ] ] )
		{
			const k = surfCell( ex + dir * 15 );
			if ( k === null ) continue;
			const surface = cells[ k ].c.w.y;
			const WN = waterNode( k );
			if ( F.y >= surface - R.swimOut && F.y <= surface + 40 ) { add( WN, F, 'swim-out' ); add( F, WN, 'swim-in' ); }
			else if ( F.y < surface && F.y >= surface - R.drop && !blocked( ex + dir * 1, F.y - 90, ex + dir * 30, surface - 2 ) ) add( F, WN, 'dive' );
		}
	}
	if ( boatNode )
	{
		// aboard from the water at the surface, over the side into it
		const k = surfCell( boat.x );
		if ( k !== null ) { const WN = waterNode( k ); add( WN, boatNode, 'board' ); add( boatNode, WN, 'swim-in' ); }
	}
	for ( const d of ladders )
	{
		const k = surfCell( d.x );
		if ( k !== null && d.bottom >= cells[ k ].c.w.y ) { const WN = waterNode( k ); for ( const n of d.nodes ) { add( WN, n, 'ladder' ); add( n, WN, 'ladder' ); } }
	}

	// ---- the route from the start ----
	const at = ( x, y, tol = 6 )=>nodes.find( ( n )=>!n.water && !n.boat && n.x0 - 2 <= x && n.x1 + 2 >= x && Math.abs( n.y - y ) <= tol ) || null;
	const starts = L.chars.filter( ( c )=>c.player );
	const seen = new Uint8Array( nodes.length ), via = new Int32Array( nodes.length ).fill( -1 ), kindTo = [];
	const queue = [];
	for ( const s of starts ) { const n = at( s.x, s.feet ); if ( !n ) bad( 'start not on a floor', [ s.x, s.feet ], s.id ); else if ( !seen[ n.i ] ) { seen[ n.i ] = 1; queue.push( n.i ); } }
	while ( queue.length ) { const i = queue.shift(); for ( const e of edges[ i ] ) if ( !seen[ e.to ] ) { seen[ e.to ] = 1; via[ e.to ] = i; kindTo[ e.to ] = e.kind; queue.push( e.to ); } }
	const reached = ( n )=>!!n && !!seen[ n.i ];
	const moveKinds = {};
	for ( let i = 0; i < nodes.length; i++ ) if ( seen[ i ] && kindTo[ i ] ) moveKinds[ kindTo[ i ] ] = ( moveKinds[ kindTo[ i ] ] || 0 ) + 1;
	// in sight: a floor reached within 700 px with a clear line (sampled every 20 px, chest high)
	const clearLine = ( x0, y0, x1, y1 )=>{ const n = Math.ceil( Math.hypot( x1 - x0, y1 - y0 ) / 20 ); for ( let k = 1; k < n; k++ ) { const x = x0 + ( x1 - x0 ) * k / n, y = y0 + ( y1 - y0 ) * k / n; if ( blocked( x - 1, y - 1, x + 1, y + 1 ) ) return false; } return true; };
	const inSight = ( x, y )=>nodes.some( ( n )=>
	{
		if ( !seen[ n.i ] || n.water ) return false;
		for ( let px = Math.max( n.x0, x - R.sight ); px <= Math.min( n.x1, x + R.sight ); px += 50 ) { const py = n.y - 50; if ( Math.hypot( px - x, py - y ) <= R.sight && clearLine( px, py, x, y ) ) return true; }
		return false;
	} );

	const targets = [];
	const tgt = ( kind, name, x, y, need )=>{ const n = at( x, y ); const t = { kind, name, x: r1( x ), y: r1( y ), onFloor: !!n, reachable: reached( n ) }; if ( !t.reachable && need === 'sight' ) t.inSight = inSight( x, y - 50 ); targets.push( t ); return t; };
	for ( const e of L.ents )
	{
		if ( e.type === 'TYPE_CS_OBJECTIVE' ) tgt( 'objective', 'objective ' + ( e.id || e.style ), e.x, e.y );
		else if ( e.type === 'TYPE_CS_EXIT' ) tgt( 'exit', 'exit', e.x, e.y );
		else if ( e.type === 'TYPE_CS_CHECKPOINT' && e.style === 2 ) tgt( 'checkpoint', 'checkpoint (on foot) at ' + e.x, e.x, e.y );
		else if ( e.type === 'TYPE_TANK' ) { const n = nodes.find( ( n )=>!n.water && !n.boat && n.x0 <= e.x && n.x1 >= e.x && n.y > e.y && n.y - e.y < 140 ); targets.push( { kind: 'vehicle', name: 'tank ' + ( e.id || e.x ), x: e.x, y: e.y, onFloor: !!n, reachable: reached( n ) } ); }
	}
	const cs = L.chars.filter( ( c )=>!c.player && !c.driverOf );
	for ( const c of cs ) { const t = tgt( 'enemy', c.name + ' (' + c.id + ')', c.x, c.feet, 'sight' ); t.team = c.team; }
	const unreachable = targets.filter( ( t )=>t.kind === 'enemy' ? !t.reachable && !t.inSight : !t.reachable ).map( ( t )=>t.kind + ': ' + t.name + ' @ ' + t.x + ',' + t.y );

	// ---- rules ----
	// placement: every character on a floor and clear of walls
	for ( const c of L.chars )
	{
		if ( c.driverOf ) continue;
		if ( !at( c.x, c.feet ) ) bad( 'character not on a floor', [ c.x, c.feet ], c.name || c.id );
		if ( blocked( c.x - 9, c.feet - 78, c.x + 9, c.feet - 2 ) ) bad( 'character inside a wall', [ c.x, c.feet ], c.name || c.id );
	}
	// ceilings over walkways (standing room but under 100 px), and where people fight (info)
	const lowFight = [];
	for ( const n of nodes )
	{
		if ( n.water || n.boat || n.crouch || !seen[ n.i ] ) continue;
		if ( n.head < R.head && n.x1 - n.x0 >= 40 ) bad( 'ceiling under 100 px over a walkway', [ r1( n.x0 ), r1( n.x1 ), n.y ], 'headroom ' + r1( n.head ) );
		if ( n.head < R.fightHead && n.x1 - n.x0 >= 200 ) lowFight.push( [ r1( n.x0 ), r1( n.x1 ), n.y, r1( n.head ) ] );
	}
	// stairs: a run of narrow floors each a small step from the next
	const steps = nodes.filter( ( n )=>!n.water && !n.boat && n.wall.corner !== 'slice' && n.x1 - n.x0 <= 60 && !n.crouch );
	let stairSteps = 0;
	for ( const n of steps )
	{
		const nb = nodes.filter( ( m )=>m !== n && !m.water && !m.boat && m.wall.corner !== 'slice' && Math.abs( m.y - n.y ) > 0.5 && Math.abs( m.y - n.y ) <= R.step && ( Math.abs( m.x0 - n.x1 ) <= 1 || Math.abs( m.x1 - n.x0 ) <= 1 ) );
		if ( !nb.length ) continue;
		stairSteps++;
		for ( const m of nb ) if ( Math.abs( m.y - n.y ) > R.riser ) bad( 'stair riser over 30 px', [ n.x0, n.y ], 'rise ' + r1( Math.abs( m.y - n.y ) ) );
		if ( n.x1 - n.x0 < R.tread - 0.5 ) bad( 'stair tread under 30 px', [ n.x0, n.y ], 'tread ' + r1( n.x1 - n.x0 ) );
	}
	// berths: a replacement boat has ≥ 240 px each way to any wall near the water
	const berths = [];
	for ( const e of L.ents.filter( ( e )=>e.type === 'TYPE_CS_CHECKPOINT' && e.style === 1 ) )
	{
		const w = L.water.find( ( w )=>e.x >= w.x && e.x <= w.x1 );
		const s = w ? w.y : 0;
		const near = solids.filter( ( o )=>o.y < s + 60 && o.y1 > s - 150 );
		let left = Infinity, right = Infinity;
		for ( const o of near ) { if ( o.x1 <= e.x ) left = Math.min( left, e.x - o.x1 ); else if ( o.x >= e.x ) right = Math.min( right, o.x - e.x ); else { left = 0; right = 0; } }
		berths.push( { x: e.x, left: left === Infinity ? null : left, right: right === Infinity ? null : right } );
		if ( left < R.berth || right < R.berth ) bad( 'berth crowded', [ e.x ], 'room ' + left + ' / ' + right + ' px (needs 240 each way)' );
	}

	// ---- the layout's layers (Underhang-style layouts: pier caps, hanging containers, deck, road, tower) ----
	let capsWithCover = null, enemyLayers = null;
	if ( layout && layout.legs && layout.cap )
	{
		capsWithCover = 0;
		for ( const c of layout.legs )
		{
			const cover = L.walls.filter( ( w )=>Math.abs( w.y1 - layout.cap.top ) <= 1 && w.x >= c - layout.cap.half && w.x1 <= c + layout.cap.half && w.h >= 40 && w.h <= 110 );
			if ( cover.length ) capsWithCover++;
		}
		enemyLayers = { cap: 0, container: 0, interior: 0, road: 0, tower: 0, other: 0 };
		const T = layout.tower || { x0: 0, x1: -1 };
		for ( const c of cs )
		{
			const inTower = c.x > T.x0 && c.x < T.x1;
			const k = Math.abs( c.feet - layout.cap.top ) <= 5 ? 'cap' : Math.abs( c.feet - layout.containerTop ) <= 5 ? 'container' : Math.abs( c.feet - layout.floor ) <= 5 ? 'interior'
				: inTower && c.feet <= layout.road + 5 ? 'tower' : c.feet <= layout.road + 5 && c.feet >= layout.road - 250 ? 'road' : c.feet < layout.road ? 'tower' : 'other';
			enemyLayers[ k ]++;
		}
	}
	// ---- summary ----
	const strength = {};
	for ( const c of cs ) { const m = /\[(\d)\+\]/.exec( c.name ); const k = m ? m[ 1 ] + '+' : '1'; strength[ k ] = ( strength[ k ] || 0 ) + 1; }
	const byRule = {};
	for ( const v of violations ) byRule[ v.rule ] = ( byRule[ v.rule ] || 0 ) + 1;
	const xs = solids.map( ( s )=>s.x ).concat( solids.map( ( s )=>s.x1 ) ), ys = solids.map( ( s )=>s.y ).concat( solids.map( ( s )=>s.y1 ) );
	return {
		level: id, ok: violations.length === 0 && unreachable.length === 0,
		counts: { objects: objs.length, walls: L.walls.length, movables: L.movables.length, backs: L.backs.length, water: L.water.length, lamps: L.lamps.length, entities: L.ents.length,
			ladders: ladders.length, characters: L.chars.length, enemies: cs.length, guns: L.guns.length, floors: nodes.filter( ( n )=>!n.water && !n.boat ).length, stairSteps },
		bounds: xs.length ? [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ] : null,
		violations: violations.slice( 0, 60 ), violationsByRule: byRule, violationCount: violations.length,
		route: { starts: starts.length, reachableFloors: nodes.filter( ( n )=>seen[ n.i ] && !n.water && !n.boat ).length, moves: moveKinds, targets: targets.length, unreachable,
			objectives: targets.filter( ( t )=>t.kind === 'objective' ).map( ( t )=>( { name: t.name, reachable: t.reachable } ) ) },
		boat, water: { components: new Set( cells.map( ( c, k )=>find( k ) ) ).size, deadEnds }, berths,
		enemies: { total: cs.length, byStrength: strength, crews: L.chars.filter( ( c )=>c.driverOf ).length },
		entityTypes: countBy( L.ents.map( ( e )=>e.type ) ),
		lowFightCeilings: lowFight.slice( 0, 20 ),
		capsWithCover, enemyLayers,
		layout
	};
}
function subtract( segs, a, b )
{
	const out = [];
	for ( const [ p, q ] of segs ) { if ( b <= p || a >= q ) { out.push( [ p, q ] ); continue; } if ( a > p ) out.push( [ p, a ] ); if ( b < q ) out.push( [ b, q ] ); }
	return out;
}
function countBy( list ) { const o = {}; for ( const k of list ) o[ k ] = ( o[ k ] || 0 ) + 1; return o; }

if ( require.main === module )
{
	const id = process.argv[ 2 ] || '06';
	const i = process.argv.indexOf( '--lane-clear' );
	if ( i !== -1 ) R.laneClear = +process.argv[ i + 1 ];
	let out;
	try { out = lint( id ); }
	catch ( e ) { out = { level: id, ok: false, error: String( e && e.stack || e ).slice( 0, 1200 ) }; }
	const file = path.join( __dirname, 'results', id + '-lint.json' );
	try { fs.mkdirSync( path.dirname( file ), { recursive: true } ); fs.writeFileSync( file, JSON.stringify( out, null, 1 ) ); } catch ( e ) { /* read-only is fine */ }
	console.log( JSON.stringify( out ) );
}
module.exports = { lint, levelObjects, parse, R };
