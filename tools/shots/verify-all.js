// verify-all.js — CAPSTONE playability gate. Runs EVERY UI harness in tools/shots/ in
// sequence against the CURRENT integrated app and reports a single pass/fail with the total
// console/page-error count across all harnesses. Does NOT modify the app.
//
// The bar (PLAN-playtest.md §5 / §9.1 Lane B): every harness passes with 0 console/page errors.
//
// Each harness writes shots-out/<name>-report.json with {steps:[{ok}], errors:[...]} (p2p also
// has {convergence:[{ok}]}). This runner spawns each harness as a child `node` process, then
// reads its report JSON as the source of truth for pass/fail + error count. discover.js is a
// surface-dump tool (no report); it is run as a smoke check — it must exit 0 and add no errors.
//
// Exit code: 0 iff every harness ran clean AND total console/page errors == 0.
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const DIR = __dirname;
const OUT = path.resolve(DIR, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

// Ordered list: [harness script, report json (null = discovery/no report)]
const HARNESSES = [
  ["playtest-ui.js", "ui-report.json"],
  ["fight-ui.js", "fight-report.json"],
  ["cards-ui.js", "cards-report.json"],
  ["move-ui.js", "move-report.json"],
  ["fullgame-ui.js", "fullgame-report.json"],
  ["p2p-sync.js", "p2p-report.json"],
  ["discover.js", null],
];

const readReport = f => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")); }
  catch (e) { return null; }
};

const results = [];
let totalErrors = 0;
let allPass = true;

for (const [script, reportFile] of HARNESSES) {
  // Freshen: remove any stale report so we never read a previous run's file.
  if (reportFile) { try { fs.unlinkSync(path.join(OUT, reportFile)); } catch (e) {} }

  const t0 = Date.now();
  console.log(`\n──────── running ${script} ────────`);
  const proc = spawnSync("node", [path.join(DIR, script)], { cwd: DIR, stdio: ["ignore", "inherit", "inherit"], timeout: 300000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  const crashed = proc.status !== 0 && proc.status !== null && !reportFile;
  const spawnErr = proc.error ? String(proc.error.message || proc.error) : null;

  if (!reportFile) {
    // discover.js: smoke only — pass iff it exited 0 (or null on timeout=fail) with no spawn error.
    const ok = proc.status === 0 && !spawnErr;
    if (!ok) allPass = false;
    results.push({ script, ok, steps: "—", errors: 0, note: spawnErr || (proc.status === 0 ? "surface dump ok" : `exit ${proc.status}`), secs });
    continue;
  }

  const rep = readReport(reportFile);
  if (!rep) {
    allPass = false;
    results.push({ script, ok: false, steps: "?/?", errors: "?", note: spawnErr || `no report (exit ${proc.status})`, secs });
    continue;
  }
  const stepsTotal = rep.steps ? rep.steps.length : 0;
  const stepsOk = rep.steps ? rep.steps.filter(s => s.ok).length : 0;
  const errCount = rep.errors ? rep.errors.length : 0;
  const convOk = rep.convergence ? rep.convergence.filter(c => c.ok).length : null;
  const convTotal = rep.convergence ? rep.convergence.length : null;
  const stepsPass = stepsOk === stepsTotal && stepsTotal > 0;
  const convPass = convTotal === null || convOk === convTotal;
  const ok = stepsPass && convPass && errCount === 0 && proc.status === 0;
  totalErrors += errCount;
  if (!ok) allPass = false;
  const convNote = convTotal !== null ? ` · conv ${convOk}/${convTotal}` : "";
  results.push({ script, ok, steps: `${stepsOk}/${stepsTotal}`, errors: errCount, note: (proc.status !== 0 ? `harness exit ${proc.status} · ` : "") + `${errCount} console/page err${convNote}`, secs });
}

console.log("\n\n════════════════════ VERIFY-ALL SUMMARY ════════════════════");
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.script.padEnd(16)} steps ${String(r.steps).padEnd(7)} err ${String(r.errors).padEnd(3)} (${r.secs}s)  ${r.note}`);
}
console.log("────────────────────────────────────────────────────────────");
console.log(`  ${allPass && totalErrors === 0 ? "✅ ALL HARNESSES PASS" : "❌ FAILURES PRESENT"}  ·  ${results.filter(r => r.ok).length}/${results.length} harnesses ·  ${totalErrors} TOTAL console/page errors`);
console.log("════════════════════════════════════════════════════════════");

fs.writeFileSync(path.join(OUT, "verify-all-report.json"), JSON.stringify({ allPass: allPass && totalErrors === 0, totalErrors, harnesses: results }, null, 2));

process.exit(allPass && totalErrors === 0 ? 0 : 1);
