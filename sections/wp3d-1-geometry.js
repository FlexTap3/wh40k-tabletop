/* ==== WP3D-1: geometry factories (voxel minis, terrain, board, scene sync) ==== */
/* Pure ES-module fragment per WP3D-CONTRACT.md. No cross-section imports; no top-level
 * side effects. The integrator concatenates this file into wh40k-3d.js and rewrites the
 * three.js import path below to be relative to the final file location. */
import * as THREE from '../vendor/three.module.min.js';

/* ---------------------------------------------------------------------------------------
 * World-space conventions (see contract): 1 world unit = 1 board inch, y up, board plane
 * at y=0. world.x = state x, world.z = state y. Token rot (deg, screen-CW, y-down) becomes
 * rotateY(-rot*PI/180). All local voxel-table space below is normalized: x/z span roughly
 * [-0.5,0.5] (footprint width/depth = 1 unit), y spans [0,1] (full archetype height = 1
 * unit). buildArchetypeGeometry scales x by real footprint width, z by real footprint
 * depth, y by a fixed per-archetype target height (inches) — footprint size never affects
 * height, only girth (this is what makes a Rhino "fill its hull footprint at ~2-3in tall"
 * regardless of how wide the hull is).
 * ------------------------------------------------------------------------------------- */

const mmIn = mm => mm / 25.4;

/* Per-archetype target height in inches (a 28mm infantry mini stands ~1.2in on its base). */
const ARCHETYPE_HEIGHTS = {
  skull: 1.2, shield: 1.2, helm: 1.3, steed: 1.4, wing: 1.3,
  claw: 1.8, tank: 2.6, titan: 7.0, fallback: 1.0,
};

/* Voxel box tables. Each box: {x,y,z, w,h,d, c} — x/y/z = box CENTER in normalized local
 * space, w/h/d = box full size (also normalized), c = 'hi'|'mid'|'lo' palette tint. Aimed
 * for a readable Minecraft-mini silhouette per archetype; hi = lit highlight (heads/crests),
 * mid = body mass, lo = grounded/shadowed mass (legs/boots/tracks) — the gradient fakes
 * lighting since the pool material is unlit (see createSceneSync). */
const WP3D_VOXELS = {
  // generic infantry trooper
  skull: [
    { x: -0.11, y: 0.15, z: 0, w: 0.14, h: 0.30, d: 0.14, c: 'lo' },   // left leg
    { x: 0.11, y: 0.15, z: 0, w: 0.14, h: 0.30, d: 0.14, c: 'lo' },    // right leg
    { x: 0, y: 0.34, z: 0, w: 0.40, h: 0.08, d: 0.24, c: 'lo' },       // belt
    { x: 0, y: 0.56, z: 0, w: 0.38, h: 0.32, d: 0.22, c: 'mid' },      // torso
    { x: 0, y: 0.56, z: -0.14, w: 0.20, h: 0.24, d: 0.10, c: 'mid' },  // backpack
    { x: -0.23, y: 0.70, z: 0, w: 0.13, h: 0.13, d: 0.19, c: 'mid' },  // left shoulder
    { x: 0.23, y: 0.70, z: 0, w: 0.13, h: 0.13, d: 0.19, c: 'mid' },   // right shoulder
    { x: 0, y: 0.86, z: 0, w: 0.19, h: 0.15, d: 0.19, c: 'hi' },       // head
    { x: 0.19, y: 0.60, z: 0.20, w: 0.05, h: 0.05, d: 0.38, c: 'hi' }, // rifle
  ],
  // battleline trooper: bulkier stance, chest plate + shield accent
  shield: [
    { x: -0.12, y: 0.15, z: 0, w: 0.16, h: 0.30, d: 0.16, c: 'lo' },
    { x: 0.12, y: 0.15, z: 0, w: 0.16, h: 0.30, d: 0.16, c: 'lo' },
    { x: 0, y: 0.34, z: 0, w: 0.44, h: 0.08, d: 0.26, c: 'lo' },
    { x: 0, y: 0.56, z: 0, w: 0.44, h: 0.32, d: 0.26, c: 'mid' },
    { x: 0, y: 0.56, z: -0.15, w: 0.20, h: 0.22, d: 0.10, c: 'mid' },
    { x: -0.25, y: 0.70, z: 0, w: 0.16, h: 0.15, d: 0.22, c: 'mid' },
    { x: 0.25, y: 0.70, z: 0, w: 0.16, h: 0.15, d: 0.22, c: 'mid' },
    { x: 0, y: 0.86, z: 0, w: 0.19, h: 0.15, d: 0.19, c: 'hi' },
    { x: 0, y: 0.60, z: 0.15, w: 0.20, h: 0.16, d: 0.04, c: 'hi' },    // chest plate icon
    { x: -0.32, y: 0.55, z: 0.05, w: 0.05, h: 0.36, d: 0.24, c: 'hi' }, // shield on left arm
  ],
  // character: cloak + banner accent
  helm: [
    { x: -0.11, y: 0.15, z: 0, w: 0.14, h: 0.30, d: 0.14, c: 'lo' },
    { x: 0.11, y: 0.15, z: 0, w: 0.14, h: 0.30, d: 0.14, c: 'lo' },
    { x: 0, y: 0.34, z: 0, w: 0.40, h: 0.08, d: 0.24, c: 'lo' },
    { x: 0, y: 0.56, z: 0, w: 0.38, h: 0.32, d: 0.22, c: 'mid' },
    { x: -0.23, y: 0.70, z: 0, w: 0.15, h: 0.16, d: 0.21, c: 'mid' },
    { x: 0.23, y: 0.70, z: 0, w: 0.15, h: 0.16, d: 0.21, c: 'mid' },
    { x: 0, y: 0.87, z: 0, w: 0.19, h: 0.16, d: 0.19, c: 'hi' },
    { x: 0, y: 0.98, z: -0.02, w: 0.05, h: 0.14, d: 0.22, c: 'hi' },   // crest/plume
    { x: 0, y: 0.45, z: -0.17, w: 0.30, h: 0.52, d: 0.10, c: 'lo' },   // cloak
    { x: -0.05, y: 1.12, z: -0.12, w: 0.03, h: 0.56, d: 0.03, c: 'mid' }, // banner pole
    { x: -0.05, y: 1.32, z: -0.12, w: 0.16, h: 0.18, d: 0.02, c: 'hi' }, // banner flag
  ],
  // bike/mounted: long low hull + rider
  steed: [
    { x: 0, y: 0.20, z: 0.05, w: 0.70, h: 0.20, d: 0.30, c: 'lo' },    // hull lower
    { x: 0, y: 0.36, z: 0.05, w: 0.50, h: 0.14, d: 0.22, c: 'mid' },   // hull mid
    { x: 0, y: 0.30, z: 0.35, w: 0.30, h: 0.24, d: 0.14, c: 'hi' },    // front fairing
    { x: -0.28, y: 0.16, z: -0.20, w: 0.08, h: 0.10, d: 0.20, c: 'lo' }, // exhaust L
    { x: 0.28, y: 0.16, z: -0.20, w: 0.08, h: 0.10, d: 0.20, c: 'lo' },  // exhaust R
    { x: 0, y: 0.60, z: -0.02, w: 0.30, h: 0.26, d: 0.20, c: 'mid' },  // rider torso
    { x: 0, y: 0.74, z: -0.02, w: 0.34, h: 0.10, d: 0.22, c: 'mid' },  // rider shoulders
    { x: 0, y: 0.86, z: 0.00, w: 0.17, h: 0.14, d: 0.17, c: 'hi' },    // rider head
    { x: 0, y: 0.42, z: 0.30, w: 0.44, h: 0.05, d: 0.05, c: 'hi' },    // handlebar
  ],
  // jump infantry / aircraft: delta silhouette
  wing: [
    { x: 0, y: 0.14, z: -0.20, w: 0.90, h: 0.10, d: 0.30, c: 'mid' },  // wing back
    { x: 0, y: 0.18, z: 0.05, w: 0.55, h: 0.12, d: 0.30, c: 'mid' },   // wing mid
    { x: 0, y: 0.22, z: 0.30, w: 0.16, h: 0.16, d: 0.30, c: 'hi' },    // fuselage
    { x: 0, y: 0.22, z: 0.48, w: 0.10, h: 0.10, d: 0.10, c: 'hi' },    // nose
    { x: 0, y: 0.32, z: 0.18, w: 0.12, h: 0.10, d: 0.14, c: 'hi' },    // cockpit
    { x: 0, y: 0.30, z: -0.32, w: 0.06, h: 0.24, d: 0.10, c: 'lo' },   // tail fin
    { x: -0.20, y: 0.14, z: -0.24, w: 0.10, h: 0.10, d: 0.20, c: 'lo' }, // engine L
    { x: 0.20, y: 0.14, z: -0.24, w: 0.10, h: 0.10, d: 0.20, c: 'lo' },  // engine R
  ],
  // monster: hunched, big arms
  claw: [
    { x: -0.16, y: 0.20, z: 0, w: 0.20, h: 0.40, d: 0.22, c: 'lo' },
    { x: 0.16, y: 0.20, z: 0, w: 0.20, h: 0.40, d: 0.22, c: 'lo' },
    { x: 0, y: 0.50, z: 0, w: 0.42, h: 0.24, d: 0.30, c: 'mid' },
    { x: 0, y: 0.78, z: 0.02, w: 0.50, h: 0.30, d: 0.34, c: 'hi' },
    { x: -0.34, y: 0.55, z: 0.05, w: 0.16, h: 0.46, d: 0.18, c: 'mid' }, // arm L
    { x: 0.34, y: 0.55, z: 0.05, w: 0.16, h: 0.46, d: 0.18, c: 'mid' },  // arm R
    { x: -0.36, y: 0.28, z: 0.10, w: 0.20, h: 0.18, d: 0.20, c: 'lo' },  // fist L
    { x: 0.36, y: 0.28, z: 0.10, w: 0.20, h: 0.18, d: 0.20, c: 'lo' },   // fist R
    { x: 0, y: 0.96, z: 0.10, w: 0.22, h: 0.18, d: 0.20, c: 'hi' },      // head
    { x: 0, y: 0.90, z: -0.20, w: 0.10, h: 0.20, d: 0.14, c: 'lo' },     // spine spikes
  ],
  // hull + turret + tracks
  tank: [
    { x: -0.36, y: 0.10, z: 0, w: 0.14, h: 0.20, d: 0.80, c: 'lo' },   // track L
    { x: 0.36, y: 0.10, z: 0, w: 0.14, h: 0.20, d: 0.80, c: 'lo' },    // track R
    { x: 0, y: 0.16, z: 0, w: 0.66, h: 0.24, d: 0.78, c: 'mid' },      // hull lower
    { x: 0, y: 0.36, z: -0.05, w: 0.56, h: 0.16, d: 0.60, c: 'mid' },  // hull upper
    { x: 0, y: 0.30, z: 0.40, w: 0.50, h: 0.20, d: 0.10, c: 'hi' },    // front plate
    { x: 0, y: 0.50, z: -0.05, w: 0.36, h: 0.14, d: 0.36, c: 'mid' },  // turret base
    { x: 0, y: 0.60, z: -0.05, w: 0.28, h: 0.10, d: 0.28, c: 'hi' },   // turret top
    { x: 0.06, y: 0.68, z: -0.10, w: 0.08, h: 0.06, d: 0.08, c: 'hi' }, // hatch
    { x: 0, y: 0.55, z: 0.30, w: 0.06, h: 0.06, d: 0.55, c: 'hi' },    // barrel
  ],
  // tall walker: legs + carapace
  titan: [
    { x: -0.14, y: 0.10, z: 0, w: 0.10, h: 0.20, d: 0.10, c: 'lo' },   // leg L lower
    { x: 0.14, y: 0.10, z: 0, w: 0.10, h: 0.20, d: 0.10, c: 'lo' },    // leg R lower
    { x: -0.14, y: 0.02, z: 0.02, w: 0.14, h: 0.05, d: 0.18, c: 'lo' }, // foot L
    { x: 0.14, y: 0.02, z: 0.02, w: 0.14, h: 0.05, d: 0.18, c: 'lo' },  // foot R
    { x: -0.14, y: 0.32, z: 0, w: 0.12, h: 0.24, d: 0.12, c: 'mid' },  // leg L upper
    { x: 0.14, y: 0.32, z: 0, w: 0.12, h: 0.24, d: 0.12, c: 'mid' },   // leg R upper
    { x: 0, y: 0.48, z: 0, w: 0.34, h: 0.12, d: 0.24, c: 'mid' },      // hip
    { x: 0, y: 0.66, z: 0, w: 0.38, h: 0.24, d: 0.28, c: 'hi' },       // torso/carapace
    { x: -0.22, y: 0.74, z: 0, w: 0.14, h: 0.14, d: 0.22, c: 'mid' },  // shoulder L
    { x: 0.22, y: 0.74, z: 0, w: 0.14, h: 0.14, d: 0.22, c: 'mid' },   // shoulder R
    { x: 0, y: 0.86, z: 0.06, w: 0.14, h: 0.10, d: 0.14, c: 'hi' },    // head/cockpit
    { x: 0.30, y: 0.55, z: 0.10, w: 0.08, h: 0.35, d: 0.08, c: 'hi' }, // weapon arm
  ],
  // null fallback: simple rounded slab (unknown glyph)
  fallback: [
    { x: 0, y: 0.06, z: 0, w: 0.50, h: 0.12, d: 0.50, c: 'lo' },
    { x: 0, y: 0.16, z: 0, w: 0.36, h: 0.10, d: 0.36, c: 'mid' },
    { x: 0, y: 0.24, z: 0, w: 0.20, h: 0.08, d: 0.20, c: 'hi' },
  ],
};

/* ---------------------------------------------------------------------------------------
 * Hand-rolled geometry merge (no BufferGeometryUtils vendored). Each part is a fully
 * positioned/scaled THREE.BufferGeometry (already .translate()/.scale()d into local model
 * space) plus a flat {r,g,b} color baked to every vertex of that part. Source geometries
 * are disposed after their attribute arrays are copied.
 * ------------------------------------------------------------------------------------- */
function mergeGeometries(parts) {
  let vertCount = 0, idxCount = 0;
  for (const p of parts) { vertCount += p.geometry.attributes.position.count; idxCount += p.geometry.index.count; }
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(idxCount);
  let vOff = 0, iOff = 0;
  for (const p of parts) {
    const g = p.geometry;
    const pos = g.attributes.position.array, nor = g.attributes.normal.array, idx = g.index.array;
    positions.set(pos, vOff * 3);
    normals.set(nor, vOff * 3);
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) { colors[(vOff + i) * 3] = p.color.r; colors[(vOff + i) * 3 + 1] = p.color.g; colors[(vOff + i) * 3 + 2] = p.color.b; }
    for (let i = 0; i < idx.length; i++) indices[iOff + i] = idx[i] + vOff;
    vOff += n; iOff += idx.length;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/* footprint -> {w,d} real inches (x-width, z-depth) */
function footprintDims(footprint) {
  if (footprint && footprint.shape === 'c') {
    const d = mmIn(footprint.dmm || 32);
    return { w: d, d };
  }
  return { w: (footprint && footprint.wIn) || 1, d: (footprint && footprint.hIn) || 1 };
}

function footprintBucketKey(footprint) {
  if (footprint && footprint.shape === 'c') {
    const d = Math.round((footprint.dmm || 32) / 2) * 2; // bucket to nearest 2mm
    return 'c' + d;
  }
  const w = Math.round(((footprint && footprint.wIn) || 1) * 4) / 4;   // nearest 0.25in
  const h = Math.round(((footprint && footprint.hIn) || 1) * 4) / 4;
  return 'r' + w + 'x' + h + (footprint && footprint.oval ? 'o' : '');
}

function paletteKeyOf(palette) {
  return (palette.hi || '') + '|' + (palette.mid || '') + '|' + (palette.lo || '');
}

const BASE_SEGMENTS = 16;
const BASE_THICKNESS = 0.05;
const geometryCache = new Map();

/* buildArchetypeGeometry(archetype, footprint, palette) -> THREE.BufferGeometry
 * Scales WP3D_VOXELS[archetype] (or .fallback) to the real footprint + fixed archetype
 * height, bakes palette.hi/mid/lo as vertex colors, adds a thin base disc (circle/oval
 * footprints) or hull plate (rect footprints) tinted darker than lo. Cached by
 * (archetype|footprint-bucket|palette). */
function buildArchetypeGeometry(archetype, footprint, palette) {
  const key = archetype + '|' + footprintBucketKey(footprint) + '|' + paletteKeyOf(palette);
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const table = WP3D_VOXELS[archetype] || WP3D_VOXELS.fallback;
  const targetH = ARCHETYPE_HEIGHTS[archetype] || ARCHETYPE_HEIGHTS.fallback;
  const { w: realW, d: realD } = footprintDims(footprint);

  const hi = new THREE.Color(palette.hi || '#9aa0a8');
  const mid = new THREE.Color(palette.mid || '#6b7178');
  const lo = new THREE.Color(palette.lo || '#42464c');
  const colorFor = c => (c === 'hi' ? hi : c === 'lo' ? lo : mid);

  const parts = table.map(b => {
    const g = new THREE.BoxGeometry(b.w * realW, b.h * targetH, b.d * realD);
    g.translate(b.x * realW, b.y * targetH, b.z * realD);
    return { geometry: g, color: colorFor(b.c) };
  });

  const baseColor = { r: lo.r * 0.55, g: lo.g * 0.55, b: lo.b * 0.55 };
  let baseGeo;
  const isRound = footprint && (footprint.shape === 'c' || footprint.oval);
  if (isRound) {
    baseGeo = new THREE.CylinderGeometry(0.5, 0.5, BASE_THICKNESS, BASE_SEGMENTS);
    baseGeo.scale(realW, 1, realD);
  } else {
    baseGeo = new THREE.BoxGeometry(realW, BASE_THICKNESS, realD);
  }
  baseGeo.translate(0, BASE_THICKNESS / 2, 0);
  parts.push({ geometry: baseGeo, color: baseColor });

  const merged = mergeGeometries(parts);
  geometryCache.set(key, merged);
  return merged;
}

/* ---------------------------------------------------------------------------------------
 * Deterministic seeded RNG (mulberry32 over an FNV-1a hash of the terrain id) — mirrors
 * wh40k-tabletop.html's wp9Hash/wp9Rng so both peers derive identical terrain art from the
 * same terrain id without any network sync of the random state.
 * ------------------------------------------------------------------------------------- */
function wp3dHash(id) {
  let h = 2166136261; const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function wp3dRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function disposeObject3D(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); }
  });
}

/* ---- terrain builders (local space: origin = footprint center, unrotated) ---- */
function buildRuin(w, h, rnd) {
  const group = new THREE.Object3D();
  const height = 6 + rnd() * 3; // 6-9in shell
  const th = 0.22;
  const segLen = 1.15;
  const mat = new THREE.MeshBasicMaterial({ color: 0x5f6980 });
  const edges = [
    [-w / 2, -h / 2, w, 0], [w / 2, -h / 2, 0, h], [w / 2, h / 2, -w, 0], [-w / 2, h / 2, 0, -h],
  ];
  for (const [ex, ez, dx, dz] of edges) {
    const len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    let pos = 0;
    while (pos < len) {
      const seg = Math.min(segLen * (0.8 + rnd() * 0.6), len - pos);
      const roll = rnd();
      if (roll >= 0.15) { // 15% doorway gap; 20% window (short wall); else full wall
        const midPos = pos + seg / 2;
        const cx = ex + ux * midPos, cz = ez + uz * midPos;
        const segH = roll < 0.35 ? height * 0.55 : height;
        const boxW = Math.abs(ux) > 0.5 ? seg : th;
        const boxD = Math.abs(uz) > 0.5 ? seg : th;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(boxW, th), segH, Math.max(boxD, th)), mat);
        mesh.position.set(cx, segH / 2, cz);
        group.add(mesh);
      }
      pos += seg;
    }
  }
  group.userData.terrainHeight = height;
  return group;
}

function buildWood(w, h, rnd) {
  const group = new THREE.Object3D();
  const n = Math.max(3, Math.min(24, Math.round((w * h) / 6)));
  const trunkMat = new THREE.MeshBasicMaterial({ color: 0x4a3620 });
  const canopyMat = new THREE.MeshBasicMaterial({ color: 0x336b34 });
  let maxH = 0;
  for (let i = 0; i < n; i++) {
    const tx = (rnd() - 0.5) * Math.max(0, w - 0.6);
    const tz = (rnd() - 0.5) * Math.max(0, h - 0.6);
    const trunkH = 0.6 + rnd() * 0.5, canopyR = 0.5 + rnd() * 0.6, canopyH = canopyR * 1.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, trunkH, 6), trunkMat);
    trunk.position.set(tx, trunkH / 2, tz);
    group.add(trunk);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(canopyR, canopyH, 7), canopyMat);
    canopy.position.set(tx, trunkH + canopyH * 0.45, tz);
    group.add(canopy);
    maxH = Math.max(maxH, trunkH + canopyH * 0.9);
  }
  group.userData.terrainHeight = maxH;
  return group;
}

function buildCrate(w, h, rnd) {
  const group = new THREE.Object3D();
  const n = 2 + Math.floor(rnd() * 3); // 2-4 stacked boxes
  const mat = new THREE.MeshBasicMaterial({ color: 0x8a5a2e });
  const maxDim = Math.min(w, h);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const bw = Math.min(w, maxDim * (0.5 + rnd() * 0.4));
    const bd = Math.min(h, maxDim * (0.5 + rnd() * 0.4));
    const bh = 0.6 + rnd() * 0.5;
    const bx = (rnd() - 0.5) * Math.max(0, w - bw) * 0.6;
    const bz = (rnd() - 0.5) * Math.max(0, h - bd) * 0.6;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    mesh.position.set(bx, y + bh / 2, bz);
    group.add(mesh);
    y += bh * 0.82; // slight stacking overlap = beveled look
  }
  group.userData.terrainHeight = y;
  return group;
}

function buildWall(w, h) {
  const height = 1; // fixed 1in per contract
  const group = new THREE.Object3D();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, h), new THREE.MeshBasicMaterial({ color: 0x5f5028 }));
  mesh.position.set(0, height / 2, 0);
  group.add(mesh);
  group.userData.terrainHeight = height;
  return group;
}

function buildCrater(w, h) {
  const group = new THREE.Object3D();
  const depth = 0.25;
  const rBase = w / 2;
  const zScale = w > 0 ? h / w : 1;
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(rBase * 0.94, rBase * 0.7, depth, 20),
    new THREE.MeshBasicMaterial({ color: 0x2c262b })
  );
  floor.scale.set(1, 1, zScale);
  floor.position.set(0, -depth / 2, 0);
  group.add(floor);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(rBase * 0.94, Math.max(0.05, rBase * 0.08), 8, 24),
    new THREE.MeshBasicMaterial({ color: 0x5b4d54 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1, 1, zScale);
  rim.position.set(0, 0.02, 0);
  group.add(rim);
  group.userData.terrainHeight = 0; // recessed — no height above ground
  return group;
}

function buildGenericBlock(w, h) {
  const height = 0.5;
  const group = new THREE.Object3D();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, h), new THREE.MeshBasicMaterial({ color: 0x3a4250 }));
  mesh.position.set(0, height / 2, 0);
  group.add(mesh);
  group.userData.terrainHeight = height;
  return group;
}

/* buildTerrain(kind, w, h, id) -> THREE.Object3D, local space (origin = footprint center,
 * unrotated — caller positions/rotates the wrapper). `id` seeds deterministic art (wood
 * scatter, ruin wall-gap pattern) — the contract note "wood trees seeded by terrain id"
 * requires a 4th arg beyond the 3-arg signature literally shown; defaults to 0 so a 3-arg
 * call still works (deterministic, just not per-terrain-distinct). */
function buildTerrain(kind, w, h, id) {
  const rnd = wp3dRng(wp3dHash(id == null ? 0 : id));
  switch (kind) {
    case 'ruin': return buildRuin(w, h, rnd);
    case 'wood': return buildWood(w, h, rnd);
    case 'crate': return buildCrate(w, h, rnd);
    case 'wall': return buildWall(w, h, rnd);
    case 'crater': return buildCrater(w, h, rnd);
    default: return buildGenericBlock(w, h);
  }
}

/* buildBoard(w,h,matCanvas?) -> board plane mesh, spans world x∈[0,w], z∈[0,h]. */
function buildBoard(w, h, matCanvas) {
  const geo = new THREE.PlaneGeometry(w, h);
  geo.rotateX(Math.PI / 2);   // local (x,y,0) -> world (x,0,y): matches world.z = state.y
  geo.translate(w / 2, 0, h / 2);
  let material;
  if (matCanvas) {
    const tex = matCanvas.isTexture ? matCanvas : new THREE.CanvasTexture(matCanvas);
    if (THREE.RepeatWrapping) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
    material = new THREE.MeshBasicMaterial({ map: tex });
  } else {
    material = new THREE.MeshBasicMaterial({ color: 0x2b3026 });
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.isBoard = true;
  return mesh;
}

/* buildDZ(poly, cssColor) -> decal mesh at y≈0.01, fan-triangulated from poly points
 * (world x = p.x, world z = p.y — DZ polys are already in board/world coordinates). */
function buildDZ(poly, cssColor) {
  // The app's real DZ polys are [x,y] point ARRAYS (see draw()'s `px(p[0],p[1])`);
  // accept both that and the {x,y} object form the contract originally described.
  const norm = (p) => Array.isArray(p) ? { x: p[0], y: p[1] } : p;
  const pts = ((poly && poly.length >= 3) ? poly : [[0, 0], [0, 0], [0, 0]]).map(norm);
  const n = pts.length;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { positions[i * 3] = pts[i].x; positions[i * 3 + 1] = 0.01; positions[i * 3 + 2] = pts[i].y; }
  const idxCount = Math.max(0, (n - 2) * 3);
  const indices = new Uint32Array(idxCount);
  for (let i = 0; i < n - 2; i++) { indices[i * 3] = 0; indices[i * 3 + 1] = i + 1; indices[i * 3 + 2] = i + 2; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const material = new THREE.MeshBasicMaterial({
    color: cssColor || '#c0392b', transparent: true, opacity: 0.28,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.isDZ = true;
  return mesh;
}

/* buildObjectiveMarker() -> gold 40mm cylinder marker, base sits on y=0. */
function buildObjectiveMarker() {
  const r = mmIn(40) / 2;
  const geo = new THREE.CylinderGeometry(r, r, 0.12, 24);
  const material = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = 0.06;
  mesh.userData.isObjective = true;
  return mesh;
}

/* ---------------------------------------------------------------------------------------
 * createSceneSync(THREE, scene, bridge)
 * Design note (flagged for the integrator): the contract phrases pools as "per
 * (archetype,faction-palette)" — this implementation buckets pools by
 * (archetype, faction-palette, footprint-bucket) instead, reusing the exact bucketing
 * already required for buildArchetypeGeometry's cache (point 2 of the packet). Rationale:
 * a shared reference-footprint geometry stretched non-uniformly per instance would turn
 * rectangular hull-plate bases into ovals for every vehicle, and the contract explicitly
 * asks for correct hull plates on rect footprints. Draw-call count stays bounded (archetype
 * x faction x a handful of size buckets — still far fewer than one draw call per token) and
 * "grown on demand" / diff-by-id semantics are unaffected. Flagging as a deviation from the
 * literal wording, not from the intent.
 * ------------------------------------------------------------------------------------- */
const GROW_CHUNK = 32;

function createInstancedPool(THREE, geometry, material, withColor) {
  let capacity = GROW_CHUNK;
  let mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  if (withColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.userData.slotTokenId = [];
  return {
    get mesh() { return mesh; },
    get capacity() { return capacity; },
    ensureCapacity(minCount) {
      if (minCount <= capacity) return;
      const newCapacity = Math.max(minCount, capacity + GROW_CHUNK);
      const newMesh = new THREE.InstancedMesh(geometry, material, newCapacity);
      newMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (withColor) newMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(newCapacity * 3), 3);
      newMesh.userData.slotTokenId = mesh.userData.slotTokenId;
      const old = mesh;
      mesh = newMesh;
      if (old.parent) { old.parent.add(mesh); old.parent.remove(old); }
      capacity = newCapacity;
    },
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
    },
  };
}

const FALLBACK_PALETTE = { hi: '#9aa0a8', mid: '#6b7178', lo: '#42464c' };

function resolveArchetype(bridge, token) {
  try { return (bridge.wpvGlyphFor ? bridge.wpvGlyphFor(token.kw) : null) || 'fallback'; }
  catch (e) { return 'fallback'; }
}
function resolvePalette(bridge, token) {
  try {
    const fid = bridge.wpvSideFid ? bridge.wpvSideFid(token.owner) : null;
    const p = fid && bridge.WPV_FACTIONS ? bridge.WPV_FACTIONS[fid] : null;
    return { key: fid || 'grey', palette: p || FALLBACK_PALETTE };
  } catch (e) { return { key: 'grey', palette: FALLBACK_PALETTE }; }
}
function footprintOf(token) {
  return token.shape === 'c'
    ? { shape: 'c', dmm: token.dmm }
    : { shape: 'r', wIn: token.wIn, hIn: token.hIn, oval: !!token.oval };
}
function footprintHalfExtents(footprint) {
  const { w, d } = footprintDims(footprint);
  return { hx: w / 2, hz: d / 2 };
}
function pointInRotatedRect(px, pz, cx, cz, w, h, rotDeg) {
  const rad = (rotDeg || 0) * Math.PI / 180;
  const dx = px - cx, dz = pz - cz;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  return Math.abs(lx) <= w / 2 && Math.abs(lz) <= h / 2;
}

function createSceneSync(THREE, scene, bridge) {
  const archPools = new Map();   // poolKey -> InstancedPool
  const terrainById = new Map(); // id -> {obj, sig}
  const objectiveById = new Map(); // id -> {obj}
  const dzEntries = [null, null];
  let lastState = { tokens: [], terrain: [], objectives: [], dz: [] };

  const sharedMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });

  const ringGeo = new THREE.RingGeometry(0.72, 1.0, 24); ringGeo.rotateX(Math.PI / 2);
  const rimMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const rimPool = createInstancedPool(THREE, ringGeo, rimMaterial, true);
  scene.add(rimPool.mesh);

  const selGeo = new THREE.RingGeometry(0.82, 1.12, 24); selGeo.rotateX(Math.PI / 2);
  const selMaterial = new THREE.MeshBasicMaterial({ color: 0xe8c34a, side: THREE.DoubleSide });
  const selectionPool = createInstancedPool(THREE, selGeo, selMaterial, false);
  scene.add(selectionPool.mesh);

  const RED = new THREE.Color('#c03d3d'), BLUE = new THREE.Color('#3d7ec0');
  const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _euler = new THREE.Euler();
  const _scl = new THREE.Vector3(1, 1, 1), _mat4 = new THREE.Matrix4();

  function computeElevation(t, state) {
    if (!t.lvl) return 0;
    const terrain = state && state.terrain;
    if (!terrain) return 0;
    for (const g of terrain) {
      if (g.kind !== 'ruin') continue;
      const cx = g.x + g.w / 2, cz = g.y + g.h / 2;
      if (pointInRotatedRect(t.x, t.y, cx, cz, g.w, g.h, g.rot || 0)) return t.lvl * 3;
    }
    return 0;
  }

  function syncTerrain(list) {
    const seen = new Set();
    for (const t of list) {
      seen.add(t.id);
      let entry = terrainById.get(t.id);
      const sig = t.kind + '|' + t.w + '|' + t.h;
      if (!entry || entry.sig !== sig) {
        if (entry) { scene.remove(entry.obj); disposeObject3D(entry.obj); }
        const obj = buildTerrain(t.kind, t.w, t.h, t.id);
        scene.add(obj);
        entry = { obj, sig };
        terrainById.set(t.id, entry);
      }
      entry.obj.position.set(t.x + t.w / 2, 0, t.y + t.h / 2);
      entry.obj.rotation.y = -(t.rot || 0) * Math.PI / 180;
    }
    for (const [id, entry] of Array.from(terrainById)) {
      if (!seen.has(id)) { scene.remove(entry.obj); disposeObject3D(entry.obj); terrainById.delete(id); }
    }
  }

  function syncObjectives(list) {
    const seen = new Set();
    for (const o of list) {
      seen.add(o.id);
      let entry = objectiveById.get(o.id);
      if (!entry) {
        const obj = buildObjectiveMarker();
        scene.add(obj);
        entry = { obj };
        objectiveById.set(o.id, entry);
      }
      entry.obj.position.x = o.x;
      entry.obj.position.z = o.y;
    }
    for (const [id, entry] of Array.from(objectiveById)) {
      if (!seen.has(id)) { scene.remove(entry.obj); disposeObject3D(entry.obj); objectiveById.delete(id); }
    }
  }

  function syncDZ(dz) {
    const colors = ['#c0392b', '#2b6cc0'];
    for (let i = 0; i < 2; i++) {
      const poly = dz && dz[i];
      const sig = poly ? JSON.stringify(poly) : '';
      if (dzEntries[i] && dzEntries[i].sig === sig) continue;
      if (dzEntries[i]) { scene.remove(dzEntries[i].obj); disposeObject3D(dzEntries[i].obj); dzEntries[i] = null; }
      if (poly && poly.length >= 3) {
        const obj = buildDZ(poly, colors[i]);
        scene.add(obj);
        dzEntries[i] = { obj, sig };
      }
    }
  }

  function tick(state) {
    lastState = state || lastState;
    const tokens = (state && state.tokens) || [];
    const tokenById = new Map();
    for (const t of tokens) tokenById.set(t.id, t);

    // ---- group tokens into (archetype, palette, footprint-bucket) pools ----
    const groups = new Map();
    for (const t of tokens) {
      const archetype = resolveArchetype(bridge, t);
      const { key: fid, palette } = resolvePalette(bridge, t);
      const fp = footprintOf(t);
      const poolKey = archetype + '|' + fid + '|' + footprintBucketKey(fp);
      let g = groups.get(poolKey);
      if (!g) { g = { archetype, palette, footprint: fp, tokens: [] }; groups.set(poolKey, g); }
      g.tokens.push(t);
    }
    for (const poolKey of Array.from(archPools.keys())) {
      if (!groups.has(poolKey)) { archPools.get(poolKey).dispose(); archPools.delete(poolKey); }
    }
    for (const [poolKey, g] of groups) {
      let pool = archPools.get(poolKey);
      if (!pool) {
        const geometry = buildArchetypeGeometry(g.archetype, g.footprint, g.palette);
        pool = createInstancedPool(THREE, geometry, sharedMaterial, false);
        scene.add(pool.mesh);
        archPools.set(poolKey, pool);
      }
      pool.ensureCapacity(g.tokens.length);
      const mesh = pool.mesh;
      mesh.count = g.tokens.length;
      const slotTokenId = mesh.userData.slotTokenId;
      slotTokenId.length = g.tokens.length;
      for (let i = 0; i < g.tokens.length; i++) {
        const t = g.tokens[i];
        const el = computeElevation(t, state);
        _pos.set(t.x, el, t.y);
        _quat.setFromEuler(_euler.set(0, -(t.rot || 0) * Math.PI / 180, 0));
        _mat4.compose(_pos, _quat, _scl);
        mesh.setMatrixAt(i, _mat4);
        slotTokenId[i] = t.id;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    // ---- owner rim (all tokens) ----
    rimPool.ensureCapacity(tokens.length);
    rimPool.mesh.count = tokens.length;
    const rimSlotTokenId = rimPool.mesh.userData.slotTokenId;
    rimSlotTokenId.length = tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const el = computeElevation(t, state);
      const hx = footprintHalfExtents(footprintOf(t));
      _pos.set(t.x, el + 0.02, t.y);
      _quat.setFromEuler(_euler.set(0, -(t.rot || 0) * Math.PI / 180, 0));
      _scl.set(hx.hx + 0.06, 1, hx.hz + 0.06);
      _mat4.compose(_pos, _quat, _scl);
      rimPool.mesh.setMatrixAt(i, _mat4);
      rimPool.mesh.setColorAt(i, t.owner === 1 ? RED : BLUE);
      rimSlotTokenId[i] = t.id;
    }
    _scl.set(1, 1, 1);
    rimPool.mesh.instanceMatrix.needsUpdate = true;
    if (rimPool.mesh.instanceColor) rimPool.mesh.instanceColor.needsUpdate = true;

    // ---- selection rings ----
    const selIds = Array.from((bridge && bridge.sel) || []);
    selectionPool.ensureCapacity(selIds.length);
    let selCount = 0;
    for (let i = 0; i < selIds.length; i++) {
      const t = tokenById.get(selIds[i]);
      if (!t) continue;
      const el = computeElevation(t, state);
      const hx = footprintHalfExtents(footprintOf(t));
      _pos.set(t.x, el + 0.03, t.y);
      _quat.setFromEuler(_euler.set(0, -(t.rot || 0) * Math.PI / 180, 0));
      _scl.set(hx.hx + 0.12, 1, hx.hz + 0.12);
      _mat4.compose(_pos, _quat, _scl);
      selectionPool.mesh.setMatrixAt(selCount, _mat4);
      selCount++;
    }
    _scl.set(1, 1, 1);
    selectionPool.mesh.count = selCount;
    selectionPool.mesh.instanceMatrix.needsUpdate = true;

    syncTerrain((state && state.terrain) || []);
    syncObjectives((state && state.objectives) || []);
    syncDZ((state && state.dz) || []);
  }

  function pickMeshes() {
    return Array.from(archPools.values()).map(p => p.mesh);
  }
  function tokenAt(intersection) {
    if (!intersection || intersection.instanceId == null) return null;
    const mesh = intersection.object;
    const ids = mesh && mesh.userData && mesh.userData.slotTokenId;
    if (!ids) return null;
    const id = ids[intersection.instanceId];
    return id == null ? null : id;
  }
  function elevationFor(token) {
    return computeElevation(token, lastState);
  }
  function dispose() {
    for (const pool of archPools.values()) pool.dispose();
    archPools.clear();
    rimPool.dispose();
    selectionPool.dispose();
    for (const [, entry] of terrainById) { scene.remove(entry.obj); disposeObject3D(entry.obj); }
    terrainById.clear();
    for (const [, entry] of objectiveById) { scene.remove(entry.obj); disposeObject3D(entry.obj); }
    objectiveById.clear();
    for (let i = 0; i < 2; i++) { if (dzEntries[i]) { scene.remove(dzEntries[i].obj); disposeObject3D(dzEntries[i].obj); dzEntries[i] = null; } }
    sharedMaterial.dispose();
    rimMaterial.dispose(); ringGeo.dispose();
    selMaterial.dispose(); selGeo.dispose();
  }

  return { tick, pickMeshes, tokenAt, elevationFor, dispose };
}

export {
  WP3D_VOXELS,
  buildArchetypeGeometry,
  buildTerrain,
  buildBoard,
  buildDZ,
  buildObjectiveMarker,
  createSceneSync,
};
