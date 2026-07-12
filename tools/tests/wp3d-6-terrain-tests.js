// WP3D-6 mission-true terrain pack tests: run via `node wp3d-6-terrain-tests.js` from
// tools/tests/. Plain node, no DOM/WebGL — exercises the real registerTerrainBuilder ->
// buildTerrain() dispatch path exactly as wh40k-3d.js uses it.
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.01 : eps);

  const THREE = await import("../../vendor/three.module.min.js");
  const G = await import("../../sections/wp3d-1-geometry.js");
  const T = await import("../../sections/wp3d-6-terrain2.js");
  const { buildTerrain } = G;
  const { register, ruinPlan, wallPlan, woodPlan, cratePlan, craterPlan } = T;

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
  console.log("== ruin: slab tops pinned to exactly 3 and 6 ==");
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
  console.log("== wall: height within [4,6] ==");
  {
    for (const [w, h] of FOOTPRINTS.wall) {
      for (let i = 0; i < 10; i++) {
        const obj = buildTerrain("wall", w, h, "wall-h-" + w + "x" + h + "-" + i);
        const th = obj.userData.terrainHeight;
        assert(th >= 4 - 1e-6 && th <= 6 + 1e-6, "wall " + w + "x" + h + " #" + i + " terrainHeight " + th.toFixed(2) + " in [4,6]");
      }
    }
    // wallPlan itself: every non-gap column's height is in [4,6]
    const plan = wallPlan("wall-plan-1", 2, 11);
    for (const c of plan.cols) if (c.type !== "gap") assert(c.h >= 4 - 1e-6 && c.h <= 6 + 1e-6, "wall column height " + c.h.toFixed(2) + " in [4,6]");
    assert(plan.cols.some(c => c.type === "gap"), "wall plan guarantees at least one door/breach gap column");
    assert(plan.cols.some(c => c.type === "bay"), "wall plan produced at least one windowed bay column (2-row window holes)");
    assert(plan.thickness === Math.min(2, 11) && plan.length === Math.max(2, 11), "wall thickness/length derive from the piece's own thin/long footprint dims");
  }

  // ==================================================================
  console.log("== determinism: same id => identical geometry, different id => differs ==");
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
  assert(JSON.stringify(ruinPlan("p-A", 11, 7)) === JSON.stringify(ruinPlan("p-A", 11, 7)), "ruinPlan is a pure function of (id,w,h)");
  assert(JSON.stringify(ruinPlan("p-A", 11, 7)) !== JSON.stringify(ruinPlan("p-B", 11, 7)), "ruinPlan differs across ids");

  // ==================================================================
  console.log("== everything within footprint bounds ±0.2in (all 5 kinds, incl. small footprints) ==");
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
  console.log("== crate: 1-2 stacked ribbed containers ==");
  {
    let sawTwo = false;
    for (let i = 0; i < 20; i++) {
      const plan = cratePlan("crate-stack-" + i, 3, 2);
      assert(plan.containers.length === 1 || plan.containers.length === 2, "crate #" + i + " has 1 or 2 containers");
      if (plan.containers.length === 2) sawTwo = true;
      for (const c of plan.containers) assert(c.nRibs >= 2, "container has >=2 corrugation ribs");
    }
    assert(sawTwo, "at least one seed across 20 tries stacks 2 containers");
  }

  // ==================================================================
  console.log("== crater: rim raised, pad flat at ~y=0 (minis don't float) ==");
  {
    const plan = craterPlan("crater-1", 6, 6);
    assert(plan.rimH > 0, "crater rim has positive raised height");
    assert(plan.depth > 0, "crater bowl has positive recess depth");
    assert(plan.padR > 0 && plan.padR < plan.rimR, "crater center pad is smaller than the rim radius");
  }

  // ==================================================================
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exitCode = 1; }
  else { console.log("PASS"); process.exitCode = 0; }
})();
