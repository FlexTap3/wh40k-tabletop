# WH40k Tabletop — Implementation Plan v1

A work plan for turning `wh40k-tabletop.html` from a shared whiteboard-with-a-calculator
into an app that can genuinely referee a game of Warhammer 40,000 (11th edition).
Written to be executed by multiple independent agents who have NOT seen the
conversation that produced this app. Read this whole file before touching code.

---

## 1. What this app is

A **single self-contained HTML file** (`wh40k-tabletop.html`, ~1.4 MB) implementing a
peer-to-peer virtual tabletop for two players:

- **Board**: canvas-rendered battlefield (default 60"×44"), per-model tokens at true
  base sizes, terrain rectangles, objective markers, deployment-zone polygons,
  tape measure, range rings, unit-coherency checking with snap-back.
- **Data**: an embedded JSON unit database (all 25 factions, 1,710 datasheets:
  profiles, weapons, points, base sizes, wargear option lines, keywords, detachment
  names, enhancement names+costs) built from Wahapedia's machine-readable CSV export
  by `tools/build_db.py`. Also 47 embedded terrain layouts (45 official Event
  Companion maps + 2 custom) with objectives, DZs, and mission names.
- **Play aids**: full-screen army builder (points, sizes, detachments, enhancements,
  wargear notes), army-list text import/export, Army quick-reference tab, 11th-ed
  attack-sequence dice roller, battle-shock roller, VP/CP/round trackers, secondary
  card deck (draw/discard/shared hands, user-supplied card text), shared log + chat.
- **Netcode**: PeerJS (WebRTC). Host creates room `wh40k-XXXXX`; guest joins by code.
  All mutations flow through a small op protocol (see §2.3).

### 1.1 Non-negotiable invariants — breaking these fails review

1. **Single file.** The app must remain one `.html` file a player can email. No build
   step for the app itself (the Python tool only re-injects data). No external
   requests at runtime except the PeerJS CDN script + PeerJS cloud signalling.
2. **Copyright line.** The file may contain game-functional data only: names, stat
   numbers, points, base sizes, weapon profiles, ability identifiers, option lines,
   keywords, detachment/enhancement names+costs, layout geometry. It must NEVER
   contain Games Workshop rules paragraphs, lore text, or mission-card scoring prose.
   User-pasted text (card reader, wargear notes) is fine — the user supplies it.
3. **Both peers converge.** Any new mutable state must (a) live in `state`, (b) be
   mutated only via `applyOp`, (c) survive `{t:"state"}` full-sync on join, and
   (d) default sanely when absent (older saves load fine).
4. **Backwards-compatible saves.** `saveGame()`/`loadGame()` round-trips `state` as
   JSON; localStorage holds roster/army/deck/cardtext. Never rename existing fields;
   only add, with fallbacks.
5. **Verify before done.** See §5 verification protocol. `node --check` on the
   extracted script is mandatory; the two-window P2P smoke test is mandatory for
   anything touching state/ops/rendering.

---

## 2. Architecture map (function/anchor index)

All code is in `wh40k-tabletop.html`. Sections appear in this order:

| Section | Anchors (search strings) |
|---|---|
| CSS | `:root{`, `#builderOverlay`, `.bCard` |
| Top bar / trackers HTML | `id="topbar"`, `stepTracker` |
| Sidebar tabs HTML | `id="tabs"`, panes `tab-army`, `tab-cards`, `tab-attack`, `tab-setup` |
| Builder overlay HTML | `id="builderOverlay"` |
| Dialogs | `unitDlg`, `bulkDlg`, `cardDlg`, `secDeckDlg`, `wgDlg`, `listDlg`, `helpDlg` |
| Embedded data | `<script id="layouts40k-data">` (47 layouts), `<script id="db40k-data">` (unit DB) |
| State & net | `let state =`, `hostGame`, `joinPrompt`, `wireConn`, `onMsg`, `function op(`, `applyOp` |
| Log/dice | `logShared`, `quickRoll`, `rollLeadership`, `parseDice`, `rollAttack` |
| Unit DB helpers | `let DB=`, `norm`, `baseFrom`, `weaponLines`, `profilesFromDb`, `addFromDb`, `matchUnit`, `importArmyList` |
| Layouts | `let LAYOUTS=`, `populateLayouts`, `loadLayout`, `layoutPdfPage` |
| Cards/secondaries | `DEFAULT_SEC`, `CARD_SUMMARY`, `renderCards`, `renderScore`, `drawSecondary`, `openCardReader`, `bulkImportCards` |
| Army cards | `migrateCard`, `openUnitEditor`, `saveUnitCard`, `renderArmy`, `deployUnit`, `deployCard` |
| Builder | `myList`, `bInit`, `bPopDet`, `renderBrowser`, `renderRoster`, `bItemInfo`, `bEnhance`, `bWargear`, `bToGame`, `bExportText` |
| Board render | `function draw()`, `checkCoherency`, `drawRuler`, `TERR_ORDER` |
| Input | `cv.addEventListener("mousedown"`, `"mousemove"`, `"mouseup"`, `"dblclick"`, `window.addEventListener("keydown"` |
| Init | `populateFactions(); populateLayouts(); bInit();` |

### 2.1 `state` shape (synced)

```js
state = {
  board:{w,h},                       // inches
  tokens:[{id,owner:1|2,unit,name,shape:'c'|'r',dmm|wIn+hIn,x,y,rot,wounds,maxW,sgt?,tag?}],
  terrain:[{id,kind,x,y,w,h,rot,locked?}],   // kind: ruin|wood|crate (dense, enterable*), wall (light), crater (exposed)
  objectives:[{id,x,y}],             // 40mm markers
  dz:[redPoly,bluePoly],             // arrays of [x,y] inches
  sec:[{id,owner,name}],             // drawn secondary cards
  mission:{name,m}|null,             // loaded layout name + mission names "A / B"
  trackers:{round,cp1,cp2,vp1,vp2},
  names:{1,2},
}
```
Local-only (NOT synced): `myArmy` (unit cards), `myList` (builder roster), `secDeck`,
`cardText` (partially synced via `cardtext` op), `mySide`, `myName`, `view`, `sel`.

### 2.2 Token geometry

Coordinates are in **inches**; `view={x,y,s}` maps to pixels (`s` = px/inch).
`tokRadius(t)`, `edgeDist(a,b)` exist for coherency. `mmIn(mm)` converts base mm.
Rect tokens rotate about center; badges un-rotate before drawing.

### 2.3 Op protocol

`op(o)` = `applyOp(o, mine=true)` → applies locally then `send({t:"op",op:o})`.
Existing kinds: `tok+ tok~ tok- ter+ ter~ ter- obj+ obj- dz mission sec+ sec- cardtext
track name board clear`. Add new kinds in `applyOp`'s switch; keep them idempotent
(replace-by-id). On guest connect, host sends `{t:"state", state}` — anything not in
`state` will NOT reach the guest.

### 2.4 Unit DB shape (embedded JSON, id `db40k-data`)

```js
DB = { factions:[[id,name]...],
       det:{fid:[names]}, enh:{fid:[{n,c,d}]},
       units:{fid:[{n,r,m:[{n,M,T,Sv,iv,W,Ld,OC,b}],w:[[name,rng,'R'|'M',A,BS,S,AP,D,abilities]],
                    c:[compLines], p:[[sizeDesc,cost]], o:[optionLines], k:[KEYWORDS]}]} }
```
`k` is a whitelisted keyword list (INFANTRY, VEHICLE, MONSTER, CHARACTER, FLY,
TITANIC, TOWERING, SMOKE, GRENADES/EXPLOSIVES, etc.) — added specifically for the
work below. Rebuild/refresh with `python3 tools/build_db.py` (uses curl; `--no-dl`
reuses `tools/csv/`).

### 2.5 Known quirks (don't "discover" these as bugs)

- Layout terrain/objectives are eyeball-traced from the Event Companion diagrams,
  accurate to ~±1". Do not "fix" positions to look nicer — fidelity beats tidiness.
- Terrain rects legitimately overlap: light walls sit ON dense footprints (that's
  how the official maps work). Draw order handles it (`TERR_ORDER`).
- `addFromDb(fid, idx, forcedSize, quiet)` returns the card AND pushes to `myArmy`.
- Both players can currently claim the same side; nothing prevents it (see WP8).
- The Edit-your-own-deck / card-reader text is user-supplied; never seed it with
  official card prose.
- `sgt` (squad leader) detection = minority profile in a multi-profile unit. Known
  imperfect; acceptable.

---

## 3. Reassessment (what changed since the last review)

1. **Line of sight is 2D, not 3D.** 11th edition visibility is *area-based*
   (Core Rules 13.07–13.11): models aren't visible if **every** sight line between
   them crosses an obscuring terrain **area** (any area containing light/dense
   features), excluding areas either model is inside. The Solid rule and Hidden
   (15" detection for quiet infantry in dense areas) are also area/keyword tests.
   All of it is segment-vs-rectangle math on data the app already has. LoS therefore
   moves from "hardest, maybe never" to **WP4, very buildable** — and it's the
   prerequisite that makes terrain verticality/collision *meaningful*.
2. **Resilience was underweighted.** A dropped WebRTC link currently loses the game
   session; there's no autosave, no undo. For two brothers mid-game this is worse
   than any missing rule. Promoted into WP1 (foundations).
3. **The build pipeline was ephemeral** (lived in a session scratchpad). Now checked
   in as `tools/build_db.py` + `tools/csv/`. The layout data pipeline is documented
   as "already embedded; edit JSON in place if ever needed."
4. **Tokens must carry stats.** Nearly every feature below (move caps, OC totals,
   LoS keywords, inspector) needs M/OC/keywords ON the token. That's the true WP0.

---

## 4. Work packages

Sizes: S (≤½ day), M (~1 day), L (2–3 days) for one focused agent.
"Anchor" = where to start reading/editing.

### WP0 — Foundations: stat-bearing tokens + repo hygiene  [M] — BLOCKS EVERYTHING
- **Git**: `git init` in `~/WH40k/Tabletop` (if not already), commit current file as
  baseline, one branch per WP, PR-style merges. The app being one file means merge
  conflicts are the main coordination risk — see §5.
- **Tokens carry stats.** In `deployCard`, stamp each token with its profile's
  gameplay stats: `Mv` (parse `6"` → 6, `-` → 0), `OC` (int), `T`, `Sv`, `iv`, and
  `kw` (the card's DB keywords — pass them through `addFromDb`→card→`deployCard`;
  store card-level `kw` on the card in `addFromDb` from `u.k`). Manual-card path
  (`migrateCard`) defaults: `kw:[]`, numbers parsed from profile fields.
- **Card sync.** New op `cards` `{k:"cards",owner,cards:[...]}` broadcast on muster/
  import so the opponent can inspect your units (WP3). Store in `state.cards={1:[],2:[]}`
  (add to initial state + `clear` + join sync). Keep it display-only.
- **Back-compat**: tokens without stats must not crash anything (`??` fallbacks).
- **Acceptance**: deploy Boyz → tokens have `Mv:6, OC:2, kw:["BATTLELINE","GRENADES","INFANTRY"]`;
  old saved games still load; two-window sync test passes; git history exists.

### WP1 — Resilience: autosave, restore, reconnect, undo  [M] — parallel-safe after WP0
- **Autosave**: debounce-write `state` to `localStorage("wh40k_autosave")` after every
  `applyOp`. On startup, if an autosave exists and is non-trivial, offer "Resume last
  game?" (host side restores + re-syncs on next join).
- **Reconnect**: on `conn` close, show a "Reconnect" button; host re-hosts under the
  SAME room code (persist the code for the session); guest retries join. On success
  host re-sends full state.
- **Undo**: ring buffer (depth ~30) of `JSON.stringify(state)` snapshots taken before
  each *local* op batch; `Ctrl/Cmd+Z` restores previous snapshot **and broadcasts a
  full `{t:"op",op:{k:"restore",state}}`** (new op kind) so peers converge. Undo is
  host-authoritative if both attempt simultaneously (last-write-wins is acceptable).
- **Acceptance**: kill one window mid-game → reopen → resume + reconnect works;
  Ctrl+Z reverts a deletion on BOTH screens; autosave adds no visible lag (measure
  with 300 tokens).

### WP2 — Live move measurement  [M] — needs WP0
- While dragging tokens (`drag.mode==="tokens"`), render a badge near the cursor:
  `X.X" / M"` where distance = **cumulative path length** (sample the drag path,
  sum segments, ignore micro-jitter < 0.05"), M = max `Mv` among dragged tokens'
  *minimum*… no: show per the dragged unit's `Mv` (all same unit normally; if mixed
  selection, show the lowest `Mv` and note `+`).
- Color: text ≤ M white; > M yellow (advance territory: show `M + D6?`); > M+6 red.
- Draw a faint path polyline during the drag; clear on drop.
- **Optional strict mode** checkbox next to coherency in Setup: "Enforce movement
  caps" — on drop beyond M+6, snap back (reuse the coherency snapback pattern:
  `drag.snap` already exists). Beyond M but ≤ M+6, never block (advances are legal);
  just log "moved X" — advance?".
- Ruler broadcast already exists (`{t:"ruler"}`); reuse its style for the badge.
- **Acceptance**: dragging a 6" Move unit 8.3" shows yellow `8.3" / 6"`; strict mode
  snaps back a 14" drag; opponent sees your drag path via the existing ruler channel
  or a new transient `movepath` message; group drags show one badge.

### WP3 — Unit inspector + wired attack tool  [L] — needs WP0
- **Inspector**: single-click selecting a token shows a compact floating panel
  (bottom-right of board): unit name, profile line(s), weapon table, wounds,
  enhancement/notes — sourced from `myArmy` for your units and `state.cards[opp]`
  for the opponent's. Close on deselect/Esc. Do NOT open on drag (only on click
  without movement).
- **Wired attack flow**: in the inspector, each RANGED/MELEE weapon row gets a ⚔
  button → enters "targeting" mode → click an enemy token → the Attack tab is
  pre-filled: A/BS/S/AP/D + abilities parsed from the weapon's ability string
  (`rapid fire X`→checkbox+X, `twin-linked`, `lethal hits`, `sustained hits X`,
  `devastating wounds`, `anti-x Y+`, `torrent`→BS auto, `blast`→+attacks per 5
  models in target unit — count target unit's models from `state.tokens`), and
  the target side filled from the target's `T`, `Sv`, `iv`. Switch to Attack tab
  with everything staged; user just clicks roll. Log line includes attacker/target
  unit names.
- Range sanity hint: show distance between closest models of the two units next to
  the weapon's range (green in range / red out) — pure info, don't block.
- **Acceptance**: full flow (click Intercessor → ⚔ bolt rifle → click Boyz → roll)
  produces a correctly pre-filled sequence incl. rapid-fire at half range prompt;
  opponent inspecting your unit sees the same card; no regression to manual entry.

### WP4 — Visibility & cover (11th-ed area rules)  [L] — needs WP0; unlocks WP5
- **Model**: each terrain feature is an obscuring "terrain area" if kind ∈
  {ruin, wood, crate, wall}; crater = exposed (never obscures). A model is "inside"
  an area if its center is within the (rotated) rect.
- **Visible(a,b)**: sample sight lines between model hulls (center-to-center plus
  center-to-4-cardinal-edge-points both ways is sufficient); the pair is NOT visible
  iff **every** sampled line crosses ≥1 obscuring rect, excluding rects containing
  a or b. Segment-vs-rotated-rect intersection helper required (write it pure +
  unit-test it in node, see §5).
- **Unit-level**: unit B visible to model a if any model in B visible. "Fully
  visible" (for Benefit of Cover): every sampled sight line to every model in B is
  unobstructed AND target models outside terrain areas… implement the practical
  subset: cover if (target INFANTRY/BEASTS/SWARM by `kw` and center inside any
  terrain area) OR (any sampled line to it crosses an obscuring rect that doesn't
  fully block). Document the approximation in the help dialog.
- **Hidden**: toggleable badge (key `H`) on units, auto-suggested when all its
  INFANTRY models are inside a dense-feature area; while hidden, LoS tool reports
  "not visible beyond 15"" for it. (Automatic shot-tracking is out of scope.)
- **UI**: new toolbar tool 👁: click your unit → live lines to each enemy unit:
  green (visible, no cover), yellow (visible, cover), red (not visible). Feed the
  cover result into WP3's staged attack (cover = −1 BS worsen, i.e. hit-mod −1).
- **Acceptance**: node unit tests for the geometry helper (10+ cases incl. rotated
  rects, model-inside-area exclusion); on Official layout 1A, a unit behind the
  central ruin is red to a unit across it and yellow when peeking; performance:
  full-army LoS scan < 16ms with 200 models (precompute per-terrain edge lists).

### WP5 — Terrain physicality: collision + floors  [M] — needs WP4's geometry helper
- **Collision**: on move end (drop / deploy / paste), a token may not END overlapping
  a `wall` or `crate` rect, or the enclosed footprint of a `ruin` **unless** it has
  INFANTRY/BEASTS/SWARM in `kw` (they enter ruins; nothing enters walls/crates).
  Violations snap back with a log line (reuse strict-move pattern; respects the
  same Setup toggle).
- **Floors**: tokens get `lvl` (0–3), cycled with key `F` when selected; render a
  small `▲2` badge. Changing level adds 3" per level to WP2's measured distance for
  that drag (batched: prompt-free — pressing F mid-drag adjusts the badge). Only
  allowed while inside a ruin area and only for INFANTRY/BEASTS/SWARM/FLY `kw`.
  Plunging Fire hint: WP3 inspector shows "+1 BS (Plunging Fire)" suggestion when
  attacker `lvl≥1` (≥3" up) and target `lvl===0`.
- LoS interaction (approximation, document it): a model at `lvl≥1` ignores
  obscuring rects whose kind is `wall` (low light terrain) for outgoing lines.
- **Acceptance**: a tank cannot end on a wall and snaps back; a Boy can stand in a
  ruin at L2 with the badge; moving up 2 floors adds 6" to the move readout.

### WP6 — Objective control auto-scoring  [S–M] — needs WP0
- After every op that moves/removes tokens (cheap: recompute in `draw()` like
  coherency), for each objective: sum `OC` of each side's models within 3"
  (edge-of-marker to base edge, horizontal). Battle-shocked units: add token/unit
  flag `bs` (key `B` toggles, shown as grey skull badge) → OC counts as 0.
- Render: objective ring glows owner color; small `8–5` tally beside it. "Secured"
  (sticky control) as a manual right-click/keyboard toggle per objective for
  factions with secure abilities.
- Cards tab primary panel lists each objective + holder; end-of-turn log line
  ("End of turn: Red holds 3, Blue holds 1") when the round tracker changes.
- **Acceptance**: contested objective shows correct tallies live while dragging;
  battle-shocking a unit flips control instantly; syncs to both windows.

### WP7 — Turn/phase engine + reserves + attached units  [L] — needs WP0, ideally WP6
- **Phase stepper**: top-bar control: Round N › [Command→Movement→Shooting→Charge→
  Fight→End] with whose-turn indicator. Advancing to Command auto-+1 CP to both
  (once), logs the phase, and fires the battle-shock reminder: list friendly units
  at ≤half strength (computable: unit's live model count / wounds vs starting).
  All manual overrides still work; the stepper is a convenience, not a cage.
- **Reserves**: a tray panel (collapsible, per player) listing undeployed units;
  "→ Reserves" action on table units (removes tokens to tray, marks unit); deploying
  from tray enters placement mode that shades the LEGAL region: within 6" of edges
  & >8" from enemies (rounds 2–3; not enemy DZ before round 3), or anywhere >8" if
  the unit card notes Deep Strike (checkbox on tray entry). Uses the phase engine's
  round number.
- **Attached units**: select a CHARACTER unit + one other friendly unit → key `A` or
  inspector button "Attach" → both take the same `unit` id (store `attachedFrom` for
  detach); coherency, dragging, OC, and inspector then treat them as one. "Detach"
  restores original ids.
- **Acceptance**: full 5-round game flow with a Deep Strike arrival in round 2
  rejected at 7.5" from an enemy and accepted at 8.5"; attached Captain+Intercessors
  move as one and show a merged inspector; CP ticks up each Command phase exactly once.

### WP8 — Multiplayer & input hardening  [M] — parallel-safe anytime after WP1
- **Side claiming**: on connect, if both players have the same `mySide`, guest is
  auto-flipped + toast. Side switch broadcasts.
- **Touch/tablet**: convert mouse handlers to Pointer Events; pinch-zoom; long-press
  = right-drag pan; hit targets ≥40px for toolbar. Test on iPad Safari.
- **Spectator-safe rendering**: guard all `state.names[side]` etc. for undefined.
- **Perf pass**: `draw()` currently runs coherency O(n²) every frame — memoize per
  token-move; target 60fps with 300 tokens on an M1 MacBook + iPad.
- **Acceptance**: playable start-to-finish on an iPad paired with a laptop.

### WP9 — Polish backlog (grab-bag, any time)  [S each]
- Waypoint measuring (click while ruler-dragging to bend the tape).
- Dice log filters + per-player dice stats (fun + catches "cursed dice" arguments).
- Terrain visual upgrade: procedural ruin footprints (broken-wall outlines) instead
  of flat boxes — cosmetic only, must not move footprint geometry.
- Export game summary (rounds, VP graph, kills) as a text/HTML report.
- Keyboard cheat-sheet overlay (`?` key).
- Objective/DZ color-blind palette toggle.

### WP10 — Solo mode: AI opponent with real tactics  [L] — needs everything above
A local AI that plays side 2 so the owner can practise alone. No network: a
"⚔ Solo vs AI" button beside Host/Join enters solo mode (disabled while a peer
is connected, and vice versa). The AI is a LOCAL actor: it mutates state ONLY
via `op()`/`applyOp` (send() is a harmless no-op offline), so autosave, undo,
save/load and every overlay keep working. Marked `/* ==== WP10: ai ==== */`.

- **Setup dialog**: pick AI faction + points (500–2000). `aiBuildList(fid,pts)`
  builds a sane list greedily from DB: 1–2 CHARACTERs, 2–3 BATTLELINE units,
  1–2 heavies (VEHICLE/MONSTER), fill with infantry; respects `p` size/cost
  lines; deploys it into the side-2 DZ via the normal card path (`addFromDb` →
  `deployCard` with mySide temporarily 2 — restore afterwards). Broadcast-safe:
  `state.cards[2]` gets the AI cards so the inspector works on AI units.
- **Turn loop**: hooks WP7's phase engine. When `state.phase.side===2` in solo
  mode the AI plays its phases automatically with visible pacing (~500–800ms
  between actions, setTimeout chain; a "⏸/▶" control and a "skip" button).
  Player turns stay fully manual. AI never acts during the player's turn.
- **Tactics engine** (the point of the WP — score, don't script):
  - *Roles* per unit from stats/kw: holder (high OC INFANTRY/BATTLELINE),
    shooter (ranged dmg/pt), assassin (melee threat), screen (cheap bodies),
    support (CHARACTER — attach where legal via WP7 attach).
  - *Objective math each turn*: per objective compute my OC / their OC / dist;
    value = swing toward holding more objectives than the player at round end
    (WP6 tallies are authoritative). Assign holders/contesters greedily.
  - *Movement per unit*: candidate destinations (objective ring, cover spots
    near dest, keep-away arcs from melee threats for shooters); score =
    objective gain + expected shooting from the new spot (needs LoS via
    `losCheckUnits` semantics) + cover bonus − expected incoming threat −
    advance penalty if it forfeits shooting. Execute as a formation move
    (unit tokens keep their relative grid, clamped to coherency 2"), reject
    spots failing `wp5Illegal`, never end within 1" of enemies unless charging.
  - *Shooting*: for each weapon×target compute expected damage from the real
    ability parser semantics (rapid fire in half range, blast vs 5+, anti-X,
    torrent, twin-linked, dev wounds, lethal) × target priority (points value,
    OC threat on contested objectives, "can it hurt me back"); anti-tank goes
    to VEHICLE/MONSTER, blast to hordes. Fire via the same math `rollAttack`
    uses (real dice), log one short WHY line per action: "AI: Boyz onto Obj 3
    (OC 20 v 8)". **Auto-apply casualties in solo mode** (allocate to closest
    models, leader last) for BOTH sides' attacks — solo QoL; never in netplay.
  - *Charges*: melee units charge when expected profit (2D6 real roll vs
    distance, fail = stay); pile-in = move into base contact approximation.
  - *Command*: battle-shock tests for below-half AI units (real 2D6 vs Ld,
    sets `bs` flag); spends nothing else (stratagems out of scope, note it).
  - *Reserves*: if list has Deep Strike-capable units, hold 1 in reserve,
    arrive rounds 2–3 at the best legal spot (WP7 legality helpers).
- **Difficulty**: one good level. A single `AI_TUNE` object of weights at the
  top of the module so tuning is one place.
- **Determinism for tests**: all AI randomness through a seedable RNG
  (`aiRng`); dice stay real dice in play, but the test suite seeds both.
- **Acceptance**: `tools/tests/wp10-tests.js` in the runner — scripted solo
  game on Official 1A with a fixed seed: AI deploys legally in its DZ; over 2
  full AI turns every AI unit ends moves legally (no `wp5Illegal`, coherency
  holds), shooting only at units in range+LoS, casualties allocated correctly,
  CP ticks, battle-shock rolled when below half; a 5-round fuzz run (random
  seed) throws no exceptions and ends with a logged score line. Headless
  screenshot of mid-game solo board for the report. Help dialog gets a Solo
  section. Netplay regression: hosting/joining still works (solo button
  disabled once connected — assert in tests via the harness).

### WP11 — Solo polish: defender allocation + meta-doctrine AI  [M–L] — needs WP10
Two halves. Marked `/* ==== WP11: ... ==== */`; all mutations via `op()`.

**A. Defender allocates casualties (the actual 40k rule).** In solo mode, when an
AI attack damages the PLAYER's unit, do not auto-apply. Pause the AI action queue
(generation-safe) and enter allocation mode: a board banner shows the pending
damage packets ("Bolt rifles: 4 packets of 1 dmg — click your models to
allocate · A = auto-assign rest"); the player clicks models IN THE TARGET UNIT
to assign packets one at a time (wounds via `tok~`, slain via `tok-`).
Rules guardrail: while a model in the unit already has lost wounds, packets are
redirected there first (with a log note) — that's core allocation law. `A` key or
banner button auto-finishes (closest-first, sgt/CHARACTER last, same as WP10).
Setup toggle "Auto-apply my casualties" restores the old hands-off behaviour.
AI-owned casualties stay auto (the AI is the defender there — same rule).
Esc does NOT cancel allocation (damage is owed); undo still works after.
Cancel-safety: clear/load/undo during allocation discards the pending queue.

**B. The AI reads the meta.** Ground truth documents (read them FIRST):
`~/WH40k/Notes/11th Edition Tournament Meta - Living Notes.md`,
`~/WH40k/Army Guides/Space Marines - Iron Hands 2000pt Tournament Guide.md`,
`~/WH40k/Tabletop/Meta Practice Pack/*.txt` (5 import-verified GT lists).
- **Embedded meta armies**: bake the 5 practice-pack lists verbatim into the
  HTML as `AI_META_LISTS=[{name,blurb,fid,disposition,text}]` (unit names +
  points only — game-functional data, fine under §1.1-2). Solo dialog gains an
  opponent picker: each meta list (with a one-line "what it teaches you" blurb,
  own words) or "Auto-build" as today. Muster via the existing `importArmyList`
  path. AI announces its army + game plan in the log at muster.
- **Plan profiles** (`AI_PLANS`): weight presets over the WP10 scoring, chosen
  from the list's Force Disposition header (auto-built lists → Take and Hold):
  *Purge* = aggressive trades, kill-priority; *Take and Hold / Priority
  Assets* = objective-first, park durable OC on the deciding objectives from
  round 2, out-attrit; *Reconnaissance* = spread, board-quarter presence,
  mobility. Primary pressure is front-loaded (11th): objective weights peak
  rounds 1–3, relax late when ahead.
- **Doctrine behaviours** (each traced to the notes; comment the source line):
  1. *Hidden is premium*: after Shooting, toggle `hid` on eligible quiet
     dense-terrain INFANTRY whose expected shooting was below a threshold;
     prefer move destinations that keep fragile shooters Hidden-capable.
  2. *Screening*: when the player has reserves or fast melee, place cheap
     low-value units as a picket 6–8" in front of high-value units / the
     backfield objective to deny deep strike and charge lanes.
  3. *Stage before committing*: round 1 (and 2 if outgunned), shooters prefer
     out-of-LoS spots within next-turn threat range over open firing lanes
     when the enemy's expected return fire exceeds their own output.
  4. *Focus fire, kill units dead*: concentrate shooting to REMOVE units
     (their OC and actions) rather than spread damage; allow ~30% overkill;
     when behind on primary tallies, weight targets standing on / moving to
     contested objectives above pure damage-value targets.
  5. *Trade math*: a move that exposes a unit is only taken if objective
     swing + expected damage dealt exceeds its expected loss (don't feed).
  6. *Don't chase kiters*: never send slower melee after faster shooters that
     can retreat (compare Mv, ranged output); hold the objective and make
     them come — (Iron Hands guide, Custodes matchup).
  7. *Finish shocked-prone units*: prefer finishing below-half units that sit
     on objectives (battle-shock pressure is real tech in 11th).
- **Difficulty stays one level**; all new knobs live in `AI_TUNE`/`AI_PLANS`.
- Help dialog: Solo section gains "The AI's doctrine" — own words, no quotes
  from GW or article prose.
- **Acceptance** (`tools/tests/wp11-tests.js` in the runner): allocation flow —
  packets queue, player clicks apply, wounded-model-first enforced, auto-finish
  matches WP10 allocation, Setup toggle restores auto, AI queue provably paused
  during allocation and resumes after, clear/load discards pending; all 5
  embedded lists muster cleanly via `importArmyList` at their printed points;
  plan profile picked from disposition header; seeded scenarios: Hidden gets
  toggled on an eligible quiet unit, a screen deploys between threat and
  protected unit, focus-fire finishes a wounded unit instead of spreading onto
  a fresh one, slow melee declines to chase a faster shooter. Full
  `run_all.sh` green; §5 protocol (node --check, JSON parse); headless
  screenshot of the allocation banner mid-game.

### WP12 — Phone layout: board-first command deck  [M–L] — needs WP8/WP9/WP11
The desktop layout is untouched; phones get a dedicated re-layout. Marked
`/* ==== WP12: phone ==== */` (CSS + JS). No DOM restructuring of existing
elements — phone mode may inject its OWN elements (nav bar, peek ticker,
sheet chrome) and toggle classes, but desktop must render byte-identical.

- **Detection (auto)**: root class `phone` on `<html>` when
  (min(screen.w,screen.h) ≤ 820 AND `(pointer:coarse)`) OR UA matches
  iPhone/Android-mobile. iPads deliberately stay desktop (WP8 touch pass
  covers them). Re-evaluate on resize/orientationchange (a rotated phone is
  still a phone — key off the device, not the current viewport). Setup
  select "Layout: Auto / Desktop / Phone" persisted in localStorage
  (`wh40k_layout`), applied before first draw to avoid a flash.
- **Structure in phone mode** (all via `.phone` CSS unless noted):
  - `#topbar`: single row, `flex-wrap:nowrap; overflow-x:auto`, brand hidden,
    trackers compacted (smaller padding/font, CP/VP labels shortened via CSS
    only — no HTML edits), conn status last; safe-area top padding;
    `viewport-fit=cover` added to the existing viewport meta (additive).
  - `#toolbar`: horizontal row below the top strip, 44px targets,
    `overflow-x:auto`.
  - `#side`: fixed bottom sheet (100% width, 85dvh, `translateY` slide,
    rounded top corners, grab-handle bar + ✕). Closed by default. The
    existing `#tabs` row is hidden on phone; a phone-only injected
    `#phoneNav` (fixed bottom, safe-area bottom padding) has buttons
    Army/Cards/Attack/Setup/Log/Builder — each calls the existing
    `showTab(...)`/builder-open functions then opens/closes the sheet.
    Nav buttons show an active state; Attack nav button pulses when WP3
    stages an attack (one marked hook line in `wp3Stage`).
  - `#bottombar` (log+chat): same sheet treatment via the Log nav button;
    phone-only injected one-line peek ticker (latest log entry, tap =
    open sheet) sitting above `#phoneNav`; new log entries update it (one
    marked hook line in `logEntry`).
  - `#inspector`, `#wp7Tray`, `#wp11Banner`: full-width, bottom-anchored
    above the nav bar, max-height 55dvh, larger buttons.
  - `#boardwrap`: fills everything between top strip and nav bar; canvas
    `resize()`/`fitView()` fired on layout-mode change and sheet open/close
    ONLY if it changes boardwrap size (sheets overlay — they shouldn't).
  - `#builderOverlay`: `#bBody` single column; `#bRight` roster becomes a
    toggleable sheet ("Roster (N) · pts" button in `#bHead`); browse grid
    single column; dialogs `width:min(94vw,520px); max-height:85dvh`.
  - Global phone polish: `-webkit-tap-highlight-color:transparent`,
    `100dvh` (not vh) everywhere phone heights are set, inputs ≥16px font
    (blocks iOS zoom-on-focus), momentum scrolling in sheets.
- **JS behaviours** (`wp12Detect`, `wp12Apply`, `wp12Nav`, `wp12Peek`,
  `wp12Sheet(open/close)`): tiny, no game logic; everything gated on the
  `phone` class; all injected elements created once at init, `display:none`
  off-phone. Desktop path must not execute any of it beyond detection.
- **Acceptance**: run_all.sh green (phone off under stubs — detection must
  no-op safely without matchMedia/screen); `tools/tests/wp12-tests.js`:
  detection matrix (narrow+coarse→phone, wide+fine→desktop, override wins,
  rotation keeps phone), injected nav present only in phone mode, sheet
  open/close toggles classes, peek updates on logEntry, desktop DOM
  untouched when `phone` absent (snapshot innerHTML of `#topbar`+`#side`
  with detection forced off === baseline). Headless Brave proof at
  390×844 DPR3: (1) board view — board ≥ 60% of viewport height, top strip
  one row, nav bar visible; (2) Army sheet open; (3) Attack sheet with a
  staged attack; (4) log sheet + chat; (5) solo game mid-AI-turn with
  allocation banner; (6) builder single-column; plus one 844×390 landscape
  board shot and one 1680×1000 desktop shot diffed against pre-WP12 (must
  be pixel-identical except nothing — assert no `.phone` rules leak).
  LOOK at every screenshot. No horizontal page scroll anywhere
  (`document.documentElement.scrollWidth <= innerWidth` asserted via
  injected check). Real-iPhone Safari pass remains for the human.

---

## 5. Execution model for agents

**Sequencing.** WP0 first, alone, merged before anything else. Then three parallel
tracks: **A:** WP2→WP3 · **B:** WP4→WP5 · **C:** WP1, WP6, WP8 (any order).
WP7 goes last (touches everything). WP9 items slot into any idle time.

**Coordination on a single file.** One git branch per WP; rebase onto main before
merging; merges go through one designated integrator agent. Keep every WP's edits
inside clearly-marked section comments (`/* ==== WPn: name ==== */`) and NEVER
reformat code you don't own — the diff is the merge currency. If two WPs must touch
the same function (`draw()`, `applyOp`, keydown), the integrator merges those hunks
manually; keep such hunks minimal and append-only where possible (e.g., add new
`case` clauses at the END of `applyOp`'s switch).

**Verification protocol (every WP, before merge):**
1. Extract + syntax check:
   `python3 - <<'EOF'` … extract last `<script>` block → `node --check`.
2. Data intact: JSON in `db40k-data` and `layouts40k-data` still parses.
3. **Two-window smoke test**: open the file in two browser windows, Host in one,
   Join in the other (PeerJS loopback works locally). Verify: your WP's feature
   syncs both ways; deploy/move/dice/draw-card still work; refresh guest → rejoin →
   state resyncs.
4. Regression sweep (5 min): muster an Ork list via Builder; load Official 1A;
   move a unit (coherency snap still works); roll an attack; draw a secondary;
   save + load the game file.
5. `git commit` with a message naming the WP.

**When stuck** on intent or a rules question: the 11th-ed core rules text is at
`../Free Rules Downloads/01 Core Rules/Core Rules.pdf` (visibility §13, objectives
§14, reserves §20, attached units §19, monsters/vehicles §17) and a distilled
summary at `../Notes/11th Edition Core Rules - Study Notes.md`. Prefer the rules
over guesses; prefer shipping the documented approximation over stalling.

**Data refresh** (points/new units): `python3 tools/build_db.py` (needs curl).
Layout JSON is hand-traced — do not regenerate it programmatically.
