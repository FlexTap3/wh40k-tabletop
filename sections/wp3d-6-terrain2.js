/* ==== WP3D-6: mission-true terrain pack ==== Overrides the generic terrain builders with
 * GW-tournament-style scenery matching the official layouts: ruins = low rubble footprints
 * + broken floor slabs (the obscuring AREA, not a monolith); walls = tall broken ruin
 * facades w/ windows + jagged tops (the vertical scenery); richer woods/crates/craters.
 * Registered via register() — called by the wh40k-3d.js orchestrator at init.
 *
 * Design note (contract "Terrain semantics"): official layouts pair kind:'ruin' (an
 * obscuring AREA, e.g. 11x7") with separate kind:'wall' pieces (thin, 1.5-2 x 6-11", the
 * REAL vertical scenery). So here ruin stays LOW (rubble + partial floor slabs a token can
 * stand on) and wall carries all the height. Every plan*(id,w,h) function below is a PURE
 * function of (id,w,h) — no THREE, no ctx — so tests can assert exact numbers (slab tops,
 * clearances, bounds) without constructing geometry; the build* functions are thin adapters
 * that turn a plan into an Object3D via ctx.THREE/ctx.mergeGeometries.
 */
import { registerTerrainBuilder, wp3dHash, wp3dRng } from './wp3d-1-geometry.js';

/* ---------------------------------------------------------------------------------------
 * Shared bounds-safety helper: every generated feature gets clamped through fit() so it can
 * never poke more than BOUND_MARGIN inches past the terrain footprint, however small w/h are
 * or however the RNG rolls — this is what makes the "everything within footprint bounds
 * ±0.2in" gate unconditionally true instead of "true for realistic mission dimensions".
 * ------------------------------------------------------------------------------------- */
const BOUND_MARGIN = 0.18;
function fit(center, half, extentHalf) {
  const limit = extentHalf + BOUND_MARGIN;
  const h = Math.min(Math.max(half, 0), Math.max(limit, 0.01));
  const lim = Math.max(0, limit - h);
  const c = Math.max(-lim, Math.min(lim, center));
  return { center: c, half: h };
}

function rngFor(tag, id) { return wp3dRng(wp3dHash(tag + ':' + id)); }

function col(THREE, hex) { return new THREE.Color(hex); }

/* mergeGeometries (wp3d-1-geometry.js) requires every part to be indexed. Most primitives
 * are, but three.js's Polyhedron-family geometries (Icosahedron/etc, used for canopy blobs)
 * are built non-indexed for flat shading — synthesize a trivial sequential index (positions
 * already arrive in triangle order) so they can merge like everything else. */
function ensureIndexed(THREE, g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const idx = n <= 65535 ? new Uint16Array(n) : new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/* Merge a list of {geometry, colorHex} parts (already positioned in local terrain space)
 * into one vertex-colored Mesh via ctx.mergeGeometries — keeps each terrain piece to a
 * handful of draw calls no matter how many small boxes/cylinders make it up. */
function mergedMesh(ctx, parts) {
  const { THREE, mergeGeometries } = ctx;
  const withColor = parts.map(p => ({ geometry: ensureIndexed(THREE, p.geometry), color: col(THREE, p.colorHex) }));
  const geo = mergeGeometries(withColor);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

/* =========================================================================================
 * RUIN — the obscuring AREA. Low rubble plate (~0.15") + scattered debris + low crumbled
 * wall stubs (<=0.6", marks the footprint edge without blocking sightlines) + 1-2 PARTIAL
 * floor slabs whose TOP faces sit at exactly y=3 and y=6 (elevationFor() in wp3d-1-geometry.js
 * already stands lvl-1/2 tokens at lvl*3 when inside a ruin footprint — these slabs are the
 * visual floor that matches that rule) on broken corner columns. Interior stays open.
 * ======================================================================================= */
const RUIN_PAL = {
  plate: '#2b313c', debrisLo: '#333a46', debrisHi: '#4a5468',
  stub: '#454f60', column: '#4e5870', slab: '#5c6478',
};

export function ruinPlan(id, w, h) {
  const rnd = rngFor('ruin', id);
  const hw = w / 2, hh = h / 2;
  const plan = { w, h, basePlateH: 0.15, debris: [], stubs: [], corners: [], slabs: [] };

  // ---- 1-2 partial floor levels, tops pinned to exactly 3 and 6. Each level is up to 4
  // quadrant slabs (one per corner) so "which corners survive" breaks the FLOOR too, not
  // just its support columns — a clean intact rectangle read as a floating table, a notched
  // broken quadrant floor reads as a ruin. ----
  const canFloor = w >= 1.6 && h >= 1.6;
  const haveL1 = canFloor && rnd() < 0.85;
  const haveL2 = haveL1 && rnd() < 0.55;
  const levels = [[3, haveL1], [6, haveL2]];
  for (const [topY, have] of levels) {
    if (!have) continue;
    const rawSw = w * (0.5 + rnd() * 0.25), rawSd = h * (0.5 + rnd() * 0.25);
    const { center: cx, half: hsw } = fit(0, rawSw / 2, hw - 0.2);
    const { center: cz, half: hsd } = fit(0, rawSd / 2, hh - 0.2);
    // re-roll an off-center placement now that the max half-size is known
    const maxOffX = Math.max(0, hw - hsw - 0.1), maxOffZ = Math.max(0, hh - hsd - 0.1);
    const ocx = (rnd() * 2 - 1) * maxOffX, ocz = (rnd() * 2 - 1) * maxOffZ;
    const fx = fit(ocx, hsw, hw), fz = fit(ocz, hsd, hh);
    const sw = hsw * 2, sd = hsd * 2, thick = 0.28;
    // 4 corner slots, in a fixed order shared by the quadrant slab AND its support column
    // so a surviving corner always keeps both its floor piece and its post.
    const slots = [
      { sx: -1, sz: -1 }, { sx: 1, sz: -1 }, { sx: -1, sz: 1 }, { sx: 1, sz: 1 },
    ];
    let survive = slots.map(() => rnd() < 0.72);
    if (survive.filter(Boolean).length < 2) { survive = [true, true, false, false]; }
    for (let k = 0; k < 4; k++) {
      if (!survive[k]) continue;
      const { sx, sz } = slots[k];
      const qw = hsw + 0.03, qd = hsd + 0.03; // tiny center overlap, no seam gap
      const qcx = fx.center + sx * hsw / 2, qcz = fz.center + sz * hsd / 2;
      plan.slabs.push({ cx: qcx, cz: qcz, w: qw, d: qd, topY, thick });
      const colxRaw = fx.center + sx * (hsw - 0.2), colzRaw = fz.center + sz * (hsd - 0.2);
      const cfx = fit(colxRaw, 0.21, hw), cfz = fit(colzRaw, 0.21, hh);
      const colx = cfx.center, colz = cfz.center;
      plan.corners.push({ x: colx, z: colz, topY, w: 0.42, d: 0.42 });
      // a rubble heap at the foot of every surviving column — visually "grounds" the post
      // instead of it reading as a floating stick.
      const heapR = 0.32 + rnd() * 0.18;
      const hf = fit(colx, heapR, hw), hf2 = fit(colz, heapR, hh);
      plan.debris.push({ x: hf.center, z: hf2.center, hx: hf.half, hz: hf2.half, h: 0.28 + rnd() * 0.22, tone: true });
    }
  }

  // ---- scattered rubble debris across the whole footprint (bigger, more of it, so the
  // structure reads as ruin wreckage rather than a bare plate under a floating slab) ----
  const nDebris = 10 + Math.floor(rnd() * 8); // 10-17
  for (let i = 0; i < nDebris; i++) {
    const hx = 0.12 + rnd() * 0.20, hz = 0.11 + rnd() * 0.18, hgt = 0.12 + rnd() * 0.30;
    const fx = fit((rnd() * 2 - 1) * hw, hx, hw), fz = fit((rnd() * 2 - 1) * hh, hz, hh);
    plan.debris.push({ x: fx.center, z: fz.center, hx: fx.half, hz: fz.half, h: hgt, tone: i % 2 === 0 });
  }

  // ---- low crumbled wall stubs marking the footprint edge (<=0.6", interior stays open) ----
  const edges = [[-hw, -hh, w, 0], [hw, -hh, 0, h], [hw, hh, -w, 0], [-hw, hh, 0, -h]];
  const segLen = 1.3;
  for (const [ex, ez, dx, dz] of edges) {
    const len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    let pos = 0;
    while (pos < len) {
      const seg = Math.min(segLen * (0.7 + rnd() * 0.7), len - pos);
      if (rnd() < 0.62) {
        const mid = pos + seg / 2;
        const cx = ex + ux * mid, cz = ez + uz * mid;
        const along = Math.abs(ux) > 0.5 ? seg : 0.22, cross = Math.abs(uz) > 0.5 ? seg : 0.22;
        const hgt = Math.min(0.58, 0.28 + rnd() * 0.3); // <=0.6 ceiling, more presence than before
        const fx = fit(cx, along / 2, hw), fz = fit(cz, cross / 2, hh);
        plan.stubs.push({ cx: fx.center, cz: fz.center, w: fx.half * 2, d: fz.half * 2, h: hgt });
      }
      pos += seg;
    }
  }
  return plan;
}

function ruinMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const parts = [];
  parts.push({ geometry: (() => { const g = new THREE.BoxGeometry(plan.w, plan.basePlateH, plan.h); g.translate(0, plan.basePlateH / 2, 0); return g; })(), colorHex: RUIN_PAL.plate });
  for (const d of plan.debris) {
    const g = new THREE.BoxGeometry(d.hx * 2, d.h, d.hz * 2);
    g.translate(d.x, plan.basePlateH + d.h / 2, d.z);
    parts.push({ geometry: g, colorHex: d.tone ? RUIN_PAL.debrisHi : RUIN_PAL.debrisLo });
  }
  for (const s of plan.stubs) {
    const g = new THREE.BoxGeometry(s.w, s.h, s.d);
    g.translate(s.cx, s.h / 2, s.cz);
    parts.push({ geometry: g, colorHex: RUIN_PAL.stub });
  }
  for (const c of plan.corners) {
    const g = new THREE.BoxGeometry(c.w, c.topY, c.d);
    g.translate(c.x, c.topY / 2, c.z);
    parts.push({ geometry: g, colorHex: RUIN_PAL.column });
  }
  group.add(mergedMesh(ctx, parts));

  let maxTop = plan.basePlateH;
  for (const s of plan.slabs) {
    const g = new THREE.BoxGeometry(s.w, s.thick, s.d);
    g.translate(s.cx, s.topY - s.thick / 2, s.cz);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: RUIN_PAL.slab }));
    mesh.userData.isSlab = true;
    mesh.userData.slabTopY = s.topY;
    group.add(mesh);
    maxTop = Math.max(maxTop, s.topY);
  }
  if (!plan.slabs.length) for (const c of plan.corners) maxTop = Math.max(maxTop, c.topY);
  group.userData.terrainHeight = maxTop;
  group.userData.builtBy = 'wp3d-6-terrain2';
  return group;
}

function buildRuin(ctx, kind, w, h, id) { return ruinMesh(ctx, ruinPlan(id, w, h)); }

/* =========================================================================================
 * WALL — the REAL vertical scenery. 4-6" broken ruin facade: alternating solid piers and
 * windowed bays (2 window-row gaps per bay = "2-3 rows" of holes read across the wall face),
 * one guaranteed door gap, jagged per-column top heights (clamped to [4,6] individually so
 * the whole silhouette — and userData.terrainHeight — stays in-contract). thickness = the
 * piece's own thin footprint dimension (real layouts hand us e.g. w=2,h=11 directly).
 * ======================================================================================= */
const WALL_PAL = { pier: '#5c6068', floorA: '#545860', floorB: '#5e6270', floorC: '#525660' };

export function wallPlan(id, w, h) {
  const rnd = rngFor('wall', id);
  const longIsX = w >= h;
  const length = Math.max(w, h), thickness = Math.min(w, h);
  const nSeg = Math.max(3, Math.round(length / 1.1));
  const step = length / nSeg;
  const doorIdx = Math.floor(nSeg * (0.3 + rnd() * 0.4));
  const cols = [];
  for (let i = 0; i < nSeg; i++) {
    const t = -length / 2 + step * (i + 0.5);
    const baseH = Math.min(6, Math.max(4, 4 + rnd() * 2 + (rnd() - 0.5) * 1.0));
    let type = 'pier';
    if (i === doorIdx || (nSeg > 5 && rnd() < 0.08)) type = 'gap';
    else if (rnd() < 0.55) type = 'bay';
    cols.push({ t, w: step * 0.92, h: baseH, type });
  }
  if (cols.every(c => c.type === 'gap')) cols[0].type = 'pier'; // never a fully-empty facade
  return { length, thickness, longIsX, cols };
}

function wallMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const parts = [];
  let maxH = 4;
  for (const c of plan.cols) {
    if (c.type === 'gap') continue;
    const cx = plan.longIsX ? c.t : 0, cz = plan.longIsX ? 0 : c.t;
    const bw = plan.longIsX ? c.w : plan.thickness, bd = plan.longIsX ? plan.thickness : c.w;
    maxH = Math.max(maxH, c.h);
    if (c.type === 'pier') {
      const g = new THREE.BoxGeometry(bw, c.h, bd);
      g.translate(cx, c.h / 2, cz);
      parts.push({ geometry: g, colorHex: WALL_PAL.pier });
      continue;
    }
    // bay: 3 stacked floors with 2 window-row gaps between them
    const gap = Math.min(0.4, c.h * 0.09);
    const floorH = (c.h - gap * 2) / 3;
    const floors = [WALL_PAL.floorA, WALL_PAL.floorB, WALL_PAL.floorC];
    let y = 0;
    for (let f = 0; f < 3; f++) {
      const g = new THREE.BoxGeometry(bw, floorH, bd);
      g.translate(cx, y + floorH / 2, cz);
      parts.push({ geometry: g, colorHex: floors[f] });
      y += floorH + gap;
    }
  }
  group.add(mergedMesh(ctx, parts));
  group.userData.terrainHeight = Math.min(6, Math.max(4, maxH));
  group.userData.builtBy = 'wp3d-6-terrain2';
  return group;
}

function buildWall(ctx, kind, w, h, id) { return wallMesh(ctx, wallPlan(id, w, h)); }

/* =========================================================================================
 * WOOD — trunks + layered canopy. Canopy underside must sit >=2.2" up so minis are visible
 * beneath at shallow camera angles: trunks are grown tall enough (2.3-3.6") that the lowest
 * canopy layer never dips below that, regardless of RNG. Autumn-olive tones per 2D wood color.
 * ======================================================================================= */
const WOOD_PAL = { trunk: '#4a3620', canopyLo: '#4a5a28', canopyMid: '#6b6a2c', canopyHi: '#8a7a34' };

export function woodPlan(id, w, h) {
  const rnd = rngFor('wood', id);
  const hw = w / 2, hh = h / 2;
  const n = 3 + Math.floor(rnd() * 4); // 3-6 trunks
  const trees = [];
  for (let i = 0; i < n; i++) {
    const trunkH = 2.3 + rnd() * 1.3; // >=2.3, safely above the 2.2 clearance floor
    const trunkR = 0.16 + rnd() * 0.09; // chunkier trunk so it doesn't read as a "lollipop stick"
    const layers = 3 + Math.floor(rnd() * 2); // 3-4 canopy blobs, offset/rotated for a fluffy silhouette
    const rMax = 0.55 + rnd() * 0.45;
    const { center: x, half: rx } = fit((rnd() * 2 - 1) * hw, rMax, hw);
    const { center: z, half: rz } = fit((rnd() * 2 - 1) * hh, rMax, hh);
    const r = Math.min(rx, rz);
    const blobs = [];
    for (let l = 0; l < layers; l++) {
      const br = Math.max(0.18, r * (0.55 + rnd() * 0.4) * (1 - l * 0.12));
      // small horizontal jitter (re-clamped against the footprint) + a random spin so every
      // blob's low-poly silhouette reads differently instead of stacking into one flat hexagon.
      const jx = fit(x + (rnd() * 2 - 1) * r * 0.45, br, hw);
      const jz = fit(z + (rnd() * 2 - 1) * r * 0.45, br, hh);
      // layer 0 sits with its OWN bottom pinned just above the trunk top (bottom = trunkH +
      // 0.05, independent of br) so the true canopy underside clearance never depends on how
      // big the blob's radius rolled; higher layers stack up from there with partial overlap
      // for a fuller silhouette (their bottoms are necessarily even higher).
      const y = l === 0 ? trunkH + br + 0.05 : blobs[l - 1].y + blobs[l - 1].r * 0.5 + br * 0.35;
      blobs.push({
        x: jx.center, z: jz.center, y, r: br,
        rotY: rnd() * Math.PI * 2, rotX: (rnd() - 0.5) * 0.6,
        tone: Math.floor(rnd() * 3), // 0/1/2 -> lo/mid/hi
      });
    }
    trees.push({ x, z, trunkH, trunkR, r, blobs });
  }
  return { trees };
}

function woodMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const tones = [WOOD_PAL.canopyLo, WOOD_PAL.canopyMid, WOOD_PAL.canopyHi];
  const parts = [];
  let trueClearance = Infinity;
  for (const t of plan.trees) {
    const tg = new THREE.CylinderGeometry(t.trunkR * 0.7, t.trunkR, t.trunkH, 6);
    tg.translate(t.x, t.trunkH / 2, t.z);
    parts.push({ geometry: tg, colorHex: WOOD_PAL.trunk });
    for (const b of t.blobs) {
      const bg = new THREE.IcosahedronGeometry(b.r, 0);
      bg.rotateX(b.rotX); bg.rotateY(b.rotY);
      bg.translate(b.x, b.y, b.z);
      parts.push({ geometry: bg, colorHex: tones[b.tone] });
      trueClearance = Math.min(trueClearance, b.y - b.r);
    }
  }
  group.add(mergedMesh(ctx, parts));
  group.userData.terrainHeight = plan.trees.reduce((m, t) => Math.max(m, t.blobs.reduce((mm, b) => Math.max(mm, b.y + b.r), t.trunkH)), 0);
  group.userData.canopyClearance = trueClearance; // measured min(blob bottom) across every canopy blob, not a proxy
  group.userData.builtBy = 'wp3d-6-terrain2';
  return group;
}

function buildWood(ctx, kind, w, h, id) { return woodMesh(ctx, woodPlan(id, w, h)); }

/* =========================================================================================
 * CRATE — ribbed shipping containers, industrial rust/orange, 1-2 stacked.
 * ======================================================================================= */
const CRATE_PAL = { body: '#6b4a2c', rib: '#9a5a2e', accent: '#c97a3d', shadow: '#3c2a18' };

export function cratePlan(id, w, h) {
  const rnd = rngFor('crate', id);
  const hw = w / 2, hh = h / 2;
  const containers = [];
  const n = 1 + (rnd() < 0.4 ? 1 : 0); // 1-2 stacked
  let y = 0;
  for (let i = 0; i < n; i++) {
    const shrink = i === 0 ? 1 : 0.6 + rnd() * 0.25;
    const rawW = w * (0.7 + rnd() * 0.2) * shrink, rawD = h * (0.7 + rnd() * 0.2) * shrink;
    const { half: cw } = fit(0, rawW / 2, hw);
    const { half: cd } = fit(0, rawD / 2, hh);
    const offX = i === 0 ? 0 : (rnd() * 2 - 1) * Math.max(0, hw - cw);
    const offZ = i === 0 ? 0 : (rnd() * 2 - 1) * Math.max(0, hh - cd);
    const fx = fit(offX, cw, hw), fz = fit(offZ, cd, hh);
    const ch = 0.9 + rnd() * 0.6;
    const longIsX = cw >= cd;
    const nRibs = Math.max(2, Math.round((longIsX ? cw * 2 : cd * 2) / 0.4));
    containers.push({ x: fx.center, z: fz.center, w: cw * 2, d: cd * 2, h: ch, y, longIsX, nRibs });
    y += ch * 0.85;
  }
  return { containers };
}

function crateMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const parts = [];
  let maxTop = 0;
  for (const c of plan.containers) {
    // Built as N adjacent full-height slices tiling the LONG axis (no separate body box
    // underneath) — alternating body/rib color with a raised rib height reads as ribbed
    // corrugation with zero z-fighting risk, and the last slice doubles as the door-end
    // accent. A hidden overlapping box (the first draft) got fully swallowed by the solid
    // body and never rendered — slices avoid that by construction.
    const along = c.longIsX ? c.w : c.d, cross = c.longIsX ? c.d : c.w;
    const step = along / c.nRibs;
    for (let i = 0; i < c.nRibs; i++) {
      const t = -along / 2 + step * (i + 0.5);
      const isRib = i % 2 === 1;
      const isDoor = i === c.nRibs - 1;
      const sliceH = c.h * (isRib ? 1.0 : 0.94); // ribs stand a hair proud for a real ridge
      const sizeAlong = step * 0.88; // small gap between slices = corrugation groove shadow
      const sx = c.longIsX ? c.x + t : c.x;
      const sz = c.longIsX ? c.z : c.z + t;
      const bw = c.longIsX ? sizeAlong : cross;
      const bd = c.longIsX ? cross : sizeAlong;
      const g = new THREE.BoxGeometry(bw, sliceH, bd);
      g.translate(sx, c.y + sliceH / 2, sz);
      parts.push({ geometry: g, colorHex: isDoor ? CRATE_PAL.accent : (isRib ? CRATE_PAL.rib : CRATE_PAL.body) });
      maxTop = Math.max(maxTop, c.y + sliceH);
    }
  }
  group.add(mergedMesh(ctx, parts));
  group.userData.terrainHeight = maxTop;
  group.userData.builtBy = 'wp3d-6-terrain2';
  return group;
}

function buildCrate(ctx, kind, w, h, id) { return crateMesh(ctx, cratePlan(id, w, h)); }

/* =========================================================================================
 * CRATER — raised rim + recessed bowl with a flat center pad (so minis standing in it, which
 * render at elevation 0 like everywhere else, sit flush instead of floating) and a darker
 * blast-scorch center.
 * ======================================================================================= */
const CRATER_PAL = { rim: '#7d6c63', moat: '#3c3238', pad: '#120f12' }; // lit lip / dirt moat / near-black scorch center — pushed apart for a clear 3-ring read

export function craterPlan(id, w, h) {
  const rnd = rngFor('crater', id);
  const rBase = Math.min(w, h) / 2;
  const zScale = w > 0 ? h / w : 1;
  const padR = rBase * (0.32 + rnd() * 0.08);
  const rimR = rBase * (0.92 + rnd() * 0.05);
  const depth = 0.16 + rnd() * 0.12;
  const rimH = 0.22 + rnd() * 0.18;
  return { rBase, zScale, padR, rimR, depth, rimH };
}

function craterMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(plan.padR, plan.padR, 0.05, 16), new THREE.MeshBasicMaterial({ color: CRATER_PAL.pad }));
  pad.scale.set(1, 1, plan.zScale);
  pad.position.set(0, -0.02, 0);
  group.add(pad);

  const moat = new THREE.Mesh(new THREE.CylinderGeometry(plan.padR, plan.rimR * 0.95, plan.depth, 20), new THREE.MeshBasicMaterial({ color: CRATER_PAL.moat }));
  moat.scale.set(1, 1, plan.zScale);
  moat.position.set(0, -plan.depth / 2, 0);
  group.add(moat);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(plan.rimR, Math.max(0.05, plan.rimH * 0.4), 8, 24), new THREE.MeshBasicMaterial({ color: CRATER_PAL.rim }));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1, 1, plan.zScale);
  rim.position.set(0, plan.rimH * 0.3, 0);
  group.add(rim);

  group.userData.terrainHeight = plan.rimH;
  group.userData.builtBy = 'wp3d-6-terrain2';
  return group;
}

function buildCrater(ctx, kind, w, h, id) { return craterMesh(ctx, craterPlan(id, w, h)); }

/* ---------------------------------------------------------------------------------------
 * register() — called once by the wh40k-3d.js orchestrator before the first build.
 * ------------------------------------------------------------------------------------- */
export function register() {
  registerTerrainBuilder('ruin', buildRuin);
  registerTerrainBuilder('wall', buildWall);
  registerTerrainBuilder('wood', buildWood);
  registerTerrainBuilder('crate', buildCrate);
  registerTerrainBuilder('crater', buildCrater);
}
