# Battle Report — Game 713

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 7

**Side 1 (Challenger, Tier S):** T’au Empire — 19 units / 175 models / ~1985 pts (1 in reserve)
**Side 2 (Built-in AI):** Adepta Sororitas — 17 units / 104 models / ~1970 pts (1 in reserve)

## Result
- **Final VP:** T’au Empire 40 — 40 Adepta Sororitas
- **Winner:** Draw
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 2
- **Reached round 5:** yes   |   **Runtime:** 3008 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 16 | 2 | 0 | 0 | 0 | 11 | 6 | 0 | 2–3 | 0–0 |
| 2 | 13 | 14 | 0 | 0 | 10 | 15 | 18 | 10 | 2–2 | 10–10 |
| 3 | 18 | 12 | 2 | 0 | 10 | 27 | 21 | 10 | 2–2 | 20–20 |
| 4 | 15 | 6 | 0 | 0 | 10 | 33 | 31 | 10 | 2–3 | 30–30 |
| 5 | 13 | 15 | 1 | 0 | 10 | 22 | 17 | 10 | 2–2 | 40–40 |

## Turning points
- Round 1: AI shooting/fighting removes 6 challenger models.
- Round 2: AI shooting/fighting removes 18 challenger models.
- Round 2: challenger removes 14 AI models.
- Round 3: AI shooting/fighting removes 21 challenger models.
- Round 3: challenger removes 12 AI models.
- Round 4: AI shooting/fighting removes 31 challenger models.
- Round 4: challenger removes 6 AI models.
- Round 5: AI shooting/fighting removes 17 challenger models.
- Round 5: challenger removes 15 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.