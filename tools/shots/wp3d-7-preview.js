#!/usr/bin/env node
"use strict";
/* WP3D-7 troop-kit visual iteration harness (WP3D-CONTRACT-V2 "visual iteration mandate").
 * Not part of the test suite (tools/tests/wp3d-7-troops-tests.js is the source of truth) —
 * this is the "render it, read the PNG, judge it like a hobbyist" step.
 *
 * Produces, under tools/shots/shots-out/wp3d-7-previews/:
 *  - kit-<id>-<faction>.png            one render per (sub-archetype x faction palette) cell
 *  - contact-sheet.png                 all cells composited into one grid, labeled
 *  - mustered-army.png                 a synthetic full-board muster: every kit represented,
 *                                       two factions, several squads each, camera pulled back
 *                                       to "tabletop zoom" so silhouettes must read at a glance
 *
 * Approach mirrors wp3d-preview.js: a tiny static file server roots the repo so the page can
 * import the real vendor/three + sections/wp3d-1-geometry.js + sections/wp3d-7-troops.js as
 * ES modules, then Playwright drives a real (headless) WebGL context.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(__dirname, "shots-out", "wp3d-7-previews");
const MIME = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

const PREVIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#7f8790;}canvas{display:block;}
</style></head><body>
<canvas id="c" width="420" height="420"></canvas>
<canvas id="board" width="1600" height="1000"></canvas>
<canvas id="compare" width="1200" height="560"></canvas>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
import { buildBoard, createSceneSync, mergeGeometries, voxelsToGeometry, wp3dHash, wp3dRng } from '/sections/wp3d-1-geometry.js';
import { register as registerTroopKits, TROOP_KITS } from '/sections/wp3d-7-troops.js';
registerTroopKits();

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x7f8790, 1);

function freshScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x70706a, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.75);
  fill.position.set(-3, 1.5, -2);
  scene.add(fill);
  return scene;
}
function frame(object3d, w, h) {
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const diag = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) || 0.3;
  const camera = new THREE.PerspectiveCamera(36, w / h, 0.01, 200);
  camera.position.set(center.x + diag * 0.9, center.y + diag * 0.65, center.z + diag * 1.0);
  camera.lookAt(center.x, center.y, center.z);
  return camera;
}

const CTX = { THREE, hash: wp3dHash, rng: wp3dRng, mergeGeometries, voxelsToGeometry };

const FOOTPRINTS = {
  'troop-heavy': { shape: 'c', dmm: 40 },
  'troop-line': { shape: 'c', dmm: 32 },
  'troop-light': { shape: 'c', dmm: 25 },
  'troop-mob': { shape: 'c', dmm: 32 },
  'troop-tyranid': { shape: 'c', dmm: 32 },
  'troop-necron': { shape: 'c', dmm: 32 },
  'troop-tau': { shape: 'c', dmm: 32 },
  'troop-tau-drone': { shape: 'c', dmm: 32 },
  'troop-eldar': { shape: 'c', dmm: 32 },
  'troop-bike': { shape: 'r', wIn: 3.55, hIn: 2.05, oval: true },
  'troop-swarm': { shape: 'c', dmm: 40 },
  'troop-generic': { shape: 'c', dmm: 32 },
};
// representative token per kit — id chosen for a stable pose bucket, sgt=true on one member
// of each family isn't needed here (sergeant crest is exercised in the node test suite).
function repToken(id, owner, name, kw, extra) {
  return Object.assign({ id, owner, name, kw, shape: 'c', dmm: 32, T: 4, sgt: false }, extra || {});
}
const REPS = {
  'troop-heavy': repToken('rep-heavy', 1, 'Terminator', ['INFANTRY', 'TERMINATOR'], { dmm: 40 }),
  'troop-line': repToken('rep-line', 1, 'Intercessor', ['INFANTRY', 'BATTLELINE']),
  'troop-light': repToken('rep-light', 1, 'Guardsman', ['INFANTRY'], { dmm: 25, T: 3 }),
  'troop-mob': repToken('rep-mob', 1, 'Boy/Cultist', ['INFANTRY']),
  'troop-tyranid': repToken('rep-tyranid', 1, 'Tyranid Warrior', ['INFANTRY']),
  'troop-necron': repToken('rep-necron', 1, 'Necron Warrior', ['INFANTRY']),
  'troop-tau': repToken('rep-tau', 1, 'Fire Warrior', ['INFANTRY']),
  'troop-tau-drone': repToken('rep-drone', 1, 'Marker Drone', ['INFANTRY']),
  'troop-eldar': repToken('rep-eldar', 1, 'Guardian', ['INFANTRY']),
  'troop-bike': repToken('rep-bike', 1, 'Outrider', ['INFANTRY', 'MOUNTED'], { shape: 'r', wIn: 3.55, hIn: 2.05, oval: true }),
  'troop-swarm': repToken('rep-swarm', 1, 'Ripper Swarm', ['INFANTRY', 'SWARM'], { dmm: 40 }),
  'troop-generic': repToken('rep-generic', 1, 'Kin Warrior', ['INFANTRY']),
};

window.wp3dRenderKit = function (kitId, palette) {
  const kit = TROOP_KITS.find(k => k.id === kitId);
  const scene = freshScene();
  const geo = kit.build(CTX, REPS[kitId], FOOTPRINTS[kitId], palette);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);
  renderer.setSize(420, 420, false);
  const camera = frame(mesh, 420, 420);
  renderer.render(scene, camera);
  // Force the GL command buffer to actually flush before the caller screenshots the canvas —
  // without this, preserveDrawingBuffer's contents aren't reliably composited into the page
  // by the time a CDP screenshot fires right after render() returns (observed as blank/
  // near-solid-color PNGs otherwise, even though the draw call itself is correct).
  renderer.getContext().finish();
};

// ---- mustered full-board muster: real token stream through createSceneSync + kit routing ----
const SM_PAL = { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' };
const ORK_PAL = { hi: '#8cbc4c', mid: '#4a7626', lo: '#1e360e' };
const TYR_PAL = { hi: '#c0a088', mid: '#6e4470', lo: '#2e1830' };
const NEC_PAL = { hi: '#48d868', mid: '#1c6434', lo: '#0a2412' };
const TAU_PAL = { hi: '#dcae66', mid: '#9a6c2e', lo: '#442e10' };
const AE_PAL = { hi: '#72d0c0', mid: '#2a8078', lo: '#0e3834' };
const FID_BY_OWNER = { 1: 'SM', 2: 'TYR', 3: 'ORK', 4: 'NEC', 5: 'TAU', 6: 'AE' };
const PAL_BY_FID = { SM: SM_PAL, TYR: TYR_PAL, ORK: ORK_PAL, NEC: NEC_PAL, TAU: TAU_PAL, AE: AE_PAL };
const bridge = {
  sel: new Set(),
  wpvSideFid: (owner) => FID_BY_OWNER[owner] || 'SM',
  wpvGlyphFor: () => 'skull', // built-in fallback path — every squad below should route via a kit instead
  WPV_FACTIONS: PAL_BY_FID,
};

function squad(startId, owner, name, kw, count, footprint, xBase, yBase) {
  const toks = [];
  for (let i = 0; i < count; i++) {
    toks.push(Object.assign({
      id: startId + '-' + i, owner, name, kw: kw.slice(), rot: 0,
      wounds: 2, maxW: 2, T: 4, sgt: i === 0,
      x: xBase + (i % 5) * 1.4, y: yBase + Math.floor(i / 5) * 1.4,
    }, footprint));
  }
  return toks;
}

let tokens = [];
let rowY = 2;
function row(entries) {
  let x = 2;
  for (const [owner, name, kw, count, fp] of entries) {
    tokens = tokens.concat(squad(name.replace(/\\s+/g, '') + '-' + owner, owner, name, kw, count, fp, x, rowY));
    x += 8;
  }
  rowY += 4;
}
// SM (owner 1) column vs TYR (owner 2) column — the two contact-sheet factions, muster ALL
// kits so a full-board shot exercises the whole routing table at once.
row([
  [1, 'Terminator', ['INFANTRY', 'TERMINATOR'], 5, { dmm: 40 }],
  [1, 'Intercessor', ['INFANTRY', 'BATTLELINE'], 5, { dmm: 32 }],
]);
row([
  [1, 'Outrider', ['INFANTRY', 'MOUNTED'], 3, { shape: 'r', wIn: 3.55, hIn: 2.05, oval: true }],
  [2, 'Tyranid Warrior', ['INFANTRY'], 3, { dmm: 32 }],
]);
row([
  [2, 'Termagant', ['INFANTRY', 'BEASTS'], 10, { dmm: 25 }],
  [2, 'Ripper Swarm', ['INFANTRY', 'SWARM'], 4, { dmm: 40 }],
]);
row([
  [3, 'Ork Boy', ['INFANTRY'], 10, { dmm: 32 }],
  [4, 'Necron Warrior', ['INFANTRY'], 10, { dmm: 32 }],
]);
row([
  [5, 'Fire Warrior', ['INFANTRY'], 6, { dmm: 32 }],
  [5, 'Marker Drone', ['INFANTRY'], 3, { dmm: 32 }],
  [6, 'Guardian', ['INFANTRY'], 6, { dmm: 32 }],
]);
row([
  [1, 'Cadian Guardsman', ['INFANTRY'], 10, { dmm: 25, T: 3 }],
]);
for (const t of tokens) if (t.T == null) t.T = 4;

window.wp3dRenderMuster = function () {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x70706a, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(20, 30, 15); scene.add(key);
  const board = buildBoard(60, 44);
  scene.add(board);
  const sync = createSceneSync(THREE, scene, bridge);
  sync.tick({ tokens, terrain: [], objectives: [], dz: [] });

  const boardCanvas = document.getElementById('board');
  const r2 = new THREE.WebGLRenderer({ canvas: boardCanvas, antialias: true, preserveDrawingBuffer: true });
  r2.setSize(1600, 1000, false);
  r2.setClearColor(0x14171c, 1);
  // frame the camera on the ACTUAL token bounds (not a fixed guess) so every squad — including
  // whichever row ends up last — is inside the shot.
  const xs = tokens.map(t => t.x), ys = tokens.map(t => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cz = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 10) + 6; // padding so edge rows aren't clipped
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 300);
  camera.position.set(cx, span * 0.78, cz + span * 1.05);
  camera.lookAt(cx, 0, cz);
  r2.render(scene, camera);
  r2.getContext().finish();
  window.wp3dMusterTokenCount = tokens.length;
};

// Close "tabletop zoom" comparison: Terminator vs Guardsman vs Termagant side by side, the
// exact litmus test from the contract ("would a 40k player recognize a Terminator vs a
// Guardsman vs a Termagant at tabletop zoom?").
window.wp3dRenderCompare = function () {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x70706a, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(4, 6, 5); scene.add(key);
  const board = buildBoard(12, 6);
  scene.add(board);
  const cmpTokens = [
    { id: 'cmp-term', owner: 1, name: 'Terminator', kw: ['INFANTRY', 'TERMINATOR'], shape: 'c', dmm: 40, x: 3, y: 3, rot: 0, T: 5, wounds: 3, maxW: 3, sgt: false },
    { id: 'cmp-guard', owner: 1, name: 'Cadian Guardsman', kw: ['INFANTRY'], shape: 'c', dmm: 25, x: 6, y: 3, rot: 0, T: 3, wounds: 1, maxW: 1, sgt: false },
    { id: 'cmp-gaunt', owner: 2, name: 'Termagant', kw: ['INFANTRY', 'BEASTS'], shape: 'c', dmm: 25, x: 9, y: 3, rot: 0, T: 3, wounds: 1, maxW: 1, sgt: false },
  ];
  const cmpBridge = { sel: new Set(), wpvSideFid: (o) => (o === 1 ? 'SM' : 'TYR'), wpvGlyphFor: () => 'skull', WPV_FACTIONS: PAL_BY_FID };
  const sync = createSceneSync(THREE, scene, cmpBridge);
  sync.tick({ tokens: cmpTokens, terrain: [], objectives: [], dz: [] });

  const cmpCanvas = document.getElementById('compare');
  const r3 = new THREE.WebGLRenderer({ canvas: cmpCanvas, antialias: true, preserveDrawingBuffer: true });
  r3.setSize(1200, 560, false);
  r3.setClearColor(0x14171c, 1);
  const camera = new THREE.PerspectiveCamera(38, 1200 / 560, 0.05, 100);
  camera.position.set(6, 3.2, 8.5);
  camera.lookAt(6, 0.6, 3);
  r3.render(scene, camera);
  r3.getContext().finish();
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

const KITS = [
  'troop-heavy', 'troop-line', 'troop-light', 'troop-mob', 'troop-tyranid', 'troop-necron',
  'troop-tau', 'troop-tau-drone', 'troop-eldar', 'troop-bike', 'troop-swarm', 'troop-generic',
];
const FACTIONS = [
  ['SM', { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' }],
  ['TYR', { hi: '#c0a088', mid: '#6e4470', lo: '#2e1830' }],
];

async function main() {
  const { chromium } = require("playwright");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("console", m => { if (m.type() === "error") pageErrors.push(m.text()); });
    page.on("pageerror", e => pageErrors.push(String(e.message || e)));
    await page.goto(`http://127.0.0.1:${port}/__preview`, { waitUntil: "load" });
    await page.waitForFunction(() => window.wp3dReady === true, { timeout: 10000 });

    const cellFiles = [];
    for (const kitId of KITS) {
      for (const [fname, pal] of FACTIONS) {
        await page.evaluate(([k, p]) => window.wp3dRenderKit(k, p), [kitId, pal]);
        const file = path.join(OUT_DIR, `kit-${kitId}-${fname}.png`);
        await page.locator("#c").screenshot({ path: file });
        cellFiles.push({ file, kitId, fname });
        console.log("wrote", file);
      }
    }

    // contact sheet: re-render each cell to a dataURL, then composite into one labeled grid.
    const sheetPath = path.join(OUT_DIR, "contact-sheet.png");
    const cols = 4;
    const cellsWithData = [];
    for (const kitId of KITS) {
      for (const [fname, pal] of FACTIONS) {
        await page.evaluate(([k, p]) => window.wp3dRenderKit(k, p), [kitId, pal]);
        const dataUrl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
        cellsWithData.push({ kitId, fname, dataUrl });
      }
    }
    await page.evaluate(async ({ cells, cols }) => {
      const cellW = 210, cellH = 230, pad = 4;
      const rows = Math.ceil(cells.length / cols);
      const sheet = document.createElement('canvas');
      sheet.width = cols * cellW; sheet.height = rows * cellH;
      const g = sheet.getContext('2d');
      g.fillStyle = '#20242b'; g.fillRect(0, 0, sheet.width, sheet.height);
      for (let i = 0; i < cells.length; i++) {
        const { kitId, fname, dataUrl } = cells[i];
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = dataUrl; });
        const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
        g.drawImage(img, cx + pad, cy + pad, cellW - pad * 2, cellW - pad * 2);
        g.fillStyle = '#e8e8e8'; g.font = '13px sans-serif';
        g.fillText(kitId + ' [' + fname + ']', cx + pad, cy + cellW - pad + 16);
      }
      window.__sheetDataUrl = sheet.toDataURL('image/png');
    }, { cells: cellsWithData, cols });
    const sheetDataUrl = await page.evaluate(() => window.__sheetDataUrl);
    fs.writeFileSync(sheetPath, Buffer.from(sheetDataUrl.split(",")[1], "base64"));
    console.log("wrote", sheetPath);

    // mustered full-board shot
    await page.evaluate(() => window.wp3dRenderMuster());
    const musterCount = await page.evaluate(() => window.wp3dMusterTokenCount);
    const musterPath = path.join(OUT_DIR, "mustered-army.png");
    await page.locator("#board").screenshot({ path: musterPath });
    console.log("wrote", musterPath, "(" + musterCount + " tokens)");

    // close "tabletop zoom" litmus shot: Terminator vs Guardsman vs Termagant, side by side
    await page.evaluate(() => window.wp3dRenderCompare());
    const comparePath = path.join(OUT_DIR, "compare-terminator-guardsman-termagant.png");
    await page.locator("#compare").screenshot({ path: comparePath });
    console.log("wrote", comparePath);

    if (pageErrors.length) {
      console.log("PAGE ERRORS:");
      pageErrors.forEach(e => console.log(" -", e));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log("DONE — previews in " + OUT_DIR);
}

main().catch(e => { console.error("FAIL", e); process.exitCode = 1; });
