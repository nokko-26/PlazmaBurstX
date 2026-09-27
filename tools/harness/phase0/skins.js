// Phase 0 — the skins that matter for the campaign, drawn in the game: node phase0/skins.js
const fs = require( 'fs' ), path = require( 'path' ), { execSync } = require( 'child_process' );
const { launch } = require( '../launch' );
const { startMap } = require( '../game' );
const { skinsMap } = require( '../rigs' );
const OUT = path.join( __dirname, 'results' );
const PROFILE = '/tmp/pb3x-profile-vehicles';
const ROWS = {
	cs: [ 7, 8, 11, 12, 77, 17, 13, 73, 74, 60, 61, 72, 62, 63, 75 ],
	nameOnly: [ 78, 137, 23, 24, 25, 26, 32, 89, 19, 133, 149, 150, 1 ]
};
( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	if ( !fs.existsSync( PROFILE ) ) { execSync( `cp -r /tmp/pb3x-profile ${PROFILE}` ); execSync( `rm -f ${PROFILE}/Singleton*` ); }
	const { ctx, page } = await launch( { profile: PROFILE, width: 1600, height: 900 } );
	const res = {};
	for ( const [ row, frames ] of Object.entries( ROWS ) )
	{
		await startMap( page, skinsMap( frames ) );
		await page.waitForTimeout( 3000 );
		const mid = ( frames.length - 1 ) * 90 / 2 - 110;                                 // (the camera leads a little to the right)
		await page.evaluate( ( x )=>{ const c = pb2_mp.my_controller; c.camera_position_forced = true; c.camera_position_target_x = x; c.camera_position_target_y = -60; }, mid );
		await page.waitForTimeout( 2500 );
		await page.screenshot( { path: path.join( OUT, 'skins-' + row + '.png' ) } );
		res[ row ] = await page.evaluate( ()=>pb2Ragdoll.ragdolls.map( ( r )=>( { name: r.name, frame: r.kN && r.kN.frame } ) ) );
	}
	fs.writeFileSync( path.join( OUT, 'skins.json' ), JSON.stringify( res, null, 1 ) );
	console.log( 'ok' );
	await ctx.close();
} )();
