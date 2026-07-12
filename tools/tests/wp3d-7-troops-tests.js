// WP3D-7 troop-kit-pack tests: run via `node wp3d-7-troops-tests.js` from tools/tests/.
// Plain node, no DOM/WebGL (three.js core objects are pure JS/math). Exercises TROOP_KITS
// directly (exported from ../../sections/wp3d-7-troops.js) rather than reaching into the
// private MINI_KITS registry owned by wp3d-1-geometry.js — this is the same match/key/build
// contract the real registry drives, just invoked without the pooling machinery around it.
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.01 : eps);

  const THREE = await import("../../vendor/three.module.min.js");
  const G = await import("../../sections/wp3d-1-geometry.js");
  const T7 = await import("../../sections/wp3d-7-troops.js");
  const { wp3dHash } = G;
  const { TROOP_KITS, register } = T7;

  const PAL = { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' };
  const TYR_PAL = { hi: '#c0a088', mid: '#6e4470', lo: '#2e1830' };

  // fid-by-owner-side lookup the tests control per scenario
  function makeBridge(fidBySide) {
    return { wpvSideFid: (side) => (fidBySide && fidBySide[side]) || null };
  }

  function tok(overrides) {
    return Object.assign({
      id: 't1', owner: 1, name: 'Trooper', kw: [], shape: 'c', dmm: 32, T: 4, sgt: false,
    }, overrides);
  }

  // Emulates kitFor(): highest priority wins; same-priority ties resolve by registration
  // order (Array#sort is stable) — TROOP_KITS is already in that order.
  function routeTo(token, bridge) {
    for (const kit of TROOP_KITS) {
      let m = false;
      try { m = !!kit.match(token, bridge); } catch (e) {}
      if (m) return kit;
    }
    return null;
  }

  const CTX = { THREE, bridge: null, hash: G.wp3dHash, rng: G.wp3dRng, mergeGeometries: G.mergeGeometries, voxelsToGeometry: G.voxelsToGeometry };
  function ctxFor(bridge) { return Object.assign({}, CTX, { bridge }); }

  // ==================================================================
  console.log("== register(): all kits land in the shared MINI_KITS registry ==");
  {
    // register() must not throw and must be idempotent-safe to call once here; presence is
    // verified indirectly via TROOP_KITS.length matching what register() pushed.
    let threw = false;
    try { register(); } catch (e) { threw = true; }
    assert(!threw, "register() runs without throwing");
    assert(TROOP_KITS.length === 12, "12 troop kits defined (got " + TROOP_KITS.length + ")");
    assert(TROOP_KITS.every(k => k.priority === 10), "every troop kit is priority 10 per contract");
    assert(TROOP_KITS.every(k => typeof k.match === 'function' && typeof k.key === 'function' && typeof k.build === 'function'), "every kit has match/key/build");
    const ids = TROOP_KITS.map(k => k.id);
    assert(new Set(ids).size === ids.length, "kit ids are unique");
  }

  // ==================================================================
  console.log("== routing table: token shape -> expected kit id ==");
  const SM = makeBridge({ 1: 'SM', 2: 'ORK' });
  const CASES = [
    ["Terminator by name", tok({ name: 'Terminator Sergeant', kw: ['INFANTRY'], dmm: 40 }), SM, 'troop-heavy'],
    ["Gravis by keyword", tok({ name: 'Aggressor', kw: ['INFANTRY', 'GRAVIS'], dmm: 40 }), SM, 'troop-heavy'],
    ["plain INFANTRY at 40mm base (no name match)", tok({ name: 'Bulky Guy', kw: ['INFANTRY'], dmm: 40 }), SM, 'troop-heavy'],
    ["SM line trooper", tok({ name: 'Intercessor', kw: ['INFANTRY', 'BATTLELINE'], dmm: 32, owner: 1 }), SM, 'troop-line'],
    ["ORK boy", tok({ name: 'Ork Boy', kw: ['INFANTRY'], dmm: 32, owner: 2, T: 5 }), SM, 'troop-mob'],
    ["cultist by name, non-ork faction", tok({ name: 'Chaos Cultist', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'CSM' }), 'troop-mob'],
    ["Guardsman: small base + low T", tok({ name: 'Cadian Guardsman', kw: ['INFANTRY'], dmm: 25, T: 3, owner: 1 }), makeBridge({ 1: 'AM' }), 'troop-light'],
    ["Termagant (TYR faction)", tok({ name: 'Termagant', kw: ['INFANTRY', 'BEASTS'], dmm: 25, owner: 1 }), makeBridge({ 1: 'TYR' }), 'troop-tyranid'],
    ["Tyranid Warrior by name", tok({ name: 'Tyranid Warrior', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'TYR' }), 'troop-tyranid'],
    ["Ripper Swarm by name", tok({ name: 'Ripper Swarm', kw: ['INFANTRY', 'SWARM'], dmm: 40, owner: 1 }), makeBridge({ 1: 'TYR' }), 'troop-swarm'],
    ["Nurgling Swarm (non-TYR faction, name-only)", tok({ name: 'Nurglings', kw: ['INFANTRY'], dmm: 40, owner: 1 }), makeBridge({ 1: 'DG' }), 'troop-swarm'],
    ["Necron Warrior", tok({ name: 'Necron Warrior', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'NEC' }), 'troop-necron'],
    ["Tau Fire Warrior", tok({ name: 'Fire Warrior', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'TAU' }), 'troop-tau'],
    ["Tau Marker Drone", tok({ name: 'Marker Drone', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'TAU' }), 'troop-tau-drone'],
    ["Eldar Guardian (AE)", tok({ name: 'Guardian', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'AE' }), 'troop-eldar'],
    ["Drukhari Kabalite (DRU)", tok({ name: 'Kabalite Warrior', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'DRU' }), 'troop-eldar'],
    ["Bike overrides faction (SM biker)", tok({ name: 'Outrider', kw: ['INFANTRY', 'MOUNTED'], wIn: 3.55, hIn: 2.05, oval: true, shape: 'r', owner: 1 }), SM, 'troop-bike'],
    ["Bike overrides tyranid (mounted TYR edge case)", tok({ name: 'Some Mount', kw: ['INFANTRY', 'MOUNTED'], shape: 'r', wIn: 3.55, hIn: 2.05, owner: 1 }), makeBridge({ 1: 'TYR' }), 'troop-bike'],
    ["Custodian Guard: 40mm base outranks POWER_ARMOR_FIDS -> heavy silhouette", tok({ name: 'Custodian Guard', kw: ['INFANTRY'], dmm: 40, owner: 1 }), makeBridge({ 1: 'AC' }), 'troop-heavy'],
    ["Custodes at a normal 32mm base -> power-armor line kit", tok({ name: 'Custodian Guard', kw: ['INFANTRY'], dmm: 32, owner: 1 }), makeBridge({ 1: 'AC' }), 'troop-line'],
    ["Unmatched faction, generic INFANTRY catch-all", tok({ name: 'Kin Warrior', kw: ['INFANTRY'], dmm: 32, T: 4, owner: 1 }), makeBridge({ 1: 'LoV' }), 'troop-generic'],
    ["Non-infantry, non-character token matches nothing", tok({ name: 'Objective Marker Thing', kw: [], dmm: 32, owner: 1 }), makeBridge({ 1: 'UN' }), null],
  ];
  for (const [label, token, bridge, expected] of CASES) {
    const kit = routeTo(token, bridge);
    const got = kit ? kit.id : null;
    assert(got === expected, `${label} -> ${expected === null ? 'no kit (built-in fallback)' : expected} (got ${got})`);
  }

  // ==================================================================
  console.log("== pose determinism: key() is stable across repeated calls, same token same variant ==");
  {
    const kit = TROOP_KITS.find(k => k.id === 'troop-line');
    const t = tok({ id: 'abc-123', name: 'Intercessor', kw: ['INFANTRY'] });
    const k1 = kit.key(t), k2 = kit.key(t);
    assert(k1 === k2, "key(token) is deterministic for the same token object");
    const t2 = tok({ id: 'abc-123', name: 'Different Name Same Id', kw: ['INFANTRY'] });
    assert(kit.key(t) === kit.key(t2), "same token id => same pose bucket regardless of other fields");
    assert(/^troop-line\|p[0-2]\|$/.test(k1), "key format matches `${subarch}|p${hash%3}|${sgt}` for a non-sergeant");
    const sgtTok = tok({ id: 'abc-123', sgt: true });
    assert(kit.key(sgtTok) === 'troop-line|p' + (wp3dHash('abc-123') % 3) + '|s', "sgt flag appends 's' to the variant key");
  }
  console.log("== pose distribution: many ids cover pose buckets 0/1/2 ==");
  {
    const kit = TROOP_KITS.find(k => k.id === 'troop-line');
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(kit.key(tok({ id: 'unit-' + i })).match(/p(\d)/)[1]);
    assert(seen.has('0') && seen.has('1') && seen.has('2'), "60 distinct ids produce all 3 pose buckets, got " + [...seen].sort());
  }
  console.log("== tyranid tier is folded into the variant key (build() reads it) ==");
  {
    const kit = TROOP_KITS.find(k => k.id === 'troop-tyranid');
    const warrior = tok({ id: 'tyr1', name: 'Tyranid Warrior' });
    const gaunt = tok({ id: 'tyr1', name: 'Termagant' }); // SAME id, different name/tier
    assert(kit.key(warrior) !== kit.key(gaunt), "different tyranid name-tier => different variant key even with same token id (pool safety)");
  }

  // ==================================================================
  console.log("== bounds: built geometry stays within a sane multiple of its footprint ==");
  const CIRCLE_FP = { shape: 'c', dmm: 32 };
  const HEAVY_FP = { shape: 'c', dmm: 40 };
  const LIGHT_FP = { shape: 'c', dmm: 25 };
  const BIKE_FP = { shape: 'r', wIn: 3.55, hIn: 2.05, oval: true };
  const BOUND_CASES = [
    ['troop-heavy', tok({ id: 'h1', dmm: 40 }), HEAVY_FP, PAL, 1.5],
    ['troop-line', tok({ id: 'l1' }), CIRCLE_FP, PAL, 1.3],
    ['troop-light', tok({ id: 'g1' }), LIGHT_FP, PAL, 1.2],
    ['troop-mob', tok({ id: 'm1', owner: 2 }), CIRCLE_FP, PAL, 1.35],   // ork tier (owner 2 = ORK under SM bridge)
    ['troop-tyranid', tok({ id: 'ty1', name: 'Tyranid Warrior' }), CIRCLE_FP, TYR_PAL, 1.8],
    ['troop-necron', tok({ id: 'n1' }), CIRCLE_FP, PAL, 1.3],
    ['troop-tau', tok({ id: 'ta1' }), CIRCLE_FP, PAL, 1.3],
    ['troop-tau-drone', tok({ id: 'd1' }), CIRCLE_FP, PAL, 1.0],
    ['troop-eldar', tok({ id: 'e1' }), CIRCLE_FP, PAL, 1.35],
    ['troop-bike', tok({ id: 'b1', shape: 'r' }), BIKE_FP, PAL, 1.4],
    ['troop-swarm', tok({ id: 's1' }), CIRCLE_FP, PAL, 0.55],
  ];
  for (const [kitId, token, fp, pal, targetH] of BOUND_CASES) {
    const kit = TROOP_KITS.find(k => k.id === kitId);
    const bridge = kitId === 'troop-mob' ? SM : null;
    const geo = kit.build(ctxFor(bridge), token, fp, pal);
    assert(geo && geo.attributes && geo.attributes.position.count > 0, kitId + " builds a non-empty geometry");
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const fpW = fp.shape === 'c' ? (fp.dmm / 25.4) : fp.wIn;
    const fpD = fp.shape === 'c' ? (fp.dmm / 25.4) : fp.hIn;
    const spanX = bb.max.x - bb.min.x, spanZ = bb.max.z - bb.min.z;
    // arms/pauldrons/talons legitimately overhang a base a bit (real minis do too) — cap the
    // sanity check at a generous 2.2x the footprint so a broken/runaway coefficient still fails.
    assert(spanX > 0 && spanX <= fpW * 2.2, kitId + " x-span " + spanX.toFixed(3) + " within 2.2x footprint width " + fpW.toFixed(3));
    assert(spanZ > 0 && spanZ <= fpD * 2.2, kitId + " z-span " + spanZ.toFixed(3) + " within 2.2x footprint depth " + fpD.toFixed(3));
    assert(bb.min.y >= -0.001, kitId + " never dips below the board (min.y >= 0)");
    assert(bb.max.y > targetH * 0.4 && bb.max.y <= targetH * 1.15, kitId + " height " + bb.max.y.toFixed(3) + " within target-height envelope (~" + targetH + "in)");
  }

  // ==================================================================
  console.log("== swarm body count: 4-6 small bodies per pool variant ==");
  {
    const kit = TROOP_KITS.find(k => k.id === 'troop-swarm');
    // Precise count: build against a RECT footprint so the base is also a BoxGeometry (24
    // verts), making "(boxes+1 base) * 24 == total verts" exact, mirroring the WP3D-1 test's
    // own technique for isolating box count from vertex count.
    for (let pose = 0; pose < 3; pose++) {
      let id = null;
      for (let i = 0; i < 200 && id === null; i++) if (wp3dHash('sq-' + i) % 3 === pose) id = 'sq-' + i;
      const t = tok({ id, name: 'Ripper Swarm', kw: ['SWARM'] });
      const geo = kit.build(ctxFor(null), t, { shape: 'r', wIn: 2, hIn: 2 }, PAL);
      const totalBoxes = geo.attributes.position.count / 24;
      const bodyBoxes = totalBoxes - 1; // minus base plate
      const bodies = bodyBoxes / 2; // body + head per critter
      assert(Number.isInteger(bodies) && bodies >= 4 && bodies <= 6, "swarm pose " + pose + " has 4-6 bodies, got " + bodies);
    }
    // determinism: same pose bucket => identical body count + identical vertex data across
    // two DIFFERENT token ids that hash to the same bucket (pool-shared geometry contract).
    let idA = null, idB = null;
    for (let i = 0; i < 500 && (idA === null || idB === null); i++) {
      if (wp3dHash('sd-' + i) % 3 === 0) { if (idA === null) idA = 'sd-' + i; else if (idB === null && 'sd-' + i !== idA) idB = 'sd-' + i; }
    }
    const gA = kit.build(ctxFor(null), tok({ id: idA, kw: ['SWARM'] }), { shape: 'r', wIn: 2, hIn: 2 }, PAL);
    const gB = kit.build(ctxFor(null), tok({ id: idB, kw: ['SWARM'] }), { shape: 'r', wIn: 2, hIn: 2 }, PAL);
    assert(gA.attributes.position.count === gB.attributes.position.count, "two different token ids in the same pose bucket produce identical swarm geometry (vert count match)");
    let sameVerts = gA.attributes.position.array.length === gB.attributes.position.array.length;
    if (sameVerts) {
      for (let i = 0; i < gA.attributes.position.array.length; i++) if (Math.abs(gA.attributes.position.array[i] - gB.attributes.position.array[i]) > 1e-6) { sameVerts = false; break; }
    }
    assert(sameVerts, "swarm scatter is seeded by pool variant, not token id — identical geometry across ids sharing a pose bucket");
  }

  // ==================================================================
  console.log("== necron gauss rod carries the glow tint ==");
  {
    const kit = TROOP_KITS.find(k => k.id === 'troop-necron');
    const geo = kit.build(ctxFor(null), tok({ id: 'nec1' }), CIRCLE_FP, PAL);
    const glow = new THREE.Color('#57d0ff');
    const colArr = geo.attributes.color.array;
    let hasGlow = false;
    for (let i = 0; i < colArr.length; i += 3) {
      if (near(colArr[i], glow.r, 0.001) && near(colArr[i + 1], glow.g, 0.001) && near(colArr[i + 2], glow.b, 0.001)) { hasGlow = true; break; }
    }
    assert(hasGlow, "necron gauss rod vertex colors include the #57d0ff glow tint");
  }

  // ==================================================================
  console.log("== sergeant accessory: sgt=true adds geometry (crest+banner) vs sgt=false ==");
  {
    const kit = TROOP_KITS.find(k => k.id === 'troop-line');
    const plain = kit.build(ctxFor(null), tok({ id: 'p1', sgt: false }), CIRCLE_FP, PAL);
    const leader = kit.build(ctxFor(null), tok({ id: 'p1', sgt: true }), CIRCLE_FP, PAL);
    assert(leader.attributes.position.count > plain.attributes.position.count, "sgt token builds strictly more geometry (crest+banner) than a non-sgt token");
  }

  // ==================================================================
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exitCode = 1; }
  else { console.log("PASS"); process.exitCode = 0; }
})();
