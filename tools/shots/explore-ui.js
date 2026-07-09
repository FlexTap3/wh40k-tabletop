// explore-ui.js — Pass-7 fresh EXPLORATORY pass: the first-10-minutes player experience a real
// person hits on a cold open. Not a phase-cluster harness (those are the other files); this walks
// onboarding → Army/Builder → load a layout → Solo → help dialog → mobile/phone, screenshots every
// step for visual review, and records console/page errors + any layout overflow. Does NOT modify app.
//
// Output: shots-out/explore-*.png + explore-report.json
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT = path.resolve(__dirname, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

const report = { steps: [], errors: [], findings: [] };
const step = (name, ok, note) => { report.steps.push({ name, ok, note: note || "" }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? "  — " + note : ""}`); };

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
  await page.waitForTimeout(400);

  // 1) COLD OPEN — what a first-time player sees before doing anything.
  await shot("explore-01-cold-open.png");
  const cold = await page.evaluate(() => {
    // detect horizontal page overflow (a classic "visually broken" signal)
    const de = document.documentElement;
    const hOverflow = de.scrollWidth - de.clientWidth;
    // is there any first-run guidance visible on the empty board?
    const emptyHint = document.getElementById("emptyHint") || document.getElementById("boardHint");
    return { hOverflow, bodyScrollX: de.scrollWidth > de.clientWidth, hasEmptyHint: !!emptyHint,
             title: document.title, toolCount: document.querySelectorAll("[id^='tool-']").length };
  });
  step("cold open renders, no horizontal page overflow", cold.hOverflow <= 1 && errN() === 0, JSON.stringify(cold));

  // 2) HELP DIALOG — the "?" button (primary onboarding affordance).
  await page.evaluate(() => document.getElementById("helpDlg").showModal());
  await page.waitForTimeout(200);
  await shot("explore-02-help.png");
  const help = await page.evaluate(() => {
    const d = document.getElementById("helpDlg");
    const r = d.getBoundingClientRect();
    return { open: d.open, w: Math.round(r.width), h: Math.round(r.height),
             fitsViewport: r.bottom <= window.innerHeight + 2 && r.right <= window.innerWidth + 2,
             hasText: (d.textContent || "").trim().length > 50 };
  });
  step("help dialog opens, fits viewport, has content", help.open && help.hasText, JSON.stringify(help));
  if (!help.fitsViewport) report.findings.push({ area: "help dialog", note: `help dialog exceeds viewport (${help.w}x${help.h} vs ${1440}x${900})` });
  await page.evaluate(() => document.getElementById("helpDlg").close());

  // 3) ARMY TAB — the natural first stop to get an army onto the table.
  await page.evaluate(() => showTab("army"));
  await page.waitForTimeout(200);
  await shot("explore-03-army-tab.png");
  step("Army tab opens", true, "");

  // 4) BUILDER — the full-screen list builder overlay.
  await page.evaluate(() => openBuilder());
  await page.waitForTimeout(400);
  await shot("explore-04-builder.png");
  const builder = await page.evaluate(() => {
    const ov = document.getElementById("builderOverlay");
    const open = ov && ov.classList.contains("open");
    const de = document.documentElement;
    return { open, hOverflow: de.scrollWidth - de.clientWidth,
             rosterVisible: !!document.getElementById("rosterList"),
             browserVisible: !!document.getElementById("browser") || !!document.querySelector("[id*='browser'],[id*='Browser']") };
  });
  step("Builder overlay opens without breaking layout", builder.open && builder.hOverflow <= 1 && errN() === 0, JSON.stringify(builder));
  // close builder (find a close control)
  await page.evaluate(() => {
    const ov = document.getElementById("builderOverlay");
    const btn = ov && [...ov.querySelectorAll("button")].find(b => /close|done|×|✕|back|✓/i.test(b.textContent));
    if (btn) btn.click(); else if (ov) ov.classList.remove("open");
  });
  await page.waitForTimeout(200);

  // 5) LOAD A LAYOUT — mission terrain + objectives + deployment zones.
  const layout = await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    if (sel && sel.options.length) sel.selectedIndex = 1;
    loadLayout();
    return { objectives: (state.objectives || []).length, dz: (state.dz || []).length,
             mission: (state.mission && state.mission.name) || "" };
  });
  await page.evaluate(() => { fitView(); draw(); });
  await page.waitForTimeout(200);
  await shot("explore-05-layout.png");
  step("load a layout: objectives + DZ appear", layout.objectives > 0 && layout.dz > 0 && errN() === 0, JSON.stringify(layout));

  // 6) IMPORT + DEPLOY an army from the meta pack.
  const army = await page.evaluate(() => { wpImportSelected(); return { models: state.tokens.filter(t => t.owner === 1).length }; });
  await page.evaluate(() => { fitView(); draw(); });
  await page.waitForTimeout(200);
  await shot("explore-06-army-deployed.png");
  step("import + deploy army onto the board", army.models > 0 && errN() === 0, JSON.stringify(army));

  // 7) SOLO DIALOG — start a game vs the AI (the fastest path to "playing").
  await page.evaluate(() => aiSoloToggle());
  await page.waitForTimeout(300);
  await shot("explore-07-solo-dialog.png");
  const solo = await page.evaluate(() => {
    const d = document.getElementById("aiDlg");
    const r = d ? d.getBoundingClientRect() : null;
    return { open: !!(d && d.open), fitsViewport: r ? (r.bottom <= window.innerHeight + 2 && r.right <= window.innerWidth + 2) : false,
             ptsDefault: (document.getElementById("aiPts") || {}).value };
  });
  step("Solo dialog opens and fits the viewport", solo.open && solo.fitsViewport, JSON.stringify(solo));
  // close the dialog without starting (exploratory)
  await page.evaluate(() => { const d = document.getElementById("aiDlg"); if (d && d.open) d.close(); });

  // 8) PHONE LAYOUT — the mobile experience across the same states.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { if (typeof wp12Detect === "function") wp12Detect(); draw(); });
  await page.waitForTimeout(300);
  await shot("explore-08-phone-board.png");
  const phone = await page.evaluate(() => {
    const de = document.documentElement;
    return { hOverflow: de.scrollWidth - de.clientWidth, bottomNav: !!document.querySelector("[class*='mobile'],[id*='phone'],[class*='bottomnav'],[id*='wp12']") };
  });
  step("phone board: no horizontal overflow", phone.hOverflow <= 1 && errN() === 0, JSON.stringify(phone));

  // 8b) phone — help dialog on a small screen (does it fit / scroll?)
  await page.evaluate(() => document.getElementById("helpDlg").showModal());
  await page.waitForTimeout(200);
  await shot("explore-09-phone-help.png");
  const phoneHelp = await page.evaluate(() => {
    const d = document.getElementById("helpDlg"), r = d.getBoundingClientRect();
    return { open: d.open, right: Math.round(r.right), vw: window.innerWidth,
             overflowsRight: r.right > window.innerWidth + 2, tooTall: r.height > window.innerHeight };
  });
  step("phone help dialog does not overflow horizontally", phoneHelp.open && !phoneHelp.overflowsRight, JSON.stringify(phoneHelp));
  if (phoneHelp.overflowsRight) report.findings.push({ area: "phone help", note: `help dialog right edge ${phoneHelp.right} > viewport ${phoneHelp.vw}` });
  await page.evaluate(() => document.getElementById("helpDlg").close());

  // 8c) phone — the Army tab (list management on a phone)
  await page.evaluate(() => showTab("army"));
  await page.waitForTimeout(200);
  await shot("explore-10-phone-army.png");
  const phoneArmy = await page.evaluate(() => { const de = document.documentElement; return { hOverflow: de.scrollWidth - de.clientWidth }; });
  step("phone Army tab: no horizontal overflow", phoneArmy.hOverflow <= 1 && errN() === 0, JSON.stringify(phoneArmy));

  report.totalErrors = report.errors.length;
  fs.writeFileSync(path.join(OUT, "explore-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== ${report.steps.filter(s => s.ok).length}/${report.steps.length} steps ok | ${report.errors.length} total console/page errors ===`);
  if (report.errors.length) console.log(report.errors.slice(0, 12).join("\n"));
  if (report.findings.length) { console.log("FINDINGS:"); report.findings.forEach(f => console.log("  - " + f.area + ": " + f.note)); }
  await browser.close();
  process.exit(report.steps.every(s => s.ok) && report.errors.length === 0 ? 0 : 1);
})();
