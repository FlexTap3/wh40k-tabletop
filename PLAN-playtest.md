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

### The fitness function (evaluated every generation, logged to `SCOREBOARD.md`)

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

## 8. Generational log (append one block per generation)

> Gen 0 — (pending) bring-up. Baseline fitness TBD.
```
