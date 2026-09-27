'use strict';
// GEPTrainAdapter: the one door to the reasoning engine. GEP_Train(context, task) -> result is a black box: the
// controller only knows the task modes below and the schema each mode's answer must meet. An answer that fails its
// schema is rejected (and logged), never read as prose into state.
//
// Engines behind the adapter:
//   MockEngine          — a scripted function, for tests and the demo.
//   FileExchangeEngine  — writes each request to <run>/engine/requests/<callId>.json and returns PENDING until an
//                         answer appears in <run>/engine/responses/<callId>.json. Whatever writes those answers is the
//                         engine; until GEP Train's own interface exists, the run records that a stand-in answered.
//   (GEP Train)         — when its interface is known, it becomes one more class with the same request() method.
const fs = require( 'fs' ), path = require( 'path' );
const { canonical, sha256, clone, check } = require( './util' );
const { RESIDUE_IN, STATUS } = require( './model' );

const MODES = [ 'SUCCESS_COMPILE', 'ADVERSARIAL_COMPLETE', 'OBSERVE_INTERPRET', 'ACTION_SYNTHESIZE', 'FAILURE_ANALYZE', 'FINAL_VERIFY' ];

const ACTION_REQUEST = {
	type: 'object', required: [ 'targets', 'rationale', 'tool', 'params', 'predictedEffect', 'expectedEvidence', 'failureSignatures', 'risk' ], props: {
		id: { type: 'string' },
		targets: { type: 'array', min: 1, items: { type: 'string' } },
		rationale: { type: 'string', min: 3 },
		prerequisites: { type: 'array', items: { type: 'string' } },
		tool: { type: 'string', min: 1 },
		params: { type: 'object', props: {} },
		predictedEffect: { type: 'string', min: 3 },
		expectedEvidence: { type: 'array', items: { type: 'string' } },
		failureSignatures: { type: 'array', items: { type: 'string' } },
		risk: { type: 'string', enum: [ 'low', 'medium', 'high' ] },
		cost: { type: 'number', min: 0 },
		rollback: { type: 'object', nullable: true, props: {} }
	}
};
const CLAIM = { type: 'object', required: [ 'kind', 'text', 'cites' ], props: { kind: { type: 'string', enum: [ 'INFERENCE', 'HYPOTHESIS', 'PLAN', 'JUDGEMENT' ] }, text: { type: 'string', min: 1 }, cites: { type: 'array', items: { type: 'string' } }, residueIds: { type: 'array', items: { type: 'string' } } } };
const TRANSITION = { type: 'object', required: [ 'residueId', 'to', 'evidenceIds', 'reason' ], props: { residueId: { type: 'string' }, to: { type: 'string', enum: STATUS }, evidenceIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', min: 1 } } };
const JUDGEMENT = { type: 'object', required: [ 'residueId', 'verdict', 'evidenceIds', 'reason' ], props: { residueId: { type: 'string' }, verdict: { type: 'string', enum: [ 'PASS', 'FAIL', 'UNSURE' ] }, evidenceIds: { type: 'array', min: 1, items: { type: 'string' } }, reason: { type: 'string', min: 1 } } };
const FINDING = { type: 'object', required: [ 'description', 'material' ], props: { kind: { type: 'string' }, residueId: { type: 'string' }, description: { type: 'string', min: 3 }, material: { type: 'boolean' }, residue: { type: 'object', props: {} } } };

const OUTPUT = {
	SUCCESS_COMPILE: { type: 'object', required: [ 'residues' ], props: { residues: { type: 'array', min: 1, items: RESIDUE_IN }, notes: { type: 'string' } } },
	ADVERSARIAL_COMPLETE: { type: 'object', required: [ 'findings' ], props: { findings: { type: 'array', items: FINDING } } },
	OBSERVE_INTERPRET: { type: 'object', required: [ 'summary', 'claims', 'transitions' ], props: { summary: { type: 'string' }, claims: { type: 'array', items: CLAIM }, transitions: { type: 'array', items: TRANSITION }, judgements: { type: 'array', items: JUDGEMENT }, unknowns: { type: 'array', items: { type: 'string' } } } },
	ACTION_SYNTHESIZE: { type: 'object', required: [ 'actions' ], props: { actions: { type: 'array', items: ACTION_REQUEST }, needHuman: { type: 'string' } } },
	FAILURE_ANALYZE: { type: 'object', required: [ 'diagnosis', 'strategy' ], props: { diagnosis: { type: 'string', min: 3 }, strategy: { type: 'string', enum: [ 'CHANGED_HYPOTHESIS', 'DISCRIMINATING_EXPERIMENT', 'DECOMPOSE', 'ALTERNATIVE', 'NEED_HUMAN', 'IMPOSSIBLE' ] }, actions: { type: 'array', items: ACTION_REQUEST }, subIntents: { type: 'array', items: { type: 'object', required: [ 'residueId', 'intent' ], props: { residueId: { type: 'string' }, intent: { type: 'object', props: {} } } } }, question: { type: 'string' } } },
	FINAL_VERIFY: { type: 'object', required: [ 'findings' ], props: { findings: { type: 'array', items: FINDING } } }
};

const PROMPTS = {
	SUCCESS_COMPILE: 'Derive the observable consequences that would exist if this intent were genuinely fulfilled (residues: properties of successful reality, not actions). Each needs an id, description, required flag, dependencies, priority and a verification contract (prefer deterministic checks over probes; semantic only where meaning must be judged).',
	ADVERSARIAL_COMPLETE: 'Assume every listed residue is satisfied; identify every material way the original intent could still have failed. For each material omission, supply the residue that closes it.',
	OBSERVE_INTERPRET: 'Identify what actually happened in the new evidence, connect observations to residues, detect contradictions/regressions, list remaining unknowns, diagnose causes, and propose evidence-backed state changes (every transition and claim must cite evidence ids). For semantic contracts, give a judgement citing the probe evidence.',
	ACTION_SYNTHESIZE: 'Given the remaining residue delta, propose the highest-leverage next transformation(s) as structured ActionRequests.',
	FAILURE_ANALYZE: 'Progress has stalled or evidence contradicts expectations. Do not repeat the failed approach: give a changed hypothesis, a discriminating experiment, a decomposition, an alternative strategy, or a question for the human.',
	FINAL_VERIFY: 'Assuming this system claims success, find any material way the original intent remains unfulfilled, any evidence that does not actually prove its residue, any specification gaming, hidden regression, untested boundary, or unresolved uncertainty.'
};

class EngineInvalid extends Error { constructor( mode, problems ) { super( 'engine answer for ' + mode + ' rejected: ' + problems.slice( 0, 6 ).join( '; ' ) ); this.problems = problems; } }

// ---- engines ----
class MockEngine
{
	constructor( handler, label = 'mock' ) { this.handler = handler; this.label = label; }
	async request( call ) { return { status: 'ok', result: await this.handler( call.mode, clone( call.context ), call ) }; }
}
class FileExchangeEngine
{
	constructor( dir, label = 'file-exchange stand-in (not GEP Train)' )
	{
		this.label = label;
		this.req = path.join( dir, 'requests' ); this.res = path.join( dir, 'responses' );
		fs.mkdirSync( this.req, { recursive: true } ); fs.mkdirSync( this.res, { recursive: true } );
	}
	async request( call )
	{
		const rf = path.join( this.req, call.callId + '.json' ), af = path.join( this.res, call.callId + '.json' );
		if ( !fs.existsSync( rf ) ) fs.writeFileSync( rf, JSON.stringify( { callId: call.callId, mode: call.mode, task: PROMPTS[ call.mode ], outputSchema: OUTPUT[ call.mode ], context: call.context }, null, 1 ) );
		if ( !fs.existsSync( af ) ) return { status: 'pending', callId: call.callId, requestFile: rf, responseFile: af };
		let result;
		try { result = JSON.parse( fs.readFileSync( af, 'utf8' ) ); }
		catch ( e ) { return { status: 'ok', result: { __unparseable: String( e.message ) } }; }
		return { status: 'ok', result };
	}
}

// ---- the adapter ----
class GEPTrainAdapter
{
	constructor( engine, log ) { this.engine = engine; this.log = log; }
	get label() { return this.engine.label; }
	// callId is deterministic in (run, seq, mode, context), so a resumed run asks the same question again
	async call( mode, context, seq )
	{
		if ( !MODES.includes( mode ) ) throw new Error( 'unknown task mode ' + mode );
		const callId = String( seq ).padStart( 4, '0' ) + '-' + mode + '-' + sha256( canonical( context ) ).slice( 0, 10 );
		const call = { callId, mode, task: PROMPTS[ mode ], context };
		const r = await this.engine.request( call );
		if ( r.status === 'pending' ) { this.log.append( 'engine.pending', { callId, mode, engine: this.label } ); return r; }
		const problems = r.result && r.result.__unparseable ? [ 'unparseable: ' + r.result.__unparseable ] : check( OUTPUT[ mode ], r.result, mode );
		if ( problems.length )
		{
			this.log.append( 'engine.rejected', { callId, mode, engine: this.label, problems: problems.slice( 0, 20 ) } );
			return { status: 'invalid', callId, problems };
		}
		this.log.append( 'engine.call', { callId, mode, engine: this.label, contextHash: sha256( canonical( context ) ), resultHash: sha256( canonical( r.result ) ) } );
		return { status: 'ok', callId, result: r.result };
	}
}

module.exports = { GEPTrainAdapter, MockEngine, FileExchangeEngine, EngineInvalid, MODES, OUTPUT, PROMPTS, ACTION_REQUEST };
