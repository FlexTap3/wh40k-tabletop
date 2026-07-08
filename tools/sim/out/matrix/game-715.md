# Battle Report — Game 715

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier S):** Space Marines — 10 units / 31 models / ~1960 pts (1 in reserve)
**Side 2 (Built-in AI):** Adepta Sororitas — 19 units / 118 models / ~1990 pts (1 in reserve)

## Result
- **Final VP:** Space Marines 25 — 50 Adepta Sororitas
- **Winner:** Adepta Sororitas (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 1 / 3
- **Reached round 5:** yes   |   **Runtime:** 2070 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 10 | 5 | 0 | 0 | 0 | 5 | 3 | 0 | 1–3 | 0–0 |
| 2 | 10 | 6 | 0 | 0 | 5 | 18 | 4 | 10 | 1–3 | 5–10 |
| 3 | 7 | 20 | 1 | 0 | 5 | 15 | 0 | 15 | 2–3 | 10–25 |
| 4 | 7 | 13 | 2 | 0 | 10 | 17 | 3 | 10 | 1–3 | 20–35 |
| 5 | 5 | 9 | 2 | 0 | 5 | 17 | 6 | 15 | 1–3 | 25–50 |

## Turning points
- Round 1: challenger removes 5 AI models.
- Round 2: lead swings to Adepta Sororitas (5–10).
- Round 2: AI shooting/fighting removes 4 challenger models.
- Round 2: challenger removes 6 AI models.
- Round 3: challenger removes 20 AI models.
- Round 4: challenger removes 13 AI models.
- Round 5: AI shooting/fighting removes 6 challenger models.
- Round 5: challenger removes 9 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.