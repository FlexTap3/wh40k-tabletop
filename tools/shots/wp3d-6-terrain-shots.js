#!/usr/bin/env node
"use strict";
/* WP3D-6 visual-iteration shots: renders the mission-true terrain pack (sections/wp3d-6-
 * terrain2.js) so a human (or the agent itself) can judge "does this look like a GW
 * tournament table" per the contract's visual-iteration mandate. Not part of the pass/fail
 * test suite (tools/tests/wp3d-6-terrain-tests.js is the source of truth for correctness) —
 * this is the eyeball check. Run: node wp3d-6-terrain-shots.js  (from tools/shots/, after
 * `npm install` + `npx playwright install chromium` in the worktree root).
 *
 * Produces, under shots-out/wp3d-6-terrain/:
 *   00-official1a-2d-topdown.png   — the REAL 2D board (source of truth for footprints)
 *   01-official1a-3d-hero.png      — full "Official 1A" board, default 3/4 TTS-style camera
 *   02-official1a-3d-topdown.png   — same board, camera forced near-vertical (polar~0.12)
 *                                     for a direct footprint-alignment check against 00.
 *   10-ruin.png / 11-wall.png / 12-wood.png / 13-crate.png / 14-crater.png — close-ups of
 *   one representative instance of each kind, mission-realistic footprint sizes.
 *   99-contact-sheet.png           — all of the above tiled into one image.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(__dirname, "shots-out", "wp3d-6-terrain");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const PREVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#101216;}canvas{display:block;}
</style></head><body>
<canvas id="c" width="1000" height="750"></canvas>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
import { buildTerrain, buildBoard } from '/sections/wp3d-1-geometry.js';
import { createRenderer, createCameraRig } from '/sections/wp3d-2-renderer.js';
import { register } from '/sections/wp3d-6-terrain2.js';
register();

const canvas = document.getElementById('c');
let renderer = null, rig = null, scene = null;

function freshScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#101216');
  s.add(new THREE.HemisphereLight(0xffffff, 0x70706a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(30, 40, 20);
  s.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-20, 15, -25);
  s.add(fill);
  return s;
}

window.wp3dRenderLayout = function (terrain, board) {
  canvas.width = 1000; canvas.height = 750;
  renderer = createRenderer(THREE, canvas, { antialias: true, pixelRatioCap: 2 });
  renderer.setSize(1000, 750);
  rig = createCameraRig(THREE, canvas, board);
  rig.camera.aspect = 1000 / 750; rig.camera.updateProjectionMatrix();
  scene = freshScene();
  scene.add(buildBoard(board.w, board.h));
  terrain.forEach((t, i) => {
    const obj = buildTerrain(t.kind, t.w, t.h, t.id || (t.kind + i));
    obj.position.set(t.x + t.w / 2, 0, t.y + t.h / 2);
    obj.rotation.y = -(t.rot || 0) * Math.PI / 180;
    scene.add(obj);
  });
  renderer.renderer.render(scene, rig.camera);
};

window.wp3dSetPose = function (azimuth, polar, radiusFactor) {
  rig.orbitBy(azimuth - Math.PI / 4, polar - 0.95);
  rig.zoomBy(radiusFactor);
  rig.update(100000); // damping asymptotes to target almost immediately for a huge dt
  rig.camera.updateProjectionMatrix();
  renderer.renderer.render(scene, rig.camera);
};

function frame(object3d, w, h) {
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const diag = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) || 0.3;
  const camera = new THREE.PerspectiveCamera(38, w / h, 0.01, 200);
  // wide-and-flat pieces (ruin footprints, crater discs) get a LOWER, more oblique camera —
  // the generic 0.75 elevation factor tuned for tall mini archetypes reads as a bird's-eye
  // view when width/depth dwarfs height, hiding exactly the broken-column/rim structure we
  // want to show off.
  const flat = size.y < Math.max(size.x, size.z) * 0.35;
  const elev = flat ? 0.32 : 0.75;
  camera.position.set(center.x + diag * 0.95, center.y + diag * elev, center.z + diag * 1.0);
  camera.lookAt(center.x, center.y + size.y * 0.15, center.z);
  return camera;
}

window.wp3dRenderSingle = function (kind, w, h, id) {
  canvas.width = 640; canvas.height = 640;
  renderer = createRenderer(THREE, canvas, { antialias: true, pixelRatioCap: 2 });
  renderer.setSize(640, 640);
  const s = freshScene();
  const obj = buildTerrain(kind, w, h, id);
  s.add(obj);
  const cam = frame(obj, 640, 640);
  renderer.renderer.render(s, cam);
};

window.wp3dReady = true;
</script>
</body></html>`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, rsp) => {
      if (req.url === "/__preview3d") {
        rsp.writeHead(200, { "content-type": "text/html" });
        rsp.end(PREVIEW_HTML);
        return;
      }
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/wh40k-tabletop.html";
      const f = path.join(REPO_ROOT, p);
      if (!f.startsWith(REPO_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end("nope"); }
      rsp.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function main() {
  const { chromium } = require("playwright");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const shots = [];

  try {
    // ---- 2D reference: the REAL app, Official 1A loaded, no armies (clean footprints) ----
    const page2d = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    page2d.on("console", (m) => { if (m.type() === "error") console.log("[2d page error]", m.text()); });
    await page2d.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
    await page2d.waitForFunction(() => { const cv = document.getElementById("board"); return cv && cv.width > 0; });
    const layout = await page2d.evaluate(() => {
      const sel = document.getElementById("terrLayout");
      const opts = [...sel.querySelectorAll("option")];
      const opt = opts.find((o) => /Official 1A/i.test(o.value)) || opts[0];
      sel.value = opt.value; loadLayout(); fitView(); draw();
      const data = JSON.parse(document.getElementById("layouts40k-data").textContent);
      return data[opt.value];
    });
    const f0 = path.join(OUT_DIR, "00-official1a-2d-topdown.png");
    await page2d.locator("#board").screenshot({ path: f0 });
    shots.push(f0);
    console.log("wrote", f0, "-", layout.t.length, "terrain pieces");
    await page2d.close();

    // ---- 3D: custom harness, real registered WP3D-6 builders ----
    const page = await browser.newPage({ viewport: { width: 1020, height: 780 } });
    page.on("console", (m) => { if (m.type() === "error") console.log("[3d page error]", m.text()); });
    page.on("pageerror", (e) => console.log("[3d page exception]", String(e)));
    await page.goto(`http://127.0.0.1:${port}/__preview3d`);
    await page.waitForFunction(() => window.wp3dReady === true, null, { timeout: 10000 });

    await page.evaluate(([terrain, board]) => window.wp3dRenderLayout(terrain, board), [layout.t, { w: 60, h: 44 }]);
    const f1 = path.join(OUT_DIR, "01-official1a-3d-hero.png");
    await page.locator("#c").screenshot({ path: f1 });
    shots.push(f1);
    console.log("wrote", f1);

    // azimuth=0 axis-aligns the 3D top-down view with the 2D canvas's screen-x/screen-y
    // convention (no 45deg diagonal), so the two footprint layouts overlay directly.
    await page.evaluate(() => window.wp3dSetPose(0, 0.001, 10)); // near-vertical look-down
    const f2 = path.join(OUT_DIR, "02-official1a-3d-topdown.png");
    await page.locator("#c").screenshot({ path: f2 });
    shots.push(f2);
    console.log("wrote", f2);

    // ---- close-ups, one representative instance per kind (mission-realistic sizes) ----
    const CLOSEUPS = [
      ["ruin", 11, 7, "ruin-search-5"], // has both floor levels w/ 2-3 surviving quadrants each — a good demo of the broken-floor look, not the (also-valid but less illustrative) bare-rubble variant
      ["wall", 2, 11, "shot-wall"],
      ["wood", 10, 8, "shot-wood"],
      ["crate", 3, 2, "shot-crate"],
      ["crater", 6, 6, "shot-crater"],
    ];
    let n = 10;
    for (const [kind, w, h, id] of CLOSEUPS) {
      await page.evaluate(([k, ww, hh, ii]) => window.wp3dRenderSingle(k, ww, hh, ii), [kind, w, h, id]);
      const f = path.join(OUT_DIR, `${n}-${kind}.png`);
      await page.locator("#c").screenshot({ path: f });
      shots.push(f);
      console.log("wrote", f);
      n++;
    }
    await page.close();

    // ---- contact sheet ----
    const sheetPage = await browser.newPage();
    const cells = shots.map((p) => `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`);
    const html = `<!doctype html><html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px;">
      ${cells.map((c, i) => `<div style="display:flex;flex-direction:column;align-items:center;"><img src="${c}" style="width:100%;border:1px solid #444;"/><div style="color:#ccc;font:12px sans-serif;">${path.basename(shots[i])}</div></div>`).join("")}
    </body></html>`;
    await sheetPage.setContent(html);
    await sheetPage.setViewportSize({ width: 1500, height: 900 * Math.ceil(shots.length / 3) });
    const sheetFile = path.join(OUT_DIR, "99-contact-sheet.png");
    await sheetPage.screenshot({ path: sheetFile, fullPage: true });
    console.log("wrote", sheetFile);
    await sheetPage.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log("DONE — shots in " + OUT_DIR);
}

main().catch((e) => { console.error("FAIL", e); process.exitCode = 1; });
