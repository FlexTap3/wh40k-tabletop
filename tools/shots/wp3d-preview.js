#!/usr/bin/env node
"use strict";
/* WP3D-1 bonus preview: renders the 9 archetype voxel minis (Space Marine blue palette)
 * plus one instance of every terrain kind on a flat grey stage, to PNGs under
 * tools/shots/shots-out/wp3d-previews/. Best-effort visual check for the geometry-factory
 * packet — not part of the test suite (plain-node tests in tools/tests/ are the source of
 * truth). Run: node wp3d-preview.js  (from tools/shots/, after `npm install`).
 *
 * Approach: a tiny static file server roots the repo so the page can `import` the real
 * `/vendor/three.module.min.js` and `/sections/wp3d-1-geometry.js` as ES modules (import
 * specifiers in those files are root-relative once served over http, unlike file://) — then
 * Playwright drives a real WebGL context (works headless out of the box on this machine; no
 * --use-angle flag needed) and screenshots the canvas per object.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(__dirname, "shots-out", "wp3d-previews");

const MIME = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

const PREVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#7f8790;}canvas{display:block;}
</style></head><body>
<canvas id="c" width="512" height="512"></canvas>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
import { buildArchetypeGeometry, buildTerrain } from '/sections/wp3d-1-geometry.js';

const SM = { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' };
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(512, 512, false);
renderer.setClearColor(0x7f8790, 1);

function freshScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x70706a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-3, 1.5, -2);
  scene.add(fill);
  return scene;
}
function frame(object3d) {
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const diag = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) || 0.3;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  camera.position.set(center.x + diag * 0.85, center.y + diag * 0.62, center.z + diag * 0.95);
  camera.lookAt(center.x, center.y, center.z);
  return camera;
}

window.wp3dRenderArchetype = function (archetype, footprint) {
  const scene = freshScene();
  const geo = buildArchetypeGeometry(archetype, footprint, SM);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);
  const camera = frame(mesh);
  renderer.render(scene, camera);
};
window.wp3dRenderTerrain = function (kind, w, h, id) {
  const scene = freshScene();
  const obj = buildTerrain(kind, w, h, id);
  scene.add(obj);
  const camera = frame(obj);
  renderer.render(scene, camera);
};
window.wp3dReady = true;
</script>
</body></html>`;

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === "/__preview") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(PREVIEW_HTML);
        return;
      }
      const filePath = path.join(REPO_ROOT, decodeURIComponent(req.url.split("?")[0]));
      if (!filePath.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found: " + req.url); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const { chromium } = require("playwright");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on("console", m => { if (m.type() === "error") console.log("[page error]", m.text()); });
    page.on("pageerror", e => console.log("[page exception]", e.message));
    await page.goto(`http://127.0.0.1:${port}/__preview`, { waitUntil: "load" });
    await page.waitForFunction(() => window.wp3dReady === true, { timeout: 10000 });

    const ARCHETYPES = [
      ["skull", { shape: "c", dmm: 32 }],
      ["shield", { shape: "c", dmm: 32 }],
      ["helm", { shape: "c", dmm: 32 }],
      ["steed", { shape: "r", wIn: 3.55, hIn: 2.05, oval: true }],
      ["wing", { shape: "c", dmm: 40 }],
      ["claw", { shape: "c", dmm: 60 }],
      ["tank", { shape: "r", wIn: 4.6, hIn: 3.0 }],
      ["titan", { shape: "r", wIn: 11, hIn: 7 }],
      ["fallback", { shape: "c", dmm: 32 }],
    ];
    for (const [archetype, footprint] of ARCHETYPES) {
      await page.evaluate(([a, fp]) => window.wp3dRenderArchetype(a, fp), [archetype, footprint]);
      const file = path.join(OUT_DIR, `archetype-${archetype}.png`);
      await page.locator("#c").screenshot({ path: file });
      console.log("wrote", file);
    }

    const TERRAIN = [
      ["ruin", 8, 8, "preview-ruin"],
      ["wood", 8, 8, "preview-wood"],
      ["crate", 3, 3, "preview-crate"],
      ["wall", 4, 1, "preview-wall"],
      ["crater", 5, 5, "preview-crater"],
    ];
    for (const [kind, w, h, id] of TERRAIN) {
      await page.evaluate(([k, ww, hh, ii]) => window.wp3dRenderTerrain(k, ww, hh, ii), [kind, w, h, id]);
      const file = path.join(OUT_DIR, `terrain-${kind}.png`);
      await page.locator("#c").screenshot({ path: file });
      console.log("wrote", file);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log("DONE — previews in " + OUT_DIR);
}

main().catch(e => { console.error("FAIL", e); process.exitCode = 1; });
