# Battle Report — Game 717

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 99

**Side 1 (Challenger, Tier S):** Space Marines — 11 units / 63 models / ~1980 pts (1 in reserve)
**Side 2 (Built-in AI):** Adepta Sororitas — 19 units / 102 models / ~1975 pts (1 in reserve)

## Result
- **Final VP:** Space Marines 30 — 30 Adepta Sororitas
- **Winner:** Draw
- **Final CP:** 11 / 11   |   **Objectives held at end:** 3 / 2
- **Reached round 5:** yes   |   **Runtime:** 1576 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 11 | 8 | 0 | 0 | 0 | 5 | 13 | 0 | 0–2 | 0–0 |
| 2 | 10 | 19 | 0 | 0 | 0 | 13 | 12 | 10 | 1–3 | 0–10 |
| 3 | 9 | 17 | 1 | 2 | 5 | 7 | 1 | 10 | 3–2 | 5–20 |
| 4 | 9 | 10 | 0 | 0 | 15 | 3 | 1 | 5 | 2–3 | 20–25 |
| 5 | 10 | 21 | 3 | 2 | 10 | 4 | 1 | 5 | 3–2 | 30–30 |

## Turning points
- Round 1: AI shooting/fighting removes 13 challenger models.
- Round 1: challenger removes 8 AI models.
- Round 2: lead swings to Adepta Sororitas (0–10).
- Round 2: AI shooting/fighting removes 12 challenger models.
- Round 2: challenger removes 19 AI models.
- Round 3: challenger removes 19 AI models.
- Round 4: challenger removes 10 AI models.
- Round 5: challenger removes 23 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.