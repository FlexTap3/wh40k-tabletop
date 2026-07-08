// move-ui.js — Gen-6 Lane B (playability/fidelity). Drives the MOVEMENT-phase cluster through the
// REAL UI — the one phase cluster not yet deeply driven. Real page.mouse drags go through the app's
// own pointer handlers:
//   1) normal move   — drag with the live WP2 measure tape + the strict M+6" cap / snap-back
//   2) Advance        — a drag into M+D6 territory stamps t.advanced (the "no shooting/charging" consequence)
//   3) structured movement toggle — move-once lock, per-unit "Movement complete", ↩ Undo / snap-back
//   4) Fall Back      — ⚑ button stamps t.fellBack
//   5) P2-3 fidelity gate — a Fell-Back OR Advanced unit is BLOCKED from staging a shot (and Fell Back
//      from staging a charge/fight); a normal unit is unaffected.
// Captures console/page errors + a screenshot at each step for visual review. Does NOT modify the app.
//
// Output: shots-out/move-*.png + move-report.json
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT = path.resolve(__dirname, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

const report = { steps: [], errors: [], findings: [] };
const step = (name, ok, note) => { report.steps.push({ name, ok, note: note || "" }); console.log(`${ok ? "ok  " : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", m => { if (m.type() === "error") report.errors.push("console: " + m.text()); });
  page.on("pageerror", e => report.errors.push("pageerror: " + e.message));
  const shot = f => page.screenshot({ path: path.join(OUT, f) });
  const errN = () => report.errors.length;

  await page.goto("file://" + APP);
  await page.waitForSelector("#board", { state: "attached", timeout: 15000 });
  await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; });
  await page.waitForTimeout(300);
  step("app loads, board renders", true, `${errN()} console errors on load`);

  // ---- 0) mission + my army + AI opponent (reuse the Gen-3 bring-up path) ----
  await page.evaluate(() => showTab("setup"));
  const setup = await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const key = [...sel.options].map(o => o.value).find(v => /Official 1A/.test(v)) || (sel.options[1] && sel.options[1].value);
    sel.value = key; loadLayout();
    const pick = document.getElementById("metaListPick"); if (pick && pick.options.length) pick.selectedIndex = 0;
    const dep = document.getElementById("listDeploy"); if (dep) dep.checked = true;
    wpImportSelected();
    aiStart("TAU", 2000);
    mySide = 1;
    return { obj: state.objectives.length, mine: state.tokens.filter(t => t.owner === 1).length, foe: state.tokens.filter(t => t.owner === 2).length };
  });
  step("mission + my army + AI deployed", setup.mine > 0 && setup.foe > 0, JSON.stringify(setup));

  // board->screen helpers (same technique as fight-ui.js: real px() through the live view transform)
  const board = await page.$("#board");
  const bb = await board.boundingBox();
  const toScreen = async (ix, iy) => {
    const p = await page.evaluate(([x, y]) => { const [sx, sy] = px(x, y); return { sx, sy }; }, [ix, iy]);
    return { x: bb.x + p.sx, y: bb.y + p.sy };
  };
  const setPhase = (ph, side) => page.evaluate(([p, s]) => {
    state.phase.ph = p; state.phase.side = s;
    if (typeof wpResetMove === "function") wpResetMove();
    if (typeof refreshTrackers === "function") refreshTrackers();
    if (typeof wp7RenderPhase === "function") wp7RenderPhase();
    draw();
  }, [ph, side]);
  // a REAL pointer drag of a whole unit: pre-select it, mouse-down on a member, glide, mouse-up.
  // Returns {from,to,moved,Mv}. Optional midShot filename screenshots the live measure mid-drag.
  const selectUnit = uk => page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); draw(); }, uk);
  const dragUnit = async (uk, inches, dir, midShot) => {
    await page.evaluate(() => setTool("select"));
    await selectUnit(uk);
    const a0 = await page.evaluate(u => { const t = state.tokens.filter(x => x.unit === u)[0]; return { x: t.x, y: t.y, id: t.id, Mv: t.Mv, n: t.name }; }, uk);
    const ux = dir === "x" ? 1 : 0, uy = dir === "y" ? 1 : 0;
    const p0 = await toScreen(a0.x, a0.y);
    const p1 = await toScreen(a0.x + ux * inches, a0.y + uy * inches);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down();
    await page.mouse.move((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    await page.mouse.move(p1.x, p1.y);
    if (midShot) await shot(midShot);            // capture the live WP2 measure tape mid-drag
    await page.mouse.up();
    const after = await page.evaluate(id => { const t = state.tokens.find(x => x.id === id); return { x: +t.x.toFixed(2), y: +t.y.toFixed(2) }; }, a0.id);
    const moved = Math.hypot(after.x - a0.x, after.y - a0.y);
    return { from: { x: +a0.x.toFixed(2), y: +a0.y.toFixed(2) }, to: after, moved: +moved.toFixed(2), Mv: a0.Mv, id: a0.id, name: a0.n };
  };
  const unitFlags = uk => page.evaluate(u => { const ts = state.tokens.filter(t => t.unit === u); return { advanced: ts.some(t => t.advanced), fellBack: ts.some(t => t.fellBack) }; }, uk);

  // choose three friendly units that have weapon cards + a clear lane; plus one enemy target.
  const cast = await page.evaluate(() => {
    const byUnit = {}; state.tokens.forEach(t => (byUnit[t.unit] = byUnit[t.unit] || []).push(t));
    const hasCard = uk => { const c = wp3CardFor(byUnit[uk][0]); return c && String(c.weapons || "").trim().length > 0; };
    const hasRanged = uk => { const c = wp3CardFor(byUnit[uk][0]); if (!c) return false;
      return String(c.weapons || "").split("\n").map(wp3ParseWeapon).filter(Boolean).some(w => !w.melee); };
    const friendly = Object.keys(byUnit).filter(uk => byUnit[uk][0].owner === 1 && hasCard(uk) && hasRanged(uk));
    const rad = uk => tokRadius(byUnit[uk][0]);
    const pick = friendly.sort((a, b) => rad(a) - rad(b));
    const A = pick[0], B = pick[1], C = pick[2];
    // spread them into open lanes so their moves don't collide with other tokens or terrain
    [A, B, C].forEach((uk, i) => { const ms = byUnit[uk]; const r = tokRadius(ms[0]);
      ms.forEach((t, j) => { t.x = 20 + i * 14; t.y = 20 + j * (2 * r + 0.8); }); });
    const enemy = Object.keys(byUnit).filter(uk => byUnit[uk][0].owner === 2).sort((a, b) => rad(a) - rad(b))[0];
    const E = byUnit[enemy][0];
    E.x = 44; E.y = 8;                                  // put the target near the top, well clear of A/B/C lanes
    fitView(); draw();
    return { A, B, C, E: enemy,
      aName: byUnit[A][0].name, aMv: byUnit[A][0].Mv,
      bName: byUnit[B][0].name, cName: byUnit[C][0].name };
  });
  step("cast set up (3 friendly ranged units + 1 enemy target)", !!(cast.A && cast.B && cast.C && cast.E),
    JSON.stringify({ A: cast.aName, Mv: cast.aMv, B: cast.bName, C: cast.cName }));
  await shot("move-01-setup.png");

  // shoot-attempt probe used repeatedly: arm unit uk, fire at the enemy, report whether a shot staged.
  const tryShoot = uk => page.evaluate(([u, e]) => {
    setTool("attack");
    const foe = state.tokens.filter(t => t.unit === e)[0];
    wp15Atk = { unit: u, owner: 1 }; wp3Label = "";
    try { wp15Go(foe); } catch (err) { return { staged: false, err: err.message }; }
    const st = document.getElementById("akStage");
    return { staged: !!wp3Label, label: wp3Label, banner: st ? st.textContent.replace(/\s+/g, " ").trim().slice(0, 120) : "" };
  }, [uk, cast.E]);
  // melee-stage probe (via the inspector ⚔ aim path): does a fight/charge stage?
  const tryMelee = uk => page.evaluate(([u, e]) => {
    sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect();
    if (!wp3Ctx) return { ok: false, why: "no inspector ctx" };
    const mi = wp3Ctx.weapons.findIndex(w => w.melee);
    if (mi < 0) return { ok: false, why: "unit has no melee weapon" };
    const foe = state.tokens.filter(t => t.unit === e)[0];
    wp3Label = ""; wp3Aim(mi); wp3PickTarget(foe.x, foe.y);
    return { ok: true, staged: !!wp3Label };
  }, [uk, cast.E]);

  // ============================================================================
  // 1) NORMAL MOVE — drag within M, live measure tape, no snap-back, no advance flag
  // ============================================================================
  await setPhase(1, 1);
  const normalIn = Math.max(1, (cast.aMv || 6) - 1);         // just inside the Move stat
  const norm = await dragUnit(cast.A, normalIn, "y", "move-02-normal-drag.png");
  const normFlags = await unitFlags(cast.A);
  step("normal move: unit drags within M, commits, NOT flagged Advanced",
    norm.moved > 0.5 && !normFlags.advanced && !normFlags.fellBack, JSON.stringify({ Mv: norm.Mv, moved: norm.moved, ...normFlags }));
  await shot("move-02b-normal-committed.png");

  // ============================================================================
  // 2) STRICT MOVEMENT CAP — enable "Enforce movement caps", drag beyond M+6" -> snap back
  // ============================================================================
  await setPhase(1, 1);
  await page.evaluate(() => { const c = document.getElementById("strictMove"); if (c && !c.checked) c.click(); });
  const errBeforeSnap = errN();
  const overCap = (cast.aMv || 6) + 9;                       // well beyond M+6"
  const snap = await dragUnit(cast.A, overCap, "y", "move-03-overcap-drag.png");
  const snappedBack = Math.hypot(snap.to.x - snap.from.x, snap.to.y - snap.from.y) < 0.3;
  step("strict cap: a drag beyond M+6\" snaps back (hard cap enforced)",
    snappedBack && errN() === errBeforeSnap, JSON.stringify({ attemptedIn: overCap, from: snap.from, to: snap.to, snappedBack }));
  await shot("move-03b-overcap-snapback.png");
  await page.evaluate(() => { const c = document.getElementById("strictMove"); if (c && c.checked) c.click(); }); // restore default (off)

  // ============================================================================
  // 3) ADVANCE — a drag into M+D6 territory stamps t.advanced (the no-shoot/charge consequence)
  // ============================================================================
  await setPhase(1, 1);
  const advIn = (cast.aMv || 6) + 3;                         // M < d <= M+6  => advance band
  const adv = await dragUnit(cast.A, advIn, "y", "move-04-advance-drag.png");
  const advFlags = await unitFlags(cast.A);
  step("Advance: drag past M stamps t.advanced on the unit (blue 'A' badge, no-shoot/charge)",
    adv.moved > (cast.aMv || 6) && advFlags.advanced, JSON.stringify({ Mv: adv.Mv, moved: adv.moved, ...advFlags }));
  await shot("move-04b-advance-committed.png");

  // ============================================================================
  // 4) STRUCTURED MOVEMENT — move-once lock, "Movement complete", ↩ Undo / snap-back
  // ============================================================================
  await setPhase(1, 1);
  // (a) per-unit "Movement complete" lock, then a re-drag is refused
  await page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect(); }, cast.C);
  const markDone = await page.evaluate(u => {
    const insp = document.getElementById("inspector");
    const b = [...insp.querySelectorAll("button")].find(x => /Movement complete/i.test(x.textContent));
    if (!b) return { ok: false, buttons: [...insp.querySelectorAll("button")].map(x => x.textContent.trim()) };
    b.click();
    return { ok: true, done: typeof wpDone !== "undefined" && wpDone.has(u) };
  }, cast.C);
  const lockDrag = await dragUnit(cast.C, 3, "y");           // attempt to move a locked unit
  step("structured: 'Movement complete' locks the unit; a further drag is refused",
    markDone.ok && markDone.done && lockDrag.moved < 0.3, JSON.stringify({ markDone, movedAfterLock: lockDrag.moved }));
  await page.evaluate(() => wp3Inspect());
  await shot("move-05-movement-complete.png");

  // (b) ↩ Undo move snaps a unit back to the phase-start position
  await setPhase(1, 1);
  const preUndo = await page.evaluate(u => { const t = state.tokens.filter(x => x.unit === u)[0]; return { x: t.x, y: t.y }; }, cast.B);
  await dragUnit(cast.B, (cast.aMv || 6) + 2, "y");          // advance it so we also verify undo clears the flag
  await page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect(); }, cast.B);
  const undo = await page.evaluate(u => {
    const insp = document.getElementById("inspector");
    const b = [...insp.querySelectorAll("button")].find(x => /Undo move/i.test(x.textContent));
    if (!b) return { ok: false };
    b.click();
    const t = state.tokens.filter(x => x.unit === u)[0];
    return { ok: true, x: t.x, y: t.y, advanced: state.tokens.filter(x => x.unit === u).some(x => x.advanced) };
  }, cast.B);
  const backAtStart = undo.ok && Math.hypot(undo.x - preUndo.x, undo.y - preUndo.y) < 0.3;
  step("structured: ↩ Undo move snaps to phase-start AND clears the Advance flag",
    backAtStart && !undo.advanced, JSON.stringify({ backAtStart, advancedAfterUndo: undo.advanced }));
  await page.evaluate(() => wp3Inspect());
  await shot("move-06-undo.png");

  // ============================================================================
  // 5) FALL BACK — ⚑ button stamps t.fellBack on the unit
  // ============================================================================
  await setPhase(1, 1);
  await page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect(); }, cast.B);
  const fb = await page.evaluate(u => {
    const insp = document.getElementById("inspector");
    const b = [...insp.querySelectorAll("button")].find(x => /Fall Back/i.test(x.textContent));
    if (!b) return { ok: false, buttons: [...insp.querySelectorAll("button")].map(x => x.textContent.trim()) };
    b.click();
    return { ok: true, fellBack: state.tokens.filter(t => t.unit === u).every(t => t.fellBack) };
  }, cast.B);
  step("Fall Back: ⚑ button stamps t.fellBack on every model of the unit", fb.ok && fb.fellBack, JSON.stringify(fb));
  await page.evaluate(() => wp3Inspect());
  await shot("move-07-fallback.png");

  // ============================================================================
  // 6) P2-3 FIDELITY GATE — shooting/charge blocked for Fell-Back / Advanced; normal unit unaffected
  // ============================================================================
  await setPhase(2, 1); // Shooting phase, my turn
  // control: unit C moved a normal move (not advanced, not fell back) -> shooting must still work
  const shootNormal = await tryShoot(cast.C);
  step("gate control: a NORMAL unit still stages a shot (legal action NOT broken)",
    shootNormal.staged, JSON.stringify(shootNormal));
  await page.evaluate(() => showTab("attack")); await shot("move-08-normal-shot-ok.png");

  // Advanced unit (A) -> shooting blocked
  const advFlagsNow = await unitFlags(cast.A);
  const shootAdvanced = await tryShoot(cast.A);
  step("gate: an ADVANCED unit is BLOCKED from staging a shot",
    advFlagsNow.advanced && !shootAdvanced.staged && /Advanced/i.test(shootAdvanced.banner),
    JSON.stringify({ flags: advFlagsNow, ...shootAdvanced }));
  await page.evaluate(() => showTab("attack")); await shot("move-09-advanced-shot-blocked.png");

  // Fell-Back unit (B) -> shooting blocked
  const shootFellBack = await tryShoot(cast.B);
  step("gate: a FELL-BACK unit is BLOCKED from staging a shot",
    !shootFellBack.staged && /Fell Back/i.test(shootFellBack.banner), JSON.stringify(shootFellBack));
  await page.evaluate(() => showTab("attack")); await shot("move-10-fellback-shot-blocked.png");

  // Fell-Back unit -> charge/fight (melee stage) also blocked; Advanced unit -> melee still allowed
  const meleeFellBack = await tryMelee(cast.B);
  const meleeAdvanced = await tryMelee(cast.A);
  report.findings.push({ probe: "melee stage — Fell Back blocked, Advanced allowed", fellBack: meleeFellBack, advanced: meleeAdvanced });
  const meleeGateOk = (!meleeFellBack.ok || meleeFellBack.staged === false) && (!meleeAdvanced.ok || meleeAdvanced.staged === true);
  step("gate: Fell-Back unit can't stage melee (charge/fight); Advanced unit CAN still fight",
    meleeGateOk, JSON.stringify({ fellBack: meleeFellBack, advanced: meleeAdvanced }));

  // consequence lifecycle: a fresh Movement phase clears both flags (unit may act next turn).
  // Drive the REAL synced phase op (what wp7Step emits) so wp7ApplyPhase's clear code actually runs.
  await page.evaluate(() => { const r = (state.trackers && state.trackers.round) || 1;
    op({ k: "phase", ph: 0, side: 1, round: r });        // leave Movement (into Command)
    op({ k: "phase", ph: 1, side: 1, round: r }); });    // re-enter a fresh Movement phase -> reset
  const cleared = await page.evaluate(([a, b]) => ({
    A: state.tokens.filter(t => t.unit === a).some(t => t.advanced),
    B: state.tokens.filter(t => t.unit === b).some(t => t.fellBack),
  }), [cast.A, cast.B]);
  step("lifecycle: a fresh Movement phase clears Advance + Fall Back flags",
    !cleared.A && !cleared.B, JSON.stringify(cleared));
  await shot("move-11-flags-cleared.png");

  report.totalErrors = report.errors.length;
  fs.writeFileSync(path.join(OUT, "move-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== ${report.steps.filter(s => s.ok).length}/${report.steps.length} steps ok | ${report.errors.length} total console/page errors ===`);
  if (report.errors.length) console.log(report.errors.slice(0, 12).join("\n"));
  if (report.findings.length) console.log("findings probes:", JSON.stringify(report.findings, null, 2));
  await browser.close();
})();
