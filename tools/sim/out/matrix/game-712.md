# Battle Report — Game 712

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier S):** T’au Empire — 18 units / 163 models / ~1955 pts (1 in reserve)
**Side 2 (Built-in AI):** Adepta Sororitas — 18 units / 105 models / ~1990 pts (1 in reserve)

## Result
- **Final VP:** T’au Empire 35 — 45 Adepta Sororitas
- **Winner:** Adepta Sororitas (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 1
- **Reached round 5:** yes   |   **Runtime:** 3278 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 17 | 6 | 0 | 0 | 0 | 10 | 9 | 0 | 1–2 | 0–0 |
| 2 | 17 | 5 | 0 | 0 | 5 | 26 | 16 | 10 | 2–3 | 5–10 |
| 3 | 16 | 14 | 1 | 0 | 10 | 18 | 7 | 10 | 2–3 | 15–20 |
| 4 | 15 | 16 | 0 | 0 | 10 | 21 | 26 | 10 | 2–3 | 25–30 |
| 5 | 11 | 8 | 0 | 0 | 10 | 8 | 9 | 15 | 2–1 | 35–45 |

## Turning points
- Round 1: AI shooting/fighting removes 9 challenger models.
- Round 1: challenger removes 6 AI models.
- Round 2: lead swings to Adepta Sororitas (5–10).
- Round 2: AI shooting/fighting removes 16 challenger models.
- Round 2: challenger removes 5 AI models.
- Round 3: AI shooting/fighting removes 7 challenger models.
- Round 3: challenger removes 14 AI models.
- Round 4: AI shooting/fighting removes 26 challenger models.
- Round 4: challenger removes 16 AI models.
- Round 5: AI shooting/fighting removes 9 challenger models.
- Round 5: challenger removes 8 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.