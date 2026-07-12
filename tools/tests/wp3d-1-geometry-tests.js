// WP3D-1 geometry-factory tests: run via `node wp3d-1-geometry-tests.js` from tools/tests/.
// Plain node, no DOM/WebGL — three.js core objects (BufferGeometry/InstancedMesh/Scene/etc.)
// are pure JS/math and construct fine without a canvas or GL context; only rendering needs
// one. Mocks window.WP3D's bridge shape per WP3D-CONTRACT.md.
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.01 : eps);

  const THREE = await import("../../vendor/three.module.min.js");
  const M = await import("../../sections/wp3d-1-geometry.js");
  const { WP3D_VOXELS, buildArchetypeGeometry, buildTerrain, buildBoard, buildDZ, buildObjectiveMarker, createSceneSync } = M;

  const SM_PAL = { hi: '#5a86cc', mid: '#2a4e92', lo: '#122446' };
  const WPV_FACTIONS = { SM: SM_PAL, ORK: { hi: '#8cbc4c', mid: '#4a7626', lo: '#1e360e' } };

  // ==================================================================
  console.log("== WP3D_VOXELS: table shape ==");
  const ARCHETYPES = ["skull", "shield", "helm", "steed", "wing", "claw", "tank", "titan", "fallback"];
  assert(ARCHETYPES.every(a => Array.isArray(WP3D_VOXELS[a]) && WP3D_VOXELS[a].length > 0), "all 9 archetype tables present and non-empty");
  for (const a of ARCHETYPES) {
    const boxesOk = WP3D_VOXELS[a].every(b => ['hi', 'mid', 'lo'].includes(b.c) && isFinite(b.x) && isFinite(b.w) && b.w > 0 && b.h > 0 && b.d > 0);
    assert(boxesOk, a + " boxes all have valid c tint + positive size");
  }

  // ==================================================================
  console.log("== buildArchetypeGeometry: every archetype builds ==");
  const CIRCLE_FP = { shape: 'c', dmm: 32 };
  const RECT_FP = { shape: 'r', wIn: 4.3, hIn: 7 };
  for (const a of ARCHETYPES) {
    const g = buildArchetypeGeometry(a, CIRCLE_FP, SM_PAL);
    assert(g && g.attributes && g.attributes.position.count > 0, a + " circle-footprint geometry builds with verts>0");
    assert(g.index && g.index.count > 0, a + " has triangles>0");
  }

  console.log("== vertex/triangle counts match box-count expectations ==");
  for (const a of ARCHETYPES) {
    // rect (non-oval) footprint => base is a BoxGeometry too, so tri count is exact:
    // every box (BoxGeometry, 1x1x1 segments) contributes exactly 24 verts / 12 tris.
    const g = buildArchetypeGeometry(a, { shape: 'r', wIn: 2, hIn: 2 }, SM_PAL);
    const boxCount = WP3D_VOXELS[a].length + 1; // + base hull plate
    assert(g.attributes.position.count === boxCount * 24, a + " rect-footprint vert count = (boxes+base)*24");
    assert(g.index.count / 3 === boxCount * 12, a + " rect-footprint tri count = (boxes+base)*12");
  }

  console.log("== bounding box respects footprint ==");
  {
    const g = buildArchetypeGeometry("skull", CIRCLE_FP, SM_PAL);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const expected = 32 / 25.4; // ~1.2598in
    assert(near(bb.max.x - bb.min.x, expected, 0.02), "32mm circle infantry bounding width ~1.26in (x)");
    assert(near(bb.max.z - bb.min.z, expected, 0.02), "32mm circle infantry bounding depth ~1.26in (z)");
    assert(bb.max.y > 0.5 && bb.max.y <= 1.25, "skull height within archetype target envelope");
  }
  {
    const g = buildArchetypeGeometry("tank", RECT_FP, SM_PAL);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    // "fills" the footprint: the base hull plate spans exactly wIn x hIn, so the merged
    // bounding box reaches AT LEAST that size (a barrel/weapon may legitimately overhang it).
    assert(bb.max.x - bb.min.x >= 4.3 - 0.02, "rect hull footprint fills wIn=4.3 (x)");
    assert(bb.max.z - bb.min.z >= 7.0 - 0.02, "rect hull footprint fills hIn=7.0 (z)");
  }

  console.log("== baked vertex colors contain palette hi/mid/lo ==");
  {
    const g = buildArchetypeGeometry("skull", CIRCLE_FP, SM_PAL);
    const colArr = g.attributes.color.array;
    const hi = new THREE.Color(SM_PAL.hi), mid = new THREE.Color(SM_PAL.mid), lo = new THREE.Color(SM_PAL.lo);
    const hasColor = c => {
      for (let i = 0; i < colArr.length; i += 3) {
        if (near(colArr[i], c.r, 0.001) && near(colArr[i + 1], c.g, 0.001) && near(colArr[i + 2], c.b, 0.001)) return true;
      }
      return false;
    };
    assert(hasColor(hi), "vertex colors include palette.hi");
    assert(hasColor(mid), "vertex colors include palette.mid");
    assert(hasColor(lo), "vertex colors include palette.lo");
  }

  console.log("== geometry cache: same key returns same object ==");
  {
    const g1 = buildArchetypeGeometry("tank", RECT_FP, SM_PAL);
    const g2 = buildArchetypeGeometry("tank", RECT_FP, SM_PAL);
    assert(g1 === g2, "identical (archetype,footprint-bucket,palette) returns cached geometry");
    const g3 = buildArchetypeGeometry("tank", RECT_FP, WPV_FACTIONS.ORK);
    assert(g3 !== g1, "different palette produces a different cached geometry");
  }

  // ==================================================================
  console.log("== terrain heights ==");
  {
    for (let i = 0; i < 8; i++) {
      const ruin = buildTerrain("ruin", 8, 8, "ruin" + i);
      const h = ruin.userData.terrainHeight;
      assert(h >= 6 && h <= 9, "ruin #" + i + " shell height " + h.toFixed(2) + " in [6,9]");
    }
    const wall = buildTerrain("wall", 4, 1, "w1");
    assert(wall.userData.terrainHeight === 1, "wall height is exactly 1in");
    const crater = buildTerrain("crater", 4, 4, "c1");
    assert(crater.userData.terrainHeight === 0, "crater is recessed (0 height above ground)");
    const crate = buildTerrain("crate", 2, 2, "cr1");
    assert(crate.children.length >= 2 && crate.children.length <= 4, "crate stacks 2-4 boxes");
  }

  console.log("== wood tree-scatter: deterministic by id, differs across ids ==");
  {
    const serialize = grp => grp.children.map(c => [c.position.x.toFixed(6), c.position.y.toFixed(6), c.position.z.toFixed(6)]).join(";");
    const woodA1 = buildTerrain("wood", 12, 12, "treeline-A");
    const woodA2 = buildTerrain("wood", 12, 12, "treeline-A");
    const woodB = buildTerrain("wood", 12, 12, "treeline-B");
    assert(serialize(woodA1) === serialize(woodA2), "same terrain id => identical tree scatter");
    assert(serialize(woodA1) !== serialize(woodB), "different terrain id => different tree scatter");
    assert(woodA1.children.length > 0, "wood terrain scatters at least one tree");
  }

  // ==================================================================
  console.log("== buildBoard / buildDZ / buildObjectiveMarker ==");
  {
    const board = buildBoard(60, 44);
    board.geometry.computeBoundingBox();
    const bb = board.geometry.boundingBox;
    assert(near(bb.min.x, 0, 0.01) && near(bb.max.x, 60, 0.01), "board spans x in [0,60]");
    assert(near(bb.min.z, 0, 0.01) && near(bb.max.z, 44, 0.01), "board spans z in [0,44]");

    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }];
    const dz = buildDZ(poly, '#c0392b');
    dz.geometry.computeBoundingBox();
    const dbb = dz.geometry.boundingBox;
    assert(near(dbb.min.x, 0) && near(dbb.max.x, 10), "DZ decal spans x matching poly");
    assert(near(dbb.min.z, 0) && near(dbb.max.z, 5), "DZ decal spans z matching poly.y");
    assert(near(dbb.min.y, 0.01) && near(dbb.max.y, 0.01), "DZ decal sits at y≈0.01");

    const marker = buildObjectiveMarker();
    assert(marker.geometry.parameters.radiusTop && near(marker.geometry.parameters.radiusTop, 40 / 25.4 / 2, 0.01), "objective marker radius = 40mm/2");
  }

  // ==================================================================
  console.log("== createSceneSync: 300-token synthetic state ==");
  const bridge = {
    sel: new Set(),
    wpvGlyphFor: kw => {
      const k = (kw || []).map(s => String(s).toUpperCase());
      if (k.includes("TITANIC")) return "titan";
      if (k.includes("VEHICLE")) return "tank";
      if (k.includes("CHARACTER")) return "helm";
      if (k.includes("MOUNTED")) return "steed";
      return "skull";
    },
    wpvSideFid: side => (side === 1 ? "SM" : "ORK"),
    WPV_FACTIONS,
  };

  function makeToken(i) {
    const kwPool = [["INFANTRY"], ["VEHICLE"], ["CHARACTER"], ["MOUNTED"]];
    return {
      id: "tok" + i, owner: (i % 2) + 1, unit: "u", name: "n", shape: 'c', dmm: 32,
      x: (i % 24) * 2 + 1, y: Math.floor(i / 24) * 2 + 1, rot: (i * 13) % 360,
      wounds: 2, maxW: 2, kw: kwPool[i % 4], lvl: (i % 5 === 0) ? 1 : 0,
    };
  }
  const tokens = [];
  for (let i = 0; i < 300; i++) tokens.push(makeToken(i));
  const terrain = [{ id: "ru1", kind: "ruin", x: 0, y: 0, w: 6, h: 6, rot: 0 }];
  const objectives = [{ id: "obj1", x: 20, y: 20 }, { id: "obj2", x: 5, y: 5 }];
  const dz = [
    [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 6 }, { x: 0, y: 6 }],
    [{ x: 0, y: 38 }, { x: 60, y: 38 }, { x: 60, y: 44 }, { x: 0, y: 44 }],
  ];
  let state = { tokens, terrain, objectives, dz };

  const scene = new THREE.Scene();
  const sync = createSceneSync(THREE, scene, bridge);
  sync.tick(state);

  const pools1 = sync.pickMeshes();
  const totalInstances1 = pools1.reduce((s, m) => s + m.count, 0);
  assert(totalInstances1 === 300, "sum of pool instance counts == token count (300)");
  assert(pools1.length > 1 && pools1.length <= 16, "pools bucketed reasonably (>1, bounded, not 300)");

  console.log("== terrain/objective/DZ populated ==");
  // objectives/terrain/dz are added directly to `scene` by sceneSync — count distinct object kinds
  let objMarkers = 0, dzDecals = 0, terrainGroups = 0;
  scene.traverse(o => {
    if (o.userData && o.userData.isObjective) objMarkers++;
    if (o.userData && o.userData.isDZ) dzDecals++;
  });
  assert(objMarkers === 2, "2 objective markers added to scene");
  assert(dzDecals === 2, "2 DZ decals added to scene (red+blue)");

  console.log("== elevationFor: lvl*3 inside ruin footprint, else 0 ==");
  {
    const insideRuin = { x: 3, y: 3, lvl: 1 };
    const outsideRuin = { x: 30, y: 30, lvl: 1 };
    const groundFloor = { x: 3, y: 3, lvl: 0 };
    assert(sync.elevationFor(insideRuin) === 3, "token inside ruin at lvl 1 => elevation 3");
    assert(sync.elevationFor(outsideRuin) === 0, "token outside any ruin => elevation 0 regardless of lvl");
    assert(sync.elevationFor(groundFloor) === 0, "token at lvl 0 inside ruin => elevation 0");
  }

  console.log("== tokenAt round-trips instanceId -> tokenId ==");
  {
    let found = 0, checked = 0;
    for (const mesh of pools1) {
      const ids = mesh.userData.slotTokenId;
      for (let i = 0; i < mesh.count; i++) {
        checked++;
        const tid = sync.tokenAt({ object: mesh, instanceId: i });
        if (tid === ids[i]) found++;
      }
    }
    assert(checked === 300 && found === 300, "tokenAt(instanceId) resolves the correct tokenId for all " + checked + " instances");
    assert(sync.tokenAt({ object: pools1[0], instanceId: null }) === null, "tokenAt with null instanceId => null");
    assert(sync.tokenAt(null) === null, "tokenAt with null intersection => null");
  }

  console.log("== rim colors correct (owner red/blue) ==");
  {
    // rim pool isn't part of pickMeshes() (that's token pools only) — reach it via scene traversal
    // by finding an InstancedMesh with instanceColor and count===300 that isn't a token pool.
    const tokenPoolSet = new Set(pools1);
    let rimMesh = null;
    scene.traverse(o => { if (o.isInstancedMesh && o.instanceColor && !tokenPoolSet.has(o) && o.count === 300) rimMesh = o; });
    assert(!!rimMesh, "rim InstancedMesh found in scene with instanceColor + count==300");
    if (rimMesh) {
      const col = new THREE.Color();
      const RED = new THREE.Color('#c03d3d'), BLUE = new THREE.Color('#3d7ec0');
      let redOk = true, blueOk = true;
      for (let i = 0; i < 300; i++) {
        rimMesh.getColorAt(i, col);
        const t = tokens[i];
        const expected = t.owner === 1 ? RED : BLUE;
        const ok = near(col.r, expected.r, 0.01) && near(col.g, expected.g, 0.01) && near(col.b, expected.b, 0.01);
        if (t.owner === 1 && !ok) redOk = false;
        if (t.owner === 2 && !ok) blueOk = false;
      }
      assert(redOk, "owner-1 tokens have red rim color");
      assert(blueOk, "owner-2 tokens have blue rim color");
    }
  }

  console.log("== selection ring: gold, count == bridge.sel.size ==");
  {
    bridge.sel.add("tok0"); bridge.sel.add("tok5"); bridge.sel.add("tok10");
    sync.tick(state);
    const tokenPoolSet = new Set(sync.pickMeshes());
    let selMesh = null;
    scene.traverse(o => { if (o.isInstancedMesh && !o.instanceColor && !tokenPoolSet.has(o) && o.count === bridge.sel.size) selMesh = o; });
    assert(!!selMesh, "selection InstancedMesh count matches bridge.sel.size (3)");
    if (selMesh) {
      const mat = selMesh.material;
      const gold = new THREE.Color(0xe8c34a);
      assert(near(mat.color.r, gold.r, 0.01) && near(mat.color.g, gold.g, 0.01) && near(mat.color.b, gold.b, 0.01), "selection ring material is gold #e8c34a");
    }
    bridge.sel.clear();
    sync.tick(state);
    const tokenPoolSet2 = new Set(sync.pickMeshes());
    let selMesh2 = null;
    scene.traverse(o => { if (o.isInstancedMesh && !o.instanceColor && !tokenPoolSet2.has(o) && o.material && o.material.color && near(o.material.color.r, gold_r(), 0.01)) selMesh2 = o; });
    function gold_r() { return new THREE.Color(0xe8c34a).r; }
    assert(!!selMesh2 && selMesh2.count === 0, "selection ring count drops to 0 when bridge.sel is empty");
  }

  // ==================================================================
  console.log("== second tick after moving one token: diff maps stable ==");
  {
    const poolsBefore = new Set(sync.pickMeshes());
    tokens[0].x = tokens[0].x + 5; // move only
    sync.tick(state);
    const poolsAfter = new Set(sync.pickMeshes());
    assert(poolsBefore.size === poolsAfter.size, "same number of pools after a pure-transform tick");
    let samePoolIdentity = true;
    for (const p of poolsBefore) if (!poolsAfter.has(p)) samePoolIdentity = false;
    assert(samePoolIdentity, "pool mesh objects are the SAME references across ticks (no needless rebuild)");
    const totalAfter = sync.pickMeshes().reduce((s, m) => s + m.count, 0);
    assert(totalAfter === 300, "instance total unchanged after moving one token");
  }

  console.log("== tick with a token removed releases its slot ==");
  {
    const totalBefore = sync.pickMeshes().reduce((s, m) => s + m.count, 0);
    const removedToken = tokens.pop(); // drop last token entirely
    state = { tokens, terrain, objectives, dz };
    sync.tick(state);
    const totalAfter = sync.pickMeshes().reduce((s, m) => s + m.count, 0);
    assert(totalAfter === totalBefore - 1, "total instance count drops by exactly 1 after removing a token");
    let stillReferencesRemoved = false;
    for (const mesh of sync.pickMeshes()) {
      const ids = mesh.userData.slotTokenId;
      for (let i = 0; i < mesh.count; i++) if (ids[i] === removedToken.id) stillReferencesRemoved = true;
    }
    assert(!stillReferencesRemoved, "removed token id no longer resolvable via any active pool slot");
  }

  console.log("== terrain add/remove diff by id ==");
  {
    const terrain2 = terrain.concat([{ id: "ru2", kind: "wall", x: 20, y: 20, w: 2, h: 1, rot: 0 }]);
    state = { tokens, terrain: terrain2, objectives, dz };
    sync.tick(state);
    let terrainMeshCount = 0;
    scene.traverse(o => { if (o.userData && o.userData.terrainHeight !== undefined) terrainMeshCount++; });
    assert(terrainMeshCount === 2, "2 terrain groups present after adding a wall");
    state = { tokens, terrain, objectives, dz }; // remove it again
    sync.tick(state);
    terrainMeshCount = 0;
    scene.traverse(o => { if (o.userData && o.userData.terrainHeight !== undefined) terrainMeshCount++; });
    assert(terrainMeshCount === 1, "terrain group removed from scene when id disappears from state");
  }

  console.log("== dispose() releases resources ==");
  {
    sync.dispose();
    const remaining = scene.children.length;
    assert(remaining === 0, "dispose() removes all sceneSync-owned objects from the scene (scene.children==0), got " + remaining);
  }

  // ==================================================================
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exitCode = 1; }
  else { console.log("PASS"); process.exitCode = 0; }
})();
