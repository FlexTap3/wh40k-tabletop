// discover.js — one-off: load the app, dump the interactive surface (buttons, nav, selects,
// their ids + onclick + visible text) and capture the initial render, so a playability
// walkthrough can drive REAL handlers instead of guessing ids. Writes shots-out/discover.json + png.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT = path.resolve(__dirname, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));

  await page.goto("file://" + APP);
  await page.waitForSelector("#board", { state: "attached", timeout: 15000 });
  await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; }, { timeout: 15000 });
  await page.waitForTimeout(500);

  const surface = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
    const grab = sel => [...document.querySelectorAll(sel)].map(el => ({
      tag: el.tagName.toLowerCase(), id: el.id || null,
      text: (el.textContent || el.value || "").trim().slice(0, 40),
      onclick: el.getAttribute("onclick") || null,
      title: el.getAttribute("title") || null,
      visible: vis(el),
    }));
    return {
      buttons: grab("button").filter(b => b.visible),
      navLike: grab("[id*='tab'], [id*='nav'], [class*='tab'], [class*='nav']").filter(b => b.visible).slice(0, 40),
      selects: [...document.querySelectorAll("select")].map(s => ({ id: s.id, visible: vis(s), options: [...s.options].map(o => o.value).slice(0, 8) })).filter(s => s.visible),
      globalsPresent: ["loadLayout", "wpImportSelected", "aiStartFromDlg", "aiStart", "wp7Step", "aiFinishTurn", "draw", "fitView"].filter(f => typeof window[f] === "function"),
    };
  });

  await page.screenshot({ path: path.join(OUT, "p00-initial.png") });
  fs.writeFileSync(path.join(OUT, "discover.json"), JSON.stringify({ surface, errors }, null, 2));
  console.log("buttons:", surface.buttons.length, "| selects:", surface.selects.map(s => s.id).join(","), "| globals:", surface.globalsPresent.join(","));
  console.log("errors on load:", errors.length);
  await browser.close();
})();
