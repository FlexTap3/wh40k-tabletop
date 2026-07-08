# Battle Report — Game 705

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 99

**Side 1 (Challenger, Tier S):** Drukhari — 21 units / 125 models / ~2000 pts (1 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 15 units / 148 models / ~1975 pts (1 in reserve)

## Result
- **Final VP:** Drukhari 50 — 35 T’au Empire
- **Winner:** Drukhari (challenger)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 1
- **Reached round 5:** yes   |   **Runtime:** 3094 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 21 | 15 | 0 | 0 | 0 | 17 | 21 | 0 | 2–3 | 0–0 |
| 2 | 18 | 35 | 1 | 0 | 10 | 19 | 9 | 5 | 2–2 | 10–5 |
| 3 | 15 | 23 | 2 | 0 | 10 | 19 | 15 | 10 | 3–2 | 20–15 |
| 4 | 14 | 18 | 2 | 4 | 15 | 21 | 13 | 10 | 3–2 | 35–25 |
| 5 | 11 | 10 | 2 | 0 | 15 | 14 | 6 | 10 | 2–1 | 50–35 |

## Turning points
- Round 1: AI shooting/fighting removes 21 challenger models.
- Round 1: challenger removes 15 AI models.
- Round 2: lead swings to Drukhari (10–5).
- Round 2: AI shooting/fighting removes 9 challenger models.
- Round 2: challenger removes 35 AI models.
- Round 3: AI shooting/fighting removes 15 challenger models.
- Round 3: challenger removes 23 AI models.
- Round 4: AI shooting/fighting removes 13 challenger models.
- Round 4: challenger removes 22 AI models.
- Round 5: AI shooting/fighting removes 6 challenger models.
- Round 5: challenger removes 10 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.