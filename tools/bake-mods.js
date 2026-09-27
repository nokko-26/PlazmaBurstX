#!/usr/bin/env node
// Bakes the mods in mods/*.user.js into pb3x-extension/pb3x.js as built-in mods (the bundle's BUILTIN_MODS list),
// the way the launcher's tools/build-extension.js bakes mods-builtin/. Re-running it replaces what it baked before.
//
//   node tools/bake-mods.js [--check] [--out <file>]
//
// Each mod's metadata comes from its header (// @name, // @description, // @version, // @author), like a user mod's.
// --check bakes into a scratch copy and only verifies the result parses.
'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const vm = require( 'vm' );

const ROOT = path.resolve( __dirname, '..' );
const BUNDLE = path.join( ROOT, 'pb3x-extension', 'pb3x.js' );
const MODS = path.join( ROOT, 'mods' );
const BEGIN = '// ---- baked mods (mods/, tools/bake-mods.js) ----', END = '// ---- end of baked mods ----';

const args = process.argv.slice( 2 );
const check = args.includes( '--check' );
const outArg = args.indexOf( '--out' ) >= 0 ? args[ args.indexOf( '--out' ) + 1 ] : null;

function meta( file, code )
{
	const m = { id: 'builtin/' + file, file, builtin: true, name: file.replace( /(\.user)?\.js$/i, '' ), description: '', version: '', author: '' };
	for ( const line of code.split( '\n' ).slice( 0, 40 ) )
	{
		const r = /^\s*\/\/\s*@(name|description|version|author)\s+(.+?)\s*$/.exec( line );
		if ( r ) m[ r[ 1 ] ] = r[ 2 ];
	}
	return m;
}

function bake( bundle, mods )
{
	// what an earlier run baked goes first
	const a = bundle.indexOf( BEGIN );
	if ( a >= 0 )
	{
		const b = bundle.indexOf( END, a );
		if ( b < 0 ) throw new Error( 'found the start of the baked mods but not their end' );
		bundle = bundle.slice( 0, a - 2 ) + bundle.slice( b + END.length );             // (from the comma before it)
	}
	const start = bundle.indexOf( 'const BUILTIN_MODS = [' );
	if ( start < 0 ) throw new Error( 'BUILTIN_MODS not found in the bundle' );
	const close = bundle.indexOf( '\n];\n', start );
	if ( close < 0 ) throw new Error( 'the end of BUILTIN_MODS not found' );
	if ( !mods.length ) return bundle;
	// the list's last entry ends "} }" (no comma): each baked one follows it
	const entries = mods.map( ( m )=>'\t{ meta: ' + JSON.stringify( m.meta ) + ', run: function() {\n//\n' + m.code.replace( /\s+$/, '' ) + '\n} }' ).join( ',\n' );
	return bundle.slice( 0, close ) + ',\n' + BEGIN + '\n' + entries + '\n' + END + '\n' + bundle.slice( close + 1 );
}

const files = fs.existsSync( MODS ) ? fs.readdirSync( MODS ).filter( ( f )=>/\.user\.js$/.test( f ) ).sort() : [];
const mods = files.map( ( f )=>{ const code = fs.readFileSync( path.join( MODS, f ), 'utf8' ); return { meta: meta( f, code ), code }; } );
for ( const m of mods ) new vm.Script( '(function(){\n' + m.code + '\n})', { filename: m.meta.file } );   // (a mod that doesn't parse stops here)

const out = bake( fs.readFileSync( BUNDLE, 'utf8' ), mods );
new vm.Script( out, { filename: 'pb3x.js' } );
const dest = check ? null : ( outArg ? path.resolve( outArg ) : BUNDLE );
if ( dest ) fs.writeFileSync( dest, out );
console.log( ( check ? 'checked ' : 'baked ' ) + mods.length + ' mod(s): ' + ( mods.map( ( m )=>m.meta.name ).join( ', ' ) || '(none)' ) + ( dest ? ' -> ' + path.relative( ROOT, dest ) : '' ) );
