// Summaries of Phase 0 samples: [ t, x, y, vx, vy, top, bot, hea, air ]
const T = 0, X = 1, Y = 2, VX = 3, VY = 4, TOP = 5, BOT = 6, HEA = 7, AIR = 8;
const r1 = ( v )=>Math.round( v * 10 ) / 10;
// steady horizontal speed: the mean over [ t0, t1 ] of dx/dt
function speed( s, t0, t1 ) { const a = s.find( ( r )=>r[ T ] >= t0 ), b = [ ...s ].reverse().find( ( r )=>r[ T ] <= t1 ); return r1( ( b[ X ] - a[ X ] ) / ( b[ T ] - a[ T ] ) ); }
// time to reach 95 % of a steady speed
function accelTime( s, v ) { const r = s.find( ( r )=>Math.abs( r[ VX ] ) >= 0.95 * Math.abs( v ) ); return r ? r1( r[ T ] ) : null; }
// a jump: the feet's rise (floor = the feet at the start), airtime (feet more than 2 px up), horizontal distance
function jump( s, floor = s[ 0 ][ BOT ] )
{
	// the airborne stretch around the highest point (feet more than 2 px up), not the first bump
	let ia = 0;
	s.forEach( ( r, i )=>{ if ( floor - r[ BOT ] > floor - s[ ia ][ BOT ] ) ia = i; } );
	const apex = floor - s[ ia ][ BOT ];
	let i0 = ia, i1 = ia;
	while ( i0 > 0 && floor - s[ i0 - 1 ][ BOT ] > 2 ) i0--;
	while ( i1 < s.length - 1 && floor - s[ i1 + 1 ][ BOT ] > 2 ) i1++;
	const up = i0 > 0 ? s[ i0 ] : null, down = i1 < s.length - 1 ? s[ i1 + 1 ] : null;
	return { apex: r1( apex ), tApex: r1( s[ ia ][ T ] - ( up ? up[ T ] : 0 ) ), airtime: up && down ? r1( down[ T ] - up[ T ] ) : null, dist: up && down ? r1( down[ X ] - up[ X ] ) : null,
		takeoffX: up ? r1( up[ X ] ) : null, landX: down ? r1( down[ X ] ) : null, speedAtTakeoff: up && i0 > 3 ? r1( ( s[ i0 ][ X ] - s[ i0 - 3 ][ X ] ) / ( s[ i0 ][ T ] - s[ i0 - 3 ][ T ] ) ) : null,
		headApex: r1( floor - Math.min( ...s.map( ( r )=>r[ TOP ] ) ) ) };
}
module.exports = { speed, accelTime, jump, T, X, Y, VX, VY, TOP, BOT, HEA, AIR, r1 };
// everything measured for one loadout (results/<loadout>.json), as numbers for metrics.md
function summary( res )
{
	const o = { slotAtStart: res.slotAtStart };
	if ( res.stand ) { const st = res.stand; o.height = r1( st.bot - st.top ); o.width = r1( st.r - st.l ); }
	if ( res.crouch ) { const c = res.crouch[ res.crouch.length - 1 ]; o.crouchHeight = r1( c[ BOT ] - c[ TOP ] ); }
	// (steady speed: run and sprint over 3–4.4 s, before D is let go at 4.5 s; crouch-walk over 2–3.3 s, before 3.33 s)
	for ( const k of [ 'run', 'sprint', 'crouchWalk' ] ) if ( res[ k ] ) { const v = k === 'crouchWalk' ? speed( res[ k ], 2, 3.3 ) : speed( res[ k ], 3, 4.4 ); o[ k ] = { speed: v, t95: accelTime( res[ k ], v ) }; }
	if ( res.sprint ) o.sprint.at1_5s = speed( res.sprint, 1.4, 1.6 );
	for ( const k of [ 'jumpTap', 'jumpHold', 'jumpAirControl' ] ) if ( res[ k ] ) o[ k ] = jump( res[ k ] );
	if ( res.jumpHold ) { const s = res.jumpHold, f = s[ 0 ][ BOT ]; let n = 0, air = false; for ( const r of s ) { const up = f - r[ BOT ] > 4; if ( up && !air ) n++; air = up; } o.jumpHold.hops = n; }
	for ( const k of [ 'runJump', 'sprintJump' ] ) if ( res[ k ] ) o[ k ] = jump( res[ k ] );
	if ( res.ledges ) { o.ledges = res.ledges.map( ( l )=>l.h + ( l.ok ? '✓' : '✗' ) ).join( ' ' ); o.maxLedge = Math.max( 0, ...res.ledges.filter( ( l )=>l.ok ).map( ( l )=>l.h ) ); }
	if ( res.gaps ) { o.gaps = res.gaps.map( ( g )=>g.w + ( g.ok ? '✓' : '✗' ) ).join( ' ' ); o.maxGap = Math.max( 0, ...res.gaps.filter( ( g )=>g.ok ).map( ( g )=>g.w ) ); }
	if ( res.falls ) o.falls = res.falls.map( ( f )=>f.h + ':' + Math.round( f.minHea ) + ( f.dead ? '†' : '' ) ).join( ' ' );
	if ( res.swim )
	{
		const w = res.swim, last = ( s )=>s[ s.length - 1 ];
		const idle = w.idle;
		o.swim = {
			idleDrift: r1( ( last( idle )[ Y ] - idle[ 0 ][ Y ] ) / ( last( idle )[ T ] - idle[ 0 ][ T ] ) ),  // px/s (+ = sinking)
			right: speed( w.right, w.right[ 0 ][ T ] + 1, last( w.right )[ T ] ),
			up: r1( -( last( w.up )[ Y ] - w.up[ 0 ][ Y ] ) / ( last( w.up )[ T ] - w.up[ 0 ][ T ] ) ),
			down: r1( ( last( w.down )[ Y ] - w.down[ 0 ][ Y ] ) / ( last( w.down )[ T ] - w.down[ 0 ][ T ] ) )
		};
		const b = w.breath, t0 = b[ 0 ][ T ];
		const hurt = b.find( ( r )=>r[ HEA ] < b[ 0 ][ HEA ] - 0.5 ), dead = b.find( ( r )=>!( r[ HEA ] > 0 ) );
		o.swim.airAtStart = b[ 0 ][ AIR ]; o.swim.firstDamage = hurt ? r1( hurt[ T ] - t0 ) : null; o.swim.death = dead ? r1( dead[ T ] - t0 ) : null;
	}
	return o;
}
module.exports.summary = summary;
if ( require.main === module )
{
	const fs = require( 'fs' );
	for ( const lo of process.argv.slice( 2 ).length ? process.argv.slice( 2 ) : [ 'bare', 'rifle' ] )
	{
		const f = __dirname + '/results/' + lo + '.json';
		if ( !fs.existsSync( f ) ) continue;
		console.log( '== ' + lo );
		console.log( JSON.stringify( summary( JSON.parse( fs.readFileSync( f, 'utf8' ) ) ), null, 1 ) );
	}
}
