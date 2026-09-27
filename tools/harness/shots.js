// Screenshots from set camera spots: shoot( page, file, { x, y, zoom } ). zoom > 1 pulls the camera back (it scales
// the game camera's distance for that frame and puts it back after). Game px, y down.
async function shoot( page, file, { x, y, zoom = 1, frames = 30 } = {} )
{
	await page.evaluate( async ( [ x, y, zoom, frames ] )=>
	{
		const c = pb2_mp.my_controller;
		c.camera_position_forced = true; c.camera_position_target_x = x; c.camera_position_target_y = y;
		window.__shotZoom = zoom;
		if ( !window.__shotZoomHooked )
		{
			// the game sets its camera each frame; scale its distance from the scene afterwards
			window.__shotZoomHooked = true;
			const cam = pb2_mp.cS, XM = pb2_mp.XM, render = XM.render;
			XM.render = function()
			{
				const z = window.__shotZoom || 1, keep = cam.position.z;
				if ( z !== 1 ) { cam.position.z = keep * z; cam.updateMatrixWorld( true ); }
				const r = render.apply( this, arguments );
				if ( z !== 1 ) { cam.position.z = keep; cam.updateMatrixWorld( true ); }
				return r;
			};
		}
		await new Promise( ( r )=>{ let n = 0; const f = ()=>{ if ( ++n < frames ) requestAnimationFrame( f ); else r(); }; requestAnimationFrame( f ); } );
	}, [ x, y, zoom, frames ] );
	await page.screenshot( { path: file } );
}
async function release( page ) { await page.evaluate( ()=>{ window.__shotZoom = 1; const c = pb2_mp.my_controller; c.camera_position_forced = false; } ); }
module.exports = { shoot, release };
