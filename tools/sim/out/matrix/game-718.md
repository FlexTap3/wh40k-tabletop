# Battle Report — Game 718

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier S):** T’au Empire — 18 units / 163 models / ~1955 pts (1 in reserve)
**Side 2 (Built-in AI):** Drukhari — 17 units / 111 models / ~2000 pts (1 in reserve)

## Result
- **Final VP:** T’au Empire 35 — 50 Drukhari
- **Winner:** Drukhari (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 1 / 3
- **Reached round 5:** yes   |   **Runtime:** 2363 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 17 | 0 | 0 | 0 | 0 | 12 | 10 | 0 | 2–2 | 0–0 |
| 2 | 15 | 5 | 0 | 0 | 10 | 32 | 29 | 10 | 2–3 | 10–10 |
| 3 | 16 | 14 | 2 | 0 | 10 | 39 | 26 | 15 | 2–3 | 20–25 |
| 4 | 12 | 8 | 0 | 0 | 10 | 22 | 37 | 10 | 2–3 | 30–35 |
| 5 | 7 | 7 | 1 | 0 | 5 | 16 | 15 | 15 | 1–3 | 35–50 |

## Turning points
- Round 1: AI shooting/fighting removes 10 challenger models.
- Round 2: AI shooting/fighting removes 29 challenger models.
- Round 2: challenger removes 5 AI models.
- Round 3: lead swings to Drukhari (20–25).
- Round 3: AI shooting/fighting removes 26 challenger models.
- Round 3: challenger removes 14 AI models.
- Round 4: AI shooting/fighting removes 37 challenger models.
- Round 4: challenger removes 8 AI models.
- Round 5: AI shooting/fighting removes 15 challenger models.
- Round 5: challenger removes 7 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.