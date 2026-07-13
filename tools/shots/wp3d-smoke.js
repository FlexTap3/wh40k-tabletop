/* wp3d-smoke.js — end-to-end 3D toggle smoke: serve the repo over http, load the app,
   muster an army, toggle 3D on, verify the module loads + renders, screenshot, toggle off.
   Run: cd tools/shots && node wp3d-smoke.js */
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
  const check = (c, msg) => { console.log((c ? "ok - " : "FAIL: ") + msg); if (!c) fails++; };

  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => {
    const cv = document.getElementById("board");
    return cv && cv.width > 0;
  });

  // Muster meta armies + official layout — same in-page flow as wpv-shots.js setupBoard().
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

  // 2D baseline BEFORE any 3D use (for the toggle-off pixel gate).
  const before = await page.locator("#board").screenshot();

  check(await page.evaluate(() => typeof wp3dAvailable === "function" && wp3dAvailable()),
    "wp3dAvailable() is true over http with WebGL2");

  // Toggle 3D on via the real mode path (v3: explicit full mode; PiP has its own smoke).
  await page.evaluate(() => wp3dSetMode("full"));
  await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  check(true, "module lazy-loaded; wp3dOnDraw installed");
  check(await page.evaluate(() => document.getElementById("boardwrap").classList.contains("mode3d")),
    "boardwrap has .mode3d");
  await page.waitForTimeout(600); // a few RAF ticks

  // 3D canvas actually rendered. NOTE: can't drawImage/readPixels a WebGL canvas after
  // compositing (buffer is cleared unless preserveDrawingBuffer) — so judge the COMPOSITED
  // page screenshot instead: a uniform canvas compresses to a few KB; a real scene doesn't.
  const shot3d = path.join(OUT, "wp3d-smoke-on.png");
  const buf3d = await page.locator("#board3d").screenshot({ path: shot3d });
  check(buf3d.length > 20000, `board3d screenshot is contentful (${buf3d.length} bytes PNG)`);

  // Toggle OFF and verify clean teardown + 2D untouched (byte-diff vs pre-3D baseline).
  await page.evaluate(() => wp3dSetMode("off"));
  check(await page.evaluate(() => !document.getElementById("boardwrap").classList.contains("mode3d")),
    "mode3d removed on toggle-off");
  await page.waitForTimeout(200);
  const after = await page.locator("#board").screenshot();
  check(before.equals(after), "2D board pixels identical across 3D off (post-use)");

  const fatal = errors.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  check(fatal.length === 0, "no console/page errors" + (fatal.length ? ": " + fatal.slice(0, 3).join(" | ") : ""));

  await browser.close();
  srv.close();
  console.log(fails ? `WP3D SMOKE: ${fails} FAILURES` : "WP3D SMOKE: ALL PASSED");
  process.exitCode = fails ? 1 : 0;
})();
