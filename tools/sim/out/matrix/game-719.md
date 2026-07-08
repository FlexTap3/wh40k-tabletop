# Battle Report — Game 719

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 7

**Side 1 (Challenger, Tier S):** T’au Empire — 19 units / 175 models / ~1985 pts (1 in reserve)
**Side 2 (Built-in AI):** Drukhari — 17 units / 104 models / ~2000 pts (1 in reserve)

## Result
- **Final VP:** T’au Empire 30 — 50 Drukhari
- **Winner:** Drukhari (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 2
- **Reached round 5:** yes   |   **Runtime:** 3023 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 16 | 1 | 0 | 0 | 0 | 14 | 32 | 0 | 2–3 | 0–0 |
| 2 | 15 | 10 | 0 | 0 | 10 | 22 | 31 | 10 | 1–3 | 10–10 |
| 3 | 15 | 19 | 0 | 0 | 5 | 25 | 26 | 10 | 1–3 | 15–20 |
| 4 | 11 | 13 | 0 | 0 | 5 | 14 | 18 | 15 | 2–3 | 20–35 |
| 5 | 8 | 19 | 0 | 0 | 10 | 16 | 15 | 15 | 2–2 | 30–50 |

## Turning points
- Round 1: AI shooting/fighting removes 32 challenger models.
- Round 2: AI shooting/fighting removes 31 challenger models.
- Round 2: challenger removes 10 AI models.
- Round 3: lead swings to Drukhari (15–20).
- Round 3: AI shooting/fighting removes 26 challenger models.
- Round 3: challenger removes 19 AI models.
- Round 4: AI shooting/fighting removes 18 challenger models.
- Round 4: challenger removes 13 AI models.
- Round 5: AI shooting/fighting removes 15 challenger models.
- Round 5: challenger removes 19 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.