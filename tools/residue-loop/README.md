# residue-loop

A closed loop that drives work to an evidenced finish. It is built around a cognition engine (the "GEP Train" slot) that it treats as a black box.

> GEP Train owns cognition; reality owns evidence; deterministic software owns authoritative state and control;
> residue defines success; delta focuses cognition; action changes reality; verification closes the loop.

**The engine slot.** GEP Train's interface isn't available, so nothing in here guesses at its internals. Every call goes through `GEPTrainAdapter` (`src/gep.js`), and each call is schema-checked:

- a mode goes in, together with a context object;
- a JSON answer comes back, and it must match that mode's output schema.

Two engines fill the slot today:

- `MockEngine`, used by the tests and the demo;
- `FileExchangeEngine`, which writes each request to `engine/requests/<id>.json` and waits for `engine/responses/<id>.json`. Anything can answer: a person, another model, or GEP Train once it exists.

Runs started from `bin/rl.js` label their engine *"file-exchange stand-in (not GEP Train)"*, and that label shows in the event log and in the success report.

## The loop

```
intent ─► IntentSpec (immutable, hashed)
        ─► SUCCESS_COMPILE ─► residues (properties of the finished world, each with a verification contract)
        ─► ADVERSARIAL_COMPLETE × n (until nothing material is missing)
        ─► OBSERVE: controller runs every probe → EvidenceStore → reducer sets statuses → DELTA
        ─► ACT: OBSERVE_INTERPRET / ACTION_SYNTHESIZE on the delta → ActionRequests → broker vets → runtime executes
        ─► (stall) FAILURE_ANALYZE → strategy change, or a sub-intent
        ─► all required residues SATISFIED → FINAL_VERIFY (adversarial) → success gate → SuccessReport
```

## Rules the code enforces

The rules are checked by `test/invariants.test.js`:

- **The intent can't move.** `intent.json` is hashed, and a changed file stops the run.
- **Criteria can't move.** Residues can only be added. Each one keeps a hash of its criteria, and the success gate re-checks those hashes.
- **Residues are states, not steps.** A description that starts like an action ("add…", "fix…") is rejected.
- **Only the controller writes evidence.** The `EvidenceStore` is append-only and takes writes only through a capability that the engine never holds. Payloads are content-hashed.
- **Engine claims are kept apart from facts.** They go to the `DerivedKnowledgeStore` (INFERENCE, HYPOTHESIS, PLAN, REQUIREMENT, JUDGEMENT) and only when their cited evidence exists. The engine can't file a FACT.
- **Deterministic contracts decide deterministic residues.** The engine can't mark them satisfied. A semantic judgement counts only when it cites evidence from the current cycle's probes.
- **Actions pass through the broker.** It checks the schema, open targets, the tool allowlist and the risk ceiling. It also derives idempotency keys and charges the budget. Every outcome, errors included, becomes evidence.
- **The event log is hash-chained,** and a broken chain stops the run from loading. Checkpoints allow resuming after a crash.
- **Runs end in exactly one terminal state:** SUCCESS, BLOCKED, NEEDS_HUMAN, BUDGET_EXHAUSTED or IMPOSSIBLE_UNDER_CONSTRAINTS.

## Using it

```
node bin/rl.js init    runs/x --intent intent.json --config config.json
node bin/rl.js step    runs/x          # advances until it needs the engine, or ends
node bin/rl.js request runs/x          # the pending request (task, output schema, context)
node bin/rl.js answer  runs/x ans.json # the engine's answer; then step again
node bin/rl.js human   runs/x "text" --approve residue-id
node bin/rl.js status  runs/x
```

`config.json` sets:

- `root`, the sandbox the tools may touch;
- `policy.commands` and `policy.probeCommands`, the argv[0] allowlists;
- `policy.actions.maxRisk`;
- `budget`;
- `tools`, a list of extra tool modules.

`adapters/pb3x.js` adds the tools for the PB3X game:

- `pb3x.harness`: play the real game in Chromium and read the report;
- `pb3x.check`: static checks such as the level linter;
- `pb3x.image`: image metrics against a reference, for example a concept image;
- `pb3x.bake`: bake the mods into the extension;
- `file.patch` and `file.write_from`.

`demo/demo.js` runs a small end-to-end example, and `node --test test/*.test.js` runs the invariants.
