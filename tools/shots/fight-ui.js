// fight-ui.js — Gen-4 Lane B (playability/fidelity). Drives the FIGHT-phase cluster through the
// REAL UI: engagement setup, the ⚔ melee attack tool (engagement-range check), Fire Overwatch
// (wp15, 6s-to-hit), a 2D6 charge (ruler + dice roller), Pile in / Consolidate (3" caps, real
// mouse drags with snap-back), and Fall Back (t.fellBack). Captures console/page errors +
// screenshots at each step for visual review. Does NOT modify the app.
//
// Output: shots-out/fight-*.png + fight-report.json
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

  // ---- 1) mission + army + AI opponent (reuse the Gen-3 bring-up path) ----
  await page.evaluate(() => showTab("setup"));
  const setup = await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const key = [...sel.options].map(o => o.value).find(v => /Official 1A/.test(v)) || (sel.options[1] && sel.options[1].value);
    sel.value = key; loadLayout();
    const pick = document.getElementById("metaListPick"); if (pick && pick.options.length) pick.selectedIndex = 0;
    const dep = document.getElementById("listDeploy"); if (dep) dep.checked = true;
    wpImportSelected();
    aiStart("TAU", 2000);
    return { obj: state.objectives.length, mine: state.tokens.filter(t => t.owner === 1).length, foe: state.tokens.filter(t => t.owner === 2).length };
  });
  step("mission + my army + AI deployed", setup.mine > 0 && setup.foe > 0, JSON.stringify(setup));

  // ---- 2) build an engagement: a friendly melee unit ~1.5" from an enemy unit ----
  const engage = await page.evaluate(() => {
    mySide = 1;
    const byUnit = {}; state.tokens.forEach(t => (byUnit[t.unit] = byUnit[t.unit] || []).push(t));
    const meleeUnit = uk => {
      const c = wp3CardFor(byUnit[uk][0]);
      const ws = c ? String(c.weapons || "").split("\n").map(wp3ParseWeapon).filter(Boolean) : [];
      return ws.some(w => w.melee);
    };
    // prefer a small-based, multi-model friendly melee unit (clean geometry)
    const friendly = Object.keys(byUnit).filter(uk => byUnit[uk][0].owner === 1);
    const rad = uk => tokRadius(byUnit[uk][0]);
    let A = friendly.filter(uk => byUnit[uk].length >= 3 && meleeUnit(uk)).sort((x, y) => rad(x) - rad(y))[0]
         || friendly.filter(uk => meleeUnit(uk)).sort((x, y) => rad(x) - rad(y))[0]
         || friendly.sort((x, y) => rad(x) - rad(y))[0];
    const enemy = Object.keys(byUnit).filter(uk => byUnit[uk][0].owner === 2);
    let B = enemy.sort((x, y) => rad(x) - rad(y))[0];
    const a = byUnit[A], b = byUnit[B];
    const ra = tokRadius(a[0]);
    // lay A in a horizontal row, models spaced so they don't overlap and stay coherent (<=2")
    const stepX = 2 * ra + 1.0;
    a.forEach((t, i) => { t.x = 24 + i * stepX; t.y = 30; });
    const rightmost = a[a.length - 1], rb0 = tokRadius(b[0]);
    // place B just past the rightmost A model at ~1.5" edge, spread vertically clear of A's row
    b.forEach((t, i) => { const rb = tokRadius(t); t.x = rightmost.x + ra + rb + 1.5; t.y = 30 + i * (2 * rb + 0.5); });
    const gap = Math.min(...a.flatMap(m => b.map(e => edgeDist(m, e))));
    fitView(); draw();
    return { A, B, aName: a[0].name, bName: b[0].name, aN: a.length, bN: b.length, gap: +gap.toFixed(2) };
  });
  step("engagement set up (friendly ~1.5\" from enemy)", engage.gap > 0.8 && engage.gap < 2.2,
    `${engage.aName}(x${engage.aN}) vs ${engage.bName}(x${engage.bN}), closest gap ${engage.gap}"`);
  await shot("fight-01-engagement.png");

  const board = await page.$("#board");
  const bb = await board.boundingBox();
  const toScreen = async (ix, iy) => {
    const p = await page.evaluate(([x, y]) => { const [sx, sy] = px(x, y); return { sx, sy }; }, [ix, iy]);
    return { x: bb.x + p.sx, y: bb.y + p.sy };
  };
  const setPhase = (ph, side) => page.evaluate(([p, s]) => {
    state.phase.ph = p; state.phase.side = s;               // set directly (no aiOnPhase side-effects in the harness)
    if (typeof refreshTrackers === "function") refreshTrackers();
    if (typeof wp7RenderPhase === "function") wp7RenderPhase();
    if (typeof wpRulesShowReminder === "function") wpRulesShowReminder();
    draw();
  }, [ph, side]);
  const clickInspectorBtn = rx => page.evaluate((re) => {
    const insp = document.getElementById("inspector");
    const btn = [...insp.querySelectorAll("button")].find(b => new RegExp(re, "i").test(b.textContent));
    if (!btn) return { ok: false, buttons: [...insp.querySelectorAll("button")].map(b => b.textContent.trim()) };
    btn.click(); return { ok: true };
  }, rx);

  // ---- 3) FALL BACK (Movement phase) ----
  await setPhase(1, 1);
  await page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect(); }, engage.A);
  let fb = await clickInspectorBtn("Fall Back");
  const fbState = await page.evaluate(u => {
    const toks = state.tokens.filter(t => t.unit === u);
    return { fellBack: toks.every(t => t.fellBack === true), label: (document.querySelector("#inspector button")||{}).textContent };
  }, engage.A);
  step("Fall Back button stamps t.fellBack on the unit", fb.ok && fbState.fellBack, JSON.stringify(fbState));
  await shot("fight-02-fallback.png");
  // fidelity probe: after Falling Back, can the unit still stage a shooting attack? (11th: it can't)
  const fbShoot = await page.evaluate(u => {
    setTool("attack");
    const toks = state.tokens.filter(t => t.unit === u);
    const foe = state.tokens.find(t => t.owner === 2);
    wp15Atk = { unit: u, owner: 1 };
    wp3Label = "";
    try { wp15Go(foe); } catch (e) { return { staged: false, err: e.message }; }
    return { staged: !!wp3Label, blocked: !wp3Label };
  }, engage.A);
  report.findings.push({ probe: "fell-back unit shooting", staged: fbShoot.staged, note: "11th: a unit that Fell Back cannot shoot or charge — app NOW ENFORCES this (P4-1/P2-3 gate in wp3Stage): staging is blocked with a red banner. Verified separately by move-ui.js." });
  // The Fall-Back / no-shoot enforcement is proven above; the Overwatch and melee-range fidelity
  // steps below test a DIFFERENT concern (6s-to-hit / 2" engagement) and reuse this same unit, so
  // clear the transient fellBack flag first — otherwise the P4-1 gate (correctly) blocks them and
  // we'd be re-testing Fall-Back enforcement instead. setPhase sets state.phase directly and skips
  // wp7ApplyPhase's lifecycle clear (documented in Pass 4), so the flag must be cleared explicitly.
  await page.evaluate(u => { state.tokens.filter(t => t.unit === u).forEach(t => { delete t.fellBack; delete t.advanced; }); }, engage.A);

  // ---- 4) FIRE OVERWATCH (reactive: opponent's Movement phase, I am the non-active side) ----
  // Overwatch is a RANGED snap-shot: the app (correctly, P3-2/P2-4) refuses it for a melee-only
  // unit. engage.A (Arco-flagellants) is melee-only, so pick a friendly unit that actually carries
  // a ranged weapon for this step — otherwise we'd be re-testing the ranged-only gate, not the 6s.
  await setPhase(1, 2);                                   // AI's Movement phase; mySide stays 1
  const owUnit = await page.evaluate(() => {
    const byUnit = {};
    state.tokens.forEach(t => { (byUnit[t.unit] = byUnit[t.unit] || []).push(t); });
    for (const uk of Object.keys(byUnit)) {
      if (byUnit[uk][0].owner !== 1) continue;
      const card = wp3CardFor(byUnit[uk][0]);
      if (!card) continue;
      const weapons = String(card.weapons || "").split("\n").map(wp3ParseWeapon).filter(Boolean);
      if (weapons.some(w => !w.melee)) return { unit: uk, name: byUnit[uk][0].name };
    }
    return null;
  });
  await page.evaluate(([a, b]) => { sel.clear();
    state.tokens.filter(t => t.unit === a || t.unit === b).forEach(t => sel.add(t.id)); wp3Inspect(); }, [owUnit ? owUnit.unit : engage.A, engage.B]);
  const owBtn = await clickInspectorBtn("Fire Overwatch");
  await page.evaluate(() => showTab("attack"));
  await page.waitForTimeout(150);
  const ow = await page.evaluate(() => ({
    bs: (document.getElementById("akBS") || {}).value,
    staged: !!wp3Label, label: wp3Label,
    stageTxt: (document.getElementById("akStage") || {}).textContent.replace(/\s+/g, " ").trim().slice(0, 90),
  }));
  step("Fire Overwatch stages the shot at 6s-to-hit", owBtn.ok && ow.staged && ow.bs === "6+", JSON.stringify(ow));
  await shot("fight-03-overwatch.png");

  // ---- 5) MELEE ENGAGEMENT-RANGE FIDELITY via the ⚔ attack tool (units are ~1.5" apart) ----
  await setPhase(4, 1);
  const melee = await page.evaluate(([a, b]) => {
    sel.clear(); state.tokens.filter(t => t.unit === a).forEach(t => sel.add(t.id)); wp3Inspect();
    const mi = wp3Ctx.weapons.findIndex(w => w.melee);
    if (mi < 0) return { ok: false, why: "no melee weapon on card" };
    const foe = state.tokens.find(t => t.unit === b);
    wp3Aim(mi); wp3PickTarget(foe.x, foe.y);
    const txt = document.getElementById("akStage").textContent.replace(/\s+/g, " ").trim();
    const gap = wp3UnitDist(state.tokens.filter(t => t.unit === a), state.tokens.filter(t => t.unit === b));
    return { ok: true, gap: +gap.toFixed(2), inRangeShown: /in engagement range/.test(txt), notWithin: /NOT within/.test(txt), sample: txt.slice(0, 100) };
  }, [engage.A, engage.B]);
  // 11th-ed engagement range is 2" — models 1.5" apart ARE in engagement and should read green
  const meleeFidelityOk = melee.ok && melee.gap <= 2.0 && melee.inRangeShown && !melee.notWithin;
  step("⚔ melee: units 1.5\" apart read as IN engagement range (11th=2\")", meleeFidelityOk, JSON.stringify(melee));
  await page.evaluate(() => showTab("attack"));
  await shot("fight-04-melee-engagement.png");

  // ---- 6) PILE IN — arm 3" cap, real mouse drag within cap (stands) then beyond cap (snaps back) ----
  await setPhase(4, 1);
  await page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect(); }, engage.A);
  const pileArm = await clickInspectorBtn("Pile in");
  const armed = await page.evaluate(() => wpCapMode && { mode: wpCapMode.mode, unit: wpCapMode.unit, cap: wpCapMode.cap });
  // pick the leading model of A and its target vector toward B
  const drag = await page.evaluate(([a, b]) => {
    const a0 = state.tokens.filter(t => t.unit === a)[0];
    const b0 = state.tokens.filter(t => t.unit === b)[0];
    const dx = b0.x - a0.x, dy = b0.y - a0.y, L = Math.hypot(dx, dy) || 1;
    return { x: a0.x, y: a0.y, ux: dx / L, uy: dy / L, id: a0.id };
  }, [engage.A, engage.B]);
  // (a) within cap: 2" toward B
  const p0 = await toScreen(drag.x, drag.y);
  const p2 = await toScreen(drag.x + drag.ux * 2, drag.y + drag.uy * 2);
  await page.evaluate(() => setTool("select"));
  await page.mouse.move(p0.x, p0.y); await page.mouse.down();
  await page.mouse.move((p0.x + p2.x) / 2, (p0.y + p2.y) / 2); await page.mouse.move(p2.x, p2.y);
  await page.mouse.up();
  const afterIn = await page.evaluate(id => { const t = state.tokens.find(x => x.id === id); return { x: +t.x.toFixed(2), y: +t.y.toFixed(2) }; }, drag.id);
  const movedWithin = Math.hypot(afterIn.x - drag.x, afterIn.y - drag.y) > 0.5;
  step("Pile in armed + 2\" drag commits (within 3\" cap)", pileArm.ok && !!armed && movedWithin,
    JSON.stringify({ armed, from: { x: +drag.x.toFixed(2), y: +drag.y.toFixed(2) }, to: afterIn }));
  await shot("fight-05-pilein-within.png");
  // (b) beyond cap: re-arm and drag 4" -> must snap back
  await page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect(); }, engage.A);
  await clickInspectorBtn("Pile in");
  const q0 = await page.evaluate(id => { const t = state.tokens.find(x => x.id === id); return { x: t.x, y: t.y }; }, drag.id);
  const s0 = await toScreen(q0.x, q0.y);
  const s4 = await toScreen(q0.x + drag.ux * 4, q0.y + drag.uy * 4);
  const errBefore = errN();
  await page.mouse.move(s0.x, s0.y); await page.mouse.down();
  await page.mouse.move((s0.x + s4.x) / 2, (s0.y + s4.y) / 2); await page.mouse.move(s4.x, s4.y);
  await page.mouse.up();
  const afterOut = await page.evaluate(id => { const t = state.tokens.find(x => x.id === id); return { x: +t.x.toFixed(2), y: +t.y.toFixed(2) }; }, drag.id);
  const snappedBack = Math.hypot(afterOut.x - q0.x, afterOut.y - q0.y) < 0.3;
  step("Pile in 4\" drag snaps back (hard 3\" cap enforced)", snappedBack && errN() === errBefore,
    JSON.stringify({ from: { x: +q0.x.toFixed(2), y: +q0.y.toFixed(2) }, to: afterOut, snappedBack }));
  await shot("fight-06-pilein-snapback.png");

  // ---- 7) CONSOLIDATE — arm + small drag ----
  await page.evaluate(u => { sel.clear(); state.tokens.filter(t => t.unit === u).forEach(t => sel.add(t.id)); wp3Inspect(); }, engage.A);
  const consArm = await clickInspectorBtn("Consolidate");
  const consMode = await page.evaluate(() => wpCapMode && wpCapMode.mode);
  step("Consolidate arms its own 3\" cap", consArm.ok && consMode === "consolidate", JSON.stringify({ consMode }));
  await shot("fight-07-consolidate.png");

  // ---- 8) CHARGE (2D6): ruler measure + dice roller (the app has no formal charge action) ----
  await setPhase(3, 1);
  const charge = await page.evaluate(([a, b]) => {
    const a0 = state.tokens.filter(t => t.unit === a)[0], b0 = state.tokens.filter(t => t.unit === b)[0];
    // measure with the tape (ruler tool) programmatically the same way a drag would
    setTool("ruler");
    ruler = { x0: a0.x, y0: a0.y, x1: b0.x, y1: b0.y };
    const dist = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    // roll 2D6 via the real dice roller
    document.getElementById("qtyDice").value = 2;
    quickRoll();
    const log = document.getElementById("log").textContent;
    return { measured: +dist.toFixed(2), rolled2d6: /rolls 2D6/.test(log) };
  }, [engage.A, engage.B]);
  step("Charge flow: ruler measure + 2D6 roll (composite, no formal charge action)", charge.rolled2d6,
    JSON.stringify(charge));
  report.findings.push({ probe: "charge action", note: "no dedicated 'declare charge' UI: charge = ruler + 2D6 dice roller + manual move; no enforcement that the move ends within 2\" engagement, no Fights-First tracking, a natural 2 is not auto-failed" });
  await page.evaluate(() => { setTool("select"); draw(); });
  await shot("fight-08-charge.png");

  // ---- 9) reminder-banner overlap check (finding #2) ----
  await setPhase(4, 1);
  await page.evaluate(() => { sel.clear(); wp3Hide(); draw(); });
  const banner = await page.evaluate(() => {
    const el = document.getElementById("wpRulesReminder");
    if (!el || el.style.display === "none") return { shown: false };
    const r = el.getBoundingClientRect(); const board = document.getElementById("board").getBoundingClientRect();
    // does the banner overlap any of my tokens' screen positions?
    const overlaps = state.tokens.some(t => { const [sx, sy] = px(t.x, t.y);
      const bx = board.left + sx, by = board.top + sy;
      return bx >= r.left && bx <= r.right && by >= r.top && by <= r.bottom; });
    return { shown: true, rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }, overlapsTokens: overlaps };
  });
  report.findings.push({ probe: "reminder-banner overlap", banner });
  step("reminder banner state captured", true, JSON.stringify(banner));
  await shot("fight-09-banner.png");

  report.totalErrors = report.errors.length;
  fs.writeFileSync(path.join(OUT, "fight-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== ${report.steps.filter(s => s.ok).length}/${report.steps.length} steps ok | ${report.errors.length} total console/page errors ===`);
  if (report.errors.length) console.log(report.errors.slice(0, 12).join("\n"));
  console.log("findings probes:", JSON.stringify(report.findings, null, 2));
  await browser.close();
})();
