#!/usr/bin/env node
"use strict";
/* WP4/WP5 geometry unit tests + LoS performance check.
 * Extracts the pure-geometry block (WP4-GEOM-BEGIN … WP4-GEOM-END) verbatim from
 * wh40k-tabletop.html so the tests can never drift from the shipped code.
 * Run: node tools/test_geometry.js
 */
const fs = require("fs"), path = require("path");
const HTML_PATH = path.join(__dirname, "..", "wh40k-tabletop.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

const m = html.match(/\/\* WP4-GEOM-BEGIN[\s\S]*?WP4-GEOM-END \*\//);
if (!m) { console.error("FAIL: WP4-GEOM block not found in wh40k-tabletop.html"); process.exit(1); }
const EXPORTS = ["geomSegSeg","geomCorners","geomEdges","geomPointInRect","geomSegHitsEdges",
                 "losPrep","losSamples","losPair","losUnitVs"];
const G = new Function(m[0] + "; return {" + EXPORTS.join(",") + "};")();

let pass = 0, fail = 0;
function T(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.error("  FAIL " + name); }
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log("== segment vs segment ==");
T("crossing segments intersect", G.geomSegSeg(0,0, 10,10, 0,10, 10,0) === true);
T("disjoint segments don't", G.geomSegSeg(0,0, 1,1, 5,5, 6,4) === false);
T("parallel segments don't (graze rule)", G.geomSegSeg(0,0, 10,0, 0,1, 10,1) === false);
T("collinear overlap treated as non-crossing", G.geomSegSeg(0,0, 10,0, 5,0, 15,0) === false);
T("touching at endpoint counts", G.geomSegSeg(0,0, 5,5, 5,5, 10,0) === true);

console.log("== rotated-rect corners / containment ==");
{
  // 4x2 rect at origin rotated 90° about its centre (2,1): occupies x∈[1,3], y∈[-1,3]
  const r = { x: 0, y: 0, w: 4, h: 2, rot: 90 };
  const C = G.geomCorners(r);
  const xs = C.map(p => p[0]), ys = C.map(p => p[1]);
  T("corners of 90°-rotated 4x2 span x[1,3] y[-1,3]",
    approx(Math.min(...xs), 1) && approx(Math.max(...xs), 3) &&
    approx(Math.min(...ys), -1) && approx(Math.max(...ys), 3));
  T("point inside rotated rect (outside unrotated footprint)", G.geomPointInRect(2, -0.5, r) === true);
  T("point inside unrotated footprint but outside rotated rect", G.geomPointInRect(0.2, 0.5, r) === false);
}
T("point inside plain rect", G.geomPointInRect(5, 5, { x: 4, y: 4, w: 2, h: 2, rot: 0 }) === true);
T("point outside plain rect", G.geomPointInRect(7, 5, { x: 4, y: 4, w: 2, h: 2, rot: 0 }) === false);

console.log("== segment vs rotated rect ==");
{
  const rect = { x: 4, y: 4, w: 2, h: 2, rot: 0 };
  const E = G.geomEdges(rect);
  T("segment through rect hits", G.geomSegHitsEdges(0, 5, 10, 5, E) === true);
  T("segment past rect misses", G.geomSegHitsEdges(0, 8, 10, 8, E) === false);
  // 45°-rotated square: corners stick out beyond the unrotated footprint
  const rot = { x: 4, y: 4, w: 2, h: 2, rot: 45 };
  const Er = G.geomEdges(rot);
  // vertical line at x=6.2: misses the unrotated square (edge at x=6) but hits the rotated one (corner at ~6.41)
  T("45° rotation extends the hit region", G.geomSegHitsEdges(6.2, 0, 6.2, 10, Er) === true &&
                                           G.geomSegHitsEdges(6.2, 0, 6.2, 10, E) === false);
}

console.log("== LoS pair (area rules) ==");
{
  const wallWide = [{ id:"w1", kind: "ruin", x: 4, y: -10, w: 2, h: 20, rot: 0 }]; // tall blocker between x=4..6
  const prep = G.losPrep(wallWide);
  const a = { x: 0, y: 0, r: 0.5 }, b = { x: 10, y: 0, r: 0.5 };
  T("blocked pair: every sight line crosses the area", G.losPair(a, b, prep, false).vis === false);
  const short = G.losPrep([{ kind: "ruin", x: 4, y: -0.1, w: 2, h: 0.2, rot: 0 }]); // thin strip: clips centre-height lines only
  const rp = G.losPair(a, b, short, false);
  T("partially blocked pair: visible + part flag", rp.vis === true && rp.part === true);
  const inside = { x: 5, y: 0, r: 0.5 }; // inside the blocker
  T("model inside the area is excluded (into/out of doesn't block)", G.losPair(a, inside, prep, false).vis === true);
  T("crater never obscures", G.losPair(a, b, G.losPrep([{ kind: "crater", x: 4, y: -10, w: 2, h: 20, rot: 0 }]), false).vis === true);
  // thin 1x8 strip centred at (5,2), rotated 30° — sweeps across the whole y∈[-0.5,0.5] sight band; neither model inside
  const rotBlk = G.losPrep([{ kind: "ruin", x: 4.5, y: -2, w: 1, h: 8, rot: 30 }]);
  T("rotated obscuring rect blocks", G.losPair(a, b, rotBlk, false).vis === false);
  T("no terrain → visible", G.losPair(a, b, G.losPrep([]), false).vis === true);
}

console.log("== unit-level visibility / cover ==");
{
  const prep = G.losPrep([{ kind: "ruin", x: 4, y: -10, w: 2, h: 20, rot: 0 }]);
  const A = [{ x: 0, y: 0, r: 0.5 }];
  const Bhid = [{ x: 10, y: 0, r: 0.5 }, { x: 10, y: 2, r: 0.5 }];
  const Bpeek = [{ x: 10, y: 0, r: 0.5 }, { x: 10, y: 30, r: 0.5 }]; // second model well past the wall's end
  T("unit fully behind area: not visible", G.losUnitVs(A, Bhid, prep, false).vis === false);
  const peek = G.losUnitVs(A, Bpeek, prep, false);
  T("one model peeking → unit visible", peek.vis === true);
  const coverIn = G.losUnitVs(A, [{ x: 20, y: 0, r: 0.5 }], G.losPrep([{ kind: "wood", x: 19, y: -1, w: 2, h: 2, rot: 0 }]), true);
  T("INFANTRY standing inside an area gets cover", coverIn.vis === true && coverIn.cover === true);
  const noKw = G.losUnitVs(A, [{ x: 20, y: 0, r: 0.5 }], G.losPrep([{ kind: "wood", x: 19, y: -1, w: 2, h: 2, rot: 0 }]), false);
  T("same spot without cover keywords: no cover", noKw.vis === true && noKw.cover === false);
  const d = G.losUnitVs(A, [{ x: 10, y: 0, r: 0.5 }], G.losPrep([]), false);
  T("edge-to-edge distance", approx(d.dist, 9, 1e-9));
}

console.log("== WP5: floors vs low walls ==");
{
  // low wall between observer and target: blocks at ground level, ignored from lvl>=1
  const wall = G.losPrep([{ kind: "wall", x: 4, y: -10, w: 2, h: 20, rot: 0 }]);
  const tgt = [{ x: 10, y: 0, r: 0.5 }];
  T("ground-level observer blocked by low wall", G.losUnitVs([{ x: 0, y: 0, r: 0.5, lvl: 0 }], tgt, wall, false).vis === false);
  T("lvl 1 observer sees over the low wall", G.losUnitVs([{ x: 0, y: 0, r: 0.5, lvl: 1 }], tgt, wall, false).vis === true);
  // dense terrain is NOT ignored from height
  const ruin = G.losPrep([{ kind: "ruin", x: 4, y: -10, w: 2, h: 20, rot: 0 }]);
  T("lvl 1 observer still blocked by dense (ruin) area", G.losUnitVs([{ x: 0, y: 0, r: 0.5, lvl: 2 }], tgt, ruin, false).vis === false);
}

/* ===== performance: full-army LoS scan on a real layout, 200 models ===== */
console.log("== performance (target: full scan < 16 ms, 200 models) ==");
{
  const lm = html.match(/<script id="layouts40k-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!lm) { console.error("  FAIL: layouts40k-data not found"); process.exit(1); }
  const layouts = JSON.parse(lm[1]);
  const layName = Object.keys(layouts).find(k => k.startsWith("Official 1A")) || Object.keys(layouts)[0];
  const terrain = layouts[layName].t;
  // 200 synthetic models: 10 observers (one unit) + 19 enemy units of 10, spread over a 60x44 board
  const mk = (x, y) => ({ x, y, r: 0.63 });
  const obs = Array.from({ length: 10 }, (_, i) => mk(2 + (i % 5) * 1.4, 40 + Math.floor(i / 5) * 1.4));
  const enemies = [];
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let u = 0; u < 19; u++) {
    const cx = 3 + rnd() * 54, cy = 2 + rnd() * 30;
    enemies.push(Array.from({ length: 10 }, (_, i) => mk(cx + (i % 5) * 1.3, cy + Math.floor(i / 5) * 1.3)));
  }
  // warm up JIT, then time 20 full scans
  const scan = () => {
    const prep = G.losPrep(terrain);
    let acc = 0;
    for (const B of enemies) { const r = G.losUnitVs(obs, B, prep, true); acc += (r.vis ? 1 : 0) + (r.cover ? 2 : 0); }
    return acc;
  };
  for (let i = 0; i < 5; i++) scan();
  const t0 = process.hrtime.bigint();
  const N = 20; let sink = 0;
  for (let i = 0; i < N; i++) sink += scan();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`  layout "${layName}", ${terrain.length} terrain rects, 200 models → full scan avg ${ms.toFixed(2)} ms (sink ${sink})`);
  T("full-army LoS scan < 16 ms", ms < 16);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
