/* wp3d-env-preview.js — WP3D-9 visual-iteration harness (owner: WP3D-D, environment pack).
   Not part of the test gate (that's run_all.sh + wp3d-smoke.js, both plain assertions);
   this is the "render it and look at it" tool the contract's visual-iteration mandate
   requires. Musters a real board (same flow as wp3d-smoke.js), toggles 3D on, and captures:
     - a 2D baseline screenshot (color-fidelity reference, pre-3D)
     - 3 desktop-tier angles (default 3/4, orbited, zoomed) with shadows on
     - 1 phone-tier shot (simulated via the .phone html class) with shadows off
   Run: cd tools/shots && node wp3d-env-preview.js */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "shots-out", "wp3d-env");
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

async function musterBoard(page) {
  return page.evaluate(() => {
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
}

async function toggle3dOn(page) {
  await page.evaluate(() => { const el = document.getElementById("wp3d"); el.checked = true; return wp3dToggle(); });
  await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  await page.waitForTimeout(700); // let a few RAF ticks settle (camera damping, shadow map warm-up)
}
async function toggle3dOff(page) {
  await page.evaluate(() => { const el = document.getElementById("wp3d"); el.checked = false; return wp3dToggle(); });
  await page.waitForTimeout(150);
}

async function orbitDrag(page, dxPx, dyPx) {
  const box = await page.locator("#board3d").boundingBox();
  const cx = box.x + box.width * 0.75, cy = box.y + box.height * 0.75; // empty-ish board corner, avoids token drag
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "left" });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + (dxPx * i) / steps, cy + (dyPx * i) / steps);
  }
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(500); // let the camera's exponential damping settle
}
async function wheelZoom(page, deltaY) {
  const box = await page.locator("#board3d").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(500);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text()); });
  page.on("pageerror", (e) => console.log("[page exception]", String(e)));

  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => { const cv = document.getElementById("board"); return cv && cv.width > 0; });
  const nTok = await musterBoard(page);
  console.log(`mustered board: ${nTok} tokens`);

  const shot2d = path.join(OUT, "00-baseline-2d.png");
  await page.locator("#board").screenshot({ path: shot2d });
  console.log("wrote", shot2d);

  // ---- desktop tier (shadows on) ----
  await toggle3dOn(page);
  const shotA = path.join(OUT, "01-desktop-default.png");
  await page.locator("#board3d").screenshot({ path: shotA });
  console.log("wrote", shotA);

  await orbitDrag(page, -260, -40); // swing around + tip up slightly
  const shotB = path.join(OUT, "02-desktop-orbit.png");
  await page.locator("#board3d").screenshot({ path: shotB });
  console.log("wrote", shotB);

  await wheelZoom(page, -600); // zoom in toward the board
  const shotC = path.join(OUT, "03-desktop-zoom.png");
  await page.locator("#board3d").screenshot({ path: shotC });
  console.log("wrote", shotC);

  // low, near-table angle — the "standing over a physical table" gut check
  await wheelZoom(page, 600); // undo the prior -600 zoom-in exactly (multiplicative inverse)
  await orbitDrag(page, 180, 160); // tip polar toward the max clamp: a lower, more raking angle
  const shotD = path.join(OUT, "04-desktop-low-angle.png");
  await page.locator("#board3d").screenshot({ path: shotD });
  console.log("wrote", shotD);

  await toggle3dOff(page);

  // ---- phone tier (shadows off) ----
  await page.evaluate(() => document.documentElement.classList.add("phone"));
  await toggle3dOn(page);
  const shotE = path.join(OUT, "05-phone-default.png");
  await page.locator("#board3d").screenshot({ path: shotE });
  console.log("wrote", shotE);
  await toggle3dOff(page);
  await page.evaluate(() => document.documentElement.classList.remove("phone"));

  await browser.close();
  srv.close();
  console.log("DONE — previews in " + OUT);
}

main().catch((e) => { console.error("FAIL", e); process.exitCode = 1; });
