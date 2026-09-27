'use strict';
// The run's durable records, all append-only:
//   EventLog             — everything that happened (intent, engine calls, claims, proposals accepted/rejected, actions,
//                          outcomes, residue changes), hash-chained so a replay can tell it wasn't edited.
//   EvidenceStore        — raw observations of reality. Only the ToolRuntime (actions and probes run against the
//                          outside world) and the human channel hold the capability to write here: the engine never does.
//   DerivedKnowledgeStore— what the engine said: inferences, hypotheses, plans, residue proposals. Never evidence.
const fs = require( 'fs' ), path = require( 'path' );
const { canonical, sha256, newId, deepFreeze, clone, assertSchema } = require( './util' );

function appendLine( file, obj ) { fs.appendFileSync( file, canonical( obj ) + '\n' ); }
function readLines( file ) { if ( !fs.existsSync( file ) ) return []; return fs.readFileSync( file, 'utf8' ).split( '\n' ).filter( Boolean ).map( ( l )=>JSON.parse( l ) ); }

// ---------------- EventLog ----------------
class EventLog
{
	constructor( dir )
	{
		this.file = path.join( dir, 'events.jsonl' );
		this.events = readLines( this.file );
		const bad = EventLog.verifyChain( this.events );
		if ( bad !== -1 ) throw new Error( 'event log chain broken at #' + bad + ' (edited?)' );
	}
	append( type, data )
	{
		const prev = this.events.length ? this.events[ this.events.length - 1 ].hash : 'genesis';
		const e = { seq: this.events.length, type, at: new Date().toISOString(), data: clone( data ), prev };
		e.hash = sha256( canonical( { seq: e.seq, type, at: e.at, data: e.data, prev } ) );
		appendLine( this.file, e );
		this.events.push( deepFreeze( e ) );
		return e;
	}
	ofType( type ) { return this.events.filter( ( e )=>e.type === type ); }
	static verifyChain( events )
	{
		let prev = 'genesis';
		for ( let i = 0; i < events.length; i++ )
		{
			const e = events[ i ];
			if ( e.prev !== prev || e.hash !== sha256( canonical( { seq: e.seq, type: e.type, at: e.at, data: e.data, prev: e.prev } ) ) ) return i;
			prev = e.hash;
		}
		return -1;
	}
}

// ---------------- EvidenceStore ----------------
// Admissible origins: something outside the engine produced it. 'engine' (and anything else) is refused outright.
const ORIGINS = [ 'tool', 'probe', 'process', 'file', 'harness', 'human', 'environment' ];
const EVIDENCE_IN = {
	type: 'object', required: [ 'origin', 'producedBy', 'kind', 'payload' ], props: {
		origin: { type: 'string', enum: ORIGINS },
		producedBy: { type: 'string', min: 1 },            // the action / probe id that produced it
		kind: { type: 'string', min: 1 },                  // e.g. 'process.result', 'file.snapshot', 'harness.report', 'image'
		tags: { type: 'array', items: { type: 'string' } },
		payload: { any: true },
		meta: { type: 'object', props: {} }
	}
};
class EvidenceStore
{
	constructor( dir, log )
	{
		this.dir = dir; this.log = log;
		this.file = path.join( dir, 'evidence.jsonl' );
		this.blobs = path.join( dir, 'blobs' );
		fs.mkdirSync( this.blobs, { recursive: true } );
		this.items = new Map();
		for ( const e of readLines( this.file ) ) this.items.set( e.id, deepFreeze( e ) );
		// the write capability: handed only to the ToolRuntime and the human channel by the RunController
		const secret = Symbol( 'evidence-writer' );
		this._secret = secret;
		this.writer = Object.freeze( { add: ( e )=>this._add( secret, e ), store: this } );
	}
	_add( secret, input )
	{
		if ( secret !== this._secret ) throw new Error( 'evidence can only be written through the evidence writer capability' );
		assertSchema( EVIDENCE_IN, input, 'evidence' );
		// payloads bigger than 16 KB (or binary) go to a content-addressed blob; the record keeps its hash
		let payload = input.payload, blob = null;
		const raw = Buffer.isBuffer( payload ) ? payload : Buffer.from( canonical( payload ) );
		const hash = sha256( raw );
		if ( Buffer.isBuffer( payload ) || raw.length > 16384 )
		{
			blob = path.join( 'blobs', hash );
			const abs = path.join( this.dir, blob );
			if ( !fs.existsSync( abs ) ) fs.writeFileSync( abs, raw );
			payload = Buffer.isBuffer( payload ) ? { blob, bytes: raw.length } : { blob, bytes: raw.length, json: true };
		}
		const e = { id: newId( 'ev' ), origin: input.origin, producedBy: input.producedBy, kind: input.kind, tags: input.tags || [], at: new Date().toISOString(), hash, payload, meta: input.meta || {} };
		appendLine( this.file, e );
		deepFreeze( e );
		this.items.set( e.id, e );
		this.log.append( 'evidence', { id: e.id, origin: e.origin, producedBy: e.producedBy, kind: e.kind, tags: e.tags, hash } );
		return e;
	}
	get( id ) { return this.items.get( id ) || null; }
	has( id ) { return this.items.has( id ); }
	all() { return [ ...this.items.values() ]; }
	since( seqIds ) { return this.all().filter( ( e )=>!seqIds.has( e.id ) ); }
	// the full payload, from its blob if it was stored out of line; the hash is re-checked on the way out
	payloadOf( e )
	{
		if ( !e.payload || !e.payload.blob ) return e.payload;
		const raw = fs.readFileSync( path.join( this.dir, e.payload.blob ) );
		if ( sha256( raw ) !== e.hash ) throw new Error( 'evidence ' + e.id + ': blob hash mismatch' );
		return e.payload.json ? JSON.parse( raw.toString( 'utf8' ) ) : raw;
	}
	admissible( id ) { const e = this.get( id ); return !!e && ORIGINS.includes( e.origin ); }
	byProducer( producedBy ) { return this.all().filter( ( e )=>e.producedBy === producedBy ); }
	latestByTag( tag ) { const l = this.all().filter( ( e )=>e.tags.includes( tag ) ); return l[ l.length - 1 ] || null; }
}

// ---------------- DerivedKnowledgeStore ----------------
const CLAIM_KINDS = [ 'INFERENCE', 'HYPOTHESIS', 'PLAN', 'REQUIREMENT', 'JUDGEMENT' ];
class DerivedKnowledgeStore
{
	constructor( dir, log )
	{
		this.file = path.join( dir, 'derived.jsonl' ); this.log = log;
		this.items = new Map();
		for ( const c of readLines( this.file ) ) this.items.set( c.id, deepFreeze( c ) );
	}
	add( { kind, text, cites = [], residueIds = [], engineCall, data } )
	{
		if ( !CLAIM_KINDS.includes( kind ) ) throw new Error( 'derived claim kind ' + kind + ' is not one of ' + CLAIM_KINDS.join( '|' ) + ' (FACT/OBSERVATION only come from the evidence store)' );
		const c = { id: newId( 'dk' ), kind, source: 'engine', engineCall: engineCall || null, text: String( text ), cites: [ ...cites ], residueIds: [ ...residueIds ], data: clone( data ), at: new Date().toISOString() };
		appendLine( this.file, c );
		deepFreeze( c );
		this.items.set( c.id, c );
		this.log.append( 'derived', { id: c.id, kind, cites, residueIds, engineCall } );
		return c;
	}
	get( id ) { return this.items.get( id ) || null; }
	all() { return [ ...this.items.values() ]; }
}

module.exports = { EventLog, EvidenceStore, DerivedKnowledgeStore, ORIGINS, CLAIM_KINDS, readLines, appendLine };
