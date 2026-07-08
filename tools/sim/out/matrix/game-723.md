# Battle Report — Game 723

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 99

**Side 1 (Challenger, Tier S):** Space Marines — 11 units / 63 models / ~1980 pts (1 in reserve)
**Side 2 (Built-in AI):** Drukhari — 19 units / 111 models / ~1995 pts (1 in reserve)

## Result
- **Final VP:** Space Marines 30 — 35 Drukhari
- **Winner:** Drukhari (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 2
- **Reached round 5:** yes   |   **Runtime:** 2117 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 11 | 13 | 0 | 0 | 0 | 4 | 2 | 0 | 0–2 | 0–0 |
| 2 | 10 | 20 | 0 | 0 | 0 | 14 | 2 | 10 | 2–2 | 0–10 |
| 3 | 12 | 22 | 0 | 0 | 10 | 24 | 9 | 10 | 2–3 | 10–20 |
| 4 | 8 | 18 | 1 | 0 | 10 | 7 | 0 | 10 | 2–1 | 20–30 |
| 5 | 9 | 11 | 0 | 0 | 10 | 8 | 4 | 5 | 2–2 | 30–35 |

## Turning points
- Round 1: challenger removes 13 AI models.
- Round 2: lead swings to Drukhari (0–10).
- Round 2: challenger removes 20 AI models.
- Round 3: AI shooting/fighting removes 9 challenger models.
- Round 3: challenger removes 22 AI models.
- Round 4: challenger removes 18 AI models.
- Round 5: AI shooting/fighting removes 4 challenger models.
- Round 5: challenger removes 11 AI models.

## Auditor findings (4)
Rules violations: **3**  |  critical 0 · major 3 · minor 1

- major/coherency: 3
- minor/cp-boundary: 1

First 10:
- [major] coherency (r1 ph-1): Death Jester (owner 2) is out of unit coherency after its Movement phase (6 models)
- [major] coherency (r1 End): Death Jester (owner 2) is out of unit coherency after its Movement phase (6 models)
- [major] coherency (r2 End): Death Jester (owner 2) is out of unit coherency after its Movement phase (2 models)
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-S deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.