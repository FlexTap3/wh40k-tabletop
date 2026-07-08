# Battle Report — Game 711

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 99

**Side 1 (Challenger, Tier S):** Drukhari — 21 units / 125 models / ~2000 pts (1 in reserve)
**Side 2 (Built-in AI):** Space Marines — 9 units / 54 models / ~1980 pts (1 in reserve)

## Result
- **Final VP:** Drukhari 30 — 40 Space Marines
- **Winner:** Space Marines (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 1 / 2
- **Reached round 5:** yes   |   **Runtime:** 1187 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 21 | 2 | 0 | 0 | 0 | 15 | 15 | 0 | 2–2 | 0–0 |
| 2 | 19 | 0 | 0 | 0 | 10 | 26 | 32 | 10 | 2–2 | 10–10 |
| 3 | 15 | 11 | 1 | 0 | 10 | 41 | 22 | 10 | 1–2 | 20–20 |
| 4 | 11 | 7 | 1 | 0 | 5 | 24 | 23 | 10 | 1–2 | 25–30 |
| 5 | 7 | 4 | 1 | 1 | 5 | 21 | 13 | 10 | 1–2 | 30–40 |

## Turning points
- Round 1: AI shooting/fighting removes 15 challenger models.
- Round 2: AI shooting/fighting removes 32 challenger models.
- Round 3: AI shooting/fighting removes 22 challenger models.
- Round 3: challenger removes 11 AI models.
- Round 4: lead swings to Space Marines (25–30).
- Round 4: AI shooting/fighting removes 23 challenger models.
- Round 4: challenger removes 7 AI models.
- Round 5: AI shooting/fighting removes 13 challenger models.
- Round 5: challenger removes 5 AI models.

## Auditor findings (1)
Rules violations: **0**  |  critical 0 · major 0 · minor 1

- minor/cp-boundary: 1

First 10:
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.