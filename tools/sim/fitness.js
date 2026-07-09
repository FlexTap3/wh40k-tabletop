// fitness.js — the AIStrength blend, factored out so scoreboard.js (single game) and control.js
// (multi-seed average) compute it identically. AI = side 2.
//
//   AIStrength = 0.30·outcome + 0.25·VP-margin + 0.20·objective-control + 0.15·attrition + 0.10·list-completeness
//
// It blends the signals a strong player actually drives, because raw win/draw/loss + VP margin
// saturates at 0.5 on draws and can't see the AI out-trading a fixed opponent.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function aiStrengthOf(s) {
  const oc1 = (s.finalOc && s.finalOc.held1) || 0, oc2 = (s.finalOc && s.finalOc.held2) || 0;
  const attrDiff = (s.attrition && typeof s.attrition.diff === "number") ? s.attrition.diff : 0;
  const listPct = clamp((s.sideB.pts || 0) / (s.pointsCap || 2000), 0, 1);
  const outcomeC = s.winner === 2 ? 1 : s.winner === 0 ? 0.5 : 0;
  const marginC = clamp(((s.marginToAi || 0) + 30) / 60, 0, 1);   // ±30 VP → 1.0 / 0
  const ocC = clamp(0.5 + (oc2 - oc1) / 10, 0, 1);                 // objective-control edge (±5 objs)
  const attrC = clamp(0.5 + attrDiff / 1000, 0, 1);               // points-weighted trade edge (±1000 pts)
  const aiStrength = +(0.30 * outcomeC + 0.25 * marginC + 0.20 * ocC + 0.15 * attrC + 0.10 * listPct).toFixed(3);
  return { oc1, oc2, attrDiff, listPct, outcomeC, marginC, ocC, attrC, aiStrength };
}

module.exports = { aiStrengthOf, clamp };
