# Battle Report — Game 701

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 7

**Side 1 (Challenger, Tier S):** Adepta Sororitas — 18 units / 107 models / ~1960 pts (1 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 16 units / 148 models / ~2000 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 35 — 45 T’au Empire
- **Winner:** T’au Empire (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 3
- **Reached round 5:** yes   |   **Runtime:** 4090 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 18 | 1 | 0 | 0 | 0 | 13 | 3 | 0 | 2–3 | 0–0 |
| 2 | 17 | 6 | 0 | 0 | 10 | 25 | 25 | 10 | 1–3 | 10–10 |
| 3 | 13 | 9 | 2 | 2 | 5 | 25 | 20 | 10 | 2–2 | 15–20 |
| 4 | 9 | 12 | 1 | 5 | 10 | 20 | 20 | 10 | 2–3 | 25–30 |
| 5 | 7 | 18 | 0 | 0 | 10 | 17 | 4 | 15 | 2–3 | 35–45 |

## Turning points
- Round 2: AI shooting/fighting removes 25 challenger models.
- Round 2: challenger removes 6 AI models.
- Round 3: lead swings to T’au Empire (15–20).
- Round 3: AI shooting/fighting removes 20 challenger models.
- Round 3: challenger removes 11 AI models.
- Round 4: AI shooting/fighting removes 20 challenger models.
- Round 4: challenger removes 17 AI models.
- Round 5: AI shooting/fighting removes 4 challenger models.
- Round 5: challenger removes 18 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.