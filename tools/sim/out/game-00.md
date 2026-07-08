# Battle Report — Game 0

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier N):** Adepta Sororitas — 20 units / 119 models / ~1990 pts (0 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 15 units / 123 models / ~1690 pts (1 in reserve)

## Result
- **Final VP:** Adepta Sororitas 40 — 45 T’au Empire
- **Winner:** T’au Empire (AI)
- **Final CP:** 11 / 11   |   **Objectives held at end:** 2 / 3
- **Reached round 5:** yes   |   **Runtime:** 662 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 18 | 8 | 0 | 0 | 0 | 10 | 10 | 0 | 2–3 | 0–0 |
| 2 | 15 | 9 | 0 | 0 | 10 | 11 | 12 | 10 | 2–2 | 10–10 |
| 3 | 10 | 17 | 0 | 0 | 10 | 11 | 10 | 10 | 2–2 | 20–20 |
| 4 | 5 | 14 | 0 | 0 | 10 | 6 | 11 | 10 | 2–3 | 30–30 |
| 5 | 4 | 11 | 2 | 0 | 10 | 8 | 4 | 15 | 2–3 | 40–45 |

## Turning points
- Round 1: AI shooting/fighting removes 10 challenger models.
- Round 1: challenger removes 8 AI models.
- Round 2: AI shooting/fighting removes 12 challenger models.
- Round 2: challenger removes 9 AI models.
- Round 3: AI shooting/fighting removes 10 challenger models.
- Round 3: challenger removes 17 AI models.
- Round 4: AI shooting/fighting removes 11 challenger models.
- Round 4: challenger removes 14 AI models.
- Round 5: lead swings to T’au Empire (40–45).
- Round 5: AI shooting/fighting removes 4 challenger models.
- Round 5: challenger removes 11 AI models.

## Auditor findings (5)
Rules violations: **4**  |  critical 0 · major 4 · minor 1

- major/move-cap: 4
- minor/cp-boundary: 1

First 10:
- [major] move-cap (r1 Movement): AI Kroot Carnivores moved 8.3" > cap 7.3" (M 7)
- [major] move-cap (r2 Movement): AI Kroot War Shaper moved 7.9" > cap 7.3" (M 7)
- [major] move-cap (r3 Movement): AI Strike Team moved 7.6" > cap 6.3" (M 6)
- [major] move-cap (r3 Movement): AI Breacher Team moved 6.9" > cap 6.3" (M 6)
- [minor] cp-boundary (r5 Command): final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is 10/10)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-N deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.