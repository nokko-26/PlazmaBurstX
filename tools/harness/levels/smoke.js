// Load a level in the editor, play it as tester, and report: node levels/smoke.js 01
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { MODS, openEditor, importLevel, playTest } = require( '../level' );
const id = process.argv[ 2 ] || '01';
const OUT = path.join( __dirname, 'results' );
( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	const { ctx, page } = await launch( { profile: '/tmp/pb3x-profile-vehicles', width: 1600, height: 900, mods: MODS } );
	const errors = [];
	page.on( 'pageerror', ( e )=>{ if ( !/pb2Settings is not defined|AppendSoundsArray/.test( e.message ) && errors.length < 5 ) errors.push( ( e.stack || e.message ).slice( 0, 1500 ) ); } );
	try
	{
		await openEditor( page );
		const n = await importLevel( page, id );
		console.log( 'imported', n, 'objects' );
		await page.screenshot( { path: path.join( OUT, id + '-editor.png' ) } );
		await playTest( page );
		await page.waitForTimeout( 5000 );
		await page.screenshot( { path: path.join( OUT, id + '-start.png' ) } );
		console.log( JSON.stringify( await page.evaluate( ()=>( { tower: window.__csTower.status, error: window.__csTower.error, coop: window.__csTower.coop, boats: window.__csTower.boats,
			ents: pb2Entity.entities.filter( Boolean ).map( ( e )=>e.type ).join( ',' ), chars: pb2Character.characters.length } ) ) ) );
	}
	catch ( e ) { console.log( 'FAILED', e.message.slice( 0, 1500 ) ); await page.screenshot( { path: path.join( OUT, id + '-failed.png' ) } ).catch( ()=>{} ); }
	console.log( 'page errors:\n' + [ ...new Set( errors ) ].join( '\n----\n' ) );
	await ctx.close();
} )();
