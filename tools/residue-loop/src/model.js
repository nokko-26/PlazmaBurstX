'use strict';
// The desired state: the immutable IntentSpec, and the ResidueGraph compiled from it. A residue is a property of
// successful reality ("unauthenticated requests cannot reach protected resources"), never an action ("add auth").
const fs = require( 'fs' ), path = require( 'path' );
const { canonical, sha256, deepFreeze, clone, assertSchema, check } = require( './util' );

// ---------------- IntentSpec ----------------
const strList = { type: 'array', items: { type: 'string', min: 1 } };
const INTENT = {
	type: 'object', required: [ 'objective' ], props: {
		objective: { type: 'string', min: 3 },
		desiredBehaviors: strList, emergentProperties: strList, hardConstraints: strList, preferences: strList,
		prohibitedOutcomes: strList, qualityThresholds: strList, resources: strList, ambiguities: strList, references: strList
	}
};
class IntentSpec
{
	constructor( spec )
	{
		assertSchema( INTENT, spec, 'intent' );
		const s = { desiredBehaviors: [], emergentProperties: [], hardConstraints: [], preferences: [], prohibitedOutcomes: [], qualityThresholds: [], resources: [], ambiguities: [], references: [], ...clone( spec ) };
		this.spec = deepFreeze( s );
		this.hash = sha256( canonical( s ) );
		Object.freeze( this );
	}
	static load( file ) { return new IntentSpec( JSON.parse( fs.readFileSync( file, 'utf8' ) ) ); }
}

// ---------------- verification contracts ----------------
// Deterministic unless kind is 'semantic'. A 'check' names a probe (a read-only tool call the controller runs against
// reality every OBSERVE) and assertions over that probe's evidence payload.
const OPS = [ 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'matches', 'exists', 'len_gte', 'len_lte', 'truthy', 'falsy' ];
const PROBE = { type: 'object', required: [ 'tool', 'params' ], props: { tool: { type: 'string', min: 1 }, params: { type: 'object', props: {} } } };
const CONTRACT = {
	type: 'object', required: [ 'kind' ], props: {
		kind: { type: 'string', enum: [ 'check', 'all', 'semantic', 'child', 'human' ] },
		probe: PROBE,
		asserts: { type: 'array', items: { type: 'object', required: [ 'op' ], props: { path: { type: 'string' }, op: { type: 'string', enum: OPS }, value: { any: true }, flags: { type: 'string', max: 6 } } } },
		contracts: { type: 'array', items: { any: true } },
		question: { type: 'string' },
		passLabel: { type: 'string' },
		childIntent: { type: 'string' }
	}
};
function validateContract( c, at = 'contract' )
{
	const p = check( CONTRACT, c, at );
	if ( !p.length )
	{
		if ( c.kind === 'check' && ( !c.probe || !c.asserts || !c.asserts.length ) ) p.push( at + ': a check needs a probe and at least one assert' );
		for ( const [ i, a ] of ( c.asserts || [] ).entries() )
		{
			if ( a.op === 'matches' ) { try { new RegExp( a.value, a.flags || '' ); } catch ( e ) { p.push( at + '.asserts[' + i + ']: bad pattern: ' + e.message ); } }
			if ( [ 'gt', 'gte', 'lt', 'lte', 'len_gte', 'len_lte' ].includes( a.op ) && typeof a.value !== 'number' ) p.push( at + '.asserts[' + i + ']: ' + a.op + ' needs a number' );
		}
		if ( c.kind === 'semantic' && ( !c.probe || !c.question ) ) p.push( at + ': a semantic contract needs a probe and a question' );
		if ( c.kind === 'all' ) ( c.contracts || [] ).forEach( ( x, i )=>p.push( ...validateContract( x, at + '.contracts[' + i + ']' ) ) );
	}
	return p;
}
function assertOne( a, payload, getPath )
{
	const v = getPath( payload, a.path );
	switch ( a.op )
	{
		case 'eq': return canonical( v ) === canonical( a.value );
		case 'ne': return canonical( v ) !== canonical( a.value );
		case 'gt': return typeof v === 'number' && v > a.value;
		case 'gte': return typeof v === 'number' && v >= a.value;
		case 'lt': return typeof v === 'number' && v < a.value;
		case 'lte': return typeof v === 'number' && v <= a.value;
		case 'contains': return ( typeof v === 'string' || Array.isArray( v ) ) && v.includes( a.value );
		case 'not_contains': return ( typeof v === 'string' || Array.isArray( v ) ) && !v.includes( a.value );
		case 'matches': return typeof v === 'string' && new RegExp( a.value, a.flags || '' ).test( v );
		case 'exists': return v !== undefined && v !== null;
		case 'len_gte': return v != null && v.length >= a.value;
		case 'len_lte': return v != null && v.length <= a.value;
		case 'truthy': return !!v;
		case 'falsy': return !v;
	}
	return false;
}
// the probes a contract needs (flattened), each with a stable key so its evidence can be found again
const probeKey = ( p )=>'probe:' + sha256( canonical( p ) ).slice( 0, 16 );
function probesOf( c ) { if ( !c ) return []; if ( c.kind === 'all' ) return c.contracts.flatMap( probesOf ); return c.probe ? [ c.probe ] : []; }

// ---------------- residues ----------------
const STATUS = [ 'UNTESTED', 'UNKNOWN', 'SUPPORTED', 'CONTRADICTED', 'SATISFIED', 'INVALIDATED' ];
const RESIDUE_IN = {
	type: 'object', required: [ 'id', 'description', 'required', 'contract' ], props: {
		id: { type: 'string', min: 1, max: 80 },
		description: { type: 'string', min: 8 },
		required: { type: 'boolean' },
		dependsOn: { type: 'array', items: { type: 'string' } },
		priority: { type: 'number', min: 0, max: 100 },
		contract: { type: 'object', props: {} },
		rationale: { type: 'string' },
		parent: { type: 'string', nullable: true }
	}
};
// words that mark a step, not a state of the world: a residue must describe what's true when it's done
const ACTION_WORDS = /^\s*(implement|add|create|build|write|make|fix|refactor|install|run|use|set up|setup|update|change|remove|delete)\b/i;

class ResidueGraph
{
	constructor( file )
	{
		this.file = file;
		this.residues = new Map();
		if ( file && fs.existsSync( file ) ) for ( const r of JSON.parse( fs.readFileSync( file, 'utf8' ) ) ) this.residues.set( r.id, r );
	}
	static validateInput( r )
	{
		const p = check( RESIDUE_IN, r, 'residue ' + ( r && r.id ) );
		if ( !p.length )
		{
			p.push( ...validateContract( r.contract, 'residue ' + r.id + '.contract' ) );
			if ( ACTION_WORDS.test( r.description ) ) p.push( 'residue ' + r.id + ': "' + r.description.slice( 0, 60 ) + '" reads as an action, not a property of the finished world' );
		}
		return p;
	}
	// residues are only ever added (criteria can tighten, never silently loosen); each keeps a hash of its criteria
	add( input, origin, log )
	{
		const p = ResidueGraph.validateInput( input );
		if ( p.length ) throw new Error( p.join( '; ' ) );
		if ( this.residues.has( input.id ) ) throw new Error( 'residue ' + input.id + ' already exists' );
		for ( const d of input.dependsOn || [] ) if ( !this.residues.has( d ) ) throw new Error( 'residue ' + input.id + ' depends on unknown ' + d );
		const criteria = { description: input.description, required: input.required, contract: input.contract };
		const r = { id: input.id, description: input.description, required: input.required, dependsOn: input.dependsOn || [], priority: input.priority ?? 50,
			contract: clone( input.contract ), rationale: input.rationale || '', parent: input.parent || null, origin,
			criteriaHash: sha256( canonical( criteria ) ), status: 'UNTESTED', evidence: [], history: [ { at: new Date().toISOString(), to: 'UNTESTED', why: 'compiled (' + origin + ')' } ] };
		this.residues.set( r.id, r );
		if ( log ) log.append( 'residue.added', { id: r.id, origin, required: r.required, criteriaHash: r.criteriaHash } );
		return r;
	}
	// status changes only: the controller's reducer is the only caller
	setStatus( id, to, evidence, why, log )
	{
		const r = this.residues.get( id );
		if ( !STATUS.includes( to ) ) throw new Error( 'bad status ' + to );
		const from = r.status;
		r.status = to; r.evidence = [ ...evidence ];
		r.history.push( { at: new Date().toISOString(), from, to, evidence: [ ...evidence ], why } );
		if ( log ) log.append( 'residue.status', { id, from, to, evidence, why } );
	}
	// criteria can't move: every residue's description/required/contract still hashes to what it was compiled with
	criteriaIntact()
	{
		const bad = [];
		for ( const r of this.residues.values() ) if ( sha256( canonical( { description: r.description, required: r.required, contract: r.contract } ) ) !== r.criteriaHash ) bad.push( r.id );
		return bad;
	}
	get( id ) { return this.residues.get( id ) || null; }
	all() { return [ ...this.residues.values() ]; }
	required() { return this.all().filter( ( r )=>r.required && r.status !== 'INVALIDATED' ); }
	save() { if ( this.file ) { const tmp = this.file + '.tmp'; fs.writeFileSync( tmp, JSON.stringify( this.all(), null, 1 ) ); fs.renameSync( tmp, this.file ); } }
}

module.exports = { IntentSpec, ResidueGraph, validateContract, assertOne, probesOf, probeKey, STATUS, OPS, CONTRACT, RESIDUE_IN };
