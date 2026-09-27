'use strict';
// RunController: the loop. It runs as a resumable state machine: step() advances until the run ends or the engine
// hasn't answered yet (PENDING), checkpointing after every transition, so a crash or a pause resumes exactly where it
// stopped and asks the engine the same question again.
//
//   INTENT → SUCCESS_COMPILE → ADVERSARIAL_COMPLETE (until nothing material) → RESIDUE GRAPH
//   loop: OBSERVE (probes → evidence → deterministic verification → OBSERVE_INTERPRET → admissible transitions)
//         → DELTA → (empty: FINAL) / (stalled: FAILURE_ANALYZE) / ACTION_SYNTHESIZE → broker executes → OBSERVE …
//   FINAL: fresh probes (regression) → FINAL_VERIFY → material findings reopen the loop, else the success gate.
const fs = require( 'fs' ), path = require( 'path' );
const { canonical, sha256, clone, deepFreeze } = require( './util' );
const { IntentSpec, ResidueGraph, probesOf, probeKey } = require( './model' );
const { EventLog, EvidenceStore, DerivedKnowledgeStore } = require( './stores' );
const { GEPTrainAdapter } = require( './gep' );
const { ToolRuntime, ActionBroker, BudgetManager, StallDetector } = require( './runtime' );
const { StateReducer, DeltaEngine } = require( './control' );

const TERMINAL = [ 'SUCCESS', 'BLOCKED', 'NEEDS_HUMAN', 'BUDGET_EXHAUSTED', 'IMPOSSIBLE_UNDER_CONSTRAINTS' ];

class RunController
{
	// dir: the run's folder. opts: { intent (spec object, first run only), engine, root (sandbox), policy, budget,
	// maxAdversarialRounds, maxActionsPerCycle, extraTools, contextLimits }
	constructor( dir, opts )
	{
		this.dir = path.resolve( dir ); fs.mkdirSync( this.dir, { recursive: true } );
		this.opts = { maxAdversarialRounds: 6, maxActionsPerCycle: 3, maxInvalidAnswers: 3, ...opts };
		this.log = new EventLog( this.dir );
		this.evidence = new EvidenceStore( this.dir, this.log );
		this.derived = new DerivedKnowledgeStore( this.dir, this.log );
		this.graph = new ResidueGraph( path.join( this.dir, 'residues.json' ) );
		const cpFile = path.join( this.dir, 'checkpoint.json' );
		this.cpFile = cpFile;
		this.cp = fs.existsSync( cpFile ) ? JSON.parse( fs.readFileSync( cpFile, 'utf8' ) ) : null;
		// the intent: written once, never edited; a changed file is refused
		const intentFile = path.join( this.dir, 'intent.json' );
		if ( !fs.existsSync( intentFile ) )
		{
			if ( !opts.intent ) throw new Error( 'new run needs an intent' );
			const intent = new IntentSpec( opts.intent );
			fs.writeFileSync( intentFile, JSON.stringify( intent.spec, null, 1 ) );
			this.log.append( 'intent', { hash: intent.hash, objective: intent.spec.objective } );
		}
		this.intent = IntentSpec.load( intentFile );
		const recorded = this.log.ofType( 'intent' ).map( ( e )=>e.data.hash ).concat( this.log.ofType( 'intent.amended' ).map( ( e )=>e.data.hash ) ).pop();
		if ( recorded !== this.intent.hash ) throw new Error( 'intent.json does not match the intent this run was started with (hash ' + this.intent.hash.slice( 0, 12 ) + ' vs ' + String( recorded ).slice( 0, 12 ) + '): the goal cannot be changed silently' );
		if ( !this.cp ) this.cp = { phase: 'COMPILE', seq: 0, cycle: 0, adversarialRounds: 0, invalidAnswers: 0, stall: {}, budgetSpent: null, done: [], lastProbeIds: {}, terminal: null, finalRounds: 0, lastActions: [] };
		this.budget = new BudgetManager( opts.budget, this.cp.budgetSpent || undefined );
		this.stall = new StallDetector( this.cp.stall );
		this.engine = new GEPTrainAdapter( opts.engine, this.log );
		this.runtime = new ToolRuntime( { root: opts.root || this.dir, evidence: this.evidence.writer, policy: opts.policy || {}, extraTools: opts.extraTools || {} } );
		this.broker = new ActionBroker( { runtime: this.runtime, graph: this.graph, log: this.log, budget: this.budget, policy: ( opts.policy || {} ).actions, done: this.cp.done } );
		this.reducer = new StateReducer( { graph: this.graph, evidence: this.evidence, derived: this.derived, log: this.log } );
		this.delta = new DeltaEngine( this.graph );
		if ( this.graph.criteriaIntact().length ) throw new Error( 'residue criteria changed outside the run: ' + this.graph.criteriaIntact().join( ', ' ) );
	}

	save()
	{
		this.cp.stall = this.stall.state(); this.cp.budgetSpent = this.budget.spent; this.cp.done = [ ...this.broker.done ];
		this.graph.save();
		const tmp = this.cpFile + '.tmp'; fs.writeFileSync( tmp, JSON.stringify( this.cp, null, 1 ) ); fs.renameSync( tmp, this.cpFile );
	}
	go( phase, why ) { this.log.append( 'phase', { from: this.cp.phase, to: phase, why } ); this.cp.phase = phase; this.save(); }
	end( state, why ) { this.cp.terminal = { state, why, at: new Date().toISOString() }; this.log.append( 'terminal', { state, why } ); this.cp.phase = 'TERMINAL'; this.save(); return { state, why }; }

	// the human channel: approvals, answers, invalidations. Its words are evidence (origin human), recorded as given.
	human( { text, approve = [], answerTo = null } )
	{
		const e = this.evidence.writer.add( { origin: 'human', producedBy: 'human', kind: 'human.message', tags: approve.map( ( id )=>'approve:' + id ).concat( answerTo ? [ 'answer:' + answerTo ] : [] ), payload: { text } } );
		if ( this.cp.phase === 'TERMINAL' && this.cp.terminal && this.cp.terminal.state === 'NEEDS_HUMAN' ) { this.cp.terminal = null; this.go( 'OBSERVE', 'human answered (' + e.id + ')' ); }
		return e;
	}

	// ---- engine calls ----
	async ask( mode, context )
	{
		if ( this.budget.exhausted() ) return { status: 'budget' };
		const r = await this.engine.call( mode, context, this.cp.seq );
		if ( r.status === 'pending' ) return r;
		this.cp.seq++; this.budget.charge( 'engineCalls' );
		if ( r.status === 'invalid' )
		{
			this.cp.invalidAnswers++; this.save();
			return r;
		}
		this.cp.invalidAnswers = 0;
		return r;
	}
	pending( r ) { this.save(); return { state: 'PENDING', callId: r.callId, requestFile: r.requestFile, responseFile: r.responseFile, phase: this.cp.phase }; }
	invalid( r ) { return this.cp.invalidAnswers >= this.opts.maxInvalidAnswers ? this.end( 'NEEDS_HUMAN', 'the engine gave ' + this.cp.invalidAnswers + ' malformed answers in a row (last: ' + r.problems.slice( 0, 3 ).join( '; ' ) + ')' ) : null; }

	// ---- context bundles (what the engine sees) ----
	residueView( r, full = true ) { return full ? { id: r.id, description: r.description, required: r.required, status: r.status, priority: r.priority, dependsOn: r.dependsOn, contract: r.contract, evidence: r.evidence, lastChange: r.history[ r.history.length - 1 ] } : { id: r.id, status: r.status, description: r.description }; }
	evidenceView( e, maxChars = this.opts.evidenceChars || 2400 )
	{
		const p = this.evidence.payloadOf( e );
		let s = Buffer.isBuffer( p ) ? '<binary ' + p.length + ' bytes>' : canonical( p );
		if ( s.length > maxChars ) s = s.slice( 0, maxChars ) + '…(' + s.length + ' chars; hash ' + e.hash.slice( 0, 12 ) + ')';
		return { id: e.id, origin: e.origin, producedBy: e.producedBy, kind: e.kind, tags: e.tags, at: e.at, payload: s };
	}

	// ---- the machine ----
	async step( maxTransitions = 200 )
	{
		for ( let i = 0; i < maxTransitions; i++ )
		{
			if ( this.cp.phase === 'TERMINAL' ) return this.cp.terminal;
			const ex = this.budget.exhausted();
			if ( ex ) return this.end( 'BUDGET_EXHAUSTED', 'budget exhausted: ' + ex );
			const r = await this[ 'phase' + this.cp.phase ]();
			if ( r ) return r;
		}
		this.save();
		return { state: 'RUNNING', phase: this.cp.phase };
	}

	async phaseCOMPILE()
	{
		const r = await this.ask( 'SUCCESS_COMPILE', { intent: this.intent.spec, tools: this.toolCatalog() } );
		if ( r.status === 'pending' ) return this.pending( r );
		if ( r.status === 'invalid' ) return this.invalid( r );
		const added = this.addResidues( r.result.residues, 'compile', r.callId );
		if ( !added ) return this.cp.invalidAnswers++ >= this.opts.maxInvalidAnswers ? this.end( 'NEEDS_HUMAN', 'no valid residues could be compiled' ) : null;
		this.go( 'ADVERSARIAL', added + ' residues compiled' );
	}
	async phaseADVERSARIAL()
	{
		const r = await this.ask( 'ADVERSARIAL_COMPLETE', { intent: this.intent.spec, residues: this.graph.all().map( ( x )=>this.residueView( x ) ), round: this.cp.adversarialRounds } );
		if ( r.status === 'pending' ) return this.pending( r );
		if ( r.status === 'invalid' ) return this.invalid( r );
		this.cp.adversarialRounds++;
		const material = r.result.findings.filter( ( f )=>f.material );
		for ( const f of r.result.findings ) this.derived.add( { kind: 'INFERENCE', text: 'adversarial finding: ' + f.description, residueIds: f.residue ? [ f.residue.id ] : [], engineCall: r.callId, data: { material: f.material } } );
		const withResidue = material.filter( ( f )=>f.residue );
		const added = this.addResidues( withResidue.map( ( f )=>f.residue ), 'adversarial', r.callId );
		const unresolved = material.length - added;
		if ( !material.length ) return this.go( 'OBSERVE', 'adversarial pass ' + this.cp.adversarialRounds + ' found nothing material' );
		if ( this.cp.adversarialRounds >= this.opts.maxAdversarialRounds ) return this.end( 'NEEDS_HUMAN', 'still finding material omissions after ' + this.cp.adversarialRounds + ' adversarial rounds (' + unresolved + ' without a usable residue)' );
		this.save();   // ask again with the grown graph
	}
	addResidues( list, origin, callId )
	{
		let n = 0;
		for ( const x of list )
		{
			const problems = ResidueGraph.validateInput( x );
			if ( !problems.length && this.graph.get( x.id ) ) problems.push( 'duplicate id ' + x.id );
			if ( !problems.length ) for ( const d of x.dependsOn || [] ) if ( !this.graph.get( d ) && !list.some( ( y )=>y.id === d ) ) problems.push( 'depends on unknown ' + d );
			if ( problems.length ) { this.log.append( 'residue.rejected', { id: x && x.id, origin, callId, problems } ); continue; }
		}
		// add in dependency order
		const pending = list.filter( ( x )=>!ResidueGraph.validateInput( x ).length && !this.graph.get( x.id ) );
		for ( let guard = 0; pending.length && guard < 100; guard++ )
		{
			const i = pending.findIndex( ( x )=>( x.dependsOn || [] ).every( ( d )=>this.graph.get( d ) ) );
			if ( i < 0 ) { for ( const x of pending ) this.log.append( 'residue.rejected', { id: x.id, origin, callId, problems: [ 'unresolvable dependencies' ] } ); break; }
			const [ x ] = pending.splice( i, 1 );
			this.graph.add( x, origin, this.log ); n++;
		}
		this.graph.save();
		return n;
	}
	toolCatalog() { return Object.keys( this.runtime.tools ).map( ( t )=>( { tool: t, readOnly: !!this.runtime.tools[ t ].readOnly, doc: this.runtime.tools[ t ].doc || '' } ) ).concat( [ { commands: this.runtime.policy.commands, probeCommands: this.runtime.policy.probeCommands } ] ); }

	// OBSERVE: run every residue's probes (read-only) for fresh evidence, verify mechanically, then let the engine
	// interpret everything new since the last OBSERVE and propose what can't be decided mechanically.
	runProbes()
	{
		const probes = new Map();
		for ( const r of this.graph.all() ) if ( r.status !== 'INVALIDATED' ) for ( const p of probesOf( r.contract ) ) probes.set( probeKey( p ), p );
		const got = new Map();
		for ( const [ key, p ] of probes )
		{
			if ( !this.runtime.isReadOnly( p.tool, p.params ) ) { this.log.append( 'probe.refused', { key, tool: p.tool, why: 'probes must be read-only' } ); continue; }
			const out = this.runtime.run( p.tool, p.params, { producedBy: key, origin: 'probe', tags: [ 'probe', key, 'cycle:' + this.cp.cycle ] } );
			got.set( key, out.evidence );
		}
		this.cp.lastProbeIds = Object.fromEntries( [ ...got ].map( ( [ k, e ] )=>[ k, e.id ] ) );
		return got;
	}
	probeMap() { return new Map( Object.entries( this.cp.lastProbeIds || {} ).map( ( [ k, id ] )=>[ k, this.evidence.get( id ) ] ).filter( ( [ , e ] )=>e ) ); }

	async phaseOBSERVE()
	{
		if ( !this.cp.observeProbed )
		{
			this.runProbes();
			this.reducer.applyExternal();
			this.reducer.applyDeterministic( this.probeMap(), this.cp.cycle );
			this.cp.observeProbed = true; this.save();
		}
		const seen = new Set( this.cp.seenEvidence || [] );
		const fresh = this.evidence.all().filter( ( e )=>!seen.has( e.id ) );
		const d = this.delta.compute();
		const semanticOpen = this.graph.all().filter( ( r )=>r.contract.kind === 'semantic' && r.status !== 'SATISFIED' && r.status !== 'INVALIDATED' );
		const ctx = {
			intent: this.intent.spec,
			cycle: this.cp.cycle,
			delta: d,
			residues: this.graph.all().map( ( r )=>this.residueView( r, d.open.some( ( o )=>o.id === r.id ) || semanticOpen.includes( r ) ) ),
			lastActions: this.cp.lastActions || [],
			newEvidence: fresh.map( ( e )=>this.evidenceView( e ) ),
			semanticToJudge: semanticOpen.map( ( r )=>( { residueId: r.id, question: r.contract.question, probeEvidence: ( this.probeMap().get( probeKey( r.contract.probe ) ) || {} ).id || null } ) )
		};
		const r = await this.ask( 'OBSERVE_INTERPRET', ctx );
		if ( r.status === 'pending' ) return this.pending( r );
		if ( r.status === 'invalid' ) { const t = this.invalid( r ); if ( t ) return t; return this.go( 'ACT', 'interpretation rejected; acting on the verified state as it stands' ); }
		for ( const u of r.result.unknowns || [] ) this.derived.add( { kind: 'HYPOTHESIS', text: 'unknown: ' + u, engineCall: r.callId } );
		for ( const c of r.result.claims ) if ( c.kind === 'HYPOTHESIS' ) this.stall.recordHypothesis( c.text );
		this.reducer.applyProposals( r.result, { engineCall: r.callId, probeEvidence: this.probeMap() } );
		// a proposed CONTRADICTED on a deterministic residue is re-checked right away: the check has the last word
		this.reducer.applyDeterministic( this.probeMap(), this.cp.cycle );
		this.cp.seenEvidence = this.evidence.all().map( ( e )=>e.id );
		this.cp.observeProbed = false;
		const after = this.delta.compute();
		this.stall.recordDelta( after.size );
		this.log.append( 'delta', { cycle: this.cp.cycle, size: after.size, open: after.open.map( ( o )=>o.id + ':' + o.status ), signature: after.signature } );
		if ( after.size === 0 ) return this.go( 'FINAL', 'delta is empty' );
		const s = this.stall.verdict();
		if ( s && !this.cp.failureHandled ) { this.cp.stallReason = s; return this.go( 'FAILURE', 'stall: ' + s ); }
		this.cp.failureHandled = false;
		this.go( 'ACT', 'delta ' + after.size );
	}

	async phaseACT()
	{
		const d = this.delta.compute();
		const focus = d.open.slice( 0, 12 ).map( ( o )=>this.residueView( this.graph.get( o.id ) ) );
		const ctx = { intent: this.intent.spec, delta: d, focus, satisfied: this.graph.all().filter( ( r )=>r.status === 'SATISFIED' ).map( ( r )=>r.id ), tools: this.toolCatalog(), recentActions: this.log.ofType( 'action.executed' ).slice( -8 ).map( ( e )=>e.data ), rejectedActions: this.log.ofType( 'action.rejected' ).slice( -5 ).map( ( e )=>e.data ) };
		const r = await this.ask( 'ACTION_SYNTHESIZE', ctx );
		if ( r.status === 'pending' ) return this.pending( r );
		if ( r.status === 'invalid' ) return this.invalid( r );
		return this.execute( r.result.actions, r.callId, r.result.needHuman );
	}
	execute( actions, callId, needHuman )
	{
		if ( !actions.length ) return needHuman ? this.end( 'NEEDS_HUMAN', needHuman ) : this.end( 'BLOCKED', 'the engine proposed no action for a non-empty delta' );
		const outcomes = [];
		for ( const a of actions.slice( 0, this.opts.maxActionsPerCycle ) )
		{
			const out = this.broker.execute( a, callId );
			if ( out.executed ) this.stall.recordAction( a );
			outcomes.push( { id: out.id, tool: a.tool, targets: a.targets, executed: out.executed, ok: out.ok, evidence: out.evidence && out.evidence.id, problems: out.problems, expectedEvidence: a.expectedEvidence, failureSignatures: a.failureSignatures } );
		}
		this.cp.lastActions = outcomes;
		if ( !outcomes.some( ( o )=>o.executed ) && outcomes.every( ( o )=>( o.problems || [] ).some( ( p )=>/already executed/.test( p ) ) ) ) { this.cp.stallReason = 'REPEATED_ACTION'; return this.go( 'FAILURE', 'every proposed action had already been executed' ); }
		this.cp.cycle++; this.budget.charge( 'cycles' );
		this.go( 'OBSERVE', outcomes.filter( ( o )=>o.executed ).length + ' action(s) executed; observing their consequences' );
	}

	async phaseFAILURE()
	{
		const d = this.delta.compute();
		const ctx = { intent: this.intent.spec, stall: this.cp.stallReason, delta: d, focus: d.open.slice( 0, 8 ).map( ( o )=>this.residueView( this.graph.get( o.id ) ) ), deltaHistory: this.stall.deltas.slice( -8 ), recentActions: this.log.ofType( 'action.accepted' ).slice( -6 ).map( ( e )=>e.data ), recentOutcomes: this.log.ofType( 'action.executed' ).slice( -6 ).map( ( e )=>( { ...e.data, evidence: this.evidenceView( this.evidence.get( e.data.evidence ), 1200 ) } ) ), hypotheses: this.derived.all().filter( ( c )=>c.kind === 'HYPOTHESIS' ).slice( -6 ).map( ( c )=>c.text ) };
		const r = await this.ask( 'FAILURE_ANALYZE', ctx );
		if ( r.status === 'pending' ) return this.pending( r );
		if ( r.status === 'invalid' ) return this.invalid( r );
		const f = r.result;
		this.derived.add( { kind: 'HYPOTHESIS', text: f.strategy + ': ' + f.diagnosis, engineCall: r.callId } );
		this.stall.recordHypothesis( f.diagnosis );
		this.cp.failureHandled = true;
		if ( f.strategy === 'NEED_HUMAN' ) return this.end( 'NEEDS_HUMAN', f.question || f.diagnosis );
		if ( f.strategy === 'IMPOSSIBLE' ) return this.end( 'IMPOSSIBLE_UNDER_CONSTRAINTS', f.diagnosis );
		if ( f.strategy === 'DECOMPOSE' && f.subIntents && f.subIntents.length )
		{
			this.cp.children = ( this.cp.children || [] ).concat( f.subIntents.filter( ( s )=>this.graph.get( s.residueId ) ).map( ( s, i )=>( { residueId: s.residueId, dir: 'child-' + s.residueId + '-' + ( this.cp.seq ) + '-' + i, intent: s.intent, state: null } ) ) );
			return this.go( 'CHILDREN', f.subIntents.length + ' sub-intent(s)' );
		}
		if ( f.actions && f.actions.length ) return this.execute( f.actions, r.callId, null );
		this.go( 'ACT', 'failure analysis: ' + f.strategy );
	}

	// sub-intents run as their own loop in a sub-folder; a verified SUCCESS becomes evidence for the parent residue
	async phaseCHILDREN()
	{
		for ( const c of this.cp.children || [] )
		{
			if ( c.state && [ 'SUCCESS' ].concat( TERMINAL ).includes( c.state ) ) continue;
			const child = new RunController( path.join( this.dir, c.dir ), { ...this.opts, intent: c.intent } );
			const out = await child.step();
			c.state = out.state; this.save();
			if ( out.state === 'PENDING' || out.state === 'RUNNING' ) return { ...out, child: c.dir };
			if ( out.state === 'SUCCESS' )
			{
				const report = JSON.parse( fs.readFileSync( path.join( child.dir, 'success-report.json' ), 'utf8' ) );
				this.evidence.writer.add( { origin: 'process', producedBy: 'child:' + c.dir, kind: 'child.success', tags: [ 'child:' + c.residueId ], payload: { dir: c.dir, reportHash: sha256( canonical( report ) ), residues: report.residues.length } } );
			}
		}
		this.cp.children = ( this.cp.children || [] ).filter( ( c )=>c.state !== 'SUCCESS' && !TERMINAL.includes( c.state ) );
		this.go( 'OBSERVE', 'children finished' );
	}

	// FINAL: re-verify everything from fresh probes (catches regressions), then the adversarial final pass
	async phaseFINAL()
	{
		if ( !this.cp.finalProbed )
		{
			this.runProbes(); this.reducer.applyExternal(); this.reducer.applyDeterministic( this.probeMap(), this.cp.cycle );
			this.cp.finalProbed = true; this.save();
			if ( this.delta.compute().size ) { this.cp.finalProbed = false; return this.go( 'OBSERVE', 'fresh verification reopened residues' ); }
		}
		const ctx = { intent: this.intent.spec, residues: this.graph.all().map( ( r )=>this.residueView( r ) ), evidence: this.graph.all().flatMap( ( r )=>r.evidence ).filter( ( id )=>this.evidence.has( id ) ).map( ( id )=>this.evidenceView( this.evidence.get( id ), 1600 ) ), round: this.cp.finalRounds };
		const r = await this.ask( 'FINAL_VERIFY', ctx );
		if ( r.status === 'pending' ) return this.pending( r );
		if ( r.status === 'invalid' ) return this.invalid( r );
		this.cp.finalProbed = false; this.cp.finalRounds++;
		const material = r.result.findings.filter( ( f )=>f.material );
		for ( const f of r.result.findings ) this.derived.add( { kind: 'INFERENCE', text: 'final-verify finding (' + ( f.kind || 'GAP' ) + '): ' + f.description, residueIds: f.residueId ? [ f.residueId ] : [], engineCall: r.callId, data: { material: f.material } } );
		if ( material.length )
		{
			// valid findings are investigated: new residues are added; a named residue loses its SATISFIED status
			// (reopening only ever makes the claim of success more conservative)
			this.addResidues( material.filter( ( f )=>f.residue ).map( ( f )=>f.residue ), 'final-verify', r.callId );
			for ( const f of material ) if ( f.residueId && this.graph.get( f.residueId ) && this.graph.get( f.residueId ).status === 'SATISFIED' ) this.graph.setStatus( f.residueId, 'UNKNOWN', [], 'reopened by final verification (' + r.callId + '): ' + f.description, this.log );
			if ( this.cp.finalRounds >= this.opts.maxAdversarialRounds ) return this.end( 'NEEDS_HUMAN', 'final verification keeps finding material problems' );
			return this.go( 'OBSERVE', material.length + ' material final-verify finding(s)' );
		}
		return this.gate();
	}

	// the success gate: every required residue satisfied with admissible evidence, nothing contradicted or unknown,
	// dependencies satisfied, criteria and intent unchanged. Nothing else can return SUCCESS.
	gate()
	{
		const problems = [];
		if ( this.graph.criteriaIntact().length ) problems.push( 'criteria changed: ' + this.graph.criteriaIntact().join( ', ' ) );
		if ( IntentSpec.load( path.join( this.dir, 'intent.json' ) ).hash !== this.intent.hash ) problems.push( 'intent changed' );
		const req = this.graph.required();
		if ( !req.length ) problems.push( 'no required residues' );
		for ( const r of req )
		{
			if ( r.status !== 'SATISFIED' ) problems.push( r.id + ' is ' + r.status );
			const evIds = r.evidence.filter( ( id )=>id.startsWith( 'ev_' ) );
			if ( !evIds.length ) problems.push( r.id + ' has no evidence' );
			for ( const id of evIds ) if ( !this.evidence.admissible( id ) ) problems.push( r.id + ' cites inadmissible ' + id );
			for ( const d of r.dependsOn ) if ( ( this.graph.get( d ) || {} ).status !== 'SATISFIED' ) problems.push( r.id + ' depends on unsatisfied ' + d );
		}
		if ( problems.length ) { this.log.append( 'gate.refused', { problems } ); return this.go( 'OBSERVE', 'success gate refused: ' + problems.slice( 0, 3 ).join( '; ' ) ); }
		const report = this.successReport();
		fs.writeFileSync( path.join( this.dir, 'success-report.json' ), JSON.stringify( report, null, 1 ) );
		return this.end( 'SUCCESS', 'every required residue verified; report ' + sha256( canonical( report ) ).slice( 0, 12 ) );
	}
	successReport()
	{
		return {
			intent: { hash: this.intent.hash, objective: this.intent.spec.objective },
			engine: this.engine.label,
			residues: this.graph.all().map( ( r )=>( {
				id: r.id, description: r.description, required: r.required, status: r.status, contract: r.contract.kind,
				verifiedBy: r.history[ r.history.length - 1 ].why,
				evidence: r.evidence.map( ( id )=>{ const e = this.evidence.get( id ); if ( e ) return { id, origin: e.origin, kind: e.kind, producedBy: e.producedBy, hash: e.hash, at: e.at }; const c = this.derived.get( id ); return c ? { id, derived: c.kind, text: c.text.slice( 0, 200 ) } : { id, missing: true }; } )
			} ) ),
			cycles: this.cp.cycle, engineCalls: this.budget.spent.engineCalls, actions: this.budget.spent.actions,
			eventLogHead: this.log.events[ this.log.events.length - 1 ].hash
		};
	}
	status()
	{
		const d = this.delta.compute();
		return { phase: this.cp.phase, terminal: this.cp.terminal, cycle: this.cp.cycle, engine: this.engine.label, budget: this.budget.snapshot(), delta: d, residues: this.graph.all().map( ( r )=>r.id + ' ' + r.status + ( r.required ? '' : ' (optional)' ) ) };
	}
}

module.exports = { RunController, TERMINAL };
