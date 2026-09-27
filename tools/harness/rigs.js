// Test rigs for Phase 0 (docs/cs-coastal-tower/metrics.md). World px, y down, the floor's top at y = 0.
const { MapJS } = require( './mapjs' );

// The lab: one long map with a stretch for each measurement. The character is moved between them.
const LAB = {
	lane: [ -2000, 4000 ],                                                     // flat run lane (speeds, jumps, crouch)
	ledges: { x0: 4600, step: 1000, w: 220,        // (780 px of floor before each: a full run-up)
		 heights: [ 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 320 ] },
	gaps: { x0: 12400, runup: 900, widths: [ 120, 180, 240, 300, 360, 420, 480, 540, 600 ], depth: 1200 },
	pool: { x0: 0, w: 2400, depth: 1100 },                                      // (x0 set below: after the gaps)
	ruler: { x: -1800, marks: [ 20, 40, 60, 80, 100, 120 ] }                  // (at the lane's far end: out of the runs' way)
};
function labMap( { water = true, gun = null } = {} )
{
	const m = new MapJS();
	m.world( { sky_color: '0x9aa8b8', sky_intensity: 0.8, sun_intensity: 0.2 } );
	const rock = m.surface( 'Lab floor', 'rock_slice', { color: 'new pb2HighRangeColor( 0x9098a0 )' } );
	const mark = m.surface( 'Lab marks', 'metal_slice', { color: 'new pb2HighRangeColor( 0xff5030 )' } );
	const skin = m.skin( 1 ), team = m.team( 'Lab' );
	// the lane, the ledges' floor
	let x = LAB.lane[ 0 ];
	const lastLedge = LAB.ledges.x0 + LAB.ledges.step * LAB.ledges.heights.length;
	m.box( x, 0, lastLedge + 600 - x, 400, rock );
	// a ruler: thin posts of known heights (20 px apart), for the screenshots
	LAB.ruler.marks.forEach( ( h, i )=>m.box( LAB.ruler.x - i * 24, -h, 8, h, mark ) );
	// ledges: blocks of rising height standing on the floor
	LAB.ledges.heights.forEach( ( h, i )=>m.box( LAB.ledges.x0 + i * LAB.ledges.step, -h, LAB.ledges.w, h, rock ) );
	// gaps: platforms at floor height with pits between them (a floor deep down catches misses)
	x = lastLedge + 600;
	const g0 = x;
	LAB.gaps.x0 = g0;
	LAB.gaps.edges = [];
	for ( const w of LAB.gaps.widths )
	{
		m.box( x, 0, LAB.gaps.runup, 400, rock );
		LAB.gaps.edges.push( { takeoff: x + LAB.gaps.runup, land: x + LAB.gaps.runup + w, w } );
		x += LAB.gaps.runup + w;
	}
	m.box( x, 0, LAB.gaps.runup, 400, rock );
	x += LAB.gaps.runup;
	m.box( g0, LAB.gaps.depth, x - g0, 200, rock );                             // (the catch floor)
	// the pool: a basin as deep as LAB.pool.depth, full to the brim
	LAB.pool.x0 = x + 400;
	m.box( x, 0, 400, 400, rock );
	m.box( LAB.pool.x0 - 200, 0, 200, LAB.pool.depth + 200, rock );
	m.box( LAB.pool.x0 + LAB.pool.w, 0, 200, LAB.pool.depth + 200, rock );
	m.box( LAB.pool.x0 - 200, LAB.pool.depth, LAB.pool.w + 400, 200, rock );
	if ( water ) m.water( LAB.pool.x0, 0, LAB.pool.w, LAB.pool.depth, m.waterClass() );
	m.box( LAB.pool.x0 + LAB.pool.w + 200, 0, 1200, 400, rock );
	LAB.end = LAB.pool.x0 + LAB.pool.w + 1400;
	// the player at the lane's start
	m.player( 0, -40, skin, team, { hmax: 150 } );
	if ( gun ) m.gun( gun, 0, -20 );                                             // (at its feet: it picks it up)
	return m.build();
}
module.exports = { LAB, labMap };

// The vehicle yard: ground for the land and air vehicles, a deep basin for the boat and the submarine. Each vehicle
// stands clear of the others; the player waits at the yard's left end.
const YARD = {
	ground: [ -3000, 3000 ],
	land: [ { id: 'viper', type: 26, style: 2, x: -2200 }, { id: 'ranger', type: 28, style: 4, x: -1300 }, { id: 'bastion', type: 28, style: 3, x: -300 } ],
	basin: { x0: 3400, w: 7600, depth: 1400 },
	sea: [ { id: 'boat', type: 33, style: 1, x: 4400 }, { id: 'wraith', type: 34, style: 1, x: 8200, y: 300 } ]
};
function yardMap()
{
	const m = new MapJS();
	m.world( { sky_color: '0x9aa8b8', sky_intensity: 0.8, sun_intensity: 0.2 } );
	const rock = m.surface( 'Yard floor', 'rock_slice', { color: 'new pb2HighRangeColor( 0x9098a0 )' } );
	const skin = m.skin( 1 ), team = m.team( 'Yard' );
	const b = YARD.basin;
	m.box( YARD.ground[ 0 ], 0, b.x0 - YARD.ground[ 0 ], 400, rock );
	m.box( b.x0 - 200, 0, 200, b.depth + 200, rock );
	m.box( b.x0 + b.w, 0, 200, b.depth + 200, rock );
	m.box( b.x0 - 200, b.depth, b.w + 400, 200, rock );
	m.box( b.x0 + b.w, 0, 1200, 400, rock );
	m.water( b.x0, 0, b.w, b.depth, m.waterClass() );
	for ( const v of YARD.land ) m.entity( v.type, v.x, v.y || -150, { style_id: v.style, side: 1 } );
	for ( const v of YARD.sea ) m.entity( v.type, v.x, v.y || -60, { style_id: v.style, side: 1 } );
	m.player( YARD.ground[ 0 ] + 200, -40, skin, team );
	return m.build();
}
module.exports.YARD = YARD;
module.exports.yardMap = yardMap;

// A line-up of skins (frame ids), each standing still with its frame as its name, for checking them by eye.
function skinsMap( frames, spacing = 90 )
{
	const m = new MapJS();
	m.world( { sky_color: '0xb0bccc', sky_intensity: 0.9, sun_intensity: 0.3 } );
	const rock = m.surface( 'Floor', 'rock_slice', { color: 'new pb2HighRangeColor( 0x9098a0 )' } );
	const team = m.team( 'Line-up', { ai_in_team: false } );
	const w = frames.length * spacing + 800;
	m.box( -400, 0, w, 400, rock );
	frames.forEach( ( f, i )=>m.character( i * spacing, -40, m.skin( f ), team, { name: "'" + f + "'", player_controllable: false, ai_preset: null } ) );
	m.player( -300, -40, m.skin( 1 ), team );
	return m.build();
}
module.exports.skinsMap = skinsMap;

// Climbing out of water: basins side by side, each one's right-hand wall `h` above the surface (y = 0).
const EXIT = { x0: 0, w: 500, depth: 700, heights: [ 0, 20, 40, 60, 80, 100, 120, 140, 160 ] };
function exitMap()
{
	const m = new MapJS();
	m.world( { sky_color: '0x9aa8b8', sky_intensity: 0.8, sun_intensity: 0.2 } );
	const rock = m.surface( 'Basin', 'rock_slice', { color: 'new pb2HighRangeColor( 0x9098a0 )' } );
	const liquid = m.waterClass();
	const skin = m.skin( 1 ), team = m.team( 'Swim' );
	let x = EXIT.x0;
	m.box( x - 600, -40, 600, 440, rock );                                          // (the start: a shelf on the left)
	EXIT.basins = [];
	for ( const h of EXIT.heights )
	{
		m.box( x, EXIT.depth, EXIT.w, 200, rock );                                  // (the floor)
		m.water( x, 0, EXIT.w, EXIT.depth, liquid );
		m.box( x + EXIT.w, -h, 200, EXIT.depth + 200 + h, rock );                    // (the wall to climb out on)
		EXIT.basins.push( { x, h, wallX: x + EXIT.w } );
		x += EXIT.w + 200;
	}
	m.box( x, -200, 400, 600, rock );
	m.player( EXIT.x0 - 300, -80, skin, team );
	return m.build();
}
module.exports.EXIT = EXIT;
module.exports.exitMap = exitMap;
