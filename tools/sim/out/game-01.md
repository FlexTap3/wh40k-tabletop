# Battle Report — Game 1

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier S):** Adepta Sororitas — 19 units / 114 models / ~1990 pts (1 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 15 units / 153 models / ~1970 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 35 — 45 T’au Empire
- **Winner:** T’au Empire (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 1 / 2
- **Reached round 5:** yes   |   **Runtime:** 4826 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 19 | 1 | 0 | 0 | 0 | 9 | 11 | 0 | 2–2 | 0–0 |
| 2 | 18 | 12 | 0 | 0 | 10 | 13 | 11 | 10 | 2–3 | 10–10 |
| 3 | 17 | 14 | 3 | 0 | 10 | 11 | 11 | 10 | 2–3 | 20–20 |
| 4 | 14 | 5 | 2 | 0 | 10 | 13 | 21 | 15 | 1–3 | 30–35 |
| 5 | 12 | 18 | 0 | 0 | 5 | 12 | 14 | 10 | 1–2 | 35–45 |

## Turning points
- Round 1: AI shooting/fighting removes 11 challenger models.
- Round 2: AI shooting/fighting removes 11 challenger models.
- Round 2: challenger removes 12 AI models.
- Round 3: AI shooting/fighting removes 11 challenger models.
- Round 3: challenger removes 14 AI models.
- Round 4: lead swings to T’au Empire (30–35).
- Round 4: AI shooting/fighting removes 21 challenger models.
- Round 4: challenger removes 5 AI models.
- Round 5: AI shooting/fighting removes 14 challenger models.
- Round 5: challenger removes 18 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.