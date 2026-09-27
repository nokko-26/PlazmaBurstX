// Log the harness profile in with a Plazma Burst 3 authentication file (the site's own "I have Plazma Burst 3
// account" → drop the .auth file). The profile keeps the login for later runs.
//     node login.js /path/to/Plazma_Burst_3.auth
// Never commit an .auth file or print what it holds: it is the account's password.
const { launch } = require( './launch' );
async function loggedIn( page )
{
	return page.evaluate( ()=>localStorage.getItem( 'pb3_my_user_uid' ) !== null && localStorage.getItem( 'pb3_password' ) !== null );
}
async function login( page, authFile )
{
	if ( await loggedIn( page ) ) return true;
	await page.getByText( 'I have Plazma Burst 3 account' ).click( { timeout: 60000 } );
	const input = page.locator( '#auth_file_input' );
	await input.waitFor( { state: 'attached', timeout: 60000 } );
	await input.setInputFiles( authFile );
	for ( let i = 0; i < 60 && !await loggedIn( page ); i++ ) await page.waitForTimeout( 1000 );
	return loggedIn( page );
}
module.exports = { login, loggedIn };
if ( require.main === module ) ( async ()=>
{
	const { ctx, page } = await launch();
	await page.waitForTimeout( 8000 );
	const ok = await login( page, process.argv[ 2 ] );
	await page.waitForTimeout( 8000 );
	console.log( 'logged in:', ok, '| page:', await page.evaluate( ()=>location.hash ) );
	if ( process.argv[ 3 ] ) await page.screenshot( { path: process.argv[ 3 ] } );
	await ctx.close();
} )();
