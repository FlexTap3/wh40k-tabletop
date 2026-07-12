#!/usr/bin/env node
"use strict";
/* WP3D-10 close-up preview: renders the die geometry (all 6 landed faces, close-up, for
 * pip-readability iteration) and the remote-move tween pose (ground vs. mid-flight vs.
 * landed) to PNGs under tools/shots/shots-out/wp3d-motion-previews/. Best-effort visual
 * check, same pattern as wp3d-preview.js. Run: node wp3d-motion-preview.js (from
 * tools/shots/, after `npm install` + `npx playwright install chromium`).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(__dirname, "shots-out", "wp3d-motion-previews");
const MIME = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

const PREVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#7f8790;}canvas{display:block;}
</style></head><body>
<canvas id="c" width="512" height="512"></canvas>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
import { buildArchetypeGeometry } from '/sections/wp3d-1-geometry.js';
import { buildDieGeometry, quaternionForFaceUp, tweenRemoteMove, MOTION_ARC_MS, SQUASH_MS } from '/sections/wp3d-10-motion.js';

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
  return scene;
}
function frame(object3d, fov, pad) {
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const diag = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) || 0.3;
  const camera = new THREE.PerspectiveCamera(fov || 38, 1, 0.01, 200);
  const d = diag * (pad || 1.15);
  camera.position.set(center.x + d * 0.85, center.y + d * 0.62, center.z + d * 0.95);
  camera.lookAt(center.x, center.y, center.z);
  return camera;
}

window.wp3dRenderDieFace = function (value) {
  const scene = freshScene();
  const geo = buildDieGeometry(THREE);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true })); // matches the real in-app material (unlit)
  mesh.quaternion.copy(quaternionForFaceUp(THREE, value, 0));
  scene.add(mesh);
  const camera = frame(mesh, 28, 1.7);
  renderer.render(scene, camera);
};

window.wp3dRenderDiceCluster = function (values) {
  const scene = freshScene();
  const geo = buildDieGeometry(THREE);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true }); // matches the real in-app material (unlit)
  const GOLDEN = 2.399963229728653;
  const group = new THREE.Object3D();
  values.forEach((v, i) => {
    const mesh = new THREE.Mesh(geo, mat);
    const r = 0.55 * Math.sqrt(i);
    const th = i * GOLDEN;
    mesh.position.set(r * Math.cos(th), 0.32, r * Math.sin(th));
    mesh.quaternion.copy(quaternionForFaceUp(THREE, v, i * 0.9));
    group.add(mesh);
  });
  scene.add(group);
  const camera = frame(group, 35, 1.25);
  renderer.render(scene, camera);
};

// Ground-truth token voxel mini (Space Marine palette, "skull" trooper) at three points
// along its own tween — ground(0ms), mid-flight, landed+squash-mid — laid out side by
// side along X so one screenshot shows the whole arc.
window.wp3dRenderTweenStrip = function () {
  const scene = freshScene();
  const SM = { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' };
  const footprint = { shape: 'c', dmm: 32 };
  const start = { x: 0, y: 0, rot: 0 }, end = { x: 3, y: 0, rot: 90 };
  const samples = [0, MOTION_ARC_MS * 0.5, MOTION_ARC_MS + SQUASH_MS * 0.4];
  const group = new THREE.Object3D();
  samples.forEach((ms, i) => {
    const geo = buildArchetypeGeometry('skull', footprint, SM);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    const pose = tweenRemoteMove(start, end, ms);
    mesh.position.set(i * 1.6, pose.lift, 0);
    mesh.quaternion.setFromEuler(new THREE.Euler(0, -pose.rot * Math.PI / 180, 0));
    mesh.scale.set(pose.scaleXZ, pose.scaleY, pose.scaleXZ);
    group.add(mesh);
    // ground-plane marker so the lift is legible against a reference
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: 0x333333 }));
    plate.position.set(i * 1.6, 0, 0);
    group.add(plate);
  });
  scene.add(group);
  const camera = frame(group, 35, 1.2);
  renderer.render(scene, camera);
};

window.wp3dReady = true;
</script>
</body></html>`;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/__preview") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(PREVIEW_HTML); return; }
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
    page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text()); });
    page.on("pageerror", (e) => console.log("[page exception]", e.message));
    await page.goto(`http://127.0.0.1:${port}/__preview`, { waitUntil: "load" });
    await page.waitForFunction(() => window.wp3dReady === true, { timeout: 10000 });

    for (const v of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate((val) => window.wp3dRenderDieFace(val), v);
      const file = path.join(OUT_DIR, `die-face-${v}.png`);
      await page.locator("#c").screenshot({ path: file });
      console.log("wrote", file);
    }

    await page.evaluate(() => window.wp3dRenderDiceCluster([1, 4, 6, 2, 5, 3, 6, 1, 2, 5, 3, 4]));
    const clusterFile = path.join(OUT_DIR, "dice-cluster-12.png");
    await page.locator("#c").screenshot({ path: clusterFile });
    console.log("wrote", clusterFile);

    await page.evaluate(() => window.wp3dRenderTweenStrip());
    const stripFile = path.join(OUT_DIR, "tween-strip.png");
    await page.locator("#c").screenshot({ path: stripFile });
    console.log("wrote", stripFile);
  } finally {
    await browser.close();
    server.close();
  }
  console.log("DONE — previews in " + OUT_DIR);
}

main().catch((e) => { console.error("FAIL", e); process.exitCode = 1; });
