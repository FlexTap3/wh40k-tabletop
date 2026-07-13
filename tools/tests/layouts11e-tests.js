/* layouts11e-tests.js — validates the embedded 11th-edition tournament layouts in
   wh40k-tabletop.html (generated from the official Event-Companion data by
   tools/gen-layouts11e-ri.js): every `Official *` layout is the standardized 16-piece footprint
   set, in-bounds (rotation-aware), with every objective sitting ON a footprint (rect or the
   actual triangle) and two deployment zones. Plain node, no browser. Run: node layouts11e-tests.js */
const fs = require("fs");
const path = require("path");

let fails = 0;
const assert = (c, msg) => { if (!c) { console.error("FAIL:", msg); fails++; } };

const html = fs.readFileSync(path.resolve(__dirname, "../../wh40k-tabletop.html"), "utf8");
const m = html.match(/<script id="layouts40k-data" type="application\/json">([\s\S]*?)<\/script>/);
assert(!!m, "layouts40k-data script block found");
const data = JSON.parse(m[1]);

const BW = 60, BH = 44, CX = 30, CY = 22, TOL = 0.6;
// rotation-aware corners of a piece {x,y,w,h,rot} (x,y = unrotated top-left, rot about center)
function corners(t) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, a = (t.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-t.w / 2, -t.h / 2], [t.w / 2, -t.h / 2], [t.w / 2, t.h / 2], [-t.w / 2, t.h / 2]]
    .map(p => [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c]);
}
function sizeClass(t) {
  const a = Math.max(t.w, t.h), b = Math.min(t.w, t.h);
  if (t.shape === "tri" && a === 11.5 && b === 8) return "tri";
  if (a === 11.5 && b === 7) return "large";
  if (a === 6 && b === 4) return "medium";
  if (a === 10 && b === 2.5) return "long";
  if (a === 6 && b === 2) return "short";
  return "?";
}
// unrotate world point (px,py) into a piece's local frame (origin = piece centre)
function toLocal(px, py, t) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, a = -(t.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = px - cx, dy = py - cy;
  return [dx * c - dy * s, dx * s + dy * c];
}
// wp9TriPts local corners (must match wh40k-tabletop.html): TL=-w/2,-h/2 ... BR=w/2,h/2
function triLocal(w, h, tc) {
  const L = -w / 2, T = -h / 2, R = w / 2, B = h / 2;
  return [[[L, T], [R, T], [L, B]], [[L, T], [R, T], [R, B]], [[R, T], [R, B], [L, B]], [[L, T], [L, B], [R, B]]][tc || 0];
}
// world-space vertices of a triangle piece (right-triangle footprint)
function triWorld(t) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, a = (t.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return triLocal(t.w, t.h, t.tc).map(([lx, ly]) => [cx + lx * c - ly * s, cy + lx * s + ly * c]);
}
// point (px,py) on a footprint: rotated-rect for rectangles, actual right-triangle for tri pieces
function covers(px, py, t) {
  const [lx, ly] = toLocal(px, py, t);
  if (t.shape === "tri") {
    const P = triLocal(t.w, t.h, t.tc);
    const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
    const d1 = sign(lx, ly, P[0][0], P[0][1], P[1][0], P[1][1]);
    const d2 = sign(lx, ly, P[1][0], P[1][1], P[2][0], P[2][1]);
    const d3 = sign(lx, ly, P[2][0], P[2][1], P[0][0], P[0][1]);
    const neg = d1 < -0.05 || d2 < -0.05 || d3 < -0.05, pos = d1 > 0.05 || d2 > 0.05 || d3 > 0.05;
    return !(neg && pos);
  }
  return Math.abs(lx) <= t.w / 2 + 0.01 && Math.abs(ly) <= t.h / 2 + 0.01;
}
const officials = Object.keys(data).filter(k => /^Official /.test(k));
assert(officials.length === 45, "45 Official layouts present (got " + officials.length + ")");

for (const name of officials) {
  const v = data[name];
  const t = v.t || [];
  assert(t.length === 16, name + ": exactly 16 terrain pieces (got " + t.length + ")");
  const byClass = {};
  for (const p of t) byClass[sizeClass(p)] = (byClass[sizeClass(p)] || 0) + 1;
  assert(byClass.tri === 2, name + ": 2 triangle buildings (got " + (byClass.tri || 0) + ")");
  assert(byClass.large === 4, name + ": 4 large buildings (got " + (byClass.large || 0) + ")");
  assert(byClass.medium === 4, name + ": 4 medium pieces (got " + (byClass.medium || 0) + ")");
  assert(byClass.long === 2, name + ": 2 long defence lines (got " + (byClass.long || 0) + ")");
  assert(byClass.short === 4, name + ": 4 short defence lines (got " + (byClass.short || 0) + ")");
  assert(!byClass["?"], name + ": every piece matches a known 11th-ed size class");
  // kinds map onto rules-safe kinds only
  for (const p of t) assert(["ruin", "wall", "crate"].includes(p.kind), name + ": piece kind is ruin/wall/crate (got " + p.kind + ")");
  // in-bounds (rotation-aware), small tolerance. Use the ACTUAL footprint: a triangle's empty
  // bbox corner may sit off-board while the real right-triangle ruin is well inside, so check the
  // triangle's 3 vertices for tri pieces and the 4 rect corners otherwise.
  for (const p of t) {
    const cs = p.shape === "tri" ? triWorld(p) : corners(p);
    const inb = cs.every(([x, y]) => x >= -0.3 && x <= BW + 0.3 && y >= -0.3 && y <= BH + 0.3);
    assert(inb, name + ": piece " + (p.id || "") + " within board bounds");
  }
  // OBJECTIVES ON TERRAIN — every objective must sit on a terrain-area footprint (the fix for
  // "objectives floating in the open"). covers() handles both rotated rectangles and the actual
  // right-triangle footprint, so an objective on a triangle ruin counts as on-terrain.
  for (const [ox, oy] of v.o) {
    const on = t.some(p => covers(ox, oy, p));
    assert(on, name + ": objective (" + ox + "," + oy + ") sits on a terrain footprint");
  }
  // objectives / deployment / mission untouched
  assert(Array.isArray(v.o) && v.o.length >= 5, name + ": objectives preserved");
  assert(Array.isArray(v.dz) && v.dz.length === 2, name + ": two deployment zones preserved");
  assert(typeof v.m === "string" && v.m.length > 0, name + ": mission string preserved");
}

console.log(fails ? ("LAYOUTS-11E TESTS: " + fails + " FAILURES") : "LAYOUTS-11E TESTS: ALL PASSED");
process.exitCode = fails ? 1 : 0;
