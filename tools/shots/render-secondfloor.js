/* render-secondfloor.js — VISUAL proof of the floor-cap fix: one large (3-storey) ruin with
   three real mustered infantry models — floor 0 (ground), floor 1, floor 2 — so a human can
   confirm each model stands ON a rendered slab, not floating. Run: cd tools/shots && node render-secondfloor.js */
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => { const cv = document.getElementById("board"); return cv && cv.width > 0; });

  const info = await page.evaluate(() => {
    // Muster a real Space Marine army so we have genuine, renderable infantry minis.
    const sel = document.getElementById("terrLayout");
    const opts = [...sel.querySelectorAll("option")];
    sel.value = (opts.find((o) => /Official 1A/i.test(o.value)) || opts[0]).value; loadLayout();
    if (typeof wpImportPopulate === "function") wpImportPopulate();
    const pick = document.getElementById("metaListPick"); pick.value = "0"; wpImportSelected();

    // Replace terrain with ONE large 3-storey ruin dead-centre (longSide 12 -> ruinMaxLvl 2).
    const ruin = { id: "demoRuin", kind: "ruin", x: 24, y: 16, w: 12, h: 12, rot: 0 };
    state.terrain.length = 0; state.terrain.push(ruin);
    const cx = ruin.x + ruin.w / 2, cy = ruin.y + ruin.h / 2;

    // Take three of my INFANTRY models and stand them at floors 0, 1, 2 inside the ruin.
    // Spread along the footprint diagonal so each is visible at its own height (the slab sits
    // in the walled corner near the far side).
    const inf = state.tokens.filter((t) => t.owner === 1 && (t.kw || []).map((k) => String(k).toUpperCase()).includes("INFANTRY")).slice(0, 3);
    const spots = [[cx + 1, cy + 4.5, 0], [cx - 0.5, cy, 1], [cx - 2, cy - 4, 2]];
    inf.forEach((t, i) => { t.x = spots[i][0]; t.y = spots[i][1]; t.lvl = spots[i][2]; });
    // Clear other tokens so the shot is uncluttered.
    state.tokens = inf;
    fitView(); draw();
    return { ruinMaxLvl: ruinMaxLvl(ruin), lvls: inf.map((t) => t.lvl), elevWillBe: inf.map((t) => (t.lvl || 0) * 3) };
  });
  console.log("ruinMaxLvl(12x12) =", info.ruinMaxLvl, "| model floors =", info.lvls, "| expected elevations =", info.elevWillBe);

  await page.evaluate(() => wp3dSetMode("full"));
  await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  await page.waitForTimeout(900); // let the scene + minis settle

  // Zoom in a few steps via the real wheel path (negative deltaY = zoom in); keep the default
  // 3/4 elevation. A gentle HORIZONTAL drag rotates azimuth to bring the open face forward.
  const cv = page.locator("#board3d");
  const box = await cv.boundingBox();
  const mx = box.x + box.width / 2, my = box.y + box.height / 2;
  await page.mouse.move(mx, my);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(120); }
  await page.mouse.move(mx - 60, my); await page.mouse.down();
  await page.mouse.move(mx + 120, my, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(500);

  const shot = path.join(OUT, "second-floor-proof.png");
  const buf = await page.locator("#board3d").screenshot({ path: shot });
  console.log(`wrote ${shot} (${buf.length} bytes)`);
  console.log("pageerrors:", errors.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e)).slice(0, 3).join(" | ") || "none");

  await browser.close();
  srv.close();
})();
