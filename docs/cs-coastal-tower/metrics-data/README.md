# Phase 0 raw data

What `metrics.md` was measured from, written by `tools/harness/phase0/`:

| File | Written by | What it holds |
|---|---|---|
| `bare.json`, `rifle.json` | `run.js` | Per-frame samples of each run: `[ t, x, y, vx, vy, top, bot, hea, air ]`, in game px (y down) and game seconds. Also the ledge, gap and fall outcomes. |
| `summary.json` | `analyze.js` | The numbers in `metrics.md` § 1, computed from the two files above. |
| `vehicles.json` | `vehicles.js` | Each vehicle's settled collision outline, plus the mod's spec numbers. |
| `skins.json` | `skins.js` | The skin line-ups. |
| `swim-exit-rifle.json` | `swim-exit.js` | Climbing out of water onto walls 0–160 px high, and swimming up from 600 px down. |
