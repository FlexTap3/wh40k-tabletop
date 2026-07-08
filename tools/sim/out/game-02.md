# Battle Report — Game 2

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier N):** Adepta Sororitas — 20 units / 119 models / ~1990 pts (0 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 15 units / 123 models / ~1690 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 40 — 40 T’au Empire
- **Winner:** Draw
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 3
- **Reached round 5:** yes   |   **Runtime:** 686 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 18 | 8 | 0 | 0 | 0 | 9 | 7 | 0 | 2–3 | 0–0 |
| 2 | 15 | 10 | 1 | 1 | 10 | 14 | 13 | 10 | 2–2 | 10–10 |
| 3 | 9 | 6 | 0 | 0 | 10 | 14 | 14 | 10 | 2–2 | 20–20 |
| 4 | 6 | 14 | 1 | 2 | 10 | 5 | 6 | 10 | 2–3 | 30–30 |
| 5 | 2 | 14 | 1 | 5 | 10 | 14 | 7 | 10 | 2–3 | 40–40 |

## Turning points
- Round 1: AI shooting/fighting removes 7 challenger models.
- Round 1: challenger removes 8 AI models.
- Round 2: AI shooting/fighting removes 13 challenger models.
- Round 2: challenger removes 11 AI models.
- Round 3: AI shooting/fighting removes 14 challenger models.
- Round 3: challenger removes 6 AI models.
- Round 4: AI shooting/fighting removes 6 challenger models.
- Round 4: challenger removes 16 AI models.
- Round 5: AI shooting/fighting removes 7 challenger models.
- Round 5: challenger removes 19 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-N deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.