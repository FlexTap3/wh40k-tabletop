#!/usr/bin/env node
/* gen-layouts11e-ri.js — regenerate the 45 "Official" 11th-edition layout GEOMETRY from the
 * official Event-Companion terrain data (45 layouts, 60w x 44h landscape board), transforming
 * each layout's 16 base footprints, objectives and deployment zones into this app's layout
 * schema ({kind,x,y,w,h,rot,shape,tc} / o:[[x,y]] / dz:[[[x,y]...]]).
 *
 * We copy ONLY functional geometry (piece positions/rotations, objective points, DZ polygons) —
 * measurements/facts — onto the app's existing kinds. Layout NAMES + mission (`m`) strings +
 * the 2 Custom layouts are preserved from the current html (no GW mission prose is imported).
 *
 * SOURCE (not committed — third-party generated data): pass its path as argv[2] or SRC env,
 *   default: the session scratchpad copy of rapidingress `terrain-data-11e.js`.
 * USAGE: node tools/gen-layouts11e-ri.js [path/to/terrain-data-11e.js] > /tmp/layouts11e-ri.json
 *
 * Piece-type -> app kind mapping (kinds drive LoS/cover/placement — UNCHANGED, reused):
 *   large_rect_7x11.5 -> ruin (7 x 11.5)      polygon_8x11.5 -> ruin + shape:"tri" (8 x 11.5)
 *   med_rect_6x4      -> ruin (6 x 4)          long_line_10x2.5 -> wall (10 x 2.5)
 *   short_line_6x2    -> wall (6 x 2)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || process.env.SRC ||
  '/private/tmp/claude-501/-Users-paulstadick-dev-PNT-WH40k/6f994c13-4867-4c66-a28e-ee798705d526/scratchpad/ref/ri-terrain-data-11e.js';
const HTML = path.join(__dirname, '..', 'wh40k-tabletop.html');

// --- load the official layouts ---------------------------------------------------------------
function loadEleven(src) {
  let s = fs.readFileSync(src, 'utf8')
    .replace(/^[\s\S]*?const ELEVEN_E_LAYOUTS\s*=\s*/, 'return ')
    .replace(/;\s*(module\.exports[\s\S]*)?$/, ';');
  return (new Function(s))();
}

// --- geometry helpers ------------------------------------------------------------------------
function hull(pts) {
  pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// minimum-area oriented bounding rectangle -> {cx,cy,w,h,angle(deg)}
function minRect(pts) {
  const h = hull(pts); let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of h) { const rx = p.x * c - p.y * s, ry = p.x * s + p.y * c; x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry); }
    const w = x1 - x0, ht = y1 - y0, area = w * ht;
    if (!best || area < best.area) {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, ca = Math.cos(ang), sa = Math.sin(ang);
      best = { area, w, h: ht, angle: ang * 180 / Math.PI, cx: mx * ca - my * sa, cy: mx * sa + my * ca };
    }
  }
  return best;
}
const norm360 = d => ((d % 360) + 360) % 360;

// Douglas-Peucker simplify a polyline (keeps the torn nibbles, drops RI's sub-0.05 micro-jag).
function dp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), A = pts[a], B = pts[b];
    let dmax = 0, idx = -1, dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - A[0]) * dy - (pts[i][1] - A[1]) * dx) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > 0) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// the REAL official footprint outline, in the piece's LOCAL unrotated frame (relative to centre),
// simplified — so the app can clip/stroke the authentic silhouette while rules use the rectangle.
function localOutline(points, cx, cy, rotDeg) {
  const a = -rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  let loc = points.map(p => { const dx = p.x - cx, dy = p.y - cy; return [dx * c - dy * s, dx * s + dy * c]; });
  loc = dp(loc, 0.13);                                  // ~0.13" tolerance keeps nibbles, cuts point count
  if (loc.length > 1) { const f = loc[0], l = loc[loc.length - 1]; if (f[0] === l[0] && f[1] === l[1]) loc.pop(); }
  return loc.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]);
}

// pieceType -> {kind, nominal [W,H], tri?}
const MAP = {
  'large_rect_7x11.5': { kind: 'ruin', nom: [7, 11.5] },
  'polygon_8x11.5':    { kind: 'ruin', nom: [8, 11.5], tri: true },
  'med_rect_6x4':      { kind: 'ruin', nom: [6, 4] },
  'long_line_10x2.5':  { kind: 'wall', nom: [10, 2.5] },
  'short_line_6x2':    { kind: 'wall', nom: [6, 2] },
};

// Convert a base piece polygon into an app rect {x,y,w,h,rot} at nominal size.
// Returns {kind,x,y,w,h,rot, angleWasNomAxis, cx,cy, r} for reuse by the triangle solver.
function toRect(t) {
  const m = MAP[t.pieceType];
  const r = minRect(t.losPoints || t.points);
  const [NW, NH] = m.nom;
  // does r.w correspond to NW (nominal width) or NH? pick the assignment closest to measured dims.
  const asIs = Math.abs(r.w - NW) + Math.abs(r.h - NH);
  const swap = Math.abs(r.w - NH) + Math.abs(r.h - NW);
  const rot = swap < asIs ? r.angle + 90 : r.angle;
  const x = r.cx - NW / 2, y = r.cy - NH / 2;
  return { kind: m.kind, x, y, w: NW, h: NH, rot: norm360(rot), cx: r.cx, cy: r.cy, m, r };
}

// wp9TriPts LOCAL corners (must match wh40k-tabletop.html): TL=-w/2,-h/2 ... BR=w/2,h/2.
function triLocal(w, h, tc) {
  const L = -w / 2, T = -h / 2, R = w / 2, B = h / 2;
  return [[[L, T], [R, T], [L, B]], [[L, T], [R, T], [R, B]], [[R, T], [R, B], [L, B]], [[L, T], [L, B], [R, B]]][tc || 0];
}
// world triangle corners from {cx,cy,w,h,rot,tc} using the app's geomCorners rotation.
function triWorld(cx, cy, w, h, rot, tc) {
  const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return triLocal(w, h, tc).map(([lx, ly]) => [cx + lx * c - ly * s, cy + lx * s + ly * c]);
}
// the 3 principal corners of a (jagged) polygon = the hull triple of maximum area.
function princ3(pts) {
  const P = hull(pts); let best = null;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) for (let k = j + 1; k < P.length; k++) {
    const ar = Math.abs((P[j].x - P[i].x) * (P[k].y - P[i].y) - (P[k].x - P[i].x) * (P[j].y - P[i].y)) / 2;
    if (!best || ar > best.a) best = { a: ar, v: [P[i], P[j], P[k]] };
  }
  return best.v;
}
// max corner distance between a reconstructed triangle and the source 3 corners (min over perms).
function triErr(recon, src3) {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let best = 1e9;
  for (const pm of perms) { let m = 0; for (let i = 0; i < 3; i++) m = Math.max(m, Math.hypot(recon[i][0] - src3[pm[i]].x, recon[i][1] - src3[pm[i]].y)); best = Math.min(best, m); }
  return best;
}
// Brute-force fit (rot, tc) so the app triangle reproduces the source polygon. Robust: no
// reliance on which bbox edge min-rect picked. Center is the min-rect centre; w,h nominal.
function fitTri(t, rect) {
  const src3 = princ3(t.losPoints || t.points);
  let best = { err: 1e9, rot: 0, tc: 0 };
  for (let rot = 0; rot < 360; rot += 1) for (let tc = 0; tc < 4; tc++) {
    const e = triErr(triWorld(rect.cx, rect.cy, rect.w, rect.h, rot, tc), src3);
    if (e < best.err) best = { err: e, rot, tc };
  }
  return best;
}

// --- build layouts ---------------------------------------------------------------------------
const L = loadEleven(SRC);
if (L.length !== 45) throw new Error('expected 45 official layouts, got ' + L.length);

// current html layout names in order (to key the output + preserve names/m/custom)
const html = fs.readFileSync(HTML, 'utf8');
const cur = JSON.parse(html.match(/<script id="layouts40k-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
const officialNames = Object.keys(cur).filter(n => n.startsWith('Official '));
if (officialNames.length !== 45) throw new Error('expected 45 Official names in html, got ' + officialNames.length);

// map RI layout (matchup+variant) -> app "Official N<variant>" by A/B/C order == html order.
// html order is already Official 1A,1B,1C,2A...15C == RI order (15 matchups x A/B/C). Verify counts.
const out = {};
const report = [];
let maxTriErr = 0; const triWarn = []; let fpPts = 0;
officialNames.forEach((name, i) => {
  const src = L[i];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const bases = src.terrain.filter(t => t.base);
  if (bases.length !== 16) throw new Error(name + ': expected 16 base pieces, got ' + bases.length);
  const t = [];
  const objs = [];
  const counts = {};
  bases.forEach((b, j) => {
    counts[b.pieceType] = (counts[b.pieceType] || 0) + 1;
    const rect = toRect(b);
    let rot = rect.rot, extra = {};
    if (rect.m.tri) { const tri = fitTri(b, rect); rot = tri.rot; extra = { shape: 'tri', tc: tri.tc }; if (tri.err > 1.2) maxTriErr = Math.max(maxTriErr, tri.err), triWarn.push(name + ' err=' + tri.err.toFixed(2)); }
    // fp = the real official footprint outline in the piece's local frame (edge cosmetics; rules use the rect)
    const fp = localOutline(b.points, rect.cx, rect.cy, rot);
    fpPts += fp.length;
    const piece = { kind: rect.kind, x: +rect.x.toFixed(2), y: +rect.y.toFixed(2), w: rect.w, h: rect.h, rot: +rot.toFixed(1), id: slug + '-t' + j, ...extra, fp };
    t.push(piece);
    if (b.objective) {
      // objective sits ON the footprint. For a triangle, the bbox centre lies on the hypotenuse,
      // so use the triangle CENTROID (well inside the piece); rectangles use the bbox centre.
      let ox = rect.cx, oy = rect.cy;
      if (rect.m.tri) { const v = princ3(b.losPoints || b.points); ox = (v[0].x + v[1].x + v[2].x) / 3; oy = (v[0].y + v[1].y + v[2].y) / 3; }
      objs.push({ n: b.objective.number == null ? 999 : b.objective.number, x: +ox.toFixed(2), y: +oy.toFixed(2) });
    }
  });
  // piece-type census must equal the official 16-piece set
  const want = { 'large_rect_7x11.5': 4, 'polygon_8x11.5': 2, 'med_rect_6x4': 4, 'long_line_10x2.5': 2, 'short_line_6x2': 4 };
  for (const k in want) if ((counts[k] || 0) !== want[k]) throw new Error(name + ': ' + k + ' count ' + (counts[k] || 0) + ' != ' + want[k]);
  objs.sort((a, b) => a.n - b.n);
  const o = objs.map(q => [q.x, q.y]);
  // Deployment zones sit on clean measured lines; RI encodes sub-0.2 insets from the board edge
  // and centreline (0.19, 40.04, 59.88, 22.02 ...) which put clean grid points a hair outside the
  // polygon. Snap each coord (nearest integer within 0.3, else nearest 0.5), clamp to the board,
  // and drop duplicate / colinear vertices so point-in-zone tests behave on the real lines.
  const snap = (v, hi) => { const i = Math.round(v); let r = Math.abs(v - i) <= 0.3 ? i : Math.round(v * 2) / 2; return Math.max(0, Math.min(hi, r)); };
  const clean = pts => {
    const q = pts.map(p => [snap(p[0], 60), snap(p[1], 44)]);
    const o = [];
    for (let i = 0; i < q.length; i++) {
      const a = o[o.length - 1], b = q[i], c = q[(i + 1) % q.length];
      if (a && a[0] === b[0] && a[1] === b[1]) continue;                 // duplicate
      if (a && ((a[0] - b[0]) * (b[1] - c[1]) - (a[1] - b[1]) * (b[0] - c[0])) === 0) continue; // colinear
      o.push(b);
    }
    return o;
  };
  const dz = (src.deploymentZones || []).map(z => clean(z.points.map(p => [p.x, p.y])));
  out[name] = { t, o, dz, m: cur[name].m || '' };
  report.push({ name, pieces: t.length, obj: o.length, dz: dz.length, tri: t.filter(p => p.shape === 'tri').map(p => p.tc).join('') });
});

// append the 2 Custom layouts unchanged
Object.keys(cur).filter(n => n.startsWith('Custom')).forEach(n => { out[n] = cur[n]; });

if (process.env.REPORT) {
  console.error('layout                                  pieces obj dz  tri-tc');
  report.forEach(r => console.error(r.name.padEnd(40), String(r.pieces).padStart(3), String(r.obj).padStart(3), String(r.dz).padStart(2), '   ' + r.tri));
  console.error('TOTAL output layouts:', Object.keys(out).length);
  console.error('triangle fit: worst err over 1.2u =', maxTriErr.toFixed(2), triWarn.length ? '(' + triWarn.length + ' warnings)' : '(all clean)');
  console.error('footprint outline points total:', fpPts, '(avg ' + (fpPts / (45 * 16)).toFixed(1) + '/piece)');
}
process.stdout.write(JSON.stringify(out));
