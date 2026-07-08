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
| 2 | minor | UI | Per-phase reminder banner (e.g. "End of turn — Rapid Ingress may be used") renders over the top-right of the board. Useful coaching, dismissable, but overlaps tokens. | open (low) |
| 3 | minor | fidelity/import | Imported meta armies show "**base datasheet pts**" (e.g. Sororitas 1875, not 2000) — enhancements/proper costs aren't applied on import, so a player's list undercosts vs a legal 2000. Pre-existing (noted in handoff). | open (needs import-pipeline work) |

### Verified good (no action)
- Attack tab is faithful to 11th ed: Attacks/Hit/S/AP/D, Lethal/Sustained/Dev/Anti-X, re-roll
  hits/wounds, Cover(−1), Invuln, FNP, plus a Ld 2D6 battle-shock roller. Auto-populates from the ⚔ tool.
- Board legibility: leader rings, wound/model-count badges, objectives, terrain, DZ polygons all clear.
- Phone layout: board-first with bottom nav; the defender casualty-allocation flow (wounded-first
  rule + auto-assign) is presented cleanly on a 390px viewport.
- Solo dialog copy clearly explains sides, turn order, and to load a layout first.

**Next real-UI passes (per schedule):** Gen 5 — Fight phase (overwatch, pile-in/consolidate,
fall-back); Gen 8 — Cards/secondaries + CP/VP scoreboard + end-game. Consider fixing #2 then.
