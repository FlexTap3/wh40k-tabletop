/* wp3d-11e-dev.js — DEV render of a sample 11th-edition footprint layout (2D + 3D).
   Injects the piece set directly into state (no layout-data edit yet) and screenshots.
   Run: cd tools/shots && node wp3d-11e-dev.js */
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
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end("nope"); }
      rsp.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}
// The official 11th-ed 16-piece footprint set, symmetric on 60x44 (x = top-left corner).
const PIECES = [
  { kind:"ruin", x:19, y:16.25, w:8, h:11.5, rot:0, shape:"tri", tc:1 },
  { kind:"ruin", x:33, y:16.25, w:8, h:11.5, rot:0, shape:"tri", tc:0 },
  { kind:"ruin", x:8,  y:4,    w:7, h:11.5, rot:0 },
  { kind:"ruin", x:8,  y:28.5, w:7, h:11.5, rot:0 },
  { kind:"ruin", x:45, y:4,    w:7, h:11.5, rot:0 },
  { kind:"ruin", x:45, y:28.5, w:7, h:11.5, rot:0 },
  { kind:"ruin", x:26, y:3,    w:6, h:4,   rot:0 },
  { kind:"ruin", x:26, y:37,   w:6, h:4,   rot:0 },
  { kind:"ruin", x:3,  y:20,   w:6, h:4,   rot:0 },
  { kind:"ruin", x:51, y:20,   w:6, h:4,   rot:0 },
  { kind:"wall", x:25, y:13,   w:10, h:2.5, rot:0 },
  { kind:"wall", x:25, y:28.5, w:10, h:2.5, rot:0 },
  { kind:"wall", x:1,  y:8,    w:6, h:2,   rot:0 },
  { kind:"wall", x:53, y:8,    w:6, h:2,   rot:0 },
  { kind:"wall", x:1,  y:34,   w:6, h:2,   rot:0 },
  { kind:"wall", x:53, y:34,   w:6, h:2,   rot:0 },
];
const OBJS = [[30,22],[15,10],[45,10],[15,34],[45,34]];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => { const cv = document.getElementById("board"); return cv && cv.width > 0; });
  await page.evaluate(({ PIECES, OBJS }) => {
    state.terrain = PIECES.map((t, i) => ({ id: "s" + i, ...t }));
    state.objectives = OBJS.map((o, i) => ({ id: "o" + i, x: o[0], y: o[1] }));
    state.dz = [[[0,32],[60,32],[60,44],[0,44]], [[0,0],[60,0],[60,12],[0,12]]];
    if (typeof fitView === "function") fitView();
    draw();
  }, { PIECES, OBJS });
  await page.waitForTimeout(200);
  await page.locator("#board").screenshot({ path: path.join(OUT, "wp3d-11e-2d.png") });
  // 3D full
  await page.evaluate(() => wp3dSetMode("full"));
  await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.locator("#board3d").screenshot({ path: path.join(OUT, "wp3d-11e-3d.png") });
  await page.screenshot({ path: path.join(OUT, "wp3d-11e-3d-full.png") });
  const fatal = errors.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  console.log(fatal.length ? ("ERRORS: " + fatal.slice(0,4).join(" | ")) : "no console errors");
  await browser.close(); srv.close();
})();
