# Battle Report — Game 707

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 7

**Side 1 (Challenger, Tier S):** Adepta Sororitas — 18 units / 107 models / ~1960 pts (1 in reserve)
**Side 2 (Built-in AI):** Space Marines — 11 units / 55 models / ~1975 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 40 — 45 Space Marines
- **Winner:** Space Marines (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 1 / 3
- **Reached round 5:** yes   |   **Runtime:** 1656 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 18 | 0 | 0 | 0 | 0 | 12 | 5 | 0 | 2–2 | 0–0 |
| 2 | 16 | 0 | 0 | 0 | 10 | 18 | 16 | 10 | 2–2 | 10–10 |
| 3 | 15 | 2 | 0 | 0 | 10 | 33 | 24 | 10 | 2–3 | 20–20 |
| 4 | 12 | 3 | 0 | 0 | 10 | 25 | 14 | 15 | 2–2 | 30–35 |
| 5 | 8 | 4 | 0 | 0 | 10 | 20 | 9 | 10 | 1–3 | 40–45 |

## Turning points
- Round 1: AI shooting/fighting removes 5 challenger models.
- Round 2: AI shooting/fighting removes 16 challenger models.
- Round 3: AI shooting/fighting removes 24 challenger models.
- Round 4: lead swings to Space Marines (30–35).
- Round 4: AI shooting/fighting removes 14 challenger models.
- Round 5: AI shooting/fighting removes 9 challenger models.
- Round 5: challenger removes 4 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.