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
function tintsFor(palette) { return { steel: STEEL, glow: (palette && palette.hi) || '#9aa0a8' }; }

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
 * local x = hull LENGTH, local z = hull WIDTH). */
function trackPair(yc, h, len, gap, zOff, c) {
  return [box(0, yc, -zOff, len, h, gap, c || 'lo'), box(0, yc, zOff, len, h, gap, c || 'lo')];
}

/* Small road-wheel cluster (3 per side) for wheeled chassis (Taurox etc.) instead of tracks. */
function wheelSet(yc, r, zOff) {
  const out = [];
  for (const xi of [-0.30, 0, 0.30]) for (const zi of [-zOff, zOff]) out.push(box(xi, yc, zi, r, r * 1.5, r * 0.7, 'lo'));
  return out;
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
    box(-0.16, 0.14, 0, 0.12, 0.24, 0.14, 'lo'),   // leg L lower
    box(0.16, 0.14, 0, 0.12, 0.24, 0.14, 'lo'),    // leg R lower
    box(-0.16, 0.03, 0.04, 0.16, 0.06, 0.20, 'lo'),// foot L
    box(0.16, 0.03, 0.04, 0.16, 0.06, 0.20, 'lo'), // foot R
    box(-0.16, 0.36, 0, 0.14, 0.24, 0.16, 'mid'),  // leg L upper
    box(0.16, 0.36, 0, 0.14, 0.24, 0.16, 'mid'),   // leg R upper
    box(0, 0.50, 0, 0.34, 0.12, 0.26, 'mid'),      // hip
    box(0, 0.68, 0, 0.40, 0.24, 0.30, 'hi'),       // torso
    box(-0.24, 0.76, 0, 0.16, 0.14, 0.24, 'mid'),  // shoulder L
    box(0.24, 0.76, 0, 0.16, 0.14, 0.24, 'mid'),   // shoulder R
    box(0, 0.86, 0.05, 0.16, 0.12, 0.16, 'hi'),    // head/cockpit
    box(0.30, 0.58, 0.10, 0.10, 0.30, 0.10, 'steel'), // weapon arm
    box(0.30, 0.40, 0.20, 0.12, 0.10, 0.10, 'hi'), // fist/muzzle
  ];
  if (tier === 'knight') {
    t.push(box(0, 0.94, -0.02, 0.46, 0.06, 0.36, 'mid'));  // carapace plate
    t.push(box(-0.18, 1.05, -0.14, 0.03, 0.30, 0.03, 'mid')); // banner pole
    t.push(box(-0.18, 1.22, -0.14, 0.14, 0.16, 0.02, 'hi'));  // banner flag
  }
  if (tier === 'tripod') {
    t.push(box(0, 0.14, -0.22, 0.10, 0.24, 0.12, 'lo'));   // rear strut leg (3rd limb read)
  }
  return t;
}

/* ---------------------------------------------------------------------------------------
 * Per-chassis voxel tables. Each returns a plain box[] fed straight to voxelsToGeometry.
 * ------------------------------------------------------------------------------------- */

function rhinoTable(turreted) {
  const t = [
    ...trackPair(0.13, 0.22, 0.90, 0.14, 0.37),
    box(0, 0.32, 0, 0.86, 0.28, 0.62, 'mid'),          // hull lower
    box(-0.06, 0.55, 0, 0.62, 0.20, 0.50, 'mid'),      // hull upper (boxy roof)
    box(0.42, 0.36, 0, 0.10, 0.30, 0.56, 'hi'),        // front glacis plate
    box(-0.10, 0.68, 0, 0.16, 0.08, 0.18, 'hi'),       // iconic top hatch
    box(-0.40, 0.20, -0.30, 0.06, 0.10, 0.06, 'steel'),// exhaust L
    box(-0.40, 0.20, 0.30, 0.06, 0.10, 0.06, 'steel'), // exhaust R
    box(0.46, 0.30, -0.20, 0.03, 0.04, 0.04, 'glow'),  // headlamp L
    box(0.46, 0.30, 0.20, 0.03, 0.04, 0.04, 'glow'),   // headlamp R
  ];
  if (turreted) {
    t.push(box(0.05, 0.72, 0, 0.26, 0.10, 0.26, 'mid')); // turret base
    t.push(box(0.20, 0.75, 0, 0.20, 0.05, 0.05, 'hi'));  // stubby twin-linked barrel
  }
  return t;
}

function predatorTable() {
  return [
    ...trackPair(0.14, 0.24, 0.90, 0.14, 0.38),
    box(0, 0.32, 0, 0.88, 0.28, 0.60, 'mid'),
    box(-0.04, 0.54, 0, 0.60, 0.18, 0.46, 'mid'),
    box(-0.05, 0.38, -0.42, 0.22, 0.14, 0.10, 'hi'),   // sponson L
    box(-0.05, 0.38, 0.42, 0.22, 0.14, 0.10, 'hi'),    // sponson R
    box(0.10, 0.38, -0.48, 0.18, 0.05, 0.05, 'steel'), // sponson gun L
    box(0.10, 0.38, 0.48, 0.18, 0.05, 0.05, 'steel'),  // sponson gun R
    box(0.10, 0.68, 0, 0.30, 0.14, 0.28, 'mid'),       // turret base
    box(0.10, 0.76, 0, 0.20, 0.06, 0.20, 'hi'),        // turret top
    box(0.42, 0.72, 0, 0.42, 0.045, 0.045, 'hi'),      // main gun
    box(0.02, 0.80, 0.06, 0.07, 0.05, 0.07, 'lo'),     // hatch
  ];
}

function vindicatorTable() {
  return [
    ...trackPair(0.13, 0.22, 0.86, 0.14, 0.37),
    box(0, 0.30, 0, 0.82, 0.26, 0.58, 'mid'),
    box(-0.05, 0.50, 0, 0.56, 0.16, 0.44, 'mid'),
    box(0.46, 0.16, 0, 0.10, 0.22, 0.66, 'steel'),     // dozer blade
    box(0.10, 0.44, 0, 0.24, 0.16, 0.30, 'mid'),       // siege mantlet (no rotating turret)
    box(0.34, 0.42, 0, 0.20, 0.14, 0.14, 'hi'),        // squat wide demolisher cannon
    box(-0.10, 0.62, 0, 0.14, 0.07, 0.16, 'hi'),       // top hatch
  ];
}

function whirlwindTable() {
  const t = [
    ...trackPair(0.13, 0.22, 0.90, 0.14, 0.37),
    box(0, 0.32, 0, 0.86, 0.28, 0.62, 'mid'),
    box(-0.06, 0.52, 0, 0.60, 0.16, 0.48, 'mid'),
    box(-0.06, 0.64, 0, 0.44, 0.12, 0.44, 'lo'),       // launcher turntable base (wide, dark)
  ];
  // 3x2 grid of missile tubes standing tall above the roofline — the box the whole silhouette
  // is built around, distinct from every turreted chassis in this pack.
  for (const xi of [-0.16, -0.02, 0.12]) for (const zi of [-0.12, 0.12]) {
    t.push(box(xi, 0.86, zi, 0.10, 0.28, 0.10, 'hi'));
  }
  return t;
}

function landRaiderTable() {
  return [
    box(0, 0.30, -0.40, 0.94, 0.50, 0.16, 'lo'),       // full-height track L
    box(0, 0.30, 0.40, 0.94, 0.50, 0.16, 'lo'),        // full-height track R
    box(0, 0.42, 0, 0.80, 0.30, 0.62, 'mid'),          // hull lower slab
    box(-0.05, 0.62, 0, 0.66, 0.20, 0.50, 'mid'),      // hull upper slab
    box(0.42, 0.46, 0, 0.10, 0.36, 0.56, 'hi'),        // front ramp/glacis
    box(0.05, 0.50, -0.40, 0.22, 0.16, 0.14, 'hi'),    // sponson L
    box(0.05, 0.50, 0.40, 0.22, 0.16, 0.14, 'hi'),     // sponson R
    box(0.20, 0.50, -0.46, 0.16, 0.05, 0.05, 'steel'), // sponson gun L
    box(0.20, 0.50, 0.46, 0.16, 0.05, 0.05, 'steel'),  // sponson gun R
    box(-0.15, 0.75, 0, 0.10, 0.06, 0.10, 'hi'),       // top hatch / searchlight
  ];
}

function lemanRussTable() {
  return [
    ...trackPair(0.13, 0.22, 0.90, 0.14, 0.38),
    box(0, 0.30, 0, 0.88, 0.26, 0.62, 'mid'),
    box(-0.08, 0.50, 0, 0.56, 0.18, 0.44, 'mid'),
    box(0.06, 0.66, 0, 0.30, 0.14, 0.28, 'mid'),       // turret base
    box(0.06, 0.74, 0, 0.20, 0.06, 0.20, 'hi'),        // turret top
    box(0.42, 0.70, 0, 0.42, 0.06, 0.06, 'hi'),        // main battle cannon
    box(0.40, 0.36, -0.18, 0.10, 0.08, 0.08, 'mid'),   // hull sponson housing (front-left)
    box(0.48, 0.36, -0.18, 0.24, 0.055, 0.055, 'steel'), // hull lascannon barrel — clearly forward of the glacis
    box(0.02, 0.80, 0.05, 0.06, 0.05, 0.06, 'steel'),  // pintle weapon
  ];
}

function chimeraTable(variant) {
  const t = [
    box(0, 0.28, 0, 0.84, 0.26, 0.58, 'mid'),
    box(-0.06, 0.50, 0, 0.60, 0.20, 0.46, 'mid'),
    box(0.40, 0.32, 0, 0.10, 0.28, 0.52, 'hi'),
    box(0.44, 0.40, -0.18, 0.03, 0.04, 0.04, 'glow'),
    box(0.44, 0.40, 0.18, 0.03, 0.04, 0.04, 'glow'),
  ];
  if (variant === 'wheeled') t.push(...wheelSet(0.10, 0.15, 0.36));
  else t.push(...trackPair(0.11, 0.18, 0.82, 0.13, 0.36));
  if (variant === 'basilisk') {
    t.push(box(-0.10, 0.62, 0, 0.36, 0.16, 0.40, 'mid'));   // raised casemate
    t.push(box(0.36, 0.68, 0, 0.62, 0.05, 0.05, 'hi'));     // long artillery barrel
  } else {
    t.push(box(0.05, 0.64, 0, 0.20, 0.10, 0.20, 'mid'));    // turret
    t.push(box(0.30, 0.64, 0, 0.26, 0.04, 0.04, 'hi'));     // hull weapon
  }
  return t;
}

function banebladeTable() {
  return [
    ...trackPair(0.14, 0.24, 0.95, 0.12, 0.42),
    box(0, 0.30, 0, 0.90, 0.26, 0.66, 'mid'),
    box(-0.05, 0.50, 0, 0.70, 0.18, 0.54, 'mid'),
    box(0.44, 0.34, 0, 0.08, 0.30, 0.60, 'hi'),        // front glacis
    box(0.05, 0.64, 0, 0.26, 0.14, 0.26, 'mid'),       // main turret base
    box(0.34, 0.68, 0, 0.46, 0.07, 0.07, 'hi'),        // main cannon
    box(-0.28, 0.62, 0, 0.16, 0.10, 0.16, 'mid'),      // secondary turret (rear)
    box(-0.10, 0.62, 0, 0.20, 0.04, 0.04, 'steel'),    // secondary gun
    box(0.05, 0.42, -0.36, 0.16, 0.05, 0.05, 'steel'), // sponson lascannon L
    box(0.05, 0.42, 0.36, 0.16, 0.05, 0.05, 'steel'),  // sponson lascannon R
    box(-0.05, 0.72, 0.10, 0.06, 0.05, 0.06, 'lo'),    // pintle stormbolter
  ];
}

function trukkTable() {
  return [
    box(-0.22, 0.10, -0.36, 0.16, 0.20, 0.12, 'lo'),   // wheel FL (asymmetric ramshackle sizes)
    box(0.24, 0.09, 0.34, 0.15, 0.18, 0.11, 'lo'),     // wheel FR
    box(-0.32, 0.10, -0.38, 0.14, 0.19, 0.10, 'lo'),   // wheel RL
    box(0.30, 0.11, 0.32, 0.17, 0.21, 0.13, 'lo'),     // wheel RR
    box(0.02, 0.30, -0.02, 0.70, 0.20, 0.50, 'mid'),   // open deck, off-center
    box(-0.30, 0.42, -0.10, 0.22, 0.20, 0.30, 'hi'),   // cab, offset to one side
    box(0.42, 0.20, -0.15, 0.14, 0.10, 0.06, 'steel'), // ram spike 1
    box(0.44, 0.24, 0.05, 0.16, 0.08, 0.05, 'steel'),  // ram spike 2
    box(0.40, 0.16, 0.20, 0.12, 0.09, 0.06, 'steel'),  // ram spike 3
    box(-0.15, 0.55, 0.20, 0.05, 0.35, 0.05, 'steel'), // off-center exhaust stack
  ];
}

function battlewagonTable() {
  return [
    box(-0.30, 0.11, -0.40, 0.20, 0.24, 0.14, 'lo'),
    box(0.10, 0.10, -0.42, 0.18, 0.22, 0.13, 'lo'),
    box(-0.30, 0.11, 0.40, 0.19, 0.23, 0.14, 'lo'),
    box(0.10, 0.10, 0.42, 0.17, 0.21, 0.13, 'lo'),
    box(0, 0.40, 0, 0.80, 0.34, 0.60, 'mid'),          // big boxy slab hull
    box(0.10, 0.44, 0.06, 0.30, 0.10, 0.20, 'hi'),     // bolted plate (ramshackle texture)
    box(0.46, 0.30, 0, 0.14, 0.34, 0.60, 'steel'),     // deff rolla drum
    box(-0.10, 0.66, 0.10, 0.20, 0.14, 0.20, 'mid'),   // off-center gun turret
    box(0.05, 0.66, 0.10, 0.30, 0.05, 0.05, 'hi'),     // barrel
    box(-0.35, 0.62, -0.20, 0.05, 0.30, 0.05, 'steel'),// exhaust L (uneven height)
    box(-0.30, 0.55, 0.22, 0.05, 0.20, 0.05, 'steel'), // exhaust R (uneven height)
  ];
}

function dropPodTable() {
  return [
    box(0, 0.55, 0, 0.55, 0.70, 0.55, 'mid'),
    box(0, 0.94, 0, 0.35, 0.10, 0.35, 'hi'),
    box(0, 0.30, 0.28, 0.50, 0.06, 0.02, 'hi'),        // hazard stripe
    box(0.30, 0.10, 0.30, 0.08, 0.20, 0.08, 'steel'),
    box(-0.30, 0.10, 0.30, 0.08, 0.20, 0.08, 'steel'),
    box(0.30, 0.10, -0.30, 0.08, 0.20, 0.08, 'steel'),
    box(-0.30, 0.10, -0.30, 0.08, 0.20, 0.08, 'steel'),
  ];
}

/* --- hover chassis: table[0] is ALWAYS the skirt (glow, ground-hugging); index 1+ is the
 * hull mass proper, which is what the "hull bottom >=0.3in above base" test checks. --- */

function gravTable(kind, targetH) {
  const floor = hoverFloor(targetH);
  if (kind === 'speeder') {
    return [
      skirt(targetH, 0.7, 0.5),
      box(0, floor + 0.08, 0, 0.60, 0.16, 0.36, 'mid'),
      box(0, floor + 0.16, 0.15, 0.24, 0.14, 0.20, 'hi'),   // cockpit
      box(0.30, floor + 0.08, -0.12, 0.18, 0.04, 0.04, 'steel'),
      box(0.30, floor + 0.08, 0.12, 0.18, 0.04, 0.04, 'steel'),
    ];
  }
  if (kind === 'impulsor') {
    return [
      skirt(targetH, 0.82, 0.56),
      box(0, floor + 0.11, 0, 0.72, 0.22, 0.52, 'mid'),
      box(-0.04, floor + 0.27, 0, 0.50, 0.14, 0.40, 'mid'),
      box(0.05, floor + 0.37, 0, 0.20, 0.08, 0.20, 'hi'),   // small turret
      box(0.24, floor + 0.37, 0, 0.16, 0.04, 0.04, 'steel'),
      box(0.38, floor + 0.20, -0.22, 0.05, 0.05, 0.05, 'glow'), // nacelle glow L
      box(0.38, floor + 0.20, 0.22, 0.05, 0.05, 0.05, 'glow'),  // nacelle glow R
    ];
  }
  // 'repulsor' — larger gunship-scale grav tank
  return [
    skirt(targetH, 0.92, 0.62),
    box(0, floor + 0.13, 0, 0.82, 0.26, 0.58, 'mid'),
    box(-0.04, floor + 0.31, 0, 0.58, 0.16, 0.44, 'mid'),
    box(0.06, floor + 0.44, 0, 0.24, 0.10, 0.24, 'hi'),   // turret
    box(0.26, floor + 0.44, -0.10, 0.20, 0.04, 0.04, 'steel'),
    box(0.26, floor + 0.44, 0.10, 0.20, 0.04, 0.04, 'steel'),
    box(-0.28, floor + 0.20, -0.26, 0.16, 0.10, 0.10, 'hi'), // weapon pod L
    box(-0.28, floor + 0.20, 0.26, 0.16, 0.10, 0.10, 'hi'),  // weapon pod R
    box(0.42, floor + 0.18, -0.24, 0.04, 0.04, 0.04, 'glow'),
    box(0.42, floor + 0.18, 0.24, 0.04, 0.04, 0.04, 'glow'),
  ];
}

function devilfishTable(variant, targetH) {
  const floor = hoverFloor(targetH);
  const t = [
    skirt(targetH, 0.86, 0.58),
    box(0, floor + 0.12, 0, 0.80, 0.24, 0.56, 'mid'),
    box(-0.02, floor + 0.28, 0, 0.56, 0.14, 0.42, 'mid'),
    box(0.40, floor + 0.14, -0.20, 0.10, 0.10, 0.10, 'steel'), // engine nacelle L
    box(0.40, floor + 0.14, 0.20, 0.10, 0.10, 0.10, 'steel'),  // engine nacelle R
    box(-0.10, floor + 0.10, -0.30, 0.08, 0.06, 0.08, 'lo'),   // underslung drone L
    box(-0.10, floor + 0.10, 0.30, 0.08, 0.06, 0.08, 'lo'),    // underslung drone R
  ];
  if (variant === 'hammerhead') {
    t.push(box(0.02, floor + 0.38, 0, 0.24, 0.10, 0.24, 'hi'));
    t.push(box(0.40, floor + 0.38, 0, 0.50, 0.06, 0.06, 'hi')); // railgun, long
  } else if (variant === 'skyray') {
    t.push(box(0.02, floor + 0.34, 0, 0.34, 0.10, 0.34, 'lo')); // missile rack base (dark tray)
    // 2x2 grid of standing missile tubes — reads as a distinct rack vs hammerhead's single
    // long railgun barrel or devilfish's plain turretless hull.
    for (const xi of [-0.08, 0.12]) for (const zi of [-0.10, 0.10]) t.push(box(xi, floor + 0.46, zi, 0.09, 0.14, 0.09, 'hi'));
  } else {
    t.push(box(0.05, floor + 0.34, 0, 0.16, 0.06, 0.16, 'hi')); // plain hull, no turret
  }
  return t;
}

function piranhaTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.6, 0.4),
    box(0, floor + 0.09, 0, 0.50, 0.16, 0.28, 'mid'),
    box(0.10, floor + 0.17, 0, 0.20, 0.10, 0.16, 'hi'),
    box(0.30, floor + 0.09, -0.12, 0.16, 0.04, 0.04, 'steel'),
    box(-0.20, floor + 0.10, -0.20, 0.04, 0.04, 0.04, 'glow'),
    box(-0.20, floor + 0.10, 0.20, 0.04, 0.04, 0.04, 'glow'),
  ];
}

function waveSerpentTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.80, 0.54),
    box(0, floor + 0.09, 0, 0.70, 0.16, 0.50, 'mid'),
    box(0.02, floor + 0.21, 0, 0.54, 0.14, 0.42, 'mid'),
    box(0.04, floor + 0.32, 0, 0.36, 0.12, 0.32, 'hi'),
    box(0.42, floor + 0.15, 0, 0.14, 0.10, 0.20, 'hi'),   // prow taper
    box(-0.38, floor + 0.20, 0, 0.06, 0.16, 0.10, 'lo'),  // tail fin
    box(0.05, floor + 0.42, 0, 0.18, 0.08, 0.18, 'mid'),  // weapon pod
    box(0.20, floor + 0.42, 0, 0.18, 0.04, 0.04, 'steel'),
  ];
}

function raiderTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.72, 0.46),
    box(0, floor + 0.05, 0, 0.66, 0.10, 0.42, 'mid'),      // open flat deck
    box(0, floor + 0.13, -0.20, 0.66, 0.06, 0.03, 'lo'),   // rail L
    box(0, floor + 0.13, 0.20, 0.66, 0.06, 0.03, 'lo'),    // rail R
    box(0.48, floor + 0.08, 0, 0.28, 0.14, 0.14, 'hi'),    // prow blade — long forward spike
    box(-0.10, floor + 0.17, -0.08, 0.06, 0.16, 0.06, 'hi'), // crew silhouette
    box(0.05, floor + 0.17, 0.10, 0.06, 0.16, 0.06, 'hi'),   // crew silhouette
    box(-0.36, floor + 0.05, 0, 0.06, 0.06, 0.30, 'glow'), // engine glow
  ];
}

function ghostArkTable(targetH) {
  const floor = hoverFloor(targetH);
  const t = [
    skirt(targetH, 0.78, 0.30),
    box(0, floor + 0.05, 0, 0.74, 0.10, 0.16, 'mid'),  // spine
    box(0, floor + 0.13, 0, 0.70, 0.03, 0.05, 'glow'), // glow strip
    box(0.38, floor + 0.10, 0, 0.10, 0.10, 0.10, 'glow'), // pod end 1
    box(-0.38, floor + 0.10, 0, 0.10, 0.10, 0.10, 'glow'), // pod end 2
  ];
  for (const xi of [-0.24, -0.08, 0.08, 0.24]) t.push(box(xi, floor + 0.10, 0, 0.04, 0.20, 0.50, 'lo')); // ribs
  return t;
}

function monolithTable(targetH) {
  const floor = hoverFloor(targetH);
  return [
    skirt(targetH, 0.94, 0.94),
    box(0, floor + 0.07, 0, 0.90, 0.14, 0.90, 'lo'),   // pyramid layer 1
    box(0, floor + 0.21, 0, 0.66, 0.14, 0.66, 'mid'),  // layer 2
    box(0, floor + 0.35, 0, 0.42, 0.14, 0.42, 'mid'),  // layer 3
    box(0, floor + 0.49, 0, 0.18, 0.14, 0.18, 'hi'),   // apex
    box(0.30, floor + 0.21, 0, 0.04, 0.10, 0.10, 'glow'), // deathray eye
  ];
}

/* ---- named monsters (priority 25) ---- */
function carnifexTable() {
  return [
    box(-0.18, 0.18, 0.02, 0.20, 0.36, 0.22, 'lo'),
    box(0.18, 0.18, 0.02, 0.20, 0.36, 0.22, 'lo'),
    box(0, 0.48, 0, 0.44, 0.24, 0.32, 'mid'),
    box(0, 0.76, 0.02, 0.52, 0.30, 0.36, 'hi'),
    box(-0.36, 0.56, 0.06, 0.17, 0.46, 0.19, 'mid'),   // main scything talon L
    box(0.36, 0.56, 0.06, 0.17, 0.46, 0.19, 'mid'),    // main scything talon R
    box(-0.38, 0.28, 0.12, 0.20, 0.18, 0.20, 'lo'),
    box(0.38, 0.28, 0.12, 0.20, 0.18, 0.20, 'lo'),
    box(-0.20, 0.60, 0.22, 0.08, 0.24, 0.08, 'hi'),    // secondary forelimb L (the 4th limb)
    box(0.20, 0.60, 0.22, 0.08, 0.24, 0.08, 'hi'),     // secondary forelimb R
    box(0, 0.96, 0.10, 0.22, 0.18, 0.20, 'hi'),        // head
    box(0, 0.90, -0.20, 0.10, 0.20, 0.14, 'lo'),       // tail spike
  ];
}
function wingedMonsterTable() {
  return [
    box(-0.11, 0.16, 0, 0.14, 0.32, 0.14, 'lo'),
    box(0.11, 0.16, 0, 0.14, 0.32, 0.14, 'lo'),
    box(0, 0.40, 0, 0.30, 0.16, 0.22, 'mid'),
    box(0, 0.64, 0, 0.36, 0.30, 0.26, 'hi'),
    box(-0.24, 0.72, 0, 0.15, 0.16, 0.20, 'mid'),
    box(0.24, 0.72, 0, 0.15, 0.16, 0.20, 'mid'),
    box(0, 0.90, 0.03, 0.18, 0.16, 0.18, 'hi'),
    box(-0.10, 1.02, -0.05, 0.05, 0.18, 0.05, 'hi'),   // horn/crest
    // wings: root slab + a tapered outer tip continuing the same sweep, both yawed hard via
    // ry so the long edge reads as swept-back membrane rather than a straight side-arm.
    box(-0.30, 0.68, -0.06, 0.46, 0.045, 0.24, 'mid', -0.85),  // wing L root
    box(-0.58, 0.60, -0.22, 0.30, 0.03, 0.15, 'hi', -0.85),    // wing L tip (tapered, lit edge)
    box(0.30, 0.68, -0.06, 0.46, 0.045, 0.24, 'mid', 0.85),    // wing R root
    box(0.58, 0.60, -0.22, 0.30, 0.03, 0.15, 'hi', 0.85),      // wing R tip (tapered, lit edge)
  ];
}
function serpentMonsterTable() {
  return [
    // S-curve rear: each segment steps up AND sideways (alternating x), reading as a coiling
    // body rearing out of the ground rather than a straight totem-pole stack.
    box(0, 0.15, 0.20, 0.32, 0.22, 0.32, 'lo'),
    box(0.05, 0.34, 0.10, 0.28, 0.22, 0.28, 'mid'),
    box(-0.04, 0.53, -0.02, 0.25, 0.22, 0.25, 'mid'),
    box(0.07, 0.73, -0.12, 0.21, 0.24, 0.21, 'hi'),
    box(0.02, 0.92, -0.20, 0.19, 0.20, 0.19, 'hi'),
    box(0.08, 1.08, -0.24, 0.22, 0.16, 0.26, 'hi'),    // head/maw, rearing high and forward
    box(-0.14, 0.24, 0.22, 0.08, 0.16, 0.08, 'lo'),    // vestigial limb L
    box(0.14, 0.24, 0.22, 0.08, 0.16, 0.08, 'lo'),     // vestigial limb R
    box(0, 0.10, 0.40, 0.14, 0.10, 0.32, 'lo'),        // tail
  ];
}
function battlesuitTable() {
  return [
    box(-0.16, 0.16, 0, 0.16, 0.32, 0.18, 'lo'),
    box(0.16, 0.16, 0, 0.16, 0.32, 0.18, 'lo'),
    box(0, 0.42, 0, 0.30, 0.16, 0.24, 'mid'),
    box(0, 0.66, 0, 0.48, 0.30, 0.32, 'hi'),
    box(-0.32, 0.68, 0, 0.20, 0.24, 0.24, 'mid'),      // shoulder pod L
    box(0.32, 0.68, 0, 0.20, 0.24, 0.24, 'mid'),       // shoulder pod R
    box(-0.32, 0.68, 0.16, 0.20, 0.04, 0.04, 'steel'),
    box(0.32, 0.68, 0.16, 0.20, 0.04, 0.04, 'steel'),
    box(0, 0.90, 0.06, 0.16, 0.12, 0.16, 'hi'),        // sensor head
    box(0, 0.66, -0.20, 0.10, 0.22, 0.06, 'lo'),       // jet pack
    box(0.44, 0.44, 0, 0.06, 0.06, 0.06, 'glow'),      // underslung drone
  ];
}

/* ---- aircraft: thin flight stand ---- */
function aircraftTable() {
  return [
    box(0, 0.4165, 0, 0.06, 0.833, 0.06, 'steel'),     // 2.5in post (of a 3.0in total height)
    box(0, 0.90, 0.05, 0.42, 0.10, 0.50, 'mid'),       // fuselage
    box(0, 0.90, -0.06, 0.90, 0.04, 0.28, 'hi'),       // wings
    box(0, 0.95, -0.22, 0.06, 0.10, 0.10, 'lo'),       // tail fin
    box(0, 0.90, 0.30, 0.10, 0.08, 0.10, 'hi'),        // nose
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
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(rhinoTable(/razorback|immolator|repressor/.test(nameOf(t))), fp, pal, 2.3, { tints: tintsFor(pal) }),
  },
  {
    id: 'predator', priority: 20,
    match: (t) => RE_PREDATOR.test(nameOf(t)),
    key: () => 'predator',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(predatorTable(), fp, pal, 2.6, { tints: tintsFor(pal) }),
  },
  {
    id: 'vindicator', priority: 20,
    match: (t) => RE_VINDICATOR.test(nameOf(t)),
    key: () => 'vindicator',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(vindicatorTable(), fp, pal, 2.5, { tints: tintsFor(pal) }),
  },
  {
    id: 'whirlwind', priority: 20,
    match: (t) => RE_WHIRLWIND.test(nameOf(t)),
    key: () => 'whirlwind',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(whirlwindTable(), fp, pal, 2.6, { tints: tintsFor(pal) }),
  },
  {
    id: 'landraider', priority: 20,
    match: (t) => RE_LANDRAIDER.test(nameOf(t)),
    key: () => 'landraider',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(landRaiderTable(), fp, pal, 3.3, { tints: tintsFor(pal) }),
  },
  {
    id: 'lemanruss', priority: 20,
    match: (t) => RE_LEMANRUSS.test(nameOf(t)),
    key: () => 'lemanruss',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(lemanRussTable(), fp, pal, 2.9, { tints: tintsFor(pal) }),
  },
  {
    id: 'chimera', priority: 20,
    match: (t) => RE_CHIMERA.test(nameOf(t)) || RE_BASILISK.test(nameOf(t)),
    key: (t) => { const n = nameOf(t); return RE_BASILISK.test(n) ? 'basilisk' : (/taurox/.test(n) ? 'wheeled' : 'generic'); },
    build: (ctx, t, fp, pal) => {
      const n = nameOf(t);
      const variant = RE_BASILISK.test(n) ? 'basilisk' : (/taurox/.test(n) ? 'wheeled' : 'generic');
      return ctx.voxelsToGeometry(chimeraTable(variant), fp, pal, 2.5, { tints: tintsFor(pal) });
    },
  },
  {
    id: 'baneblade', priority: 20,
    match: (t) => RE_BANEBLADE.test(nameOf(t)),
    key: () => 'baneblade',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(banebladeTable(), fp, pal, 3.6, { tints: tintsFor(pal) }),
  },
  {
    id: 'trukk', priority: 20,
    match: (t) => RE_TRUKK.test(nameOf(t)),
    key: () => 'trukk',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(trukkTable(), fp, pal, 2.0, { tints: tintsFor(pal) }),
  },
  {
    id: 'battlewagon', priority: 20,
    match: (t) => RE_BATTLEWAGON.test(nameOf(t)),
    key: () => 'battlewagon',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(battlewagonTable(), fp, pal, 2.9, { tints: tintsFor(pal) }),
  },
  {
    id: 'droppod', priority: 20,
    match: (t) => RE_DROPPOD.test(nameOf(t)),
    key: () => 'droppod',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(dropPodTable(), fp, pal, 3.0, { tints: tintsFor(pal), noBase: false }),
  },
  {
    id: 'devilfish', priority: 20,
    match: (t) => RE_DEVILFISH.test(nameOf(t)),
    key: (t) => { const n = nameOf(t); return /hammerhead/.test(n) ? 'hammerhead' : (/sky ?ray/.test(n) ? 'skyray' : 'plain'); },
    build: (ctx, t, fp, pal) => {
      const n = nameOf(t);
      const variant = /hammerhead/.test(n) ? 'hammerhead' : (/sky ?ray/.test(n) ? 'skyray' : 'plain');
      return ctx.voxelsToGeometry(devilfishTable(variant, 2.2), fp, pal, 2.2, { tints: tintsFor(pal) });
    },
  },
  {
    id: 'piranha', priority: 20,
    match: (t) => RE_PIRANHA.test(nameOf(t)),
    key: () => 'piranha',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(piranhaTable(1.6), fp, pal, 1.6, { tints: tintsFor(pal) }),
  },
  {
    id: 'grav', priority: 20,
    match: (t) => RE_GRAV.test(nameOf(t)),
    key: (t) => { const n = nameOf(t); return /repulsor/.test(n) ? 'repulsor' : (/impulsor/.test(n) ? 'impulsor' : 'speeder'); },
    build: (ctx, t, fp, pal) => {
      const n = nameOf(t);
      const kind = /repulsor/.test(n) ? 'repulsor' : (/impulsor/.test(n) ? 'impulsor' : 'speeder');
      const targetH = kind === 'repulsor' ? 2.6 : (kind === 'impulsor' ? 2.1 : 1.6);
      return ctx.voxelsToGeometry(gravTable(kind, targetH), fp, pal, targetH, { tints: tintsFor(pal) });
    },
  },
  {
    id: 'waveserpent', priority: 20,
    match: (t) => RE_WAVESERPENT.test(nameOf(t)),
    key: () => 'waveserpent',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(waveSerpentTable(2.2), fp, pal, 2.2, { tints: tintsFor(pal) }),
  },
  {
    id: 'raider', priority: 20,
    match: (t) => RE_RAIDER.test(nameOf(t)),
    key: () => 'raider',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(raiderTable(1.7), fp, pal, 1.7, { tints: tintsFor(pal) }),
  },
  {
    id: 'ghostark', priority: 20,
    match: (t) => RE_GHOSTARK.test(nameOf(t)),
    key: () => 'ghostark',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(ghostArkTable(2.0), fp, pal, 2.0, { tints: tintsFor(pal) }),
  },
  {
    id: 'monolith', priority: 20,
    match: (t) => RE_MONOLITH.test(nameOf(t)),
    key: () => 'monolith',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(monolithTable(3.2), fp, pal, 3.2, { tints: tintsFor(pal) }),
  },
  {
    id: 'walker', priority: 20,
    match: (t) => RE_WALKER_BASE.test(nameOf(t)) || RE_KNIGHT.test(nameOf(t)) || (kwOf(t).includes('VEHICLE') && kwOf(t).includes('WALKER')),
    key: (t) => walkerTier(nameOf(t)).tier,
    build: (ctx, t, fp, pal) => {
      const { tier, targetH } = walkerTier(nameOf(t));
      return ctx.voxelsToGeometry(bipedWalkerTable(tier), fp, pal, targetH, { tints: tintsFor(pal) });
    },
  },
  {
    id: 'aircraft', priority: 20,
    match: (t) => kwOf(t).includes('AIRCRAFT'),
    key: () => 'aircraft',
    build: (ctx, t, fp, pal) => ctx.voxelsToGeometry(aircraftTable(), fp, pal, 3.0, { tints: tintsFor(pal) }),
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
      return ctx.voxelsToGeometry(table, fp, pal, targetH, { tints: tintsFor(pal) });
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
