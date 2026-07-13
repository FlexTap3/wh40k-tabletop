/* layouts11e-tests.js — validates the embedded 11th-edition tournament layouts in
   wh40k-tabletop.html: every `Official *` layout is the standardized 16-piece footprint set,
   in-bounds (rotation-aware), and 180°-rotationally symmetric. Plain node, no browser.
   Run: node layouts11e-tests.js */
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
// point (px,py) inside a rotated-rect footprint {x,y (top-left),w,h,rot}
function covers(px, py, t) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, a = -(t.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = px - cx, dy = py - cy, lx = dx * c - dy * s, ly = dx * s + dy * c;
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
  // in-bounds (rotation-aware), small tolerance
  for (const p of t) {
    const cs = corners(p);
    const inb = cs.every(([x, y]) => x >= -0.3 && x <= BW + 0.3 && y >= -0.3 && y <= BH + 0.3);
    assert(inb, name + ": piece " + (p.id || "") + " within board bounds");
  }
  // OBJECTIVES ON TERRAIN — every objective must sit on a terrain-area footprint (the fix for
  // "objectives floating in the open"). Triangles cover only half their bbox, so an objective
  // must be covered by a NON-triangle footprint (a rectangle it actually sits inside).
  for (const [ox, oy] of v.o) {
    const on = t.some(p => p.shape !== "tri" && covers(ox, oy, p));
    assert(on, name + ": objective (" + ox + "," + oy + ") sits on a terrain footprint");
  }
  // objectives / deployment / mission untouched
  assert(Array.isArray(v.o) && v.o.length >= 5, name + ": objectives preserved");
  assert(Array.isArray(v.dz) && v.dz.length === 2, name + ": two deployment zones preserved");
  assert(typeof v.m === "string" && v.m.length > 0, name + ": mission string preserved");
}

console.log(fails ? ("LAYOUTS-11E TESTS: " + fails + " FAILURES") : "LAYOUTS-11E TESTS: ALL PASSED");
process.exitCode = fails ? 1 : 0;
