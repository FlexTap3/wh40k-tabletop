/* wp3d-11e-layouts.js — visual gate for the regenerated 11th-ed layouts. Loads named layouts
   via the real loadLayout() path and screenshots each in 2D and 3D.
   Usage: cd tools/shots && node wp3d-11e-layouts.js "Official 1A" "Official 5B" "Official 8C" */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "shots-out", "wp3d-11e-layouts");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".webmanifest": "application/manifest+json" };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/wh40k-tabletop.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end("nope"); }
      rsp.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}
const NAMES = process.argv.slice(2);
const slug = (s) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept()); // loadLayout() confirms "replace terrain?" once terrain exists
  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => { const cv = document.getElementById("board"); return cv && cv.width > 0; });
  const names = NAMES.length ? NAMES : await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    return [...sel.querySelectorAll("option")].map(o => o.value).filter(v => /Official/.test(v)).filter((_, i) => i % 15 === 0).slice(0, 3);
  });
  for (const name of names) {
    const found = await page.evaluate((nm) => {
      const sel = document.getElementById("terrLayout");
      const opt = [...sel.querySelectorAll("option")].find(o => o.value === nm || o.textContent === nm);
      if (!opt) return false;
      sel.value = opt.value; loadLayout(); fitView(); draw(); return true;
    }, name);
    if (!found) { console.log("MISSING layout: " + name); continue; }
    await page.waitForTimeout(200);
    await page.locator("#board").screenshot({ path: path.join(OUT, slug(name) + "-2d.png") });
    await page.evaluate(() => wp3dSetMode("full"));
    await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, slug(name) + "-3d.png") });
    await page.evaluate(() => wp3dSetMode("off"));
    console.log("rendered: " + name);
  }
  const fatal = errors.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  console.log(fatal.length ? ("ERRORS: " + fatal.slice(0, 4).join(" | ")) : "no console errors");
  await browser.close(); srv.close();
})();
