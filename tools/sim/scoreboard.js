// scoreboard.js — computes a generation's three fitness numbers from a game's summary +
// findings and upserts a row into SCOREBOARD.md. Standalone Node (no app needed).
//
//   FITNESS = 0.2*Process + 0.4*Playability + 0.4*AIStrength   (weights per PLAN §fitness)
//   Playability is GATED to 0 by ANY confirmed 11th-ed rules violation (critical/major +
//   isRulesViolation). Fidelity is the hard gate; flow/fun is scored above it.
//
// Usage: node scoreboard.js [--game N] [--out <dir>] [--board <SCOREBOARD.md path>]
//
// The three numbers are first-pass baselines (documented below), meant to be tightened as the
// generational loop matures — not yet a validated skill metric.

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const a = { game: 0, out: path.join(__dirname, "out"), board: path.resolve(__dirname, "..", "..", "SCOREBOARD.md") };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--game") { a.game = +argv[i + 1]; i++; }
    else if (argv[i] === "--out") { a.out = argv[i + 1]; i++; }
    else if (argv[i] === "--board") { a.board = argv[i + 1]; i++; }
  }
  return a;
}
const A = parseArgs(process.argv);
const gid = String(A.game).padStart(2, "0");

const summaryPath = path.join(A.out, `game-${gid}.summary.json`);
if (!fs.existsSync(summaryPath)) { console.error("No summary:", summaryPath); process.exit(2); }
const s = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const f = s.findings || { total: 0, critical: 0, major: 0, minor: 0, rulesViolations: 0 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- Process: did the runner produce complete telemetry, finish, and run fast? ----
const artifacts = ["jsonl", "md", "summary.json"].filter(ext => fs.existsSync(path.join(A.out, `game-${gid}.${ext}`))).length;
const runtimeScore = clamp(1 - (s.runtimeMs || 0) / 120000, 0, 1);   // full credit under a few s, 0 by 120s
const process_ = +(0.4 * (artifacts / 3) + 0.3 * (s.reachedRound5 ? 1 : 0) + 0.3 * runtimeScore).toFixed(3);

// ---- Playability: GATED by rules fidelity, then discounted by non-rules defects ----
let playability;
if (f.rulesViolations > 0) playability = 0;                          // hard gate
else if (f.critical > 0) playability = 0.2;                          // softlock / liveness etc.
else playability = +clamp(1 - (f.major * 0.05 + f.minor * 0.02), 0, 1).toFixed(3);

// ---- AIStrength: the built-in AI is side 2 — reward it winning by a VP margin ----
const winC = s.winner === 2 ? 1 : s.winner === 0 ? 0.5 : 0;
const marginC = clamp(((s.marginToAi || 0) + 30) / 60, 0, 1);        // +30 VP → 1.0, −30 → 0
const aiStrength = +(0.5 * winC + 0.5 * marginC).toFixed(3);

const fitness = +(0.2 * process_ + 0.4 * playability + 0.4 * aiStrength).toFixed(3);

// ---- upsert the SCOREBOARD.md table ----
const header = [
  "# SCOREBOARD — WH40k playtest fitness curve",
  "",
  "`FITNESS = 0.2·Process + 0.4·Playability + 0.4·AIStrength`. Playability is **gated to 0** by any confirmed 11th-ed rules violation.",
  "",
  "| Gen | Matchup (S1 vs S2-AI) | Result (VP S1–S2) | R5 | Rules viol. | Findings (c/M/m) | Process | Playability | AIStrength | FITNESS |",
  "|-----|-----------------------|-------------------|----|-------------|------------------|---------|-------------|------------|---------|",
];
const row = `| ${s.gen} | ${s.sideA.name} vs ${s.sideB.name} | ${s.finalVp.side1}–${s.finalVp.side2} (${s.winner === 0 ? "draw" : "S" + s.winner}) | ${s.reachedRound5 ? "✓" : "✗"} | ${f.rulesViolations} | ${f.critical}/${f.major}/${f.minor} | ${process_} | ${playability} | ${aiStrength} | ${fitness} |`;

let rows = [];
if (fs.existsSync(A.board)) {
  const txt = fs.readFileSync(A.board, "utf8");
  rows = txt.split("\n").filter(l => /^\|\s*\d+\s*\|/.test(l));      // existing data rows
}
rows = rows.filter(l => !new RegExp(`^\\|\\s*${s.gen}\\s*\\|`).test(l)); // drop this gen if present
rows.push(row);
rows.sort((a, b) => (+a.match(/^\|\s*(\d+)/)[1]) - (+b.match(/^\|\s*(\d+)/)[1]));

const out = header.concat(rows, ["",
  "## Fitness definitions (first-pass baselines)",
  "- **Process** = 0.4·(artifacts complete) + 0.3·(reached round 5) + 0.3·(runtime, full credit under a few s).",
  "- **Playability** = 0 if any confirmed rules violation; else 0.2 if a non-rules critical (softlock/liveness); else 1 − (0.05·major + 0.02·minor).",
  "- **AIStrength** = 0.5·(AI win=1 / draw=0.5 / loss=0) + 0.5·(VP margin to AI, +30→1.0).",
  ""]).join("\n");
fs.writeFileSync(A.board, out);

console.log(`Gen ${s.gen}: Process ${process_} · Playability ${playability} · AIStrength ${aiStrength} · FITNESS ${fitness}`);
console.log(`  (rules violations: ${f.rulesViolations}; findings ${f.total}; winner ${s.winner === 0 ? "draw" : "side " + s.winner}; margin-to-AI ${s.marginToAi})`);
console.log(`  wrote ${A.board}`);
