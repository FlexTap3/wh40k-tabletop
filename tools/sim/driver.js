// driver.js — the game loop. Concatenated into the same eval scope as the app (see
// gamerunner.js), so it reads app globals (state, LAYOUTS, …) and calls the app's own
// mutation paths + challenger.js + auditor.js. Ends by calling simRun().
//
// Turn model (matches wp10-tests + the app's phase engine):
//   Deploy(-1) -> for round 1..5: side 1 plays Command..End via wp7Step + challengerActPhase,
//   then side 2's whole turn runs through aiFinishTurn(). CP is auto-granted by the app on
//   each Command phase; primary VP is scored by the sim (the app leaves VP manual) using
//   Take & Hold (5 VP per objective controlled, max 15/turn, battle rounds 2-5).

function simRun() {
  const CFG = SIM.config, fs = SIM.fs, path = SIM.path;
  const t0 = Date.now();

  // ---- determinism ----
  aiSeed(CFG.seed >>> 0);
  const mb = s => { let a = s; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  Math.random = mb(((CFG.seed * 2654435761) >>> 0) || 1);
  aiDelay = 1;
  document.getElementById("wp11AutoCas").checked = true;  // hands-off casualties for headless play

  auditReset();
  const records = [];
  const emit = o => { records.push(Object.assign({ gen: CFG.game }, o)); };
  const report = { rounds: [] };

  // ---- layout ----
  const key = Object.keys(LAYOUTS).find(k => k.startsWith(CFG.layout));
  if (!key) { console.error("No layout starting with:", CFG.layout); process.exitCode = 2; return; }
  document.getElementById("terrLayout").value = key;
  loadLayout();
  const missionName = (state.mission && state.mission.m) || "";

  // ---- armies: side 1 challenger, then side 2 built-in AI ----
  const chInfo = challengerMuster(CFG.sideA, CFG.pts);
  aiStart(CFG.sideB, CFG.pts);
  const census = side => { const by = {}; state.tokens.forEach(t => { if (t.owner === side) by[t.unit] = (by[t.unit] || 0) + 1; }); return { units: Object.keys(by).length, models: state.tokens.filter(t => t.owner === side).length }; };
  const aiPts = (state.cards[2] || []).reduce((s, c) => s + (parseInt(c.pts) || 0), 0);
  report.deploy = {
    layout: key, mission: missionName,
    sideA: { fid: CFG.sideA, name: (DB.factions.find(f => f[0] === CFG.sideA) || ["", CFG.sideA])[1], pts: chInfo.pts, ...census(1), reserves: (state.reserves[1] || []).length },
    sideB: { fid: CFG.sideB, name: (DB.factions.find(f => f[0] === CFG.sideB) || ["", CFG.sideB])[1], pts: aiPts, ...census(2), reserves: (state.reserves[2] || []).length },
  };
  auditDeploy(1);
  emit({ round: 0, phase: -1, phaseName: "Deploy", side: 0, type: "deploy", ...report.deploy });

  // ---- helpers ----
  const scorePrimary = side => Math.min(15, wp6Tallies().filter(x => x.holder === side).length * 5);
  const snapshotPositions = owner => { const s = {}; state.tokens.forEach(t => { if (t.owner === owner) s[t.id] = { x: t.x, y: t.y }; }); return s; };
  const ocLine = () => { const t = wp6Tallies(); return { held1: t.filter(x => x.holder === 1).length, held2: t.filter(x => x.holder === 2).length, contested: t.filter(x => x.holder === 0 && (x.oc1 || x.oc2)).length }; };
  const trackerSnap = () => ({ cp1: state.trackers.cp1, cp2: state.trackers.cp2, vp1: state.trackers.vp1, vp2: state.trackers.vp2 });

  // ---- phase loop ----
  wp7Step(1);                                  // Deploy -> round 1, side 1, Command (grants CP #1)
  let cmdCount = 0, guard = 0;
  let curRoundRep = null;
  const ensureRoundRep = r => { if (!curRoundRep || curRoundRep.round !== r) { curRoundRep = { round: r, side1: {}, side2: {} }; report.rounds.push(curRoundRep); } return curRoundRep; };

  while (state.trackers.round <= 5 && guard++ < 400) {
    const side = state.phase.side, ph = state.phase.ph, round = state.trackers.round;

    if (side === 1) {
      const rr = ensureRoundRep(round);
      if (ph === 0) {                          // Command
        cmdCount++;
        auditCP(round, 1, cmdCount, cmdCount);
        const acts = challengerActPhase(0);
        let vp = 0;
        if (round >= 2) { vp = scorePrimary(1); state.trackers.vp1 += vp; auditPrimary(round, 1, vp); }
        auditActions(round, 0, acts);
        rr.side1.commandVp = vp; rr.side1.shocks = acts.filter(a => a.type === "shock").length;
        acts.forEach(a => emit(Object.assign({ round, phase: 0, phaseName: "Command", side: 1 }, a)));
        emit({ round, phase: 0, phaseName: "Command", side: 1, type: "phase-end", vp1delta: vp, ...trackerSnap(), oc: ocLine() });
        wp7Step(1);
      } else if (ph === 1) {                    // Movement
        const snap = snapshotPositions(1);
        const acts = challengerActPhase(1);
        auditMoveCap(round, 1, snap);
        auditStateScan(round, 1, { coherencyFor: 1 });
        rr.side1.moves = acts.filter(a => a.type === "move" && a.moved > 0).length;
        acts.forEach(a => emit(Object.assign({ round, phase: 1, phaseName: "Movement", side: 1 }, a)));
        emit({ round, phase: 1, phaseName: "Movement", side: 1, type: "phase-end", ...trackerSnap(), oc: ocLine() });
        wp7Step(1);
      } else if (ph >= 2 && ph <= 4) {          // Shooting / Charge / Fight
        const acts = challengerActPhase(ph);
        auditActions(round, ph, acts);
        auditStateScan(round, ph, {});
        if (ph === 2) rr.side1.slainShoot = acts.reduce((s, a) => s + (a.slain || 0), 0);
        if (ph === 3) rr.side1.charges = acts.filter(a => a.made).length;
        if (ph === 4) rr.side1.slainFight = acts.reduce((s, a) => s + (a.slain || 0), 0);
        acts.forEach(a => emit(Object.assign({ round, phase: ph, phaseName: ["", "", "Shooting", "Charge", "Fight"][ph], side: 1 }, a)));
        emit({ round, phase: ph, phaseName: ["", "", "Shooting", "Charge", "Fight"][ph], side: 1, type: "phase-end", ...trackerSnap(), oc: ocLine() });
        wp7Step(1);
      } else {                                  // End
        rr.side1.endCensus = { s1: census(1).models, s2: census(2).models };
        emit({ round, phase: 5, phaseName: "End", side: 1, type: "phase-end", ...trackerSnap(), oc: ocLine() });
        wp7Step(1);                             // hand over to side 2 Command (grants that CP)
      }
    } else {                                    // side 2 = built-in AI, whole turn atomically
      const rr = ensureRoundRep(round);
      cmdCount++;
      auditCP(round, 2, cmdCount, cmdCount);
      let vp2 = 0;
      if (round >= 2) { vp2 = scorePrimary(2); state.trackers.vp2 += vp2; auditPrimary(round, 2, vp2); }
      const snap2 = snapshotPositions(2);
      const shotBefore = aiShotLog.length;
      const s1Before = census(1).models;
      const nameOf = uk => { const t = state.tokens.find(x => x.unit === uk); return t ? t.name : uk; };  // resolve before casualties remove targets
      const preNames = {}; state.tokens.forEach(t => { if (!(t.unit in preNames)) preNames[t.unit] = t.name; });
      aiFinishTurn();
      // Per-shot AI telemetry: grounds focus-fire / target-selection diagnosis (atk→tgt spread).
      for (let i = shotBefore; i < aiShotLog.length; i++) {
        const s = aiShotLog[i];
        emit({ round, phase: s.melee ? 4 : 2, phaseName: s.melee ? "AI-fight" : "AI-shoot", side: 2, type: "ai-shot",
          atk: preNames[s.atk] || s.atk, tgt: preNames[s.tgt] || s.tgt, weapon: s.weapon, dist: +(+s.dist).toFixed(1), rng: s.rng, melee: !!s.melee });
      }
      // AI shooting/fight legality from its own shot log
      for (let i = shotBefore; i < aiShotLog.length; i++) {
        const s = aiShotLog[i];
        if (s.melee) continue;
        if (!s.vis) pushFinding("major", "shoot-los", round, 2, `AI ${s.atk} shot ${s.tgt} with no LoS`, true);
        if (s.dist > s.rng + 0.05) pushFinding("major", "shoot-range", round, 2, `AI shot at ${s.dist.toFixed(1)}" > range ${s.rng}"`, true);
      }
      // AI move-cap: aiMoved[uk] carries this turn's {advanced,charged} per unit, so we can audit
      // the Movement move precisely and skip charge moves (which are capped by the 2D6 roll, not M).
      const byUnit = {};
      state.tokens.forEach(t => { if (t.owner === 2 && snap2[t.id]) (byUnit[t.unit] = byUnit[t.unit] || []).push(t); });
      for (const uk in byUnit) {
        const ms = byUnit[uk], mv = aiMoved[uk] || {};
        if (mv.charged) continue;                              // charge distance is the 2D6 roll, not M
        const cap = unitM(ms) + (mv.advanced ? 6.5 : 0.3);     // +D6 if advanced, else a hair of tolerance
        let maxD = 0, worst = null; ms.forEach(t => { const d = Math.hypot(t.x - snap2[t.id].x, t.y - snap2[t.id].y); if (d > maxD) { maxD = d; worst = t; } });
        if (maxD > cap) pushFinding("major", "move-cap", round, 1, `AI ${worst.name} moved ${maxD.toFixed(1)}" > cap ${cap.toFixed(1)}" (M ${unitM(ms)}${mv.advanced ? "+D6" : ""})`, true);
      }
      auditStateScan(round, 5, { coherencyFor: 2 });
      rr.side2 = { commandVp: vp2, aiShots: aiShotLog.length - shotBefore, s1LostToAi: s1Before - census(1).models, ...trackerSnap(), oc: ocLine() };
      emit({ round, phase: 5, phaseName: "AI-turn", side: 2, type: "ai-turn", commandVp: vp2, aiShots: aiShotLog.length - shotBefore, s1LostToAi: s1Before - census(1).models, ...trackerSnap(), oc: ocLine() });
    }
  }

  // ---- liveness ----
  const reachedR5 = state.trackers.round > 5;
  // Boundary artifact (not a violation): stepping past round 5 enters a round-6 Command, and the
  // app auto-grants +1 CP there. The game legitimately ends at the end of round 5, so the true
  // end-state CP is one lower per side than state.trackers shows. Logged for transparency.
  if (reachedR5 && state.phase.ph === 0 && state.phase.side === 1)
    pushFinding("minor", "cp-boundary", 5, 0, `final CP includes an extra +1/side from the round-6 Command entry when stepping past round 5 (true end-of-R5 CP is ${state.trackers.cp1 - 1}/${state.trackers.cp2 - 1})`, false);
  if (!reachedR5) pushFinding("critical", "liveness", state.trackers.round, -1, `game did not reach the end of round 5 (stopped at round ${state.trackers.round}, guard ${guard})`, false);
  if (guard >= 400) pushFinding("critical", "softlock", state.trackers.round, -1, `phase loop hit its guard (${guard}) — possible softlock`, false);

  const runtimeMs = Date.now() - t0;
  const findings = auditFlush();
  const rulesViolations = findings.filter(f => f.isRulesViolation && (f.severity === "critical" || f.severity === "major"));

  // ---- winner ----
  const final = trackerSnap();
  const winner = final.vp1 > final.vp2 ? 1 : final.vp2 > final.vp1 ? 2 : 0;
  const summary = {
    gen: CFG.game, seed: CFG.seed, tier: CFG.tier, layout: key, mission: missionName,
    sideA: report.deploy.sideA, sideB: report.deploy.sideB,
    finalVp: { side1: final.vp1, side2: final.vp2 }, finalCp: { side1: final.cp1, side2: final.cp2 },
    winner, marginToAi: final.vp2 - final.vp1, reachedRound5: reachedR5,
    finalOc: ocLine(), runtimeMs,
    findings: { total: findings.length, critical: findings.filter(f => f.severity === "critical").length, major: findings.filter(f => f.severity === "major").length, minor: findings.filter(f => f.severity === "minor").length, rulesViolations: rulesViolations.length },
    aiTotalShots: aiShotLog.length,
    pointsCap: CFG.pts,
    attrition: (() => {
      // Points-weighted trade proxy (AI = side 2). Per-token points aren't tracked, so approximate
      // each army's destroyed value as (fraction of models removed) × (army points). Positive diff = AI trades up.
      const s1s = report.deploy.sideA.models || 1, s2s = report.deploy.sideB.models || 1;
      const s1e = census(1).models, s2e = census(2).models;
      const killedByAi = (1 - s1e / s1s) * report.deploy.sideA.pts;
      const lostByAi = (1 - s2e / s2s) * report.deploy.sideB.pts;
      return { killedByAi: Math.round(killedByAi), lostByAi: Math.round(lostByAi), diff: Math.round(killedByAi - lostByAi),
        s1Models: [s1s, s1e], s2Models: [s2s, s2e] };
    })(),
  };

  // ---- write artifacts ----
  const base = path.join(SIM.out, "game-" + CFG.gameId);
  fs.writeFileSync(base + ".jsonl", records.map(r => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(base + ".summary.json", JSON.stringify(summary, null, 2));
  fs.writeFileSync(base + ".md", buildReport(summary, report, findings));

  console.log(`game-${CFG.gameId}: ${summary.sideA.name} (side1) ${final.vp1} VP  vs  ${summary.sideB.name} (side2 AI) ${final.vp2} VP` +
    `  | winner: ${winner === 0 ? "draw" : "side " + winner}  | round5: ${reachedR5}  | findings: ${findings.length} (${rulesViolations.length} rules)  | ${runtimeMs}ms`);
  process.exitCode = (reachedR5 && findings.filter(f => f.severity === "critical").length === 0) ? 0 : 1;
}

function buildReport(s, report, findings) {
  const L = [];
  L.push(`# Battle Report — Game ${s.gen}`);
  L.push("");
  L.push(`**Layout:** ${s.layout}  |  **Mission:** ${s.mission || "—"}  |  **Seed:** ${s.seed}`);
  L.push("");
  L.push(`**Side 1 (Challenger, Tier ${s.tier || "N"}):** ${s.sideA.name} — ${s.sideA.units} units / ${s.sideA.models} models / ~${s.sideA.pts} pts (${s.sideA.reserves} in reserve)`);
  L.push(`**Side 2 (Built-in AI):** ${s.sideB.name} — ${s.sideB.units} units / ${s.sideB.models} models / ~${s.sideB.pts} pts (${s.sideB.reserves} in reserve)`);
  L.push("");
  L.push(`## Result`);
  L.push(`- **Final VP:** ${s.sideA.name} ${s.finalVp.side1} — ${s.finalVp.side2} ${s.sideB.name}`);
  L.push(`- **Winner:** ${s.winner === 0 ? "Draw" : (s.winner === 1 ? s.sideA.name + " (challenger)" : s.sideB.name + " (AI)")}`);
  L.push(`- **Final CP:** ${s.finalCp.side1} / ${s.finalCp.side2}   |   **Objectives held at end:** ${s.finalOc.held1} / ${s.finalOc.held2}`);
  L.push(`- **Reached round 5:** ${s.reachedRound5 ? "yes" : "NO"}   |   **Runtime:** ${s.runtimeMs} ms`);
  L.push("");
  L.push(`## Per-round summary`);
  L.push("");
  L.push(`| Rd | S1 moves | S1 shoot-kills | S1 charges | S1 fight-kills | S1 primary | AI shots | S1 losses to AI | AI primary | OC (S1–S2) | VP (S1–S2) |`);
  L.push(`|----|----------|----------------|------------|----------------|-----------|----------|-----------------|-----------|-----------|-----------|`);
  report.rounds.forEach(r => {
    const a = r.side1 || {}, b = r.side2 || {};
    const oc = b.oc || { held1: "-", held2: "-" };
    L.push(`| ${r.round} | ${a.moves ?? "-"} | ${a.slainShoot ?? "-"} | ${a.charges ?? "-"} | ${a.slainFight ?? "-"} | ${a.commandVp ?? 0} | ${b.aiShots ?? "-"} | ${b.s1LostToAi ?? "-"} | ${b.commandVp ?? 0} | ${oc.held1}–${oc.held2} | ${b.vp1 ?? "-"}–${b.vp2 ?? "-"} |`);
  });
  L.push("");
  // turning points: biggest single-round losses + lead changes
  L.push(`## Turning points`);
  let prevLead = 0;
  const tps = [];
  report.rounds.forEach(r => {
    const b = r.side2 || {};
    if (b.vp1 != null) { const lead = Math.sign(b.vp1 - b.vp2); if (lead !== prevLead && lead !== 0) tps.push(`Round ${r.round}: lead swings to ${lead === 1 ? s.sideA.name : s.sideB.name} (${b.vp1}–${b.vp2}).`); prevLead = lead; }
    if ((b.s1LostToAi || 0) >= 4) tps.push(`Round ${r.round}: AI shooting/fighting removes ${b.s1LostToAi} challenger models.`);
    if ((r.side1 && r.side1.slainShoot || 0) + (r.side1 && r.side1.slainFight || 0) >= 4) tps.push(`Round ${r.round}: challenger removes ${(r.side1.slainShoot || 0) + (r.side1.slainFight || 0)} AI models.`);
  });
  if (!tps.length) tps.push("Grinding, low-lethality game — no single decisive swing.");
  tps.forEach(t => L.push(`- ${t}`));
  L.push("");
  L.push(`## Auditor findings (${findings.length})`);
  const rv = findings.filter(f => f.isRulesViolation && (f.severity === "critical" || f.severity === "major"));
  if (!findings.length) { L.push("None."); }
  else {
    L.push(`Rules violations: **${rv.length}**  |  critical ${findings.filter(f => f.severity === "critical").length} · major ${findings.filter(f => f.severity === "major").length} · minor ${findings.filter(f => f.severity === "minor").length}`);
    L.push("");
    const grp = {};
    findings.forEach(f => { const k = f.severity + "/" + f.category; grp[k] = (grp[k] || 0) + 1; });
    Object.keys(grp).sort().forEach(k => L.push(`- ${k}: ${grp[k]}`));
    L.push("");
    L.push(`First 10:`);
    findings.slice(0, 10).forEach(f => L.push(`- [${f.severity}] ${f.category} (r${f.round} ${PH_NAME(f.phase)}): ${f.detail}`));
  }
  L.push("");
  L.push(`## Notes`);
  L.push(`- Side 2 is the shipping built-in AI (only it can play side 2). Side 1 is the Tier-${s.tier || "N"} deterministic challenger in tools/sim/challenger.js.`);
  L.push(`- Primary VP is scored by the sim (Take & Hold: 5 VP per controlled objective, max 15/turn, rounds 2-5); the app itself leaves VP as manual entry.`);
  return L.join("\n");
}

simRun();
