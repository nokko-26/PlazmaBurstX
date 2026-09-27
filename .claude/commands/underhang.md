---
description: Continue the CS Coastal Tower — Underhang build (measure, assets, next level, screenshots)
argument-hint: "[what to do next, e.g. 'level 03' or 'redo skies']"
---
Continue the CS Coastal Tower: Underhang build from `docs/cs-coastal-tower/PLAN.md` on the `cs-coastal-tower` branch (check it out and pull first). The plan is approved, including the `cs-skies` mod. Packaging: mod source in `mods/*.user.js`, baked into `pb3x-extension/pb3x.js` with `node tools/bake-mods.js`.

1. Check `https://www.plazmaburst.net/` is reachable (`curl -sS -o /dev/null -w "%{http_code}"`). If the proxy refuses it (403), tell me the environment's Network access must be Full and stop.
2. Run the game in Chromium with the extension loaded (Playwright persistent context, `--disable-extensions-except` / `--load-extension` pointing at `pb3x-extension`, under `xvfb-run`). Don't run `playwright install`.
3. Pick up where the work stopped: if `docs/cs-coastal-tower/metrics.md` doesn't exist, do the step 0 measurements first; then download the skies/textures/sounds (licence-safe only, logged in `CREDITS.md`); then the next unbuilt level in the plan's table.
4. Each level: build → play → screenshots from at least four angles into `docs/cs-coastal-tower/shots/` → fix → repeat until it passes the plan's checklist. Show me the screenshots after each level.
5. Commit and push to `cs-coastal-tower` after each finished piece (never to `main`).

Extra instructions for this run: $ARGUMENTS
