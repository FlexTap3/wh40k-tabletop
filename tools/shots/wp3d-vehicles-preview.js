#!/usr/bin/env node
"use strict";
/* WP3D-8 visual check: renders every vehicle/monster chassis kit (real unit names + real
 * WP21_HULLS footprints where they exist) to a contact-sheet PNG, plus a full-board muster
 * shot mixing several kits/factions together. Best-effort visual iteration tool for this
 * packet (not part of the node test suite — tools/tests/wp3d-8-vehicles-tests.js is the
 * source of truth for pass/fail). Run: node wp3d-vehicles-preview.js (from tools/shots/,
 * after `npm install`). Mirrors wp3d-preview.js's server+Playwright approach.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(__dirname, "shots-out", "wp3d-vehicles");

const MIME = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

const PALETTES = {
  SM: { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' },
  AM: { hi: '#a8a86e', mid: '#5c5e34', lo: '#282a14' },
  ORK: { hi: '#8cbc4c', mid: '#4a7626', lo: '#1e360e' },
  TAU: { hi: '#dcae66', mid: '#9a6c2e', lo: '#442e10' },
  AE: { hi: '#72d0c0', mid: '#2a8078', lo: '#0e3834' },
  DRU: { hi: '#48b0a0', mid: '#1e564e', lo: '#0a2422' },
  NEC: { hi: '#48d868', mid: '#1c6434', lo: '#0a2412' },
  QI: { hi: '#ccae58', mid: '#4e5e80', lo: '#222c44' },
  TYR: { hi: '#c0a088', mid: '#6e4470', lo: '#2e1830' },
};

// [label, unit name, faction palette id, footprint, kw?]
const UNITS = [
  ["Rhino", "Rhino", "SM", { shape: 'r', wIn: 4.6, hIn: 3.0 }],
  ["Razorback", "Razorback", "SM", { shape: 'r', wIn: 4.6, hIn: 3.0 }],
  ["Predator", "Predator Destructor", "SM", { shape: 'r', wIn: 4.6, hIn: 3.4 }],
  ["Vindicator", "Vindicator", "SM", { shape: 'r', wIn: 4.6, hIn: 3.4 }],
  ["Whirlwind", "Whirlwind", "SM", { shape: 'r', wIn: 4.6, hIn: 3.4 }],
  ["Land Raider", "Land Raider Crusader", "SM", { shape: 'r', wIn: 6.0, hIn: 4.4 }],
  ["Leman Russ", "Leman Russ Battle Tank", "AM", { shape: 'r', wIn: 5.7, hIn: 4.0 }],
  ["Chimera", "Chimera", "AM", { shape: 'r', wIn: 5.3, hIn: 3.7 }],
  ["Basilisk", "Basilisk", "AM", { shape: 'r', wIn: 5.3, hIn: 3.7 }],
  ["Baneblade", "Baneblade", "AM", { shape: 'r', wIn: 9.3, hIn: 5.5 }],
  ["Trukk", "Trukk", "ORK", { shape: 'r', wIn: 5.5, hIn: 3.2 }],
  ["Battlewagon", "Battlewagon", "ORK", { shape: 'r', wIn: 7.0, hIn: 4.7 }],
  ["Drop Pod", "Drop Pod", "SM", { shape: 'c', dmm: 140 }],
  ["Devilfish", "Devilfish", "TAU", { shape: 'r', wIn: 7.0, hIn: 4.5 }],
  ["Hammerhead", "Hammerhead Gunship", "TAU", { shape: 'r', wIn: 7.0, hIn: 4.5 }],
  ["Sky Ray", "Sky Ray Gunship", "TAU", { shape: 'r', wIn: 7.0, hIn: 4.5 }],
  ["Piranha", "Piranha", "TAU", { shape: 'r', wIn: 4.7, hIn: 2.6 }],
  ["Land Speeder", "Land Speeder", "SM", { shape: 'r', wIn: 3.7, hIn: 2.5 }],
  ["Impulsor", "Impulsor", "SM", { shape: 'r', wIn: 4.6, hIn: 3.0 }],
  ["Repulsor", "Repulsor Executioner", "SM", { shape: 'r', wIn: 5.6, hIn: 3.6 }],
  ["Wave Serpent", "Wave Serpent", "AE", { shape: 'r', wIn: 6.3, hIn: 4.0 }],
  ["Raider", "Raider", "DRU", { shape: 'r', wIn: 7.3, hIn: 3.2 }],
  ["Ghost Ark", "Ghost Ark", "NEC", { shape: 'r', wIn: 6.7, hIn: 3.5 }],
  ["Monolith", "Monolith", "NEC", { shape: 'r', wIn: 6.5, hIn: 6.5 }],
  ["Dreadnought", "Dreadnought", "SM", { shape: 'c', dmm: 90 }],
  ["War Dog", "War Dog Stalker", "QI", { shape: 'r', wIn: 4.1, hIn: 2.75, oval: true }],
  ["Knight Paladin", "Knight Paladin", "QI", { shape: 'r', wIn: 5.1, hIn: 3.6, oval: true }],
  ["Triarch Stalker", "Triarch Stalker", "NEC", { shape: 'r', wIn: 4.0, hIn: 3.0 }],
  ["Carnifex", "Carnifex", "TYR", { shape: 'c', dmm: 90 }],
  ["Hive Tyrant", "Hive Tyrant", "TYR", { shape: 'c', dmm: 90 }],
  ["Trygon", "Trygon", "TYR", { shape: 'c', dmm: 120 }],
  ["Riptide", "Riptide", "TAU", { shape: 'c', dmm: 100 }],
  ["Wraithknight", "Wraithknight", "AE", { shape: 'r', wIn: 6.7, hIn: 4.1, oval: true }],
  ["Nightwing", "Nightwing Fighter", "AE", { shape: 'c', dmm: 60 }, ["AIRCRAFT", "VEHICLE"]],
];

const PREVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#20242a;font-family:sans-serif;}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;background:#000;}
.cell{position:relative;background:#7f8790;}
.cell img{display:block;width:100%;height:100%;}
.cell .lbl{position:absolute;left:2px;bottom:2px;color:#fff;font-size:10px;text-shadow:0 0 3px #000,0 0 3px #000;}
#muster{background:#2b3026;}
</style></head><body>
<div id="grid" class="grid"></div>
<canvas id="muster" width="1600" height="900" style="display:none"></canvas>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
import { voxelsToGeometry } from '/sections/wp3d-1-geometry.js';
import { _test } from '/sections/wp3d-8-vehicles.js';
const { KITS } = _test;

function kitFor(name, kw) {
  const sorted = KITS.slice().sort((a,b)=>(b.priority||0)-(a.priority||0));
  for (const k of sorted) { let m=false; try{ m=!!k.match({name,kw:kw||[]}); }catch(e){} if (m) return k; }
  return null;
}
const ctx = { THREE, bridge: {}, voxelsToGeometry };

function freshScene(bg) {
  const scene = new THREE.Scene();
  if (bg) scene.background = new THREE.Color(bg);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x70706a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-3, 1.5, -2);
  scene.add(fill);
  return scene;
}
function frameCam(object3d, aspect) {
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const diag = Math.sqrt(size.x*size.x+size.y*size.y+size.z*size.z) || 0.3;
  const camera = new THREE.PerspectiveCamera(36, aspect||1, 0.01, 200);
  camera.position.set(center.x+diag*0.9, center.y+diag*0.68, center.z+diag*1.0);
  camera.lookAt(center.x, center.y+size.y*0.1, center.z);
  return camera;
}

// Single shared canvas+renderer reused for every tile (Chrome caps live WebGL contexts at
// ~16/page; creating one InstancedMesh-style renderer per tile silently context-losses the
// earliest tiles once that cap is crossed). Each tile is captured via toDataURL() into its
// own <img>, so the grid ends up with N static images instead of N live GL contexts.
window.wp3dRenderContactSheet = function (palettes) {
  const gridEl = document.getElementById('grid');
  const cases = window.__UNITS;
  const W = 240, H = 220;
  const sharedCanvas = document.createElement('canvas'); sharedCanvas.width = W; sharedCanvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas: sharedCanvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  for (const [label, name, fid, fp, kw] of cases) {
    const pal = palettes[fid];
    const kit = kitFor(name, kw || []);
    const scene = freshScene(0x7f8790);
    let mesh;
    if (kit) {
      const geo = kit.build(ctx, { name }, fp, pal);
      mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    }
    scene.add(mesh);
    const camera = frameCam(mesh, W / H);
    renderer.clear();
    renderer.render(scene, camera);
    const dataUrl = sharedCanvas.toDataURL('image/png');

    const cell = document.createElement('div'); cell.className = 'cell';
    const img = document.createElement('img'); img.src = dataUrl; img.width = W; img.height = H;
    cell.appendChild(img);
    const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = label + (kit ? '' : ' [NO KIT]');
    cell.appendChild(lbl);
    gridEl.appendChild(cell);
  }
  window.wp3dGridReady = true;
};

window.wp3dRenderMuster = function (palettes) {
  const canvas = document.getElementById('muster');
  canvas.style.display = 'block';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1600, 900, false);
  const scene = freshScene(0x2b3026);

  // Single battle-line row (avoids the grid-overlap trap: real hull widths range 3.7in-9.3in,
  // far wider than any fixed grid cell) — two ranks, front rank = big tracked/hover vehicles,
  // back rank = walkers/monsters/knight, laid out left-to-right by CUMULATIVE real footprint
  // width + a fixed gap so nothing overlaps regardless of how wide any one hull is.
  const frontRank = [
    ["Rhino", "SM", { shape: 'r', wIn: 4.6, hIn: 3.0 }],
    ["Land Raider Crusader", "SM", { shape: 'r', wIn: 6.0, hIn: 4.4 }],
    ["Leman Russ Battle Tank", "AM", { shape: 'r', wIn: 5.7, hIn: 4.0 }],
    ["Baneblade", "AM", { shape: 'r', wIn: 9.3, hIn: 5.5 }],
    ["Hammerhead Gunship", "TAU", { shape: 'r', wIn: 7.0, hIn: 4.5 }],
    ["Wave Serpent", "AE", { shape: 'r', wIn: 6.3, hIn: 4.0 }],
    ["Ghost Ark", "NEC", { shape: 'r', wIn: 6.7, hIn: 3.5 }],
    ["Battlewagon", "ORK", { shape: 'r', wIn: 7.0, hIn: 4.7 }],
  ];
  const backRank = [
    ["Predator Destructor", "SM", { shape: 'r', wIn: 4.6, hIn: 3.4 }],
    ["Monolith", "NEC", { shape: 'r', wIn: 6.5, hIn: 6.5 }],
    ["Trukk", "ORK", { shape: 'r', wIn: 5.5, hIn: 3.2 }],
    ["Knight Paladin", "QI", { shape: 'r', wIn: 5.1, hIn: 3.6, oval: true }],
    ["Dreadnought", "SM", { shape: 'c', dmm: 90 }],
    ["Carnifex", "TYR", { shape: 'c', dmm: 90 }],
    ["Hive Tyrant", "TYR", { shape: 'c', dmm: 90 }],
    ["Wraithknight", "AE", { shape: 'r', wIn: 6.7, hIn: 4.1, oval: true }],
    ["Riptide", "TAU", { shape: 'c', dmm: 100 }],
  ];

  function layRank(list, zRow) {
    const gap = 1.4;
    // total width first, to center the rank on x=0
    let total = 0;
    for (const [, , fp] of list) total += (fp.wIn || (fp.dmm ? fp.dmm / 25.4 : 3)) + gap;
    total -= gap;
    let x = -total / 2;
    const meshes = [];
    for (const [name, fid, fp] of list) {
      const w = fp.wIn || (fp.dmm ? fp.dmm / 25.4 : 3);
      const kit = kitFor(name, []);
      if (kit) {
        const pal = palettes[fid];
        const geo = kit.build(ctx, { name }, fp, pal);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        mesh.position.set(x + w / 2, 0, zRow);
        meshes.push(mesh);
      }
      x += w + gap;
    }
    return meshes;
  }

  const group = new THREE.Group();
  for (const m of layRank(frontRank, 3.0)) group.add(m);
  for (const m of layRank(backRank, -3.2)) group.add(m);
  scene.add(group);

  // board plane sized to the actual muster footprint, not a fixed guess
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const boardGeo = new THREE.PlaneGeometry(size.x + 8, size.z + 8);
  boardGeo.rotateX(-Math.PI / 2);
  const board = new THREE.Mesh(boardGeo, new THREE.MeshBasicMaterial({ color: 0x2b3026 }));
  board.position.set(center.x, 0, center.z);
  scene.add(board);

  const camera = new THREE.PerspectiveCamera(38, 1600 / 900, 0.1, 500);
  const dist = Math.max(size.x / (1600 / 900), size.z) * 0.85 + 8;
  camera.position.set(center.x, center.y + dist * 0.85, center.z + dist * 1.25);
  camera.lookAt(center.x, center.y + size.y * 0.15, center.z);
  renderer.render(scene, camera);
  window.wp3dMusterReady = true;
};
window.__PALETTES = ${JSON.stringify(PALETTES)};
window.__UNITS = ${JSON.stringify(UNITS)};
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
    const page = await browser.newPage({ viewport: { width: 1450, height: 1400 } });
    page.on("console", m => { if (m.type() === "error") console.log("[page error]", m.text()); });
    page.on("pageerror", e => console.log("[page exception]", e.message));
    await page.goto(`http://127.0.0.1:${port}/__preview`, { waitUntil: "load" });
    await page.waitForFunction(() => window.wp3dReady === true, { timeout: 10000 });

    await page.evaluate((pals) => window.wp3dRenderContactSheet(pals), PALETTES);
    await page.waitForFunction(() => window.wp3dGridReady === true, { timeout: 20000 });
    const sheetFile = path.join(OUT_DIR, "contact-sheet.png");
    await page.locator("#grid").screenshot({ path: sheetFile });
    console.log("wrote", sheetFile);

    await page.evaluate((pals) => window.wp3dRenderMuster(pals), PALETTES);
    await page.waitForFunction(() => window.wp3dMusterReady === true, { timeout: 20000 });
    const musterFile = path.join(OUT_DIR, "muster-shot.png");
    await page.locator("#muster").screenshot({ path: musterFile });
    console.log("wrote", musterFile);
  } finally {
    await browser.close();
    server.close();
  }
  console.log("DONE — previews in " + OUT_DIR);
}

main().catch(e => { console.error("FAIL", e); process.exitCode = 1; });
