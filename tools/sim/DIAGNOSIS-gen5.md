# Gen-5 Cross-Faction AI Diagnosis (Lane C — diagnostics)

**Question this answers:** the single Control C matchup (Sororitas challenger vs T'au AI) can hide
AI weaknesses that only show against *other* armies. This lane ran the built-in AI (side 2) as
each meta faction against Tier-S challengers of *different* factions to surface weaknesses that
**generalize** across factions, and ranks the levers most worth spending future Lane-A budget on.

## Method & sample size (be honest)

- Runner: existing `gamerunner.js` / `driver.js` / `challenger.js` (Tier S) / `auditor.js`, plus a
  new aggregator **`tools/sim/matrix.js`**. Fully deterministic (`aiSeed` + mulberry32 per game).
- **8 matchups × 3 seeds (42, 7, 99) = 24 games.** Layout Official 1A, 2000 pts, AIStrength via the
  shared `fitness.js` blend (outcome·0.30 + VP-margin·0.25 + OC·0.20 + attrition·0.15 + list·0.10).
- The 5 embedded meta lists resolve to **4 distinct AI armies** — Dark Angels and Iron Hands are
  both `fid:"SM"`, and `aiStart→aiBuildList(fid,pts)` builds procedurally *from the DB by faction id*
  (it does **not** field the meta list text), so the AI's SM army is identical for both. SM is run
  against two challengers for coverage.
- **Sample caveat:** 3 seeds per cell is enough to rank levers and expose a structural pattern, not
  to certify a win-rate. Per-cell AIStrength has ±0.05-ish noise; the **per-faction rollup and the
  cross-faction trend are the trustworthy signal**, not any single cell.

## Matchup matrix (AI = side 2, Tier-S challenger = side 1)

| AI faction | vs Challenger | W-D-L | mean AIStr | mean margin | mean trade | mean OC (AI-ch) | AI list |
|---|---|---|---|---|---|---|---|
| **Space Marines** | Sororitas | 3-0-0 | **0.848** | +11.7 | +724 | 2.7–1.3 | 14u / 86m |
| **Space Marines** | Drukhari | 2-1-0 | 0.757 | +5.0 | +644 | 2.0–1.0 | 14u / 86m |
| **Drukhari** | T'au | 3-0-0 | 0.805 | +15.0 | +336 | 2.0–1.7 | 17u / 111m |
| **T'au** | Sororitas | 2-1-0 | 0.731 | +8.3 | +262 | 2.7–2.0 | 15u / 153m |
| **Sororitas** | T'au | 2-1-0 | 0.658 | +5.0 | −78 | 2.0–2.0 | 18u / 105m |
| **Sororitas** | Space Marines | 2-1-0 | 0.654 | +11.7 | −514 | 2.7–2.0 | 18u / 105m ⚠RULES |
| **Drukhari** | Space Marines | 2-1-0 | 0.613 | +5.0 | −868 | 2.3–1.7 | 17u / 111m ⚠RULES |
| **T'au** | Drukhari | 2-0-1 | **0.547** | −1.7 | −213 | 1.7–2.3 | 15u / 153m |

**Per-AI-faction rollup (mean AIStrength across its matchups):**

| AI faction | mean AIStr | list built by aiBuildList |
|---|---|---|
| Space Marines | **0.802** | 14 units / **61–86 models** / ~1968 pts |
| Drukhari | 0.709 | 17 units / ~110 models / ~1997 pts |
| Sororitas | 0.656 | 18 units / ~105 models / ~1977 pts |
| T'au | **0.639** | 15 units / **~153 models** / ~1978 pts |

**Grand mean AIStrength across 8 matchups: 0.702.** (For reference the Control-C 5-seed legal floor
post-Gen-4 is 0.764; the broader varied field is harder and drags the mean down — a healthy sign the
control was flattering the AI.)

## The one structural finding that explains the whole table

**Behavioral telemetry per AI faction (24 games):**

| AI faction | avg models | shoot-actions/game | shoot-actions **per model** | melee-actions/game | avg trade diff |
|---|---|---|---|---|---|
| Space Marines | 61 | 136.5 | **2.24** | 0.2 | **+684** |
| T'au | 154 | 87.5 | **0.57** | 1.2 | +24 |
| Drukhari | 110 | 81.2 | 0.74 | 4.0 | −266 |
| Sororitas | 108 | 68.0 | 0.63 | 2.3 | −296 |

The AI's ceiling is set at **list-build time, not in-game.** SM has few cheap chaff datasheets, so
`aiBuildList` is forced to keep it lean (61 models of quality) — and it dominates (+684 trade, 2.2
shots/model). Every other faction gets padded into a **fill-horde** (T'au **154** models!), which
under-shoots per model and trades even-to-down. This is the dominant cross-faction lever (below).

## Rules / fidelity findings

**Auditor totals across 24 games:** `5× major/coherency` (in 2 games) + `24× minor/cp-boundary`
(the known, non-violation round-6-Command CP artifact, 1/game). **Zero** move-cap, LoS, range,
impassable, or off-board findings — the Gen-4 2" engagement-range and rigid-translate cap fixes held
across all factions.

### VIOLATION: units can **deploy out of coherency** (`deployCard`)

- **Where:** flagged only in the two heaviest-fire games (vs SM challenger), but the root cause is
  deterministic and **latent for every faction**. Confirmed by direct reproduction
  (`tools/sim/dbg-coh.js`): mustering the Sororitas AI at seed 7 *after* the challenger (the real
  deploy order — the challenger consumes RNG and shifts the AI's deploy anchors) puts the 11-model
  **Hospitaller** unit down with one model at **edge-distance 2.13" from its nearest squadmate**,
  i.e. > the 2.02" coherency threshold, **before a single casualty**.
- **Root cause:** `deployCard` (wh40k-tabletop.html ~line 1174-1176) lays models on a
  `per = ceil(sqrt(total))` grid with a **fixed `gap = 1.6"` center-to-center**. That spacing ignores
  base radius, so in a unit mixing base sizes (a large-based character + small-based squad — e.g. a
  Hospitaller/Preacher attached to Battle Sisters) the grid geometry can push a corner model just
  past 2" from any squadmate. 11th-ed requires units to be set up in coherency, so this is a
  **fidelity-gate violation** (zeroes Playability in a game where it fires).
- **Fix (APP-side — outside Lane C's edit scope; flag for coordinator / Lane A-B):** make the grid
  gap scale with base size, e.g. `gap = max(1.6, maxBaseDiameterInUnit + 0.3)`, or place each model
  within 2" edge-distance of the previously-placed one. Add a regression assertion:
  `auditDeploy` coherency clean for all 5 meta factions at seeds 42/7/99.
- Lane C **cannot** touch `wh40k-tabletop.html`; this is documented here as a must-fix for the app.

## aiBuildList sanity — is it broken for any faction?

**No faction is broken.** All four AI armies muster legal, deterministic ~1968-1997-pt lists, deploy,
and play through to round 5 with no crashes. But the lists are **"legal-but-weak,"** and quality
varies sharply by faction:

- **Space Marines — good** (lean, 61-86 models, quality-dense). This is why SM tops the table.
- **T'au — poor.** 153 models is a Fire-Warrior/Kroot swarm, the opposite of the real T'au archetype
  (an elite battlesuit gunline). It under-shoots per model and only breaks even on trades despite
  being *the* shooting faction. The fill/upsize passes are actively fighting the faction's identity.
- **Drukhari / Sororitas — mediocre.** ~110 padded models that trade down; their expensive elite/
  assault units (Incubi, Repentia, Paragons) are diluted by cheap fill and then barely used in melee.

## Ranked cross-faction levers (the deliverable)

Ordered by expected AIStrength gain. Levers 1-3 & 5 are **Lane-A (AI-logic)** targets; Lever 4 is an
**app-fidelity must-fix** that Lane C cannot implement (documented for the coordinator/UI lane).

### 1. `aiBuildList` builds fill-hordes instead of quality lists — biggest single lever
- **Behavior:** the upsize pass (`~L3940-3943`) and fill pass (`~L3947-3958`) spend leftover points on
  the *biggest cheap infantry* available (`preferBig=true`, Rule-of-Three copies), maximizing model
  count. Result: T'au 154 models, DRU/AS ~110; only SM (no cheap chaff) stays lean and wins big.
- **Strong player:** builds to faction strength — T'au fields Riptides/Crisis/Broadsides, not a
  Fire-Warrior swarm; keeps a balanced spine (anti-tank + durable objective-holders + a hammer).
- **11th-ed principle:** list quality and firepower/durability *efficiency* win attrition; raw model
  count is not a virtue when the bodies can't shoot or survive.
- **App knob:** `aiBuildList` fill/upsize passes. Change the fill objective from "max bodies (prefer
  big)" to points-efficiency- and role-weighted picks: cap cheap-infantry share of the list (e.g.
  ≤35% of points), prefer completing missing roles (a heavy/anti-tank slot, an elite hammer) before
  padding, and for elite factions bias fill toward higher-cost quality datasheets. Keep a points
  floor (still spend ≥1950) so we don't regress the Gen-1 under-spend fix.
- **Fidelity risk:** low — still a legal list; risk is under-spending if the picker gets too choosy
  (mitigate with the floor).
- **Expected AIStrength gain:** **HIGH, +0.05 to +0.10** on the three horde factions' rollups (the
  SM-vs-rest gap is 0.80 vs 0.64-0.71). Best return in the whole diagnosis; measure on a
  *multi-faction* control, not just T'au-as-AI, so the win generalizes.

### 2. The AI barely fights in melee — assault factions wasted
- **Behavior:** melee-actions/game — DRU **4.0**, AS 2.3, T'au 1.2, SM 0.2. Drukhari (Incubi, Wyches,
  Hellions) and Sororitas (Repentia, Zephyrim) almost never charge; DRU still rolls 0.709 *despite*
  its assault engine sitting idle. `aiChargeUnit` (`~L4383`) only considers enemies 2-12" away with
  LoS and gates on `exp·chargeGain − meleeThreat > 0`, which rarely fires for a fragile assault unit
  vs a scary target; `aiFightUnit` does no pile-in/consolidate.
- **Strong player:** throws fast melee at gunlines to tie them up (denies their shooting), trades up,
  and screens with the charge.
- **11th-ed principle:** a successful charge shuts down the target's shooting and (with the right
  units) strikes first; melee removal is points-efficient for dedicated assault units.
- **App knob:** `aiChargeUnit` — raise `chargeGain` for ASSAULT/melee-keyword units and under the
  recon/disruption plan; add *objective-denial* and *shooting-shutdown* terms to charge profit so
  tying up a gunline is rewarded even when raw damage is modest; widen candidate discovery.
- **Fidelity risk:** low; over-aggression (feeding units) is bounded by the existing `tradeW` gate.
- **Expected gain:** **MED-HIGH, +0.03 to +0.06** concentrated on DRU and AS.

### 3. Gunlines under-shoot per model — idle guns (the persistent lever #3)
- **Behavior:** shoot-actions per model — SM 2.24 vs T'au **0.57**. Many T'au/horde units never fire
  (short-range cheap guns that never reach range, or over-cautious stage/hide). Pure lost tempo.
- **Strong player:** positions turn 1 so every gun has a target in range+LoS and fires every turn.
- **11th-ed principle:** unused shooting is unrecoverable tempo; a shooting army must trade fire.
- **App knob:** `aiMoveUnit` staging in `wp11ScoreAdjust` (`stageW`, `outgunnedRatio`, `hidW`,
  `hidExpThresh`) over-suppresses advancing into range; push shooters toward range earlier and reduce
  hide/stage weight when the unit already has a valid shot. **Partly downstream of Lever 1** — a lean
  list has longer-range, higher-quality guns and this lever shrinks once the horde is gone.
- **Fidelity risk:** low.
- **Expected gain:** **MED, +0.02 to +0.04** (overlaps Lever 1; measure them independently).

### 4. [FIDELITY MUST-FIX — app-side] Deploy-time coherency violation
- See the Rules findings section. `deployCard` fixed 1.6" grid gap ignores base radius → mixed-base
  units can be set up out of coherency (reproduced: Hospitaller at 2.13"). This is a **hard gate**
  (zeroes Playability when it fires), not an AIStrength lever. **Lane C cannot edit the app** — this
  is flagged for the coordinator / a UI-lane fix. Ship it with a deploy-coherency regression across
  all 5 meta factions.
- **Expected gain:** correctness, not strength — but it can zero a generation's Playability, so its
  *priority* is high even though its AIStrength delta is ~0.

### 5. Defensive trade-down going second — round-1 screening/positioning
- **Behavior:** as the second player the AI absorbs the alpha strike; AS/DRU post negative trades
  (−296 / −266) largely because round 1 the challenger out-removes them. Existing screen/stage knobs
  (`screenW`, `stageW`) exist but don't prevent the horde from standing in LoS turn 1.
- **Strong player:** deploys/screens out of the alpha's LoS, sacrifices chaff not the payload.
- **App knob:** `wp11ScoreAdjust` staging + `wp11ExtraCands` screening weights. **Substantially
  overlaps Levers 1 & 3** (a lean list has fewer bodies to expose and better guns to answer back).
- **Fidelity risk:** low.
- **Expected gain:** **LOW-MED, +0.01 to +0.03**, mostly subsumed by Lever 1 — lowest priority.

## Recommendation for future Lane-A generations

Spend the next AI-strength budget on **Lever 1 (`aiBuildList` quality)** first — it is the root cause
of the SM-vs-everyone-else gap and lifts three factions at once. Measure it on a **multi-faction
control** (rerun `matrix.js`, not just Control C) so the gain is confirmed to generalize rather than
overfitting T'au. Then **Lever 2 (melee aggression)** for the assault factions. Levers 3 and 5 will
partly resolve themselves once the horde-fill is gone; re-measure before spending separate budget on
them. Independently, get **Lever 4 (deploy coherency)** in front of the coordinator/UI lane — it is a
latent fidelity-gate violation, not an AI-strength item, but it can zero a generation.

## Reproduce

```
node tools/sim/matrix.js --seeds 42,7,99 --tier S     # the full matrix + rollup
node tools/sim/dbg-coh.js AS 7 SM                     # reproduce the deploy-coherency violation
```
