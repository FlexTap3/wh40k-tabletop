/* ==== WP3D-6 v3: pre-painted GW terrain pack + building pairing ====
 * v2 gave every ruin/wall its own believable silhouette in isolation. Owner feedback on v2:
 * "the terrain STILL doesn't match what it should be for the selected missions — look to the
 * new pre-painted terrain GW is selling." Two structural changes this version makes:
 *
 * 1. PAIRING (the structural fix). Official GW layouts pair a kind:'ruin' AREA (the obscuring
 *    footprint) with adjacent kind:'wall' pieces (the real vertical scenery) — one building,
 *    two terrain entries. The WP3D-v3 seam (wp3d-1-geometry.js buildTerrain) hands every
 *    override ctx.piece (this piece's world entry {id,kind,x,y,w,h,rot}) and ctx.all (the
 *    whole terrain array, same tick), and syncTerrain's pairKey already makes the rebuild
 *    cache neighbor-aware (pad 0.6"). pairingFor() below is the one place that turns those
 *    two world-space arrays into a LOCAL-space verdict (touch pad 0.6, mirrors the seam's own
 *    touch test exactly) — every plan* function downstream is still a pure function of
 *    (id, w, h, pairing) so it stays independently testable without constructing geometry.
 *      - wall + adjacent ruin  -> that wall becomes the ruin's FAÇADE: a two-layer wall (clean
 *        bone-rockcrete face on the ruin-facing side, jagged broken-rubble layer on the
 *        outward side) standing exactly on its own footprint (which IS the shared edge).
 *      - ruin + adjacent wall(s) -> floor slabs bias toward the paired edge(s) instead of
 *        floating centered; two walls on perpendicular edges = an L-corner ruin, slabs nestle
 *        into the corner (the GW corner-ruin product look) and the stub-wall remnants that
 *        would normally mark that edge are suppressed (the real wall piece already stands
 *        there — no double geometry).
 *      - ruin with NO adjacent wall -> open rubble footprint (unchanged v2 look, re-palette).
 *      - wall with NO adjacent ruin -> electrified barricade run (low industrial segments,
 *        hazard-striped tops, small glow lamps — the sanctioned electric-kit borrow).
 *
 * 2. PRE-PAINTED IDENTITY (the visual fix). v2's palette was dark gothic stone. The GW
 *    pre-painted terrain range reads light rockcrete grey/bone with clean edges, black/yellow
 *    hazard-stripe accents on stair/floor/barricade edges, small warm glow-lamp dots, and an
 *    abstract aquila block on large ruins. See the *_PAL constants below.
 * ======================================================================================= */
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
 * PAIRING — pure functions of world-space {id,kind,x,y,w,h,rot} entries. No THREE required,
 * so tests can build synthetic ctx.all arrangements and assert routing without geometry.
 * ======================================================================================= */
const PAIR_PAD = 0.6; // MUST match syncTerrain's own pairKey touch pad (wp3d-1-geometry.js)

function touches(a, b, pad) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
           a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}

/* World offset from `from`'s center to `to`'s center, rotated INTO `from`'s local unrotated
 * frame — i.e. it undoes the caller's `rotation.y = -(from.rot)*PI/180` placement, so a
 * builder (which only ever sees its own local, unrotated space) can reason about "which side
 * is my neighbor on" in the same frame it's building geometry in. */
function localOffsetTo(from, to) {
  const ac = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const bc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = bc.x - ac.x, dz = bc.y - ac.y;
  const rad = ((from.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { lx: dx * cos + dz * sin, lz: -dx * sin + dz * cos };
}

// Compass label for a local offset — E/W along local x, N/S along local z (whichever axis
// dominates). Used both as a human-checkable test artifact and to derive geometry signs.
function sideOf(lx, lz) {
  if (Math.abs(lx) >= Math.abs(lz)) return lx >= 0 ? 'E' : 'W';
  return lz >= 0 ? 'S' : 'N';
}

/* pairingFor(piece, all) -> { ruins: [{id,w,h,lx,lz,dist,side}...], walls: [...] }
 * Neighbors of the OPPOSITE kind (walls look for ruins, ruins look for walls), touch-tested
 * at the same 0.6" pad the syncTerrain cache uses, sorted nearest-first. Exported so tests can
 * feed synthetic ctx.all arrangements straight through it. */
export function pairingFor(piece, all) {
  if (!piece || !all || !all.length) return { ruins: [], walls: [] };
  const nb = (kind) => all
    .filter(o => o && o !== piece && o.id !== piece.id && o.kind === kind && touches(piece, o, PAIR_PAD))
    .map(o => {
      const off = localOffsetTo(piece, o);
      return { id: o.id, w: o.w, h: o.h, lx: off.lx, lz: off.lz, dist: Math.hypot(off.lx, off.lz), side: sideOf(off.lx, off.lz) };
    })
    .sort((a, b) => a.dist - b.dist);
  return { ruins: nb('ruin'), walls: nb('wall') };
}

/* =========================================================================================
 * PALETTE — GW pre-painted product identity: light rockcrete grey/bone (not dark gothic
 * stone), clean edges, black/yellow hazard accents, warm small glow-lamp dots, dark-bronze
 * aquila accent block.
 * ======================================================================================= */
const HAZARD_YELLOW = '#e2b23c';
const HAZARD_BLACK = '#17150f';
const GLOW_LAMP = '#ffb15c';           // warm lamp glow — the one 'glow' tint this pack uses
const AQUILA_BRONZE = '#332720';

const RUIN_PAL = {
  plate: '#8f897a', debrisLo: '#a29c8b', debrisHi: '#c2bbaa',
  stub: '#a7a091', column: '#b5af9f', slab: '#c9c3b1',
};
const WALL_PAL = {
  // interior (ruin-facing) facade layer — clean bone/rockcrete, this is the "product" face
  facade: '#c9c3b2', facadeA: '#bdb7a4', facadeB: '#cbc5b3', facadeC: '#b3ad9b',
  // outward (away from the ruin) layer — broken rubble stone, darker, jagged
  rubble: '#726b5c',
};
const BARRICADE_PAL = { panel: '#43464c', panelAlt: '#393c41', post: '#2f3236' };
const CONTAINER_VARIANTS = [
  { body: '#5a6234', rib: '#454c28', accent: '#c9b23c' }, // olive Munitorum
  { body: '#8a6a34', rib: '#6e5326', accent: '#c9b23c' }, // ochre Munitorum
];
const GEN_PAL = { body: '#767b82', dark: '#4b4f55', cable: '#5a4530' };
const WOOD_PAL = { trunk: '#5a4428', canopyLo: '#5c6a34', canopyMid: '#7c7a3a', canopyHi: '#9c8a42' };
const CRATER_PAL = { rim: '#b3a68f', moat: '#6b5f52', pad: '#241f1c' }; // lighter dirt rim/moat, honest dark scorch (no ember glow — contract keeps this OFF)

// Exported read-only for tests/design review — the pre-painted "product identity" palette in
// one place, so a test can assert luminance/hue without walking merged mesh vertex colors.
export const PALETTE = {
  HAZARD_YELLOW, HAZARD_BLACK, GLOW_LAMP, AQUILA_BRONZE,
  RUIN_PAL, WALL_PAL, BARRICADE_PAL, CONTAINER_VARIANTS, GEN_PAL, WOOD_PAL, CRATER_PAL,
};

/* ---------------------------------------------------------------------------------------
 * Small shared decoration helpers — hazard stripes, glow-lamp dots, the aquila accent block.
 * All return {geometry,colorHex} parts (or arrays of them) suitable for mergedMesh().
 * ------------------------------------------------------------------------------------- */
function glowDotPart(THREE, x, y, z, r) {
  const g = new THREE.BoxGeometry(r * 2, r * 2, r * 2);
  g.translate(x, y, z);
  return { geometry: g, colorHex: GLOW_LAMP };
}

// Tiles alternating black/yellow boxes along an axis-aligned run — used for wall base trim,
// barricade tops, and ruin slab lip edges. `longAxisX`=true tiles along local x (cross = z).
function hazardStripeParts(THREE, longAxisX, alongCenter, alongLen, crossCenter, crossHalf, y0, y1) {
  const parts = [];
  const n = Math.max(3, Math.round(alongLen / 0.55));
  const step = alongLen / n;
  for (let i = 0; i < n; i++) {
    const t = alongCenter - alongLen / 2 + step * (i + 0.5);
    const cx = longAxisX ? t : crossCenter;
    const cz = longAxisX ? crossCenter : t;
    const bw = longAxisX ? step * 0.94 : crossHalf * 2;
    const bd = longAxisX ? crossHalf * 2 : step * 0.94;
    const g = new THREE.BoxGeometry(Math.max(0.02, bw), Math.max(0.01, y1 - y0), Math.max(0.02, bd));
    g.translate(cx, (y0 + y1) / 2, cz);
    parts.push({ geometry: g, colorHex: i % 2 === 0 ? HAZARD_YELLOW : HAZARD_BLACK });
  }
  return parts;
}

// Abstract aquila (double-headed eagle) block accent — central boss + two wing bars, flat on
// top of a slab/plate. Clamped through fit() so it can never poke past the footprint even on
// the smallest ruin that qualifies (>=8" on its long side).
function aquilaParts(THREE, hw, hh, rawCx, rawCz, y) {
  const fx = fit(rawCx, 1.05, hw), fz = fit(rawCz, 0.45, hh);
  const cx = fx.center, cz = fz.center;
  const parts = [];
  const body = new THREE.BoxGeometry(0.46, 0.06, 0.62);
  body.translate(cx, y, cz);
  parts.push({ geometry: body, colorHex: AQUILA_BRONZE });
  const wingW = Math.min(0.95, fx.half - 0.1), wingD = 0.24;
  for (const side of [-1, 1]) {
    const wg = new THREE.BoxGeometry(wingW, 0.05, wingD);
    wg.translate(cx + side * (0.23 + wingW / 2), y - 0.004, cz - 0.16);
    parts.push({ geometry: wg, colorHex: AQUILA_BRONZE });
  }
  return parts;
}

/* =========================================================================================
 * RUIN — the obscuring AREA. Low rubble plate (~0.15") + scattered debris + low crumbled
 * wall stubs (<=0.6", marks unpaired footprint edges) + 1-2 PARTIAL floor slabs whose TOP
 * faces sit at exactly y=3 and y=6 (elevationFor() in wp3d-1-geometry.js already stands
 * lvl-1/2 tokens at lvl*3 when inside a ruin footprint) on broken corner columns.
 *
 * PAIRING: pairing.walls (from pairingFor) tells this ruin which edge(s) have a real wall
 * piece standing on them. When present: (a) slab placement biases toward those edge(s) —
 * two perpendicular edges = an L-corner, slabs nestle into the corner; (b) crumbled stub
 * remnants are suppressed on paired edges (the real wall already stands there); (c) quadrant
 * survival is weighted toward the paired corner instead of a flat 72% each. No paired wall =
 * unchanged v2 open-rubble look (just re-paletted).
 * ======================================================================================= */
export function ruinPlan(id, w, h, pairing) {
  pairing = pairing || { walls: [] };
  const rnd = rngFor('ruin', id);
  const hw = w / 2, hh = h / 2;
  const plan = { w, h, basePlateH: 0.15, debris: [], stubs: [], corners: [], slabs: [] };

  // ---- resolve pairing bias: which edge(s) have a real wall standing on them ----
  const wallSides = new Set((pairing.walls || []).map(nw => nw.side));
  let biasX = 0, biasZ = 0;
  for (const side of wallSides) {
    if (side === 'E') biasX = 1; else if (side === 'W') biasX = -1;
    else if (side === 'S') biasZ = 1; else if (side === 'N') biasZ = -1;
  }
  const hasWall = wallSides.size > 0;
  const isCorner = biasX !== 0 && biasZ !== 0;
  plan.pairing = { hasWall, isCorner, wallSides: Array.from(wallSides) };

  // ---- 1-2 partial floor levels, tops pinned to exactly 3 and 6. Each level is up to 4
  // quadrant slabs (one per corner) so "which corners survive" breaks the FLOOR too, not
  // just its support columns — a clean intact rectangle read as a floating table, a notched
  // broken quadrant floor reads as a ruin. When paired, both the rectangle's offset AND the
  // quadrant survival odds bias toward the wall-adjacent edge(s) (the GW corner-ruin look:
  // slabs hug the façade, the open side stays rubble). ----
  const canFloor = w >= 1.6 && h >= 1.6;
  const haveL1 = canFloor && rnd() < 0.85;
  const haveL2 = haveL1 && rnd() < 0.55;
  const levels = [[3, haveL1], [6, haveL2]];
  for (const [topY, have] of levels) {
    if (!have) continue;
    const rawSw = w * (0.5 + rnd() * 0.25), rawSd = h * (0.5 + rnd() * 0.25);
    const { center: cx, half: hsw } = fit(0, rawSw / 2, hw - 0.2);
    const { center: cz, half: hsd } = fit(0, rawSd / 2, hh - 0.2);
    // re-roll an off-center placement now that the max half-size is known — biased toward the
    // paired edge(s) when this ruin has an adjacent wall (isCorner biases both axes at once).
    const maxOffX = Math.max(0, hw - hsw - 0.1), maxOffZ = Math.max(0, hh - hsd - 0.1);
    const ocx = hasWall && biasX !== 0 ? biasX * maxOffX * (0.7 + rnd() * 0.3) : (hasWall ? (rnd() * 2 - 1) * maxOffX * 0.4 : (rnd() * 2 - 1) * maxOffX);
    const ocz = hasWall && biasZ !== 0 ? biasZ * maxOffZ * (0.7 + rnd() * 0.3) : (hasWall ? (rnd() * 2 - 1) * maxOffZ * 0.4 : (rnd() * 2 - 1) * maxOffZ);
    const fx = fit(ocx, hsw, hw), fz = fit(ocz, hsd, hh);
    const sw = hsw * 2, sd = hsd * 2, thick = 0.28;
    // 4 corner slots, in a fixed order shared by the quadrant slab AND its support column
    // so a surviving corner always keeps both its floor piece and its post.
    const slots = [
      { sx: -1, sz: -1 }, { sx: 1, sz: -1 }, { sx: -1, sz: 1 }, { sx: 1, sz: 1 },
    ];
    let survive = slots.map(({ sx, sz }) => {
      let p = 0.72;
      if (biasX !== 0) p += sx === biasX ? 0.2 : -0.35;
      if (biasZ !== 0) p += sz === biasZ ? 0.2 : -0.35;
      return rnd() < Math.max(0.12, Math.min(0.95, p));
    });
    if (survive.filter(Boolean).length < 2) {
      if (hasWall) {
        const scored = slots.map((s, k) => ({ k, score: (biasX !== 0 ? (s.sx === biasX ? 1 : 0) : 0) + (biasZ !== 0 ? (s.sz === biasZ ? 1 : 0) : 0) }));
        scored.sort((a, b) => b.score - a.score);
        survive = slots.map(() => false);
        survive[scored[0].k] = true; survive[scored[1].k] = true;
      } else {
        survive = [true, true, false, false];
      }
    }
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

  // ---- low crumbled wall stubs marking UNPAIRED footprint edges only (<=0.6", interior
  // stays open) — a paired edge already has the real wall piece standing on it, a stub there
  // would double up the geometry. ----
  const edgeDefs = [
    { side: 'N', ex: -hw, ez: -hh, dx: w, dz: 0 },
    { side: 'E', ex: hw, ez: -hh, dx: 0, dz: h },
    { side: 'S', ex: hw, ez: hh, dx: -w, dz: 0 },
    { side: 'W', ex: -hw, ez: hh, dx: 0, dz: -h },
  ];
  const segLen = 1.3;
  for (const { side, ex, ez, dx, dz } of edgeDefs) {
    if (wallSides.has(side)) continue;
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
        plan.stubs.push({ cx: fx.center, cz: fz.center, w: fx.half * 2, d: fz.half * 2, h: hgt, side });
      }
      pos += seg;
    }
  }

  // ---- large-ruin (>=8" on the long side) abstract aquila block accent, centered on the
  // topmost surviving slab (or the base plate if this seed rolled no floors at all). ----
  plan.aquila = Math.max(w, h) >= 8;
  if (plan.aquila) {
    const topSlab = plan.slabs.length ? plan.slabs.reduce((a, s) => (s.topY > a.topY ? s : a), plan.slabs[0]) : null;
    plan.aquilaAt = topSlab ? { cx: topSlab.cx, cz: topSlab.cz, y: topSlab.topY } : { cx: 0, cz: 0, y: plan.basePlateH };
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
  if (plan.aquila && plan.aquilaAt) {
    for (const p of aquilaParts(THREE, plan.w / 2, plan.h / 2, plan.aquilaAt.cx, plan.aquilaAt.cz, plan.aquilaAt.y + 0.03)) parts.push(p);
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
    // hazard-striped lip along the slab's INNER edge (the edge facing the open interior, away
    // from its own support corner) — echoes the pre-painted range's stair/floor-edge striping.
    // dominant offset axis picks whether the inner edge runs along z (an x-side quadrant) or
    // along x (a z-side quadrant); the edge position is just inset from the slab's own outer
    // face so it always stays within the already-clamped slab bounds.
    const innerIsXSide = Math.abs(s.cx) >= Math.abs(s.cz);
    const edgeX = s.cx - Math.sign(s.cx || 1) * (s.w / 2 - 0.04);
    const edgeZ = s.cz - Math.sign(s.cz || 1) * (s.d / 2 - 0.04);
    const y0 = s.topY - 0.01, y1 = s.topY + 0.01;
    const stripe = innerIsXSide
      ? hazardStripeParts(THREE, false, s.cz, s.d, edgeX, 0.05, y0, y1)
      : hazardStripeParts(THREE, true, s.cx, s.w, edgeZ, 0.05, y0, y1);
    for (const p of stripe) group.add(new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial({ color: p.colorHex })));
  }
  if (!plan.slabs.length) for (const c of plan.corners) maxTop = Math.max(maxTop, c.topY);
  group.userData.terrainHeight = maxTop;
  group.userData.builtBy = 'wp3d-6-terrain2';
  group.userData.pairing = plan.pairing;
  return group;
}

function buildRuin(ctx, kind, w, h, id) {
  const pairing = pairingFor(ctx.piece, ctx.all);
  return ruinMesh(ctx, ruinPlan(id, w, h, { walls: pairing.walls }));
}

/* =========================================================================================
 * WALL — the REAL vertical scenery, routed on pairing:
 *   - adjacent ruin found -> FAÇADE mode: 4-6" broken building face. Two layers per column:
 *     an interior (ruin-facing) clean bone-rockcrete layer (this is the "product" face — the
 *     one carrying the windowed bays, the door gap, and the interior glow-lamp accents) and
 *     an outward jagged rubble layer (shorter, darker, irregular — the broken side facing
 *     away from the building). thickness = the piece's own thin footprint dimension.
 *   - no adjacent ruin -> BARRICADE mode: low (1.5-2.5") electrified industrial barricade
 *     segments, hazard-striped tops, small glow lamps — the sanctioned electric-kit borrow
 *     for free-standing walls.
 * ======================================================================================= */
function wallFacadePlan(id, w, h, ruin) {
  const rnd = rngFor('wall', id);
  const longIsX = w >= h;
  const length = Math.max(w, h), thickness = Math.min(w, h);
  const thicknessAxis = longIsX ? 'z' : 'x';
  const sign = thicknessAxis === 'z' ? Math.sign(ruin.lz || 1) : Math.sign(ruin.lx || 1);
  const facadeSide = thicknessAxis === 'z' ? (sign > 0 ? 'S' : 'N') : (sign > 0 ? 'E' : 'W');
  const nSeg = Math.max(3, Math.round(length / 1.1));
  const step = length / nSeg;
  const doorIdx = Math.floor(nSeg * (0.3 + rnd() * 0.4));
  const innerThick = thickness * 0.6, outerThick = thickness - innerThick;
  const cols = [];
  for (let i = 0; i < nSeg; i++) {
    const t = -length / 2 + step * (i + 0.5);
    const baseH = Math.min(6, Math.max(4, 4 + rnd() * 2 + (rnd() - 0.5) * 1.0));
    let type = 'pier';
    if (i === doorIdx || (nSeg > 5 && rnd() < 0.08)) type = 'gap';
    else if (rnd() < 0.55) type = 'bay';
    const outerH = type === 'gap' ? 0 : Math.max(1.3, baseH * (0.4 + rnd() * 0.35)); // jagged, always shorter than the inner face
    cols.push({ t, w: step * 0.92, h: baseH, outerH, type, lamp: type === 'bay' && rnd() < 0.5 });
  }
  if (cols.every(c => c.type === 'gap')) cols[0].type = 'pier'; // never a fully-empty facade
  return { mode: 'facade', length, thickness, innerThick, outerThick, longIsX, thicknessAxis, sign, facadeSide, cols };
}

function barricadePlan(id, w, h) {
  const rnd = rngFor('barricade', id);
  const longIsX = w >= h;
  const length = Math.max(w, h), thickness = Math.max(0.4, Math.min(w, h));
  const nSeg = Math.max(2, Math.round(length / 1.0));
  const step = length / nSeg;
  const segs = [];
  for (let i = 0; i < nSeg; i++) {
    const t = -length / 2 + step * (i + 0.5);
    const hRaw = 1.5 + rnd() * 1.0; // 1.5-2.5in industrial barricade band
    segs.push({ t, w: step * 0.88, h: Math.min(2.5, Math.max(1.5, hRaw)), lamp: rnd() < 0.4, alt: rnd() < 0.5 });
  }
  return { mode: 'barricade', length, thickness, longIsX, segs };
}

export function wallPlan(id, w, h, pairing) {
  pairing = pairing || { ruins: [], walls: [] };
  if (pairing.ruins && pairing.ruins.length) return wallFacadePlan(id, w, h, pairing.ruins[0]);
  return barricadePlan(id, w, h);
}

function wallFacadeMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const parts = [];
  let maxH = 4;
  const sign = plan.sign;
  for (const c of plan.cols) {
    if (c.type === 'gap') continue;
    maxH = Math.max(maxH, c.h);
    const innerOffset = sign * (plan.thickness / 2 - plan.innerThick / 2);
    const cxI = plan.longIsX ? c.t : innerOffset;
    const czI = plan.longIsX ? innerOffset : c.t;
    const bwI = plan.longIsX ? c.w : plan.innerThick;
    const bdI = plan.longIsX ? plan.innerThick : c.w;
    if (c.type === 'pier') {
      const g = new THREE.BoxGeometry(bwI, c.h, bdI);
      g.translate(cxI, c.h / 2, czI);
      parts.push({ geometry: g, colorHex: WALL_PAL.facade });
    } else {
      // bay: 3 stacked floor bands with 2 window-row gaps — the interior "product" face
      const gap = Math.min(0.4, c.h * 0.09);
      const floorH = (c.h - gap * 2) / 3;
      const floors = [WALL_PAL.facadeA, WALL_PAL.facadeB, WALL_PAL.facadeC];
      let y = 0;
      for (let f = 0; f < 3; f++) {
        const g = new THREE.BoxGeometry(bwI, floorH, bdI);
        g.translate(cxI, y + floorH / 2, czI);
        parts.push({ geometry: g, colorHex: floors[f] });
        y += floorH + gap;
      }
      if (c.lamp) {
        const lampY = c.h * 0.55;
        const lx = plan.longIsX ? cxI : cxI + sign * (plan.innerThick / 2 + 0.03);
        const lz = plan.longIsX ? czI + sign * (plan.innerThick / 2 + 0.03) : czI;
        parts.push(glowDotPart(THREE, lx, lampY, lz, 0.055));
      }
    }
    // outward broken-rubble layer — jagged, shorter, dark stone, faces away from the ruin
    if (c.outerH > 0) {
      const outerOffset = -sign * (plan.thickness / 2 - plan.outerThick / 2);
      const cxO = plan.longIsX ? c.t : outerOffset;
      const czO = plan.longIsX ? outerOffset : c.t;
      const bwO = plan.longIsX ? c.w * 0.9 : plan.outerThick;
      const bdO = plan.longIsX ? plan.outerThick : c.w * 0.9;
      const g = new THREE.BoxGeometry(bwO, c.outerH, bdO);
      g.translate(cxO, c.outerH / 2, czO);
      parts.push({ geometry: g, colorHex: WALL_PAL.rubble });
    }
  }
  // hazard-striped base trim along the clean interior face (stair/floor-edge accent)
  const innerOffset = sign * (plan.thickness / 2 - plan.innerThick / 2);
  const stripe = hazardStripeParts(THREE, plan.longIsX, 0, plan.length, innerOffset, plan.innerThick / 2 * 0.85, 0, 0.14);
  for (const p of stripe) parts.push(p);

  group.add(mergedMesh(ctx, parts));
  group.userData.terrainHeight = Math.min(6, Math.max(4, maxH));
  group.userData.builtBy = 'wp3d-6-terrain2';
  group.userData.facadeSide = plan.facadeSide;
  return group;
}

function barricadeMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const parts = [];
  let maxH = 1.5;
  for (const s of plan.segs) {
    maxH = Math.max(maxH, s.h);
    const cx = plan.longIsX ? s.t : 0, cz = plan.longIsX ? 0 : s.t;
    const bw = plan.longIsX ? s.w : plan.thickness, bd = plan.longIsX ? plan.thickness : s.w;
    const capH = 0.12;
    const bodyH = Math.max(0.2, s.h - capH);
    const g = new THREE.BoxGeometry(bw * 0.92, bodyH, bd * 0.92);
    g.translate(cx, bodyH / 2, cz);
    parts.push({ geometry: g, colorHex: s.alt ? BARRICADE_PAL.panelAlt : BARRICADE_PAL.panel });
    // end posts anchor the panel visually
    for (const side of [-1, 1]) {
      const pw = Math.min(bw * 0.14, 0.18);
      const pg = new THREE.BoxGeometry(plan.longIsX ? pw : bd * 0.95, bodyH + 0.05, plan.longIsX ? bd * 0.95 : pw);
      const pcx = plan.longIsX ? cx + side * (bw / 2 - pw / 2) : cx;
      const pcz = plan.longIsX ? cz : cz + side * (bd / 2 - pw / 2);
      pg.translate(pcx, (bodyH + 0.05) / 2, pcz);
      parts.push({ geometry: pg, colorHex: BARRICADE_PAL.post });
    }
    // hazard-striped top cap
    const capStripe = hazardStripeParts(THREE, plan.longIsX, plan.longIsX ? cx : cz, s.w * 0.9, plan.longIsX ? cz : cx, (plan.longIsX ? bd : bw) / 2 * 0.9, bodyH, bodyH + capH);
    for (const p of capStripe) parts.push(p);
    if (s.lamp) parts.push(glowDotPart(THREE, cx, bodyH * 0.6, cz, 0.055));
  }
  group.add(mergedMesh(ctx, parts));
  group.userData.terrainHeight = Math.min(2.5, Math.max(1.5, maxH));
  group.userData.builtBy = 'wp3d-6-terrain2';
  group.userData.barricade = true;
  return group;
}

function wallMesh(ctx, plan) {
  return plan.mode === 'barricade' ? barricadeMesh(ctx, plan) : wallFacadeMesh(ctx, plan);
}

function buildWall(ctx, kind, w, h, id) {
  const pairing = pairingFor(ctx.piece, ctx.all);
  return wallMesh(ctx, wallPlan(id, w, h, pairing));
}

/* =========================================================================================
 * WOOD — trunks + layered canopy. Canopy underside must sit >=2.2" up so minis are visible
 * beneath at shallow camera angles: trunks are grown tall enough (2.3-3.6") that the lowest
 * canopy layer never dips below that, regardless of RNG. Tone harmonized to sit next to the
 * lighter pre-painted buildings without changing the structure.
 * ======================================================================================= */
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
 * CRATE — Munitorum-style ribbed shipping containers (olive/ochre variants, seeded by id).
 * Every ~3rd crate piece (deterministic hash of id, NOT rng-consumed so it never perturbs the
 * container variant's own roll sequence) is instead a GENERATOR: cylindrical body, vent
 * stacks, cable spool, small glow-lamp dots.
 * ======================================================================================= */
function generatorPlan(id, w, h) {
  const rnd = rngFor('generator', id);
  const hw = w / 2, hh = h / 2;
  const bodyRRaw = Math.min(hw, hh) * (0.55 + rnd() * 0.15);
  const bf = fit(0, bodyRRaw, Math.min(hw, hh));
  const bodyR = bf.half;
  const cx = 0, cz = 0;
  const bodyH = 1.1 + rnd() * 0.6;
  // vent stacks are ROOF-MOUNTED (base sits at y=bodyH, on top of the body's flat top disc,
  // within the top radius) — NOT ground-based cylinders inside the body's own footprint,
  // which would sit fully swallowed inside the solid body and never render (the same "hidden
  // overlapping box" pitfall the crate ribs comment flags elsewhere in this file).
  const nVents = 2 + Math.floor(rnd() * 2);
  const vents = [];
  for (let i = 0; i < nVents; i++) {
    const ang = (i / nVents) * Math.PI * 2 + rnd() * 0.5;
    const vr = Math.max(0.06, bodyR * 0.18);
    const reach = Math.max(0, bodyR - vr - 0.03); // stays on the roof, inside the top rim
    const vfx = fit(cx + Math.cos(ang) * reach, vr, hw);
    const vfz = fit(cz + Math.sin(ang) * reach, vr, hh);
    vents.push({ x: vfx.center, z: vfz.center, r: vr, ventH: bodyH * (0.25 + rnd() * 0.35) });
  }
  const spoolR = Math.min(0.26, Math.max(hw, hh) * 0.12);
  const spx = fit(cx - bodyR * 1.05, spoolR, hw), spz = fit(cz + bodyR * 0.35, spoolR, hh);
  const spool = { x: spx.center, z: spz.center, r: spx.half, len: 0.4 };
  const lampCount = 1 + (rnd() < 0.5 ? 1 : 0);
  return { mode: 'generator', bodyR, bodyH, cx, cz, vents, spool, lampCount };
}

export function cratePlan(id, w, h) {
  // deterministic ~1-in-3 generator roll, kept OUT of rngFor('crate',...) so it never shifts
  // the container plan's own rnd() sequence when the variant lands on 'container'.
  const isGenerator = (wp3dHash('crate-variant:' + id) % 3) === 0;
  if (isGenerator) return generatorPlan(id, w, h);

  const rnd = rngFor('crate', id);
  const paletteIdx = wp3dHash('crate-tone:' + id) % CONTAINER_VARIANTS.length;
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
  return { mode: 'container', paletteIdx, containers };
}

function containerMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const pal = CONTAINER_VARIANTS[plan.paletteIdx] || CONTAINER_VARIANTS[0];
  const parts = [];
  let maxTop = 0;
  for (const c of plan.containers) {
    // ONE solid body box carries the silhouette (reads as a proper crate from ANY camera
    // angle — the v2-era design tiled N full-depth slices across the whole footprint instead,
    // which read fine face-on but fanned into an unreadable "deck of cards" from a corner/
    // edge-on angle, since every "rib" was actually a full-depth slab, not a surface detail).
    // Thin PROUD ribs on the long front face + a stenciled accent end-cap supply the ribbed-
    // Munitorum texture as detail on top of that silhouette, not as the silhouette itself.
    const along = c.longIsX ? c.w : c.d, cross = c.longIsX ? c.d : c.w;
    const bodyW = c.longIsX ? along : cross, bodyD = c.longIsX ? cross : along;
    const bodyG = new THREE.BoxGeometry(bodyW, c.h, bodyD);
    bodyG.translate(c.x, c.y + c.h / 2, c.z);
    parts.push({ geometry: bodyG, colorHex: pal.body });
    maxTop = Math.max(maxTop, c.y + c.h);

    const nRibs = c.nRibs;
    const ribStep = along / nRibs;
    const ribProud = Math.min(0.045, cross * 0.05); // stands just proud of the front face
    const frontOff = cross / 2 + ribProud / 2 - 0.002; // tiny overlap into the body, no seam gap
    for (let i = 0; i < nRibs; i++) {
      const t = -along / 2 + ribStep * (i + 0.5);
      const rw = ribStep * 0.55;
      const rg = new THREE.BoxGeometry(c.longIsX ? rw : ribProud, c.h * 0.92, c.longIsX ? ribProud : rw);
      const rx = c.longIsX ? c.x + t : c.x + frontOff;
      const rz = c.longIsX ? c.z + frontOff : c.z + t;
      rg.translate(rx, c.y + c.h * 0.5, rz);
      parts.push({ geometry: rg, colorHex: pal.rib });
    }
    // stenciled accent end-cap (reads as a door/hazard tag block, GW pre-painted decal style).
    // Nudged a hair proud of the body's end face (same trick as the ribs above) so the two
    // coplanar faces don't z-fight — a dead-flush box-on-box seam flickers under AA/lighting.
    const capW = Math.min(along * 0.16, 0.45);
    const capProud = 0.006;
    const capG = new THREE.BoxGeometry(c.longIsX ? capW : bodyW * 0.7, c.h * 0.35, c.longIsX ? bodyD * 0.7 : capW);
    const capX = c.longIsX ? c.x + along / 2 - capW / 2 + capProud : c.x;
    const capZ = c.longIsX ? c.z : c.z + along / 2 - capW / 2 + capProud;
    capG.translate(capX, c.y + c.h * 0.72, capZ);
    parts.push({ geometry: capG, colorHex: pal.accent });
  }
  group.add(mergedMesh(ctx, parts));
  group.userData.terrainHeight = maxTop;
  group.userData.builtBy = 'wp3d-6-terrain2';
  group.userData.crateVariant = 'container';
  return group;
}

function generatorMesh(ctx, plan) {
  const { THREE } = ctx;
  const group = new THREE.Object3D();
  const parts = [];
  const bodyG = new THREE.CylinderGeometry(plan.bodyR, plan.bodyR * 1.04, plan.bodyH, 12);
  bodyG.translate(plan.cx, plan.bodyH / 2, plan.cz);
  parts.push({ geometry: bodyG, colorHex: GEN_PAL.body });
  const bandG = new THREE.CylinderGeometry(plan.bodyR * 1.06, plan.bodyR * 1.06, plan.bodyH * 0.14, 12);
  bandG.translate(plan.cx, plan.bodyH * 0.62, plan.cz);
  parts.push({ geometry: bandG, colorHex: GEN_PAL.dark });
  let maxTop = plan.bodyH;
  // vent stacks stand ON TOP of the body's roof (base at bodyH), never embedded inside the
  // solid body — a vent whose whole y-span sits below bodyH would be entirely swallowed by
  // the body cylinder and never actually render.
  for (const v of plan.vents) {
    const vg = new THREE.CylinderGeometry(v.r, v.r * 1.1, v.ventH, 8);
    vg.translate(v.x, plan.bodyH + v.ventH / 2, v.z);
    parts.push({ geometry: vg, colorHex: GEN_PAL.dark });
    maxTop = Math.max(maxTop, plan.bodyH + v.ventH);
  }
  // cable spool: a cylinder lying on its side, resting flush on the ground beside the body
  const spoolG = new THREE.CylinderGeometry(plan.spool.r, plan.spool.r, plan.spool.len, 10);
  spoolG.rotateX(Math.PI / 2);
  spoolG.translate(plan.spool.x, plan.spool.r, plan.spool.z);
  parts.push({ geometry: spoolG, colorHex: GEN_PAL.cable });
  maxTop = Math.max(maxTop, plan.spool.r * 2);
  group.add(mergedMesh(ctx, parts));
  // glow-lamp dots sit proud on the roof rim, between the vents — small emissive-tint accents
  const lampY = plan.bodyH + 0.03;
  for (let i = 0; i < plan.lampCount; i++) {
    const ang = (i / Math.max(1, plan.lampCount)) * Math.PI * 2 + 0.6;
    const lx = plan.cx + Math.cos(ang) * plan.bodyR * 0.65, lz = plan.cz + Math.sin(ang) * plan.bodyR * 0.65;
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), new THREE.MeshBasicMaterial({ color: GLOW_LAMP }));
    dot.position.set(lx, lampY, lz);
    group.add(dot);
  }
  group.userData.terrainHeight = maxTop;
  group.userData.builtBy = 'wp3d-6-terrain2';
  group.userData.crateVariant = 'generator';
  return group;
}

function crateMesh(ctx, plan) {
  return plan.mode === 'generator' ? generatorMesh(ctx, plan) : containerMesh(ctx, plan);
}

function buildCrate(ctx, kind, w, h, id) { return crateMesh(ctx, cratePlan(id, w, h)); }

/* =========================================================================================
 * CRATER — raised rim + recessed bowl with a flat center pad (so minis standing in it, which
 * render at elevation 0 like everywhere else, sit flush instead of floating). Lighter dirt
 * tones for the rim/moat; the blast-scorch center stays honestly dark (no ember glow — the
 * contract explicitly keeps that OFF, this is a crater not a special effect).
 * ======================================================================================= */
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
