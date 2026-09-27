'use strict';
// Shared helpers: canonical JSON (stable key order, so hashes don't depend on insertion order), hashing, ids, deep
// freezing, and a small schema checker used at every boundary.
const crypto = require( 'crypto' );

function canonical( v )
{
	if ( v === null || typeof v !== 'object' ) return JSON.stringify( v === undefined ? null : v );
	if ( Array.isArray( v ) ) return '[' + v.map( canonical ).join( ',' ) + ']';
	return '{' + Object.keys( v ).sort().filter( ( k )=>v[ k ] !== undefined ).map( ( k )=>JSON.stringify( k ) + ':' + canonical( v[ k ] ) ).join( ',' ) + '}';
}
const sha256 = ( s )=>crypto.createHash( 'sha256' ).update( typeof s === 'string' || Buffer.isBuffer( s ) ? s : canonical( s ) ).digest( 'hex' );
const shortHash = ( v )=>sha256( v ).slice( 0, 16 );
const newId = ( prefix )=>prefix + '_' + Date.now().toString( 36 ) + '_' + crypto.randomBytes( 5 ).toString( 'hex' );

function deepFreeze( o )
{
	if ( o && typeof o === 'object' && !Object.isFrozen( o ) )
	{
		Object.freeze( o );
		for ( const k of Object.keys( o ) ) deepFreeze( o[ k ] );
	}
	return o;
}
const clone = ( v )=>v === undefined ? undefined : JSON.parse( JSON.stringify( v ) );

// ---- schemas ----
// A schema is { type, required?, props?, items?, enum?, min?, max?, nullable?, any? }. check() returns a list of
// problems (empty when valid): malformed engine output is rejected with these, never coerced.
function check( schema, v, at = '$' )
{
	const out = [];
	if ( schema.any ) return out;
	if ( v === null || v === undefined )
	{
		if ( !schema.nullable ) out.push( at + ': missing' );
		return out;
	}
	const t = Array.isArray( v ) ? 'array' : typeof v;
	if ( schema.type && schema.type !== t && !( schema.type === 'integer' && Number.isInteger( v ) ) ) { out.push( at + ': expected ' + schema.type + ', got ' + t ); return out; }
	if ( schema.enum && !schema.enum.includes( v ) ) out.push( at + ': ' + JSON.stringify( v ) + ' not in ' + schema.enum.join( '|' ) );
	if ( t === 'string' )
	{
		if ( schema.min !== undefined && v.length < schema.min ) out.push( at + ': shorter than ' + schema.min );
		if ( schema.max !== undefined && v.length > schema.max ) out.push( at + ': longer than ' + schema.max );
	}
	if ( t === 'number' )
	{
		if ( schema.min !== undefined && v < schema.min ) out.push( at + ': below ' + schema.min );
		if ( schema.max !== undefined && v > schema.max ) out.push( at + ': above ' + schema.max );
	}
	if ( t === 'array' )
	{
		if ( schema.min !== undefined && v.length < schema.min ) out.push( at + ': fewer than ' + schema.min + ' items' );
		if ( schema.items ) v.forEach( ( x, i )=>out.push( ...check( schema.items, x, at + '[' + i + ']' ) ) );
	}
	if ( t === 'object' && schema.props )
	{
		for ( const k of schema.required || [] ) if ( v[ k ] === undefined ) out.push( at + '.' + k + ': missing' );
		for ( const k of Object.keys( schema.props ) ) if ( v[ k ] !== undefined ) out.push( ...check( schema.props[ k ], v[ k ], at + '.' + k ) );
		if ( schema.closed ) for ( const k of Object.keys( v ) ) if ( !schema.props[ k ] ) out.push( at + '.' + k + ': not allowed' );
	}
	return out;
}
class SchemaError extends Error { constructor( where, problems ) { super( where + ': ' + problems.slice( 0, 8 ).join( '; ' ) ); this.problems = problems; } }
function assertSchema( schema, v, where ) { const p = check( schema, v ); if ( p.length ) throw new SchemaError( where, p ); return v; }

// read a dotted path ("a.b[2].c") out of a value
function getPath( v, path )
{
	if ( !path ) return v;
	for ( const part of String( path ).replace( /\[(\d+)\]/g, '.$1' ).split( '.' ).filter( Boolean ) )
	{
		if ( v === null || v === undefined ) return undefined;
		v = v[ part ];
	}
	return v;
}

module.exports = { canonical, sha256, shortHash, newId, deepFreeze, clone, check, assertSchema, SchemaError, getPath };
