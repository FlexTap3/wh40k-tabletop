# Battle Report — Game 702

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 99

**Side 1 (Challenger, Tier S):** Adepta Sororitas — 19 units / 116 models / ~1995 pts (1 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 17 units / 176 models / ~1965 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 30 — 45 T’au Empire
- **Winner:** T’au Empire (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 2
- **Reached round 5:** yes   |   **Runtime:** 4712 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 19 | 0 | 0 | 0 | 0 | 6 | 2 | 0 | 1–2 | 0–0 |
| 2 | 19 | 21 | 1 | 0 | 5 | 20 | 24 | 10 | 2–3 | 5–10 |
| 3 | 16 | 24 | 2 | 0 | 10 | 10 | 7 | 15 | 1–3 | 15–25 |
| 4 | 15 | 20 | 0 | 0 | 5 | 8 | 4 | 10 | 2–3 | 20–35 |
| 5 | 13 | 29 | 1 | 1 | 10 | 14 | 12 | 10 | 2–2 | 30–45 |

## Turning points
- Round 2: lead swings to T’au Empire (5–10).
- Round 2: AI shooting/fighting removes 24 challenger models.
- Round 2: challenger removes 21 AI models.
- Round 3: AI shooting/fighting removes 7 challenger models.
- Round 3: challenger removes 24 AI models.
- Round 4: AI shooting/fighting removes 4 challenger models.
- Round 4: challenger removes 20 AI models.
- Round 5: AI shooting/fighting removes 12 challenger models.
- Round 5: challenger removes 30 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.