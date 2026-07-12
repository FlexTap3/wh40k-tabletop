#!/usr/bin/env node
/**
 * WP-VISUALS pixel-verification harness (dev-only, same pattern as shoot.js).
 *
 * Loads the app (override the file with WPV_APP=/abs/path), loads an official terrain
 * layout, musters TWO meta armies for opposite sides via the app's own hot-seat flow
 * (side 1 = Adepta Sororitas, side 2 = T'au — different faction palettes), then
 * screenshots: full board, zoomed infantry/vehicle clusters, all-toggles-off baseline,
 * and a phone-viewport pass. Drives ONLY the app's own global functions.
 *
 * Usage: cd tools/shots && WPV_APP=/path/to/wh40k-tabletop.html node wpv-shots.js
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP_PATH = process.env.WPV_APP
  ? path.resolve(process.env.WPV_APP)
  : path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT_DIR = path.resolve(__dirname, "shots-out", "wpv");
const log = (...a) => console.log("[wpv-shots]", ...a);

async function waitForBoard(page) {
  await page.waitForSelector("#board", { timeout: 15000, state: "attached" });
  await page.waitForFunction(() => {
    const cv = document.getElementById("board");
    return !!(cv && cv.width > 0 && cv.height > 0);
  }, { timeout: 15000 });
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file });
  log("wrote", name, fs.statSync(file).size, "bytes");
}

// Runs inside the page: load layout + muster both armies through the app's own functions.
function setupBoard() {
  const out = { steps: [] };
  // 1) terrain layout — prefer an Official one so every terrain kind is exercised
  const sel = document.getElementById("terrLayout");
  const opts = [...sel.querySelectorAll("option")];
  const opt = opts.find(o => /Official 1A/i.test(o.value)) || opts[0];
  sel.value = opt.value;
  loadLayout();
  out.steps.push("layout:" + opt.value);
  // 2) side 1 army (meta list 0 = Adepta Sororitas)
  if (typeof wpImportPopulate === "function") wpImportPopulate();
  const pick = document.getElementById("metaListPick");
  pick.value = "0"; wpImportSelected();
  out.steps.push("side1:" + pick.options[pick.selectedIndex].textContent);
  // 3) hot-seat flip, side 2 army (meta list 1 = T'au)
  setSide("2");
  pick.value = "1"; wpImportSelected();
  out.steps.push("side2:" + pick.options[pick.selectedIndex].textContent);
  setSide("1");
  fitView(); draw();
  out.tokens = state.tokens.length;
  out.toggles = ["wpvFaction", "wpvGlyphs", "wpvTerrain"].map(id => id + "=" + document.getElementById(id).checked);
  return out;
}

// Runs inside the page: centre the view on a token cluster matching a predicate.
function zoomTo({ which, scale }) {
  const toks = state.tokens.filter(t =>
    which === "p1inf" ? (t.owner === 1 && t.shape === "c") :
    which === "p2inf" ? (t.owner === 2 && t.shape === "c") :
    (t.shape === "r"));
  if (!toks.length) return false;
  const t = toks[Math.floor(toks.length / 2)];
  view.s = scale;
  const cv = document.getElementById("board");
  view.x = cv.width / devicePixelRatio / 2 - t.x * view.s;
  view.y = cv.height / devicePixelRatio / 2 - t.y * view.s;
  draw();
  return { name: t.name, owner: t.owner };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(APP_PATH)) { console.error("app not found:", APP_PATH); process.exit(1); }
  const fileUrl = "file://" + APP_PATH;
  log("app:", APP_PATH);
  const browser = await chromium.launch({ headless: true });
  try {
    // ---------- desktop ----------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", e => log("PAGE ERROR:", e.message));
    await page.goto(fileUrl, { waitUntil: "load", timeout: 30000 }).catch(e => log("goto:", e.message));
    await waitForBoard(page);
    const setup = await page.evaluate(setupBoard);
    log("setup:", JSON.stringify(setup));
    await page.waitForTimeout(300);
    await shot(page, "01-desktop-full.png");

    let z = await page.evaluate(zoomTo, { which: "p1inf", scale: 26 });
    log("zoom p1:", JSON.stringify(z));
    await shot(page, "02-zoom-p1-infantry.png");
    z = await page.evaluate(zoomTo, { which: "p2inf", scale: 26 });
    log("zoom p2:", JSON.stringify(z));
    await shot(page, "03-zoom-p2-infantry.png");
    z = await page.evaluate(zoomTo, { which: "vehicles", scale: 20 });
    log("zoom vehicles:", JSON.stringify(z));
    await shot(page, "04-zoom-vehicles.png");

    await page.evaluate(() => {
      ["wpvFaction", "wpvGlyphs", "wpvTerrain"].forEach(id => { document.getElementById(id).checked = false; });
      wpvSave(); fitView(); draw();
    });
    await shot(page, "05-toggles-off-baseline.png");
    await ctx.close();

    // ---------- phone ----------
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ppage = await pctx.newPage();
    ppage.on("pageerror", e => log("PHONE PAGE ERROR:", e.message));
    await ppage.goto(fileUrl, { waitUntil: "load", timeout: 30000 }).catch(e => log("goto:", e.message));
    await waitForBoard(ppage);
    const psetup = await ppage.evaluate(setupBoard);
    log("phone setup:", JSON.stringify(psetup));
    await ppage.waitForTimeout(300);
    await shot(ppage, "10-phone-full.png");
    await ppage.evaluate(zoomTo, { which: "p1inf", scale: 22 });
    await shot(ppage, "11-phone-zoom.png");
    await pctx.close();
  } finally {
    await browser.close();
  }
  log("done");
}
main().catch(e => { console.error("[wpv-shots] fatal:", e); process.exit(1); });
