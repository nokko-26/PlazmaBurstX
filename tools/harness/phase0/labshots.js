// Phase 0 — pictures of the lab: the ruler, the ledges, the gaps, the pool (results/lab-*.png)
const fs = require( 'fs' ), path = require( 'path' ), { execSync } = require( 'child_process' );
const { launch } = require( '../launch' );
const { startMap } = require( '../game' );
const { LAB, labMap } = require( '../rigs' );
const { LABKIT } = require( '../labkit' );
const { shoot } = require( '../shots' );
const OUT = path.join( __dirname, 'results' );
const PROFILE = '/tmp/pb3x-profile-vehicles';
( async ()=>
{
	if ( !fs.existsSync( PROFILE ) ) { execSync( `cp -r /tmp/pb3x-profile ${PROFILE}` ); execSync( `rm -f ${PROFILE}/Singleton*` ); }
	const { ctx, page } = await launch( { profile: PROFILE, width: 1600, height: 900 } );
	await startMap( page, labMap( { gun: 'gun_rifle' } ) );
	await page.evaluate( LABKIT );
	await page.evaluate( ()=>__lab.slot( 2 ) );
	const put = ( x, y = -57.1 )=>page.evaluate( ( [ x, y ] )=>{ __lab.teleport( x, y ); return __lab.wait( 40 ); }, [ x, y ] );
	await put( LAB.ruler.x + 40 );
	await page.evaluate( ()=>__lab.free() );
	await shoot( page, path.join( OUT, 'lab-ruler.png' ), { x: LAB.ruler.x - 40, y: -60, zoom: 0.5 } );
	await shoot( page, path.join( OUT, 'lab-ledges.png' ), { x: LAB.ledges.x0 + 4.5 * LAB.ledges.step, y: -150, zoom: 3 } );
	await shoot( page, path.join( OUT, 'lab-gaps.png' ), { x: LAB.gaps.x0 + 3000, y: 200, zoom: 3 } );
	await put( LAB.pool.x0 + 900, 200 );
	await page.evaluate( ()=>__lab.free() );
	await shoot( page, path.join( OUT, 'lab-pool.png' ), { x: LAB.pool.x0 + 1200, y: 400, zoom: 2 } );
	console.log( 'ok' );
	await ctx.close();
} )();
