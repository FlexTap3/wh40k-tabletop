// control.js — run Control C across several seeds and average, so a single deterministic game's
// variance doesn't drive genetic accept/reject decisions. Each mutation is judged on the MEAN
// AIStrength over the seed set, not one game.
//
// Usage: node control.js [--tier S] [--seeds 42,7,99,123,2024] [--sideA AS] [--sideB TAU]
//
// Runs gamerunner per seed into out/control/, reads each summary, prints per-seed + mean AIStrength.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { aiStrengthOf } = require("./fitness");

function arg(name, def) { const i = process.argv.indexOf("--" + name); return i > -1 ? process.argv[i + 1] : def; }
const tier = arg("tier", "S");
const seeds = arg("seeds", "42,7,99,123,2024").split(",").map(Number);
const sideA = arg("sideA", "AS"), sideB = arg("sideB", "TAU");
const outDir = path.join(__dirname, "out", "control");
fs.mkdirSync(outDir, { recursive: true });

const rows = [];
for (const seed of seeds) {
  const gid = 900 + (seed % 90);   // keep control game ids out of the gen-numbered range
  execFileSync("node", [path.join(__dirname, "gamerunner.js"),
    "--seed", String(seed), "--tier", tier, "--sideA", sideA, "--sideB", sideB,
    "--game", String(gid), "--out", outDir], { stdio: "ignore" });
  const s = JSON.parse(fs.readFileSync(path.join(outDir, `game-${String(gid).padStart(2, "0")}.summary.json`), "utf8"));
  const F = aiStrengthOf(s);
  rows.push({ seed, winner: s.winner, margin: s.marginToAi, oc: `${F.oc2}-${F.oc1}`, aiPts: s.sideB.pts,
    attr: F.attrDiff, r5: s.reachedRound5, rules: s.findings.rulesViolations, ais: F.aiStrength });
}

const mean = k => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(3);
const wins = rows.filter(r => r.winner === 2).length, draws = rows.filter(r => r.winner === 0).length;
const anyRules = rows.some(r => r.rules > 0), allR5 = rows.every(r => r.r5);

console.log(`Control C (Tier ${tier}, ${sideA} vs ${sideB}-AI) over ${seeds.length} seeds: ${seeds.join(",")}`);
for (const r of rows)
  console.log(`  seed ${String(r.seed).padStart(4)}: ${r.winner === 2 ? "AI win " : r.winner === 0 ? "draw   " : "AI loss"}  margin ${String(r.margin).padStart(3)}  OC ${r.oc}  AIpts ${r.aiPts}  trade ${r.attr >= 0 ? "+" : ""}${r.attr}  AIStr ${r.ais}${r.rules ? "  ⚠RULES" : ""}${r.r5 ? "" : "  ⚠noR5"}`);
console.log(`  ── AI record: ${wins}W-${draws}D-${rows.length - wins - draws}L | mean margin ${mean("margin")} | mean trade ${mean("attr") >= 0 ? "+" : ""}${mean("attr")} | MEAN AIStrength ${mean("ais")}${anyRules ? "  ⚠ rules violation in a seed" : ""}${allR5 ? "" : "  ⚠ a seed missed R5"}`);
