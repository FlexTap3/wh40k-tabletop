# Battle Report — Game 706

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier S):** Adepta Sororitas — 19 units / 114 models / ~1990 pts (1 in reserve)
**Side 2 (Built-in AI):** Space Marines — 14 units / 86 models / ~1975 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 30 — 50 Space Marines
- **Winner:** Space Marines (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 1 / 3
- **Reached round 5:** yes   |   **Runtime:** 3124 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 19 | 0 | 0 | 0 | 0 | 6 | 3 | 0 | 2–3 | 0–0 |
| 2 | 19 | 2 | 0 | 0 | 10 | 28 | 17 | 10 | 2–3 | 10–10 |
| 3 | 18 | 6 | 0 | 0 | 10 | 28 | 20 | 15 | 1–3 | 20–25 |
| 4 | 14 | 4 | 0 | 0 | 5 | 23 | 6 | 15 | 1–3 | 25–40 |
| 5 | 10 | 11 | 0 | 0 | 5 | 31 | 25 | 10 | 1–3 | 30–50 |

## Turning points
- Round 2: AI shooting/fighting removes 17 challenger models.
- Round 3: lead swings to Space Marines (20–25).
- Round 3: AI shooting/fighting removes 20 challenger models.
- Round 3: challenger removes 6 AI models.
- Round 4: AI shooting/fighting removes 6 challenger models.
- Round 4: challenger removes 4 AI models.
- Round 5: AI shooting/fighting removes 25 challenger models.
- Round 5: challenger removes 11 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.