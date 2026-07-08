# SCOREBOARD — WH40k playtest fitness curve

`FITNESS = 0.2·Process + 0.4·Playability + 0.4·AIStrength`. Playability is **gated to 0** by any confirmed 11th-ed rules violation.

| Gen | Matchup (S1 vs S2-AI) | Result (VP S1–S2) | R5 | Rules viol. | Findings (c/M/m) | Process | Playability | AIStrength | FITNESS |
|-----|-----------------------|-------------------|----|-------------|------------------|---------|-------------|------------|---------|
| 0 | Adepta Sororitas vs T’au Empire | 40–45 (S2) | ✓ | 4 | 0/4/1 | 0.998 | 0 | 0.792 | 0.516 |

## Fitness definitions (first-pass baselines)
- **Process** = 0.4·(artifacts complete) + 0.3·(reached round 5) + 0.3·(runtime, full credit under a few s).
- **Playability** = 0 if any confirmed rules violation; else 0.2 if a non-rules critical (softlock/liveness); else 1 − (0.05·major + 0.02·minor).
- **AIStrength** = 0.5·(AI win=1 / draw=0.5 / loss=0) + 0.5·(VP margin to AI, +30→1.0).
