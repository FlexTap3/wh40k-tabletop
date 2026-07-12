// WP3D-8 vehicle/monster kit pack tests: run via `node wp3d-8-vehicles-tests.js` from
// tools/tests/. Plain node, no DOM/WebGL (three.js core objects construct fine headless).
// Exercises the KITS table exported at wp3d-8-vehicles.js's `_test` hook directly — this
// packet owns only that file (+ this test file), so routing/build/determinism are checked
// against its own exports rather than the shared MINI_KITS registry in wp3d-1-geometry.js
// (which wp3d-1-geometry-tests.js already covers generically).
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.01 : tol);

  const THREE = await import("../../vendor/three.module.min.js");
  const G = await import("../../sections/wp3d-1-geometry.js");
  const V = await import("../../sections/wp3d-8-vehicles.js");
  const { voxelsToGeometry, mergeGeometries, wp3dHash, wp3dRng } = G;
  const { KITS, walkerTier, monsterVariant, hoverFloor, HOVER_CLEARANCE, tables } = V._test;

  const ctx = { THREE, bridge: {}, hash: wp3dHash, rng: wp3dRng, mergeGeometries, voxelsToGeometry };
  const SM = { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' };
  const TAU = { hi: '#dcae66', mid: '#9a6c2e', lo: '#442e10' };
  const TYR = { hi: '#c0a088', mid: '#6e4470', lo: '#2e1830' };
  const NEC = { hi: '#48d868', mid: '#1c6434', lo: '#0a2412' };
  const ORK = { hi: '#8cbc4c', mid: '#4a7626', lo: '#1e360e' };
  const AE = { hi: '#72d0c0', mid: '#2a8078', lo: '#0e3834' };

  const rectFp = (wIn, hIn) => ({ shape: 'r', wIn, hIn });
  const circleFp = (dmm) => ({ shape: 'c', dmm: dmm || 32 });

  /* Local replica of kitFor()'s "highest priority match wins" selection, scoped to THIS
   * packet's own KITS array (mirrors wp3d-1-geometry.js's private registry logic exactly,
   * without needing to touch that shared module-level registry from a test). */
  const sorted = KITS.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  function kitForToken(token) {
    for (const k of sorted) { let m = false; try { m = !!k.match(token); } catch (e) {} if (m) return k; }
    return null;
  }
  function kitForName(name, kw) { return kitForToken({ name, kw: kw || [] }); }

  // ==================================================================
  console.log("== KITS: shape + priority sanity ==");
  assert(Array.isArray(KITS) && KITS.length >= 20, "KITS has >=20 registered chassis kits, got " + KITS.length);
  for (const k of KITS) {
    assert(typeof k.id === 'string' && k.id.length > 0, k.id + ": has string id");
    assert(k.priority === 20 || k.priority === 25, k.id + ": priority is 20 (vehicle) or 25 (monster), got " + k.priority);
    assert(typeof k.match === 'function' && typeof k.key === 'function' && typeof k.build === 'function', k.id + ": has match/key/build functions");
  }
  const monsterKit = KITS.find(k => k.id === 'monster');
  assert(monsterKit && monsterKit.priority === 25, "monster kit is priority 25 (beats generic walker on overlap)");
  const ids = new Set(KITS.map(k => k.id));
  assert(ids.size === KITS.length, "every kit id is unique");

  // ==================================================================
  console.log("== routing: name -> expected kit id (every WP21_HULLS family + extras) ==");
  const ROUTES = [
    // SM tracked
    ["Rhino", null, "rhino"], ["Razorback", null, "rhino"],
    ["Predator Destructor", null, "predator"], ["Sicaran Battle Tank", null, "predator"],
    ["Hunter", null, "predator"], ["Stalker", null, "predator"],
    ["Vindicator", null, "vindicator"],
    ["Whirlwind", null, "whirlwind"], ["Exorcist", null, "whirlwind"],
    ["Land Raider Crusader", null, "landraider"], ["Spartan Assault Tank", null, "landraider"],
    ["Kratos Heavy Battle Tank", null, "landraider"], ["Cerberus Heavy Tank Destroyer", null, "landraider"],
    ["Crassus Armoured Transport", null, "landraider"], ["Hekaton Land Fortress", null, "landraider"],
    // SM grav
    ["Land Speeder", null, "grav"], ["Repulsor Executioner", null, "grav"], ["Impulsor", null, "grav"],
    // Guard
    ["Leman Russ Battle Tank", null, "lemanruss"], ["Rogal Dorn Battle Tank", null, "lemanruss"],
    ["Malcador Defender", null, "lemanruss"], ["Valdor Tank Hunter", null, "lemanruss"],
    ["Minotaur Artillery Tank", null, "lemanruss"], ["Coronus Grand Cannon", null, "lemanruss"],
    ["Carnodon Battle Tank", null, "lemanruss"],
    ["Taurox Prime", null, "chimera"], ["Chimera", null, "chimera"], ["Basilisk", null, "chimera"],
    ["Hellhound", null, "chimera"], ["Wyvern", null, "chimera"], ["Sagitaur", null, "chimera"],
    ["Baneblade", null, "baneblade"], ["Macharius Vanquisher", null, "baneblade"], ["Lord of Skulls", null, "baneblade"],
    // T'au
    ["Devilfish", null, "devilfish"], ["Hammerhead Gunship", null, "devilfish"], ["Sky Ray Gunship", null, "devilfish"],
    ["Longstrike", null, "devilfish"], ["Piranha", null, "piranha"], ["Tetra", null, "piranha"],
    // Eldar/Drukhari
    ["Wave Serpent", null, "waveserpent"], ["Fire Prism", null, "waveserpent"], ["Cobra", null, "waveserpent"],
    ["Scorpion", null, "waveserpent"], ["Lynx", null, "waveserpent"],
    ["Raider", null, "raider"], ["Venom", null, "raider"], ["Reaper", null, "raider"], ["Tantalus", null, "raider"],
    // Ork
    ["Trukk", null, "trukk"], ["Goliath Truck", null, "trukk"],
    ["Battlewagon", null, "battlewagon"], ["Kannonwagon", null, "battlewagon"], ["Big Trakk", null, "battlewagon"],
    // Necron
    ["Ghost Ark", null, "ghostark"], ["Doomsday Ark", null, "ghostark"], ["Annihilation Barge", null, "ghostark"],
    ["Command Barge", null, "ghostark"], ["Skorpius Dunerider", null, "ghostark"], ["Monolith", null, "monolith"],
    ["Triarch Stalker", null, "walker"],
    // Walkers/knights
    ["Dreadnought", null, "walker"], ["Redemptor Dreadnought", null, "walker"],
    ["War Dog Stalker", null, "walker"], ["Armiger Warglaive", null, "walker"],
    ["Knight Paladin", null, "walker"], ["Imperial Knight Preceptor", null, "walker"],
    // misc
    ["Drop Pod", null, "droppod"],
    // Monsters (priority 25)
    ["Carnifex", null, "monster"], ["Hive Tyrant", null, "monster"], ["Daemon Prince", null, "monster"],
    ["Trygon", null, "monster"], ["Mawloc", null, "monster"], ["Riptide", null, "monster"],
    ["Morkanaut", null, "monster"], ["Wraithknight", null, "monster"],
    // AIRCRAFT kw
    ["Nightwing Fighter", ["AIRCRAFT", "VEHICLE"], "aircraft"],
    // deliberate NON-matches (owned by troop pack / built-in fallback, not this pack)
    ["Attack Bike", null, null],
    ["Grey Knight Terminator Squad", null, null],
    ["Grey Knights", null, null],
    ["Tactical Squad", null, null],
  ];
  for (const [name, kw, expected] of ROUTES) {
    const kit = kitForName(name, kw);
    const got = kit ? kit.id : null;
    assert(got === expected, `"${name}" -> ${expected === null ? "(no kit / fallback)" : expected}, got ${got === null ? "(none)" : got}`);
  }

  // ==================================================================
  console.log("== variant keys: distinct sub-styles within one kit id get distinct key() ==");
  const chimeraKit = KITS.find(k => k.id === 'chimera');
  const kChim = (n) => chimeraKit.key({ name: n });
  assert(kChim("Chimera") !== kChim("Basilisk"), "chimera vs basilisk keys differ");
  assert(kChim("Taurox Prime") !== kChim("Chimera"), "taurox (wheeled) vs chimera keys differ");

  const rhinoKit = KITS.find(k => k.id === 'rhino');
  assert(rhinoKit.key({ name: "Rhino" }) !== rhinoKit.key({ name: "Razorback" }), "rhino vs razorback keys differ");

  const devilfishKit = KITS.find(k => k.id === 'devilfish');
  const kDF = (n) => devilfishKit.key({ name: n });
  assert(new Set([kDF("Devilfish"), kDF("Hammerhead Gunship"), kDF("Sky Ray Gunship")]).size === 3, "devilfish/hammerhead/sky ray keys all differ");

  const gravKit = KITS.find(k => k.id === 'grav');
  const kGrav = (n) => gravKit.key({ name: n });
  assert(new Set([kGrav("Land Speeder"), kGrav("Impulsor"), kGrav("Repulsor Executioner")]).size === 3, "speeder/impulsor/repulsor keys all differ");

  const walkerKit = KITS.find(k => k.id === 'walker');
  const kWalk = (n) => walkerKit.key({ name: n });
  assert(new Set([kWalk("Dreadnought"), kWalk("War Dog Stalker"), kWalk("Knight Paladin"), kWalk("Triarch Stalker")]).size === 4, "dread/wardog/knight/tripod walker keys all differ");

  const monKit = KITS.find(k => k.id === 'monster');
  const kMon = (n) => monKit.key({ name: n });
  assert(new Set([kMon("Carnifex"), kMon("Hive Tyrant"), kMon("Trygon"), kMon("Riptide"), kMon("Wraithknight")]).size === 5, "carnifex/winged/serpent/battlesuit/bigwalker monster keys all differ");

  assert(rhinoKit.key({ name: "Rhino" }) === rhinoKit.key({ name: "Rhino" }), "key() is deterministic for the same token");

  // ==================================================================
  console.log("== hulls fill the real WP21_HULLS footprint (bbox within a sane band of wIn x hIn) ==");
  const FOOTPRINT_CASES = [
    ["rhino", "Rhino", 4.6, 3.0], ["predator", "Predator Destructor", 4.6, 3.4],
    ["vindicator", "Vindicator", 4.6, 3.4], ["whirlwind", "Whirlwind", 4.6, 3.4],
    ["landraider", "Land Raider Crusader", 6.0, 4.4], ["lemanruss", "Leman Russ Battle Tank", 5.7, 4.0],
    ["chimera", "Chimera", 5.3, 3.7], ["chimera", "Basilisk", 5.3, 3.7],
    ["baneblade", "Baneblade", 9.3, 5.5], ["trukk", "Trukk", 5.5, 3.2],
    ["battlewagon", "Battlewagon", 7.0, 4.7], ["devilfish", "Hammerhead Gunship", 7.0, 4.5],
    ["piranha", "Piranha", 4.7, 2.6], ["grav", "Land Speeder", 3.7, 2.5],
    ["waveserpent", "Wave Serpent", 6.3, 4.0], ["raider", "Raider", 7.3, 3.2],
    ["ghostark", "Ghost Ark", 6.7, 3.5],
  ];
  for (const [kitId, name, wIn, hIn] of FOOTPRINT_CASES) {
    const kit = KITS.find(k => k.id === kitId);
    const token = { name };
    const fp = rectFp(wIn, hIn);
    const geo = kit.build(ctx, token, fp, SM);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const ex = bb.max.x - bb.min.x, ez = bb.max.z - bb.min.z;
    assert(ex >= wIn * 0.85 && ex <= wIn * 1.4, `${name}: hull x-extent ${ex.toFixed(2)} within [0.85,1.4]x wIn=${wIn}`);
    assert(ez >= hIn * 0.85 && ez <= hIn * 1.5, `${name}: hull z-extent ${ez.toFixed(2)} within [0.85,1.5]x hIn=${hIn}`);
  }

  // ==================================================================
  console.log("== hover kits: hull mass clears HOVER_CLEARANCE (0.3in floor) above the base ==");
  assert(HOVER_CLEARANCE >= 0.3, "HOVER_CLEARANCE constant itself is >=0.3in");
  const HOVER_TABLES = [
    ["grav/speeder", tables.gravTable('speeder', 1.6), 1.6],
    ["grav/impulsor", tables.gravTable('impulsor', 2.1), 2.1],
    ["grav/repulsor", tables.gravTable('repulsor', 2.6), 2.6],
    ["devilfish/plain", tables.devilfishTable('plain', 2.2), 2.2],
    ["devilfish/hammerhead", tables.devilfishTable('hammerhead', 2.2), 2.2],
    ["devilfish/skyray", tables.devilfishTable('skyray', 2.2), 2.2],
    ["piranha", tables.piranhaTable(1.6), 1.6],
    ["waveserpent", tables.waveSerpentTable(2.2), 2.2],
    ["raider", tables.raiderTable(1.7), 1.7],
    ["ghostark", tables.ghostArkTable(2.0), 2.0],
    ["monolith", tables.monolithTable(3.2), 3.2],
  ];
  for (const [label, table, targetH] of HOVER_TABLES) {
    assert(table.length > 1, `${label}: table has a skirt + hull boxes`);
    // convention: table[0] is the skirt (ground-hugging, glow-tinted); index 1+ is hull mass.
    assert(table[0].c === 'glow', `${label}: table[0] is the glow-tinted skirt band`);
    let minBottom = Infinity;
    for (let i = 1; i < table.length; i++) {
      const b = table[i];
      const bottomIn = (b.y - b.h / 2) * targetH;
      minBottom = Math.min(minBottom, bottomIn);
    }
    assert(minBottom >= 0.3 - 1e-6, `${label}: lowest hull box clears 0.3in (got ${minBottom.toFixed(3)}in)`);
  }

  // ==================================================================
  console.log("== walkers/monsters: height tiers within documented spec bands ==");
  const dread = walkerTier("dreadnought");
  assert(dread.targetH >= 2.0 && dread.targetH <= 3.2, "dreadnought targetH in compact band [2.0,3.2]");
  const wardog = walkerTier("war dog stalker");
  assert(wardog.targetH >= 4.0 && wardog.targetH <= 5.2, "war dog/armiger targetH in mid band [4.0,5.2]");
  const knight = walkerTier("knight paladin");
  assert(knight.targetH >= 5.0 && knight.targetH <= 7.0, "knight targetH in the spec's 5-7in band");
  assert(walkerTier("grey knight terminator squad").tier === 'dread', "\"Grey Knight...\" infantry name does NOT get the knight tier (falls to default dread tier, but is unreachable anyway since it never matches the walker kit's match())");

  const carnifex = monsterVariant("carnifex");
  assert(carnifex.kind === 'bulk' && carnifex.targetH > 0, "carnifex is the 'bulk' monster variant");
  const tyrant = monsterVariant("hive tyrant");
  assert(tyrant.kind === 'wing', "hive tyrant is the 'wing' monster variant");
  const daemonPrince = monsterVariant("daemon prince");
  assert(daemonPrince.kind === 'wing', "daemon prince is the 'wing' monster variant");
  const trygon = monsterVariant("trygon");
  assert(trygon.kind === 'serpent', "trygon is the 'serpent' monster variant");
  const riptide = monsterVariant("riptide");
  assert(riptide.kind === 'battlesuit' && riptide.targetH > carnifex.targetH, "riptide is 'battlesuit' and taller than carnifex");
  const wraithknight = monsterVariant("wraithknight");
  assert(wraithknight.kind === 'bigwalker' && wraithknight.targetH >= 5.0, "wraithknight is a tall 'bigwalker' variant (>=5in)");

  // ==================================================================
  console.log("== determinism: same name+footprint+palette builds byte-identical geometry ==");
  for (const kitId of ['rhino', 'landraider', 'devilfish', 'monolith', 'walker', 'monster']) {
    const kit = KITS.find(k => k.id === kitId);
    const name = { rhino: "Razorback", landraider: "Land Raider", devilfish: "Hammerhead Gunship", monolith: "Monolith", walker: "Knight Paladin", monster: "Hive Tyrant" }[kitId];
    const fp = rectFp(6, 4);
    const g1 = kit.build(ctx, { name }, fp, TYR);
    const g2 = kit.build(ctx, { name }, fp, TYR);
    const p1 = g1.attributes.position.array, p2 = g2.attributes.position.array;
    let same = p1.length === p2.length;
    if (same) for (let i = 0; i < p1.length; i++) if (p1[i] !== p2[i]) { same = false; break; }
    assert(same, `${kitId}: two builds from identical inputs produce identical vertex positions`);
  }

  // ==================================================================
  console.log("== builds work across factions (SM blue / T'au ochre / Tyranid purple / Necron green / Ork green / Aeldari teal) ==");
  const paletteCases = [
    ["rhino", "Rhino", SM], ["devilfish", "Devilfish", TAU], ["monster", "Carnifex", TYR],
    ["ghostark", "Ghost Ark", NEC], ["trukk", "Trukk", ORK], ["waveserpent", "Wave Serpent", AE],
  ];
  for (const [kitId, name, pal] of paletteCases) {
    const kit = KITS.find(k => k.id === kitId);
    const geo = kit.build(ctx, { name }, rectFp(5, 3), pal);
    assert(geo && geo.attributes && geo.attributes.position.count > 0, `${kitId}/${name} builds under its faction palette`);
    const hi = new THREE.Color(pal.hi);
    const colArr = geo.attributes.color.array;
    let hasHi = false;
    for (let i = 0; i < colArr.length; i += 3) { if (near(colArr[i], hi.r, 0.001) && near(colArr[i + 1], hi.g, 0.001) && near(colArr[i + 2], hi.b, 0.001)) { hasHi = true; break; } }
    assert(hasHi, `${kitId}/${name}: baked vertex colors include the faction's palette.hi`);
  }

  // ==================================================================
  console.log("== aircraft: builds on a small stand-circle footprint (post reads tall vs footprint) ==");
  {
    const aircraftKit = KITS.find(k => k.id === 'aircraft');
    assert(aircraftKit.match({ name: "Fire Raptor", kw: ["AIRCRAFT", "VEHICLE"] }), "AIRCRAFT keyword matches regardless of name");
    assert(!aircraftKit.match({ name: "Rhino", kw: ["VEHICLE"] }), "no AIRCRAFT keyword => aircraft kit does not match");
    const geo = aircraftKit.build(ctx, { name: "Nightwing" }, circleFp(50), SM);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    assert((bb.max.y - bb.min.y) > 2.0, "aircraft model total height > 2in (post reads clearly above the stand base)");
  }

  // ==================================================================
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exitCode = 1; }
  else { console.log("PASS"); process.exitCode = 0; }
})();
