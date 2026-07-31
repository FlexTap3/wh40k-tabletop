/* ==== WP3D-8: vehicle & monster kit pack ==== Per-chassis voxel kits keyed off unit names
 * (the WP21_HULLS families in wh40k-tabletop.html, plus a few chassis that live outside that
 * table — repulsor/impulsor, monolith, dreadnoughts/knights, named monsters, AIRCRAFT-kw
 * flyers) so a Rhino, a Land Raider and a Hammerhead each read as their OWN silhouette instead
 * of sharing the generic tank archetype. Higher priority than the troop pack (20 vs 10);
 * named monsters go to 25 so they win over the generic walker kit on overlapping names (e.g.
 * "Wraithknight" must not fall into the plain dreadnought/knight walker silhouette).
 * Registered via register(). Coverage: every WP21_HULLS regex family is routed to SOME kit
 * here (chassis families share a kit — see the RE_* groupings below — per the packet's
 * "share kits across similar chassis" note) with the sole deliberate exception of the
 * attack-bike/outrider family, which is infantry-scale (a rider mini on a hull-sized oval
 * base) and is left to the troop pack's mounted archetype rather than hijacked into a vehicle
 * chassis look. */
import { registerMiniKit, voxelsToGeometry, mergeGeometries } from './wp3d-1-geometry.js';

/* ---------------------------------------------------------------------------------------
 * Name normalization — mirrors wh40k-tabletop.html's `norm()` (lowercase, strip punctuation,
 * collapse whitespace) so our regex families match WP21_HULLS's own conventions exactly
 * (e.g. "Sky Ray" / "Fire Raptor's" all normalize the same way).
 * ------------------------------------------------------------------------------------- */
const norm = s => String(s).toLowerCase().replace(/[’'`-]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function nameOf(token) { return norm((token && token.name) || ""); }
function kwOf(token) { return ((token && token.kw) || []).map(s => String(s).toUpperCase()); }

/* box(x,y,z,w,h,d,c,ry) — one voxel-table entry per the WP3D-1 contract: x/y/z = box CENTER
 * in normalized local space, w/h/d = box full size (normalized), c = 'hi'|'mid'|'lo'|tint key,
 * ry = optional Y-axis rotation (radians) baked into that box before translation. */
function box(x, y, z, w, h, d, c, ry) { const b = { x, y, z, w, h, d, c }; if (ry != null) b.ry = ry; return b; }

/* Shared tint palette: 'steel' for undecorated gunmetal machinery (tracks/wheels/barrels/
 * struts) that should read the same across every faction's hull color, 'glow' for
 * lenses/exhaust/anti-grav effects — tied to the faction's own hi accent so a Necron glow
 * comes out gauss-green, a T'au glow comes out ochre, etc. without any per-kit special-casing. */
const STEEL = '#7f858c';
const DARK = '#22262b';
function tintsFor(palette) { return { steel: STEEL, dark: DARK, glow: (palette && palette.hi) || '#9aa0a8' }; }
/* Shared build options: faction tints + baked vertical AO (mid/lo mass darkens toward the
 * tracks; hi/steel/dark/glow stay exact — the palette.hi and glow-skirt assertions rely on it). */
function vehOpts(palette) { return { ao: 0.24, earthBase: true, tints: tintsFor(palette) }; }

/* ---------------------------------------------------------------------------------------
 * Regex families — a superset of WP21_HULLS (wh40k-tabletop.html ~line 6701): every family
 * in that table is covered below (grouped where several chassis share one kit), plus a
 * handful of chassis this pack recognizes that aren't in the 2D hull table at all (grav
 * tanks, the monolith, dreadnoughts/knights, named monsters — those units either use a
 * parseable base string or a stand-circle in 2D, so they never needed a hull-table entry,
 * but the 3D view still wants a distinct silhouette for them).
 * ------------------------------------------------------------------------------------- */
const RE_RHINO = /rhino|razorback|immolator|repressor/;
const RE_PREDATOR = /predator|castigator|^hunter$|^stalker$|sicaran/;
const RE_VINDICATOR = /vindicator/;
const RE_WHIRLWIND = /whirlwind|exorcist/;
const RE_LANDRAIDER = /land raider|kratos|cerberus|typhon|spartan|\bpraetor\b|crassus|gorgon heavy|hekaton land fortress/;
const RE_LEMANRUSS = /leman russ|rogal dorn|malcador|valdor|minotaur|coronus|carnodon/;
const RE_CHIMERA = /\bchimera\b|hellhound|\bmanticore\b(?! platform)|\bhydra\b(?! platform)|wyvern|colossus|griffon|salamander|trojan|atlas recovery|centaur|plagueburst crawler|terrax|sagitaur|taurox/;
const RE_BASILISK = /basilisk/;
const RE_BANEBLADE = /baneblade|banehammer|banesword|doomhammer|hellhammer|shadowsword|stormblade|stormlord|stormsword|fellblade|falchion|stormhammer|macharius|lord of skulls/;
const RE_TRUKK = /\btrukk\b|goliath (rockgrinder|truck)/;
const RE_BATTLEWAGON = /battlewagon|kannonwagon|deff rolla|big trakk/;
const RE_DROPPOD = /drop pod/;
const RE_DEVILFISH = /devilfish|hammerhead|sky ?ray|longstrike/;
const RE_PIRANHA = /piranha|tetra/;
const RE_GRAV = /land speeder|javelin attack speeder|darkshroud|repulsor|impulsor/;
const RE_WAVESERPENT = /wave serpent|\bfalcon\b|fire prism|night spinner|warp hunter|firestorm(?! redoubt)|^cobra$|^scorpion$|^lynx$/;
const RE_RAIDER = /^raider$|ynnari raider|tantalus|ravager|^reaper$|^venom$|starweaver|voidweaver/;
const RE_GHOSTARK = /ghost ark|doomsday ark|annihilation barge|command barge|skorpius/;
const RE_MONOLITH = /monolith/;
// Knight chassis names only — deliberately NOT a bare /knight/ test, which would also catch
// infantry squads like "Grey Knight Terminator" or "Knights of..." narrative titles. Only
// recognized super-heavy knight chassis (imperial/chaos/questor pattern names) route here.
const RE_KNIGHT = /\bknight (paladin|crusader|castellan|errant|gallant|warden|preceptor|valiant|magaera|desecrator|despoiler|tyrant|abominant|rampager|moirax)\b|\b(imperial|chaos|questor|acastus|cerastus) knight\b/;
const RE_WALKER_BASE = /dreadnought|redemptor|war ?dog|armiger|triarch stalker/;
const RE_MONSTER = /carnifex|hive tyrant|daemon prince|trygon|mawloc|riptide|morkanaut|wraithknight/;

/* ---------------------------------------------------------------------------------------
 * Shared sub-assembly builders
 * ------------------------------------------------------------------------------------- */

/* Full-length track pair flanking the hull (front = +x, per the WP3D-1 'tank' convention:
 * local x = hull LENGTH, local z = hull WIDTH). Tops taper lengthwise so the track run has
 * sloped leading/trailing ends, and each side carries visible drive-sprocket cylinders. */
function trackPair(yc, h, len, gap, zOff, c) {
  const out = [
    { ...box(0, yc, -zOff, len, h, gap, c || 'dark'), tx: 0.82 },
    { ...box(0, yc, zOff, len, h, gap, c || 'dark'), tx: 0.82 },
  ];
  for (const zi of [-zOff, zOff]) for (const xi of [-len * 0.44, len * 0.44]) {
    out.push({ x: xi, y: yc * 0.9, z: zi, w: h * 0.62, h: h * 0.62, d: gap * 0.9, c: 'dark', s: 'cyl', ax: 'z', seg: 8 });
  }
  return out;
}

/* Road-wheel cluster (3 per side) for wheeled chassis (Taurox, trukks) — real cylinders. */
function wheelSet(yc, r, zOff) {
  const out = [];
  for (const xi of [-0.30, 0, 0.30]) for (const zi of [-zOff, zOff]) {
    out.push({ x: xi, y: yc, z: zi, w: r * 1.6, h: r * 2.4, d: r * 0.8, c: 'dark', s: 'cyl', ax: 'z', seg: 10 });
  }
  return out;
}

/* Forward gun: housing + cylinder barrel with a tapered muzzle. cx/cy/cz = breech point,
 * len = barrel length (normalized x units), r = barrel radius (normalized y units). */
function gunFwd(cx, cy, cz, len, r, c) {
  return [
    { x: cx + len / 2, y: cy, z: cz, w: len, h: r * 2, d: r * 2, c: c || 'steel', s: 'cyl', ax: 'x', seg: 8 },
    { x: cx + len + 0.02, y: cy, z: cz, w: 0.05, h: r * 2.6, d: r * 2.6, c: 'dark', s: 'cyl', ax: 'x', seg: 8 }, // muzzle brake
  ];
}

/* Thin anti-grav skirt band, ALWAYS table index 0 by convention for every hover kit below —
 * the visual "shadowed skirt" the hull floats on. Everything after it in the table is the
 * hull mass proper and (by construction here) always clears HOVER_CLEARANCE inches above the
 * base — see the hover-kit builders. */
const HOVER_CLEARANCE = 0.34; // inches; contract floor is 0.3in, kept with a small margin
function skirt(targetH, w, d) {
  const yTop = HOVER_CLEARANCE / targetH;
  const hN = 0.05 / targetH;
  return box(0, yTop - hN / 2, 0, w, hN, d, 'glow');
}
function hoverFloor(targetH) { return HOVER_CLEARANCE / targetH; }

/* Biped walker/knight skeleton — legs, hip, torso, shoulders, head, one forward weapon arm.
 * tier: 'dread' (compact), 'wardog' (leaner/taller), 'knight' (carapace + banner), and reused
 * verbatim by the monster pack for morkanaut/wraithknight (tier 'knight') per the "share kits
 * across similar chassis" note. A 3rd rear strut is added for the Triarch Stalker's tripod
 * read (tier 'tripod'). */
function bipedWalkerTable(tier) {
  const t = [
    { ...box(-0.16, 0.14, 0, 0.12, 0.24, 0.14, 'lo'), tx: 0.8 },   // leg L lower, tapering up
    { ...box(0.16, 0.14, 0, 0.12, 0.24, 0.14, 'lo'), tx: 0.8 },    // leg R lower
    box(-0.16, 0.03, 0.04, 0.16, 0.06, 0.22, 'dark'),              // foot L
    box(0.16, 0.03, 0.04, 0.16, 0.06, 0.22, 'dark'),               // foot R
    { x: -0.16, y: 0.26, z: 0, w: 0.10, h: 0.08, d: 0.10, c: 'steel', s: 'cyl', ax: 'z', seg: 8 }, // knee joint L
    { x: 0.16, y: 0.26, z: 0, w: 0.10, h: 0.08, d: 0.10, c: 'steel', s: 'cyl', ax: 'z', seg: 8 },  // knee joint R
    { ...box(-0.16, 0.36, 0, 0.14, 0.22, 0.16, 'mid'), tx: 1.15 }, // thigh L, widening into hip
    { ...box(0.16, 0.36, 0, 0.14, 0.22, 0.16, 'mid'), tx: 1.15 },  // thigh R
    box(0, 0.50, 0, 0.34, 0.12, 0.26, 'mid'),                      // hip block
    { ...box(0, 0.68, 0.01, 0.40, 0.24, 0.30, 'hi'), tx: 0.9, shz: 0.02 }, // torso, leaning in
    { x: -0.25, y: 0.775, z: 0, w: 0.18, h: 0.13, d: 0.26, c: 'mid', s: 'dome' }, // shoulder cowl L
    { x: 0.25, y: 0.775, z: 0, w: 0.18, h: 0.13, d: 0.26, c: 'mid', s: 'dome' },  // shoulder cowl R
    box(0, 0.86, 0.06, 0.16, 0.11, 0.15, 'hi'),                    // head/cockpit
    box(0.30, 0.62, 0.06, 0.11, 0.22, 0.12, 'steel'),              // weapon arm housing
    { x: 0.30, y: 0.47, z: 0.16, w: 0.075, h: 0.20, d: 0.075, c: 'dark', s: 'cyl', seg: 8, rx: 0.5 }, // gatling barrels
    { x: -0.30, y: 0.55, z: 0.08, w: 0.14, h: 0.16, d: 0.14, c: 'hi', tx: 0.7 }, // fist arm
  ];
  if (tier === 'knight') {
    t.push({ x: 0, y: 0.90, z: -0.02, w: 0.50, h: 0.16, d: 0.40, c: 'mid', s: 'dome' });  // domed carapace, seated on the torso
    t.push({ x: -0.18, y: 1.05, z: -0.14, w: 0.025, h: 0.30, d: 0.025, c: 'steel', s: 'cyl', seg: 6 }); // banner pole
    t.push(box(-0.18, 1.22, -0.14, 0.14, 0.16, 0.02, 'hi'));       // banner flag
  }
  if (tier === 'tripod') {
    t.push({ ...box(0, 0.14, -0.22, 0.10, 0.24, 0.12, 'lo'), rx: -0.25 }); // rear strut leg
  }
  return t;
}

/* ---------------------------------------------------------------------------------------
 * Per-chassis voxel tables. Each returns a plain box[] fed straight to voxelsToGeometry.
 * ------------------------------------------------------------------------------------- */

function rhinoTable(turreted) {
  const t = [
    ...trackPair(0.13, 0.22, 0.90, 0.14, 0.37),
    box(0, 0.32, 0, 0.86, 0.28, 0.62, 'mid'),                            // hull lower
    { ...box(-0.02, 0.55, 0, 0.70, 0.20, 0.50, 'mid'), tx: 0.80, shx: -0.03 }, // roof, sloping into the glacis
    { ...box(0.42, 0.38, 0, 0.12, 0.32, 0.54, 'hi'), shx: -0.09 },       // angled front glacis
    box(-0.10, 0.68, 0, 0.16, 0.07, 0.18, 'hi'),                         // top hatch rail
    { x: -0.10, y: 0.71, z: 0, w: 0.13, h: 0.06, d: 0.13, c: 'hi', s: 'dome' }, // hatch dome
    { x: -0.42, y: 0.26, z: -0.30, w: 0.06, h: 0.14, d: 0.06, c: 'steel', s: 'cyl' }, // exhaust L
    { x: -0.42, y: 0.26, z: 0.30, w: 0.06, h: 0.14, d: 0.06, c: 'steel', s: 'cyl' },  // exhaust R
    { x: 0.465, y: 0.30, z: -0.20, w: 0.035, h: 0.05, d: 0.05, c: 'glow', s: 'dome' }, // headlamp L
    { x: 0.465, y: 0.30, z: 0.20, w: 0.035, h: 0.05, d: 0.05, c: 'glow', s: 'dome' },  // headlamp R
  ];
  if (turreted) {
    t.push({ x: 0.05, y: 0.70, z: 0, w: 0.24, h: 0.12, d: 0.24, c: 'mid', s: 'dome' }); // turret dome
    t.push({ x: 0.19, y: 0.71, z: -0.035, w: 0.16, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }); // twin las L
    t.push({ x: 0.19, y: 0.71, z: 0.035, w: 0.16, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 });  // twin las R
  }
  return t;
}

function predatorTable() {
  return [
    ...trackPair(0.14, 0.24, 0.90, 0.14, 0.38),
    box(0, 0.32, 0, 0.88, 0.28, 0.60, 'mid'),
    { ...box(-0.02, 0.54, 0, 0.64, 0.18, 0.46, 'mid'), tx: 0.78, shx: -0.04 }, // stepped hull top
    { ...box(0.42, 0.38, 0, 0.12, 0.30, 0.52, 'hi'), shx: -0.08 },       // angled glacis
    box(-0.05, 0.40, -0.42, 0.22, 0.14, 0.10, 'hi'),                     // sponson L
    box(-0.05, 0.40, 0.42, 0.22, 0.14, 0.10, 'hi'),                      // sponson R
    { x: 0.10, y: 0.40, z: -0.44, w: 0.20, h: 0.045, d: 0.045, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // sponson las L
    { x: 0.10, y: 0.40, z: 0.44, w: 0.20, h: 0.045, d: 0.045, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },  // sponson las R
    { ...box(0.08, 0.68, 0, 0.30, 0.14, 0.28, 'mid'), tx: 0.72, tz: 0.72 }, // tapered turret
    { x: 0.08, y: 0.76, z: 0, w: 0.18, h: 0.07, d: 0.18, c: 'hi', s: 'dome' }, // turret dome
    ...gunFwd(0.22, 0.71, 0, 0.40, 0.028, 'steel'),                      // autocannon
    box(0.00, 0.80, 0.07, 0.06, 0.045, 0.06, 'lo'),                      // hatch
  ];
}

function vindicatorTable() {
  return [
    ...trackPair(0.13, 0.22, 0.86, 0.14, 0.37),
    box(0, 0.30, 0, 0.82, 0.26, 0.58, 'mid'),
    { ...box(-0.02, 0.50, 0, 0.60, 0.16, 0.44, 'mid'), tx: 0.8 },
    { ...box(0.45, 0.20, 0, 0.12, 0.28, 0.68, 'steel'), shx: -0.10 },    // raked dozer blade
    { ...box(0.12, 0.46, 0, 0.26, 0.18, 0.32, 'mid'), tx: 0.8, shx: -0.03 }, // siege mantlet
    { x: 0.32, y: 0.46, z: 0, w: 0.16, h: 0.11, d: 0.11, c: 'dark', s: 'cyl', ax: 'x', seg: 10 }, // demolisher cannon, fat + short
    { x: 0.41, y: 0.46, z: 0, w: 0.05, h: 0.14, d: 0.14, c: 'steel', s: 'cyl', ax: 'x', seg: 10 }, // muzzle ring
    { x: -0.10, y: 0.615, z: 0, w: 0.13, h: 0.06, d: 0.13, c: 'hi', s: 'dome' }, // top hatch
  ];
}

function whirlwindTable() {
  const t = [
    ...trackPair(0.13, 0.22, 0.90, 0.14, 0.37),
    box(0, 0.32, 0, 0.86, 0.28, 0.62, 'mid'),
    { ...box(-0.02, 0.52, 0, 0.62, 0.16, 0.48, 'mid'), tx: 0.82, shx: -0.03 },
    box(-0.06, 0.63, 0, 0.44, 0.10, 0.44, 'lo'),                         // launcher turntable
    { ...box(-0.06, 0.79, 0, 0.42, 0.24, 0.34, 'lo'), rx: -0.12, tx: 0.9 }, // launcher box, elevated
  ];
  // missile tubes: fat cylinder muzzles standing proud of the launcher face
  for (const xi of [-0.18, -0.06, 0.06]) for (const zi of [-0.09, 0.09]) {
    t.push({ x: xi + 0.06, y: 0.885 + (xi + 0.18) * 0.12, z: zi, w: 0.10, h: 0.08, d: 0.10, c: 'hi', s: 'cyl', seg: 8, rx: -0.12 });
  }
  return t;
}

function landRaiderTable() {
  return [
    { ...box(0, 0.30, -0.40, 0.94, 0.50, 0.16, 'dark'), tx: 0.72 },      // full-height track L, sloped ends
    { ...box(0, 0.30, 0.40, 0.94, 0.50, 0.16, 'dark'), tx: 0.72 },       // full-height track R
    { x: 0.38, y: 0.30, z: -0.40, w: 0.24, h: 0.24, d: 0.17, c: 'steel', s: 'cyl', ax: 'z', seg: 8 }, // front sprocket L
    { x: 0.38, y: 0.30, z: 0.40, w: 0.24, h: 0.24, d: 0.17, c: 'steel', s: 'cyl', ax: 'z', seg: 8 },  // front sprocket R
    box(0, 0.42, 0, 0.80, 0.30, 0.62, 'mid'),                            // hull lower slab
    { ...box(-0.02, 0.62, 0, 0.70, 0.20, 0.50, 'mid'), tx: 0.82 },       // hull upper slab
    { ...box(0.42, 0.48, 0, 0.10, 0.38, 0.56, 'hi'), shx: -0.08 },       // angled assault ramp
    box(0.05, 0.52, -0.42, 0.24, 0.18, 0.12, 'hi'),                      // sponson pod L
    box(0.05, 0.52, 0.42, 0.24, 0.18, 0.12, 'hi'),                       // sponson pod R
    { x: 0.24, y: 0.55, z: -0.44, w: 0.20, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // lascannon L1
    { x: 0.24, y: 0.49, z: -0.44, w: 0.20, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // lascannon L2
    { x: 0.24, y: 0.55, z: 0.44, w: 0.20, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },  // lascannon R1
    { x: 0.24, y: 0.49, z: 0.44, w: 0.20, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },  // lascannon R2
    { x: -0.15, y: 0.745, z: 0, w: 0.11, h: 0.06, d: 0.11, c: 'hi', s: 'dome' }, // top hatch dome
  ];
}

function lemanRussTable() {
  return [
    ...trackPair(0.13, 0.22, 0.90, 0.14, 0.38),
    box(0, 0.30, 0, 0.88, 0.26, 0.62, 'mid'),
    { ...box(-0.06, 0.50, 0, 0.58, 0.18, 0.44, 'mid'), tx: 0.85, shx: -0.03 },
    { ...box(0.42, 0.34, 0, 0.10, 0.26, 0.56, 'hi'), shx: -0.07 },       // angled glacis
    { ...box(0.06, 0.66, 0, 0.30, 0.14, 0.28, 'mid'), tx: 0.7, tz: 0.7 }, // tapered turret
    { x: 0.06, y: 0.745, z: 0, w: 0.18, h: 0.06, d: 0.18, c: 'hi', s: 'dome' }, // cupola
    ...gunFwd(0.20, 0.70, 0, 0.42, 0.032, 'steel'),                      // battle cannon
    box(0.40, 0.38, -0.18, 0.10, 0.09, 0.09, 'mid'),                     // hull weapon housing
    { x: 0.52, y: 0.38, z: -0.18, w: 0.18, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // hull lascannon
    { x: 0.02, y: 0.80, z: 0.05, w: 0.035, h: 0.10, d: 0.035, c: 'steel', s: 'cyl' }, // pintle stubber
  ];
}

function chimeraTable(variant) {
  const t = [
    box(0, 0.28, 0, 0.84, 0.26, 0.58, 'mid'),
    { ...box(-0.04, 0.50, 0, 0.62, 0.20, 0.46, 'mid'), tx: 0.8, shx: -0.04 },
    { ...box(0.40, 0.34, 0, 0.12, 0.30, 0.50, 'hi'), shx: -0.08 },       // angled bow
    { x: 0.455, y: 0.42, z: -0.18, w: 0.035, h: 0.05, d: 0.05, c: 'glow', s: 'dome' },
    { x: 0.455, y: 0.42, z: 0.18, w: 0.035, h: 0.05, d: 0.05, c: 'glow', s: 'dome' },
  ];
  if (variant === 'wheeled') t.push(...wheelSet(0.12, 0.14, 0.36));
  else t.push(...trackPair(0.11, 0.18, 0.82, 0.13, 0.36));
  if (variant === 'basilisk') {
    t.push({ ...box(-0.10, 0.60, 0, 0.36, 0.14, 0.40, 'mid'), tx: 0.8 });          // raised casemate
    t.push({ ...box(-0.10, 0.70, 0, 0.16, 0.10, 0.20, 'dark'), rx: -0.30 });       // gun cradle, elevated
    t.push({ x: 0.20, y: 0.79, z: 0, w: 0.52, h: 0.045, d: 0.045, c: 'steel', s: 'cyl', ax: 'x', seg: 8, rx: 0, rz: -0.22 }); // earthshaker barrel, elevated
    t.push({ x: 0.45, y: 0.845, z: 0, w: 0.06, h: 0.07, d: 0.07, c: 'dark', s: 'cyl', ax: 'x', seg: 8, rz: -0.22 }); // muzzle brake
  } else {
    t.push({ x: 0.05, y: 0.64, z: 0, w: 0.20, h: 0.11, d: 0.20, c: 'mid', s: 'dome' }); // turret dome
    t.push({ x: 0.22, y: 0.65, z: 0, w: 0.22, h: 0.035, d: 0.035, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }); // multi-laser
  }
  return t;
}

function banebladeTable() {
  return [
    ...trackPair(0.14, 0.24, 0.95, 0.12, 0.42),
    box(0, 0.30, 0, 0.90, 0.26, 0.66, 'mid'),
    { ...box(-0.03, 0.50, 0, 0.72, 0.18, 0.54, 'mid'), tx: 0.85 },
    { ...box(0.44, 0.36, 0, 0.10, 0.32, 0.58, 'hi'), shx: -0.07 },       // angled glacis
    { ...box(0.05, 0.64, 0, 0.28, 0.14, 0.28, 'mid'), tx: 0.72, tz: 0.72 }, // main turret
    { x: 0.05, y: 0.725, z: 0, w: 0.16, h: 0.06, d: 0.16, c: 'hi', s: 'dome' }, // cupola
    ...gunFwd(0.19, 0.68, 0, 0.44, 0.038, 'steel'),                      // baneblade cannon
    { x: 0.30, y: 0.60, z: 0, w: 0.20, h: 0.05, d: 0.05, c: 'dark', s: 'cyl', ax: 'x', seg: 8 }, // coaxial autocannon
    { ...box(-0.28, 0.61, 0, 0.16, 0.10, 0.16, 'mid'), tx: 0.75 },       // rear secondary turret
    { x: -0.16, y: 0.63, z: 0, w: 0.16, h: 0.035, d: 0.035, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // secondary gun
    { x: 0.10, y: 0.42, z: -0.38, w: 0.18, h: 0.045, d: 0.045, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // sponson las L
    { x: 0.10, y: 0.42, z: 0.38, w: 0.18, h: 0.045, d: 0.045, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },  // sponson las R
    { x: -0.05, y: 0.72, z: 0.10, w: 0.04, h: 0.08, d: 0.04, c: 'steel', s: 'cyl' }, // pintle stormbolter
  ];
}

function trukkTable() {
  return [
    // ramshackle mismatched wheels — real cylinders, all different sizes
    { x: 0.28, y: 0.13, z: -0.36, w: 0.15, h: 0.26, d: 0.11, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    { x: 0.28, y: 0.12, z: 0.35, w: 0.14, h: 0.24, d: 0.10, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    { x: -0.28, y: 0.15, z: -0.37, w: 0.18, h: 0.30, d: 0.12, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    { x: -0.26, y: 0.14, z: 0.34, w: 0.17, h: 0.28, d: 0.12, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    box(0.02, 0.30, -0.02, 0.70, 0.18, 0.50, 'mid'),                     // open flatbed
    box(0.02, 0.40, -0.26, 0.66, 0.10, 0.04, 'lo'),                      // bed rail L
    box(0.02, 0.40, 0.24, 0.66, 0.10, 0.04, 'lo'),                       // bed rail R
    { ...box(-0.28, 0.46, -0.10, 0.24, 0.24, 0.30, 'hi'), tx: 0.75, shx: 0.05 }, // cab leaning forward
    { ...box(0.42, 0.24, 0, 0.16, 0.16, 0.30, 'steel'), tz: 0.2, shx: 0.06 },    // ram prow wedge
    { x: 0.47, y: 0.30, z: -0.12, w: 0.12, h: 0.05, d: 0.05, c: 'steel', s: 'cyl', ax: 'x', seg: 6, tp: 0 }, // spike 1
    { x: 0.47, y: 0.26, z: 0.08, w: 0.14, h: 0.05, d: 0.05, c: 'steel', s: 'cyl', ax: 'x', seg: 6, tp: 0 },  // spike 2
    { x: -0.14, y: 0.58, z: 0.20, w: 0.05, h: 0.30, d: 0.05, c: 'steel', s: 'cyl', seg: 6 }, // exhaust stack
    { x: -0.14, y: 0.74, z: 0.20, w: 0.08, h: 0.05, d: 0.08, c: 'dark', s: 'cyl', seg: 6 },  // exhaust tip
  ];
}

function battlewagonTable() {
  return [
    { x: -0.30, y: 0.14, z: -0.40, w: 0.19, h: 0.30, d: 0.14, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    { x: 0.10, y: 0.13, z: -0.42, w: 0.17, h: 0.28, d: 0.13, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    { x: -0.30, y: 0.14, z: 0.40, w: 0.18, h: 0.29, d: 0.14, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    { x: 0.10, y: 0.13, z: 0.42, w: 0.16, h: 0.27, d: 0.13, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },
    { ...box(-0.02, 0.40, 0, 0.80, 0.34, 0.60, 'mid'), tx: 1.08 },       // slab hull flaring up (looming)
    box(0.10, 0.46, 0.06, 0.30, 0.10, 0.22, 'hi'),                       // bolted armor plate
    { x: 0.45, y: 0.26, z: 0, w: 0.24, h: 0.28, d: 0.62, c: 'dark', s: 'cyl', ax: 'z', seg: 10 }, // deff rolla drum
    { x: 0.45, y: 0.26, z: 0, w: 0.26, h: 0.05, d: 0.64, c: 'steel' },   // rolla spikes band
    { ...box(-0.10, 0.68, 0.10, 0.20, 0.14, 0.20, 'mid'), tx: 0.7 },     // gun turret
    { x: 0.08, y: 0.70, z: 0.10, w: 0.26, h: 0.05, d: 0.05, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // kannon
    { x: -0.35, y: 0.66, z: -0.20, w: 0.05, h: 0.36, d: 0.05, c: 'steel', s: 'cyl', seg: 6 }, // exhaust L tall
    { x: -0.30, y: 0.58, z: 0.22, w: 0.05, h: 0.24, d: 0.05, c: 'steel', s: 'cyl', seg: 6 },  // exhaust R short
  ];
}

function dropPodTable() {
  return [
    // faceted pod: 5-segment tapered cylinder = the iconic dreadclaw cone
    { x: 0, y: 0.52, z: 0, w: 0.62, h: 0.64, d: 0.62, c: 'mid', s: 'cyl', seg: 5, tp: 0.45 },
    { x: 0, y: 0.88, z: 0, w: 0.30, h: 0.14, d: 0.30, c: 'hi', s: 'cyl', seg: 5, tp: 0.2 }, // nose cap
    { x: 0, y: 0.96, z: 0, w: 0.05, h: 0.10, d: 0.05, c: 'steel', s: 'cyl', seg: 6 },       // beacon mast
    box(0, 0.30, 0.29, 0.44, 0.06, 0.03, 'hi'),                          // hazard stripe
    // deployed door fins, tilted out
    { ...box(0.33, 0.10, 0, 0.20, 0.05, 0.26, 'hi'), rz: 0.35 },
    { ...box(-0.33, 0.10, 0, 0.20, 0.05, 0.26, 'hi'), rz: -0.35 },
    { ...box(0, 0.10, 0.33, 0.26, 0.05, 0.20, 'hi'), rx: -0.35 },
    { ...box(0, 0.10, -0.33, 0.26, 0.05, 0.20, 'hi'), rx: 0.35 },
    { x: 0.26, y: 0.10, z: -0.26, w: 0.07, h: 0.20, d: 0.07, c: 'steel', s: 'cyl', seg: 6 }, // landing strut
    { x: -0.26, y: 0.10, z: 0.26, w: 0.07, h: 0.20, d: 0.07, c: 'steel', s: 'cyl', seg: 6 }, // landing strut
  ];
}

/* --- hover chassis: table[0] is ALWAYS the skirt (glow, ground-hugging); index 1+ is the
 * hull mass proper, which is what the "hull bottom >=0.3in above base" test checks. --- */

function gravTable(kind, targetH) {
  const floor = hoverFloor(targetH);
  if (kind === 'speeder') {
    return [
      skirt(targetH, 0.7, 0.5),
      { ...box(0, floor + 0.08, 0, 0.60, 0.16, 0.36, 'mid'), tx: 0.85, shx: 0.04 },       // hull, nosing up
      { x: 0.10, y: floor + 0.17, z: 0, w: 0.26, h: 0.13, d: 0.22, c: 'hi', s: 'dome' },  // open cockpit canopy
      { x: 0.30, y: floor + 0.09, z: -0.12, w: 0.20, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },
      { x: 0.30, y: floor + 0.09, z: 0.12, w: 0.20, h: 0.04, d: 0.04, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },
      { x: -0.30, y: floor + 0.10, z: 0, w: 0.14, h: 0.10, d: 0.18, c: 'dark', s: 'cyl', ax: 'x', seg: 8 },  // rear thruster
    ];
  }
  if (kind === 'impulsor') {
    return [
      skirt(targetH, 0.82, 0.56),
      { ...box(0, floor + 0.11, 0, 0.72, 0.22, 0.52, 'mid'), shx: -0.04 },
      { ...box(-0.02, floor + 0.27, 0, 0.54, 0.14, 0.40, 'mid'), tx: 0.75, shx: -0.04 },  // sloping upper hull
      { x: 0.05, y: floor + 0.37, z: 0, w: 0.20, h: 0.09, d: 0.20, c: 'hi', s: 'dome' },  // turret dome
      { x: 0.22, y: floor + 0.375, z: 0, w: 0.18, h: 0.035, d: 0.035, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },
      { x: 0.38, y: floor + 0.20, z: -0.22, w: 0.06, h: 0.06, d: 0.06, c: 'glow', s: 'dome' }, // nacelle glow L
      { x: 0.38, y: floor + 0.20, z: 0.22, w: 0.06, h: 0.06, d: 0.06, c: 'glow', s: 'dome' },  // nacelle glow R
    ];
  }
  // 'repulsor' — larger gunship-scale grav tank
  return [
    skirt(targetH, 0.92, 0.62),
    { ...box(0, floor + 0.13, 0, 0.82, 0.26, 0.58, 'mid'), shx: -0.04 },
    { ...box(-0.02, floor + 0.31, 0, 0.60, 0.16, 0.44, 'mid'), tx: 0.78, shx: -0.05 },
    { ...box(0.06, floor + 0.43, 0, 0.24, 0.09, 0.24, 'mid'), tx: 0.7, tz: 0.7 },         // turret ring
    { x: 0.06, y: floor + 0.49, z: 0, w: 0.15, h: 0.05, d: 0.15, c: 'hi', s: 'dome' },    // turret dome
    { x: 0.28, y: floor + 0.45, z: -0.05, w: 0.24, h: 0.035, d: 0.035, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },
    { x: 0.28, y: floor + 0.45, z: 0.05, w: 0.24, h: 0.035, d: 0.035, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },
    box(-0.28, floor + 0.22, -0.26, 0.16, 0.10, 0.10, 'hi'),                              // weapon pod L
    box(-0.28, floor + 0.22, 0.26, 0.16, 0.10, 0.10, 'hi'),                               // weapon pod R
    { x: 0.42, y: floor + 0.18, z: -0.24, w: 0.05, h: 0.05, d: 0.05, c: 'glow', s: 'dome' },
    { x: 0.42, y: floor + 0.18, z: 0.24, w: 0.05, h: 0.05, d: 0.05, c: 'glow', s: 'dome' },
  ];
}

function devilfishTable(variant, targetH) {
  const floor = hoverFloor(targetH);
  const t = [
    skirt(targetH, 0.86, 0.58),
    { ...box(0, floor + 0.12, 0, 0.80, 0.24, 0.56, 'mid'), tx: 0.88, tz: 0.9, shx: 0.03 }, // smooth curved hull
    { ...box(0.02, floor + 0.28, 0, 0.56, 0.14, 0.42, 'mid'), tx: 0.7, tz: 0.75 },         // tapering upper shell
    { x: 0.36, y: floor + 0.20, z: 0, w: 0.22, h: 0.16, d: 0.30, c: 'mid', s: 'dome' },    // rounded T'au nose
    { x: 0.40, y: floor + 0.16, z: -0.235, w: 0.14, h: 0.11, d: 0.11, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // engine nacelle L
    { x: 0.40, y: floor + 0.16, z: 0.235, w: 0.14, h: 0.11, d: 0.11, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },  // engine nacelle R
    { x: -0.10, y: floor + 0.10, z: -0.30, w: 0.09, h: 0.05, d: 0.09, c: 'dark', s: 'cyl' }, // underslung drone L
    { x: -0.10, y: floor + 0.10, z: 0.30, w: 0.09, h: 0.05, d: 0.09, c: 'dark', s: 'cyl' },  // underslung drone R
  ];
  if (variant === 'hammerhead') {
    t.push({ x: 0.02, y: floor + 0.37, z: 0, w: 0.22, h: 0.10, d: 0.22, c: 'hi', s: 'dome' }); // turret pod
    t.push({ x: 0.28, y: floor + 0.385, z: 0, w: 0.42, h: 0.045, d: 0.045, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }); // railgun
    t.push({ x: 0.50, y: floor + 0.385, z: 0, w: 0.035, h: 0.065, d: 0.065, c: 'dark', s: 'cyl', ax: 'x', seg: 8 }); // rail muzzle
  } else if (variant === 'skyray') {
    t.push(box(0.02, floor + 0.335, 0, 0.34, 0.09, 0.34, 'lo'));                          // rack tray
    for (const xi of [-0.08, 0.12]) for (const zi of [-0.10, 0.10]) {
      t.push({ x: xi, y: floor + 0.44, z: zi, w: 0.09, h: 0.13, d: 0.09, c: 'hi', s: 'cyl', seg: 8, rx: -0.15 }); // missile tubes
    }
  } else {
    t.push({ x: 0.05, y: floor + 0.335, z: 0, w: 0.16, h: 0.06, d: 0.16, c: 'hi', s: 'dome' }); // plain sensor dome
  }
  return t;
}

function piranhaTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.6, 0.4),
    { ...box(0, floor + 0.09, 0, 0.50, 0.16, 0.28, 'mid'), tx: 0.8, shx: 0.05 },          // skiff hull, nose up
    { x: 0.12, y: floor + 0.18, z: 0, w: 0.22, h: 0.11, d: 0.18, c: 'hi', s: 'dome' },    // open canopy
    { x: 0.32, y: floor + 0.10, z: 0, w: 0.18, h: 0.035, d: 0.035, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // fusion blaster
    { x: -0.22, y: floor + 0.11, z: -0.18, w: 0.10, h: 0.07, d: 0.07, c: 'dark', s: 'cyl', ax: 'x', seg: 8 }, // engine L
    { x: -0.22, y: floor + 0.11, z: 0.18, w: 0.10, h: 0.07, d: 0.07, c: 'dark', s: 'cyl', ax: 'x', seg: 8 },  // engine R
    { x: -0.27, y: floor + 0.11, z: -0.18, w: 0.03, h: 0.05, d: 0.05, c: 'glow', s: 'dome' }, // engine glow L
    { x: -0.27, y: floor + 0.11, z: 0.18, w: 0.03, h: 0.05, d: 0.05, c: 'glow', s: 'dome' },  // engine glow R
  ];
}

function waveSerpentTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.80, 0.54),
    { ...box(0, floor + 0.09, 0, 0.70, 0.16, 0.50, 'mid'), tz: 0.85, shx: 0.04 },         // sleek lower hull
    { ...box(0.04, floor + 0.21, 0, 0.56, 0.14, 0.42, 'mid'), tx: 0.72, tz: 0.7, shx: 0.05 }, // swept canopy slope
    { x: 0.10, y: floor + 0.32, z: 0, w: 0.32, h: 0.12, d: 0.28, c: 'hi', s: 'dome' },    // smooth wraithbone crown
    { ...box(0.43, floor + 0.14, 0, 0.16, 0.09, 0.24, 'hi'), tz: 0.3, shx: 0.06 },        // bladed prow
    { ...box(-0.38, floor + 0.22, 0, 0.06, 0.18, 0.10, 'lo'), shx: -0.05 },               // swept tail fin
    { x: 0.02, y: floor + 0.415, z: 0, w: 0.14, h: 0.07, d: 0.14, c: 'mid', s: 'dome' },  // weapon pod
    { x: 0.16, y: floor + 0.42, z: -0.03, w: 0.18, h: 0.03, d: 0.03, c: 'steel', s: 'cyl', ax: 'x', seg: 8 }, // shuriken cannon L
    { x: 0.16, y: floor + 0.42, z: 0.03, w: 0.18, h: 0.03, d: 0.03, c: 'steel', s: 'cyl', ax: 'x', seg: 8 },  // shuriken cannon R
  ];
}

function raiderTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.72, 0.46),
    { ...box(0, floor + 0.05, 0, 0.66, 0.10, 0.42, 'mid'), tz: 0.9 },                     // open deck
    box(0, floor + 0.125, -0.20, 0.64, 0.05, 0.03, 'lo'),                                 // rail L
    box(0, floor + 0.125, 0.20, 0.64, 0.05, 0.03, 'lo'),                                  // rail R
    { ...box(0.46, floor + 0.09, 0, 0.30, 0.12, 0.12, 'hi'), tz: 0.15, shx: 0.08 },       // blade prow spike
    { x: -0.12, y: floor + 0.33, z: 0, w: 0.025, h: 0.48, d: 0.025, c: 'dark', s: 'cyl', seg: 6 }, // mast
    { ...box(-0.12, floor + 0.42, 0.01, 0.02, 0.32, 0.40, 'hi'), shz: -0.14, tz: 0.6 },   // raked blade sail
    box(-0.02, floor + 0.17, -0.08, 0.06, 0.15, 0.06, 'hi'),                              // crew silhouette
    box(0.10, floor + 0.17, 0.10, 0.06, 0.15, 0.06, 'hi'),                                // crew silhouette
    { x: -0.34, y: floor + 0.06, z: 0, w: 0.07, h: 0.06, d: 0.28, c: 'glow', s: 'cyl', ax: 'z', seg: 8 }, // engine glow bar
  ];
}

function ghostArkTable(targetH) {
  const floor = hoverFloor(targetH);
  const t = [
    skirt(targetH, 0.78, 0.30),
    { ...box(0, floor + 0.05, 0, 0.74, 0.10, 0.16, 'mid'), tx: 0.9 },                     // keel spine
    { x: 0, y: floor + 0.125, z: 0, w: 0.70, h: 0.028, d: 0.05, c: 'glow', s: 'cyl', ax: 'x', seg: 6 }, // glow conduit
    { x: 0.38, y: floor + 0.11, z: 0, w: 0.11, h: 0.11, d: 0.11, c: 'glow', s: 'dome' },  // prow orb
    { x: -0.38, y: floor + 0.11, z: 0, w: 0.11, h: 0.11, d: 0.11, c: 'glow', s: 'dome' }, // stern orb
  ];
  // curved ribcage hoops — tilted flattened cylinders instead of flat slats
  for (const xi of [-0.24, -0.08, 0.08, 0.24]) {
    t.push({ x: xi, y: floor + 0.13, z: 0, w: 0.035, h: 0.24, d: 0.52, c: 'lo', s: 'cyl', ax: 'x', seg: 8 });
  }
  return t;
}

function monolithTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.94, 0.94),
    // true tapered pyramid tiers (frustum boxes), power conduits up the faces
    { ...box(0, floor + 0.08, 0, 0.90, 0.16, 0.90, 'lo'), tx: 0.72, tz: 0.72 },
    { ...box(0, floor + 0.235, 0, 0.64, 0.15, 0.64, 'mid'), tx: 0.66, tz: 0.66 },
    { ...box(0, floor + 0.38, 0, 0.42, 0.14, 0.42, 'mid'), tx: 0.55, tz: 0.55 },
    { ...box(0, floor + 0.50, 0, 0.22, 0.10, 0.22, 'hi'), tx: 0.3, tz: 0.3 },             // apex frustum
    { x: 0, y: floor + 0.575, z: 0, w: 0.10, h: 0.09, d: 0.10, c: 'glow', s: 'dome' },    // power crystal
    { x: 0.33, y: floor + 0.23, z: 0, w: 0.05, h: 0.11, d: 0.11, c: 'glow', s: 'dome' },  // deathray eye
    { x: 0, y: floor + 0.23, z: 0.33, w: 0.11, h: 0.11, d: 0.05, c: 'glow', s: 'dome' },  // portal glow
    { x: -0.28, y: floor + 0.16, z: -0.28, w: 0.05, h: 0.20, d: 0.05, c: 'glow', s: 'cyl', seg: 6, rz: 0.5, rx: -0.5 }, // conduit
    { x: 0.28, y: floor + 0.16, z: -0.28, w: 0.05, h: 0.20, d: 0.05, c: 'glow', s: 'cyl', seg: 6, rz: -0.5, rx: -0.5 }, // conduit
  ];
}

/* ---- named monsters (priority 25) ---- */
function carnifexTable() {
  return [
    { ...box(-0.18, 0.18, 0.02, 0.20, 0.36, 0.22, 'lo'), tx: 0.8 },  // haunch L
    { ...box(0.18, 0.18, 0.02, 0.20, 0.36, 0.22, 'lo'), tx: 0.8 },   // haunch R
    { ...box(0, 0.48, 0.02, 0.44, 0.24, 0.32, 'mid'), rx: 0.15 },    // body mass, pitched
    { x: 0, y: 0.76, z: 0.02, w: 0.54, h: 0.32, d: 0.38, c: 'hi', s: 'dome' }, // carapace dome
    { x: -0.36, y: 0.56, z: 0.10, w: 0.14, h: 0.44, d: 0.16, c: 'mid', s: 'cyl', tp: 0.25, rx: 0.35 }, // scything talon L
    { x: 0.36, y: 0.56, z: 0.10, w: 0.14, h: 0.44, d: 0.16, c: 'mid', s: 'cyl', tp: 0.25, rx: 0.35 },  // scything talon R
    box(-0.38, 0.28, 0.14, 0.20, 0.18, 0.20, 'lo'),                  // forelimb base L
    box(0.38, 0.28, 0.14, 0.20, 0.18, 0.20, 'lo'),                   // forelimb base R
    { x: -0.20, y: 0.60, z: 0.24, w: 0.07, h: 0.24, d: 0.07, c: 'hi', s: 'cyl', tp: 0.2, rx: 0.45 },   // secondary limb L
    { x: 0.20, y: 0.60, z: 0.24, w: 0.07, h: 0.24, d: 0.07, c: 'hi', s: 'cyl', tp: 0.2, rx: 0.45 },    // secondary limb R
    { x: 0, y: 0.94, z: 0.14, w: 0.20, h: 0.17, d: 0.22, c: 'hi', s: 'dome' },  // head, jutting forward
    { x: 0, y: 0.88, z: -0.22, w: 0.09, h: 0.09, d: 0.24, c: 'lo', s: 'cyl', ax: 'z', tp: 0.2, rx: -0.4 }, // tail spike
  ];
}
function wingedMonsterTable() {
  return [
    { ...box(-0.11, 0.16, 0, 0.14, 0.32, 0.14, 'lo'), tx: 0.8 },
    { ...box(0.11, 0.16, 0, 0.14, 0.32, 0.14, 'lo'), tx: 0.8 },
    box(0, 0.40, 0, 0.30, 0.16, 0.22, 'mid'),
    { ...box(0, 0.64, 0.01, 0.38, 0.30, 0.26, 'hi'), tx: 1.1 },      // chest flaring up
    { x: -0.25, y: 0.755, z: 0, w: 0.16, h: 0.14, d: 0.22, c: 'mid', s: 'dome' }, // shoulder chitin L
    { x: 0.25, y: 0.755, z: 0, w: 0.16, h: 0.14, d: 0.22, c: 'mid', s: 'dome' },  // shoulder chitin R
    { x: 0, y: 0.90, z: 0.04, w: 0.17, h: 0.15, d: 0.18, c: 'hi', s: 'dome' },    // head
    { x: -0.08, y: 1.02, z: -0.04, w: 0.05, h: 0.18, d: 0.05, c: 'hi', s: 'cyl', tp: 0, rz: 0.25 },  // horn L
    { x: 0.08, y: 1.02, z: -0.04, w: 0.05, h: 0.18, d: 0.05, c: 'hi', s: 'cyl', tp: 0, rz: -0.25 },  // horn R
    // wings: swept membrane slabs, tapered to a thin lit edge
    { ...box(-0.30, 0.68, -0.06, 0.46, 0.045, 0.24, 'mid', -0.85), tz: 0.4 },  // wing L root
    { ...box(-0.58, 0.60, -0.22, 0.30, 0.03, 0.15, 'hi', -0.85), tz: 0.3 },    // wing L tip
    { ...box(0.30, 0.68, -0.06, 0.46, 0.045, 0.24, 'mid', 0.85), tz: 0.4 },    // wing R root
    { ...box(0.58, 0.60, -0.22, 0.30, 0.03, 0.15, 'hi', 0.85), tz: 0.3 },      // wing R tip
  ];
}
function serpentMonsterTable() {
  return [
    // S-curve rear: coiling segments as fat cylinders stepping up and across, tapering
    // toward a rearing dome head with a gaping maw.
    { x: 0, y: 0.15, z: 0.20, w: 0.34, h: 0.24, d: 0.34, c: 'lo', s: 'cyl', seg: 10 },
    { x: 0.05, y: 0.34, z: 0.10, w: 0.30, h: 0.24, d: 0.30, c: 'mid', s: 'cyl', seg: 10, rx: 0.15 },
    { x: -0.04, y: 0.53, z: -0.02, w: 0.27, h: 0.24, d: 0.27, c: 'mid', s: 'cyl', seg: 10, rx: 0.15 },
    { x: 0.07, y: 0.73, z: -0.12, w: 0.23, h: 0.26, d: 0.23, c: 'hi', s: 'cyl', seg: 10, rx: 0.12 },
    { x: 0.02, y: 0.92, z: -0.18, w: 0.20, h: 0.22, d: 0.20, c: 'hi', s: 'cyl', seg: 10 },
    { x: 0.06, y: 1.08, z: -0.20, w: 0.24, h: 0.17, d: 0.28, c: 'hi', s: 'dome' },        // head, rearing
    { x: 0.06, y: 1.02, z: -0.06, w: 0.14, h: 0.08, d: 0.12, c: 'lo', tx: 1.3 },          // gaping maw underjaw
    { x: -0.14, y: 0.26, z: 0.24, w: 0.07, h: 0.16, d: 0.07, c: 'lo', s: 'cyl', tp: 0.3, rx: 0.4 },  // vestigial limb L
    { x: 0.14, y: 0.26, z: 0.24, w: 0.07, h: 0.16, d: 0.07, c: 'lo', s: 'cyl', tp: 0.3, rx: 0.4 },   // vestigial limb R
    { x: 0, y: 0.12, z: 0.42, w: 0.12, h: 0.10, d: 0.30, c: 'lo', s: 'cyl', ax: 'z', tp: 0.2 },      // tail
  ];
}
function battlesuitTable() {
  return [
    { ...box(-0.16, 0.16, 0, 0.16, 0.32, 0.18, 'lo'), tx: 0.8 },     // leg L
    { ...box(0.16, 0.16, 0, 0.16, 0.32, 0.18, 'lo'), tx: 0.8 },      // leg R
    box(0, 0.42, 0, 0.30, 0.16, 0.24, 'mid'),                        // waist
    { ...box(0, 0.66, 0.01, 0.48, 0.30, 0.32, 'hi'), tx: 0.85, tz: 0.85 }, // smooth tapering torso
    { x: -0.33, y: 0.72, z: 0, w: 0.22, h: 0.20, d: 0.26, c: 'mid', s: 'dome' }, // shoulder pod L
    { x: 0.33, y: 0.72, z: 0, w: 0.22, h: 0.20, d: 0.26, c: 'mid', s: 'dome' },  // shoulder pod R
    { x: -0.33, y: 0.66, z: 0.18, w: 0.045, h: 0.045, d: 0.22, c: 'steel', s: 'cyl', ax: 'z', seg: 8 }, // burst cannon L
    { x: 0.33, y: 0.66, z: 0.18, w: 0.045, h: 0.045, d: 0.22, c: 'steel', s: 'cyl', ax: 'z', seg: 8 },  // burst cannon R
    { x: 0, y: 0.885, z: 0.06, w: 0.15, h: 0.11, d: 0.15, c: 'hi', s: 'dome' },  // sensor head
    { x: 0, y: 0.875, z: 0.135, w: 0.09, h: 0.035, d: 0.03, c: 'dark' },         // visor bar
    box(0, 0.66, -0.21, 0.24, 0.22, 0.07, 'lo'),                     // jet pack
    { x: -0.07, y: 0.55, z: -0.235, w: 0.06, h: 0.08, d: 0.06, c: 'glow', s: 'cyl' }, // thruster L
    { x: 0.07, y: 0.55, z: -0.235, w: 0.06, h: 0.08, d: 0.06, c: 'glow', s: 'cyl' },  // thruster R
    { x: 0.44, y: 0.46, z: 0, w: 0.07, h: 0.06, d: 0.07, c: 'glow', s: 'dome' },      // shield drone
  ];
}

/* ---- aircraft: thin flight stand, swept delta airframe, canopy bubble, engine pods ---- */
function aircraftTable() {
  return [
    { x: 0, y: 0.4165, z: 0, w: 0.045, h: 0.833, d: 0.045, c: 'steel', s: 'cyl', seg: 8 }, // flight stand
    { ...box(0, 0.90, 0.06, 0.16, 0.11, 0.62, 'mid'), tx: 0.7, shz: 0.02 },      // fuselage spine
    { x: 0, y: 0.905, z: 0.38, w: 0.11, h: 0.09, d: 0.22, c: 'mid', s: 'dome' }, // nose cone
    { x: 0, y: 0.955, z: 0.14, w: 0.12, h: 0.08, d: 0.20, c: 'hi', s: 'dome' },  // canopy bubble
    { ...box(-0.24, 0.895, -0.08, 0.42, 0.035, 0.30, 'hi'), shz: -0.14, tz: 0.5 }, // wing L, swept back
    { ...box(0.24, 0.895, -0.08, 0.42, 0.035, 0.30, 'hi'), shz: -0.14, tz: 0.5 },  // wing R, swept back
    { x: -0.13, y: 0.875, z: -0.16, w: 0.09, h: 0.09, d: 0.26, c: 'dark', s: 'cyl', ax: 'z', seg: 8 }, // engine pod L
    { x: 0.13, y: 0.875, z: -0.16, w: 0.09, h: 0.09, d: 0.26, c: 'dark', s: 'cyl', ax: 'z', seg: 8 },  // engine pod R
    { x: -0.13, y: 0.875, z: -0.30, w: 0.06, h: 0.06, d: 0.04, c: 'glow', s: 'dome' }, // exhaust glow L
    { x: 0.13, y: 0.875, z: -0.30, w: 0.06, h: 0.06, d: 0.04, c: 'glow', s: 'dome' },  // exhaust glow R
    { ...box(0, 0.97, -0.26, 0.03, 0.13, 0.14, 'lo'), shz: -0.06 },  // raked tail fin
  ];
}

/* ---------------------------------------------------------------------------------------
 * Walker/knight height tiers + monster height tiers.
 * ------------------------------------------------------------------------------------- */
function walkerTier(name) {
  if (/war ?dog|armiger/.test(name)) return { tier: 'wardog', targetH: 4.6 };
  if (RE_KNIGHT.test(name)) return { tier: 'knight', targetH: 6.0 };
  if (/triarch stalker/.test(name)) return { tier: 'tripod', targetH: 2.8 };
  return { tier: 'dread', targetH: 2.6 };
}

/* ---------------------------------------------------------------------------------------
 * Kit table — {id, priority, match, key, build}. register() pushes each into the shared
 * MINI_KITS registry (wp3d-1-geometry.js). KITS is also exported directly so the packet's
 * own test file can exercise routing/build without touching that shared registry.
 * ------------------------------------------------------------------------------------- */
const KITS = [
  {
    id: 'rhino', priority: 20,
    match: (t) => RE_RHINO.test(nameOf(t)),
    key: (t) => (/razorback|immolator|repressor/.test(nameOf(t)) ? 'turreted' : 'plain'),
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(rhinoTable(/razorback|immolator|repressor/.test(nameOf(t))), fp, pal, 2.3, vehOpts(pal)),
  },
  {
    id: 'predator', priority: 20,
    match: (t) => RE_PREDATOR.test(nameOf(t)),
    key: () => 'predator',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(predatorTable(), fp, pal, 2.6, vehOpts(pal)),
  },
  {
    id: 'vindicator', priority: 20,
    match: (t) => RE_VINDICATOR.test(nameOf(t)),
    key: () => 'vindicator',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(vindicatorTable(), fp, pal, 2.5, vehOpts(pal)),
  },
  {
    id: 'whirlwind', priority: 20,
    match: (t) => RE_WHIRLWIND.test(nameOf(t)),
    key: () => 'whirlwind',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(whirlwindTable(), fp, pal, 2.6, vehOpts(pal)),
  },
  {
    id: 'landraider', priority: 20,
    match: (t) => RE_LANDRAIDER.test(nameOf(t)),
    key: () => 'landraider',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(landRaiderTable(), fp, pal, 3.3, vehOpts(pal)),
  },
  {
    id: 'lemanruss', priority: 20,
    match: (t) => RE_LEMANRUSS.test(nameOf(t)),
    key: () => 'lemanruss',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(lemanRussTable(), fp, pal, 2.9, vehOpts(pal)),
  },
  {
    id: 'chimera', priority: 20,
    match: (t) => RE_CHIMERA.test(nameOf(t)) || RE_BASILISK.test(nameOf(t)),
    key: (t) => { const n = nameOf(t); return RE_BASILISK.test(n) ? 'basilisk' : (/taurox/.test(n) ? 'wheeled' : 'generic'); },
    build: (ctx, t, fp, pal) => {
      const n = nameOf(t);
      const variant = RE_BASILISK.test(n) ? 'basilisk' : (/taurox/.test(n) ? 'wheeled' : 'generic');
      return ctx.voxelsToGeometry(chimeraTable(variant), fp, pal, 2.5, vehOpts(pal));
    },
  },
  {
    id: 'baneblade', priority: 20,
    match: (t) => RE_BANEBLADE.test(nameOf(t)),
    key: () => 'baneblade',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(banebladeTable(), fp, pal, 3.6, vehOpts(pal)),
  },
  {
    id: 'trukk', priority: 20,
    match: (t) => RE_TRUKK.test(nameOf(t)),
    key: () => 'trukk',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(trukkTable(), fp, pal, 2.0, vehOpts(pal)),
  },
  {
    id: 'battlewagon', priority: 20,
    match: (t) => RE_BATTLEWAGON.test(nameOf(t)),
    key: () => 'battlewagon',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(battlewagonTable(), fp, pal, 2.9, vehOpts(pal)),
  },
  {
    id: 'droppod', priority: 20,
    match: (t) => RE_DROPPOD.test(nameOf(t)),
    key: () => 'droppod',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(dropPodTable(), fp, pal, 3.0, vehOpts(pal)),
  },
  {
    id: 'devilfish', priority: 20,
    match: (t) => RE_DEVILFISH.test(nameOf(t)),
    key: (t) => { const n = nameOf(t); return /hammerhead/.test(n) ? 'hammerhead' : (/sky ?ray/.test(n) ? 'skyray' : 'plain'); },
    build: (ctx, t, fp, pal) => {
      const n = nameOf(t);
      const variant = /hammerhead/.test(n) ? 'hammerhead' : (/sky ?ray/.test(n) ? 'skyray' : 'plain');
      return ctx.voxelsToGeometry(devilfishTable(variant, 2.2), fp, pal, 2.2, vehOpts(pal));
    },
  },
  {
    id: 'piranha', priority: 20,
    match: (t) => RE_PIRANHA.test(nameOf(t)),
    key: () => 'piranha',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(piranhaTable(1.6), fp, pal, 1.6, vehOpts(pal)),
  },
  {
    id: 'grav', priority: 20,
    match: (t) => RE_GRAV.test(nameOf(t)),
    key: (t) => { const n = nameOf(t); return /repulsor/.test(n) ? 'repulsor' : (/impulsor/.test(n) ? 'impulsor' : 'speeder'); },
    build: (ctx, t, fp, pal) => {
      const n = nameOf(t);
      const kind = /repulsor/.test(n) ? 'repulsor' : (/impulsor/.test(n) ? 'impulsor' : 'speeder');
      const targetH = kind === 'repulsor' ? 2.6 : (kind === 'impulsor' ? 2.1 : 1.6);
      return ctx.voxelsToGeometry(gravTable(kind, targetH), fp, pal, targetH, vehOpts(pal));
    },
  },
  {
    id: 'waveserpent', priority: 20,
    match: (t) => RE_WAVESERPENT.test(nameOf(t)),
    key: () => 'waveserpent',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(waveSerpentTable(2.2), fp, pal, 2.2, vehOpts(pal)),
  },
  {
    id: 'raider', priority: 20,
    match: (t) => RE_RAIDER.test(nameOf(t)),
    key: () => 'raider',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(raiderTable(1.7), fp, pal, 1.7, vehOpts(pal)),
  },
  {
    id: 'ghostark', priority: 20,
    match: (t) => RE_GHOSTARK.test(nameOf(t)),
    key: () => 'ghostark',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(ghostArkTable(2.0), fp, pal, 2.0, vehOpts(pal)),
  },
  {
    id: 'monolith', priority: 20,
    match: (t) => RE_MONOLITH.test(nameOf(t)),
    key: () => 'monolith',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(monolithTable(3.2), fp, pal, 3.2, vehOpts(pal)),
  },
  {
    id: 'walker', priority: 20,
    match: (t) => RE_WALKER_BASE.test(nameOf(t)) || RE_KNIGHT.test(nameOf(t)) || (kwOf(t).includes('VEHICLE') && kwOf(t).includes('WALKER')),
    key: (t) => walkerTier(nameOf(t)).tier,
    build: (ctx, t, fp, pal) => {
      const { tier, targetH } = walkerTier(nameOf(t));
      return ctx.voxelsToGeometry(bipedWalkerTable(tier), fp, pal, targetH, vehOpts(pal));
    },
  },
  {
    id: 'aircraft', priority: 20,
    match: (t) => kwOf(t).includes('AIRCRAFT'),
    key: () => 'aircraft',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(aircraftTable(), fp, pal, 3.0, vehOpts(pal)),
  },
  {
    id: 'monster', priority: 25,
    match: (t) => RE_MONSTER.test(nameOf(t)),
    key: (t) => monsterVariant(nameOf(t)).kind,
    build: (ctx, t, fp, pal) => {
      const { kind, targetH } = monsterVariant(nameOf(t));
      let table;
      if (kind === 'wing') table = wingedMonsterTable();
      else if (kind === 'serpent') table = serpentMonsterTable();
      else if (kind === 'battlesuit') table = battlesuitTable();
      else if (kind === 'bigwalker') table = bipedWalkerTable('knight');
      else table = carnifexTable();
      return ctx.voxelsToGeometry(table, fp, pal, targetH, vehOpts(pal));
    },
  },
];

function monsterVariant(name) {
  if (/carnifex/.test(name)) return { kind: 'bulk', targetH: 2.6 };
  if (/hive tyrant|daemon prince/.test(name)) return { kind: 'wing', targetH: 3.0 };
  if (/trygon|mawloc/.test(name)) return { kind: 'serpent', targetH: 3.2 };
  if (/riptide/.test(name)) return { kind: 'battlesuit', targetH: 3.8 };
  if (/wraithknight/.test(name)) return { kind: 'bigwalker', targetH: 6.0 };
  if (/morkanaut/.test(name)) return { kind: 'bigwalker', targetH: 5.2 };
  return { kind: 'bulk', targetH: 2.6 };
}

export function register() {
  for (const kit of KITS) registerMiniKit(kit);
}

/* Exposed for this packet's own tests only — NOT part of the WP3D-CONTRACT plug-in surface.
 * Lets wp3d-8-vehicles-tests.js exercise routing/build/determinism against real THREE geometry
 * without touching the shared MINI_KITS registry in wp3d-1-geometry.js. */
export const _test = {
  KITS, nameOf, kwOf, walkerTier, monsterVariant, hoverFloor, HOVER_CLEARANCE,
  tables: {
    rhinoTable, predatorTable, vindicatorTable, whirlwindTable, landRaiderTable, lemanRussTable,
    chimeraTable, banebladeTable, trukkTable, battlewagonTable, dropPodTable,
    gravTable, devilfishTable, piranhaTable, waveSerpentTable, raiderTable, ghostArkTable, monolithTable,
    bipedWalkerTable, carnifexTable, wingedMonsterTable, serpentMonsterTable, battlesuitTable, aircraftTable,
  },
};
