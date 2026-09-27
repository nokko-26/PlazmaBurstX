// Phase 0 — the mod's vehicles placed on the yard map (rigs.js yardMap): each one's collision footprint once it has
// settled (every fixture that collides, of every body it has), in game px with y down, plus its spec numbers.
// Runs in its own browser profile (a copy of the logged-in one) with the More vehicles mod on. Writes
// results/vehicles.json and shots of each vehicle.
const fs = require( 'fs' ), path = require( 'path' ), { execSync } = require( 'child_process' );
const { launch } = require( '../launch' );
const { startMap } = require( '../game' );
const { YARD, yardMap } = require( '../rigs' );
const OUT = path.join( __dirname, 'results' );
const PROFILE = '/tmp/pb3x-profile-vehicles';
( async ()=>
{
	fs.mkdirSync( OUT, { recursive: true } );
	if ( !fs.existsSync( PROFILE ) ) { execSync( `cp -r /tmp/pb3x-profile ${PROFILE}` ); execSync( `rm -f ${PROFILE}/Singleton*` ); }
	const { ctx, page } = await launch( { profile: PROFILE, width: 1280, height: 720, mods: [ 'builtin/more-vehicles.user.js' ] } );
	const res = { at: new Date().toISOString() };
	try
	{
		await page.waitForFunction( ()=>window.__pb3x_mods && window.__pb3x_mods[ 'builtin/more-vehicles.user.js' ], null, { timeout: 60000 } );
		res.modStatus = await page.evaluate( ()=>window.__pb3x_mods[ 'builtin/more-vehicles.user.js' ] );
		await startMap( page, yardMap() );
		res.vehicleState = await page.evaluate( ()=>window.__moreVehicles && { status: window.__moreVehicles.status, error: window.__moreVehicles.error } );
		// let them settle: 6 s of game time at a fixed step
		await page.evaluate( ()=>new Promise( ( r )=>{ pb2_mp.DEBUG_FORCE_GSPEED = true; pb2_mp.DEBUG_FORCE_GSPEED_VALUE = 1; let n = 0; const f = ()=>{ if ( ++n < 180 ) requestAnimationFrame( f ); else r(); }; requestAnimationFrame( f ); } ) );
		const measure = ()=>page.evaluate( ( all )=>
		{
			const box = ( bodies )=>
			{
				let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity, n = 0;
				const add = ( x, y, rad = 0 )=>{ l = Math.min( l, x - rad ); r = Math.max( r, x + rad ); t = Math.min( t, y - rad ); b = Math.max( b, y + rad ); n++; };
				for ( const body of bodies || [] )
				{
					if ( !body || !body.GetFixtureList ) continue;
					for ( let f = body.GetFixtureList(); f; f = f.GetNext() )
					{
						if ( f.IsSensor && f.IsSensor() ) continue;
						const fd = f.GetFilterData && f.GetFilterData();
						if ( fd && fd.maskBits === 0 ) continue;                     // (muted: collides with nothing)
						const sh = f.GetShape();
						if ( sh.m_vertices && sh.m_vertexCount ) for ( let i = 0; i < sh.m_vertexCount; i++ ) { const p = body.GetWorldPoint( sh.m_vertices[ i ] ); add( p.x * 30, p.y * 30 ); }
						else if ( sh.m_p ) { const p = body.GetWorldPoint( sh.m_p ); add( p.x * 30, p.y * 30, sh.m_radius * 30 ); }
					}
				}
				return n ? { l, r, t, b, w: r - l, h: b - t, n } : null;
			};
			const out = [];
			for ( const v of all )
			{
				const e = pb2Entity.entities ? pb2Entity.entities.find( ( e )=>e && e.type === v.type && Math.abs( ( e.box2d_bodies && e.box2d_bodies[ 0 ] ? e.box2d_bodies[ 0 ].GetPosX() * 30 : 1e9 ) - v.x ) < 900 ) : null;
				if ( !e ) { out.push( { id: v.id, missing: true } ); continue; }
				const bb = box( e.box2d_bodies );
				out.push( { id: v.id, type: e.type, style: e.style_id, hea: e.hea, bodies: e.box2d_bodies.length, bbox: bb } );
			}
			return out;
		}, [ ...YARD.land, ...YARD.sea ] );
		res.vehicles = await measure();
		res.specs = await page.evaluate( ()=>
		{
			const sp = window.__moreVehicles && window.__moreVehicles._specs;
			if ( !sp ) return null;
			const pick = ( o )=>o && { seats: o.seats, enter: o.enter, speed: o.speed, top: o.top, surf: o.surf, draft: o.draft, keel: o.keel };
			return { boat: pick( sp.BOAT_SPEC[ 1 ] ), sub: pick( sp.SUB_SPEC[ 1 ] ), viper: pick( sp.HELI_SPEC && sp.HELI_SPEC[ 2 ] ), bastion: pick( sp.TANK_SPEC[ 3 ] ), ranger: pick( sp.TANK_SPEC[ 4 ] ) };
		} );
		// a shot of each, the camera on it
		for ( const v of [ ...YARD.land, ...YARD.sea ] )
		{
			const m = res.vehicles.find( ( x )=>x.id === v.id );
			if ( !m || !m.bbox ) continue;
			await page.evaluate( ( [ x, y ] )=>{ const c = pb2_mp.my_controller; c.camera_position_forced = true; c.camera_position_target_x = x; c.camera_position_target_y = y; }, [ ( m.bbox.l + m.bbox.r ) / 2, ( m.bbox.t + m.bbox.b ) / 2 - 60 ] );
			await page.evaluate( ()=>new Promise( ( r )=>{ let n = 0; const f = ()=>{ if ( ++n < 40 ) requestAnimationFrame( f ); else r(); }; requestAnimationFrame( f ); } ) );
			await page.screenshot( { path: path.join( OUT, 'vehicle-' + v.id + '.png' ) } );
		}
	}
	catch ( e ) { res.error = String( e.stack || e ).slice( 0, 1500 ); console.log( 'site log:', page.__log.slice( -10 ).join( ' | ' ) ); }
	fs.writeFileSync( path.join( OUT, 'vehicles.json' ), JSON.stringify( res, null, 1 ) );
	console.log( res.error || 'ok' );
	await ctx.close();
} )();
