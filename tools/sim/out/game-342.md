# Battle Report — Game 342

**Layout:** Official 1A · T&H vs T&H  |  **Mission:** Battlefield Dominance / Battlefield Dominance  |  **Seed:** 42

**Side 1 (Challenger, Tier N):** Space Marines — 10 units / 28 models / ~1980 pts (0 in reserve)
**Side 2 (Built-in AI):** T’au Empire — 16 units / 56 models / ~1985 pts (1 in reserve)

## Result
- **Final VP:** Space Marines 45 — 25 T’au Empire
- **Winner:** Space Marines (challenger)
- **Final CP:** 10 / 10   |   **Objectives held at end:** 2 / 1
- **Reached round 5:** yes   |   **Runtime:** 657 ms

## Per-round summary

| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |
|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|
| 1 | 10 | 13 | 0 | 0 | 0 | 3 | 2 | 0 | 1–1 | 0–0 |
| 2 | 5 | 7 | 0 | 0 | 5 | 2 | 2 | 5 | 2–2 | 5–5 |
| 3 | 5 | 10 | 0 | 0 | 10 | 16 | 4 | 10 | 3–2 | 15–15 |
| 4 | 6 | 11 | 2 | 0 | 15 | 4 | 2 | 5 | 3–2 | 30–20 |
| 5 | 6 | 3 | 2 | 0 | 15 | 7 | 2 | 5 | 2–1 | 45–25 |

## Turning points
- Round 1: challenger removes 13 AI models.
- Round 2: challenger removes 7 AI models.
- Round 3: AI shooting/fighting removes 4 challenger models.
- Round 3: challenger removes 10 AI models.
- Round 4: lead swings to Space Marines (30–20).
- Round 4: challenger removes 11 AI models.

## Auditor findings (2)
Rules violations: **2**  |  critical 0 · major 2 · minor 0

- major/coherency: 2

First 10:
- [major] coherency (r4 Movement): KILL TEAM SERGEANT, DEATHWATCH VETERAN (owner 1) is out of unit coherency after its Movement phase (5 models)
- [major] coherency (r5 Movement): GRAVIS VETERAN (owner 1) is out of unit coherency after its Movement phase (3 models)

## Notes
- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-N deterministic challenger in tools/sim/challenger.js.
- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.