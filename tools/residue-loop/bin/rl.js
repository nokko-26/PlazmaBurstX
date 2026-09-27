#!/usr/bin/env node
'use strict';
// The loop from the command line, with the file-exchange engine:
//   rl.js init   <run> --intent intent.json [--root dir] [--config config.json]
//   rl.js step   <run>              advance until the run ends or the engine has a question (prints where it is)
//   rl.js request <run>             print the pending engine request
//   rl.js answer <run> <file|->     give the engine's answer to the pending request (then run step again)
//   rl.js human  <run> "text" [--approve id,id]
//   rl.js status <run>
// config.json: { root, policy: { commands, probeCommands, actions: { maxRisk } }, budget, tools: [module paths] }
const fs = require( 'fs' ), path = require( 'path' );
const { RunController } = require( '../src/controller' );
const { FileExchangeEngine } = require( '../src/gep' );

const [ cmd, run, ...rest ] = process.argv.slice( 2 );
const flag = ( k )=>{ const i = rest.indexOf( '--' + k ); return i === -1 ? null : rest[ i + 1 ]; };
if ( !cmd || !run ) { console.log( fs.readFileSync( __filename, 'utf8' ).split( '\n' ).slice( 2, 11 ).join( '\n' ) ); process.exit( 1 ); }
const dir = path.resolve( run );

function open( extra = {} )
{
	const cfg = JSON.parse( fs.readFileSync( path.join( dir, 'config.json' ), 'utf8' ) );
	const extraTools = {};
	for ( const m of cfg.tools || [] ) Object.assign( extraTools, require( path.resolve( dir, m ) ).tools );
	return new RunController( dir, { engine: new FileExchangeEngine( path.join( dir, 'engine' ), cfg.engineLabel || 'file-exchange stand-in (not GEP Train)' ), root: path.resolve( dir, cfg.root || 'sandbox' ), policy: cfg.policy || {}, budget: cfg.budget, extraTools, evidenceChars: cfg.evidenceChars, ...cfg.controller, ...extra } );
}
function pendingFile()
{
	const req = path.join( dir, 'engine', 'requests' ), res = path.join( dir, 'engine', 'responses' );
	if ( !fs.existsSync( req ) ) return null;
	const open = fs.readdirSync( req ).filter( ( f )=>!fs.existsSync( path.join( res, f ) ) ).sort();
	return open.length ? path.join( req, open[ open.length - 1 ] ) : null;
}

( async ()=>
{
	if ( cmd === 'init' )
	{
		fs.mkdirSync( dir, { recursive: true } );
		const cfg = flag( 'config' ) ? JSON.parse( fs.readFileSync( flag( 'config' ), 'utf8' ) ) : { root: flag( 'root' ) || 'sandbox', policy: { commands: [ 'node' ], probeCommands: [ 'node' ] } };
		if ( flag( 'root' ) ) cfg.root = path.resolve( flag( 'root' ) );
		fs.writeFileSync( path.join( dir, 'config.json' ), JSON.stringify( cfg, null, 1 ) );
		fs.mkdirSync( path.resolve( dir, cfg.root ), { recursive: true } );
		const c = open( { intent: JSON.parse( fs.readFileSync( flag( 'intent' ), 'utf8' ) ) } );
		console.log( 'run created:', dir, 'intent', c.intent.hash.slice( 0, 12 ) );
		return;
	}
	if ( cmd === 'step' ) { const c = open(); const out = await c.step(); console.log( JSON.stringify( out, null, 1 ) ); return; }
	if ( cmd === 'request' ) { const f = pendingFile(); console.log( f ? fs.readFileSync( f, 'utf8' ) : 'no pending request' ); return; }
	if ( cmd === 'answer' )
	{
		const f = pendingFile(); if ( !f ) { console.log( 'no pending request' ); process.exit( 1 ); }
		const body = rest[ 0 ] === '-' || !rest[ 0 ] ? fs.readFileSync( 0, 'utf8' ) : fs.readFileSync( rest[ 0 ], 'utf8' );
		JSON.parse( body );   // must at least be JSON; the adapter checks the schema
		fs.writeFileSync( path.join( dir, 'engine', 'responses', path.basename( f ) ), body );
		console.log( 'answered', path.basename( f ) );
		return;
	}
	if ( cmd === 'human' ) { const c = open(); const e = c.human( { text: rest[ 0 ], approve: ( flag( 'approve' ) || '' ).split( ',' ).filter( Boolean ) } ); console.log( 'recorded', e.id ); return; }
	if ( cmd === 'status' ) { const c = open(); console.log( JSON.stringify( c.status(), null, 1 ) ); return; }
	console.log( 'unknown command ' + cmd ); process.exit( 1 );
} )().catch( ( e )=>{ console.error( e.stack || e ); process.exit( 2 ); } );
