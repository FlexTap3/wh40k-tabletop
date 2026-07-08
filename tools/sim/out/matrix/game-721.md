# Battle Report — Game 721

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier S):** Space Marines — 10 units / 31 models / ~1960 pts (1 in reserve)
**Side 2 (Built-in AI):** Drukhari — 17 units / 109 models / ~1995 pts (1 in reserve)

## Result
- **Final VP:** Space Marines 30 — 40 Drukhari
- **Winner:** Drukhari (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 1 / 3
- **Reached round 5:** yes   |   **Runtime:** 1073 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 10 | 1 | 0 | 0 | 0 | 9 | 3 | 0 | 1–2 | 0–0 |
| 2 | 10 | 18 | 0 | 0 | 5 | 14 | 4 | 10 | 2–3 | 5–10 |
| 3 | 8 | 23 | 0 | 0 | 10 | 20 | 1 | 10 | 2–3 | 15–20 |
| 4 | 7 | 14 | 2 | 3 | 10 | 22 | 5 | 10 | 1–3 | 25–30 |
| 5 | 6 | 12 | 0 | 0 | 5 | 7 | 5 | 10 | 1–3 | 30–40 |

## Turning points
- Round 2: lead swings to Drukhari (5–10).
- Round 2: AI shooting/fighting removes 4 challenger models.
- Round 2: challenger removes 18 AI models.
- Round 3: challenger removes 23 AI models.
- Round 4: AI shooting/fighting removes 5 challenger models.
- Round 4: challenger removes 17 AI models.
- Round 5: AI shooting/fighting removes 5 challenger models.
- Round 5: challenger removes 12 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.