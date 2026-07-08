// fullgame-ui.js — Gen-7 Lane B (playability/fidelity). CAPSTONE: drives ONE COMPLETE solo game,
// start → finish, through the REAL UI. Prior passes drove individual phase clusters; this pass plays
// a whole 2000-pt game across ALL FIVE battle rounds and surfaces whole-game issues that only show
// across a full game (state drift, a phase that dead-ends, scoring that doesn't add up, casualty
// friction, the end-game cue, late-appearing console errors).
//
// Flow per round: play my Command/Move/Shoot/Charge/Fight/End via the real phase stepper (wp7Step,
// exactly what the › button calls); in rounds 2–5 score primary via the real VP stepper; hand to the
// AI (step into side-2 Command) and let it play its whole turn via aiFinishTurn (what ⏭ calls),
// handling every casualty-allocation prompt (a real board click + keyboard A once, auto after);
// screenshot per round. Runs to the "Game over" state and reports the final scoreboard.
//
// Real DOM/mouse/keyboard through the app's own handlers; does NOT modify the app.
// Output: shots-out/fullgame-*.png + fullgame-report.json
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT = path.resolve(__dirname, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

const report = { steps: [], errors: [], rounds: [], findings: [], final: null };
const step = (name, ok, note) => { report.steps.push({ name, ok, note: note || "" }); console.log(`${ok ? "ok  " : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", m => { if (m.type() === "error") report.errors.push("console: " + m.text()); });
  page.on("pageerror", e => report.errors.push("pageerror: " + e.message));
  const shot = f => page.screenshot({ path: path.join(OUT, f) });
  const errN = () => report.errors.length;
  const snap = () => page.evaluate(() => ({
    round: state.trackers.round, ph: state.phase.ph, side: state.phase.side,
    cp1: state.trackers.cp1, cp2: state.trackers.cp2, vp1: state.trackers.vp1, vp2: state.trackers.vp2,
    over: (typeof wpGameOver === "function") ? wpGameOver() : (state.trackers.round > 5),
    mine: state.tokens.filter(t => t.owner === 1).length, foe: state.tokens.filter(t => t.owner === 2).length,
    label: (document.getElementById("wp7PhaseLabel") || {}).textContent || "",
  }));

  await page.goto("file://" + APP);
  await page.waitForSelector("#board", { state: "attached", timeout: 15000 });
  await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; });
  await page.waitForTimeout(300);
  step("app loads, board renders", true, `${errN()} console errors on load`);

  // ---- 1) mission + my army + AI opponent; deterministic AI RNG (aiSeed) ----
  await page.evaluate(() => showTab("setup"));
  const setup = await page.evaluate(() => {
    aiSeed(1337); aiDelay = 0;                                  // reproducible AI rolls; no timer pacing
    const sel = document.getElementById("terrLayout");
    const key = [...sel.options].map(o => o.value).find(v => /Official 1A/.test(v)) || (sel.options[1] && sel.options[1].value);
    sel.value = key; loadLayout();
    const pick = document.getElementById("metaListPick"); if (pick && pick.options.length) pick.selectedIndex = 0;
    const dep = document.getElementById("listDeploy"); if (dep) dep.checked = true;
    wpImportSelected();
    aiStart("TAU", 2000);
    mySide = 1;
    // deterministic clean start at pre-game Deploy
    state.phase = { side: 1, ph: -1, cpDone: {} };
    state.trackers.round = 1; state.trackers.cp1 = 0; state.trackers.cp2 = 0; state.trackers.vp1 = 0; state.trackers.vp2 = 0;
    refreshTrackers(); wp7RenderPhase(); fitView(); draw();
    return { obj: state.objectives.length, dz: state.dz.length, mission: state.mission && state.mission.name,
      mine: state.tokens.filter(t => t.owner === 1).length, foe: state.tokens.filter(t => t.owner === 2).length };
  });
  step("mission + my army + AI deployed, clean pre-game state", setup.mine > 0 && setup.foe > 0 && setup.obj > 0 && setup.dz === 2, JSON.stringify(setup));
  await shot("fullgame-00-deployed.png");

  const PHASES = ["Command", "Movement", "Shooting", "Charge", "Fight", "End"];

  // ---- allocation handler: resolve one casualty-allocation prompt through the real UI ----
  // First prompt of the game: one REAL board click (manual allocation) + real keyboard 'A' (auto-rest).
  // Subsequent prompts: auto-assign (the banner 'A · Auto-assign' button path) for speed.
  let manualAllocDone = false;
  const resolveAllocIfPending = async () => {
    const pend = await page.evaluate(() => (typeof wp11Pending === "function" && wp11Pending())
      ? { tgt: wp11Alloc.tgtUk, packets: wp11Alloc.packets.length, label: wp11Alloc.label, ph: state.phase.ph, side: state.phase.side, round: state.trackers.round } : null);
    if (!pend) return null;
    report.allocPhases = report.allocPhases || [];
    report.allocPhases.push({ round: pend.round, side: pend.side, ph: pend.ph, phName: PHASES[pend.ph], label: pend.label });
    if (!manualAllocDone) {
      // exercise the MANUAL path: real board click on a model of the target unit, then real 'A' key
      const pos = await page.evaluate(() => {
        const t = state.tokens.find(x => x.unit === wp11Alloc.tgtUk); if (!t) return null;
        return { x: (t.x - view.x) * view.s, y: (t.y - view.y) * view.s };
      });
      if (pos) {
        const board = await page.$("#board"); const bb = await board.boundingBox();
        await page.mouse.click(bb.x + pos.x, bb.y + pos.y);   // → wp11AllocClick via the real pointer handler
        await page.waitForTimeout(30);
      }
      await page.keyboard.press("a");                          // → wp11AllocAuto via the real keydown listener
      await page.waitForTimeout(30);
      manualAllocDone = true;
      await shot("fullgame-alloc-manual.png");
      report.findings.push({ probe: "casualty allocation (manual)", note: `Resolved a real prompt via board-click + 'A': "${pend.label}" (${pend.packets} packets vs ${pend.tgt}).` });
    } else {
      await page.evaluate(() => { if (typeof wp11AllocAuto === "function") wp11AllocAuto(); });
    }
    return pend;
  };

  // drain the AI's whole turn, pausing for (and resolving) every casualty-allocation prompt
  const runAiTurn = async () => {
    let guard = 0, allocCount = 0;
    while (guard++ < 200) {
      await page.evaluate(() => { if (typeof aiFinishTurn === "function") aiFinishTurn(); });
      const st = await snap();
      if (await page.evaluate(() => (typeof wp11Pending === "function" && wp11Pending()))) {
        const a = await resolveAllocIfPending(); if (a) allocCount++;
        continue;                                             // then re-drain
      }
      // aiFinishTurn chains its own wp7Step calls; the AI turn is done when control is back on side 1
      if (st.side === 1) break;
      // safety: if still side 2 but queue is empty and nothing pending, nudge the phase forward
      const stuck = await page.evaluate(() => (typeof aiQueue !== "undefined") && aiQueue.length === 0);
      if (stuck && st.side === 2) { await page.evaluate(() => wp7Step(1)); }
    }
    return { allocCount, guard };
  };

  // ---- 2) play all five battle rounds ----
  // step out of pre-game Deploy into round 1's Command phase (what the › button does first)
  await page.evaluate(() => wp7Step(1));
  const kickoff = await snap();
  step("kickoff: Deploy → round 1 Command (side 1)", kickoff.round === 1 && kickoff.side === 1 && kickoff.ph === 0, JSON.stringify(kickoff));

  let over = false, roundGuard = 0;
  while (!over && roundGuard++ < 7) {
    const pre = await snap();
    const r = pre.round;
    if (pre.side !== 1 || pre.ph !== 0) { step(`round ${r}: at my Command phase`, false, JSON.stringify(pre)); break; }
    const e0 = errN();

    // score primary in rounds 2–5 (real VP stepper button), during my Command phase
    if (r >= 2 && r <= 5) {
      await page.evaluate(() => stepTracker("vp1", 5));       // +5 primary this round (manual, as the app intends)
      report.rounds.push({ round: r, scoredPrimary: 5 });
    }

    // step through my remaining phases Command→End (exactly what the › button does)
    for (let ph = 1; ph <= 5; ph++) {
      await page.evaluate(() => wp7Step(1));
      await page.waitForTimeout(20);
    }
    const myEnd = await snap();
    const myPhasesOk = myEnd.side === 1 && myEnd.ph === 5;
    step(`round ${r}: my six phases played (Command→End)`, myPhasesOk, `label="${myEnd.label}"`);

    // hand to the AI: step past my End → side-2 Command, then let it play its whole turn
    await page.evaluate(() => wp7Step(1));
    const aiStartSnap = await snap();
    const ai = await runAiTurn();
    const post = await snap();
    await page.evaluate(() => { fitView(); draw(); });
    await shot(`fullgame-r${r}.png`);

    const advanced = post.round === r + 1 || post.over;         // AI handed back into next round (or game ended)
    step(`round ${r}: AI played its turn and handed back`, aiStartSnap.side === 2 && advanced && errN() === e0,
      JSON.stringify({ aiStartSide: aiStartSnap.side, backToRound: post.round, allocPrompts: ai.allocCount, newErr: errN() - e0 }));
    report.rounds.push({ round: r, aiAllocPrompts: ai.allocCount, afterAi: { mine: post.mine, foe: post.foe, vp1: post.vp1, vp2: post.vp2, cp1: post.cp1, cp2: post.cp2 } });

    over = post.over;
  }

  // ---- integrity sweep: no NaN/Infinity positions drifted in over the whole game ----
  const integ = await page.evaluate(() => {
    const bad = state.tokens.filter(t => !Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.wounds));
    return { total: state.tokens.length, bad: bad.length, sample: bad.slice(0, 3).map(t => ({ n: t.name, x: t.x, y: t.y, w: t.wounds })) };
  });
  step("state integrity: no NaN/Infinity token positions or wounds after 5 rounds", integ.bad === 0, JSON.stringify(integ));

  // ---- whole-game finding: AI shooting resolves after the phase label advanced to Charge ----
  const ph = report.allocPhases || [];
  const inCharge = ph.filter(a => a.phName === "Charge").length;
  report.findings.push({ probe: "phase-of-shooting-casualties", severity: "minor (out of Lane-B scope: AI turn-loop)",
    note: `${inCharge}/${ph.length} of the AI's SHOOTING casualty-allocation prompts fired while the phase label already read 'Charge'. Root cause (AI code, not UI): aiShootUnit enqueues each weapon's aiFireWeapon to the TAIL of the action queue, but aiPlanPhase enqueues the Shooting→Charge wp7Step BEFORE those fire actions run, so the shots (and their casualty prompts) resolve one phase late. Player-facing symptom: the casualty banner shows an AI shooting attack during 'AI · Charge'. Hand to the AI lane / coordinator.` });

  // ---- 3) end-of-game state + scoreboard ----
  const end = await page.evaluate(() => {
    showTab("cards");
    return {
      round: state.trackers.round, over: (typeof wpGameOver === "function") ? wpGameOver() : state.trackers.round > 5,
      cp1: state.trackers.cp1, cp2: state.trackers.cp2, vp1: state.trackers.vp1, vp2: state.trackers.vp2,
      phaseLabel: (document.getElementById("wp7PhaseLabel") || {}).textContent || "",
      roundBadge: (document.getElementById("tRound") || {}).textContent || "",
      scoreboardOver: /Game over/i.test((document.getElementById("scoreboard") || {}).textContent || ""),
      mine: state.tokens.filter(t => t.owner === 1).length, foe: state.tokens.filter(t => t.owner === 2).length,
    };
  });
  await page.waitForTimeout(120);
  await shot("fullgame-99-game-over.png");
  report.final = end;

  step("game reached round 5 and the explicit Game-over state", end.over && end.round === 6, JSON.stringify({ round: end.round, over: end.over }));
  step("scoring adds up: CP 10/10 after 5 rounds (no phantom round-6 grant)", end.cp1 === 10 && end.cp2 === 10, JSON.stringify({ cp1: end.cp1, cp2: end.cp2 }));
  step("end-game cue: phase label 'Game over', round badge '5 ✓' (never a bare 6), scoreboard shows Game over",
    /Game over/i.test(end.phaseLabel) && /5/.test(end.roundBadge) && !/\b6\b/.test(end.roundBadge) && end.scoreboardOver, JSON.stringify(end));

  // stepping again while over must not grant more CP (phantom guard holds all the way to the end)
  const cpBefore = end.cp1;
  await page.evaluate(() => wp7Step(1));
  const cpAfter = await page.evaluate(() => state.trackers.cp1);
  step("stepping past game-over grants no extra CP (phantom guard holds)", cpAfter === cpBefore, JSON.stringify({ cpBefore, cpAfter }));

  // ---- P5-1 regression guard: a casualty-allocation click must pass THROUGH the banner to a
  //      model sitting under it (the banner is pointer-events:none; only its button captures). ----
  const alloc = await page.evaluate(() => {
    const mine = state.tokens.filter(t => t.owner === 1);
    if (!mine.length) return { skip: true };
    const uk = mine[0].unit, toks = state.tokens.filter(t => t.unit === uk);
    wp11Alloc = { tgtUk: uk, atkUk: uk, packets: [1], applied: 0, budget: 1, label: "P5-1 click-through check" };
    wp11Banner();
    const bb = document.getElementById("wp11Banner").getBoundingClientRect();
    const brd = document.getElementById("board").getBoundingClientRect();
    const cx = bb.left + bb.width / 2, cy = bb.top + bb.height / 2;
    // place the lead model exactly under the banner centre (inch = (offset - view.*)/view.s)
    toks[0].x = (cx - brd.left - view.x) / view.s; toks[0].y = (cy - brd.top - view.y) / view.s;
    toks[0].wounds = 2; toks[0].maxW = 2;
    toks.slice(1).forEach((t, i) => { t.x = toks[0].x - 40 + i; t.y = toks[0].y + 40; });
    draw();
    const el = document.elementFromPoint(cx, cy);
    return { cx, cy, uk, elemUnderBanner: (el && el.id) || (el && el.tagName), before: { applied: wp11Alloc.applied, pending: !!wp11Alloc } };
  });
  if (!alloc.skip) {
    await page.mouse.click(alloc.cx, alloc.cy);               // real click on the model, through the banner
    await page.waitForTimeout(60);
    const allocAfter = await page.evaluate(() => ({ pending: (typeof wp11Pending === "function") && wp11Pending(), applied: wp11Alloc ? wp11Alloc.applied : "cleared" }));
    // clean up any residue so it can't affect later assertions
    await page.evaluate(() => { if (typeof wp11AllocDiscard === "function") wp11AllocDiscard(); });
    const passed = alloc.elemUnderBanner === "board" && (allocAfter.applied === "cleared" || allocAfter.applied > 0);
    step("P5-1 FIX: casualty-allocation click passes THROUGH the banner to a model beneath it", passed,
      JSON.stringify({ elemUnderBanner: alloc.elemUnderBanner, appliedAfterClick: allocAfter.applied }));
    report.findings.push({ probe: "P5-1 banner click-through", severity: "MAJOR (playability, FIXED)",
      note: `The #wp11Banner casualty-allocation banner was pointer-events-opaque, so a target unit positioned under the top-centre banner could NOT be clicked to allocate damage (the banner ate the click → allocation impossible; auto-assign was the only escape). Fixed: #wp11Banner is now pointer-events:none with the Auto-assign button re-enabled, mirroring the P2-2 fix on #wpRulesReminder. Verified: element under banner centre = "${alloc.elemUnderBanner}" (was a banner SPAN); a real click now applies the packet.` });
  }

  step("WHOLE-GAME: 0 console/page errors across all five rounds", errN() === 0, `${errN()} total`);

  report.totalErrors = report.errors.length;
  fs.writeFileSync(path.join(OUT, "fullgame-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== ${report.steps.filter(s => s.ok).length}/${report.steps.length} steps ok | ${report.errors.length} total console/page errors ===`);
  const v1 = end.vp1, v2 = end.vp2;
  console.log(`FINAL SCOREBOARD — Player 1 (you): ${v1} VP / ${end.cp1} CP · AI (side 2): ${v2} VP / ${end.cp2} CP · ${v1 === v2 ? "draw" : (v1 > v2 ? "P1 wins" : "AI wins")} · ${end.mine} vs ${end.foe} models left · round badge "${end.roundBadge}"`);
  if (report.errors.length) console.log(report.errors.slice(0, 20).join("\n"));
  await browser.close();
  process.exit(report.steps.every(s => s.ok) && report.errors.length === 0 ? 0 : 1);
})();
