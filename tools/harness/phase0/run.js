// Phase 0 — the character, measured by playing it: node phase0/run.js [bare|rifle …] [only:size,run,…]
// For each loadout (bare hands = weapon slot 0, or a rifle picked up at the spawn) it runs every test on the lab map
// (rigs.js) and writes results/<loadout>.json. A test the page interrupts (the site reloading) is retried once on a
// fresh map. Samples: [ t, x, y, vx, vy, top, bot, hea, air ] (game px, y down; t in game seconds).
const fs = require( 'fs' ), path = require( 'path' );
const { launch } = require( '../launch' );
const { startMap } = require( '../game' );
const { LAB, labMap } = require( '../rigs' );
const { LABKIT } = require( '../labkit' );
const OUT = path.join( __dirname, 'results' );
// bare: slot 0 (the sword every character has: the game's ×1.25 run force and extra jump); rifle: slot 2
const LOADOUTS = { bare: { gun: null, slot: 0 }, rifle: { gun: 'gun_rifle', slot: 2 } };
const args = process.argv.slice( 2 );
const loadouts = args.filter( ( a )=>a in LOADOUTS );
const only = ( args.find( ( a )=>a.startsWith( 'only:' ) ) || '' ).slice( 5 ).split( ',' ).filter( Boolean );
const want = ( k )=>!only.length || only.includes( k );

async function main()
{
	fs.mkdirSync( OUT, { recursive: true } );
	const { ctx, page } = await launch( { width: 960, height: 540 } );
	const ev = ( fn, ...a )=>page.evaluate( fn, ...a );
	for ( const lo of ( loadouts.length ? loadouts : Object.keys( LOADOUTS ) ) )
	{
		const file = path.join( OUT, lo + '.json' );
		const res = fs.existsSync( file ) ? JSON.parse( fs.readFileSync( file, 'utf8' ) ) : {};
		const save = ()=>fs.writeFileSync( file, JSON.stringify( res ) );
		const fresh = async ()=>
		{
			await startMap( page, labMap( { gun: LOADOUTS[ lo ].gun } ) );
			await page.evaluate( LABKIT );
			await ev( ()=>__lab.wait( 60 ) );
			// (a gun at the feet is picked up by the time it has stood a second; then its number key puts it in hand)
			res.slotAtStart = await ev( ( n )=>__lab.slot( n ), LOADOUTS[ lo ].slot );
		};
		await fresh();
		const run = async ( prog, frames, fn )=>( await ev( ( [ p, f ] )=>__lab.run( p, f ), [ prog, frames ] ) ).samples;
		const put = async ( x, feetAbove = 0 )=>ev( ( [ x, y ] )=>{ const ch = __lab.me(); ch.hmax = 150; ch.hea = 150; __lab.teleport( x, y ); }, [ x, -57.1 - feetAbove ] );
		const settle = ( n = 45 )=>ev( ( n )=>__lab.wait( n ), n );
		const runJump = async ( jumpAt, frames, extra = [] )=>( await ev( ( [ jumpAt, frames, extra ] )=>
		{
			let jumped = -1;
			return __lab.run( [ [ 0, 'down', 'KeyD' ], ...extra ], frames, ( f, s )=>
			{
				if ( jumped < 0 && s.x >= jumpAt ) { jumped = f; __lab.key( 'keydown', 'KeyW' ); }
				if ( jumped >= 0 && f === jumped + 2 ) __lab.key( 'keyup', 'KeyW' );
				if ( s.y > 400 ) return 'stop';
			} );
		}, [ jumpAt, frames, extra ] ) ).samples;
		const item = async ( name, fn )=>
		{
			if ( !want( name ) ) return;
			for ( let attempt = 0; attempt < 2; attempt++ )
			{
				try { await fn(); save(); console.log( lo, name, 'done' ); return; }
				catch ( e )
				{
					console.log( lo, name, 'interrupted:', e.message.split( '\n' )[ 0 ] );
					console.log( '  site log:', page.__log.slice( -8 ).join( ' | ' ) );
					await page.waitForLoadState( 'load' ).catch( ()=>{} );
					await fresh();
				}
			}
			res[ name ] = { error: 'interrupted twice' }; save();
		};

		await item( 'size', async ()=>
		{
			await put( 0 ); await settle( 60 );
			res.atoms = await ev( ()=>__lab.atoms() );
			res.stand = await ev( ()=>__lab.state() );
			res.crouch = await run( [ [ 0, 'down', 'KeyS' ] ], 60 );
		} );
		await item( 'run', async ()=>{ await put( -1500 ); await settle(); res.run = await run( [ [ 0, 'down', 'KeyD' ], [ 270, 'up', 'KeyD' ] ], 300 ); } );
		await item( 'sprint', async ()=>{ await put( -1500 ); await settle(); res.sprint = await run( [ [ 0, 'down', 'KeyD' ], [ 40, 'down', 'ShiftLeft' ], [ 270, 'up', 'KeyD' ], [ 270, 'up', 'ShiftLeft' ] ], 300 ); } );
		await item( 'crouchWalk', async ()=>{ await put( -1500 ); await settle(); res.crouchWalk = await run( [ [ 0, 'down', 'KeyS' ], [ 0, 'down', 'KeyD' ], [ 200, 'up', 'KeyD' ] ], 220 ); } );
		await item( 'jump', async ()=>
		{
			await put( 0 ); await settle();
			res.jumpTap = await run( [ [ 0, 'down', 'KeyW' ], [ 2, 'up', 'KeyW' ] ], 150 );
			await put( 0 ); await settle();
			res.jumpHold = await run( [ [ 0, 'down', 'KeyW' ], [ 200, 'up', 'KeyW' ] ], 220 );
			await put( 0 ); await settle();
			res.jumpAirControl = await run( [ [ 0, 'down', 'KeyW' ], [ 2, 'up', 'KeyW' ], [ 4, 'down', 'KeyD' ], [ 150, 'up', 'KeyD' ] ], 150 );
		} );
		await item( 'runJump', async ()=>
		{
			await put( -1500 ); await settle();
			res.runJump = await runJump( -1500 + 700, 260 );
			await put( -1500 ); await settle();
			res.sprintJump = await runJump( -1500 + 900, 300, [ [ 40, 'down', 'ShiftLeft' ] ] );
		} );
		await item( 'ledges', async ()=>
		{
			res.ledges = [];
			let fails = 0;
			for ( let i = 0; i < LAB.ledges.heights.length && fails < 2; i++ )
			{
				const h = LAB.ledges.heights[ i ], lx = LAB.ledges.x0 + i * LAB.ledges.step;
				const row = { h, tries: [] };
				for ( const d of [ 30, 90, 160, 240 ] )
				{
					await put( lx - 620 ); await settle();
					const s = await runJump( lx - d, 240 );
					const on = s.some( ( r )=>Math.abs( r[ 6 ] + h ) < 6 && r[ 1 ] > lx && r[ 1 ] < lx + LAB.ledges.w );
					row.tries.push( { d, on } );
					if ( on ) break;
				}
				row.ok = row.tries.some( ( t )=>t.on );
				fails = row.ok ? 0 : fails + 1;
				res.ledges.push( row );
				console.log( '  ledge', h, row.ok ? 'made it' : 'failed' );
			}
		} );
		await item( 'gaps', async ()=>
		{
			res.gaps = [];
			for ( const g of LAB.gaps.edges )
			{
				const row = { w: g.w, tries: [] };
				for ( const d of [ 12, 40 ] )
				{
					await put( g.takeoff - 760 ); await settle();
					const s = await runJump( g.takeoff - d, 260 );
					const end = s[ s.length - 1 ];
					const ok = end[ 2 ] < 0 && end[ 1 ] > g.land;
					row.tries.push( { d, ok } );
					if ( ok ) break;
				}
				row.ok = row.tries.some( ( t )=>t.ok );
				res.gaps.push( row );
				console.log( '  gap', g.w, row.ok ? 'made it' : 'failed' );
				if ( !row.ok ) break;
			}
		} );
		await item( 'falls', async ()=>
		{
			res.falls = [];
			for ( const h of [ 150, 250, 300, 350, 400, 450, 550, 650, 750, 900, 1100, 1300, 1600, 2000 ] )
			{
				await put( 2600 ); await settle( 30 );
				await put( 2600, h );
				// (a character killed outright is gone from the next frame on: that counts as dead)
				const r = await ev( ()=>__lab.run( [], 150 ) ), s = r.samples;
				const minHea = Math.min( ...s.map( ( x )=>x[ 7 ] ) );
				const dead = r.gone !== undefined || !( minHea > 0 );
				res.falls.push( { h, minHea: dead ? 0 : minHea, impactVy: Math.round( s.reduce( ( m, x )=>Math.max( m, x[ 4 ] ), 0 ) ), dead } );
				console.log( '  fall', h, '->', dead ? 'dead' : Math.round( minHea ) );
				if ( dead ) break;
			}
		} );
		await item( 'swim', async ()=>
		{
			if ( !( await ev( ()=>!!__lab.me() ) ) ) await fresh();
			const px = LAB.pool.x0 + 400;
			res.swim = {};
			await put( px, 40 );
			await ev( ()=>{ __lab.STEP = 1; } );
			res.swim.idle = await run( [], 240 );
			res.swim.right = await run( [ [ 0, 'down', 'KeyD' ] ], 120 );
			res.swim.up = await run( [ [ 0, 'down', 'KeyW' ] ], 120 );
			res.swim.down = await run( [ [ 0, 'down', 'KeyS' ] ], 150 );
			await put( px + 900, -700 );
			res.swim.breath = ( await ev( ()=>__lab.run( [ [ 0, 'down', 'KeyS' ] ], 1500, ( f, s )=>s.dead ? 'stop' : null ) ) ).samples;
			await ev( ()=>{ __lab.STEP = 0.5; } );
		} );
		await page.screenshot( { path: path.join( OUT, lo + '-end.png' ) } );
		save();
	}
	await ctx.close();
}
main().catch( ( e )=>{ console.log( 'FAILED', e.stack ); process.exit( 1 ); } );
