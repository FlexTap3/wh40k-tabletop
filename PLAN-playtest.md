# WH40k Tabletop — 10-Game Multi-Agent Playtest Plan

Goal: run a **genetic (generational) improvement loop** — ten total generations, each a
run of the app against the built-in AI — that jointly maximizes three fitness dimensions:

1. **Process fitness** — the harness/runner/auditor themselves get better each generation
   (faster, more faithful, more telemetry, fewer false findings). We improve *how we test*.
2. **Playability + fun fitness** — the game is enjoyable to play and **100% faithful to
   11th-edition Warhammer 40,000**. Rules correctness is a hard gate, not a soft score.
3. **AI-strength fitness** — the built-in solo-mode AI becomes a genuinely strong player.

All work lives on the **`playtest` branch**; nothing merges to `main` / Pages until Paul
reviews the batch. Decisions locked with Paul (2026-07-08):

- **Points:** 2000 pts (tournament scale).
- **Drive:** hybrid — ~3 generations exercised through the real UI (playability), ~7
  headless (AI tuning + process work).
- **Opponent:** one challenger on **side 1** (see §0.1) with difficulty tiers —
  neutral/predictable for stability generations, **agent-in-the-loop per turn** for the
  skill-pressure generations against the AI.
- **Cadence:** iterate & measure, evolutionarily — each generation diagnoses, mutates
  (process / mechanics / AI), keeps what raises fitness, re-runs the control, carries the
  winner forward. Regressions are reverted.
- **Matchups:** mostly varied faction/mission for coverage, plus one fixed **control**
  replayed every generation to measure AI improvement objectively.

### Canonical AIStrength metric changed at Gen 6 — cross-faction matrix (not single Control C)

Through Gen 5, AIStrength was measured on **Control C** (one matchup: AS challenger vs T'au AI).
Gen 6 proved this metric is **gameable / misleading**: a genuinely better, more rules-faithful list
builder (de-hordes T'au 154→48 models, raises the cross-faction matrix +0.028, keeps Control C's
win record identical 4W-1D-0L) *"regressed"* Control C's fitness sub-score — only because Control C
**is** the T'au matchup and its attrition/OC sub-scores reward the very body-count horde being
removed. Lane C's Gen-5 diagnosis already flagged Control C as "flattering."

**Decision (coordinator, Gen 6): the canonical AIStrength for genetic selection is now the
`tools/sim/matrix.js` cross-faction grand mean** (AI played across all 5 meta factions vs Tier-S),
which can't be gamed by one faction's body-count. **Control C is retained as a win-record guardrail
+ human-readable reference** (its win-record must not regress). Baseline (honest 5-seed, matrix):
**0.717**. Prior single-Control numbers (…0.776) are kept in the log as reference, not compared
across the metric change.

```
FITNESS = w1·Process + w2·Playability + w3·AIStrength      (start 0.2 / 0.4 / 0.4)
  Playability is GATED: any confirmed 11th-ed rules violation ⇒ Playability = 0 for
  that generation until fixed. Fidelity is non-negotiable; fun/flow scored above the gate.
  Process   = f(runtime, telemetry completeness, auditor precision, repo of regression tests)
  AIStrength = f(control win-rate, control avg VP margin, blunder-rate, competencies §5)
A mutation is KEPT only if it raises total fitness without regressing the test suite or
the control match; otherwise it is reverted. Winners carry forward to the next generation.
```

---

## 0. Why this is cheap: the engine already exists

`tools/tests/harness.js` runs the whole app under Node with DOM stubs. `wp10-tests.js`
already scripts a complete solo game end-to-end:

```
loadLayout()               // mission, objectives, DZs
addFromDb()/deployCard()   // build + deploy the human army in its DZ
aiStart(fid, pts)          // AI musters a legal list, deploys, holds reserves
wp7Step(1)  ×N             // advance phases (Deploy -1 → Command..End 0–5)
aiFinishTurn()             // run the AI's entire turn instantly (deterministic w/ aiSeed)
```

Determinism is available: `aiSeed(n)` + reseed `Math.random` (mulberry32) → reproducible
games. Legality primitives already exist and are used as test assertions: `wp5Illegal`,
`checkCoherency`/`incoherent`, `wp7PtInPoly`, edge-distance/range/LoS helpers.

**So we build three things, not an engine:** a game *runner*, a *challenger* policy (a
non-built-in opponent), and a rules/playability *auditor*.

### 0.1 Hard constraint: the built-in AI is bound to side 2

Grounding the code: `aiPlanPhase`/`aiOnPhase`/`aiUnits` all gate on `state.phase.side===2`
and `t.owner===2`. The built-in AI **only plays side 2** — there is no literal AI-vs-AI.
Every game is therefore *built-in AI (side 2)* vs *challenger (side 1)*, which is exactly
how Solo mode works in the shipping app (human = side 1, AI = side 2). We do **not**
generalize the AI to side 1 (that would risk the single-file app for no benefit); instead
the **challenger lives in `tools/sim/`** and drives side-1 tokens through the app's own
mutation paths (`op`, move, `wp3Stage`, the roller, `wp16` apply-damage). This gives one
opponent machine with **difficulty tiers**, not two opponent modes:

- **Tier N (neutral):** deterministic, doctrine-light — for stability/rules stress runs.
- **Tier S (skilled):** agent-in-the-loop, reads the state snapshot each turn and returns
  strong doctrine-aware actions — for maximum pressure on the AI.

---

## 1. Infrastructure to build first (before any of the 10 games)

New dir `tools/sim/` (Node, reuses `harness.js` loader; gitignore heavy outputs):

1. **`gamerunner.js`** — plays one complete game to a result.
   - Inputs: `{layout, missionSeed, sideA:{fid,pts,controller}, sideB:{...}, seed}`.
   - Loop: deploy both → for round 1..5, for each side, run every phase via `wp7Step`,
     letting the built-in AI use `aiFinishTurn()` and the challenger use its policy.
   - Emits **two artifacts per game**: `game-NN.jsonl` (one record per action:
     phase, unit, target, dice, from/to XY, VP/CP deltas) and `game-NN.md`
     (human-readable battle report + final score + turning points).
2. **`challenger.js`** — the non-built-in player policy for agent-vs-AI games.
   - A thin action API over existing app functions: `move(unit,x,y)`, `shoot(a,b,weapon)`
     (via `wp3Stage`/roller), `charge(a,b)`, `fight(a,b)`, `holdReserve`, `arrive`.
   - Ships a **baseline doctrine policy** (objective-first, focus-fire, screen, don't
     overextend — mirrors `AI_PLANS` doctrine) so headless games run unattended; an
     **agent can take the wheel** turn-by-turn by reading the state snapshot and
     returning actions when we want maximum skill pressure on the AI.
3. **`auditor.js`** — runs after every action and every phase; this is the Goal-1 engine.
   - Legality: coherency, DZ containment at deploy, impassable, move-cap not exceeded,
     shooting range/LoS/engagement legality, charge distance, phase-order sanity.
   - Scoring: VP/CP awarded correctly per mission + OC objective control.
   - Liveness: no phase softlock, game reaches round 5 / concession, no NaN positions.
   - Output: `findings.jsonl` tagged `{severity, category, game, round, phase, detail}`.
4. **`scoreboard.js`** — aggregates results across games/checkpoints into `SCOREBOARD.md`
   (win rate, avg VP margin, blunder counts, control-match trend).

The 3 real-UI games reuse `tools/shots/` (Playwright/Chromium; immune to the GUI-Brave
wedge) plus Solo mode in the actual app; the UX agent files findings into the same log.

---

## 2. Agent fleet (spawned only on Paul's go-ahead)

| Agent | Job | Runs |
|---|---|---|
| **Infra** | Build `tools/sim/` (runner, challenger, auditor, scoreboard) + first control baseline | once, up front |
| **Referee/Auditor** | Own `auditor.js`; triage every game's findings into a severity-ranked Goal-1 defect log | every game |
| **Challenger** | Play the strong opponent in agent-vs-AI games; probe for AI blunders | agent-vs-AI games |
| **AI-dev** | After each game, diagnose the built-in AI's worst decisions and patch `aiTargetScore`/`aiMovement`/`aiShooting`/`aiCharges`/`aiFights`/`AI_PLANS`/`AI_TUNE` | after each game |
| **UX/Playability** | Drive the ~3 real-UI games via `tools/shots` + Solo; file UX/flow bugs | 3 games |
| **Coordinator (me)** | Schedule, keep the control matchup, integrate patches, run `run_all.sh` + control re-runs, update SCOREBOARD | throughout |

Invariants every agent obeys (from `PLAN.md` §1.1): single HTML file, copyright line
(game-functional data only), both-peers-converge, backward-compatible saves,
`node --check` + `tools/tests/run_all.sh` green before any merge, no AI cheating
(AI sees only what a player would — no peeking at hidden reserves/secondaries).

---

## 3. The 10-game schedule

**Control matchup C** (fixed, 2000 pts, replayed every generation to measure AI gains):
built-in AI (side 2) = **T'au Kauyon**; challenger (side 1) = **Sororitas Hallowed
Martyrs**, Tier S; Official 1A, fixed seed. (Uses the 5 embedded meta lists.)

Every generation re-runs Control C (that's the measured curve); the "spotlight" column is
the extra varied game / focus that generation also explores. All 2000 pts.

| Gen | Drive | Challenger | Spotlight (beyond the Control C re-run) |
|---|---|---|---|
| 0 | headless | Tier N | Bring-up: first full 5-round game runs end-to-end; baseline all 3 fitness dims |
| 1 | headless | Tier S | Control C — first measured AI-as-defender baseline |
| 2 | **real UI** | Tier S (agent drives human) | Deploy→Command→Move→Shoot flow: playability pass |
| 3 | headless | Tier S | Dark Angels vs Drukhari — reserves/deep-strike & recon |
| 4 | headless | Tier N | Iron Hands vs T'au — shooting-army stalemate/scoring stress |
| 5 | **real UI** | Tier S | Fight phase: overwatch, pile-in/consolidate, fall-back UX |
| 6 | headless | Tier S | Drukhari vs Sororitas — fast melee, trade math, screening |
| 7 | headless | Tier S | Emphasis on the AI competencies (§5) still failing at gen 6 |
| 8 | **real UI** | Tier S | Cards/secondaries + CP/VP scoreboard + end-game UX |
| 9 | headless | Tier S | Fresh varied matchup — regression check on every prior fix |

Real-UI generations (2, 5, 8) cover the three phase clusters where playability bugs
concentrate (movement, fight, scoring/cards). The control re-run in gens 1, 4, 7, 9 gives
the AI-strength curve ≥4 measured points.

---

## 4. The iterate-and-measure loop (per game)

```
run game N (runner + auditor)
  → Referee: severity-rank Goal-1 findings (rules violations, softlocks, UX friction)
  → AI-dev:  from the jsonl, list the AI's N worst decisions + root cause
  → patch:   mechanics fixes (Goal 1) and/or AI heuristics (Goal 2), one concern per commit
  → verify:  node --check + run_all.sh green; add a regression test for each fix
  → measure: re-run Control C headless; append win-rate / VP-margin / blunder-rate to SCOREBOARD
  → gate:    if a fix regressed the control or the suite, revert before proceeding
```

Each game is a checkpoint. The AI should visibly climb the control curve; the defect log
should shrink in severity over the batch.

---

## 5. Success rubric

**Goal 1 — a good game can be played:**
- Every game reaches round 5 (or a legitimate concession) with **zero** auditor legality
  violations and no softlock.
- VP/CP/OC scoring matches the mission in 100% of scored events.
- The 3 real-UI games: each phase cluster is completable without a dead-end; every
  UX-blocker filed gets fixed or explicitly deferred with a reason.

**Goal 2 — the AI is a very good player** (tracked in SCOREBOARD across checkpoints):
- **Control win rate & avg VP margin** vs the challenger trend upward across Games 1→7→final.
- **Blunder rate** (auditor-flagged clearly-suboptimal decisions per game) trends down.
- Named competencies each demonstrably present by the end: holds/contests objectives,
  focus-fires to remove whole units, trades up not down, screens its backfield, times
  reserves, and does **not** overextend into bad charges. Each gets a targeted assertion.

---

## 6. Deliverables

- `tools/sim/` runner + challenger + auditor + scoreboard, with tests, in the suite.
- 10 battle reports (`game-NN.md`) + raw `jsonl`.
- `PLAYTEST-FINDINGS.md` — the severity-ranked Goal-1 defect log with resolutions.
- `SCOREBOARD.md` — the Goal-2 improvement curve.
- A series of small, tested, reverted-if-regressing commits improving mechanics + AI.
- Updated memory + a session-handoff entry.

---

## 7. Decisions (resolved 2026-07-08) & standing rules

- **Points:** 2000, Official layouts. **Challenger:** Tier S (agent-in-loop) on the
  skill-pressure generations, Tier N elsewhere. **Branch:** all work on `playtest`; no
  merge to `main`/Pages until Paul reviews the batch.
- **Fidelity is the gate**: any confirmed deviation from 11th-ed rules zeroes Playability
  fitness until fixed. When rules are ambiguous, cite the Core Rules Study Notes /
  Free Rules PDFs — never guess.
- **No AI cheating**: the challenger and AI each see only what a player would (no peeking
  at hidden reserves/secondaries). The AI's advantage must come from better decisions.
- **Every fix ships a regression test** and must keep `run_all.sh` + the control match
  green. Mutations that regress fitness are reverted (genetic selection).

## 9. Parallel multi-agent workflow (both streams at once)

From Gen 4 on, each generation runs **two lanes concurrently**, then a serialized integration gate.
Both lanes edit the same single-file app, so lanes are **isolated in git worktrees** off `playtest`
and the **coordinator (me) is the sole merge point + fidelity gatekeeper** — no two agents ever
write the app at the same time in the same tree.

**Lane A — AI strength (headless).** A worktree agent picks the next ranked lever from the Gen-1
diagnosis (e.g. #3 under-shooting), implements it in the AI functions, and **measures it itself on
the 5-seed `control.js` mean**. It keeps the change only if mean AIStrength beats the current best
(0.824) with 0 rules findings and `run_all.sh` green; commits to branch `playtest-ai-genN`.

**Lane B — playability / fidelity (real UI).** A worktree agent extends `tools/shots/playtest-ui.js`
to drive the target phase cluster (Gen 4→Fight phase: overwatch, pile-in/consolidate, fall-back),
hunts UX/flow/mechanics/fidelity bugs, fixes the clear ones in the UI layer, and **verifies via the
UI walkthrough** (0 console errors + screenshots reviewed). Files findings in `PLAYTEST-FINDINGS.md`;
commits to branch `playtest-ux-genN`.

**Disjoint edit regions** (keeps merges clean): Lane A touches AI logic (`aiShootUnit`, `aiMoveUnit`,
`aiChargeUnit`, `AI_TUNE`, `wp11*`); Lane B touches UI/HTML/dialog/flow. Agents are told to stay in
their region and never edit the other's.

**Integration gate (coordinator, serialized):**
1. Review each branch's diff for fidelity (rules-critical changes are mine to bless).
2. Merge Lane A, then Lane B, into `playtest`; resolve any overlap.
3. Re-run the **full gate on the merged result** to catch cross-lane interactions:
   `run_all.sh` (green) + `control.js` 5-seed mean (AIStrength ≥ prior best, 0 rules) +
   `playtest-ui.js` (0 console errors). Revert whichever lane regresses the merged whole.
4. Commit the integrated generation; update `SCOREBOARD.md`, `PLAYTEST-FINDINGS.md`, §8 log.

**Selection rule (genetic):** a lane's change survives only if it raises its own fitness dimension
*and* the merged result passes the full gate. Fidelity is absolute — any confirmed 11th-ed rules
deviation zeroes Playability and blocks the merge until fixed.

Remaining budget: Gens 4–9 (6 generations) to reach the 10-run total, each running both lanes.

### 9.1 Autonomous run (Paul: "keep iterating, deploy multiple agents, don't ask")

From Gen 5 on I run the loop **without checking in**. Each generation deploys **3 parallel agents**
in isolated worktrees (disjoint regions → clean merges):
- **Lane A — AI strength** (edits AI logic only): next ranked lever, self-measured on the 5-seed
  control; kept only if mean AIStrength beats the current legal best (**0.764** post-Gen-4).
- **Lane B — playability/fidelity** (edits UI/HTML only): next phase cluster through the real UI,
  fix clear issues, verify 0 console errors.
- **Lane C — diagnostics** (edits `tools/` only, never the app): runs the AI across *varied*
  matchups (not just Control C) to surface weaknesses the single control misses; emits a fresh
  ranked lever list to feed later generations.

Coordinator integrates each generation through the full gate (suite + 5-seed control + UI
walkthrough), keeps winners, reverts regressions, commits, updates SCOREBOARD/FINDINGS/§8.
**Fidelity stays absolute** (a rules violation zeroes Playability and blocks merge). After Gen 9,
merge `playtest`→`main`; the live Pages push is surfaced for Paul (needs GitHub re-auth, and the
Pages queue can stick — per ops notes) but everything is verified-playable on `playtest` throughout.

## 8. Generational log (append one block per generation)

**Gen 8 — P2P validated; AI levers honest-negative (2026-07-08).**
- **Lane B (playability) — KEPT, milestone:** the **two-window P2P game converges** — the app's
  founding "play my brother online" goal, never previously tested. `p2p-sync.js` loads the real app
  in two Playwright pages, deep-equals the synced `state` sub-tree after each op (20/20 steps, 8/8
  convergence checks, 0 errors), and a **live PeerJS connection over real WebRTC** propagated a host
  op to the guest (not sandbox-blocked). CP is derived per-peer (the classic desync trap) correctly.
  **No netcode bugs found** — value is the proof + a permanent regression harness. No app code changed.
- **Lane A (AI) — both levers not kept:**
  - *Melee aggression (#2):* the agent raised melee-action counts (DRU 2.3→3.5, AS 2.7→3.0) but every
    variant **hurt the target factions** (assault-only units trade down when they charge more) — matrix
    ≤0.719 < 0.722. **Reverted** (genetic discipline). Honest finding: more charges ≠ better for melee.
  - *P5-2 turn-loop ordering:* fixable, but reordering shooting-before-charge inherently **reshuffles
    the dice stream** (charge-dice vs shooting-dice interleave differently), dropping matrix 0.722→0.709
    and control 4W-1D-0L→3W-2D-0L. Per the standing rule (**non-fidelity changes must beat the metric**;
    only fidelity fixes are exempt), and since Gen 7 classified P5-2 as cosmetic (not a rules break),
    **coordinator rejected it.** Documented as a known-minor issue (P5-2) needing an RNG-neutral fix.
- **Net:** metric unchanged (matrix 0.722, Control 4W-1D-0L, 0 rules); a major playability milestone
  (P2P) banked. A generation can legitimately end with the AI unchanged when the levers don't clear
  the bar — that's selection working.
- **→ Gen 9 (final):** one more AI-strength attempt (gunline under-shooting #3, or an RNG-neutral P5-2),
  a final playability sweep, then merge `playtest` → `main`.



**Gen 7 — fidelity cleanup + full-game capstone (2026-07-08).** Cleared the Gen-6 fidelity debt and
validated a whole game on a live render. Both lanes merged clean.
- **Lane A (AI fidelity):** `aiReformUnit` re-forms unit coherency after casualties in all move exit
  paths (shortest straggler pull, respects move cap, no base overlap, non-charge 2.05" enemy gap,
  **consumes no `aiRng`**); hardened attach seating (`aiSeatAdjacent`, primary offsets byte-identical
  + guaranteed-gap fallback). **Matrix rules 1 → 0**, grand mean **0.722 unchanged** (fidelity at zero
  strength cost), Control 4W-1D-0L. +`ai-move-coherency-test.js` (fails pre-fix, passes post).
- **Lane B (playability):** capstone `fullgame-ui.js` — **a full 5-round solo game completes through
  the real UI, 20/20 steps, 0 console errors, deterministic**, correct "Game over" (10/10 CP). Fixed
  **P5-1** (casualty-allocation banner blocked clicks to units beneath it — pointer-events, same as
  P2-2). Found **P5-2** (AI shooting resolves one phase late — `aiShootUnit`/`aiPlanPhase` enqueue
  order; not a rules break, no damage lost) → handed to the AI lane.
- **Gate PASSED:** suite green (incl. 2 new tests) · **matrix 0 rules / grand mean 0.722** · Control
  win-record unchanged · full-game UI 0 errors · deterministic.
- **Milestone:** the app is now rules-clean across all 5 AI factions AND verified playable end-to-end.
- **→ Gen 8:** back to AI strength (melee aggression, diagnosis lever #2 — DRU/AS assault engines sit
  idle) + fix P5-2 turn-loop ordering; playability lane attempts the never-tested **two-window P2P**
  path (the original goal).



**Gen 6 — quality lists + deploy-coherency + the metric pivot (2026-07-08).** 3 lanes + a fix lane,
merged clean. A quality/fidelity/measurement win more than an AIStrength-number win.
- **Lane A (AI):** rebuilt `aiBuildList` into a quality-list builder (chaff-share cap, quality-weighted
  fill, per-datasheet share cap, Rule-of-Three). **De-hordes every faction** — T'au 154→37 models (a
  real elite battlesuit gunline; its own matrix score rose). Adopted after the metric pivot (below).
- **Lane B (UI):** enforce **P2-3** (Fell-Back blocks shoot+fight; Advanced blocks shoot, may still
  fight) at the `wp3Stage` chokepoint; movement-phase UI harness (14/14, 0 errors); +regression tests.
- **Lane D (fidelity):** fixed AI **deploy-coherency** — root cause was `aiAttachCharacters` leaving a
  solo character stranded at its deploy spot when the snuggle failed; repair pass consumes no `aiRng`
  (determinism preserved). +`deploy-coherency-test.js` (fails pre-fix, passes post-fix), in the suite.
- **Metric pivot (coordinator):** canonical AIStrength is now the **cross-faction matrix grand mean**,
  not single Control C — Control C rewarded the T'au horde Lane A correctly removed. Control C kept as
  a **win-record guardrail** (held 4W-1D-0L). See §fitness note.
- **Gate:** suite green (incl. new coherency test) · matrix grand mean **0.722** (baseline 0.717;
  ~flat number but far healthier distribution + trustworthy metric) · Control C win-record unchanged ·
  UI verified · deterministic.
- **NEW fidelity debt surfaced by the better lists + matrix (MUST fix before `main`):**
  1. **Movement coherency after casualties** — `aiMoveUnit` rigid-translates a unit but doesn't
     re-form coherency after it loses models; a depleted unit (e.g. SM Execrator) ends Movement
     incoherent (rounds 4–5). Pre-existing in the AI move code; Control C never exposed it.
  2. **Base overlap in `aiAttachCharacters`** snuggle (~−0.9" edge) — pre-existing, flagged by Lane D.
- **→ Gen 7 = fidelity cleanup** (clear both above) before chasing more AI strength.



**Gen 5 — first 3-lane parallel generation (2026-07-08).** All three lanes ran concurrently in
worktrees (two dropped on transient connection errors mid-run and were **resumed from context**;
one was relaunched clean — no work lost to the loop). Merged clean.
- **Lane A (AI):** #4 threat-aversion — added `AI_TUNE.holdThreat=0.55` so the AI holds/takes a
  forward objective under fire instead of retreating. **5-seed mean 0.764 → 0.776** (+0.012), mean
  trade +279→+337. Kept.
- **Lane B (playability):** drove Cards/secondaries/scoreboard/end-game through the real UI
  (`cards-ui.js`, 15/15, 0 errors). Fixed a **MAJOR** end-game fidelity gap — the app entered a
  phantom round-6 Command and auto-granted +1 CP/side; now suppressed past R5 with an explicit
  "Game over" cue (final CP correctly 10/10). Also: ranged-only Fire Overwatch (P2-4), a rounds-2–5
  "score primary" reminder. Flagged **shared-vs-hidden secondary hands** for Paul (deliberately left
  shared — a single-screen table aid; strict matched play hides hands).
- **Lane C (diagnostics):** `matrix.js` + `DIAGNOSIS-gen5.md` — AI across all 5 meta factions vs
  Tier-S. **Grand mean 0.702** (per-faction: SM 0.80 · DRU 0.71 · AS 0.66 · T'au 0.64). Structural
  finding: **`aiBuildList` pads most factions into fill-hordes** (T'au 154 models — anti-thematic,
  weak) — the #1 lever for Gen 6. Also caught the deploy-coherency fidelity bug (below).
- **Coordinator (integration gate caught a cross-lane interaction):** Lane B's end-game fix made the
  auditor's `cp-boundary` finding a false positive (it still subtracted the now-suppressed phantom
  CP). Corrected `driver.js` → **Control C is now a fully clean game: 0 findings, 0 rules.**
- **Gate PASSED:** suite green · 5-seed mean **0.776** · 0 findings / 0 rules · UI 9/9 0 errors ·
  deterministic. AIStrength curve (legal floor): 0.764 → **0.776**.
- **Queued for Gen 6:** (1) **fill-horde list builder** — highest lever (Lane C, +0.05–0.10 est.);
  (2) **deploy-coherency fidelity fix** — `aiPlaceUnit` sizes its grid gap from only `toks[0]`'s base
  and `aiDeployAll`'s fit-failure fallback leaves units at drop positions, so large/mixed-base units
  (e.g. Sororitas Hospitallers) can deploy out of coherency. Not Control-C-blocking (T'au is the
  control AI) but a real 11th-ed violation — fix before the final `main` merge.



**Gen 4 — first PARALLEL two-lane generation; big fidelity correction (2026-07-08).** Ran both
lanes concurrently in isolated worktrees; merged cleanly (disjoint regions held, no conflicts).
- **Lane A (AI, headless):** fixed chronic under-shooting — one gate in `wp11ScoreAdjust` so a
  gunline no longer hides out of LoS when it has a worthwhile shot. Agent measured it itself and
  **reverted two sub-levers that overfit** (lane-chasing → 0.78; `minShootExp` tuning → chaotic).
  Net +0.008 in isolation (0.824→0.832). Kept.
- **Lane B (playability, real UI):** drove the **Fight phase** end-to-end for the first time
  (`tools/shots/fight-ui.js`: overwatch, 2D6 charge, pile-in/consolidate 3" caps, fall-back) —
  **11/11 steps, 0 console errors.** Fixed the reminder-banner overlap (now click-through) and, most
  importantly, caught a **rules-gate violation: melee engagement range was 1" (10th ed), not 2"
  (11th ed)** in the UI (`wp3Stage`/`wp15DefaultWi`) — verified against Core Rules Study Notes L8.
- **Coordinator fidelity sweep (the headline):** the same 10th-vs-11th engagement bug lived in the
  **AI** too (Lane B flagged it as P2-6, out of its scope). Fixed all four AI sites (`aiTryTranslate`
  non-charge avoidance, `aiChargeUnit` skip + success threshold, `aiFightUnit` eligibility) to 2",
  and capped the AI charge move to the 2D6 roll (it was reaching base contact regardless of the roll).
- **Honest cost — a re-baseline, not a regression:** the 5-seed mean AIStrength **dropped 0.832 →
  0.764** because the AI had been *illegally* ending 1" from enemies and charging on 1" engagement.
  Removing that 10th-ed cheat is mandatory (fidelity is the hard gate) and legitimately weakens the
  AI — exactly like Gen 0. **The whole prior AIStrength curve was inflated by this; 0.764 is the true
  legal floor.** Future AI gains build from here.
- **Full integration gate PASSED:** `run_all.sh` green · 5-seed control 0 rules / all reach R5 ·
  UI walkthrough 9/9, 0 errors · deterministic. Playability up (Fight phase verified + 2 fixes),
  fidelity up (engagement range correct app-wide), AI honestly re-baselined.
- **Open (from Lane B):** P2-3 fell-back-can-still-act, P2-4 melee-weapon Overwatch, P2-5 no formal
  charge adjudication — all "assist vs adjudicate" calls, deferred.
- **Carry forward Gen 5:** now that engagement is 2" everywhere, re-mine AI strength on the honest
  0.764 floor (charge/positioning levers reopened by the 2" change), and continue playability
  (cards/scoreboard/end-game). Both lanes again.



**Gen 0 — bring-up + first fitness gate (2026-07-08).** `tools/sim/` built (runner,
Tier-N challenger, auditor, scoreboard). First full 2000-pt, 5-round, deterministic game
runs end-to-end: Sororitas (side 1, Tier N) vs T'au AI (side 2), Official 1A, seed 42.
- **Mutations kept** (all raised fitness, suite + control green):
  1. *Mechanics/fidelity:* `aiTryTranslate` capped total rigid-translation displacement to
     the unit's allowance — the AI was over-moving ~1–2" via obstacle-dodging offsets stacked
     on an already-M-capped vector. **4 confirmed 11th-ed rules violations → 0.** Regression
     test added (`wpmove-tests.js` (g)).
  2. *Process:* auditor `findings.jsonl` now truncates per run (was appending, leaking stale
     pre-fix findings across runs).
- **Fitness: 0.516 → 0.792** (Process 0.998 · Playability 0 gated → **0.98** · AIStrength 0.5).
- **Honest note:** removing the illegal over-move turned the AI's 45–40 "win" into a legit
  40–40 draw — that's the true baseline; AIStrength climbs from here on *legal* play.
- **Remaining (non-rules):** `cp-boundary` minor — stepping past round 5 enters a phantom
  round-6 Command that grants +1 CP/side. Low priority; queued for a later gen.
- **Carry forward to Gen 1:** build the Tier-S (agent-in-the-loop) challenger for the Control
  C match to put real skill pressure on the AI and get the first measured AIStrength point.

**Gen 1 — Tier-S challenger + first AI-strength gain (2026-07-08).** Built a strong
deterministic **Tier-S** side-1 challenger (army-coordinated focus fire, OC-aware movement
that holds forward objectives under fire, backfield screening, tie-up charges, timed reserves;
md5-deterministic, 0 rules findings). Ran Control C at Tier S and applied the top AI fix.
- **Mutations kept:**
  1. *Process:* **sharpened the AIStrength metric** — was W/L+VP-margin only, saturating at 0.5
     on draws so the loop was blind to real skill. Now blends outcome·0.30 + VP-margin·0.25 +
     objective-control·0.20 + attrition(points-weighted trade)·0.15 + list-completeness·0.10.
     Driver now emits `pointsCap` + a points-weighted `attrition` proxy.
  2. *AI strength:* fixed `aiBuildList` under-spend — it banked ~310 pts (fielded 1690/2000)
     every game. Added an **upsize pass** (grow picked squads to their largest affordable size)
     + a **fill pass** (Rule-of-Three copy cap, fidelity-safe) → AI now fields **1970/2000**.
- **Result:** Control C flipped from a 40–40 draw to a **legit AI win 45–35**; AI holds 2 objs
  to 1 and **trades up +520 pts** (killed 1100, lost 579). Deterministic, 0 rules findings.
- **Fitness: 0.792 → 0.924** (AIStrength 0.5 → **0.835**). Suite green.
- **Carry forward to Gen 2 (real-UI playability pass):** the AI is now a full-strength army;
  next tactical levers from the Gen-1 diagnosis (unranked-remaining): army-level focus-fire plan
  in `aiShooting` (#2), fix chronic under-shooting / over-cautious staging (#3), threat-aversion
  ceding objectives (#4), Kroot/melee screening (#5), reserve timing (#6). Real-UI generation
  next per schedule — watch the Brave-wedge; use `tools/shots` Playwright harness.

**Gen 2 — army-level focus fire (#2), and a process leap to multi-seed selection (2026-07-08).**
Paul chose to keep mining headless AI gains rather than start the real-UI passes yet.
- **Key process win — measurement was too noisy to trust.** A single deterministic seed nearly
  made me *keep a regression*: crude focus fire looked ~flat on seed 42 (0.835→0.826) but the
  real question is the average. Built `control.js` (Control C over 5 seeds: 42,7,99,123,2024) +
  `fitness.js` (AIStrength blend factored out, shared by scoreboard + control). **Mutations are
  now accepted/rejected on the 5-seed MEAN**, not one game.
- **Genetic selection in action on focus fire (#2):**
  - *Crude version* (4× "finish it" multiplier, applied from the first shooter): mean AIStrength
    **0.791 vs 0.803 baseline → REJECTED** (it dumped good guns into cheap chaff to "finish" it).
  - *Refined version* (first shooter picks by pure value; only follow-up shooters get a gentle
    1.4×/≤1.3× nudge to finish an in-progress kill): mean **0.824 vs 0.803 → KEPT.** Mean
    points-traded also rose +259→+343. AI now 5W-0D-0L across the seed set.
- **Mechanism:** module-level `aiFocus` ledger (expected damage committed per enemy unit this
  Shooting phase), reset each phase; a legal player choice (firing order), 0 rules findings.
- **Fitness (canonical = 5-seed mean AIStrength 0.824):** ~0.92, holding; the gain shows in
  trades and margin (mean +11→+12) more than the scalar. Suite green, deterministic.
- **Note:** SCOREBOARD.md single-game rows (seed 42) are a quick view; the **5-seed mean from
  `control.js` is now the authoritative selection metric.** Gen 0/1 rows predate it.
- **Carry forward to Gen 3:** lever #3 (chronic under-shooting / over-cautious round-1 staging) —
  idle guns are pure lost output, likely the next net-positive lever. Measure on the 5-seed mean.

**Gen 3 — first real-UI playability pass (Goal 1) (2026-07-08).** Paul asked to fold in a
playability pass rather than keep stacking AI-only generations. Drove a **solo game through the
actual UI** (`tools/shots/playtest-ui.js` + `discover.js`, Playwright/Chromium, Brave-wedge-immune):
real button clicks, phase stepper, the ⚔ attack-tool click-flow; captured console errors +
per-phase screenshots and reviewed them visually.
- **Result:** full solo game flows end-to-end with **0 console errors** (mission → deploy 78 →
  Solo/AI 39 → all 6 phases → attack tab → AI turn → casualty allocation → phone). **Closes the
  handoff's never-verified live-playthrough gap** for solo mode. Findings in `PLAYTEST-FINDINGS.md`.
- **Mutation kept (app / Goal 1):** Solo dialog defaulted the AI to **1000 pts** (lopsided vs a
  ~2000 player list) → now defaults to standard **2000** and auto-matches the player's loaded army
  to the nearest bracket (`aiSoloToggle`). Verified in-UI (dialog now reads 2000 for an 1875 list).
- Suite green; app node-check clean; headless control unaffected (UI-only change, sim uses `aiStart`
  directly). Open minor findings: reminder banner overlaps board (#2); imported lists undercost via
  "base datasheet pts" (#3, pre-existing import-pipeline gap).
- **Carry forward:** resume headless AI mining (lever #3 under-shooting) unless Paul redirects;
  real-UI Gen 5 (Fight phase) and Gen 8 (cards/scoreboard) still owed per schedule.
```
