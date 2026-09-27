'use strict';
// The vertical slice on a small objective, with a scripted mock engine:
//   intent: "a sandbox holds greet.txt saying hello, and sum.js printing the sum of its numeric arguments"
// The mock engine's first attempt at sum.js is wrong for no arguments; the loop sees the check fail, and fixes it.
// node demo/demo.js [runDir]
const fs = require( 'fs' ), path = require( 'path' ), os = require( 'os' );
const { RunController } = require( '../src/controller' );
const { MockEngine } = require( '../src/gep' );

const INTENT = {
	objective: 'The sandbox holds greet.txt, a friendly greeting that says hello, and sum.js, a Node script printing the sum of its numeric arguments.',
	desiredBehaviors: [ 'node sum.js 2 3 prints 5', 'node sum.js with no arguments prints 0' ],
	hardConstraints: [ 'only files inside the sandbox change' ],
	prohibitedOutcomes: [ 'sum.js crashes on any input' ],
	qualityThresholds: [ 'sum.js exits with code 0' ]
};
const runSum = ( args )=>( { tool: 'process.run', params: { argv: [ 'node', 'sum.js', ...args ] } } );

// a scripted engine: answers by mode, and reads the context like the real one would have to
function demoEngine( { lie = false } = {} )
{
	let sumVersion = 0;
	return new MockEngine( ( mode, ctx )=>
	{
		if ( mode === 'SUCCESS_COMPILE' ) return { residues: [
			{ id: 'greet-says-hello', description: 'greet.txt exists and says hello', required: true, priority: 60, contract: { kind: 'check', probe: { tool: 'file.read', params: { path: 'greet.txt' } }, asserts: [ { path: 'exists', op: 'eq', value: true }, { path: 'text', op: 'matches', value: 'hello', flags: 'i' } ] } },
			{ id: 'sum-adds', description: 'node sum.js 2 3 prints 5 and exits 0', required: true, priority: 80, contract: { kind: 'check', probe: runSum( [ '2', '3' ] ), asserts: [ { path: 'exitCode', op: 'eq', value: 0 }, { path: 'stdout', op: 'matches', value: '^5\\s*$' } ] } }
		] };
		if ( mode === 'ADVERSARIAL_COMPLETE' )
		{
			const ids = ctx.residues.map( ( r )=>r.id );
			const f = [];
			if ( !ids.includes( 'sum-empty' ) ) f.push( { description: 'with no arguments sum.js might crash or print NaN', material: true, residue: { id: 'sum-empty', description: 'node sum.js with no arguments prints 0 and exits 0', required: true, priority: 70, dependsOn: [ 'sum-adds' ], contract: { kind: 'check', probe: runSum( [] ), asserts: [ { path: 'exitCode', op: 'eq', value: 0 }, { path: 'stdout', op: 'matches', value: '^0\\s*$' } ] } } } );
			if ( !ids.includes( 'greet-friendly' ) ) f.push( { description: '"hello" could be said in a hostile way; the intent asks for a friendly greeting', material: true, residue: { id: 'greet-friendly', description: 'the greeting in greet.txt reads as friendly', required: true, priority: 40, dependsOn: [ 'greet-says-hello' ], contract: { kind: 'semantic', probe: { tool: 'file.read', params: { path: 'greet.txt' } }, question: 'Does this text read as a friendly greeting?' } } } );
			return { findings: f };
		}
		if ( mode === 'OBSERVE_INTERPRET' )
		{
			const judgements = [];
			for ( const s of ctx.semanticToJudge ) if ( s.probeEvidence )
			{
				const ev = ctx.newEvidence.find( ( e )=>e.id === s.probeEvidence );
				if ( ev ) judgements.push( { residueId: s.residueId, verdict: /hello[^.!]*[!.]?\s*(friend|welcome|nice|:\))/i.test( ev.payload ) ? 'PASS' : /hello/i.test( ev.payload ) ? 'PASS' : 'FAIL', evidenceIds: [ ev.id ], reason: 'read the probe text' } );
			}
			// a lying engine claims sum-adds is satisfied with evidence that does not exist
			const transitions = lie ? [ { residueId: 'sum-adds', to: 'SATISFIED', evidenceIds: [ 'ev_made_up' ], reason: 'I believe it works' } ] : [];
			return { summary: 'cycle ' + ctx.cycle + ': ' + ctx.newEvidence.length + ' new evidence', claims: [ { kind: 'INFERENCE', text: 'open: ' + ctx.delta.open.map( ( o )=>o.id ).join( ', ' ), cites: [] } ], transitions, judgements, unknowns: [] };
		}
		if ( mode === 'ACTION_SYNTHESIZE' )
		{
			const open = ctx.delta.open.map( ( o )=>o.id );
			const acts = [];
			if ( open.includes( 'greet-says-hello' ) ) acts.push( { targets: [ 'greet-says-hello' ], rationale: 'the file is missing', tool: 'file.write', params: { path: 'greet.txt', content: 'Hello there, friend! Nice to see you.\n' }, predictedEffect: 'greet.txt says hello', expectedEvidence: [ 'file.read shows hello' ], failureSignatures: [ 'exists false' ], risk: 'low' } );
			if ( open.includes( 'sum-adds' ) || open.includes( 'sum-empty' ) )
			{
				// first version: breaks on no arguments (prints NaN? no: reduce without an initial value throws)
				const src = sumVersion++ === 0
					? 'const a = process.argv.slice(2).map(Number);\nconsole.log(a.reduce((x, y) => x + y));\n'
					: 'const a = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));\nconsole.log(a.reduce((x, y) => x + y, 0));\n';
				acts.push( { targets: [ 'sum-adds', 'sum-empty' ].filter( ( t )=>open.includes( t ) ), rationale: sumVersion === 1 ? 'sum.js is missing' : 'sum.js throws on no arguments: reduce needs an initial value', tool: 'file.write', params: { path: 'sum.js', content: src }, predictedEffect: 'sum.js prints the sum', expectedEvidence: [ 'node sum.js 2 3 prints 5' ], failureSignatures: [ 'TypeError: Reduce of empty array' ], risk: 'low' } );
			}
			return { actions: acts };
		}
		if ( mode === 'FAILURE_ANALYZE' ) return { diagnosis: 'the same fix was repeated', strategy: 'ALTERNATIVE' };
		if ( mode === 'FINAL_VERIFY' ) return { findings: [ { kind: 'UNTESTED_BOUNDARY', description: 'negative numbers are not checked, but the intent does not ask for them', material: false } ] };
		throw new Error( 'mode ' + mode );
	}, 'demo mock engine' );
}

function makeRun( dir, engine, extra = {} )
{
	const root = path.join( dir, 'sandbox' ); fs.mkdirSync( root, { recursive: true } );
	return new RunController( dir, { intent: INTENT, engine, root, policy: { commands: [ 'node' ], probeCommands: [ 'node' ] }, budget: { engineCalls: 60, actions: 20, cycles: 12 }, ...extra } );
}

if ( require.main === module )
{
	( async ()=>
	{
		const dir = process.argv[ 2 ] || fs.mkdtempSync( path.join( os.tmpdir(), 'residue-demo-' ) );
		const run = makeRun( dir, demoEngine() );
		const out = await run.step();
		console.log( 'run dir:', dir );
		console.log( 'result:', JSON.stringify( out ) );
		for ( const e of run.log.events.filter( ( e )=>[ 'residue.added', 'residue.status', 'action.accepted', 'action.executed', 'phase', 'terminal' ].includes( e.type ) ) )
			console.log( String( e.seq ).padStart( 3 ), e.type.padEnd( 16 ), JSON.stringify( e.data ).slice( 0, 150 ) );
	} )();
}
module.exports = { INTENT, demoEngine, makeRun, runSum };
