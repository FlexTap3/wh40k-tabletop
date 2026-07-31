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

/* Shared weapon-metal / dark-joint tints used by every kit below (glow stays per-kit).
 * Named tints are exempt from AO baking, so they read as crisp painted metal. */
const TROOP_TINTS = { steel: '#868c94', dark: '#23262c', gold: '#c9a24a', lens: '#d64a3a' };
function troopOpts(extra) {
  const o = { ao: 0.26, earthBase: true, tints: { steel: TROOP_TINTS.steel, dark: TROOP_TINTS.dark, gold: TROOP_TINTS.gold, lens: TROOP_TINTS.lens } };
  if (extra && extra.tints) for (const k in extra.tints) o.tints[k] = extra.tints[k];
  return o;
}

/* Sergeant/leader tell: crest + banner pole/flag bolted on above the head, same read as the
 * built-in "helm" character archetype used before this pack existed. y0 = head-top y. */
function sgtCrest(table, y0) {
  table.push(
    { x: 0, y: y0 + 0.09, z: -0.02, w: 0.05, h: 0.09, d: 0.18, c: 'hi' },
    { x: -0.06, y: y0 - 0.26, z: -0.14, w: 0.03, h: 0.40, d: 0.03, c: 'mid' },
    { x: -0.06, y: y0 - 0.02, z: -0.14, w: 0.14, h: 0.16, d: 0.02, c: 'hi' },
  );
}

/* Biped leg rig shared by the human-frame kits: boots + greaves + thighs with a knee
 * step and the pose's forward/back stagger. sc scales girth (guard slim, marine chunky). */
function legRig(table, p, sc, boot) {
  const g = sc || 1;
  table.push(
    { x: -0.11 * g, y: 0.045, z: p.legF + 0.02, w: 0.14 * g, h: 0.09, d: 0.20 * g, c: boot || 'dark' }, // boot L
    { x: 0.11 * g, y: 0.045, z: -p.legF + 0.02, w: 0.14 * g, h: 0.09, d: 0.20 * g, c: boot || 'dark' }, // boot R
    { x: -0.11 * g, y: 0.17, z: p.legF, w: 0.12 * g, h: 0.16, d: 0.13 * g, c: 'lo' },   // greave L
    { x: 0.11 * g, y: 0.17, z: -p.legF, w: 0.12 * g, h: 0.16, d: 0.13 * g, c: 'lo' },   // greave R
    { x: -0.10 * g, y: 0.305, z: p.legF * 0.5 - 0.01, w: 0.13 * g, h: 0.13, d: 0.14 * g, c: 'mid' }, // thigh L
    { x: 0.10 * g, y: 0.305, z: -p.legF * 0.5 - 0.01, w: 0.13 * g, h: 0.13, d: 0.14 * g, c: 'mid' }, // thigh R
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

// heavy infantry (Terminator/Gravis): squat tank of a man — huge dome pauldrons swallowing
// a sunken helm, tapered sarcophagus torso, twin storm-bolter barrels, power fist.
function buildHeavy(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.15, y: 0.05, z: 0.02, w: 0.20, h: 0.10, d: 0.26, c: 'dark' },                 // boot L
    { x: 0.15, y: 0.05, z: 0.02, w: 0.20, h: 0.10, d: 0.26, c: 'dark' },                  // boot R
    { x: -0.15, y: 0.19, z: p.legF * 0.5, w: 0.18, h: 0.20, d: 0.20, c: 'lo' },           // greave L
    { x: 0.15, y: 0.19, z: -p.legF * 0.5, w: 0.18, h: 0.20, d: 0.20, c: 'lo' },           // greave R
    { x: 0, y: 0.335, z: 0, w: 0.48, h: 0.09, d: 0.30, c: 'lo' },                         // waist plate
    { x: 0, y: 0.52, z: 0.01, w: 0.46, h: 0.28, d: 0.30, c: 'mid', tx: 1.14, tz: 1.05 },  // torso, flaring up
    { x: 0, y: 0.665, z: 0.13, w: 0.30, h: 0.10, d: 0.10, c: 'hi', tx: 0.7 },             // chest plate crown
    { x: 0, y: 0.60, z: -0.20, w: 0.28, h: 0.26, d: 0.10, c: 'mid' },                     // backpack slab
    { x: -0.10, y: 0.76, z: -0.20, w: 0.07, h: 0.09, d: 0.07, c: 'dark', s: 'cyl' },      // vent L
    { x: 0.10, y: 0.76, z: -0.20, w: 0.07, h: 0.09, d: 0.07, c: 'dark', s: 'cyl' },       // vent R
    { x: -0.33, y: 0.665, z: p.armZ, w: 0.30, h: 0.13, d: 0.34, c: 'dark', s: 'dome' },   // pauldron trim L (lower rim only)
    { x: -0.33, y: 0.70, z: p.armZ, w: 0.28, h: 0.20, d: 0.32, c: 'hi', s: 'dome' },      // massive dome pauldron L
    { x: 0.33, y: 0.665, z: p.armZ, w: 0.30, h: 0.13, d: 0.34, c: 'dark', s: 'dome' },    // pauldron trim R (lower rim only)
    { x: 0.33, y: 0.70, z: p.armZ, w: 0.28, h: 0.20, d: 0.32, c: 'hi', s: 'dome' },       // massive dome pauldron R
    { x: -0.33, y: 0.56, z: 0.04 + p.armZ, w: 0.18, h: 0.20, d: 0.20, c: 'mid', s: 'cap' }, // arm L
    { x: 0.33, y: 0.56, z: 0.04 + p.armZ, w: 0.18, h: 0.20, d: 0.20, c: 'mid', s: 'cap' },  // arm R
    { x: p.headX, y: 0.80, z: 0.03, w: 0.15, h: 0.11, d: 0.16, c: 'hi', s: 'dome' },      // helm, buried low
    { x: p.headX - 0.03, y: 0.785, z: 0.10, w: 0.026, h: 0.02, d: 0.018, c: 'lens' },     // eye lens L
    { x: p.headX + 0.03, y: 0.785, z: 0.10, w: 0.026, h: 0.02, d: 0.018, c: 'lens' },     // eye lens R
    { x: 0, y: 0.62, z: 0.145, w: 0.12, h: 0.08, d: 0.03, c: 'gold' },                    // gold crux/aquila
    { x: 0.34 + p.armX, y: 0.55, z: 0.24 + p.armZ, w: 0.13, h: 0.13, d: 0.24, c: 'dark' },// storm-bolter body
    { x: 0.31 + p.armX, y: 0.57, z: 0.42 + p.armZ, w: 0.05, h: 0.05, d: 0.16, c: 'steel', s: 'cyl', ax: 'z' }, // barrel L
    { x: 0.37 + p.armX, y: 0.57, z: 0.42 + p.armZ, w: 0.05, h: 0.05, d: 0.16, c: 'steel', s: 'cyl', ax: 'z' }, // barrel R
    { x: -0.33, y: 0.42, z: 0.12, w: 0.20, h: 0.20, d: 0.20, c: 'hi', tx: 0.75 },         // power fist
  ];
  if (t.sgt) sgtCrest(table, 0.86);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.5, troopOpts());
}

// power-armor line infantry (SM-family, also Sisters): sculpted on the real Intercessor
// read — contrapposto stance, trim-edged dome pauldrons, plastron with gold aquila, vented
// backpack, snouted helm with red lenses, bolt rifle held two-handed across the chest.
function buildLine(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const gunY = 0.53, gunZ = 0.17 + p.armZ, gunA = 0.35; // rifle line, angled across the body
  const table = [
    // ---- legs: braced stance, one foot forward, armored shins + knee pads ----
    { x: -0.13, y: 0.04, z: p.legF + 0.04, w: 0.15, h: 0.08, d: 0.22, c: 'dark' },        // boot L
    { x: 0.13, y: 0.04, z: -p.legF, w: 0.15, h: 0.08, d: 0.22, c: 'dark' },               // boot R
    { x: -0.13, y: 0.165, z: p.legF + 0.02, w: 0.13, h: 0.19, d: 0.15, c: 'mid', s: 'cap' },  // greave L
    { x: 0.13, y: 0.165, z: -p.legF, w: 0.13, h: 0.19, d: 0.15, c: 'mid', s: 'cap' },     // greave R
    { x: -0.125, y: 0.27, z: p.legF + 0.05, w: 0.10, h: 0.07, d: 0.09, c: 'hi', s: 'dome' },  // knee pad L
    { x: 0.125, y: 0.27, z: -p.legF + 0.04, w: 0.10, h: 0.07, d: 0.09, c: 'hi', s: 'dome' },  // knee pad R
    { x: -0.115, y: 0.33, z: p.legF * 0.5, w: 0.13, h: 0.14, d: 0.15, c: 'mid', s: 'cap' },   // thigh L
    { x: 0.115, y: 0.33, z: -p.legF * 0.5, w: 0.13, h: 0.14, d: 0.15, c: 'mid', s: 'cap' },   // thigh R
    // ---- pelvis / torso ----
    { x: 0, y: 0.415, z: 0, w: 0.26, h: 0.07, d: 0.18, c: 'dark' },                       // belt
    { x: 0, y: 0.42, z: 0.095, w: 0.07, h: 0.08, d: 0.03, c: 'gold' },                    // belt buckle
    { x: 0, y: 0.475, z: 0, w: 0.22, h: 0.07, d: 0.16, c: 'lo' },                         // abdomen ribbing
    { x: 0, y: 0.585, z: 0.01, w: 0.32, h: 0.17, d: 0.22, c: 'mid', tx: 1.1 },            // plastron, flaring up
    { x: 0, y: 0.635, z: 0.125, w: 0.17, h: 0.10, d: 0.035, c: 'gold' },                  // gold chest aquila
    { x: 0, y: 0.70, z: 0.03, w: 0.20, h: 0.05, d: 0.14, c: 'mid' },                      // gorget
    // ---- backpack: block + twin top vents + center exhaust ----
    { x: 0, y: 0.60, z: -0.155, w: 0.22, h: 0.21, d: 0.10, c: 'mid' },
    { x: -0.085, y: 0.725, z: -0.15, w: 0.065, h: 0.09, d: 0.065, c: 'dark', s: 'cyl', seg: 8 }, // vent L
    { x: 0.085, y: 0.725, z: -0.15, w: 0.065, h: 0.09, d: 0.065, c: 'dark', s: 'cyl', seg: 8 },  // vent R
    { x: 0, y: 0.71, z: -0.185, w: 0.05, h: 0.06, d: 0.05, c: 'steel', s: 'cyl', seg: 8 },       // center exhaust
    // ---- pauldrons: trim ring under the dome so the edge reads ----
    { x: -0.265, y: 0.66, z: 0, w: 0.20, h: 0.13, d: 0.24, c: 'dark', s: 'dome' },        // pauldron trim L
    { x: -0.265, y: 0.675, z: 0, w: 0.17, h: 0.13, d: 0.21, c: 'hi', s: 'dome' },         // pauldron L
    { x: 0.265, y: 0.66, z: 0, w: 0.20, h: 0.13, d: 0.24, c: 'dark', s: 'dome' },         // pauldron trim R
    { x: 0.265, y: 0.675, z: 0, w: 0.17, h: 0.13, d: 0.21, c: 'hi', s: 'dome' },          // pauldron R
    // ---- arms: both reach to the rifle line (two-handed grip) ----
    { x: -0.235, y: 0.575, z: 0.05, w: 0.10, h: 0.15, d: 0.11, c: 'mid', s: 'cap', rx: 0.5 },  // upper arm L
    { x: -0.17, y: 0.52, z: 0.13, w: 0.09, h: 0.13, d: 0.09, c: 'mid', s: 'cap', rx: 1.0, ry: -0.4 }, // forearm L to fore-grip
    { x: 0.235, y: 0.575, z: 0.05, w: 0.10, h: 0.15, d: 0.11, c: 'mid', s: 'cap', rx: 0.4 },   // upper arm R
    { x: 0.19, y: 0.52, z: 0.12, w: 0.09, h: 0.12, d: 0.09, c: 'mid', s: 'cap', rx: 0.9, ry: 0.3 },   // forearm R to trigger
    // ---- bolt rifle: angled across the chest, receiver + mag + barrel + muzzle ----
    { x: 0.04 + p.armX, y: gunY, z: gunZ, w: 0.09, h: 0.11, d: 0.30, c: 'dark', ry: gunA },       // receiver
    { x: 0.07 + p.armX, y: gunY - 0.075, z: gunZ - 0.02, w: 0.05, h: 0.09, d: 0.08, c: 'dark', ry: gunA }, // magazine
    { x: -0.045 + p.armX, y: gunY + 0.015, z: gunZ + 0.115, w: 0.042, h: 0.042, d: 0.15, c: 'steel', s: 'cyl', ax: 'z', ry: gunA }, // barrel
    { x: -0.09 + p.armX, y: gunY + 0.015, z: gunZ + 0.165, w: 0.055, h: 0.055, d: 0.045, c: 'dark', s: 'cyl', ax: 'z', ry: gunA }, // muzzle brake
    { x: 0.115 + p.armX, y: gunY + 0.045, z: gunZ - 0.09, w: 0.045, h: 0.05, d: 0.07, c: 'steel', ry: gunA }, // optic
    // ---- head: helm dome + brow + snout grille + red lenses ----
    { x: p.headX, y: 0.795, z: 0.02, w: 0.13, h: 0.10, d: 0.14, c: 'hi', s: 'cap' },      // helm core
    { x: p.headX, y: 0.855, z: 0.015, w: 0.145, h: 0.09, d: 0.155, c: 'hi', s: 'dome' },  // helm dome
    { x: p.headX, y: 0.845, z: 0.075, w: 0.13, h: 0.035, d: 0.05, c: 'hi' },              // brow ridge
    { x: p.headX, y: 0.78, z: 0.085, w: 0.065, h: 0.07, d: 0.055, c: 'lo', tx: 0.75 },    // snout grille
    { x: p.headX - 0.035, y: 0.82, z: 0.083, w: 0.028, h: 0.022, d: 0.02, c: 'lens' },    // eye lens L
    { x: p.headX + 0.035, y: 0.82, z: 0.083, w: 0.028, h: 0.022, d: 0.02, c: 'lens' },    // eye lens R
  ];
  if (t.sgt) sgtCrest(table, 0.92);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.3, troopOpts());
}

// light infantry / guard: slight frame, flak vest over fatigues, dome helmet with brim,
// long thin lasgun held at port.
function buildLight(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [];
  legRig(table, p, 0.75, 'dark');
  table.push(
    { x: 0, y: 0.40, z: 0, w: 0.24, h: 0.05, d: 0.15, c: 'dark' },                        // belt
    { x: 0, y: 0.52, z: 0, w: 0.24, h: 0.20, d: 0.15, c: 'mid' },                         // torso
    { x: 0, y: 0.545, z: 0.075, w: 0.20, h: 0.17, d: 0.05, c: 'lo' },                     // flak vest front
    { x: 0, y: 0.545, z: -0.075, w: 0.20, h: 0.17, d: 0.05, c: 'lo' },                    // flak vest back
    { x: 0, y: 0.54, z: -0.13, w: 0.13, h: 0.14, d: 0.06, c: 'mid' },                     // field pack
    { x: -0.155, y: 0.60, z: 0.01, w: 0.09, h: 0.14, d: 0.11, c: 'mid' },                 // arm L
    { x: 0.155, y: 0.60, z: 0.01, w: 0.09, h: 0.14, d: 0.11, c: 'mid' },                  // arm R
    { x: p.headX, y: 0.745, z: 0, w: 0.11, h: 0.09, d: 0.11, c: 'hi' },                   // face block
    { x: p.headX, y: 0.79, z: 0, w: 0.16, h: 0.08, d: 0.17, c: 'hi', s: 'dome' },         // helmet dome
    { x: 0.06 + p.armX, y: 0.575, z: 0.14 + p.armZ, w: 0.05, h: 0.07, d: 0.16, c: 'dark' },                    // lasgun stock
    { x: 0.06 + p.armX, y: 0.59, z: 0.30 + p.armZ, w: 0.035, h: 0.035, d: 0.24, c: 'steel', s: 'cyl', ax: 'z' }, // lasgun barrel
  );
  if (t.sgt) sgtCrest(table, 0.83);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.2, troopOpts());
}

// cultist / ork boy: hunched, asymmetric, choppa arm; orks get bigger arms + an underbit jaw.
function buildMob(ctx, t, footprint, palette) {
  const isOrk = factionOf(ctx.bridge, t) === 'ORK';
  const p = POSE[poseOf(t)];
  const s = isOrk ? 1.5 : 1.0;
  const table = [
    { x: -0.13, y: 0.05, z: 0.06, w: 0.17, h: 0.10, d: 0.24, c: 'dark' },                 // boot L
    { x: 0.11, y: 0.05, z: -0.02, w: 0.17, h: 0.10, d: 0.24, c: 'dark' },                 // boot R (staggered)
    { x: -0.12, y: 0.18, z: 0.04, w: 0.15, h: 0.18, d: 0.15, c: 'lo' },
    { x: 0.10, y: 0.18, z: -0.01, w: 0.15, h: 0.18, d: 0.15, c: 'lo' },                   // asymmetric stance
    { x: 0.02, y: 0.30, z: 0.02, w: 0.36, h: 0.08, d: 0.22, c: 'dark' },                  // belt
    { x: 0.02, y: isOrk ? 0.50 : 0.46, z: 0.06, w: isOrk ? 0.44 : 0.34, h: isOrk ? 0.28 : 0.24, d: isOrk ? 0.30 : 0.22, c: 'mid', tx: 1.18, shz: 0.05 }, // hunched torso, leaning in
    { x: 0.30 * s + p.armX, y: 0.44, z: 0.10 + p.armZ, w: 0.14 * s, h: 0.32 * s, d: 0.15 * s, c: 'mid' }, // choppa arm
    { x: 0.32 * s + p.armX, y: 0.62, z: 0.16 + p.armZ, w: 0.05 * s, h: 0.22, d: 0.14 * s, c: 'steel', tz: 0.3, rx: -0.5 }, // choppa blade raised overhead
    { x: -0.18, y: 0.42, z: 0.06, w: 0.10, h: 0.22, d: 0.12, c: 'lo' },                   // off-hand arm
    { x: 0.02, y: isOrk ? 0.73 : 0.67, z: 0.12, w: isOrk ? 0.27 : 0.19, h: isOrk ? 0.21 : 0.16, d: isOrk ? 0.25 : 0.18, c: 'hi', s: 'dome' }, // head, jutted forward
  ];
  if (isOrk) table.push({ x: 0.02, y: 0.635, z: 0.22, w: 0.20, h: 0.10, d: 0.12, c: 'hi', tx: 1.3 }); // underbite jaw
  if (t.sgt) sgtCrest(table, isOrk ? 0.82 : 0.74);
  return ctx.voxelsToGeometry(table, footprint, palette, isOrk ? 1.35 : 1.15, troopOpts());
}

// Tyranid organism: hunched chitin, tapered scything talons, whip tail; carapace(hi)/flesh(mid).
function buildTyranid(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const tier = tyranidTier(t);
  const targetH = TYRANID_HEIGHT[tier];
  const table = [
    { x: -0.11, y: 0.16, z: 0.06, w: 0.11, h: 0.28, d: 0.11, c: 'lo', ry: 0.14, rx: -0.18 }, // digitigrade leg L
    { x: 0.11, y: 0.16, z: 0.06, w: 0.11, h: 0.28, d: 0.11, c: 'lo', ry: -0.14, rx: -0.18 }, // digitigrade leg R
    { x: 0, y: 0.30, z: 0.04, w: 0.28, h: 0.11, d: 0.22, c: 'lo', s: 'dome' },            // hip chitin
    { x: 0, y: 0.47, z: 0.10, w: 0.28, h: 0.26, d: 0.26, c: 'mid', ry: 0.10, rx: 0.25 },  // hunched torso, pitched forward
    { x: 0, y: 0.615, z: 0.14, w: 0.34, h: 0.17, d: 0.26, c: 'hi', s: 'dome' },           // carapace hump
    { x: -0.24, y: 0.50, z: 0.26, w: 0.11, h: 0.40, d: 0.11, c: 'hi', s: 'cyl', tp: 0.12, ry: 0.4 + p.armZ, rx: 0.85 },  // scything talon L, arcing fwd+down
    { x: 0.24, y: 0.50, z: 0.26, w: 0.11, h: 0.40, d: 0.11, c: 'hi', s: 'cyl', tp: 0.12, ry: -0.4 - p.armZ, rx: 0.85 }, // scything talon R, arcing fwd+down
    { x: -0.20, y: 0.44, z: 0.14, w: 0.10, h: 0.18, d: 0.10, c: 'mid', rx: 0.3 },         // talon shoulder joint L
    { x: 0.20, y: 0.44, z: 0.14, w: 0.10, h: 0.18, d: 0.10, c: 'mid', rx: 0.3 },          // talon shoulder joint R
    { x: 0, y: 0.685, z: 0.27, w: 0.14, h: 0.13, d: 0.22, c: 'mid', s: 'dome' },          // head — thrust forward, predatory
    { x: 0, y: 0.375, z: -0.32, w: 0.08, h: 0.08, d: 0.36, c: 'lo', s: 'cyl', ax: 'z', tp: 0.3, ry: 0.22, rx: -0.20 }, // tail, whipping back+up
  ];
  return ctx.voxelsToGeometry(table, footprint, palette, targetH, troopOpts());
}

// Necron warrior: gaunt metal skeleton — thin cylinder limbs, ribbed chest, skull dome,
// glowing gauss rod with muzzle bloom.
function buildNecron(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.07, y: 0.16, z: 0, w: 0.07, h: 0.32, d: 0.07, c: 'steel', s: 'cyl' },         // shin rod L
    { x: 0.07, y: 0.16, z: 0, w: 0.07, h: 0.32, d: 0.07, c: 'steel', s: 'cyl' },          // shin rod R
    { x: 0, y: 0.345, z: 0, w: 0.24, h: 0.06, d: 0.13, c: 'lo' },                         // pelvis
    { x: 0, y: 0.44, z: 0, w: 0.09, h: 0.14, d: 0.09, c: 'steel', s: 'cyl' },             // spine column
    { x: 0, y: 0.575, z: 0, w: 0.24, h: 0.22, d: 0.15, c: 'mid', tx: 1.1 },               // ribcage
    { x: 0, y: 0.575, z: 0.085, w: 0.18, h: 0.16, d: 0.02, c: 'dark' },                   // rib shadow plate
    { x: -0.16, y: 0.685, z: 0, w: 0.09, h: 0.09, d: 0.13, c: 'mid', s: 'dome' },         // shoulder L
    { x: 0.16, y: 0.685, z: 0, w: 0.09, h: 0.09, d: 0.13, c: 'mid', s: 'dome' },          // shoulder R
    { x: -0.15, y: 0.55, z: 0.05, w: 0.06, h: 0.20, d: 0.06, c: 'steel', s: 'cyl', rx: 0.3 }, // arm rod L
    { x: p.headX, y: 0.83, z: 0, w: 0.14, h: 0.13, d: 0.15, c: 'hi', s: 'dome' },         // skull dome
    { x: p.headX, y: 0.79, z: 0.06, w: 0.10, h: 0.06, d: 0.07, c: 'dark' },               // eye-slit shadow
    { x: p.armX, y: 0.55, z: 0.20 + p.armZ, w: 0.045, h: 0.045, d: 0.40, c: 'glow', s: 'cyl', ax: 'z' }, // gauss rod
    { x: p.armX, y: 0.55, z: 0.16 + p.armZ, w: 0.08, h: 0.10, d: 0.16, c: 'dark' },       // gauss housing
    { x: p.armX, y: 0.56, z: 0.40 + p.armZ, w: 0.08, h: 0.08, d: 0.08, c: 'glow', s: 'dome' }, // muzzle bloom
  ];
  if (t.sgt) sgtCrest(table, 0.90);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.3, troopOpts({ tints: { glow: '#57d0ff' } }));
}

// T'au fire warrior: sculpted on the real kit — smooth composite cuirass over a dark
// bodysuit, the ONE oversized left shoulder pad, center-lens sensor helm + antenna,
// long two-part pulse rifle held low across the body.
function buildTau(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    // legs: dark bodysuit shins with armor plates hanging over the thighs
    { x: -0.10, y: 0.04, z: p.legF + 0.03, w: 0.12, h: 0.08, d: 0.18, c: 'dark' },        // hoof-boot L
    { x: 0.10, y: 0.04, z: -p.legF, w: 0.12, h: 0.08, d: 0.18, c: 'dark' },               // hoof-boot R
    { x: -0.095, y: 0.165, z: p.legF, w: 0.10, h: 0.19, d: 0.11, c: 'lo', s: 'cap' },     // shin L
    { x: 0.095, y: 0.165, z: -p.legF, w: 0.10, h: 0.19, d: 0.11, c: 'lo', s: 'cap' },     // shin R
    { x: -0.10, y: 0.315, z: p.legF * 0.5 + 0.02, w: 0.11, h: 0.13, d: 0.12, c: 'mid', s: 'cap' }, // thigh plate L
    { x: 0.10, y: 0.315, z: -p.legF * 0.5 + 0.02, w: 0.11, h: 0.13, d: 0.12, c: 'mid', s: 'cap' }, // thigh plate R
    { x: 0, y: 0.41, z: 0, w: 0.26, h: 0.06, d: 0.17, c: 'dark' },                        // belt
    { x: 0, y: 0.54, z: 0, w: 0.30, h: 0.20, d: 0.20, c: 'mid', tx: 0.82, tz: 0.82 },     // smooth tapering cuirass
    { x: 0, y: 0.60, z: 0.105, w: 0.16, h: 0.09, d: 0.035, c: 'hi', tx: 0.7 },            // chest plate
    { x: 0, y: 0.475, z: 0.10, w: 0.10, h: 0.05, d: 0.03, c: 'lens' },                    // sept stripe
    { x: 0, y: 0.55, z: -0.13, w: 0.16, h: 0.17, d: 0.08, c: 'mid' },                     // backpack
    { x: 0, y: 0.655, z: -0.13, w: 0.12, h: 0.04, d: 0.07, c: 'dark' },                   // backpack cap
    // the iconic ONE big left shoulder pad; right side just a small joint dome
    { x: -0.235, y: 0.645, z: 0, w: 0.17, h: 0.14, d: 0.22, c: 'hi', s: 'dome' },         // big pad L
    { x: -0.235, y: 0.635, z: 0, w: 0.19, h: 0.13, d: 0.24, c: 'dark', s: 'dome' },       // pad trim L
    { x: 0.195, y: 0.635, z: 0, w: 0.10, h: 0.08, d: 0.13, c: 'mid', s: 'dome' },         // joint dome R
    { x: -0.19, y: 0.53, z: 0.04, w: 0.09, h: 0.14, d: 0.10, c: 'lo', s: 'cap', rx: 0.4 },    // arm L to fore-grip
    { x: 0.185, y: 0.53, z: 0.04, w: 0.09, h: 0.14, d: 0.10, c: 'lo', s: 'cap', rx: 0.5 },    // arm R to trigger
    // pulse rifle: long, blocky fore-end, thin barrel, held low across the body
    { x: 0.05 + p.armX, y: 0.485, z: 0.16 + p.armZ, w: 0.075, h: 0.10, d: 0.26, c: 'dark', ry: 0.25 },  // rifle body
    { x: 0.02 + p.armX, y: 0.50, z: 0.28 + p.armZ, w: 0.055, h: 0.065, d: 0.12, c: 'mid', ry: 0.25 },   // fore-end shroud
    { x: -0.015 + p.armX, y: 0.505, z: 0.375 + p.armZ, w: 0.038, h: 0.038, d: 0.10, c: 'steel', s: 'cyl', ax: 'z', ry: 0.25 }, // barrel
    // helm: smooth dome, protruding center lens, comm antenna
    { x: p.headX, y: 0.775, z: 0.01, w: 0.125, h: 0.10, d: 0.135, c: 'hi', s: 'cap' },    // helm core
    { x: p.headX, y: 0.825, z: 0.005, w: 0.14, h: 0.08, d: 0.15, c: 'hi', s: 'dome' },    // helm dome
    { x: p.headX, y: 0.79, z: 0.085, w: 0.055, h: 0.045, d: 0.035, c: 'dark', s: 'dome' },// lens housing
    { x: p.headX, y: 0.79, z: 0.10, w: 0.03, h: 0.026, d: 0.015, c: 'lens' },             // center lens
    { x: 0.065, y: 0.93, z: -0.05, w: 0.018, h: 0.15, d: 0.018, c: 'steel', s: 'cyl', seg: 6 }, // antenna
    { x: 0.065, y: 1.005, z: -0.05, w: 0.028, h: 0.028, d: 0.028, c: 'lens', s: 'dome' }, // antenna tip
  ];
  if (t.sgt) sgtCrest(table, 0.88);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.3, troopOpts());
}

// T'au drone: hovering lens-shaped disc — dome shell over a dark underside, sensor bud,
// twin gun stub, thin anti-grav strut to the base.
function buildTauDrone(ctx, t, footprint, palette) {
  const table = [
    { x: 0, y: 0.56, z: 0, w: 0.60, h: 0.14, d: 0.55, c: 'mid', s: 'dome' },              // disc shell
    { x: 0, y: 0.505, z: 0, w: 0.50, h: 0.05, d: 0.46, c: 'dark', s: 'cyl' },             // underside plate
    { x: 0, y: 0.635, z: 0, w: 0.16, h: 0.08, d: 0.16, c: 'hi', s: 'dome' },              // sensor bud
    { x: 0.10, y: 0.52, z: 0.24, w: 0.04, h: 0.04, d: 0.16, c: 'steel', s: 'cyl', ax: 'z' }, // gun stub
    { x: 0, y: 0.25, z: 0, w: 0.04, h: 0.50, d: 0.04, c: 'dark', s: 'cyl' },              // hover strut to base
  ];
  return ctx.voxelsToGeometry(table, footprint, palette, 1.0, troopOpts());
}

// Eldar / Drukhari (kabalite warrior read): lithe segmented armor over a slim frame, tall
// crested helm, long bayonet-tipped splinter rifle held across the body.
function buildEldar(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  const table = [
    { x: -0.075, y: 0.035, z: p.legF + 0.03, w: 0.10, h: 0.07, d: 0.16, c: 'dark' },      // pointed boot L
    { x: 0.075, y: 0.035, z: -p.legF, w: 0.10, h: 0.07, d: 0.16, c: 'dark' },             // pointed boot R
    { x: -0.075, y: 0.17, z: p.legF, w: 0.085, h: 0.22, d: 0.09, c: 'lo', s: 'cap' },     // long shin L
    { x: 0.075, y: 0.17, z: -p.legF, w: 0.085, h: 0.22, d: 0.09, c: 'lo', s: 'cap' },     // long shin R
    { x: -0.075, y: 0.325, z: p.legF * 0.5, w: 0.09, h: 0.12, d: 0.10, c: 'mid', s: 'cap' },  // thigh L
    { x: 0.075, y: 0.325, z: -p.legF * 0.5, w: 0.09, h: 0.12, d: 0.10, c: 'mid', s: 'cap' },  // thigh R
    { x: 0, y: 0.40, z: 0, w: 0.19, h: 0.05, d: 0.13, c: 'dark' },                        // belt
    { x: 0, y: 0.50, z: 0, w: 0.19, h: 0.12, d: 0.13, c: 'lo', s: 'cap' },                // segmented midriff
    { x: 0, y: 0.615, z: 0.01, w: 0.24, h: 0.15, d: 0.15, c: 'mid', tx: 1.1, shz: 0.02 }, // chest carapace
    { x: 0, y: 0.665, z: 0.085, w: 0.10, h: 0.07, d: 0.03, c: 'lens' },                   // soul gem
    { x: 0, y: 0.715, z: 0.02, w: 0.15, h: 0.045, d: 0.10, c: 'hi' },                     // high gorget
    { x: -0.155, y: 0.71, z: 0, w: 0.10, h: 0.08, d: 0.13, c: 'hi', s: 'dome' },          // spiked shoulder L
    { x: -0.185, y: 0.755, z: 0, w: 0.035, h: 0.09, d: 0.035, c: 'hi', s: 'cyl', tp: 0, rz: 0.5 }, // shoulder spike
    { x: 0.155, y: 0.71, z: 0, w: 0.10, h: 0.08, d: 0.13, c: 'hi', s: 'dome' },           // shoulder R
    { x: -0.135, y: 0.585, z: 0.06, w: 0.075, h: 0.13, d: 0.085, c: 'mid', s: 'cap', rx: 0.55 }, // arm L to fore-grip
    { x: 0.135, y: 0.585, z: 0.05, w: 0.075, h: 0.12, d: 0.085, c: 'mid', s: 'cap', rx: 0.6 },   // arm R to trigger
    // splinter rifle: slim, long, blade under the muzzle
    { x: 0.03 + p.armX, y: 0.545, z: 0.15 + p.armZ, w: 0.055, h: 0.08, d: 0.24, c: 'dark', ry: 0.3 },  // rifle body
    { x: -0.02 + p.armX, y: 0.56, z: 0.27 + p.armZ, w: 0.03, h: 0.03, d: 0.16, c: 'steel', s: 'cyl', ax: 'z', ry: 0.3 }, // barrel
    { x: -0.05 + p.armX, y: 0.525, z: 0.33 + p.armZ, w: 0.02, h: 0.09, d: 0.10, c: 'steel', tz: 0.15, ry: 0.3, rx: 0.9 }, // bayonet blade
    // helm: tight dome + face plate + tall backswept crest
    { x: p.headX, y: 0.83, z: 0.015, w: 0.115, h: 0.10, d: 0.13, c: 'hi', s: 'cap' },     // helm core
    { x: p.headX, y: 0.845, z: 0.075, w: 0.07, h: 0.06, d: 0.05, c: 'lo', tx: 0.6 },      // face plate
    { x: p.headX, y: 0.95, z: -0.02, w: 0.05, h: 0.17, d: 0.05, c: 'hi', s: 'cyl', tp: 0, rx: -0.25 }, // crest, swept back
  ];
  if (t.sgt) sgtCrest(table, 1.02);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.35, troopOpts());
}

// Bike / cavalry: real round wheels, faired hull with tapered nose cowl, hunched rider.
// Front = +x (the tank/WP21 convention: local x is the long footprint axis).
function buildBike(ctx, t, footprint, palette) {
  const p = POSE[poseOf(t)];
  // wheels: cylinders on a z axle; h is chosen ~w*2.4 so the ellipse stays near-round on
  // the standard 3.55x2.05in bike oval at targetH 1.4 (w*3.55 vs h*1.4).
  const table = [
    { x: 0.30, y: 0.215, z: 0, w: 0.17, h: 0.42, d: 0.13, c: 'dark', s: 'cyl', ax: 'z' }, // front wheel
    { x: -0.26, y: 0.215, z: 0, w: 0.17, h: 0.42, d: 0.15, c: 'dark', s: 'cyl', ax: 'z' },// rear wheel
    { x: 0.30, y: 0.215, z: 0, w: 0.13, h: 0.28, d: 0.05, c: 'steel', s: 'cyl', ax: 'z' }, // front hub
    { x: -0.02, y: 0.235, z: 0, w: 0.44, h: 0.16, d: 0.24, c: 'mid' },                    // hull spine
    { x: 0.17, y: 0.30, z: 0, w: 0.22, h: 0.14, d: 0.22, c: 'mid', tx: 0.55, shx: 0.05 }, // nose cowl, tapering fwd+up
    { x: -0.24, y: 0.135, z: -0.14, w: 0.16, h: 0.06, d: 0.06, c: 'steel', s: 'cyl', ax: 'x' }, // exhaust L
    { x: -0.24, y: 0.135, z: 0.14, w: 0.16, h: 0.06, d: 0.06, c: 'steel', s: 'cyl', ax: 'x' },  // exhaust R
    { x: 0.235, y: 0.375, z: 0, w: 0.04, h: 0.04, d: 0.30, c: 'steel', s: 'cyl', ax: 'z' },     // handlebar
    { x: 0.33, y: 0.33, z: -0.09, w: 0.14, h: 0.035, d: 0.035, c: 'dark', s: 'cyl', ax: 'x' },  // twin bolter L
    { x: 0.33, y: 0.33, z: 0.09, w: 0.14, h: 0.035, d: 0.035, c: 'dark', s: 'cyl', ax: 'x' },   // twin bolter R
    { x: -0.10 + p.armX * 0.3, y: 0.47 + p.legF, z: 0, w: 0.20, h: 0.22, d: 0.22, c: 'hi', rz: -0.35 }, // rider torso, leaning in
    { x: -0.14, y: 0.60, z: 0, w: 0.24, h: 0.10, d: 0.26, c: 'hi' },                      // rider shoulders
    { x: -0.155, y: 0.685, z: p.headX, w: 0.13, h: 0.11, d: 0.14, c: 'hi', s: 'dome' },   // rider helm
    { x: -0.19, y: 0.46, z: -0.16, w: 0.08, h: 0.24, d: 0.10, c: 'lo' },                  // rider leg L
    { x: -0.19, y: 0.46, z: 0.16, w: 0.08, h: 0.24, d: 0.10, c: 'lo' },                   // rider leg R
  ];
  if (t.sgt) sgtCrest(table, 0.76);
  return ctx.voxelsToGeometry(table, footprint, palette, 1.4, troopOpts());
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
    // NOTE: boxes only (taper is fine — still 24 verts/box, which the pack's own test
    // counts on to derive body count). No cyl/dome in this kit.
    table.push({ x: bx, y: bodyY, z: bz, w: bodyW, h: BODY_H, d: bodyD, c: 'mid', tx: 0.55, tz: 0.7 }); // body, humped
    const headY = bodyY + BODY_H * 0.5 + HEAD_H * 0.35;
    table.push({ x: bx + bodyD * 0.45, y: headY, z: bz, w: bodyW * 0.55, h: HEAD_H, d: bodyD * 0.45, c: 'hi', tx: 0.6 }); // head/mandibles
  }
  return ctx.voxelsToGeometry(table, footprint, palette, 0.55, troopOpts());
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
