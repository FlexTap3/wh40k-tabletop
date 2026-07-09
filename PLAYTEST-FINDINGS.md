# PLAYTEST-FINDINGS — Goal-1 (playability / mechanics / fun / 11th-ed fidelity)

Severity-ranked log from driving the **real UI** (Playwright/Chromium via `tools/shots`, immune
to the Brave wedge). Headless legality is covered separately by `tools/sim/auditor.js`; this file
is about the human-facing app — flow, dead-ends, UX friction, and mechanics as experienced.

## Pass 1 — solo game through the real UI (Gen 3, 2026-07-08)

Instrument: `tools/shots/playtest-ui.js` — drives a solo game via real button clicks, the phase
stepper, and the ⚔ attack tool's click-flow; captures console/page errors + screenshots at every
phase (reviewed visually). `discover.js` dumps the interactive surface.

**Headline (positive):** a full solo game **flows end-to-end through the actual UI with 0 console
errors** — load mission (5 obj, 2 DZ) → import + deploy 78 models → Solo dialog starts the AI
(deploys 39, holds reserves) → step all six phases (Command→End) → ⚔ tool populates a correct
weapon profile in the Attack tab → AI plays its turn → defender casualty-allocation prompt →
phone layout. This **closes a gap the session handoff flagged as never verified** ("still no live
two-window P2P game… no real game report"): solo play is now confirmed playable on a real render.
Screens reviewed: deployment, Solo dialog, Attack tab, phase transitions, after-AI-turn, phone.

### Findings

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| 1 | major | balance/onboarding | Solo dialog defaulted the AI to **1000 pts** regardless of the player's army → a new player gets a lopsided half-strength opponent (a typical list is ~1875–2000). | **FIXED** — defaults to standard **2000** (Strike Force), and on open auto-matches the player's loaded army to the nearest bracket (`aiSoloToggle`). |
| 2 | minor | UI | Per-phase reminder banner (e.g. "End of turn — Rapid Ingress may be used") renders over the top-right of the board. Useful coaching, dismissable, but overlaps tokens. | **FIXED in Pass 2** (see below) |
| 3 | minor | fidelity/import | Imported meta armies show "**base datasheet pts**" (e.g. Sororitas 1875, not 2000) — enhancements/proper costs aren't applied on import, so a player's list undercosts vs a legal 2000. Pre-existing (noted in handoff). | open (needs import-pipeline work) |

### Verified good (no action)
- Attack tab is faithful to 11th ed: Attacks/Hit/S/AP/D, Lethal/Sustained/Dev/Anti-X, re-roll
  hits/wounds, Cover(−1), Invuln, FNP, plus a Ld 2D6 battle-shock roller. Auto-populates from the ⚔ tool.
- Board legibility: leader rings, wound/model-count badges, objectives, terrain, DZ polygons all clear.
- Phone layout: board-first with bottom nav; the defender casualty-allocation flow (wounded-first
  rule + auto-assign) is presented cleanly on a 390px viewport.
- Solo dialog copy clearly explains sides, turn order, and to load a layout first.

**Next real-UI passes (per schedule):** Gen 8 — Cards/secondaries + CP/VP scoreboard + end-game.

## Pass 2 — Fight phase through the real UI (Gen 4, Lane B, 2026-07-08)

Instrument: **`tools/shots/fight-ui.js`** — a new sibling harness (Playwright/Chromium, Brave-wedge
immune) that sets up an engagement (a friendly melee unit ~1.5" from an enemy) and drives the whole
Fight cluster through the REAL UI: the ⚔ attack tool (melee engagement check), **Fire Overwatch**
(reactive, 6s-to-hit), a **2D6 charge** (ruler + dice roller), **Pile in / Consolidate** (3" caps,
via real `page.mouse` drags with snap-back), and **Fall Back** (`t.fellBack`). It captures
console/page errors + a screenshot at each step (reviewed visually). Buttons are driven by real DOM
`.click()` on the inspector/token-menu; drags by real mouse events through the app's own pointer
handlers. **Result: 11/11 steps ok, 0 console/page errors** before and after the fixes below.

**Headline:** the Fight-phase UX — never previously exercised on a live render — **works end-to-end
with 0 console errors**. Fall Back stamps `t.fellBack` (auto-clears next Movement phase); Fire
Overwatch routes through the real roller and forces Hit-on 6+; Pile in / Consolidate arm a hard 3"
cap that commits a ≤3" drag and **snaps a >3" drag back**; a phase change drops the armed cap. But
driving it surfaced one **rules-gate fidelity violation** (now fixed) plus assist-tool gaps.

### Findings (severity-ranked)

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| P2-1 | **MAJOR (fidelity gate)** | rules/fight | **Melee engagement range was 1" (10th ed), not 2" (11th ed).** The ⚔ attack tool (`wp3Stage`) and the two-click default-weapon picker (`wp15DefaultWi`) both used a `≤1.02"` threshold, so units **1.0–2.0" apart were flagged red "NOT within 1" / out of engagement** and the melee read as illegal — blocking a *legal* 11th-ed fight. Cites `../Notes/11th Edition Core Rules - Study Notes.md` line 8: "Engagement range is now 2" horizontally (5" vertically)." Internal inconsistency: the AI's own fight code already used `2.02"`. | **FIXED** |
| P2-2 | minor | UI | Per-phase reminder banner floated over the board's top-center, obscuring tokens **and blocking clicks** to them (Pass-1 open #2). | **FIXED** |
| P2-3 | minor | fidelity | A unit that **Fell Back** can still stage a shooting attack / charge — the app logs "no shooting or charging this turn" but (assist-only) does **not** block it. 11th ed forbids both. | **FIXED (Pass 4, Gen-6 Lane B)** — enforcement gate in the staging chokepoint |
| P2-4 | minor | fidelity | **Fire Overwatch can be staged with a melee weapon** when the selected shooter has no ranged weapon (routes through the default-weapon picker, which falls back to melee). 11th Overwatch is a ranged snap-shot; a melee-only unit can't Overwatch. | open (guard shooter to ranged) |
| P2-5 | info | fidelity | **No dedicated "declare charge" action.** A charge is a composite of ruler-measure + the 2D6 dice roller + a manual move. So: no enforcement that the move ends within 2" engagement, a natural **2 isn't auto-failed**, no **Fights-First** / charged-this-turn tracking for fight ordering, and 11th's Overrun + three Consolidation modes aren't modeled. Consistent with the app's "assist, don't adjudicate" stance. | open (deferred; larger feature) |
| P2-6 | **MAJOR (fidelity gate)** | fidelity (AI lane) | The AI movement/charge/fight code used **1" engagement** (10th ed), not 11th's **2"**, in four places: `aiTryTranslate` non-charge avoidance (`edgeDist<=1.05`), `aiChargeUnit` already-engaged skip + charge-success threshold (`+1.02`), and `aiFightUnit` eligibility (`>1.02`). Non-charge moves stopping 1–2" from an enemy are illegal in 11th. | **FIXED (coordinator, Gen-4 integration)** — all four → 2.0x; charge move also capped to the 2D6 roll (was reaching base contact regardless of roll). Cost: 5-seed mean AIStrength 0.832→0.764 (removed 10th-ed-cheat inflation; fidelity trumps strength). 0 rules findings, suite green. |

### Fixes (each verified in-UI: 0→0 console errors, screenshot reviewed)

- **P2-1 (melee engagement 1"→2"):** `wp3Stage` and `wp15DefaultWi` now use `≤2.02"`; the hint text
  reads "NOT within 2\"". Regression tests: `wp3-tests.js` gains a **positive** assertion (melee at
  ~1.5" reads "in engagement range") alongside the existing out-of-range one, and both wp3/wp15
  engagement messages updated. **Before:** `fight-04` banner red "melee — closest models 1.5" (NOT
  within 1")". **After:** green "melee — closest models 1.5" (in engagement range)". `run_all.sh`
  green. *RULES-CRITICAL — flagged for your blessing per §9 integration gate.*
- **P2-2 (reminder banner):** CSS-only — banner is now `pointer-events:none` (clicks pass through to
  tokens; the ✕ button keeps `pointer-events:auto`), translucent (bg .94→.82), slimmer padding, and
  narrower (max-width 74%→60%). **Before/after screenshots:** `fight-09-banner.png` / the strip in
  `fight-03`/`fight-04` — tokens beneath stay visible and selectable; the coaching is retained.

### Verified good (no action)
- Pile in / Consolidate: real mouse drag ≤3" commits, >3" snaps back to start (hard cap, no advance
  leeway), logged; arming shown in the inspector and the ⋯ token menu. (`fight-05`, `fight-06`, `fight-07`)
- Fall Back button + ⋯-menu action stamp `t.fellBack` on every model; flag auto-clears when a fresh
  Movement phase begins. (`fight-02`)
- Fire Overwatch: reactive-only (non-active side, Movement/Charge phase), needs your unit + the enemy
  unit selected, forces Hit-on **6+**, routes through the normal attack roller. (`fight-03`)
- 2D6 charge roll via the dice roller logs to both peers; ruler tape measures the gap. (`fight-08`)

## Pass 3 — Cards / secondaries + CP/VP scoreboard + end-game through the real UI (Gen 5, Lane B, 2026-07-08)

Instrument: **`tools/shots/cards-ui.js`** — a new sibling harness (Playwright/Chromium, Brave-wedge
immune) driving the whole scoring cluster through the REAL UI: the Cards tab (🎴 draw secondaries,
the shared two-hand view, the editable 📖 card reader + Edit-deck dialog), the VP/CP scoreboard
steppers (real button clicks in `#scoreboard`), scoring across battle rounds, stepping the game to
its end (round 5 → over), and the ranged-only Fire Overwatch guard. Buttons are driven by real DOM
`.click()`; console/page errors + a screenshot captured at every step and reviewed visually.
**Result: 15/15 steps ok, 0 console/page errors** after the fixes below.

**Headline:** the scoring/cards UX — never previously exercised on a live render — **works
end-to-end with 0 console errors**. Secondaries draw into distinct hands, both hands render with
headers, the 📖 reader edits/persists/broadcasts card text, the deck editor rewrites the deck, and
the VP/CP steppers mutate the tracked score. Driving it confirmed the two prior-run facts and let me
fix both the phantom-CP end-game gap and P2-4 in the UI layer.

### Findings (severity-ranked)

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| P3-1 | **MAJOR (fidelity gate)** | rules/end-game | **No end-of-game handling** — stepping `›` past P2's End of round 5 rolled into a phantom round 6 whose Command phase auto-granted **+1 CP to both sides** (illegal: 11th ed is 5 battle rounds — Study Notes L28; CP is only gained in the Command phases of rounds 1–5). No end-of-game cue at all. | **FIXED** |
| P3-2 | minor | fidelity | **Fire Overwatch could be staged with a melee weapon** for a melee-only shooter (the `wp15` default-weapon picker fell back to melee). 11th Overwatch is a ranged snap-shot. (Pass-2 open **P2-4**.) | **FIXED** |
| P3-3 | minor | fidelity/UX | **No primary-scoring cue.** Primaries score progressively in the Command phase from round 2 (Study Notes L28), but nothing prompted it. | **FIXED** (reminder nudge) |
| P3-4 | **needs your judgment** | fidelity | **Secondary hands are SHARED** — each player sees the other's drawn Tactical cards (the Cards-tab copy even says so). 11th-ed matched-play Tactical secondaries are a **hidden** hand; the opponent shouldn't see them. A deliberate shared-table-aid choice, but a strict fidelity deviation. | open (design call — see below) |
| P3-5 | info | fidelity | **No automatic primary scoring.** VP is manual via the steppers; the app ships no VP rules (the paid Mission Deck has them). Consistent with the "assist, don't adjudicate" stance; P3-3 adds the coaching nudge. | open (intentional non-fix) |

### Fixes (each verified in-UI: 0→0 console errors, screenshot reviewed)

- **P3-1 (end-of-game / phantom round-6 CP):** the phase stepper still lets the round counter tick
  past 5 (headless drivers loop until `round>5`), but the app now (a) **guards the auto Command-phase
  +1 CP so it never fires once the game is over** (`round>WP7_LAST_ROUND`), and (b) shows an explicit
  **"🏁 Game over"** cue: the phase label, a scoreboard banner with the final VP + winner/draw, a
  reminder-banner line, a one-shot shared log summary, and the Round badge reads **"5 ✓"** (never a
  bare "6"). New `WP7_LAST_ROUND=5` + derived `wpGameOver()`; no new synced state (both peers derive
  it from `round`), fully back-compatible. Verified: driving the real stepper from Deploy through a
  full game ended at **10 CP each (was 11 with the phantom grant)**, label "🏁 Game over", scoreboard
  "Player 1 wins 20–0", and stepping again added **no** further CP. **Before:** round 5 → silent
  round 6, +1 CP/side. **After:** `cards-11-game-over.png` — Game-over banner + "5 ✓" + 10/10 CP.
  *RULES-CRITICAL — flagged for your blessing per §9.*
- **P3-2 (P2-4 ranged-only Overwatch):** `wp15DefaultWi` gained a `rangedOnly` flag (skips the melee
  auto-pick, returns −1 when the unit has no ranged weapon); `wp15Go` threads it and logs a clear
  reason; `wpFightOverwatch` calls `wp15Go(target,true)`. A melee-only shooter is now **blocked** with
  "…has no ranged weapon — Fire Overwatch is a ranged snap-shot…"; a ranged unit still stages at 6+.
  **Before:** melee weapon staged. **After:** `cards-09-overwatch-melee-blocked.png` (blocked) +
  `cards-08-overwatch-ranged-ok.png` (ranged still works).
- **P3-3 (primary-scoring cue):** the Command-phase reminder now appends **"· score your primary (use
  the VP steppers)"** in rounds 2–5 — a neutral coaching nudge, no rules prose, no auto-scoring.

### Needs your judgment (fidelity)
- **P3-4 shared vs hidden secondary hands.** Strict 11th-ed matched play keeps each player's Tactical
  hand secret. The app deliberately shares both hands (it's often a single-screen table aid, and the
  copy states it). Making hands hidden would be a real feature (per-side reveal/secrecy, network hand
  hiding) — I did **not** change it. Your call whether shared-hand is acceptable for this tool or
  worth a hidden-hand mode.

### Verified good (no action)
- 🎴 Draw a card adds **distinct** secondaries (dedupes against the current hand); both "Your hand"
  and the opponent's hand render with counts. (`cards-02`, `cards-03`)
- 📖 card reader: edits persist to `localStorage` + `cardText`, broadcast via a `cardtext` op, and
  re-render in the hand. Edit-deck dialog rewrites `secDeck`. (`cards-04`, `cards-05`, `cards-06`)
- VP/CP steppers (both the Cards-tab scoreboard and the top bar) mutate the tracked score and log
  manual CP changes; round 1–5 Command phases grant exactly one +1 CP each (10/10 over a full game).
  (`cards-07`)
- Primary-mission card shows the mission, objective count, editable primary summary, and the
  "Open in Event Companion (p.N)" deep-link. (`cards-01`)

## Pass 4 — Movement phase + Fell-Back / Advanced enforcement through the real UI (Gen 6, Lane B, 2026-07-08)

Instrument: **`tools/shots/move-ui.js`** — a new sibling harness (Playwright/Chromium, Brave-wedge
immune) driving the **Movement-phase cluster** — the one phase not yet deeply exercised on a live
render — entirely through REAL `page.mouse` drags routed through the app's own pointer handlers:
normal move (live WP2 measure tape + the strict M+6" cap / snap-back), **Advance** (a drag into
M+D6 territory + its "no shooting/charging" consequence), the **structured-movement** toggle
(move-once lock, per-unit "Movement complete", ↩ Undo / snap-back), **Fall Back**, and the **P2-3
fidelity gate**. Console/page errors + a screenshot captured at every step and reviewed visually.
**Result: 14/14 steps ok, 0 console/page errors** with the P2-3 fix in place.

**Headline:** the Movement UX — never previously driven on a live render — **works end-to-end with
0 console errors**. Normal drags commit under the live measure; a >M+6" drag snaps back when
"Enforce movement caps" is on; a drag past M into advance territory now **stamps `t.advanced`** (a
blue "A" badge); "Movement complete" locks a unit and refuses a re-drag; ↩ Undo snaps a unit back to
the phase-start position and clears the Advance flag; Fall Back stamps `t.fellBack`. Driving it let
me close the last open fidelity-gate item from Pass 2 (**P2-3**).

### Findings (severity-ranked)

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| P4-1 | **MAJOR (fidelity gate)** | fidelity | **P2-3: a Fell-Back or Advanced unit could still stage a shot / charge.** The app only logged a reminder; nothing blocked staging the attack. 11th ed forbids both a unit that Advanced (no shoot, no charge) and one that Fell Back (no shoot, no charge/fight) — Core Rules Study Notes (Advance / Fall Back). | **FIXED** |
| P4-2 | info | fidelity | The player's **Advance was never a tracked state** — it was inferred from the drag distance and only logged, so no consequence could be enforced. (The AI already tracked `aiMoved[uk].advanced`.) | **FIXED** (now stamps `t.advanced`, mirroring `t.fellBack`) |
| P4-3 | info | fidelity | **No dedicated "declare charge" action** (Pass-2 **P2-5**, deferred). Because a charge is a composite of ruler + 2D6 + a manual move with no unit-bound "charge" verb, "no charge" can't be gated at a charge button — there isn't one. Enforcement rides on the melee-stage block (a Fell-Back unit can't stage a melee attack either) + the existing reminder. A full charge-declaration gate remains the P2-5 feature. | open (deferred with P2-5) |

### Fix (verified in-UI: 0→0 console errors, screenshots reviewed)

- **P4-1 / P2-3 (Fell-Back & Advanced enforcement):** the gate lives at the single staging
  chokepoint **`wp3Stage`** (both the ⚔ tool via `wp15Go`, the inspector ⚔ aim via `wp3PickTarget`,
  the weapon-selector restage via `wp15WepChange`, and Fire Overwatch via `wpFightOverwatch` all
  funnel through it). New helper **`wpMoveActionBlock(unit,isMelee)`** returns a reason when illegal:
  a **Fell-Back** unit is blocked from **both** shooting and melee (charge/fight); an **Advanced**
  unit is blocked from **shooting only** (it may still fight if engaged — fidelity-correct). On a
  block `wp3Stage` returns `false`, stages nothing (`wp3Label=""`), shows a red **"⛔ Blocked — …
  can't shoot (11th ed)"** banner in the Attack tab, and logs the reason; the three callers skip
  `wp15AfterStage`. To make "Advanced" enforceable, a normal move past M now **stamps `t.advanced`**
  on the unit (in `wp2LogMove`, synced via `tok~`, cleared by ↩ Undo and auto-cleared on a fresh
  Movement phase in `wp7ApplyPhase` — the exact lifecycle `t.fellBack` already uses). A blue "A"
  badge (`drawAdvancedBadge`) and an inspector status line surface the lock so the block isn't a
  surprise. The gate is **owner-agnostic but only ever fires on the human's own units** — the AI
  never sets these transient flags (it tracks `aiMoved`), so no legal AI action is broken.
  **Regression:** `wpfight-tests.js` gains a P2-3 block — a normal unit still stages a shot
  (control), an Advanced unit's shot is blocked while its melee is allowed, a Fell-Back unit's shot
  AND melee are both blocked, and clearing the flags un-gates it. `run_all.sh` green (all suites).
  **Before:** `move-08-normal-shot-ok.png` (normal unit stages). **After:**
  `move-09-advanced-shot-blocked.png` — red "⛔ Blocked — Sanctifiers Advanced this turn — it can't
  shoot (11th ed)"; `move-10-fellback-shot-blocked.png` — "⛔ Blocked — Preacher Fell Back this
  turn". *RULES-CRITICAL — flagged for your blessing per §9 integration gate.*

### Verified good (no action)
- Normal move: whole-unit `page.mouse` drag commits under the live WP2 measure tape; distances shown
  vs M with the "+D6?" advance hint. (`move-02-normal-drag`, `move-02b-normal-committed`)
- Strict cap: with "Enforce movement caps" on, a >M+6" drag snaps the whole unit back with a logged
  reason; 0 errors on the snap. (`move-03-overcap-drag`, `move-03b-overcap-snapback`)
- Advance: a drag into M+D6 territory commits and stamps `t.advanced` (blue "A" badge).
  (`move-04-advance-drag` shows the live "9.0" / 6" +D6?" tape, `move-04b-advance-committed`)
- Structured movement: "Movement complete" locks a unit and a further drag is refused;
  ↩ Undo move snaps the unit to the phase-start position and clears the Advance flag.
  (`move-05-movement-complete`, `move-06-undo`)
- Fall Back: the ⚑ button stamps `t.fellBack` on every model. (`move-07-fallback`)
- Lifecycle: leaving and re-entering the Movement phase (real `phase` op → `wp7ApplyPhase`) clears
  both Advance and Fall Back flags, so a unit may act again next turn. (`move-11-flags-cleared`)

### Could not drive / honestly out of reach
- **Charge as a first-class action** (P4-3 / P2-5): there is no "declare charge" verb to gate, so
  "no charge" for an Advanced/Fell-Back unit is enforced indirectly (Fell-Back melee-stage block +
  reminder). A hard charge gate needs the deferred charge-declaration feature.
- The harness's `setPhase` shortcut (used by every real-UI harness) sets `state.phase` directly and
  skips `wp7ApplyPhase`; the lifecycle-clear step therefore drives the **real** `phase` op so the
  actual clear code under test runs (not a harness stub).

## Pass 5 — full-game capstone: one complete 5-round solo game through the real UI (Gen 7, Lane B, 2026-07-08)

Instrument: **`tools/shots/fullgame-ui.js`** — a new sibling harness (Playwright/Chromium, Brave-wedge
immune). Where Passes 1–4 drove individual phase clusters, this drives **ONE COMPLETE game start→finish**:
load Official 1A, import + deploy my army (78 models), start Solo (T'au, 2000 pts, `aiSeed(1337)`), then
play **all five battle rounds** — each round my Command→End via the real phase stepper (`wp7Step`, what
the › button calls), score primary in rounds 2–5 via the real VP stepper, hand to the AI and let it play
its **whole** turn (`aiFinishTurn`, what ⏭ calls), and **resolve every casualty-allocation prompt through
the real UI** (a real board click + `A` key for the first, auto-assign after) — through to the explicit
**Game over** state. Console/page errors + a screenshot per round captured and reviewed.
**Result: 20/20 steps ok, 0 console/page errors** across the whole game.

**Headline:** a full **5-round solo game plays end-to-end through the actual UI with 0 console errors** —
the AI played all five of its turns, ~30–40 casualty-allocation prompts were resolved through the real
banner, state integrity held (no NaN/Infinity positions or wounds after 5 rounds), scoring added up (CP
**10/10**, no phantom round-6 grant even with the AI's own Command phases granting CP), and the end-game
cue fired correctly (phase label "🏁 Game over", round badge "**5 ✓**", scoreboard "Player 1 wins 20–0").
This is the first time the whole game — not a single cluster — has been verified on a live render.
Final scoreboard: **P1 20 VP / 10 CP · AI 0 VP / 10 CP** (AI VP is 0 because the app ships no auto primary
scoring — VP is manual via the steppers, the known P3-5 stance; the harness only scored side 1).

### Findings (severity-ranked)

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| P5-1 | **MAJOR (playability)** | UI/casualty allocation | **The casualty-allocation banner `#wp11Banner` ate clicks to models beneath it.** During solo allocation you must **click your models on the board** to assign each damage packet, but the top-centre banner was pointer-events-opaque — a target unit positioned under it was **un-clickable**, so allocation was impossible for that unit (auto-assign `A` was the only escape). Only surfaces across a whole game, when the AI damages units all over the board. The sibling coaching banner `#wpRulesReminder` already got this exact fix in Pass 2 (P2-2); `#wp11Banner` was missed. | **FIXED** |
| P5-2 | minor | AI turn-loop (NOT Lane B / out of scope) | **The AI's shooting resolves one phase late — its shooting casualty-allocation prompts fire while the phase label already reads "Charge".** 38/39 shooting prompts in a measured game showed phase "Charge". Root cause (AI code): `aiShootUnit` enqueues each weapon's `aiFireWeapon` to the **tail** of the action queue, but `aiPlanPhase` enqueues the Shooting→Charge `wp7Step` **before** those fire actions run, so the shots (and their prompts) execute after the phase advanced. Player-facing symptom: the banner shows an AI *shooting* attack during "AI · Charge". No damage is lost and no rules are broken (shoot-then-charge is legal), but it is confusing and the phase state is momentarily wrong during the AI turn. **Owned by the AI lane** (`aiShootUnit`/`aiShooting`/`aiPlanPhase`), so left unfixed by Lane B per the disjoint-edit-region rule — **handed to the coordinator / AI lane.** | open (AI lane) |
| P5-3 | info | playability/onboarding | **Casualty-allocation volume:** a solo player faces ~30–40 manual allocation prompts over a full game. This is design-intended (11th ed: you allocate your own casualties) and the **Setup → "Auto-apply my casualties"** toggle already exists as the escape hatch. Noted, not changed — like P3-4, the default (manual = faithful) is a design call for Paul. | open (by design) |
| P5-4 | info | fidelity/info | The **opponent's Strategic Reserves are listed in my Setup reserve tray** ("AI (T'au Empire) (opponent) · Stealth Battlesuits ×5"). Not a fidelity violation — matched-play army lists are open, so reserve contents are public — but noted for completeness. | open (acceptable) |

### Fix (verified in-UI: 0→0 console errors, before/after evidence)

- **P5-1 (`#wp11Banner` click-through):** CSS-only, one line — `#wp11Banner` gains `pointer-events:none`
  and `#wp11Banner button` gains `pointer-events:auto` (the Auto-assign button stays clickable), the
  identical pattern as the P2-2 fix on `#wpRulesReminder`. **Before:** with the banner opaque, a real
  mouse click on a model positioned under the banner centre hit a banner `<span>` (`document.elementFromPoint`
  = SPAN) and the packet stayed **pending (0 applied)** — allocation impossible. **After:** the same click
  reaches the canvas (`elementFromPoint` = `board`) and the packet **applies (allocation cleared)**. The
  fullgame harness now carries a permanent regression guard ("P5-1 FIX: casualty-allocation click passes
  THROUGH the banner…", 20/20). `run_all.sh` green.

### Verified good across a WHOLE game (no action)
- **Phase stepper** drives all 6 phases every round for 5 rounds with no dead-end; hand-off to the AI and
  back is clean each round (`aiFinishTurn` chains its own `wp7Step`s and returns control to side 1).
- **Casualty allocation** (P4/P5): the real board-click + `A`-key + Auto-assign button all work over the
  whole game; the banner is faithful (attacker → target · weapon, packet count/dmg, wounded-first hint,
  gold suggestion ring).
- **Scoring integrity:** exactly one +1 CP per Command phase per side = 10/10 after 5 rounds; the phantom
  round-6 CP grant never fires (P3-1 holds all the way to the end, incl. the AI's Command phases).
- **End-game cue** (P3-1): phase label "🏁 Game over", round badge "5 ✓" (never a bare 6), scoreboard
  banner with the final verdict, shared-log summary — all fire correctly at the true end of round 5.
- **State integrity:** no NaN/Infinity token positions or wounds after 5 rounds; reserves arrive over the
  game (AI 39 deployed → 44 on board as Strategic Reserves land).

### Could not drive / honestly out of reach
- **AI decision quality / list tactics** — the harness drives the AI's turns but does not grade them; the
  AI-strength curve is Lane A's `control.js`/`matrix.js`, not this pass.
- **AI shooting-order fix (P5-2)** — the real fix is in AI turn-loop code (`aiShootUnit`/`aiPlanPhase`),
  outside Lane B's edit region, so it is documented and handed off rather than patched here.
- **Automatic primary scoring** — still manual (P3-5); the harness scores side 1 by hand, so the final
  AI VP reads 0. Unchanged, intentional.

## Pass 6 — P2P / netcode: the two-window game convergence (Gen 8, Lane B, 2026-07-08)

Instrument: **`tools/shots/p2p-sync.js`** — a new sibling harness (Playwright/Chromium, Brave-wedge
immune) that tests the app's **original, never-verified goal**: a **two-window host+guest game** over
PeerJS. It loads the REAL app in **TWO isolated pages** (separate JS contexts, each with its own
module-level `state`) and exercises PLAN.md §1.1 **invariant #3 ("Both peers converge")** two ways:

1. **Offline op-convergence (primary, deterministic):** it replaces ONLY the PeerJS transport with a
   loopback — installs a fake `conn` (`{open:true, send}`) on each page so the app's own
   `send()`/`op()`/`applyOp()`/`onMsg()` run **unchanged**, and pumps every emitted message from one
   page's outbox into the *other* page's real `onMsg` (exactly what `conn.on("data",onMsg)` does over
   PeerJS). Nothing in the app is stubbed — only the wire is swapped for a loopback, which is precisely
   what PeerJS is. It then drives the host's real mutations and after each asserts **deep-equality** of
   the converge-critical `state` sub-tree (`tokens/trackers/phase/cards/objectives/sec/dz/reserves/
   mission/names/board`) on both peers.
2. **Live PeerJS (best-effort):** a second block drives the app's OWN `hostGame()`/`joinPrompt()` over
   the real PeerJS cloud broker in two more pages, then pushes a real op and polls the guest.

**Result: 20/20 steps ok, 0 console/page errors; 8/8 convergence deep-equals passed; live PeerJS
CONNECTED and a real op converged over the actual WebRTC wire** (reproduced across 3 runs).

**Headline (the one the session handoff has been waiting for):** the **two-window P2P game converges** —
this is the first verification of the app's founding goal. Every op kind exercised
(`tok+`/`tok~`/`tok-`/`track`/`sec+`/`obj~`/`phase`) leaves **both peers byte-identical** on the synced
state; the `{t:"state"}` full-sync brings a late joiner exactly to the host's mid-game state; older
saves missing new fields load without throwing and default sanely; and — beyond what the plan required —
**live PeerJS signalling is NOT blocked in this sandbox**: a real host+guest connected over the cloud
broker and a host op (clear + tok+ + track) propagated to the guest over real WebRTC.

### What was verified (each an assertion in the harness)

| # | Invariant #3 facet | Check | Result |
|---|--------------------|-------|--------|
| P6-1 | (c) full-sync on join | Guest connecting after the host loaded a mission + 78-model army receives the whole board via `{t:"state"}` → deep-equal. | **converges** (78 tokens) |
| P6-2 | (b) mutate via `applyOp` | Host `op(tok~)` token move → guest matches. | **converges** |
| P6-3 | (a)(b) synced state | Host `stepTracker` VP/CP (`track` op) → guest matches (vp 5/3, cp 1/0). | **converges** |
| P6-4 | (a)(b) synced state | Host `drawSecondary` ×2 (`sec+`) → guest matches; **owner is the host's side on the guest too** (no owner flip). | **converges** |
| P6-5 | (a)(b) synced state | Host deploys side-2 tokens (`tok+`) + secures an objective (`obj~`) → guest matches. | **converges** |
| P6-6 | derived-on-both | Host steps a full round of phases (`phase` op). The Command-phase **+1 CP auto-grant is derived independently on each peer** inside `wp7ApplyPhase` (not sent as a separate op) — asserted the derived CP is identical on both (cp 3/2). | **converges** |
| P6-7 | bidirectional | **Guest**-originated `op(tok~)` + `op(track)` reach the host. | **converges** |
| P6-8 | (c) late join | A **brand-new** guest connects mid-game and catches up to the heavily-mutated host state via `{t:"state"}` → deep-equal. | **converges** |
| P6-9 | (d) default when absent | A legacy `{t:"state"}` missing `sec`/`cards`/`reserves`/`phase` loads with **no throw**; the back-compat shims fill `sec=[]`, `cards={1,2}`, `reserves`, `phase` and subsequent `renderCards`/`wp7Step`/`drawSecondary` don't error. | **defaults sanely, 0 errors** |
| P6-10 | transient (not state) | `{t:"dmg"}` (defender-allocation direct message) is handled without throwing and **does not enter `state`** (correct: like `ruler`, it's ephemeral and intentionally lost on reconnect). | **ok, state unchanged** |
| P6-11 | live wire | Real PeerJS host+guest connect over the cloud broker; a host op propagates to the guest over WebRTC. | **CONNECTED + converged** |

### Findings (severity-ranked)

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| P6-1 | info (positive) | netcode | **The convergence invariant holds across every op kind + full-sync + late join.** No desync, no throw, no owner drift, no double-applied CP. The op protocol's idempotent replace-by-id design and the "derive-on-both, never nest an op" rule for the Command-phase CP grant both hold under a two-peer drive. | **verified — no bug** |
| P6-2 | info | netcode/sandbox | **Live PeerJS is reachable in this sandbox** (contrary to the usual assumption). The founding two-window game connects and syncs over the real cloud broker. Documented honestly; the offline loopback remains the deterministic regression guard (network-independent). | **verified** |
| P6-3 | info | netcode (documented, not a bug) | `{t:"dmg"}` defender-allocation and `{t:"ruler"}`/`{t:"movepath"}` are **transient direct messages, deliberately outside `state`** — they do not survive reconnect / full-sync. This is by design (a mid-roll damage packet or a live ruler tape is ephemeral) and consistent with invariant #3, which governs *mutable game state*, not transient UI signals. Noted so a future reader doesn't mistake it for a convergence gap. | **by design** |

**No convergence/desync/throw bug was found**, so **no app code was changed** — the highest-value
outcome here is the *proof* that the netcode already converges, plus a permanent regression harness.
Because the app was not touched, `run_all.sh` is unaffected and still green (verified).

### Could not drive / honestly out of reach
- **Real adverse-network behaviour** (packet reorder/loss/high latency, mid-op disconnect + WP1
  reconnect/resync) — the loopback delivers in-order and lossless, and the live path is a healthy LAN-ish
  link. The reconnect path (`wp1Reconnect`, `{t:"state"}` re-sync on re-open) is exercised structurally by
  the late-join test but not under a real drop mid-op.
- **Two genuinely divergent starting states reconciling** — the app's model is host-authoritative full-sync
  on join, not CRDT merge; the harness tests that model, not a conflict-resolution one (there isn't one).

## Pass 7 — final verification capstone: every harness + fresh first-10-minutes exploratory pass (Gen 9, Lane B, 2026-07-08)

This is the **ship-readiness gate** before `playtest`→`main`. Two instruments:

1. **`tools/shots/verify-all.js`** — a new single-command runner that executes **EVERY** UI harness in
   sequence against the current integrated app (`playtest-ui`, `fight-ui`, `cards-ui`, `move-ui`,
   `fullgame-ui`, `p2p-sync`, `discover`), reads each harness's own report JSON as the source of truth,
   and prints one PASS/FAIL with the **total** console/page-error count. Exits 0 iff every harness passes
   with **0** errors. It is the standing regression gate for the whole real-UI surface.
2. **`tools/shots/explore-ui.js`** — a new fresh exploratory harness that walks the first-10-minutes
   player journey a real person hits on a cold open: cold-open onboarding → help dialog → Army tab →
   Builder overlay → load a layout → import+deploy → Solo dialog → phone board / phone help / phone Army,
   asserting no horizontal page overflow and dialogs fit the viewport, with a screenshot at each step
   (reviewed visually).

**Result: `verify-all.js` — 7/7 harnesses PASS, 0 total console/page errors, exit 0.
`explore-ui.js` — 10/10 steps ok, 0 errors, no layout overflow.** The whole real-UI surface is green
on the final integrated app.

**Headline:** every previously-built harness still passes on the fully-integrated Gen-9 app **and** a
fresh first-run walkthrough surfaces no player-facing rough edge — the onboarding is coherent
(a welcome log line "Welcome, commander. Click ? for how to play online…", an empty-Army-tab hint
"No army yet. Build one in the Builder and hit Muster…", a clear "?" help dialog that fits and scrolls
on both desktop and a 390px phone), the Builder overlay is clean and points-tracked, loading a layout
and starting Solo are one-click each, and the phone layout is board-first with a working bottom nav and
no horizontal overflow anywhere.

### Findings (severity-ranked)

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| P7-1 | minor | **test harness** (not the app) | Running every harness together surfaced that **`fight-ui.js` (written in Pass 2) was stale relative to the Pass-4 P4-1/P2-3 enforcement gate**: it stamped `t.fellBack` on the Arco-flagellants in its Fall-Back step, then reused that **same** unit for the later Fire-Overwatch and melee-engagement steps — which the app now (correctly) blocks (a Fell-Back unit can't shoot or fight). The harness also tried to Fire Overwatch with a **melee-only** unit (Arco-flagellants have no ranged weapon), which the app correctly refuses (P3-2 ranged-only Overwatch). So the harness reported 9/11 with **0 console errors** — a stale-test artefact, **not an app regression**. | **FIXED (harness only)** |
| P7-2 | info (positive) | onboarding | The cold-open first-run experience is coherent with no missing guidance: a welcome log line points at the "?" and the Army tab; the empty Army tab explains the Builder→Muster path; the "?" dialog is a complete rules primer that fits and scrolls on desktop **and** phone. No first-load dead-end or blank-slate confusion. | verified good |
| P7-3 | info (positive) | mobile | Phone (390px) layout is clean across cold-open, deployed board, help dialog, and Army tab — **0 horizontal overflow** in every state; board-first with a bottom nav (Army/Attack/Cards/Log/Builder + settings). | verified good |

### Fix (harness-only, verified: 7/7 all-green after)

- **P7-1 (`fight-ui.js` stale vs the P4-1 gate):** two harness edits, **no app change**. (a) After the
  Fall-Back fidelity probe, the harness now **clears the transient `fellBack`/`advanced` flags** on the
  test unit before the Overwatch/melee steps — the Fall-Back *enforcement* is still proven by the probe
  (and owned end-to-end by `move-ui.js`), so the later steps correctly test their **own** concern (6s-to-hit,
  2" engagement) instead of re-testing the block. (b) The Overwatch step now picks a friendly unit that
  **actually carries a ranged weapon** (it lands on Morvenn Vahl's Paragon missile launcher at 36") rather
  than the melee-only Arco-flagellants — because Overwatch is a ranged snap-shot the app correctly refuses
  for a melee-only shooter. The stale finding note ("app is assist-only, does not block") was also corrected
  to reflect that the app now enforces the gate. **Before:** `fight-ui` 9/11 (2 steps blocked by correct app
  behaviour). **After:** **11/11, 0 errors**; `verify-all` 7/7 all-green. The app's Fell-Back/Overwatch
  fidelity gates are confirmed *working* — this fix aligns the harness with them, it does not weaken them.

### Verified good end-to-end (the ship gate)

- **`verify-all.js` 7/7, 0 errors** — `playtest-ui` 9/9, `fight-ui` 11/11, `cards-ui` 15/15, `move-ui` 14/14,
  `fullgame-ui` 20/20, `p2p-sync` 20/20 (+8/8 convergence, live PeerJS connected), `discover` clean.
- **`explore-ui.js` 10/10, 0 errors** — onboarding, Builder, layout load, army deploy, Solo dialog, and the
  full phone journey all render clean with no overflow and dialogs that fit the viewport.
- Only `tools/shots/` was touched (two harness files + the runner); **`wh40k-tabletop.html` and all shared/
  AI/sim/test code are untouched**, so `run_all.sh` is unaffected (no shared-code change to re-gate).

### Could not drive / honestly out of reach
- **AI decision quality** — out of Lane B scope (Lane A's control/matrix), unchanged here.
- **Programmatic phone tab-switch** — on phone the Army/Cards/etc. tabs live in the bottom nav; the
  exploratory harness verifies the phone layout renders with 0 overflow but drives `showTab` programmatically,
  which on a phone viewport keeps the board-first view rather than animating the mobile panel. Cosmetic to
  the harness, not an app issue; the phone board, help dialog, and overflow behaviour are all verified clean.

---

## Ship readiness (Gen 9 — final playability gate)

**Verdict: PLAYABLE END-TO-END and READY for `playtest`→`main` from a playability standpoint.**

**Verified working end-to-end (across Passes 1–7, all on the real render, 0 console errors):**
- A full **5-round solo game** plays start→finish through the actual UI (Pass 5) — load mission, import +
  deploy, Solo AI opponent, all six phases every round via the real stepper, ~30–40 casualty-allocation
  prompts resolved through the real banner, correct end-game cue ("🏁 Game over", round "5 ✓"), scoring
  integrity (CP 10/10, no phantom round-6 grant).
- Every **phase cluster** individually: Movement (caps/Advance/Fall-Back/structured move — Pass 4), Fight
  (engagement 2", Overwatch, pile-in/consolidate 3" caps, charge — Pass 2), Cards/secondaries + VP/CP
  scoreboard + end-game (Pass 3), the ⚔ attack tool + battle-shock roller (Pass 1).
- **11th-ed fidelity gates** enforced in the UI: 2" melee engagement (P2-1), ranged-only Overwatch
  (P2-4/P3-2), Fell-Back/Advanced no-shoot/no-charge (P2-3/P4-1), 5-round end-of-game / no phantom CP (P3-1).
- **Two-window P2P** converges over both a loopback and **live PeerJS/WebRTC** (Pass 6) — the app's founding
  "play my brother online" goal, every op kind + full-sync + late-join deep-equal, CP derived per-peer.
- **First-10-minutes UX** (Pass 7): coherent onboarding, clean Builder, one-click layout/Solo, clean phone
  layout with no overflow, help dialog that fits desktop + phone.

**Known / deferred items (all documented, none a blocker):**
- **P2-5 / P4-3 — no first-class "declare charge" action** (deferred, larger feature): a charge is a
  composite of ruler + 2D6 roller + manual move, so there's no charge verb to hard-gate (no auto-fail on a
  natural 2, no Fights-First tracking, Overrun/3 consolidation modes unmodelled). Fell-Back/Advanced "no
  charge" is enforced indirectly via the melee-stage block + reminder. Consistent with the app's
  "assist, don't adjudicate" stance.
- **P5-2 — AI shooting resolves one phase late** (AI-lane, out of Lane B scope): the AI's shooting
  casualty prompts fire while the phase label already reads "Charge". No damage lost, no rules broken;
  a known-minor cosmetic issue needing an RNG-neutral fix (the AI lane found any reorder reshuffles the
  dice stream and drops the strength metric — Gen-8 §8). Deferred, documented.
- **Import undercost (Pass-1 #3)** — imported meta armies show base datasheet points (e.g. Sororitas 1875,
  not a legal 2000) because enhancements/proper costs aren't applied on import. Pre-existing import-pipeline
  work, not a UI-layer issue.
- **Design calls (Paul's, deliberately NOT changed):**
  - **Shared secondary hands (P3-4):** each player sees the other's Tactical hand (a single-screen table
    aid; the Cards-tab copy says so). Strict 11th matched play hides it. Left as-is by design.
  - **Manual VP scoring (P3-5):** VP is manual via the steppers; the app ships no auto primary scoring
    (the paid Mission Deck has the VP rules). "Assist, don't adjudicate." Left as-is by design.
  - **Manual casualty allocation (P5-3):** ~30–40 prompts/game is 11th-ed-faithful (you allocate your own
    casualties); the Setup "Auto-apply my casualties" toggle is the escape hatch. Default left faithful.
