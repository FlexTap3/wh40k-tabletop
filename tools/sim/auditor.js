// auditor.js — rules & liveness watchdog. Runs after deploy, after every phase, and over
// each action record the challenger / AI produced. Findings go to findings.jsonl as
// {severity, category, gen, round, phase, detail, isRulesViolation}. Rules fidelity to 11th
// edition is the priority: anything that is a confirmed rules violation is tagged
// isRulesViolation:true and gates Playability to 0 (see scoreboard.js / PLAN §fitness).
//
// Rule citations: ../Notes/"11th Edition Core Rules - Study Notes.md".
//   - Coherency: multi-model units stay in 2" cohesion (app: checkCoherency, ≤2" near / >9" split).
//   - Engagement range is 2" horizontal (study notes §2); charges must end within engagement.
//   - Impassable terrain: a model may not END on a wall/crate, or inside a ruin without
//     INFANTRY/BEASTS/SWARM (app: wp5Illegal).
//   - Advance is +D6"; a normal move is capped at M" (study notes §turn structure).
//   - Shooting needs the target visible and within the weapon's range (app: losCheckUnits).

var AUDIT_FINDINGS = [];
function auditReset() { AUDIT_FINDINGS = []; }
function pushFinding(severity, category, round, phase, detail, isRulesViolation) {
  AUDIT_FINDINGS.push({
    severity, category, gen: SIM.config.game, round, phase,
    detail, isRulesViolation: !!isRulesViolation,
  });
}
const PH_NAME = ph => (["Command", "Movement", "Shooting", "Charge", "Fight", "End"][ph] || ("ph" + ph));
function unitM(ms) { return Math.min(...ms.map(t => (typeof t.Mv === "number" && t.Mv > 0) ? t.Mv : 6)); }

// ---- generic state scan: impassable / off-board / NaN / coherency ----
function auditStateScan(round, phase, opts) {
  opts = opts || {};
  const bw = state.board.w, bh = state.board.h;
  state.tokens.forEach(t => {
    if (!isFinite(t.x) || !isFinite(t.y)) {
      pushFinding("critical", "nan-position", round, phase, `${t.name} (owner ${t.owner}) has non-finite position (${t.x},${t.y})`, true);
      return;
    }
    const r = tokRadius(t);
    if (t.x < -0.5 || t.y < -0.5 || t.x > bw + 0.5 || t.y > bh + 0.5)
      pushFinding("major", "off-board", round, phase, `${t.name} (owner ${t.owner}) is off the battlefield at (${t.x.toFixed(1)},${t.y.toFixed(1)})`, true);
    if (wp5Illegal(t))
      pushFinding("major", "impassable", round, phase, `${t.name} (owner ${t.owner}) ends on impassable terrain (${wp5Illegal(t)})`, true);
  });
  // coherency is only *required* at the end of the owner's own movement — checking it after an
  // opponent's casualties would be a false positive (you re-cohere on your next move).
  if (opts.coherencyFor) {
    checkCoherency();
    const bad = new Set();
    state.tokens.forEach(t => { if (t.owner === opts.coherencyFor && incoherent.has(t.id)) bad.add(t.unit); });
    bad.forEach(uk => {
      const ms = state.tokens.filter(t => t.unit === uk);
      pushFinding("major", "coherency", round, phase, `${ms[0].name} (owner ${opts.coherencyFor}) is out of unit coherency after its Movement phase (${ms.length} models)`, true);
    });
  }
}

// ---- deployment: DZ containment + impassable + coherency ----
function auditDeploy(round) {
  const dz = state.dz || [];
  [1, 2].forEach(side => {
    const poly = dz[side - 1];
    if (!poly || poly.length < 3) { pushFinding("major", "deploy-dz", round, -1, `no deployment polygon for side ${side}`, false); return; }
    const outside = state.tokens.filter(t => t.owner === side && !wp7PtInPoly(t.x, t.y, poly));
    if (outside.length)
      pushFinding("major", "deploy-dz", round, -1, `${outside.length} side-${side} model(s) deployed outside their DZ (e.g. ${outside[0].name})`, true);
  });
  auditStateScan(round, -1, { coherencyFor: 1 });
  auditStateScan(round, -1, { coherencyFor: 2 });
}

// ---- move-cap: compare a per-token snapshot taken at Movement-phase start ----
// owner 1 (challenger) never advances → cap M+0.4; owner 2 (AI) may advance +D6 → cap M+6.5.
function auditMoveCap(round, owner, snapshot) {
  const byUnit = {};
  state.tokens.forEach(t => { if (t.owner === owner && snapshot[t.id]) (byUnit[t.unit] = byUnit[t.unit] || []).push(t); });
  for (const uk in byUnit) {
    const ms = byUnit[uk];
    const cap = unitM(ms) + (owner === 1 ? 0.4 : 6.5);
    let maxD = 0, worst = null;
    ms.forEach(t => { const s = snapshot[t.id]; const d = Math.hypot(t.x - s.x, t.y - s.y); if (d > maxD) { maxD = d; worst = t; } });
    if (maxD > cap)
      pushFinding("major", "move-cap", round, 1, `${worst.name} (owner ${owner}) moved ${maxD.toFixed(1)}" > cap ${cap.toFixed(1)}" (M ${unitM(ms)}")`, true);
  }
}

// ---- action-record legality (shooting range/LoS, charge distance) ----
function auditActions(round, phase, actions) {
  (actions || []).forEach(a => {
    if (a.type === "shoot") {
      if (!a.vis) pushFinding("major", "shoot-los", round, phase, `${a.unit} shot ${a.target} with no line of sight`, true);
      if (a.dist > a.rng + 0.05) pushFinding("major", "shoot-range", round, phase, `${a.unit} shot ${a.target} at ${a.dist}" > range ${a.rng}" (${a.weapon})`, true);
    } else if (a.type === "charge") {
      if (a.made && a.roll + 1.02 < a.need)
        pushFinding("critical", "charge-distance", round, phase, `${a.unit} completed a charge on ${a.target} needing ${a.need}" but rolled only ${a.roll}`, true);
    }
  });
}

// ---- CP: exactly +1 per side per Command phase entered ----
function auditCP(round, side, expectedCp1, expectedCp2) {
  if (state.trackers.cp1 !== expectedCp1)
    pushFinding("major", "cp-scoring", round, 0, `CP1 is ${state.trackers.cp1}, expected ${expectedCp1} after side ${side} Command`, true);
  if (state.trackers.cp2 !== expectedCp2)
    pushFinding("major", "cp-scoring", round, 0, `CP2 is ${state.trackers.cp2}, expected ${expectedCp2} after side ${side} Command`, true);
}

// ---- primary VP: verify the sim's scored value matches wp6Tallies for that side ----
function auditPrimary(round, side, scored) {
  const held = wp6Tallies().filter(x => x.holder === side).length;
  const expect = Math.min(15, held * 5);
  if (scored !== expect)
    pushFinding("major", "vp-scoring", round, 0, `side ${side} primary scored ${scored} but holds ${held} objective(s) → expected ${expect} (Take & Hold: 5/obj, max 15)`, true);
}

function auditFlush() {
  const p = SIM.path.join(SIM.out, "findings.jsonl");
  const lines = AUDIT_FINDINGS.map(f => JSON.stringify(f)).join("\n");
  SIM.fs.writeFileSync(p, (lines ? lines + "\n" : ""));   // overwrite per run — AUDIT_FINDINGS already holds the whole game; appending leaked stale pre-fix findings across runs
  return AUDIT_FINDINGS.slice();
}
