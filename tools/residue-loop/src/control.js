'use strict';
// Authoritative state and control.
//   StateReducer — the only code that changes a residue's status. Deterministic contracts are judged here, from probe
//                  evidence; engine proposals are admitted only when their cited evidence exists, is admissible, and
//                  the contract allows that kind of change.
//   DeltaEngine  — DELTA = desired residue state − verified current state.
const { assertOne, probesOf, probeKey } = require( './model' );
const { getPath, sha256, canonical } = require( './util' );

class StateReducer
{
	constructor( { graph, evidence, derived, log } ) { this.graph = graph; this.evidence = evidence; this.derived = derived; this.log = log; }

	// evaluate a contract against the freshest probe evidence (probeEvidence: probeKey -> evidence)
	evaluate( contract, probeEvidence )
	{
		if ( contract.kind === 'all' )
		{
			const parts = contract.contracts.map( ( c )=>this.evaluate( c, probeEvidence ) );
			const ids = parts.flatMap( ( p )=>p.evidence );
			if ( parts.some( ( p )=>p.result === 'FAIL' ) ) return { result: 'FAIL', evidence: ids, detail: parts.map( ( p )=>p.detail ).join( ' | ' ) };
			if ( parts.some( ( p )=>p.result !== 'PASS' ) ) return { result: parts.find( ( p )=>p.result !== 'PASS' ).result, evidence: ids, detail: parts.map( ( p )=>p.detail ).join( ' | ' ) };
			return { result: 'PASS', evidence: ids, detail: 'all ' + parts.length + ' passed' };
		}
		if ( contract.kind !== 'check' ) return { result: 'EXTERNAL', evidence: [], detail: contract.kind + ' contract: decided by its own evidence' };
		const ev = probeEvidence.get( probeKey( contract.probe ) );
		if ( !ev ) return { result: 'UNKNOWN', evidence: [], detail: 'probe not run' };
		const p = this.evidence.payloadOf( ev );
		if ( !p.ok ) return { result: 'UNKNOWN', evidence: [ ev.id ], detail: 'probe failed: ' + ( p.result && p.result.error ) };
		let failed;
		try { failed = contract.asserts.filter( ( a )=>!assertOne( a, p.result, getPath ) ); }
		catch ( e ) { return { result: 'UNKNOWN', evidence: [ ev.id ], detail: 'contract could not be evaluated: ' + e.message }; }
		if ( failed.length ) return { result: 'FAIL', evidence: [ ev.id ], detail: 'failed ' + failed.map( ( a )=>( a.path || '$' ) + ' ' + a.op + ' ' + JSON.stringify( a.value ) + ' (got ' + JSON.stringify( getPath( p.result, a.path ) )?.slice( 0, 80 ) + ')' ).join( '; ' ) };
		return { result: 'PASS', evidence: [ ev.id ], detail: contract.asserts.length + ' assertion(s) held' };
	}

	isDeterministic( contract ) { return contract.kind === 'check' || ( contract.kind === 'all' && contract.contracts.every( ( c )=>this.isDeterministic( c ) ) ); }

	// the deterministic pass: every residue with a mechanical contract gets its status straight from the evidence.
	// A SATISFIED residue whose check now fails is reopened as CONTRADICTED (a regression).
	applyDeterministic( probeEvidence, cycle )
	{
		const changes = [];
		for ( const r of this.graph.all() )
		{
			if ( r.status === 'INVALIDATED' || !this.isDeterministic( r.contract ) ) continue;
			const v = this.evaluate( r.contract, probeEvidence );
			const to = v.result === 'PASS' ? 'SATISFIED' : v.result === 'FAIL' ? 'CONTRADICTED' : 'UNKNOWN';
			if ( to !== r.status || v.evidence.join() !== r.evidence.join() )
			{
				const why = ( r.status === 'SATISFIED' && to !== 'SATISFIED' ? 'REGRESSION: ' : '' ) + 'contract ' + v.result + ' (cycle ' + cycle + '): ' + v.detail;
				this.graph.setStatus( r.id, to, v.evidence, why, this.log );
				changes.push( { id: r.id, to, why } );
			}
		}
		return changes;
	}

	// engine proposals: transitions and semantic judgements. Returns { accepted, rejected }.
	applyProposals( { transitions = [], judgements = [], claims = [] }, { engineCall, probeEvidence } )
	{
		const accepted = [], rejected = [];
		const reject = ( what, why )=>{ rejected.push( { what, why } ); this.log.append( 'proposal.rejected', { engineCall, what, why } ); };
		const citesOk = ( ids )=>{ if ( !ids.length ) return 'cites no evidence'; const miss = ids.filter( ( id )=>!this.evidence.has( id ) ); if ( miss.length ) return 'cites evidence that does not exist: ' + miss.join( ', ' ); const bad = ids.filter( ( id )=>!this.evidence.admissible( id ) ); if ( bad.length ) return 'cites inadmissible evidence: ' + bad.join( ', ' ); return null; };
		// claims go to derived knowledge (never evidence), and only when what they cite exists
		for ( const c of claims )
		{
			if ( c.cites.length ) { const bad = citesOk( c.cites ); if ( bad ) { reject( { claim: c.text.slice( 0, 80 ) }, bad ); continue; } }
			this.derived.add( { kind: c.kind, text: c.text, cites: c.cites, residueIds: c.residueIds || [], engineCall } );
		}
		// semantic judgements: a PASS citing this cycle's probe evidence for that residue is what satisfies it
		const judged = new Map();
		for ( const j of judgements )
		{
			const r = this.graph.get( j.residueId );
			if ( !r ) { reject( j, 'unknown residue' ); continue; }
			if ( r.contract.kind !== 'semantic' ) { reject( j, 'judgements only decide semantic contracts; ' + r.id + ' is ' + r.contract.kind ); continue; }
			const bad = citesOk( j.evidenceIds ); if ( bad ) { reject( j, bad ); continue; }
			const fresh = probeEvidence.get( probeKey( r.contract.probe ) );
			if ( !fresh || !j.evidenceIds.includes( fresh.id ) ) { reject( j, 'does not cite this cycle\'s probe evidence for ' + r.id + ( fresh ? ' (' + fresh.id + ')' : ' (probe not run)' ) ); continue; }
			const claim = this.derived.add( { kind: 'JUDGEMENT', text: j.verdict + ': ' + j.reason, cites: j.evidenceIds, residueIds: [ r.id ], engineCall, data: { verdict: j.verdict } } );
			judged.set( r.id, true );
			const to = j.verdict === 'PASS' ? 'SATISFIED' : j.verdict === 'FAIL' ? 'CONTRADICTED' : 'UNKNOWN';
			const why = ( r.status === 'SATISFIED' && to !== 'SATISFIED' ? 'REGRESSION: ' : '' ) + 'semantic judgement ' + j.verdict + ' (' + claim.id + '): ' + j.reason;
			this.graph.setStatus( r.id, to, [ ...j.evidenceIds, claim.id ], why, this.log );
			accepted.push( { id: r.id, to, via: 'judgement' } );
		}
		for ( const t of transitions )
		{
			const r = this.graph.get( t.residueId );
			if ( !r ) { reject( t, 'unknown residue' ); continue; }
			const bad = citesOk( t.evidenceIds ); if ( bad ) { reject( t, bad ); continue; }
			if ( t.to === 'INVALIDATED' ) { reject( t, 'only a human can invalidate a residue' ); continue; }
			if ( t.to === 'SATISFIED' ) { reject( t, r.contract.kind === 'semantic' ? 'semantic residues are satisfied by a judgement citing the probe evidence, not a transition' : 'SATISFIED is decided by the ' + r.contract.kind + ' contract, not by the engine' ); continue; }
			if ( this.isDeterministic( r.contract ) && t.to !== 'CONTRADICTED' ) { reject( t, 'deterministic residue ' + r.id + ': its status comes from its check (only CONTRADICTED may be proposed, which the check must then confirm)' ); continue; }
			if ( judged.has( r.id ) ) continue;
			this.graph.setStatus( r.id, t.to, t.evidenceIds, 'engine proposal (' + engineCall + '): ' + t.reason, this.log );
			accepted.push( { id: r.id, to: t.to, via: 'transition' } );
		}
		this.log.append( 'proposals', { engineCall, accepted: accepted.length, rejected: rejected.length } );
		return { accepted, rejected };
	}

	// human approvals and child-run successes: evidence the controller or a human produced
	applyExternal()
	{
		for ( const r of this.graph.all() )
		{
			if ( r.status === 'SATISFIED' || r.status === 'INVALIDATED' ) continue;
			if ( r.contract.kind === 'human' )
			{
				const ev = this.evidence.all().filter( ( e )=>e.origin === 'human' && e.tags.includes( 'approve:' + r.id ) ).pop();
				if ( ev ) this.graph.setStatus( r.id, 'SATISFIED', [ ev.id ], 'approved by a human (' + ev.id + ')', this.log );
			}
			if ( r.contract.kind === 'child' )
			{
				const ev = this.evidence.all().filter( ( e )=>e.kind === 'child.success' && e.tags.includes( 'child:' + r.id ) ).pop();
				if ( ev ) this.graph.setStatus( r.id, 'SATISFIED', [ ev.id ], 'child run succeeded (' + ev.id + ')', this.log );
			}
		}
	}
}

class DeltaEngine
{
	constructor( graph ) { this.graph = graph; }
	// the open required residues, most urgent first; `actionable` = their dependencies are satisfied
	compute()
	{
		const open = this.graph.required().filter( ( r )=>r.status !== 'SATISFIED' );
		const sat = ( id )=>{ const r = this.graph.get( id ); return r && r.status === 'SATISFIED'; };
		const rows = open.map( ( r )=>( { id: r.id, status: r.status, priority: r.priority, actionable: r.dependsOn.every( sat ), blockedBy: r.dependsOn.filter( ( d )=>!sat( d ) ) } ) );
		rows.sort( ( a, b )=>( b.actionable - a.actionable ) || ( b.priority - a.priority ) || a.id.localeCompare( b.id ) );
		return { size: rows.length, open: rows, contradicted: rows.filter( ( r )=>r.status === 'CONTRADICTED' ).map( ( r )=>r.id ), signature: sha256( canonical( rows.map( ( r )=>[ r.id, r.status ] ) ) ).slice( 0, 12 ) };
	}
}

module.exports = { StateReducer, DeltaEngine, probesOf, probeKey };
