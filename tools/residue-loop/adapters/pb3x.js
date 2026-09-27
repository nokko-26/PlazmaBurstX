'use strict';
// Tools for driving the PB3X / CS Coastal Tower work through the loop. Loaded by a run's config.json ("tools").
// Probes (readOnly) observe: they play the game through tools/harness and report; they never edit source.
// Actions edit files inside the repo (the sandbox root) and bake the mods.
const fs = require( 'fs' ), path = require( 'path' ), cp = require( 'child_process' );
const { sha256 } = require( '../src/util' );
const { inside } = require( '../src/runtime' );

const HARNESS_ENV = { NODE_PATH: '/opt/node22/lib/node_modules' };
function spawn( argv, { cwd, timeoutMs = 600000, env = {} } )
{
	const t0 = Date.now();
	const r = cp.spawnSync( argv[ 0 ], argv.slice( 1 ), { cwd, timeout: timeoutMs, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 } );
	return { argv, exitCode: r.status, signal: r.signal, timedOut: !!( r.error && r.error.code === 'ETIMEDOUT' ), ms: Date.now() - t0, stdout: ( r.stdout || '' ).slice( -24000 ), stderr: ( r.stderr || '' ).slice( -12000 ) };
}
const readJson = ( f )=>{ try { return JSON.parse( fs.readFileSync( f, 'utf8' ) ); } catch ( e ) { return null; } };

const tools = {
	// run a harness script in the real game and read the report it writes. The mod source's hash is recorded, so the
	// evidence says exactly which build it observed.
	'pb3x.harness': { readOnly: true, doc: '{ script: "levels/x.js", args: [], report: "levels/results/x.json", timeoutMs }', run( p, { root } )
	{
		const hdir = path.join( root, 'tools', 'harness' );
		const reportFile = p.report ? inside( hdir, p.report ) : null;
		if ( reportFile && fs.existsSync( reportFile ) ) fs.renameSync( reportFile, reportFile + '.prev' );   // never read a stale report
		const out = spawn( [ 'xvfb-run', '-a', '-s', '-screen 0 1600x900x24', 'node', inside( hdir, p.script ), ...( p.args || [] ).map( String ) ], { cwd: hdir, timeoutMs: p.timeoutMs || 900000, env: HARNESS_ENV } );
		const mod = path.join( root, 'mods', 'cs-coastal-tower.user.js' ), bundle = path.join( root, 'pb3x-extension', 'pb3x.js' );
		return { ...out, report: reportFile ? readJson( reportFile ) : null, reportFile: p.report || null,
			build: { mod: fs.existsSync( mod ) ? sha256( fs.readFileSync( mod ) ) : null, bundle: fs.existsSync( bundle ) ? sha256( fs.readFileSync( bundle ) ) : null } };
	} },
	// static checks that need no game: node scripts that print JSON (e.g. the level linter)
	'pb3x.check': { readOnly: true, doc: '{ script: "tools/…/x.js", args: [] } → the JSON it prints', run( p, { root } )
	{
		const out = spawn( [ 'node', inside( root, p.script ), ...( p.args || [] ).map( String ) ], { cwd: root, timeoutMs: p.timeoutMs || 120000 } );
		let json = null; try { json = JSON.parse( out.stdout.trim().split( '\n' ).filter( ( l )=>l.startsWith( '{' ) ).pop() ); } catch ( e ) { /* not json */ }
		return { ...out, json };
	} },
	// deterministic image measurements, and their distance to a reference (a concept image, or a crop of one)
	'pb3x.image': { readOnly: true, doc: '{ image, reference?, crop?: [x0,y0,x1,y1] fractions of the reference }', run( p, { root } )
	{
		const out = spawn( [ 'python3', path.join( __dirname, 'imgmetrics.py' ), inside( root, p.image ), p.reference ? inside( root, p.reference ) : '-', ( p.crop || [ 0, 0, 1, 1 ] ).join( ',' ) ], { cwd: root, timeoutMs: 120000 } );
		let json = null; try { json = JSON.parse( out.stdout ); } catch ( e ) { /* none */ }
		return { exitCode: out.exitCode, stderr: out.stderr, metrics: json };
	} },
	'pb3x.bake': { readOnly: false, doc: '{} — bake mods/*.user.js into pb3x-extension/pb3x.js and verify', run( p, { root } )
	{
		const a = spawn( [ 'node', 'tools/bake-mods.js' ], { cwd: root } );
		const b = spawn( [ 'node', 'tools/bake-mods.js', '--check' ], { cwd: root } );
		const c = spawn( [ 'node', '--check', 'pb3x-extension/pb3x.js' ], { cwd: root } );
		return { bake: a, check: b, syntax: c, ok: a.exitCode === 0 && b.exitCode === 0 && c.exitCode === 0 };
	} },
	// an exact-text edit: every `find` must occur exactly once (or `all: true`)
	'file.patch': { readOnly: false, doc: '{ path, edits: [ { find, replace, all? } ] }', run( p, { root } )
	{
		const abs = inside( root, p.path );
		let s = fs.readFileSync( abs, 'utf8' );
		const before = sha256( s ), applied = [];
		for ( const e of p.edits )
		{
			const n = s.split( e.find ).length - 1;
			if ( n === 0 ) throw new Error( 'find text not present: ' + e.find.slice( 0, 80 ) );
			if ( n > 1 && !e.all ) throw new Error( 'find text occurs ' + n + ' times (not unique): ' + e.find.slice( 0, 80 ) );
			s = e.all ? s.split( e.find ).join( e.replace ) : s.replace( e.find, ()=>e.replace );
			applied.push( { occurrences: n } );
		}
		fs.writeFileSync( abs, s );
		return { path: p.path, before, after: sha256( s ), applied };
	} },
	// write a file from the run's staging folder (large content the engine's answer points to instead of inlining)
	'file.write_from': { readOnly: false, doc: '{ from: "<staged file under the run\'s engine/staging>", path }', run( p, { root } )
	{
		const staging = path.resolve( process.env.RL_STAGING || path.join( root, '.rl-staging' ) );
		const src = inside( staging, p.from );
		const buf = fs.readFileSync( src );
		const abs = inside( root, p.path );
		const prev = fs.existsSync( abs ) ? sha256( fs.readFileSync( abs ) ) : null;
		fs.mkdirSync( path.dirname( abs ), { recursive: true } );
		fs.writeFileSync( abs, buf );
		return { path: p.path, from: p.from, bytes: buf.length, sha256: sha256( buf ), previous: prev };
	} }
};
module.exports = { tools };
