'use strict';
// Acting on reality, under control: the ToolRuntime (tools that run against the outside world and record what they
// saw as evidence), the ActionBroker (the gate: permission policy, idempotent action ids, budgets, rollback), and the
// BudgetManager / StallDetector.
const fs = require( 'fs' ), path = require( 'path' ), cp = require( 'child_process' );
const { canonical, sha256, clone, check } = require( './util' );
const { ACTION_REQUEST } = require( './gep' );

// ---------------- ToolRuntime ----------------
// Each tool: { readOnly, run(params, ctx) -> payload }. Tools never judge success: they report exactly what happened.
// Paths are confined to the sandbox root.
function inside( root, p )
{
	const abs = path.resolve( root, p );
	if ( abs !== root && !abs.startsWith( root + path.sep ) ) throw new Error( 'path escapes the sandbox: ' + p );
	return abs;
}
const TOOLS = {
	'file.read': { readOnly: true, run( p, { root } )
	{
		const abs = inside( root, p.path );
		if ( !fs.existsSync( abs ) ) return { path: p.path, exists: false };
		const buf = fs.readFileSync( abs );
		return { path: p.path, exists: true, bytes: buf.length, sha256: sha256( buf ), text: buf.length <= 262144 ? buf.toString( 'utf8' ) : null };
	} },
	'file.stat': { readOnly: true, run( p, { root } )
	{
		const abs = inside( root, p.path );
		if ( !fs.existsSync( abs ) ) return { path: p.path, exists: false };
		const st = fs.statSync( abs );
		return { path: p.path, exists: true, bytes: st.size, dir: st.isDirectory(), sha256: st.isFile() ? sha256( fs.readFileSync( abs ) ) : null };
	} },
	'file.write': { readOnly: false, run( p, { root } )
	{
		const abs = inside( root, p.path );
		const before = fs.existsSync( abs ) ? fs.readFileSync( abs ) : null;
		fs.mkdirSync( path.dirname( abs ), { recursive: true } );
		fs.writeFileSync( abs, p.content );
		return { path: p.path, wrote: Buffer.byteLength( p.content ), sha256: sha256( Buffer.from( p.content ) ), previous: before === null ? null : { sha256: sha256( before ), text: before.length <= 262144 ? before.toString( 'utf8' ) : null } };
	} },
	// a command from the allowlist (argv, no shell), run in the sandbox with a time limit
	'process.run': { readOnly: false, run( p, { root, policy } )
	{
		const argv = p.argv;
		if ( !Array.isArray( argv ) || !argv.length ) throw new Error( 'process.run needs argv' );
		if ( !policy.commands.some( ( c )=>c === argv[ 0 ] ) ) throw new Error( 'command not allowed: ' + argv[ 0 ] );
		const t0 = Date.now();
		const r = cp.spawnSync( argv[ 0 ], argv.slice( 1 ), { cwd: inside( root, p.cwd || '.' ), timeout: Math.min( p.timeoutMs || 60000, policy.maxMs ), encoding: 'utf8', env: { ...process.env, ...( p.env || {} ) }, maxBuffer: 32 * 1024 * 1024 } );
		return { argv, exitCode: r.status, signal: r.signal, timedOut: !!( r.error && r.error.code === 'ETIMEDOUT' ), error: r.error ? String( r.error.message ) : null, ms: Date.now() - t0,
			stdout: ( r.stdout || '' ).slice( -65536 ), stderr: ( r.stderr || '' ).slice( -32768 ), json: tryJson( r.stdout ) };
	} }
};
// a probe may use process.run too, when policy marks the command as observational
function tryJson( s ) { if ( !s ) return null; const t = s.trim(); const last = t.slice( t.lastIndexOf( '\n{' ) + 1 ); for ( const c of [ t, last ] ) { try { return JSON.parse( c ); } catch ( e ) { /* not json */ } } return null; }

class ToolRuntime
{
	constructor( { root, evidence, policy, extraTools = {} } )
	{
		this.root = path.resolve( root ); this.evidence = evidence;   // evidence: the writer capability
		this.policy = { commands: [], probeCommands: [], maxMs: 600000, ...policy };
		this.tools = { ...TOOLS, ...extraTools };
	}
	has( tool ) { return !!this.tools[ tool ]; }
	isReadOnly( tool, params ) { const t = this.tools[ tool ]; if ( !t ) return false; if ( t.readOnly ) return true; return tool === 'process.run' && params && Array.isArray( params.argv ) && this.policy.probeCommands.includes( params.argv[ 0 ] ); }
	// run a tool; whatever happened (including a throw) becomes evidence with this origin
	run( tool, params, { producedBy, origin = 'tool', tags = [] } )
	{
		const t = this.tools[ tool ];
		let payload, ok = true;
		try { payload = t.run( clone( params ), { root: this.root, policy: this.policy } ); }
		catch ( e ) { ok = false; payload = { error: String( e && e.message || e ) }; }
		const e = this.evidence.add( { origin, producedBy, kind: 'tool.' + tool, tags, payload: { tool, params: clone( params ), ok, result: payload } } );
		return { ok, evidence: e };
	}
}

// ---------------- BudgetManager ----------------
class BudgetManager
{
	constructor( limits = {}, spent = {} )
	{
		this.limits = { engineCalls: 200, actions: 200, cycles: 100, wallMs: 6 * 3600e3, cost: Infinity, ...limits };
		this.spent = { engineCalls: 0, actions: 0, cycles: 0, cost: 0, startedAt: Date.now(), ...spent };
	}
	charge( k, n = 1 ) { this.spent[ k ] = ( this.spent[ k ] || 0 ) + n; }
	exhausted()
	{
		for ( const k of [ 'engineCalls', 'actions', 'cycles', 'cost' ] ) if ( this.spent[ k ] >= this.limits[ k ] ) return k;
		if ( Date.now() - this.spent.startedAt >= this.limits.wallMs ) return 'wallMs';
		return null;
	}
	snapshot() { return { limits: this.limits, spent: this.spent }; }
}

// ---------------- StallDetector ----------------
// Watches the verified delta per cycle, the actions tried and the hypotheses given. Stalls: the delta hasn't shrunk for
// `window` cycles, the same action (tool+params) repeated, hypotheses cycling, or a regression (the delta grew).
class StallDetector
{
	constructor( state = {} ) { this.window = state.window || 3; this.deltas = state.deltas || []; this.actionSigs = state.actionSigs || []; this.hypotheses = state.hypotheses || []; }
	recordDelta( n ) { this.deltas.push( n ); }
	recordAction( a ) { this.actionSigs.push( sha256( canonical( { tool: a.tool, params: a.params } ) ).slice( 0, 16 ) ); }
	recordHypothesis( text ) { this.hypotheses.push( sha256( String( text ).toLowerCase().replace( /\W+/g, ' ' ).trim() ).slice( 0, 16 ) ); }
	verdict()
	{
		const d = this.deltas, w = this.window;
		if ( d.length >= 2 && d[ d.length - 1 ] > d[ d.length - 2 ] ) return 'REGRESSION';
		if ( d.length > w && d[ d.length - 1 ] >= d[ d.length - 1 - w ] ) return 'NO_PROGRESS';
		const s = this.actionSigs;
		if ( s.length >= 2 && s[ s.length - 1 ] === s[ s.length - 2 ] ) return 'REPEATED_ACTION';
		const h = this.hypotheses;
		if ( h.length >= 3 && h[ h.length - 1 ] === h[ h.length - 3 ] ) return 'HYPOTHESIS_CYCLE';
		return null;
	}
	state() { return { window: this.window, deltas: this.deltas, actionSigs: this.actionSigs, hypotheses: this.hypotheses }; }
}

// ---------------- ActionBroker ----------------
// The engine proposes; the broker decides. An action runs only if: its schema is valid, it targets open residues,
// the tool exists and isn't forbidden, risk is within the policy's ceiling (or a human approved it), the budget has
// room, and its idempotency key hasn't run before. Executing is not success: the outcome is evidence, judged later.
class ActionBroker
{
	constructor( { runtime, graph, log, budget, policy = {}, done = [] } )
	{
		this.runtime = runtime; this.graph = graph; this.log = log; this.budget = budget;
		this.policy = { maxRisk: 'medium', forbiddenTools: [], approved: [], ...policy };
		this.done = new Set( done );
	}
	key( a ) { return 'act_' + sha256( canonical( { tool: a.tool, params: a.params, targets: [ ...a.targets ].sort() } ) ).slice( 0, 20 ); }
	vet( a )
	{
		const problems = check( ACTION_REQUEST, a, 'action' );
		if ( problems.length ) return problems;
		for ( const t of a.targets ) { const r = this.graph.get( t ); if ( !r ) problems.push( 'targets unknown residue ' + t ); else if ( r.status === 'SATISFIED' ) problems.push( 'targets already-satisfied residue ' + t ); }
		if ( !this.runtime.has( a.tool ) ) problems.push( 'no such tool ' + a.tool );
		if ( this.policy.forbiddenTools.includes( a.tool ) ) problems.push( 'tool forbidden by policy: ' + a.tool );
		const rank = { low: 0, medium: 1, high: 2 };
		const id = this.key( a );
		if ( rank[ a.risk ] > rank[ this.policy.maxRisk ] && !this.policy.approved.includes( id ) ) problems.push( 'risk ' + a.risk + ' above the ceiling (' + this.policy.maxRisk + ') without human approval of ' + id );
		if ( this.done.has( id ) ) problems.push( 'already executed (idempotency key ' + id + ')' );
		if ( this.budget.exhausted() ) problems.push( 'budget exhausted: ' + this.budget.exhausted() );
		return problems;
	}
	execute( a, engineCall )
	{
		const id = this.key( a );
		const problems = this.vet( a );
		if ( problems.length ) { this.log.append( 'action.rejected', { id, tool: a.tool, targets: a.targets, problems, engineCall } ); return { id, executed: false, problems }; }
		this.log.append( 'action.accepted', { id, tool: a.tool, params: a.params, targets: a.targets, predictedEffect: a.predictedEffect, expectedEvidence: a.expectedEvidence, failureSignatures: a.failureSignatures, risk: a.risk, engineCall } );
		this.budget.charge( 'actions' ); if ( a.cost ) this.budget.charge( 'cost', a.cost );
		const out = this.runtime.run( a.tool, a.params, { producedBy: id, origin: 'tool', tags: [ 'action', ...a.targets.map( ( t )=>'target:' + t ) ] } );
		this.done.add( id );
		// the outcome is recorded as it was, failed or not; nothing here says the residues moved
		this.log.append( 'action.executed', { id, ok: out.ok, evidence: out.evidence.id } );
		return { id, executed: true, ok: out.ok, evidence: out.evidence };
	}
}

module.exports = { ToolRuntime, ActionBroker, BudgetManager, StallDetector, TOOLS, inside };
