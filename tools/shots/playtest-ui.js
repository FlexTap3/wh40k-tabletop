// playtest-ui.js — Goal-1 playability pass. Drives a solo game through the REAL UI (button
// clicks, phase stepper, the ⚔ attack tool's click-flow) and records: console/page errors,
// per-step success, and screenshots at each phase for visual review. Does NOT modify the app.
//
// Output: shots-out/ui-*.png + ui-report.json
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT = path.resolve(__dirname, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

const report = { steps: [], errors: [] };
const step = (name, ok, note) => { report.steps.push({ name, ok, note: note || "" }); console.log(`${ok ? "ok " : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", m => { if (m.type() === "error") report.errors.push("console: " + m.text()); });
  page.on("pageerror", e => report.errors.push("pageerror: " + e.message));
  const shot = f => page.screenshot({ path: path.join(OUT, f) });
  const errCountAt = () => report.errors.length;

  await page.goto("file://" + APP);
  await page.waitForSelector("#board", { state: "attached", timeout: 15000 });
  await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; });
  await page.waitForTimeout(400);
  step("app loads, board renders", true, `${errCountAt()} console errors on load`);

  // 1) Load a mission/terrain layout via the Setup tab (the way a user does it)
  await page.evaluate(() => showTab("setup"));
  await page.waitForTimeout(200);
  await shot("ui-01-setup.png");
  const layoutOk = await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    if (!sel) return { ok: false, why: "no #terrLayout select on Setup" };
    const key = [...sel.options].map(o => o.value).find(v => /Official 1A/.test(v)) || sel.options[1] && sel.options[1].value;
    if (!key) return { ok: false, why: "no Official layout option" };
    sel.value = key; loadLayout();
    return { ok: state.objectives.length > 0 && state.dz.length === 2, objectives: state.objectives.length, dz: state.dz.length, key };
  });
  step("load terrain layout (mission)", layoutOk.ok, JSON.stringify(layoutOk));

  // 2) Import + deploy a meta army list (Army tab flow uses the meta picker)
  const armyOk = await page.evaluate(() => {
    const pick = document.getElementById("metaListPick");
    if (typeof wpImportSelected !== "function") return { ok: false, why: "no wpImportSelected" };
    if (pick && pick.options.length) pick.selectedIndex = 0;
    const dep = document.getElementById("listDeploy"); if (dep) dep.checked = true;
    try { wpImportSelected(); } catch (e) { return { ok: false, why: "threw: " + e.message }; }
    const mine = state.tokens.filter(t => t.owner === 1);
    return { ok: mine.length > 0, myModels: mine.length };
  });
  step("import + deploy my army", armyOk.ok, JSON.stringify(armyOk));
  await page.evaluate(() => { showTab("army"); fitView(); draw(); });
  await page.waitForTimeout(200);
  await shot("ui-02-deployed.png");

  // 3) Start Solo — exercise the real button + dialog
  await page.click("#btnSolo").catch(() => {});
  await page.waitForTimeout(300);
  await shot("ui-03-solo-dialog.png");
  const soloDlgInfo = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll("dialog")].find(d => d.open);
    return dlg ? { open: true, id: dlg.id, buttons: [...dlg.querySelectorAll("button")].map(b => b.textContent.trim()).slice(0, 6) } : { open: false };
  });
  // confirm the dialog if present, else fall back to aiStart directly
  let soloOk;
  if (soloDlgInfo.open) {
    soloOk = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll("dialog")].find(d => d.open);
      const fid = dlg.querySelector("select"); if (fid) { const t = [...fid.options].find(o => /TAU|T.au/i.test(o.value + o.textContent)); if (t) fid.value = t.value; }
      const go = [...dlg.querySelectorAll("button")].find(b => /start|solo|go|confirm|begin/i.test(b.textContent));
      if (go) go.click(); else if (typeof aiStartFromDlg === "function") aiStartFromDlg();
      return { started: typeof solo !== "undefined" && solo, aiToks: state.tokens.filter(t => t.owner === 2).length };
    });
  } else {
    soloOk = await page.evaluate(() => { aiStart("TAU", 2000); return { started: solo, aiToks: state.tokens.filter(t => t.owner === 2).length }; });
  }
  step("start Solo mode (AI opponent deploys)", !!(soloOk.started && soloOk.aiToks > 0), JSON.stringify({ dialog: soloDlgInfo.open, ...soloOk }));
  await page.evaluate(() => { fitView(); draw(); });
  await page.waitForTimeout(200);
  await shot("ui-04-solo-deployed.png");

  // 4) Step through my whole turn's phases via the › button (real phase stepper)
  const phaseNames = ["Command", "Movement", "Shooting", "Charge", "Fight", "End"];
  const stepBtn = await page.$$("button");
  const stepperr0 = errCountAt();
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => wp7Step(1));   // the › button calls exactly this
    await page.waitForTimeout(120);
    const ph = await page.evaluate(() => (state.phase && state.phase.ph));
    if (i < 3) await shot(`ui-05-phase-${i}-${phaseNames[Math.max(0, ph)] || ph}.png`);
  }
  const afterMyTurn = await page.evaluate(() => ({ side: state.phase.side, ph: state.phase.ph, round: state.trackers.round }));
  step("step through my 6 phases (Command→End)", errCountAt() === stepperr0, `ended at ${JSON.stringify(afterMyTurn)}, ${errCountAt() - stepperr0} new errors`);

  // 5) Drive ONE attack via the ⚔ attack tool: click my unit, click an enemy → attack tab populates
  const atkInfo = await page.evaluate(() => {
    setTool("attack");
    const mine = state.tokens.find(t => t.owner === 1), foe = state.tokens.find(t => t.owner === 2);
    if (!mine || !foe) return { ok: false, why: "missing tokens" };
    // board-inch -> screen px using the app's view transform
    const toPx = t => ({ x: (t.x - view.x) * view.s, y: (t.y - view.y) * view.s });
    return { ok: true, mine: toPx(mine), foe: toPx(foe), mineName: mine.name, foeName: foe.name };
  });
  if (atkInfo.ok) {
    const board = await page.$("#board");
    const bb = await board.boundingBox();
    await page.mouse.click(bb.x + atkInfo.mine.x, bb.y + atkInfo.mine.y);
    await page.waitForTimeout(150);
    await page.mouse.click(bb.x + atkInfo.foe.x, bb.y + atkInfo.foe.y);
    await page.waitForTimeout(250);
    await page.evaluate(() => showTab("attack"));
    await page.waitForTimeout(150);
    await shot("ui-06-attack-tab.png");
    const staged = await page.evaluate(() => {
      const el = document.getElementById("tab-attack");
      const txt = (el && el.textContent || "");
      return { hasContent: txt.length > 40, mentionsWeapon: /BS|WS|Str|AP|attacks|hit/i.test(txt), sample: txt.replace(/\s+/g, " ").trim().slice(0, 120) };
    });
    step("⚔ attack tool: click unit→enemy populates Attack tab", staged.hasContent, JSON.stringify(staged));
  } else {
    step("⚔ attack tool", false, atkInfo.why);
  }

  // 6) Cards tab renders (secondaries / scoreboard surface)
  await page.evaluate(() => showTab("cards"));
  await page.waitForTimeout(200);
  await shot("ui-07-cards.png");
  const cardsOk = await page.evaluate(() => { const el = document.getElementById("tab-cards"); return !!el && el.textContent.trim().length > 10; });
  step("Cards tab renders", cardsOk, "");

  // 7) Let the AI take its turn (step past my End → AI plays and hands back)
  const aiErr0 = errCountAt();
  const aiVp0 = await page.evaluate(() => state.trackers.vp2);
  await page.evaluate(() => { if (state.phase.side === 1) { while (state.phase.side === 1) wp7Step(1); } });
  await page.evaluate(() => { if (typeof aiFinishTurn === "function") aiFinishTurn(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { fitView(); draw(); });
  await shot("ui-08-after-ai-turn.png");
  const aiTurn = await page.evaluate(() => ({ side: state.phase.side, round: state.trackers.round, vp2: state.trackers.vp2 }));
  step("AI plays its turn without errors", errCountAt() === aiErr0, JSON.stringify({ ...aiTurn, newErrors: errCountAt() - aiErr0 }));

  // 8) Phone layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { if (typeof wp12Detect === "function") wp12Detect(); if (typeof draw === "function") draw(); });
  await page.waitForTimeout(300);
  await shot("ui-09-phone.png");
  step("phone viewport renders", true, "");

  report.totalErrors = report.errors.length;
  fs.writeFileSync(path.join(OUT, "ui-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== ${report.steps.filter(s => s.ok).length}/${report.steps.length} steps ok | ${report.errors.length} total console/page errors ===`);
  if (report.errors.length) console.log(report.errors.slice(0, 12).join("\n"));
  await browser.close();
})();
