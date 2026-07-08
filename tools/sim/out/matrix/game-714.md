# Battle Report — Game 714

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 99

**Side 1 (Challenger, Tier S):** T’au Empire — 11 units / 78 models / ~1945 pts (1 in reserve)
**Side 2 (Built-in AI):** Adepta Sororitas — 16 units / 109 models / ~1970 pts (1 in reserve)

## Result
- **Final VP:** T’au Empire 35 — 40 Adepta Sororitas
- **Winner:** Adepta Sororitas (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 3
- **Reached round 5:** yes   |   **Runtime:** 1728 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 11 | 9 | 0 | 0 | 0 | 6 | 5 | 0 | 1–3 | 0–0 |
| 2 | 11 | 12 | 2 | 2 | 5 | 27 | 15 | 10 | 3–2 | 5–10 |
| 3 | 9 | 19 | 0 | 0 | 15 | 13 | 11 | 10 | 2–3 | 20–20 |
| 4 | 10 | 20 | 1 | 0 | 5 | 9 | 10 | 10 | 2–2 | 25–30 |
| 5 | 8 | 18 | 0 | 0 | 10 | 11 | 6 | 10 | 2–3 | 35–40 |

## Turning points
- Round 1: AI shooting/fighting removes 5 challenger models.
- Round 1: challenger removes 9 AI models.
- Round 2: lead swings to Adepta Sororitas (5–10).
- Round 2: AI shooting/fighting removes 15 challenger models.
- Round 2: challenger removes 14 AI models.
- Round 3: AI shooting/fighting removes 11 challenger models.
- Round 3: challenger removes 19 AI models.
- Round 4: lead swings to Adepta Sororitas (25–30).
- Round 4: AI shooting/fighting removes 10 challenger models.
- Round 4: challenger removes 20 AI models.
- Round 5: AI shooting/fighting removes 6 challenger models.
- Round 5: challenger removes 18 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.