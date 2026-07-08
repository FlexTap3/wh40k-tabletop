# Battle Report — Game 716

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 7

**Side 1 (Challenger, Tier S):** Space Marines — 13 units / 77 models / ~1990 pts (1 in reserve)
**Side 2 (Built-in AI):** Adepta Sororitas — 17 units / 109 models / ~1995 pts (1 in reserve)

## Result
- **Final VP:** Space Marines 25 — 35 Adepta Sororitas
- **Winner:** Adepta Sororitas (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 3
- **Reached round 5:** yes   |   **Runtime:** 2366 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 12 | 21 | 0 | 0 | 0 | 7 | 3 | 0 | 1–2 | 0–0 |
| 2 | 13 | 12 | 0 | 0 | 5 | 20 | 8 | 10 | 1–3 | 5–10 |
| 3 | 11 | 9 | 1 | 0 | 5 | 15 | 4 | 10 | 1–3 | 10–20 |
| 4 | 9 | 23 | 0 | 0 | 5 | 15 | 8 | 10 | 2–2 | 15–30 |
| 5 | 6 | 5 | 0 | 0 | 10 | 4 | 0 | 5 | 2–3 | 25–35 |

## Turning points
- Round 1: challenger removes 21 AI models.
- Round 2: lead swings to Adepta Sororitas (5–10).
- Round 2: AI shooting/fighting removes 8 challenger models.
- Round 2: challenger removes 12 AI models.
- Round 3: AI shooting/fighting removes 4 challenger models.
- Round 3: challenger removes 9 AI models.
- Round 4: AI shooting/fighting removes 8 challenger models.
- Round 4: challenger removes 23 AI models.
- Round 5: challenger removes 5 AI models.

## Auditor findings (3)
Rules violations: **2**  |  critical 0 · major 2 · minor 1

- major/coherency: 2
- minor/cp-boundary: 1

First 10:
- [major] coherency (r1 ph-1): Hospitaller (owner 2) is out of unit coherency after its Movement phase (11 models)
- [major] coherency (r1 End): Hospitaller (owner 2) is out of unit coherency after its Movement phase (2 models)
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.