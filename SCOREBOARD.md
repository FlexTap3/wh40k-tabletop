# SCOREBOARD — WH40k playtest fitness curve

`FITNESS = 0.2·Process + 0.4·Playability + 0.4·AIStrength`. Playability is **gated to 0** by any confirmed 11th-ed rules violation.

| Gen | Matchup (S1 vs S2-AI) | Result (VP S1–S2) | R5 | Rules viol. | AI signal (list·OC·trade) | Process | Playability | AIStrength | FITNESS |
|-----|-----------------------|-------------------|----|-------------|---------------------------|---------|-------------|------------|---------|
| 0 | Adepta Sororitas vs T’au Empire | 40–40 (draw) | ✓ | 0 | 0/0/1 | 0.998 | 0.98 | 0.5 | 0.792 |
| 1 | Adepta Sororitas vs T’au Empire | 35–45 (S2) | ✓ | 0 | 1970p · OC 2-1 · +520 | 0.988 | 0.98 | 0.835 | 0.924 |

## Fitness definitions (first-pass baselines)
- **Process** = 0.4·(artifacts complete) + 0.3·(reached round 5) + 0.3·(runtime, full credit under a few s).
- **Playability** = 0 if any confirmed rules violation; else 0.2 if a non-rules critical (softlock/liveness); else 1 − (0.05·major + 0.02·minor).
- **AIStrength** = 0.30·outcome(win 1/draw .5/loss 0) + 0.25·VP-margin(±30→1/0) + 0.20·objective-control(±5 objs) + 0.15·attrition(points-weighted trade, ±1000) + 0.10·list-completeness(AI pts fielded / cap).
