# Ecosystem improvement plan v2 (multi-agent)

Decisions (Paul, 2026-07-06): rules aid = **tracker + reminders** (not an
auto-applying engine); work **app + website in parallel**; **add a dev-only
headless-browser screenshot tool** (product stays zero-dependency single file).
Constraint that shapes waves: `wh40k-tabletop.html` is ONE giant file → **only
one agent edits it per wave** (disjoint-repo/disjoint-path agents run parallel).

## Work packages

### App (`wh40k-tabletop.html`) — serialized across waves
- **WP-FIGHT** — complete the Fight phase: **Fire Overwatch** (reactive shoot on
  enemy move/charge), **pile-in** (3" toward nearest enemy) and **consolidate**
  (3" post-fight) moves, and finish **Fall Back** (leave engagement, no shoot/
  charge). Build on the WP2 measure/cap + WP22 edge-distance + today's movement
  core. Reuse `wp2*` measuring, `op tok~`, phase stepper.
- **WP-RULES** — bounded rules-aid layer (tracker/reminders, NO GW effect prose):
  - **CP economy tracker**: current CP, +1 each Command phase, spend log, shared
    over P2P (reuse the CP-once-per-command hook + `logShared`).
  - **Core stratagems** (the ~12 universal 11th-ed ones: Command Re-roll,
    Counter-offensive, Epic Challenge, Insane Bravery, Grenade, Tank Shock, Fire
    Overwatch, Rapid Ingress, Go to Ground, Smokescreen, Heroic Intervention,
    Fire & Fade-type) as game-functional data only: **name + CP cost + phase**;
    click to spend (decrements CP, logs). No rules prose beyond a short label.
  - **Per-detachment / faction notes**: a user-editable stratagem/ability list
    (reuse the existing editable card-reader pattern) so faction-specific ones
    are Paul-entered, not shipped.
  - **Oath of Moment / ability reminder**: Space Marines highlight + a generic
    per-phase reminder banner surfacing what's relevant this phase.
- **WP-MOBILE** *(wave 2)* — touch/iPad audit + fixes; the Secured-toggle touch
  gap; verify the new WP-FIGHT/RULES/movement controls are reachable on touch.
- **WP-DEEPLINK-APP** *(wave 2)* — on load, parse `?import=<encoded list>` (and/
  or `?list=<name>`) and auto-run `importArmyList()`; pairs with the dashboard side.
- **WP-IMPORTFIX** *(wave 2)* — import display bug found by WP-VERIFY: after
  `importArmyList()` the Army-tab summary still shows the builder's DEFAULT
  faction/detachment ("Adepta Sororitas · Army of Faith") instead of the imported
  faction (e.g. Space Marines). Units deploy correctly (39 tokens) — only the
  summary label desyncs. Sync the builder faction/detachment display to the
  imported `fid`. (Separately: imported pts read 1485 vs listed 2000 because base
  datasheets are priced without enhancements — KNOWN limitation, note in UI, not
  a wave-2 fix unless cheap.)

### Tooling (`tools/`, new files — parallel-safe)
- **WP-VERIFY** — dev-only Playwright/Chromium screenshot harness under
  `tools/shots/` that loads `wh40k-tabletop.html` headless (clean profile, works
  even when GUI Brave is open) and captures the board in key states (deployed
  army, mid-move, rotate handle, rules panel). Documents usage. **Does NOT edit
  the app file** — drives it externally via existing DOM ids. Zero product deps.

### Website (`MetaTracker` + `MetaTracker-site` — separate repos, parallel-safe)
- **WP-SUBMIT** — community results-submission form on the dashboard: client-side
  validated inputs → a copy-paste-ready structured record **and** a `mailto:`
  (and/or "open prefilled GitHub issue") link. **No backend, no CSP relaxation**
  (default-src 'none' stays; only navigation). Removes the scraping legal risk by
  sourcing TO/community submissions instead.
- **WP-WINRATE** — schema v2 `games[]` ingestion → per-game **win rates** +
  **matchup matrix**, through `tools/build.py` (edit SOURCE `MetaTracker/app/
  index.html` + `data/` + `build.py`, then rebuild; deploy.sh mirrors). Honest-
  stats footer stays.
- **WP-DEEPLINK-SITE** — dashboard emits `?import=`/`?list=` deep links to the
  app for each placement/list; regenerate `lists.json` from real top placements
  so the app's "⟳ Fetch" tracks the live meta.

## Waves (merge order & contention)
- **Wave 1 (parallel):** Agent A = WP-FIGHT + WP-RULES (sole editor of the app
  file). Agent B = WP-VERIFY (tools/ only). Agent C = WP-SUBMIT + WP-WINRATE +
  WP-DEEPLINK-SITE (website repos only). Zero cross-contention.
- **Wave 2 (after Wave 1 app merge):** Agent D = WP-MOBILE + WP-DEEPLINK-APP
  (sole editor of the app file this wave). Then pixel-verify Waves 1–2 with the
  Agent-B screenshot tool.

## Verification gate (every app merge)
`node --check` on extracted script + both JSON blocks parse; `sh tools/tests/
run_all.sh` green incl. new per-WP suites; website: `python3 tools/build.py`
validates + injects clean. Then WP-VERIFY screenshots for a real visual pass.
Local commits only; push/deploy after Paul sees it.
