// WP3D-9 environment-pack tests — plain node, real THREE (no renderer/canvas needed since
// createEnvironment only touches Scene/Light/Mesh objects, which are pure JS/math in
// three.js). Exercises the full plug-in surface exactly as the orchestrator wires it:
// createEnvironment() installs setPoolMaterialFactory/setMeshDecorator BEFORE the first
// createSceneSync().tick(), so the lit-material conversion is verified end-to-end through
// real token/terrain/board scene-sync output, not just by poking createEnvironment's return
// value. Run: node tools/tests/wp3d-9-environment-tests.js
import * as THREE from "../../vendor/three.module.min.js";
import { createSceneSync } from "../../sections/wp3d-1-geometry.js";
import { createEnvironment } from "../../sections/wp3d-9-environment.js";

let passed = 0, failed = 0;
const assert = (ok, name) => {
  if (ok) { passed++; console.log("ok - " + name); }
  else { failed++; console.log("FAIL: " + name); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const BOARD = { w: 44, h: 60 };
const DESKTOP_TIER = { pixelRatioCap: 2, antialias: true, labelEvery: 1, shadows: true };
const PHONE_TIER = { pixelRatioCap: 1.5, antialias: false, labelEvery: 2, shadows: false };

// Minimal bridge + a handful of tokens/terrain/board state, same shape wp3d-1-geometry-tests
// uses for createSceneSync.
const bridge = {
  sel: new Set(),
  wpvGlyphFor: (kw) => ((kw || []).includes("VEHICLE") ? "tank" : "skull"),
  wpvSideFid: (side) => (side === 1 ? "SM" : "ORK"),
  WPV_FACTIONS: {
    SM: { hi: "#5a86cc", mid: "#2a4e92", lo: "#122446" },
    ORK: { hi: "#8cbc4c", mid: "#4a7626", lo: "#1e360e" },
  },
};
function makeState() {
  return {
    board: BOARD,
    tokens: [
      { id: "t1", owner: 1, shape: "c", dmm: 32, x: 5, y: 5, rot: 0, kw: ["INFANTRY"] },
      { id: "t2", owner: 2, shape: "c", dmm: 32, x: 10, y: 10, rot: 90, kw: ["VEHICLE"] },
    ],
    terrain: [{ id: "ru1", kind: "ruin", x: 0, y: 0, w: 6, h: 6, rot: 0 }],
    objectives: [],
    dz: [],
  };
}
function fakeRenderer() {
  return { shadowMap: { enabled: false, type: null } };
}

// A stub decorator/factory sentinel to prove createEnvironment's dispose() really calls
// setPoolMaterialFactory(null)/setMeshDecorator(null) (not just that createEnvironment
// *could* — spinning up a second, independent createSceneSync after dispose and checking
// its output reverted to the built-in unlit materials is the strongest real-world proof).

// ---------------------------------------------------------------------------
// 1. createEnvironment adds lights/table/background/fog; returns {dispose()}
// ---------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const env = createEnvironment(THREE, scene, BOARD, DESKTOP_TIER, fakeRenderer());
  assert(typeof env.dispose === "function", "createEnvironment returns { dispose }");

  const lights = scene.children.filter((o) => o.isLight);
  const hemi = lights.find((o) => o.isHemisphereLight);
  const key = lights.find((o) => o.isDirectionalLight);
  assert(!!hemi, "a HemisphereLight is added to the scene");
  assert(!!key, "a DirectionalLight (key) is added to the scene");
  assert(hemi.intensity > 0 && hemi.intensity < 1, "hemisphere intensity is a gentle fill (0,1)");
  assert(key.intensity > 0 && key.intensity < 1.5, "key light intensity is in a non-blown-out range");

  const apron = scene.children.find((o) => o.userData && o.userData.isTableApron);
  const edge = scene.children.find((o) => o.userData && o.userData.isTableEdge);
  assert(!!apron, "table apron mesh added to the scene");
  assert(!!edge, "table edge/drop mesh added to the scene");

  assert(scene.background != null, "scene.background is set (room backdrop)");
  assert(scene.fog != null && scene.fog.isFog, "scene.fog is set (depth fog)");

  env.dispose();
}

// ---------------------------------------------------------------------------
// 2. Table apron/edge bounds: board + TABLE_MARGIN on every side, centered on the board
// ---------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const env = createEnvironment(THREE, scene, BOARD, DESKTOP_TIER, fakeRenderer());
  const apron = scene.children.find((o) => o.userData && o.userData.isTableApron);
  apron.geometry.computeBoundingBox();
  const bb = apron.geometry.boundingBox;
  const MARGIN = 4; // contract: "~4in beyond the board on all sides"
  assert(near(bb.min.x, -MARGIN, 0.01) && near(bb.max.x, BOARD.w + MARGIN, 0.01),
    "table apron spans board width + margin on both sides (x)");
  assert(near(bb.min.z, -MARGIN, 0.01) && near(bb.max.z, BOARD.h + MARGIN, 0.01),
    "table apron spans board height + margin on both sides (z)");
  assert(apron.position.y < 0, "table apron sits just below the board mat plane (y<0), no z-fight");

  const edge = scene.children.find((o) => o.userData && o.userData.isTableEdge);
  assert(near(edge.geometry.parameters.width, BOARD.w + MARGIN * 2, 0.01), "table edge width matches apron footprint");
  assert(near(edge.geometry.parameters.depth, BOARD.h + MARGIN * 2, 0.01), "table edge depth matches apron footprint");
  assert(edge.position.y < apron.position.y, "table edge hangs below the apron (the chunky drop)");

  env.dispose();
}

// ---------------------------------------------------------------------------
// 3. Shadow tiering: desktop casts + sized shadow camera; phone skips shadows entirely
// ---------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const renderer = fakeRenderer();
  const env = createEnvironment(THREE, scene, BOARD, DESKTOP_TIER, renderer);
  const key = scene.children.find((o) => o.isDirectionalLight);
  assert(key.castShadow === true, "desktop tier: key light casts shadows");
  const diag = Math.hypot(BOARD.w, BOARD.h);
  const cam = key.shadow.camera;
  assert(cam.right - cam.left >= diag, "desktop tier: shadow camera frustum width covers the board diagonal");
  assert(cam.top - cam.bottom >= diag, "desktop tier: shadow camera frustum height covers the board diagonal");
  assert(key.shadow.mapSize.width === 2048 && key.shadow.mapSize.height === 2048,
    "desktop tier: shadow map is 2048x2048");
  assert(renderer.shadowMap.enabled === true, "desktop tier: renderer.shadowMap.enabled honored");
  assert(renderer.shadowMap.type === THREE.PCFSoftShadowMap, "desktop tier: renderer uses PCFSoftShadowMap");
  env.dispose();
}
{
  const scene = new THREE.Scene();
  const renderer = fakeRenderer();
  const env = createEnvironment(THREE, scene, BOARD, PHONE_TIER, renderer);
  const key = scene.children.find((o) => o.isDirectionalLight);
  assert(key.castShadow === false, "phone tier: key light does not cast shadows");
  assert(renderer.shadowMap.enabled === false, "phone tier: renderer.shadowMap.enabled stays off");
  env.dispose();
}

// ---------------------------------------------------------------------------
// 4. Integration: installed BEFORE the first sceneSync tick lights/converts everything
// ---------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const env = createEnvironment(THREE, scene, BOARD, DESKTOP_TIER, fakeRenderer());
  const sync = createSceneSync(THREE, scene, bridge);
  sync.tick(makeState());

  const pools = sync.pickMeshes();
  assert(pools.length > 0, "token pools were created");
  for (const mesh of pools) {
    assert(mesh.material.isMeshLambertMaterial, "token pool material is MeshLambertMaterial (lit)");
    assert(mesh.material.vertexColors === true, "token pool material keeps vertexColors:true");
    assert(mesh.castShadow === true, "token pool (role 'tokens') casts shadows on desktop tier");
  }

  // board: buildBoard's plain-node fallback material (no DOM => flat MeshBasicMaterial
  // color) should have been converted to a lit Lambert material by the decorator, and
  // flagged to receive shadows (role 'board').
  const boardMesh = scene.children.find((o) => o.userData && o.userData.isBoard);
  assert(!!boardMesh, "board mesh present in the scene");
  assert(boardMesh.material.isMeshLambertMaterial, "board material converted Basic -> Lambert");
  assert(boardMesh.material.color.getHexString() === "2b3026", "board material preserves its original color");
  assert(boardMesh.receiveShadow === true, "board (role 'board') receives shadows on desktop tier, does not need to cast");

  // terrain: buildTerrain's ruin group has multiple Mesh children, all originally
  // MeshBasicMaterial — every one should now be lit + cast/receive.
  let terrainMeshCount = 0;
  scene.traverse((o) => {
    if (o.isMesh && o.parent && o.parent.userData && o.parent.userData.terrainHeight != null) {
      terrainMeshCount++;
      assert(o.material.isMeshLambertMaterial, "terrain child mesh material converted Basic -> Lambert");
      assert(o.castShadow === true && o.receiveShadow === true, "terrain child mesh casts+receives shadows on desktop tier");
    }
  });
  assert(terrainMeshCount > 0, "at least one terrain child mesh was decorated (ruin group has wall segments)");

  sync.dispose();
  env.dispose();
}

// ---------------------------------------------------------------------------
// 5. Phone tier: everything still lit, but nothing casts/receives shadows
// ---------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const env = createEnvironment(THREE, scene, BOARD, PHONE_TIER, fakeRenderer());
  const sync = createSceneSync(THREE, scene, bridge);
  sync.tick(makeState());

  const pools = sync.pickMeshes();
  for (const mesh of pools) {
    assert(mesh.material.isMeshLambertMaterial, "phone tier: token pool material still lit (Lambert)");
    assert(mesh.castShadow === false, "phone tier: token pool does not cast shadows");
  }
  const boardMesh = scene.children.find((o) => o.userData && o.userData.isBoard);
  assert(boardMesh.material.isMeshLambertMaterial, "phone tier: board material still lit (Lambert)");
  assert(boardMesh.receiveShadow === false, "phone tier: board does not receive shadows");

  sync.dispose();
  env.dispose();
}

// ---------------------------------------------------------------------------
// 6. dispose(): resets the plug-in surface — a FRESH sceneSync after dispose reverts to
//    the built-in unlit materials (real proof setPoolMaterialFactory(null)/
//    setMeshDecorator(null) were actually called, not just that dispose() ran).
// ---------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const env = createEnvironment(THREE, scene, BOARD, DESKTOP_TIER, fakeRenderer());
  env.dispose();

  assert(scene.children.filter((o) => o.isLight).length === 0, "dispose(): lights removed from the scene");
  assert(!scene.children.some((o) => o.userData && (o.userData.isTableApron || o.userData.isTableEdge)),
    "dispose(): table apron+edge removed from the scene");
  assert(scene.background === null, "dispose(): scene.background reset");
  assert(scene.fog === null, "dispose(): scene.fog reset");

  const sync = createSceneSync(THREE, scene, bridge);
  sync.tick(makeState());
  const pools = sync.pickMeshes();
  assert(pools.length > 0, "post-dispose: a fresh sceneSync still builds token pools");
  for (const mesh of pools) {
    assert(mesh.material.isMeshBasicMaterial, "post-dispose: token pool material reverted to the built-in unlit Basic material");
  }
  const boardMesh = scene.children.find((o) => o.userData && o.userData.isBoard);
  assert(boardMesh.material.isMeshBasicMaterial, "post-dispose: board material reverted to unlit Basic (decorator uninstalled)");

  sync.dispose();

  // idempotent: calling dispose() twice must not throw.
  let threw = false;
  try { env.dispose(); } catch (e) { threw = true; }
  assert(!threw, "dispose(): calling dispose() a second time does not throw");
}

// ---------------------------------------------------------------------------
// 7. Plain-node fallbacks (no DOM/document in this test runner): wood texture and room
//    background both fall back to flat colors, never throw.
// ---------------------------------------------------------------------------
{
  assert(typeof document === "undefined", "sanity: this test runs with no DOM (exercises the real node fallback path)");
  const scene = new THREE.Scene();
  const env = createEnvironment(THREE, scene, BOARD, DESKTOP_TIER, fakeRenderer());
  const apron = scene.children.find((o) => o.userData && o.userData.isTableApron);
  assert(apron.material.map == null, "no-DOM fallback: table apron has no wood texture map");
  assert(apron.material.color.getHexString() === "6b4226", "no-DOM fallback: table apron uses the flat brown fallback color");
  assert(scene.background.isColor === true, "no-DOM fallback: scene.background falls back to a flat Color (no CanvasTexture)");
  env.dispose();
}

// ---------------------------------------------------------------------------
// 8. Different board sizes: shadow camera + table footprint scale with the board, not a
//    hardcoded constant (determinism/robustness check).
// ---------------------------------------------------------------------------
{
  const bigBoard = { w: 96, h: 60 }; // a large multi-table setup
  const scene = new THREE.Scene();
  const env = createEnvironment(THREE, scene, bigBoard, DESKTOP_TIER, fakeRenderer());
  const key = scene.children.find((o) => o.isDirectionalLight);
  const diag = Math.hypot(bigBoard.w, bigBoard.h);
  const cam = key.shadow.camera;
  assert(cam.right - cam.left >= diag, "large board: shadow camera frustum still covers the (bigger) board diagonal");
  const apron = scene.children.find((o) => o.userData && o.userData.isTableApron);
  apron.geometry.computeBoundingBox();
  const bb = apron.geometry.boundingBox;
  assert(near(bb.max.x - bb.min.x, bigBoard.w + 8, 0.01), "large board: apron width scales with board width + margin");
  env.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
