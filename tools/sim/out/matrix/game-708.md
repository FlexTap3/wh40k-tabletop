# Battle Report — Game 708

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 99

**Side 1 (Challenger, Tier S):** Adepta Sororitas — 19 units / 116 models / ~1995 pts (1 in reserve)
**Side 2 (Built-in AI):** Space Marines — 12 units / 47 models / ~1955 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 25 — 35 Space Marines
- **Winner:** Space Marines (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 2
- **Reached round 5:** yes   |   **Runtime:** 1392 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 19 | 0 | 0 | 0 | 0 | 6 | 3 | 0 | 1–2 | 0–0 |
| 2 | 19 | 5 | 0 | 0 | 5 | 26 | 6 | 10 | 2–2 | 5–10 |
| 3 | 17 | 5 | 2 | 0 | 10 | 25 | 15 | 10 | 1–2 | 15–20 |
| 4 | 12 | 2 | 0 | 0 | 5 | 27 | 17 | 10 | 1–1 | 20–30 |
| 5 | 14 | 5 | 0 | 0 | 5 | 22 | 19 | 5 | 2–2 | 25–35 |

## Turning points
- Round 2: lead swings to Space Marines (5–10).
- Round 2: AI shooting/fighting removes 6 challenger models.
- Round 2: challenger removes 5 AI models.
- Round 3: AI shooting/fighting removes 15 challenger models.
- Round 3: challenger removes 5 AI models.
- Round 4: AI shooting/fighting removes 17 challenger models.
- Round 5: AI shooting/fighting removes 19 challenger models.
- Round 5: challenger removes 5 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.