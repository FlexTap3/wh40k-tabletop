// WP3D-6 v3 mission-true + pre-painted + pairing terrain pack tests: run via
// `node wp3d-6-terrain-tests.js` from tools/tests/. Plain node, no DOM/WebGL — exercises the
// real registerTerrainBuilder -> buildTerrain() dispatch path exactly as wh40k-3d.js uses it,
// including the WP3D-v3 ctx.piece/ctx.all pairing seam via synthetic terrain arrangements.
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.01 : eps);
  const luminance = (hex) => {
    const n = parseInt(String(hex).replace("#", ""), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rgb = (hex) => { const n = parseInt(String(hex).replace("#", ""), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };

  const THREE = await import("../../vendor/three.module.min.js");
  const G = await import("../../sections/wp3d-1-geometry.js");
  const T = await import("../../sections/wp3d-6-terrain2.js");
  const { buildTerrain } = G;
  const { register, ruinPlan, wallPlan, woodPlan, cratePlan, craterPlan, pairingFor, PALETTE } = T;

  register();

  const KINDS = ["ruin", "wall", "wood", "crate", "crater"];
  // realistic-ish footprints per kind (mirrors the Official 1A layout's own numbers) plus a
  // couple of small/awkward ones to stress the bounds-clamping.
  const FOOTPRINTS = {
    ruin: [[11, 7], [5.5, 5.5], [2, 2]],
    wall: [[2, 11], [1.5, 6], [4, 13]],
    wood: [[10, 8], [4, 4]],
    crate: [[3, 2], [2, 2], [1.2, 1.2]],
    crater: [[6, 6], [4, 5], [2, 2]],
  };

  // ==================================================================
  console.log("== builders registered for all 5 kinds ==");
  for (const kind of KINDS) {
    const [w, h] = FOOTPRINTS[kind][0];
    const obj = buildTerrain(kind, w, h, kind + "-reg-1");
    assert(!!obj && obj.userData && obj.userData.builtBy === "wp3d-6-terrain2", kind + " routes through the WP3D-6 override, not the built-in fallback");
  }

  // ==================================================================
  console.log("== pairingFor: pure world-space neighbor resolution (the v3 seam) ==");
  {
    // touch pad 0.6 — just inside touches, just outside doesn't
    const a = { id: "a", kind: "wall", x: 0, y: 0, w: 2, h: 11, rot: 0 };
    const bTouch = { id: "b", kind: "ruin", x: 2.59, y: 0, w: 11, h: 7, rot: 0 }; // gap 0.59 < 0.6 pad
    const bNoTouch = { id: "c", kind: "ruin", x: 2.61, y: 0, w: 11, h: 7, rot: 0 }; // gap 0.61 > 0.6 pad
    assert(pairingFor(a, [a, bTouch]).ruins.length === 1, "gap just inside the 0.6in pad counts as touching");
    assert(pairingFor(a, [a, bNoTouch]).ruins.length === 0, "gap just outside the 0.6in pad does NOT count as touching");
    assert(pairingFor(a, [a]).ruins.length === 0, "a piece is never its own neighbor");
    assert(JSON.stringify(pairingFor(null, [a])) === JSON.stringify({ ruins: [], walls: [] }), "pairingFor(null,...) is a safe no-op");

    // rotation: local offset must un-rotate by the FROM piece's own rot (exact right-angle
    // cases so sin/cos are exact 0/±1 — locks down the trig, not just "some value changed").
    const p0 = { id: "p0", kind: "wall", x: 0, y: 0, w: 2, h: 2, rot: 0 };
    const east = { id: "e", kind: "ruin", x: 2.5, y: 0, w: 2, h: 2, rot: 0 }; // touching, due east in world space (gap 0.5 < 0.6 pad)
    assert(near(pairingFor(p0, [p0, east]).ruins[0].lx, 2.5, 0.01) && near(pairingFor(p0, [p0, east]).ruins[0].lz, 0, 0.01), "rot=0: world-east neighbor reads as local +x");
    const p90 = { id: "p90", kind: "wall", x: 0, y: 0, w: 2, h: 2, rot: 90 };
    const off90 = pairingFor(p90, [p90, east]).ruins[0];
    assert(near(off90.lx, 0, 0.02) && near(off90.lz, -2.5, 0.02), "rot=90: same world-east neighbor rotates into local -z (matches the caller's rotateY(-rot) placement)");
  }

  // ==================================================================
  console.log("== pairing routing: wall E of ruin -> facade facing W ==");
  {
    // ruin footprint x:[0,11], wall footprint x:[11,13] (touching, wall is EAST of the ruin)
    const ruin = { id: "ru", kind: "ruin", x: 0, y: 0, w: 11, h: 7, rot: 0 };
    const wall = { id: "wa", kind: "wall", x: 11, y: 0, w: 2, h: 7, rot: 0 };
    const all = [ruin, wall];
    const wallObj = buildTerrain("wall", 2, 7, "wa", wall, all);
    assert(wallObj.userData.facadeSide === "W", "wall east of the ruin faces its clean facade WEST, toward the ruin (got " + wallObj.userData.facadeSide + ")");
    const th = wallObj.userData.terrainHeight;
    assert(th >= 4 - 1e-6 && th <= 6 + 1e-6, "paired wall (facade mode) terrainHeight " + th.toFixed(2) + " in [4,6]");

    // and the mirror: wall WEST of the ruin faces EAST
    const wall2 = { id: "wa2", kind: "wall", x: -2, y: 0, w: 2, h: 7, rot: 0 };
    const wallObj2 = buildTerrain("wall", 2, 7, "wa2", wall2, [ruin, wall2]);
    assert(wallObj2.userData.facadeSide === "E", "wall west of the ruin faces its clean facade EAST, toward the ruin (got " + wallObj2.userData.facadeSide + ")");

    // and north/south
    const ruin2 = { id: "ru2", kind: "ruin", x: 0, y: 0, w: 11, h: 7, rot: 0 };
    const wallN = { id: "wn", kind: "wall", x: 0, y: -2, w: 11, h: 2, rot: 0 };
    const wallNObj = buildTerrain("wall", 11, 2, "wn", wallN, [ruin2, wallN]);
    assert(wallNObj.userData.facadeSide === "S", "wall north of the ruin faces its clean facade SOUTH, toward the ruin (got " + wallNObj.userData.facadeSide + ")");
  }

  // ==================================================================
  console.log("== pairing routing: lone wall (no adjacent ruin) -> barricade ==");
  {
    for (let i = 0; i < 15; i++) {
      const obj = buildTerrain("wall", 2, 11, "lone-wall-" + i); // no piece/all -> unpaired
      assert(obj.userData.barricade === true, "lone-wall-" + i + " routes to barricade mode");
      const th = obj.userData.terrainHeight;
      assert(th >= 1.5 - 1e-6 && th <= 2.5 + 1e-6, "lone-wall-" + i + " barricade terrainHeight " + th.toFixed(2) + " in [1.5,2.5]");
    }
    // also explicit: a wall with OTHER walls nearby but no ruin still barricades
    const wa = { id: "wa", kind: "wall", x: 0, y: 0, w: 2, h: 11, rot: 0 };
    const wb = { id: "wb", kind: "wall", x: 2, y: 0, w: 2, h: 11, rot: 0 };
    const obj = buildTerrain("wall", 2, 11, "wa", wa, [wa, wb]);
    assert(obj.userData.barricade === true, "wall neighbor (not a ruin) does not trigger facade mode");
  }

  // ==================================================================
  console.log("== pairing routing: lone ruin (no adjacent wall) -> open rubble ==");
  {
    for (let i = 0; i < 10; i++) {
      const plan = ruinPlan("lone-ruin-" + i, 11, 7); // no pairing arg -> default {walls:[]}
      assert(plan.pairing.hasWall === false, "lone-ruin-" + i + " pairing.hasWall is false");
      assert(plan.pairing.wallSides.length === 0, "lone-ruin-" + i + " has no paired wall sides");
    }
    // explicit: a ruin with a nearby wall that does NOT touch (gap > 0.6) stays open rubble
    const ruin = { id: "ru", kind: "ruin", x: 0, y: 0, w: 11, h: 7, rot: 0 };
    const farWall = { id: "fw", kind: "wall", x: 11.7, y: 0, w: 2, h: 7, rot: 0 }; // gap 0.7 > 0.6 pad
    const pairing = pairingFor(ruin, [ruin, farWall]);
    assert(pairing.walls.length === 0, "a wall just outside the touch pad does not pair with the ruin");
  }

  // ==================================================================
  console.log("== pairing routing: two walls on perpendicular edges -> L-corner ruin ==");
  {
    const ruin = { id: "rc", kind: "ruin", x: 0, y: 0, w: 11, h: 7, rot: 0 };
    const wallE = { id: "we", kind: "wall", x: 11, y: 0, w: 2, h: 7, rot: 0 };
    const wallN = { id: "wn", kind: "wall", x: 0, y: -2, w: 11, h: 2, rot: 0 };
    const all = [ruin, wallE, wallN];
    const obj = buildTerrain("ruin", 11, 7, "rc", ruin, all);
    assert(obj.userData.pairing.isCorner === true, "ruin with walls on two perpendicular edges is flagged isCorner");
    assert(obj.userData.pairing.wallSides.length === 2, "L-corner ruin records both paired edges, got " + JSON.stringify(obj.userData.pairing.wallSides));

    // slab placement nestles into the corner: across many seeds the slab rectangle's offset
    // is biased toward the SAME signs as the paired sides (E => +x, N => -z), not scattered.
    let towardCorner = 0, total = 0;
    for (let i = 0; i < 30; i++) {
      const plan = ruinPlan("corner-slab-" + i, 11, 7, pairingFor(ruin, all));
      for (const s of plan.slabs) { total++; if (s.cx >= -0.05 && s.cz <= 0.05) towardCorner++; }
    }
    assert(total > 0, "corner-paired ruin still produces slabs across 30 seeds");
    assert(towardCorner / total > 0.7, "L-corner slabs predominantly sit toward the E/N corner (" + towardCorner + "/" + total + ")");

    // stub remnants are suppressed on the two paired edges (the real wall pieces stand there)
    for (let i = 0; i < 20; i++) {
      const plan = ruinPlan("corner-stub-" + i, 11, 7, pairingFor(ruin, all));
      const onE = plan.stubs.filter(s => s.side === "E").length;
      const onN = plan.stubs.filter(s => s.side === "N").length;
      assert(onE === 0, "corner-stub-" + i + " no stub remnants tagged for the paired E edge");
      assert(onN === 0, "corner-stub-" + i + " no stub remnants tagged for the paired N edge");
    }
  }

  // ==================================================================
  console.log("== ruin: slab tops pinned to exactly 3 and 6 (unpaired/open-rubble mode) ==");
  {
    let sawL1 = 0, sawL2 = 0, sawBoth = false;
    for (let i = 0; i < 60; i++) {
      const plan = ruinPlan("ruin-slab-" + i, 11, 7);
      const tops = plan.slabs.map(s => s.topY);
      if (tops.includes(3)) sawL1++;
      if (tops.includes(6)) sawL2++;
      if (tops.includes(3) && tops.includes(6)) sawBoth = true;
      for (const s of plan.slabs) assert(s.topY === 3 || s.topY === 6, "ruin-slab-" + i + " slab topY is exactly 3 or 6, got " + s.topY);
    }
    assert(sawL1 > 0, "at least one seed produced an L1 (y=3) slab across 60 tries");
    assert(sawL2 > 0, "at least one seed produced an L2 (y=6) slab across 60 tries");
    assert(sawBoth, "at least one seed produced BOTH slabs across 60 tries");

    // bounding-box check of the actual slab sub-meshes (not just the plan numbers)
    let checkedSlabMeshes = 0;
    for (let i = 0; i < 30; i++) {
      const obj = buildTerrain("ruin", 11, 7, "ruin-slab-" + i);
      obj.traverse(o => {
        if (!o.userData || !o.userData.isSlab) return;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        checkedSlabMeshes++;
        assert(near(bb.max.y, o.userData.slabTopY, 0.001), "slab mesh bounding-box top == " + o.userData.slabTopY + " (got " + bb.max.y.toFixed(3) + ")");
        assert(bb.min.y < o.userData.slabTopY, "slab has nonzero thickness (min.y < top)");
      });
    }
    assert(checkedSlabMeshes > 0, "at least one slab sub-mesh was found and bounding-box checked");

    // same invariant holds when PAIRED (facade-anchored slabs) — the elevationFor contract
    // (lvl*3) doesn't care whether the ruin is open rubble or a corner building.
    const ruin = { id: "rp", kind: "ruin", x: 0, y: 0, w: 11, h: 7, rot: 0 };
    const wall = { id: "wp", kind: "wall", x: 11, y: 0, w: 2, h: 7, rot: 0 };
    for (let i = 0; i < 20; i++) {
      const plan = ruinPlan("ruin-slab-paired-" + i, 11, 7, pairingFor(ruin, [ruin, wall]));
      for (const s of plan.slabs) assert(s.topY === 3 || s.topY === 6, "ruin-slab-paired-" + i + " slab topY exactly 3 or 6, got " + s.topY);
    }
  }

  console.log("== ruin: corner columns support surviving quadrant slabs (>=2 per level), interior stays open ==");
  {
    for (let i = 0; i < 20; i++) {
      const plan = ruinPlan("ruin-corners-" + i, 11, 7);
      // plan.slabs is now one entry PER SURVIVING QUADRANT (a broken floor, not one clean
      // rectangle), 1:1 with plan.corners — but each floor LEVEL (distinct topY) must still
      // keep at least 2 quadrants/columns standing.
      const byLevel = {};
      for (const s of plan.slabs) byLevel[s.topY] = (byLevel[s.topY] || 0) + 1;
      for (const topY in byLevel) assert(byLevel[topY] >= 2, "ruin-corners-" + i + " level y=" + topY + " keeps >=2 surviving quadrants, got " + byLevel[topY]);
      assert(plan.corners.length === plan.slabs.length, "ruin-corners-" + i + " every surviving quadrant has exactly one support column");
      for (const c of plan.corners) assert(c.topY === 3 || c.topY === 6, "corner column rises to exactly its slab's topY");
    }
  }

  // ==================================================================
  console.log("== ruin: large footprint (>=8in) gets the abstract aquila accent block ==");
  {
    assert(ruinPlan("aq-1", 11, 7).aquila === true, "11x7 ruin (long side 11 >= 8) gets the aquila accent");
    assert(ruinPlan("aq-2", 8, 3).aquila === true, "8x3 ruin (long side exactly 8) gets the aquila accent");
    assert(ruinPlan("aq-3", 5.5, 5.5).aquila === false, "5.5x5.5 ruin (both sides < 8) does NOT get the aquila accent");
    assert(ruinPlan("aq-4", 2, 2).aquila === false, "2x2 ruin does NOT get the aquila accent");
    // and the geometry is actually emitted + stays in bounds
    const obj = buildTerrain("ruin", 11, 7, "aq-mesh-1");
    const bb = new THREE.Box3().setFromObject(obj);
    assert(bb.min.x >= -5.5 - 0.2 - 1e-6 && bb.max.x <= 5.5 + 0.2 + 1e-6, "aquila-bearing ruin geometry stays within footprint bounds (x)");
  }

  // ==================================================================
  console.log("== wall: facade height within [4,6] (paired mode) ==");
  {
    const pairedRuin = { id: "pr", kind: "ruin", x: -20, y: -20, w: 11, h: 7, rot: 0 };
    for (const [w, h] of FOOTPRINTS.wall) {
      const piece = { id: "wp-" + w + "x" + h, kind: "wall", x: pairedRuin.x + pairedRuin.w, y: pairedRuin.y, w, h, rot: 0 };
      const all = [pairedRuin, piece];
      for (let i = 0; i < 10; i++) {
        const obj = buildTerrain("wall", w, h, "wall-h-" + w + "x" + h + "-" + i, piece, all);
        const th = obj.userData.terrainHeight;
        assert(th >= 4 - 1e-6 && th <= 6 + 1e-6, "paired wall " + w + "x" + h + " #" + i + " terrainHeight " + th.toFixed(2) + " in [4,6]");
      }
    }
    // wallPlan itself (facade mode): every non-gap column's height is in [4,6]
    const facadePairing = { ruins: [{ id: "ru", w: 11, h: 7, lx: 0, lz: 6, dist: 6, side: "S" }], walls: [] };
    const plan = wallPlan("wall-plan-1", 2, 11, facadePairing);
    assert(plan.mode === "facade", "wallPlan with a ruin neighbor returns facade mode");
    for (const c of plan.cols) if (c.type !== "gap") assert(c.h >= 4 - 1e-6 && c.h <= 6 + 1e-6, "wall column height " + c.h.toFixed(2) + " in [4,6]");
    assert(plan.cols.some(c => c.type === "gap"), "wall plan guarantees at least one door/breach gap column");
    assert(plan.cols.some(c => c.type === "bay"), "wall plan produced at least one windowed bay column (2-row window holes)");
    assert(plan.thickness === Math.min(2, 11) && plan.length === Math.max(2, 11), "wall thickness/length derive from the piece's own thin/long footprint dims");
    assert(plan.innerThick > 0 && plan.outerThick > 0 && near(plan.innerThick + plan.outerThick, plan.thickness, 1e-9), "facade inner+outer layers exactly partition the wall's thickness");
  }

  console.log("== wall: barricade height within [1.5,2.5] (unpaired mode) ==");
  {
    const plan = wallPlan("wall-bar-1", 2, 11); // no pairing -> barricade
    assert(plan.mode === "barricade", "wallPlan with no ruin neighbor returns barricade mode");
    for (const s of plan.segs) assert(s.h >= 1.5 - 1e-6 && s.h <= 2.5 + 1e-6, "barricade segment height " + s.h.toFixed(2) + " in [1.5,2.5]");
    for (const [w, h] of FOOTPRINTS.wall) {
      for (let i = 0; i < 8; i++) {
        const obj = buildTerrain("wall", w, h, "bar-h-" + w + "x" + h + "-" + i);
        const th = obj.userData.terrainHeight;
        assert(th >= 1.5 - 1e-6 && th <= 2.5 + 1e-6, "barricade " + w + "x" + h + " #" + i + " terrainHeight " + th.toFixed(2) + " in [1.5,2.5]");
      }
    }
  }

  // ==================================================================
  console.log("== determinism: same id+neighbors => identical, different id or neighbors => differs ==");
  const serializeGeo = obj => {
    const parts = [];
    obj.traverse(o => { if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) parts.push(Array.from(o.geometry.attributes.position.array).map(n => n.toFixed(5)).join(",")); });
    return parts.join("|");
  };
  for (const kind of KINDS) {
    const [w, h] = FOOTPRINTS[kind][0];
    const a1 = buildTerrain(kind, w, h, kind + "-det-A");
    const a2 = buildTerrain(kind, w, h, kind + "-det-A");
    const b1 = buildTerrain(kind, w, h, kind + "-det-B");
    assert(serializeGeo(a1) === serializeGeo(a2), kind + ": same id produces identical geometry");
    assert(serializeGeo(a1) !== serializeGeo(b1), kind + ": different id produces different geometry");
  }
  // plan-level determinism too (cheaper, and what the contract explicitly calls out for ruin)
  assert(JSON.stringify(ruinPlan("p-A", 11, 7)) === JSON.stringify(ruinPlan("p-A", 11, 7)), "ruinPlan is a pure function of (id,w,h,pairing)");
  assert(JSON.stringify(ruinPlan("p-A", 11, 7)) !== JSON.stringify(ruinPlan("p-B", 11, 7)), "ruinPlan differs across ids");
  // determinism w.r.t. NEIGHBORS: same id, same pairing -> identical; same id, different
  // pairing (moved/added neighbor) -> may legitimately differ. This is exactly what
  // syncTerrain's pairKey is for (moving any member of a building rebuilds it).
  {
    const ruin = { id: "dr", kind: "ruin", x: 0, y: 0, w: 11, h: 7, rot: 0 };
    const wall = { id: "dw", kind: "wall", x: 11, y: 0, w: 2, h: 7, rot: 0 };
    const g1 = buildTerrain("wall", 2, 7, "dw", wall, [ruin, wall]);
    const g2 = buildTerrain("wall", 2, 7, "dw", wall, [ruin, wall]);
    assert(serializeGeo(g1) === serializeGeo(g2), "same id + same neighbor arrangement => identical wall geometry");
    const wallMoved = { id: "dw", kind: "wall", x: 20, y: 20, w: 2, h: 7, rot: 0 }; // far away, no longer touching the ruin
    const g3 = buildTerrain("wall", 2, 7, "dw", wallMoved, [ruin, wallMoved]);
    assert(serializeGeo(g1) !== serializeGeo(g3), "moving the wall out of pairing range (barricade instead of facade) changes its geometry");
  }

  // ==================================================================
  console.log("== everything within footprint bounds ±0.2in (all 5 kinds, incl. small footprints, paired + unpaired) ==");
  for (const kind of KINDS) {
    for (const [w, h] of FOOTPRINTS[kind]) {
      for (let i = 0; i < 6; i++) {
        const obj = buildTerrain(kind, w, h, kind + "-bounds-" + w + "x" + h + "-" + i);
        const bb = new THREE.Box3().setFromObject(obj);
        const okX = bb.min.x >= -w / 2 - 0.2 - 1e-6 && bb.max.x <= w / 2 + 0.2 + 1e-6;
        const okZ = bb.min.z >= -h / 2 - 0.2 - 1e-6 && bb.max.z <= h / 2 + 0.2 + 1e-6;
        assert(okX && okZ, kind + " " + w + "x" + h + " #" + i + " geometry within footprint ±0.2in (x:[" + bb.min.x.toFixed(2) + "," + bb.max.x.toFixed(2) + "] z:[" + bb.min.z.toFixed(2) + "," + bb.max.z.toFixed(2) + "])");
      }
    }
  }
  {
    // paired arrangements too (facade walls + corner ruins), incl. a rotated wall
    for (let i = 0; i < 10; i++) {
      const ruin = { id: "pb-ru-" + i, kind: "ruin", x: 0, y: 0, w: 11, h: 7, rot: 0 };
      const wall = { id: "pb-wa-" + i, kind: "wall", x: 11, y: 0, w: 2, h: 7, rot: (i * 37) % 360 };
      const all = [ruin, wall];
      const wobj = buildTerrain("wall", 2, 7, "pb-wa-" + i, wall, all);
      const wbb = new THREE.Box3().setFromObject(wobj);
      assert(wbb.min.x >= -1 - 0.2 - 1e-6 && wbb.max.x <= 1 + 0.2 + 1e-6 && wbb.min.z >= -3.5 - 0.2 - 1e-6 && wbb.max.z <= 3.5 + 0.2 + 1e-6, "paired facade wall #" + i + " (rot " + wall.rot + ") stays within its own footprint bounds");
      const robj = buildTerrain("ruin", 11, 7, "pb-ru-" + i, ruin, all);
      const rbb = new THREE.Box3().setFromObject(robj);
      assert(rbb.min.x >= -5.5 - 0.2 - 1e-6 && rbb.max.x <= 5.5 + 0.2 + 1e-6 && rbb.min.z >= -3.5 - 0.2 - 1e-6 && rbb.max.z <= 3.5 + 0.2 + 1e-6, "paired ruin #" + i + " stays within its own footprint bounds");
    }
  }

  // ==================================================================
  console.log("== wood: canopy clearance >= 2.2in so minis are visible underneath ==");
  {
    for (let i = 0; i < 40; i++) {
      const plan = woodPlan("wood-clear-" + i, 10, 8);
      assert(plan.trees.length >= 3 && plan.trees.length <= 6, "wood #" + i + " has 3-6 trunks, got " + plan.trees.length);
      for (const t of plan.trees) {
        assert(t.trunkH >= 2.2, "wood #" + i + " trunk clearance " + t.trunkH.toFixed(2) + " >= 2.2");
        // the number that actually matters: TRUE geometric bottom of every canopy blob
        // (y - radius), not just the trunk height proxy — a wide low blob could otherwise
        // dip its underside below the trunk top even with a tall trunk.
        for (const b of t.blobs) assert(b.y - b.r >= 2.2 - 1e-6, "wood #" + i + " blob true bottom " + (b.y - b.r).toFixed(2) + " >= 2.2");
      }
    }
    const obj = buildTerrain("wood", 10, 8, "wood-clear-mesh");
    assert(obj.userData.canopyClearance >= 2.2, "built wood mesh reports canopyClearance >= 2.2 (" + obj.userData.canopyClearance.toFixed(2) + ")");
  }

  // ==================================================================
  console.log("== crate: containers (1-2 stacked ribbed) vs generator variant, seeded ~1-in-3 by id ==");
  {
    let sawTwo = false, gens = 0, cons = 0;
    for (let i = 0; i < 60; i++) {
      const plan = cratePlan("crate-stack-" + i, 3, 2);
      if (plan.mode === "generator") { gens++; continue; }
      cons++;
      assert(plan.containers.length === 1 || plan.containers.length === 2, "crate #" + i + " has 1 or 2 containers");
      if (plan.containers.length === 2) sawTwo = true;
      for (const c of plan.containers) assert(c.nRibs >= 2, "container has >=2 corrugation ribs");
    }
    assert(sawTwo, "at least one seed across 60 tries stacks 2 containers");
    assert(gens > 0 && cons > 0, "60 ids across produce BOTH container and generator variants, got gens=" + gens + " cons=" + cons);
    assert(gens / (gens + cons) > 0.15 && gens / (gens + cons) < 0.55, "generator variant rate is roughly 1-in-3 (got " + gens + "/" + (gens + cons) + ")");

    // determinism: same id -> same variant AND identical geometry
    const g1 = buildTerrain("crate", 3, 2, "crate-variant-det-1");
    const g2 = buildTerrain("crate", 3, 2, "crate-variant-det-1");
    assert(g1.userData.crateVariant === g2.userData.crateVariant, "crate variant choice is deterministic for a given id");
    assert(serializeGeo(g1) === serializeGeo(g2), "generator/container geometry is deterministic for a given id");

    // find a known generator id (deterministic hash) and sanity-check its mesh shape
    let genId = null;
    for (let i = 0; i < 60; i++) { if (cratePlan("gen-scan-" + i, 3, 2).mode === "generator") { genId = "gen-scan-" + i; break; } }
    assert(!!genId, "found at least one generator-variant id to spot-check");
    if (genId) {
      const gobj = buildTerrain("crate", 3, 2, genId);
      assert(gobj.userData.crateVariant === "generator", genId + " mesh reports crateVariant=generator");
      assert(gobj.userData.terrainHeight > 0, genId + " generator has positive terrainHeight");
    }
  }

  // ==================================================================
  console.log("== crater: rim raised, pad flat at ~y=0 (minis don't float), honest scorch (no ember glow) ==");
  {
    const plan = craterPlan("crater-1", 6, 6);
    assert(plan.rimH > 0, "crater rim has positive raised height");
    assert(plan.depth > 0, "crater bowl has positive recess depth");
    assert(plan.padR > 0 && plan.padR < plan.rimR, "crater center pad is smaller than the rim radius");
    assert(luminance(PALETTE.CRATER_PAL.pad) < 0.15, "crater scorch pad stays honestly dark (no ember glow option) — luminance " + luminance(PALETTE.CRATER_PAL.pad).toFixed(3));
  }

  // ==================================================================
  console.log("== palette: GW pre-painted identity (light rockcrete/bone, NOT dark gothic stone) ==");
  {
    assert(!!PALETTE, "module exports PALETTE for test/design-review assertions");
    assert(luminance(PALETTE.RUIN_PAL.plate) > 0.4, "ruin base plate reads LIGHT rockcrete, luminance " + luminance(PALETTE.RUIN_PAL.plate).toFixed(3) + " (v2 dark-stone plate was ~0.19)");
    assert(luminance(PALETTE.RUIN_PAL.slab) > 0.4, "ruin floor slab reads LIGHT bone/rockcrete, luminance " + luminance(PALETTE.RUIN_PAL.slab).toFixed(3));
    assert(luminance(PALETTE.WALL_PAL.facade) > 0.4, "wall facade (interior/clean face) reads LIGHT rockcrete, luminance " + luminance(PALETTE.WALL_PAL.facade).toFixed(3));
    assert(luminance(PALETTE.WALL_PAL.rubble) < luminance(PALETTE.WALL_PAL.facade), "wall's outward broken-rubble layer reads darker than its clean interior facade");

    // hazard stripe: high-contrast black/yellow, and yellow reads warm/yellow not neutral
    const yLum = luminance(PALETTE.HAZARD_YELLOW), kLum = luminance(PALETTE.HAZARD_BLACK);
    assert(yLum - kLum > 0.4, "hazard yellow/black stripe pair has strong luminance contrast (" + yLum.toFixed(2) + " vs " + kLum.toFixed(2) + ")");
    const y = rgb(PALETTE.HAZARD_YELLOW);
    assert(y.r > 150 && y.g > 110 && y.b < y.r * 0.6, "hazard stripe accent color reads yellow (r,g high, b low)");

    // glow lamp: warm tint (per contract: "pick a warm lamp color"), not the vehicle-pack's
    // example cool cyan/blue
    const glow = rgb(PALETTE.GLOW_LAMP);
    assert(glow.r > glow.b, "glow-lamp tint reads warm (red channel > blue channel), got " + PALETTE.GLOW_LAMP);

    // Munitorum container variants: olive + ochre, distinct from v2's rust-orange single tone
    assert(PALETTE.CONTAINER_VARIANTS.length >= 2, "at least 2 container palette variants (olive + ochre)");
    const olive = rgb(PALETTE.CONTAINER_VARIANTS[0].body);
    assert(olive.g >= olive.r * 0.85, "container variant 0 reads olive (green channel close to/above red)");
    const ochre = rgb(PALETTE.CONTAINER_VARIANTS[1].body);
    assert(ochre.r > ochre.b * 1.3, "container variant 1 reads ochre/warm-brown (red well above blue)");

    // barricade: distinct dark industrial steel, contrasts against the light rockcrete buildings
    assert(luminance(PALETTE.BARRICADE_PAL.panel) < luminance(PALETTE.RUIN_PAL.plate) - 0.15, "barricade panel reads darker/more industrial than the light rockcrete ruin plate");

    // aquila accent: dark bronze/black block, distinct from the light slab it sits on
    assert(luminance(PALETTE.AQUILA_BRONZE) < 0.25, "aquila accent block reads dark bronze/black");
  }

  // ==================================================================
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exitCode = 1; }
  else { console.log("PASS"); process.exitCode = 0; }
})();
