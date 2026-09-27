// Phase 0 — out of the water: the highest wall a swimmer climbs out onto, and swimming up from the deep.
// node phase0/swim-exit.js [bare|rifle]  → results/swim-exit-<loadout>.json
const fs = require( 'fs' ), path = require( 'path' ), { execSync } = require( 'child_process' );
const { launch } = require( '../launch' );
const { startMap } = require( '../game' );
const { EXIT, exitMap } = require( '../rigs' );
const { LABKIT } = require( '../labkit' );
const OUT = path.join( __dirname, 'results' );
const PROFILE = '/tmp/pb3x-profile-vehicles';
const lo = process.argv[ 2 ] || 'rifle';
( async ()=>
{
	if ( !fs.existsSync( PROFILE ) ) { execSync( `cp -r /tmp/pb3x-profile ${PROFILE}` ); execSync( `rm -f ${PROFILE}/Singleton*` ); }
	const { ctx, page } = await launch( { profile: PROFILE, width: 960, height: 540 } );
	const res = { loadout: lo, exits: [] };
	const map = exitMap();
	await startMap( page, map );
	await page.evaluate( LABKIT );
	if ( lo === 'rifle' )
	{
		await page.evaluate( ()=>{ const ch = __lab.me(); pb2Gun.CreateGun( { type: 'gun_rifle', x: ch.x, y: ch.y } ); } );
		await page.evaluate( ()=>__lab.wait( 60 ) );
		res.slot = await page.evaluate( ()=>__lab.slot( 2 ) );
	}
	const ev = ( fn, ...a )=>page.evaluate( fn, ...a );
	for ( const b of EXIT.basins )
	{
		const row = { h: b.h, tries: [] };
		for ( const hold of [ [ 'KeyD', 'KeyW' ], [ 'KeyD' ] ] )
		{
			await ev( ( [ x ] )=>{ const ch = __lab.me(); ch.hmax = 150; ch.hea = 150; ch.ragdoll.air = 1; __lab.teleport( x, 40 ); return __lab.wait( 90 ); }, [ b.wallX - 160 ] );
			const prog = hold.map( ( k )=>[ 0, 'down', k ] );
			const s = ( await ev( ( [ p ] )=>__lab.run( p, 360 ), [ prog ] ) ).samples;
			const out = s.some( ( r )=>r[ 1 ] > b.wallX + 10 && r[ 6 ] <= -b.h + 6 );
			row.tries.push( { hold: hold.join( '+' ), out } );
			if ( out ) break;
		}
		row.ok = row.tries.some( ( t )=>t.out );
		res.exits.push( row );
		console.log( 'exit wall', b.h, row.ok ? 'climbed out' : 'stuck', JSON.stringify( row.tries ) );
	}
	// swimming up from 600 px down, W held
	await ev( ( [ x ] )=>{ const ch = __lab.me(); ch.ragdoll.air = 1; __lab.teleport( x, 600 ); return __lab.wait( 30 ); }, [ EXIT.basins[ 0 ].x + 250 ] );
	res.up = ( await ev( ()=>__lab.run( [ [ 0, 'down', 'KeyW' ] ], 240 ) ) ).samples;
	fs.writeFileSync( path.join( OUT, 'swim-exit-' + lo + '.json' ), JSON.stringify( res ) );
	await page.screenshot( { path: path.join( OUT, 'swim-exit-' + lo + '.png' ) } );
	console.log( 'ok' );
	await ctx.close();
} )();
