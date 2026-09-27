'use strict';
// The invariants the design law rests on. node --test test/
const test = require( 'node:test' ), assert = require( 'node:assert' );
const fs = require( 'fs' ), path = require( 'path' ), os = require( 'os' );
const { RunController } = require( '../src/controller' );
const { MockEngine, FileExchangeEngine } = require( '../src/gep' );
const { EventLog } = require( '../src/stores' );
const { demoEngine, makeRun, INTENT } = require( '../demo/demo' );

const tmp = ()=>fs.mkdtempSync( path.join( os.tmpdir(), 'rl-test-' ) );
const types = ( run, t )=>run.log.events.filter( ( e )=>e.type === t );

// an engine built from a base engine with some modes overridden
function withOverrides( base, over )
{
	return new MockEngine( async ( mode, ctx, call )=>over[ mode ] ? over[ mode ]( ctx, ()=>base.handler( mode, ctx, call ) ) : base.handler( mode, ctx, call ), 'test engine' );
}

test( 'the demo objective reaches SUCCESS only through verified evidence', async ()=>
{
	const run = makeRun( tmp(), demoEngine() );
	const out = await run.step();
	assert.strictEqual( out.state, 'SUCCESS' );
	const report = JSON.parse( fs.readFileSync( path.join( run.dir, 'success-report.json' ), 'utf8' ) );
	for ( const r of report.residues.filter( ( r )=>r.required ) )
	{
		assert.strictEqual( r.status, 'SATISFIED', r.id );
		assert.ok( r.evidence.some( ( e )=>e.origin === 'probe' ), r.id + ' is backed by probe evidence' );
	}
	assert.strictEqual( fs.readFileSync( path.join( run.dir, 'sandbox', 'greet.txt' ), 'utf8' ).includes( 'Hello' ), true );
} );

test( 'the engine cannot create raw evidence', async ()=>
{
	const run = makeRun( tmp(), demoEngine() );
	// no capability, no write
	assert.throws( ()=>run.evidence._add( Symbol( 'fake' ), { origin: 'tool', producedBy: 'x', kind: 'k', payload: 1 } ), /capability/ );
	// an 'engine' origin is not admissible, even through the writer
	assert.throws( ()=>run.evidence.writer.add( { origin: 'engine', producedBy: 'x', kind: 'k', payload: 1 } ), /origin/ );
	// the adapter hands the engine a plain copy of the context: nothing it returns reaches the evidence store
	const sneaky = withOverrides( demoEngine(), { OBSERVE_INTERPRET: async ( ctx, base )=>( { ...( await base() ), evidence: [ { id: 'ev_fake', origin: 'tool', payload: 'all good' } ] } ) } );
	const run2 = makeRun( tmp(), sneaky );
	await run2.step();
	assert.strictEqual( run2.evidence.has( 'ev_fake' ), false );
	assert.ok( run2.evidence.all().every( ( e )=>e.origin !== 'engine' ) );
} );

test( 'model-derived material cannot become evidence', async ()=>
{
	const run = makeRun( tmp(), demoEngine() );
	await run.step();
	assert.throws( ()=>run.derived.add( { kind: 'FACT', text: 'the build passes' } ), /FACT\/OBSERVATION only come from the evidence store/ );
	const claim = run.derived.all()[ 0 ];
	assert.ok( claim, 'the engine left derived claims' );
	assert.strictEqual( run.evidence.has( claim.id ), false );
	assert.strictEqual( run.evidence.admissible( claim.id ), false );
} );

test( 'unsupported claims cannot change verified state', async ()=>
{
	const run = makeRun( tmp(), demoEngine( { lie: true } ) );
	const out = await run.step();
	const rej = types( run, 'proposal.rejected' );
	assert.ok( rej.some( ( e )=>/does not exist/.test( e.data.why ) ), 'a transition citing made-up evidence is rejected' );
	// sum-adds only ever became SATISFIED through its contract, never through the lie
	for ( const e of types( run, 'residue.status' ).filter( ( e )=>e.data.id === 'sum-adds' && e.data.to === 'SATISFIED' ) ) assert.match( e.data.why, /^contract PASS/ );
	assert.strictEqual( out.state, 'SUCCESS' );
	// and a claim with only real evidence still can't set SATISFIED on a deterministic residue
	const real = run.evidence.all()[ 0 ].id;
	const { rejected } = run.reducer.applyProposals( { transitions: [ { residueId: 'sum-empty', to: 'SATISFIED', evidenceIds: [ real ], reason: 'trust me' } ] }, { engineCall: 't', probeEvidence: run.probeMap() } );
	assert.strictEqual( rejected.length, 1 );
	assert.match( rejected[ 0 ].why, /decided by the check contract/ );
} );

test( 'an action does not count until its consequences are observed', async ()=>
{
	// the engine writes a sum.js that is wrong, and says it will work
	let n = 0;
	const eng = withOverrides( demoEngine(), { ACTION_SYNTHESIZE: async ( ctx, base )=>
	{
		const r = await base();
		for ( const a of r.actions ) if ( a.params.path === 'sum.js' && n++ === 0 ) { a.params.content = 'console.log(42)\n'; a.predictedEffect = 'sum.js is correct now'; }
		return r;
	} } );
	const run = makeRun( tmp(), eng, { budget: { cycles: 2, engineCalls: 40, actions: 20 } } );
	await run.step();
	const hist = run.graph.get( 'sum-adds' ).history;
	// right after the wrong write, the residue was observed CONTRADICTED, not trusted
	const afterFirstWrite = hist.find( ( h )=>/cycle 1/.test( h.why ) );
	assert.strictEqual( afterFirstWrite.to, 'CONTRADICTED' );
	const accepted = types( run, 'action.accepted' ).find( ( e )=>e.data.params.content === 'console.log(42)\n' );
	assert.ok( accepted, 'the wrong action ran' );
} );

test( 'success criteria cannot move silently', async ()=>
{
	const dir = tmp();
	const run = makeRun( dir, demoEngine() );
	await run.step();
	// loosen a residue's contract on disk
	const file = path.join( dir, 'residues.json' );
	const rs = JSON.parse( fs.readFileSync( file, 'utf8' ) );
	rs.find( ( r )=>r.id === 'sum-adds' ).contract.asserts = [ { path: 'exitCode', op: 'exists' } ];
	fs.writeFileSync( file, JSON.stringify( rs ) );
	assert.throws( ()=>makeRun( dir, demoEngine() ), /criteria changed/ );
	// change the intent on disk
	const dir2 = tmp();
	await makeRun( dir2, demoEngine() ).step();
	const intentFile = path.join( dir2, 'intent.json' );
	const i = JSON.parse( fs.readFileSync( intentFile, 'utf8' ) ); i.objective = 'anything at all'; fs.writeFileSync( intentFile, JSON.stringify( i ) );
	assert.throws( ()=>new RunController( dir2, { engine: demoEngine(), root: path.join( dir2, 'sandbox' ) } ), /cannot be changed silently/ );
	// residues are never removed by the engine: invalidation is human-only
	const run3 = makeRun( tmp(), demoEngine() );
	await run3.step();
	const ev = run3.evidence.all()[ 0 ].id;
	const { rejected } = run3.reducer.applyProposals( { transitions: [ { residueId: 'greet-friendly', to: 'INVALIDATED', evidenceIds: [ ev ], reason: 'not needed' } ] }, { engineCall: 't', probeEvidence: run3.probeMap() } );
	assert.match( rejected[ 0 ].why, /only a human/ );
} );

test( 'failed actions stay visible', async ()=>
{
	const eng = withOverrides( demoEngine(), { ACTION_SYNTHESIZE: async ( ctx, base )=>
	{
		const r = await base();
		if ( ctx.delta.open.some( ( o )=>o.id === 'greet-says-hello' ) ) r.actions.unshift( { targets: [ 'greet-says-hello' ], rationale: 'try a forbidden command', tool: 'process.run', params: { argv: [ 'rm', '-rf', '/' ] }, predictedEffect: 'nothing good', expectedEvidence: [], failureSignatures: [], risk: 'low' } );
		return r;
	} } );
	const run = makeRun( tmp(), eng, { maxActionsPerCycle: 4 } );
	await run.step();
	const failed = types( run, 'action.executed' ).filter( ( e )=>e.data.ok === false );
	assert.ok( failed.length >= 1, 'the failed action is logged' );
	const ev = run.evidence.get( failed[ 0 ].data.evidence );
	assert.match( JSON.stringify( run.evidence.payloadOf( ev ) ), /command not allowed: rm/ );
} );

test( 'a satisfied residue reopens when reality contradicts it', async ()=>
{
	const dir = tmp();
	const run = makeRun( dir, demoEngine() );
	assert.strictEqual( ( await run.step() ).state, 'SUCCESS' );
	// reality changes after success; a new run over the same graph sees it
	fs.writeFileSync( path.join( dir, 'sandbox', 'sum.js' ), 'process.exit(3)\n' );
	const r2 = new RunController( dir, { engine: demoEngine(), root: path.join( dir, 'sandbox' ), policy: { commands: [ 'node' ], probeCommands: [ 'node' ] } } );
	r2.cp.phase = 'OBSERVE'; r2.cp.terminal = null;
	r2.runProbes(); r2.reducer.applyDeterministic( r2.probeMap(), 99 );
	const r = r2.graph.get( 'sum-adds' );
	assert.strictEqual( r.status, 'CONTRADICTED' );
	assert.match( r.history[ r.history.length - 1 ].why, /^REGRESSION/ );
} );

test( 'SUCCESS is impossible while a required residue is unverified', async ()=>
{
	// the engine never judges the semantic residue, and insists at final verify that all is well
	const eng = withOverrides( demoEngine(), { OBSERVE_INTERPRET: async ( ctx, base )=>{ const r = await base(); r.judgements = []; return r; } } );
	const run = makeRun( tmp(), eng, { budget: { cycles: 4, engineCalls: 30, actions: 20 } } );
	const out = await run.step();
	assert.notStrictEqual( out.state, 'SUCCESS' );
	assert.strictEqual( fs.existsSync( path.join( run.dir, 'success-report.json' ) ), false );
	// and the gate itself refuses when called directly
	run.cp.phase = 'FINAL'; run.cp.terminal = null;
	run.gate();
	assert.ok( types( run, 'gate.refused' ).length >= 1 );
	assert.notStrictEqual( run.cp.terminal && run.cp.terminal.state, 'SUCCESS' );
} );

test( 'malformed engine output is rejected, not believed', async ()=>
{
	let bad = 0;
	const eng = withOverrides( demoEngine(), { ACTION_SYNTHESIZE: async ( ctx, base )=>bad++ < 1 ? { actions: 'just write the files, it will be fine' } : base() } );
	const run = makeRun( tmp(), eng );
	const out = await run.step();
	assert.ok( types( run, 'engine.rejected' ).some( ( e )=>e.data.mode === 'ACTION_SYNTHESIZE' ) );
	assert.strictEqual( out.state, 'SUCCESS' );
	// three malformed answers in a row end the run for a human
	const run2 = makeRun( tmp(), withOverrides( demoEngine(), { SUCCESS_COMPILE: async ()=>'prose' } ) );
	assert.strictEqual( ( await run2.step() ).state, 'NEEDS_HUMAN' );
} );

test( 'residues must be properties of reality, not actions', ()=>
{
	const { ResidueGraph } = require( '../src/model' );
	const p = ResidueGraph.validateInput( { id: 'x', description: 'implement authentication', required: true, contract: { kind: 'human' } } );
	assert.ok( p.some( ( s )=>/reads as an action/.test( s ) ) );
} );

test( 'actions are idempotent and gated', async ()=>
{
	const run = makeRun( tmp(), demoEngine() );
	await run.step();
	const a = { targets: [ 'greet-says-hello' ], rationale: 'rewrite the greeting', tool: 'file.write', params: { path: 'greet.txt', content: 'Hello again!\n' }, predictedEffect: 'greet.txt says hello again', expectedEvidence: [], failureSignatures: [], risk: 'low' };
	run.graph.setStatus( 'greet-says-hello', 'UNKNOWN', [], 'test', run.log );
	assert.strictEqual( run.broker.execute( a, 't' ).executed, true );
	run.graph.setStatus( 'greet-says-hello', 'UNKNOWN', [], 'test', run.log );
	const again = run.broker.execute( a, 't' );
	assert.strictEqual( again.executed, false );
	assert.ok( again.problems.some( ( p )=>/already executed/.test( p ) ) );
	const risky = run.broker.execute( { ...a, params: { path: 'greet.txt', content: 'x' }, risk: 'high' }, 't' );
	assert.ok( risky.problems.some( ( p )=>/risk high/.test( p ) ) );
	// a path outside the sandbox is refused, and the refusal is recorded as what happened
	const esc = run.runtime.run( 'file.write', { path: '../../escape.txt', content: 'x' }, { producedBy: 't' } );
	assert.strictEqual( esc.ok, false );
	assert.match( JSON.stringify( run.evidence.payloadOf( esc.evidence ) ), /escapes the sandbox/ );
	assert.strictEqual( fs.existsSync( path.join( run.dir, '..', 'escape.txt' ) ), false );
} );

test( 'the event log is tamper-evident and the run resumes from its checkpoint', async ()=>
{
	// a file-exchange engine: the run pauses at every question, and a fresh controller picks up where it stopped
	const dir = tmp();
	const answers = demoEngine();
	const opts = { intent: INTENT, root: path.join( dir, 'sandbox' ), policy: { commands: [ 'node' ], probeCommands: [ 'node' ] } };
	fs.mkdirSync( opts.root, { recursive: true } );
	let out, rounds = 0;
	do
	{
		const run = new RunController( dir, { ...opts, engine: new FileExchangeEngine( path.join( dir, 'engine' ) ) } );
		out = await run.step();
		if ( out.state === 'PENDING' )
		{
			const req = JSON.parse( fs.readFileSync( out.requestFile, 'utf8' ) );
			fs.writeFileSync( out.responseFile, JSON.stringify( await answers.handler( req.mode, req.context ) ) );
		}
	} while ( out.state === 'PENDING' && ++rounds < 40 );
	assert.strictEqual( out.state, 'SUCCESS' );
	assert.ok( rounds > 5, 'it paused and resumed several times' );
	// edit one event: the chain no longer verifies
	const f = path.join( dir, 'events.jsonl' );
	const lines = fs.readFileSync( f, 'utf8' ).split( '\n' ).filter( Boolean );
	const e = JSON.parse( lines[ 3 ] ); e.data = { edited: true }; lines[ 3 ] = JSON.stringify( e );
	fs.writeFileSync( f, lines.join( '\n' ) + '\n' );
	assert.throws( ()=>new EventLog( dir ), /chain broken at #3/ );
} );

test( 'a stall sends the run to failure analysis instead of blind retries', async ()=>
{
	let analyzed = 0;
	// the engine keeps proposing the same broken sum.js
	const eng = withOverrides( demoEngine(), {
		ACTION_SYNTHESIZE: async ( ctx )=>( { actions: ctx.delta.open.length ? [ { targets: ctx.delta.open.map( ( o )=>o.id ).slice( 0, 1 ), rationale: 'same again', tool: 'file.write', params: { path: 'sum.js', content: 'process.exit(1)\n' }, predictedEffect: 'works', expectedEvidence: [], failureSignatures: [], risk: 'low' } ] : [] } ),
		FAILURE_ANALYZE: async ()=>{ analyzed++; return { diagnosis: 'the same broken file keeps being written; a human should look', strategy: 'NEED_HUMAN', question: 'what should sum.js do?' }; }
	} );
	const run = makeRun( tmp(), eng );
	const out = await run.step();
	assert.ok( analyzed >= 1 );
	assert.strictEqual( out.state, 'NEEDS_HUMAN' );
	assert.match( out.why, /what should sum.js do/ );
} );

test( '15 a tool fingerprint makes the same call with new content a new action, a true repeat still refused', ()=>
{
	const { ActionBroker, ToolRuntime, BudgetManager } = require( '../src/runtime' );
	const { EventLog, EvidenceStore } = require( '../src/stores' );
	const { ResidueGraph } = require( '../src/model' );
	const fs = require( 'fs' ), os = require( 'os' ), path = require( 'path' );
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'rl-fp-' ) );
	let content = 'a';
	const tools = { 'x.write': { readOnly: false, fingerprint: ()=>content, run: ()=>( { wrote: content } ) } };
	const log = new EventLog( dir ), evidence = new EvidenceStore( dir, log );
	const runtime = new ToolRuntime( { root: dir, evidence: evidence.writer, log, extraTools: tools, policy: {} } );
	const graph = new ResidueGraph( null );
	graph.add( { id: 'r', description: 'the file holds the right text', required: true, contract: { kind: 'human', question: 'ok?' } }, 'test' );
	const broker = new ActionBroker( { runtime, graph, log, budget: new BudgetManager(), policy: {} } );
	const act = { targets: [ 'r' ], rationale: 'write it', tool: 'x.write', params: { path: 'f' }, predictedEffect: 'written', expectedEvidence: [], failureSignatures: [], risk: 'low' };
	assert.equal( broker.execute( act, 'c1' ).executed, true );
	assert.equal( broker.execute( act, 'c2' ).executed, false );
	content = 'b';
	assert.equal( broker.execute( act, 'c3' ).executed, true );
} );
