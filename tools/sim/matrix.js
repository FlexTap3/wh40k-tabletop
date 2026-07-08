// matrix.js — run the built-in AI (side 2) across VARIED faction matchups, not just Control C.
// The single control (AS-challenger vs TAU-AI) can hide AI weaknesses that only show against
// other armies; this runs the AI as each meta faction vs a Tier-S challenger of a DIFFERENT
// faction, a few seeds each, and aggregates AIStrength per matchup so cross-faction weaknesses
// (things that generalize) surface separately from seed/faction quirks.
//
// AI factions = the distinct fids behind the 5 embedded meta lists. Note DA + Iron Hands both
// resolve to fid "SM" (aiBuildList/aiStart build from the DB by fid, not from the meta list text),
// so the distinct AI armies are AS, TAU, SM, DRU. SM is run twice (vs 2 challengers) for coverage.
//
// Usage: node matrix.js [--seeds 42,7,99] [--tier S]
// Deterministic (gamerunner seeds aiSeed + Math.random per game).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { aiStrengthOf } = require("./fitness");

function arg(name, def) { const i = process.argv.indexOf("--" + name); return i > -1 ? process.argv[i + 1] : def; }
const tier = arg("tier", "S");
const seeds = arg("seeds", "42,7,99").split(",").map(Number);
const outDir = path.join(__dirname, "out", "matrix");
fs.mkdirSync(outDir, { recursive: true });

const FAC = { AS: "Sororitas", TAU: "T'au", SM: "Space Marines", DRU: "Drukhari" };
// sideB = AI. Each AI faction faces a Tier-S challenger of a different faction.
const MATCHUPS = [
  { ai: "TAU", ch: "AS" },
  { ai: "TAU", ch: "DRU" },
  { ai: "SM",  ch: "AS" },
  { ai: "SM",  ch: "DRU" },
  { ai: "AS",  ch: "TAU" },
  { ai: "AS",  ch: "SM" },
  { ai: "DRU", ch: "TAU" },
  { ai: "DRU", ch: "SM" },
];

const results = [];
let gid = 700;
for (const m of MATCHUPS) {
  const rows = [];
  for (const seed of seeds) {
    const g = gid++;
    execFileSync("node", [path.join(__dirname, "gamerunner.js"),
      "--seed", String(seed), "--tier", tier, "--sideA", m.ch, "--sideB", m.ai,
      "--game", String(g), "--out", outDir], { stdio: "ignore" });
    const s = JSON.parse(fs.readFileSync(path.join(outDir, `game-${String(g).padStart(2, "0")}.summary.json`), "utf8"));
    const F = aiStrengthOf(s);
    rows.push({ seed, winner: s.winner, margin: s.marginToAi, oc1: F.oc1, oc2: F.oc2,
      aiPts: s.sideB.pts, chPts: s.sideA.pts, attr: F.attrDiff, r5: s.reachedRound5,
      rules: s.findings.rulesViolations, findings: s.findings.total, ais: F.aiStrength,
      aiShots: s.aiTotalShots, aiUnits: s.sideB.units, aiModels: s.sideB.models });
  }
  const mean = k => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(3);
  const wins = rows.filter(r => r.winner === 2).length, draws = rows.filter(r => r.winner === 0).length;
  results.push({ m, rows,
    meanAis: mean("ais"), meanMargin: mean("margin"), meanAttr: mean("attr"),
    meanOc2: mean("oc2"), meanOc1: mean("oc1"), meanAiPts: mean("aiPts"), meanShots: mean("aiShots"),
    aiUnits: rows[0].aiUnits, aiModels: rows[0].aiModels,
    wins, draws, losses: rows.length - wins - draws,
    anyRules: rows.some(r => r.rules > 0), allR5: rows.every(r => r.r5) });
}

// ---- print ----
console.log(`\nMatrix: built-in AI (side 2) vs Tier-${tier} challenger (side 1) — seeds ${seeds.join(",")}\n`);
console.log(`AI faction         vs Challenger    | W-D-L | meanAIStr | margin | trade | OC(ai-ch) | AIpts | shots | flags`);
console.log(`-------------------------------------|-------|-----------|--------|-------|-----------|-------|-------|------`);
for (const r of results) {
  const flags = (r.anyRules ? "RULES " : "") + (r.allR5 ? "" : "noR5");
  console.log(
    `${(FAC[r.m.ai] + " AI").padEnd(18)} vs ${FAC[r.m.ch].padEnd(13)} | ` +
    `${r.wins}-${r.draws}-${r.losses}   | ` +
    `${String(r.meanAis).padStart(6)}    | ` +
    `${String(r.meanMargin >= 0 ? "+" + r.meanMargin : r.meanMargin).padStart(6)} | ` +
    `${String(r.meanAttr >= 0 ? "+" + r.meanAttr : r.meanAttr).padStart(5)} | ` +
    `${(r.meanOc2 + "-" + r.meanOc1).padStart(9)} | ` +
    `${String(r.meanAiPts).padStart(5)} | ` +
    `${String(r.meanShots).padStart(5)} | ${flags}`);
}
// per-AI-faction rollup (average across that faction's matchups)
console.log(`\nPer-AI-faction rollup (mean AIStrength across its matchups):`);
const byAi = {};
for (const r of results) (byAi[r.m.ai] = byAi[r.m.ai] || []).push(r);
const rollup = Object.entries(byAi).map(([ai, rs]) => ({ ai,
  ais: +(rs.reduce((a, r) => a + r.meanAis, 0) / rs.length).toFixed(3),
  units: rs[0].aiUnits, models: rs[0].aiModels, pts: rs[0].meanAiPts }))
  .sort((a, b) => b.ais - a.ais);
for (const r of rollup)
  console.log(`  ${FAC[r.ai].padEnd(16)} meanAIStr ${r.ais}   (list: ${r.units} units / ${r.models} models / ${r.pts} pts)`);

const allAis = results.reduce((a, r) => a + r.meanAis, 0) / results.length;
console.log(`\nGRAND MEAN AIStrength across ${results.length} matchups: ${allAis.toFixed(3)}`);
const rulesM = results.filter(r => r.anyRules);
console.log(rulesM.length ? `⚠ RULES VIOLATIONS in: ${rulesM.map(r => FAC[r.m.ai] + " AI vs " + FAC[r.m.ch]).join(", ")}` : `✓ 0 rules violations across all matchups`);

fs.writeFileSync(path.join(outDir, "matrix-summary.json"), JSON.stringify({ tier, seeds, results, rollup, grandMean: +allAis.toFixed(3) }, null, 2));
