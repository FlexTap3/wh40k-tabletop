# Battle Report — Game 704

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 7

**Side 1 (Challenger, Tier S):** Drukhari — 20 units / 109 models / ~2000 pts (1 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 17 units / 158 models / ~2000 pts (1 in reserve)

## Result
- **Final VP:** Drukhari 35 — 40 T’au Empire
- **Winner:** T’au Empire (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 3 / 2
- **Reached round 5:** yes   |   **Runtime:** 2606 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 19 | 20 | 0 | 0 | 0 | 23 | 14 | 0 | 2–2 | 0–0 |
| 2 | 19 | 19 | 1 | 4 | 10 | 16 | 19 | 10 | 1–2 | 10–10 |
| 3 | 16 | 15 | 0 | 0 | 5 | 19 | 15 | 10 | 2–2 | 15–20 |
| 4 | 13 | 7 | 3 | 6 | 10 | 24 | 14 | 10 | 2–2 | 25–30 |
| 5 | 9 | 23 | 1 | 1 | 10 | 17 | 14 | 10 | 3–2 | 35–40 |

## Turning points
- Round 1: AI shooting/fighting removes 14 challenger models.
- Round 1: challenger removes 20 AI models.
- Round 2: AI shooting/fighting removes 19 challenger models.
- Round 2: challenger removes 23 AI models.
- Round 3: lead swings to T’au Empire (15–20).
- Round 3: AI shooting/fighting removes 15 challenger models.
- Round 3: challenger removes 15 AI models.
- Round 4: AI shooting/fighting removes 14 challenger models.
- Round 4: challenger removes 13 AI models.
- Round 5: AI shooting/fighting removes 14 challenger models.
- Round 5: challenger removes 24 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.