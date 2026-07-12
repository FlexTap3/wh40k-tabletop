/* ==== WP3D-7: troop kit pack ==== Keyword/stat-driven infantry, character, bike and swarm
 * voxel kits with faction body language and pose variants. Registered via register().
 * Owner feedback being fixed: every infantry model previously rendered as one generic
 * archetype ("skull"/"shield"/"helm") regardless of unit. This pack routes tokens to one of
 * eleven recognizable sub-kits by keyword/base-size/faction/name, each with 3 subtle pose
 * variants (+ a sergeant/leader accessory) so squads read as squads, not clone stamps. */
import { registerMiniKit, wp3dHash } from './wp3d-1-geometry.js';

/* ---------------------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------------------- */
const UP = s => String(s || '').toUpperCase();
function kwSet(token) { return (token.kw || []).map(UP); }
function hasKw(token, word) { return kwSet(token).indexOf(word) >= 0; }
function nameOf(token) { return String(token.name || ''); }
function factionOf(bridge, token) {
  try { return (bridge && bridge.wpvSideFid) ? bridge.wpvSideFid(token.owner) : null; }
  catch (e) { return null; }
}
/* pose bucket: deterministic per token id, 3 subtle variants (weapon angle / stance shift).
 * key() uses this same formula (contract: key(t) = `${subarch}|p${hash(t.id)%3}|${sgt}`) so
 * pooling and geometry always agree on which pose a given token gets. */
function poseOf(token) { return wp3dHash(token.id) % 3; }
/* variant key builder — `extra` lets a kit fold in a token-derived (not faction-derived; the
 * faction id is already a separate poolKey component in WP3D-1's createSceneSync) tag when
 * build() reads something key() must also encode (e.g. tyranid name-tier), per contract:
 * "key() MUST encode every token property build() reads". */
function variantKey(subarch, token, extra) {
  return subarch + (extra ? '-' + extra : '') + '|p' + poseOf(token) + '|' + (token.sgt ? 's' : '');
}

/* Subtle per-pose deltas: weapon-arm swing (armX/armZ), forward/back leg stagger (legF),
 * head turn (headX). Small enough to stay "the same trooper, different instant," not a
 * different mini — matches the contract's "subtle poses" ask. */
const POSE = [
  { armX: 0.000, armZ: 0.000, legF: 0.020, headX: 0.000 },
  { armX: 0.030, armZ: 0.020, legF: -0.020, headX: 0.015 },
  { armX: -0.030, armZ: -0.015, legF: 0.000, headX: -0.015 },
];

/* Sergeant/leader tell: crest + banner pole/flag bolted on above the head, same read as the
 * built-in "helm" character archetype used before this pack existed. y0 = head-top y. */
function sgtCrest(table, y0) {
  table.push(
    { x: 0, y: y0 + 0.09, z: -0.02, w: 0.05, h: 0.09, d: 0.18, c: 'hi' },
    { x: -0.06, y: y0 - 0.26, z: -0.14, w: 0.03, h: 0.40, d: 0.03, c: 'mid' },
    { x: -0.06, y: y0 - 0.02, z: -0.14, w: 0.14, h: 0.16, d: 0.02, c: 'hi' },
  );
}

const POWER_ARMOR_FIDS = new Set(['SM', 'CSM', 'TS', 'DG', 'GK', 'EC', 'WE', 'AC', 'AS']);

function tyranidTier(token) {
  const nm = nameOf(token).toLowerCase();
  if (/warrior/.test(nm)) return 'w';
  if (/genestealer/.test(nm)) return 'g';
  return 't';
}
const TYRANID_HEIGHT = { w: 1.8, g: 1.4, t: 1.3 };

/* ---------------------------------------------------------------------------------------
 * Routing predicates
 * ------------------------------------------------------------------------------------- */
function isSwarm(token) { return hasKw(token, 'SWARM') || /ripper|nurgling/i.test(nameOf(token)); }
function isDrone(token) { return /\bdrone\b/i.test(nameOf(token)); }
function isMounted(token) { return hasKw(token, 'MOUNTED'); }
function isHeavy(token) {
  const nm = nameOf(token);
  return /terminator|gravis/i.test(nm) || hasKw(token, 'TERMINATOR') || hasKw(token, 'GRAVIS') ||
    (hasKw(token, 'INFANTRY') && (+token.dmm || 0) >= 40);
}
function isTyranid(bridge, token) {
  return factionOf(bridge, token) === 'TYR' || /gaunt|genestealer/i.test(nameOf(token));
}
function isNecron(bridge, token) { return factionOf(bridge, token) === 'NEC'; }
function isTau(bridge, token) { return factionOf(bridge, token) === 'TAU'; }
function isEldar(bridge, token) {
  const fid = factionOf(bridge, token);
  return fid === 'AE' || fid === 'DRU';
}
function isMob(bridge, token) {
  return factionOf(bridge, token) === 'ORK' || /cultist/i.test(nameOf(token));
}
function isPowerArmor(bridge, token) { return POWER_ARMOR_FIDS.has(factionOf(bridge, token) || ''); }
function isLightInfantry(token) {
  const dmm = +token.dmm || 0, T = +token.T || 0;
  return token.shape === 'c' && dmm > 0 && dmm <= 25 && T > 0 && T <= 3;
}
function isTroopKw(token) {
  return hasKw(token, 'INFANTRY') || hasKw(token, 'CHARACTER') || hasKw(token, 'BATTLELINE') || hasKw(token, 'BEASTS');
}

/* ---------------------------------------------------------------------------------------
 * Kit builders — each returns a merged BufferGeometry via ctx.voxelsToGeometry(table,
 * footprint, palette, targetH, opts). Box coefficients are normalized fractions of the
 * real footprint (x/z) / target height (y), same convention as the WP3D-1 built-in tables.
 * ------------------------------------------------------------------------------------- */

// heavy infantry (Terminator/Gravis): squat, massive pauldrons, storm-bolter arm.
function buildHeavy(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.14, y: 0.13, z: 0, w: 0.20, h: 0.26, d: 0.20, c: 'lo' },
    { x: 0.14, y: 0.13, z: 0, w: 0.20, h: 0.26, d: 0.20, c: 'lo' },
    { x: 0, y: 0.30, z: 0, w: 0.52, h: 0.10, d: 0.32, c: 'lo' },
    { x: 0, y: 0.54, z: 0, w: 0.50, h: 0.32, d: 0.30, c: 'mid' },       // squat bulk torso
    { x: 0, y: 0.56, z: -0.18, w: 0.24, h: 0.28, d: 0.12, c: 'mid' },   // backpack
    { x: -0.32, y: 0.66, z: p.armZ, w: 0.26, h: 0.24, d: 0.30, c: 'hi' }, // massive pauldron L
    { x: 0.32, y: 0.66, z: p.armZ, w: 0.26, h: 0.24, d: 0.30, c: 'hi' },  // massive pauldron R
    { x: 0, y: 0.84, z: 0, w: 0.20, h: 0.14, d: 0.20, c: 'hi' },        // head (buried between pauldrons)
    { x: 0.34 + p.armX, y: 0.58, z: 0.20 + p.armZ, w: 0.14, h: 0.14, d: 0.30, c: 'lo' }, // storm-bolter forearm
    { x: 0.34 + p.armX, y: 0.60, z: 0.42 + p.armZ, w: 0.08, h: 0.08, d: 0.20, c: 'hi' }, // storm-bolter barrel
    { x: -0.30, y: 0.56, z: 0.10, w: 0.14, h: 0.30, d: 0.16, c: 'mid' }, // power fist L
  ];
  if (t.sgt) sgtCrest(table, 0.84);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.5, {});
}

// power-armor line infantry (SM-family): current trooper silhouette, refined.
function buildLine(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.11, y: 0.15, z: p.legF, w: 0.14, h: 0.30, d: 0.14, c: 'lo' },
    { x: 0.11, y: 0.15, z: -p.legF, w: 0.14, h: 0.30, d: 0.14, c: 'lo' },
    { x: 0, y: 0.34, z: 0, w: 0.42, h: 0.08, d: 0.25, c: 'lo' },
    { x: 0, y: 0.56, z: 0, w: 0.40, h: 0.32, d: 0.24, c: 'mid' },
    { x: 0, y: 0.56, z: -0.15, w: 0.20, h: 0.24, d: 0.10, c: 'mid' },   // backpack
    { x: -0.24, y: 0.70, z: 0, w: 0.14, h: 0.14, d: 0.20, c: 'mid' },
    { x: 0.24, y: 0.70, z: 0, w: 0.14, h: 0.14, d: 0.20, c: 'mid' },
    { x: 0, y: 0.60, z: 0.15, w: 0.16, h: 0.14, d: 0.03, c: 'hi' },     // chest icon
    { x: p.headX, y: 0.86, z: 0, w: 0.19, h: 0.15, d: 0.19, c: 'hi' },
    { x: p.armX, y: 0.60, z: 0.20 + p.armZ, w: 0.05, h: 0.05, d: 0.36, c: 'hi' }, // rifle
  ];
  if (t.sgt) sgtCrest(table, 0.94);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.3, {});
}

// light infantry / guard: slighter frame, helmet + lasgun, flak vest.
function buildLight(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.08, y: 0.16, z: p.legF, w: 0.10, h: 0.32, d: 0.10, c: 'lo' },
    { x: 0.08, y: 0.16, z: -p.legF, w: 0.10, h: 0.32, d: 0.10, c: 'lo' },
    { x: 0, y: 0.34, z: 0, w: 0.28, h: 0.06, d: 0.16, c: 'lo' },
    { x: 0, y: 0.54, z: 0, w: 0.26, h: 0.30, d: 0.16, c: 'mid' },       // slim torso
    { x: 0, y: 0.56, z: 0.10, w: 0.20, h: 0.24, d: 0.06, c: 'lo' },     // flak vest overlay
    { x: 0, y: 0.55, z: -0.10, w: 0.14, h: 0.18, d: 0.08, c: 'mid' },   // pack/canteen
    { x: -0.16, y: 0.66, z: 0, w: 0.09, h: 0.10, d: 0.14, c: 'mid' },
    { x: 0.16, y: 0.66, z: 0, w: 0.09, h: 0.10, d: 0.14, c: 'mid' },
    { x: p.headX, y: 0.80, z: 0, w: 0.15, h: 0.13, d: 0.15, c: 'hi' },  // helmet
    { x: p.armX, y: 0.56, z: 0.18 + p.armZ, w: 0.04, h: 0.04, d: 0.42, c: 'hi' }, // lasgun, long & thin
  ];
  if (t.sgt) sgtCrest(table, 0.86);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.2, {});
}

// cultist / ork boy: hunched, asymmetric, choppa arm; orks get bigger arms + a jaw.
function buildMob(ctx, t, footprint, palette) {
  const isOrk = factionOf(ctx.bridge, t) === 'ORK';
  const p = POSE[poseOf(t)];
  const s = isOrk ? 1.5 : 1.0;
  const table = [
    { x: -0.12, y: 0.14, z: 0.02, w: 0.16, h: 0.28, d: 0.16, c: 'lo' },
    { x: 0.10, y: 0.14, z: -0.02, w: 0.16, h: 0.28, d: 0.16, c: 'lo' }, // asymmetric stance
    { x: 0.02, y: 0.30, z: 0.02, w: 0.36, h: 0.08, d: 0.22, c: 'lo' },
    { x: 0.02, y: isOrk ? 0.52 : 0.48, z: 0.06, w: isOrk ? 0.46 : 0.36, h: isOrk ? 0.30 : 0.26, d: isOrk ? 0.32 : 0.24, c: 'mid' }, // hunched, forward+down
    { x: 0.30 * s + p.armX, y: 0.44, z: 0.10 + p.armZ, w: 0.14 * s, h: 0.34 * s, d: 0.16 * s, c: 'mid' }, // choppa arm
    { x: 0.34 * s + p.armX, y: 0.30, z: 0.24, w: 0.16 * s, h: 0.05, d: 0.20 * s, c: 'hi' },  // choppa blade
    { x: -0.18, y: 0.42, z: 0.06, w: 0.10, h: 0.22, d: 0.12, c: 'lo' }, // small off-hand arm
    { x: 0.02, y: isOrk ? 0.74 : 0.68, z: 0.10, w: isOrk ? 0.24 : 0.18, h: isOrk ? 0.20 : 0.15, d: isOrk ? 0.22 : 0.17, c: 'hi' }, // head, jutted forward
  ];
  if (isOrk) table.push({ x: 0.02, y: 0.64, z: 0.20, w: 0.14, h: 0.08, d: 0.10, c: 'hi' }); // jaw
  if (t.sgt) sgtCrest(table, isOrk ? 0.84 : 0.75);
  return ctx.voxelsToGeometry(table, footprint, palette, isOrk ? 1.35 : 1.15, {});
}

// Tyranid organism: hunched organic body language, scything talons, tail; carapace(hi)/flesh(mid).
function buildTyranid(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const tier = tyranidTier(t);
  const targetH = TYRANID_HEIGHT[tier];
  const table = [
    { x: -0.10, y: 0.14, z: 0.06, w: 0.12, h: 0.28, d: 0.12, c: 'lo', ry: 0.14 },   // digitigrade leg L
    { x: 0.10, y: 0.14, z: 0.06, w: 0.12, h: 0.28, d: 0.12, c: 'lo', ry: -0.14 },   // digitigrade leg R
    { x: 0, y: 0.30, z: 0.06, w: 0.30, h: 0.10, d: 0.22, c: 'lo' },                 // hip carapace
    { x: 0, y: 0.48, z: 0.10, w: 0.30, h: 0.26, d: 0.26, c: 'mid', ry: 0.10 },      // hunched torso — pushed forward+down
    { x: 0, y: 0.60, z: 0.16, w: 0.32, h: 0.16, d: 0.20, c: 'hi' },                 // carapace hump over the shoulders
    { x: -0.28, y: 0.52, z: 0.22, w: 0.11, h: 0.46, d: 0.11, c: 'hi', ry: 0.55 + p.armZ },  // scything talon L, swept forward
    { x: 0.28, y: 0.52, z: 0.22, w: 0.11, h: 0.46, d: 0.11, c: 'hi', ry: -0.55 - p.armZ },  // scything talon R, swept forward
    { x: 0, y: 0.70, z: 0.26, w: 0.16, h: 0.16, d: 0.20, c: 'mid' },                // head — thrust forward and low, predatory
    { x: 0, y: 0.36, z: -0.30, w: 0.09, h: 0.09, d: 0.34, c: 'lo', ry: 0.22 },      // tail, sweeping back
  ];
  return ctx.voxelsToGeometry(table, footprint, palette, targetH, {});
}

// Necron warrior: skeletal thin frame, glowing gauss rod.
function buildNecron(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.07, y: 0.16, z: 0, w: 0.08, h: 0.32, d: 0.08, c: 'lo' },
    { x: 0.07, y: 0.16, z: 0, w: 0.08, h: 0.32, d: 0.08, c: 'lo' },
    { x: 0, y: 0.34, z: 0, w: 0.26, h: 0.06, d: 0.14, c: 'lo' },
    { x: 0, y: 0.56, z: 0, w: 0.24, h: 0.30, d: 0.14, c: 'mid' },      // skeletal ribcage
    { x: -0.16, y: 0.68, z: 0, w: 0.08, h: 0.10, d: 0.12, c: 'mid' },
    { x: 0.16, y: 0.68, z: 0, w: 0.08, h: 0.10, d: 0.12, c: 'mid' },
    { x: p.headX, y: 0.84, z: 0, w: 0.15, h: 0.14, d: 0.15, c: 'hi' }, // skull head
    { x: p.armX, y: 0.55, z: 0.20 + p.armZ, w: 0.05, h: 0.05, d: 0.40, c: 'glow' }, // gauss rod
    { x: p.armX, y: 0.56, z: 0.40 + p.armZ, w: 0.07, h: 0.07, d: 0.07, c: 'glow' }, // muzzle glow
  ];
  if (t.sgt) sgtCrest(table, 0.92);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.3, { tints: { glow: '#57d0ff' } });
}

// T'au fire warrior: clean rounded armor, pulse rifle, comm antenna.
function buildTau(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.10, y: 0.15, z: 0, w: 0.13, h: 0.30, d: 0.13, c: 'lo' },
    { x: 0.10, y: 0.15, z: 0, w: 0.13, h: 0.30, d: 0.13, c: 'lo' },
    { x: 0, y: 0.34, z: 0, w: 0.34, h: 0.08, d: 0.22, c: 'lo' },
    { x: 0, y: 0.56, z: 0, w: 0.34, h: 0.28, d: 0.22, c: 'mid' },      // clean armor block
    { x: 0, y: 0.56, z: -0.14, w: 0.18, h: 0.20, d: 0.10, c: 'mid' },  // backpack
    { x: -0.20, y: 0.68, z: 0, w: 0.12, h: 0.12, d: 0.18, c: 'hi' },
    { x: 0.20, y: 0.68, z: 0, w: 0.12, h: 0.12, d: 0.18, c: 'hi' },
    { x: p.headX, y: 0.84, z: 0, w: 0.17, h: 0.14, d: 0.17, c: 'hi' }, // rounded helm
    { x: 0.02, y: 1.00, z: -0.08, w: 0.02, h: 0.16, d: 0.02, c: 'hi' },// comm antenna
    { x: p.armX, y: 0.58, z: 0.22 + p.armZ, w: 0.06, h: 0.06, d: 0.40, c: 'hi' },  // pulse rifle
  ];
  if (t.sgt) sgtCrest(table, 0.92);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.3, {});
}

// T'au drone: hovering disc on a strut.
function buildTauDrone(ctx, t, footprint, palette) {
  const table = [
    { x: 0, y: 0.55, z: 0, w: 0.55, h: 0.08, d: 0.45, c: 'mid' }, // disc body
    { x: 0, y: 0.60, z: 0, w: 0.20, h: 0.06, d: 0.20, c: 'hi' },  // dome sensor
    { x: 0, y: 0.255, z: 0, w: 0.04, h: 0.51, d: 0.04, c: 'lo' }, // hover strut to base (bottom sits at y=0)
  ];
  return ctx.voxelsToGeometry(table, footprint, palette, 1.0, {});
}

// Eldar / Drukhari: sleek tall slim, pointed helm.
function buildEldar(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.08, y: 0.17, z: p.legF, w: 0.10, h: 0.34, d: 0.10, c: 'lo' },
    { x: 0.08, y: 0.17, z: -p.legF, w: 0.10, h: 0.34, d: 0.10, c: 'lo' },
    { x: 0, y: 0.38, z: 0, w: 0.26, h: 0.06, d: 0.16, c: 'lo' },
    { x: 0, y: 0.62, z: 0, w: 0.26, h: 0.32, d: 0.16, c: 'mid' },      // sleek slim torso
    { x: -0.15, y: 0.76, z: 0, w: 0.09, h: 0.11, d: 0.14, c: 'mid' },
    { x: 0.15, y: 0.76, z: 0, w: 0.09, h: 0.11, d: 0.14, c: 'mid' },
    { x: p.headX, y: 0.92, z: 0, w: 0.14, h: 0.13, d: 0.14, c: 'hi' }, // head
    { x: 0, y: 1.02, z: 0, w: 0.05, h: 0.14, d: 0.05, c: 'hi' },       // pointed helm crest
    { x: p.armX, y: 0.62, z: 0.16 + p.armZ, w: 0.04, h: 0.04, d: 0.36, c: 'hi' }, // rifle/blade
  ];
  if (t.sgt) sgtCrest(table, 1.02);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.35, {});
}

// Bike / cavalry: mount (lo/mid) and rider (hi) kept visually distinct.
function buildBike(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: 0, y: 0.20, z: 0.05, w: 0.72, h: 0.20, d: 0.30, c: 'lo' },    // hull lower — the mount
    { x: 0, y: 0.36, z: 0.05, w: 0.50, h: 0.14, d: 0.22, c: 'mid' },   // hull mid
    { x: 0, y: 0.30, z: 0.36, w: 0.30, h: 0.24, d: 0.14, c: 'lo' },    // front fairing
    { x: -0.28, y: 0.16, z: -0.20, w: 0.08, h: 0.10, d: 0.20, c: 'lo' },
    { x: 0.28, y: 0.16, z: -0.20, w: 0.08, h: 0.10, d: 0.20, c: 'lo' },
    { x: 0, y: 0.42, z: 0.30, w: 0.44, h: 0.05, d: 0.05, c: 'lo' },    // handlebar
    { x: p.armX * 0.3, y: 0.60 + p.legF, z: -0.02, w: 0.30, h: 0.28, d: 0.20, c: 'hi' }, // rider torso — clearly the rider
    { x: 0, y: 0.78, z: -0.02, w: 0.34, h: 0.12, d: 0.22, c: 'hi' },   // rider shoulders
    { x: p.headX, y: 0.92, z: 0.02, w: 0.17, h: 0.15, d: 0.17, c: 'hi' }, // rider head
    { x: 0, y: 1.02, z: -0.05, w: 0.06, h: 0.10, d: 0.06, c: 'hi' },   // helmet crest
    { x: p.armX, y: 0.66, z: 0.20 + p.armZ, w: 0.05, h: 0.05, d: 0.20, c: 'hi' }, // hull-mounted bolter
  ];
  if (t.sgt) sgtCrest(table, 1.02);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.4, {});
}

// Swarm (ripper swarms / nurglings / SWARM kw): 4-6 small bodies scattered on the base.
// Seeded by the KIT VARIANT (pose bucket), never by the individual token id, so every token
// sharing a pool (same pose bucket) — the whole point of instancing — shares one scatter.
function buildSwarm(ctx, t, footprint, palette) {
  const pose = poseOf(t);
  const rnd = ctx.rng(ctx.hash('troop-swarm|p' + pose));
  const n = 4 + Math.floor(rnd() * 3); // 4-6 bodies
  const table = [];
  const BODY_H = 0.26, HEAD_H = 0.18; // fixed height budget (scatter/size vary horizontally
  // only) so every pool variant reaches a consistent height regardless of the rng draw —
  // these are tiny critters, but they still need to clear the footprint's y=0 plane and read
  // as bodies, not a pancake.
  for (let i = 0; i < n; i++) {
    const bx = (rnd() - 0.5) * 0.6;
    const bz = (rnd() - 0.5) * 0.6;
    const wScale = 0.8 + rnd() * 0.5;
    const bodyW = 0.20 * wScale, bodyD = 0.30 * wScale;
    const bodyY = BODY_H / 2 + 0.02;
    table.push({ x: bx, y: bodyY, z: bz, w: bodyW, h: BODY_H, d: bodyD, c: 'mid' }); // body
    const headY = bodyY + BODY_H * 0.5 + HEAD_H * 0.35;
    table.push({ x: bx + bodyD * 0.45, y: headY, z: bz, w: bodyW * 0.55, h: HEAD_H, d: bodyD * 0.45, c: 'hi' }); // head/mandibles
  }
  return ctx.voxelsToGeometry(table, footprint, palette, 0.55, {});
}

/* ---------------------------------------------------------------------------------------
 * Kit table — exported for tests/preview to introspect routing without reaching into the
 * private MINI_KITS registry inside wp3d-1-geometry.js. Order = match precedence: same
 * priority (10) kits are tried in registration order (Array#sort is stable), so this array
 * order IS the routing table (most specific first, generic infantry catch-all last).
 * ------------------------------------------------------------------------------------- */
export const TROOP_KITS = [
  { id: 'troop-swarm', priority: 10, match: (t) => isSwarm(t), key: (t) => variantKey('troop-swarm', t), build: buildSwarm },
  { id: 'troop-tau-drone', priority: 10, match: (t) => isDrone(t), key: (t) => t.sgt ? 'troop-tau-drone-s' : 'troop-tau-drone', build: buildTauDrone },
  { id: 'troop-bike', priority: 10, match: (t) => isMounted(t), key: (t) => variantKey('troop-bike', t), build: buildBike },
  { id: 'troop-heavy', priority: 10, match: (t) => isHeavy(t), key: (t) => variantKey('troop-heavy', t), build: buildHeavy },
  { id: 'troop-tyranid', priority: 10, match: (t, bridge) => isTyranid(bridge, t), key: (t) => variantKey('troop-tyranid', t, tyranidTier(t)), build: buildTyranid },
  { id: 'troop-necron', priority: 10, match: (t, bridge) => isNecron(bridge, t), key: (t) => variantKey('troop-necron', t), build: buildNecron },
  { id: 'troop-tau', priority: 10, match: (t, bridge) => isTau(bridge, t), key: (t) => variantKey('troop-tau', t), build: buildTau },
  { id: 'troop-eldar', priority: 10, match: (t, bridge) => isEldar(bridge, t), key: (t) => variantKey('troop-eldar', t), build: buildEldar },
  { id: 'troop-mob', priority: 10, match: (t, bridge) => isMob(bridge, t), key: (t) => variantKey('troop-mob', t), build: buildMob },
  { id: 'troop-line', priority: 10, match: (t, bridge) => isPowerArmor(bridge, t), key: (t) => variantKey('troop-line', t), build: buildLine },
  { id: 'troop-light', priority: 10, match: (t) => isLightInfantry(t), key: (t) => variantKey('troop-light', t), build: buildLight },
  // catch-all: any remaining INFANTRY/CHARACTER/BATTLELINE/BEASTS token (e.g. Custodes,
  // Sisters-without-faction-vote, Votann, Agents…) still gets a real trooper, not the old
  // one-size-fits-all built-in archetype.
  { id: 'troop-generic', priority: 10, match: (t) => isTroopKw(t), key: (t) => variantKey('troop-generic', t), build: buildLine },
];

export function register() {
  for (const kit of TROOP_KITS) registerMiniKit(kit);
}
