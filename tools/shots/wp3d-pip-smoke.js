/* wp3d-pip-smoke.js — PiP (picture-in-picture) 3D mode behavioral smoke test.
 * Extends the wp3d-smoke.js flow (serve + muster board) to exercise the WP3D-11 mode
 * manager end-to-end in a real browser: cycles off -> pip -> full -> off via wp3dSetMode
 * and the hotkey, and asserts the "2D stays the play surface" contract —
 *   - the #board3d canvas rect + renderer backing buffer actually resize per mode
 *   - #board (2D) stays visible+interactive: a synthetic click on a token's 2D screen
 *     position selects it while PiP is up
 *   - #wp3dLabels stays hidden in PiP (CSS, already shipped — sanity-checked here)
 *   - the toolbar mode badge text tracks the mode
 *   - hotkey '3' cycles off -> pip -> full -> off
 * Run: cd tools/shots && node wp3d-pip-smoke.js
 */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "shots-out");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".webmanifest": "application/manifest+json" };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/wh40k-tabletop.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rsp.writeHead(404); return rsp.end("nope");
      }
      rsp.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  let fails = 0;
  const check = (c, msg) => { console.log((c ? "ok - " : "FAIL: ") + msg); if (!c) fails++; return c; };

  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => {
    const cv = document.getElementById("board");
    return cv && cv.width > 0;
  });

  // Muster meta armies + official layout — same in-page flow as wp3d-smoke.js / wpv-shots.js.
  const nTok = await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const opts = [...sel.querySelectorAll("option")];
    const opt = opts.find((o) => /Official 1A/i.test(o.value)) || opts[0];
    sel.value = opt.value; loadLayout();
    if (typeof wpImportPopulate === "function") wpImportPopulate();
    const pick = document.getElementById("metaListPick");
    pick.value = "0"; wpImportSelected();
    setSide("2"); pick.value = "1"; wpImportSelected(); setSide("1");
    fitView(); draw();
    return state.tokens.length;
  });
  check(nTok > 0, `mustered board has ${nTok} tokens`);

  const before = await page.locator("#board").screenshot(); // 2D baseline, before any 3D use

  check(await page.evaluate(() => typeof wp3dAvailable === "function" && wp3dAvailable()),
    "wp3dAvailable() is true over http with WebGL2");

  // ---- off -> pip ----
  await page.evaluate(() => wp3dSetMode("pip"));
  await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  await page.waitForTimeout(400); // a few RAF ticks for the mode manager's setMode to settle
  check(await page.evaluate(() => document.getElementById("boardwrap").classList.contains("mode3d-pip")),
    "boardwrap has .mode3d-pip after wp3dSetMode('pip')");
  check(await page.evaluate(() => document.getElementById("wp3dBadge").textContent) === "PiP",
    "toolbar mode badge reads 'PiP'");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("wp3dLabels")).display) === "none",
    "#wp3dLabels stays hidden (display:none) while PiP is up");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("board")).display) !== "none",
    "#board (2D) stays visible (display != none) while PiP is up");

  const pipBox = await page.evaluate(() => {
    const r = document.getElementById("board3d").getBoundingClientRect();
    const cv = document.getElementById("board3d");
    return { w: r.width, h: r.height, bufW: cv.width, bufH: cv.height, dpr: window.devicePixelRatio || 1 };
  });
  check(pipBox.w > 0 && pipBox.w <= 360 && pipBox.h > 0 && pipBox.h <= 240,
    `#board3d CSS rect is the small PiP inset (${pipBox.w}x${pipBox.h})`);
  const pipExpectedBufW = Math.round(pipBox.w * pipBox.dpr), pipExpectedBufH = Math.round(pipBox.h * pipBox.dpr);
  check(Math.abs(pipBox.bufW - pipExpectedBufW) <= 2 && Math.abs(pipBox.bufH - pipExpectedBufH) <= 2,
    `renderer backing buffer (${pipBox.bufW}x${pipBox.bufH}) tracks the PiP CSS rect * dpr (~${pipExpectedBufW}x${pipExpectedBufH})`);

  // ---- 2D board stays fully interactive while PiP is up: synthetic click selects a token ----
  const board = await page.$("#board");
  const bb = await board.boundingBox();
  const pick = await page.evaluate(() => {
    // Pick a token whose 2D screen position is clearly OUTSIDE the bottom-right PiP inset
    // (so the click actually lands on the 2D canvas, not the 3D canvas stacked on top there).
    const pr = document.getElementById("board3d").getBoundingClientRect();
    const br = document.getElementById("board").getBoundingClientRect();
    sel.clear();
    for (const t of state.tokens) {
      const [sx, sy] = px(t.x, t.y);
      const cx = br.left + sx, cy = br.top + sy;
      const insidePip = cx >= pr.left - 20 && cx <= pr.right + 20 && cy >= pr.top - 20 && cy <= pr.bottom + 20;
      if (!insidePip) return { id: t.id, sx, sy };
    }
    return null;
  });
  check(!!pick, "found a token whose 2D screen position sits clear of the PiP inset");
  if (pick) {
    await page.mouse.click(bb.x + pick.sx, bb.y + pick.sy);
    await page.waitForTimeout(50);
    const selSize = await page.evaluate(() => sel.size);
    check(selSize > 0, `2D click on a known token's screen position while PiP is up selects it (sel.size=${selSize})`);
    // The click also opens the WP3 unit inspector panel (normal app behavior, unrelated to
    // 3D) — clear selection AND close it (wp3Hide) so the final pixel-parity check below
    // isn't tripped up by an unrelated DOM overlay this test itself caused.
    await page.evaluate(() => { sel.clear(); if (typeof wp3Hide === "function") wp3Hide(); draw(); });
  }

  // ---- pip -> full ----
  await page.evaluate(() => wp3dSetMode("full"));
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.getElementById("boardwrap").classList.contains("mode3d")),
    "boardwrap has .mode3d after wp3dSetMode('full')");
  check(await page.evaluate(() => document.getElementById("wp3dBadge").textContent) === "3D",
    "toolbar mode badge reads '3D' in full mode");
  const fullBox = await page.evaluate(() => {
    const r = document.getElementById("board3d").getBoundingClientRect();
    const cv = document.getElementById("board3d");
    return { w: r.width, h: r.height, bufW: cv.width, bufH: cv.height };
  });
  check(fullBox.w > pipBox.w && fullBox.h > pipBox.h,
    `#board3d CSS rect grows on pip->full (${pipBox.w}x${pipBox.h} -> ${fullBox.w}x${fullBox.h})`);
  check(fullBox.bufW !== pipBox.bufW || fullBox.bufH !== pipBox.bufH,
    `renderer backing buffer changed size on pip->full (${pipBox.bufW}x${pipBox.bufH} -> ${fullBox.bufW}x${fullBox.bufH})`);

  const shotFull = path.join(OUT, "wp3d-pip-smoke-full.png");
  const bufFull = await page.locator("#board3d").screenshot({ path: shotFull });
  check(bufFull.length > 20000, `board3d screenshot in full mode is contentful (${bufFull.length} bytes PNG)`);

  // ---- full -> off (via wp3dSetMode) ----
  await page.evaluate(() => wp3dSetMode("off"));
  await page.waitForTimeout(200);
  check(await page.evaluate(() => !document.getElementById("boardwrap").classList.contains("mode3d")
    && !document.getElementById("boardwrap").classList.contains("mode3d-pip")),
    "mode3d/mode3d-pip both removed on toggle-off");

  // ---- hotkey '3' cycles: off -> pip -> full -> off ----
  await page.locator("#board").focus().catch(() => {});
  await page.keyboard.press("3");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => wp3dCurMode()) === "pip", "hotkey '3' from off cycles to pip");
  await page.keyboard.press("3");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => wp3dCurMode()) === "full", "hotkey '3' from pip cycles to full");
  await page.keyboard.press("3");
  await page.waitForTimeout(200);
  check(await page.evaluate(() => wp3dCurMode()) === "off", "hotkey '3' from full cycles to off");

  const after = await page.locator("#board").screenshot();
  check(before.equals(after), "2D board pixels identical across the whole off/pip/full/off cycle (post-use)");

  const fatal = errors.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  check(fatal.length === 0, "no console/page errors" + (fatal.length ? ": " + fatal.slice(0, 3).join(" | ") : ""));

  await browser.close();
  srv.close();
  console.log(fails ? `WP3D PIP SMOKE: ${fails} FAILURES` : "WP3D PIP SMOKE: ALL PASSED");
  process.exitCode = fails ? 1 : 0;
})();
