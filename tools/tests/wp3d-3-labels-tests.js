// WP3D-3 label layer tests: run via  node tools/tests/wp3d-3-labels-tests.js
// Plain node, no DOM: a ~20-line fake document (createElement -> object tracking
// style/textContent/children) stands in for the browser, and a REAL THREE.PerspectiveCamera
// (loaded straight from vendor/three.module.min.js, same pinned r170 build the app ships)
// supplies real NDC projection math so the "known board position -> known CSS px" test isn't
// hand-waved. Covers: projection->CSS px correctness, behind-camera invisibility, div pooling
// (no growth in steady state), extras.labelEvery throttling (skips rig.project on skipped
// ticks), wound-label gating on wounds<maxW, and verbatim delegation of extras.moveReadout text.
"use strict";

let passed = 0, failed = 0;
const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 0.5 : eps);

// ---------- fake DOM ----------
function makeFakeDoc() {
  function makeEl() {
    return {
      style: {},
      textContent: "",
      children: [],
      clientWidth: 0,
      clientHeight: 0,
      appendChild(c) { this.children.push(c); c.parentNode = this; },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        return c;
      },
    };
  }
  return { createElement: () => makeEl(), _makeEl: makeEl };
}

(async () => {
  const path = require("path");
  const THREE = await import(path.join(__dirname, "..", "..", "vendor", "three.module.min.js"));
  const { createLabelLayer } = await import(path.join(__dirname, "..", "..", "sections", "wp3d-3-labels.js"));

  // A rig stand-in built from a REAL THREE.PerspectiveCamera, matching WP3D-2's frozen
  // `project(v3) -> {x,y,visible}` contract (NDC coords + a front-of-camera visibility flag).
  // This is test-authored, not part of the WP3D-3 module (rig is WP3D-2's deliverable).
  function makeRig(camera) {
    return {
      project(v3) {
        const camSpace = v3.clone().applyMatrix4(camera.matrixWorldInverse);
        const inFront = camSpace.z < 0;
        const p = v3.clone().project(camera);
        return { x: p.x, y: p.y, visible: inFront && p.z >= -1 && p.z <= 1 };
      },
    };
  }
  function ndcToPx(ndcX, ndcY, w, h) {
    return { x: (ndcX * 0.5 + 0.5) * w, y: (1 - (ndcY * 0.5 + 0.5)) * h };
  }

  const doc = makeFakeDoc();

  // ---------- test 1: known token position -> expected CSS px ----------
  {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const rig = makeRig(camera);

    const containerDiv = doc.createElement();
    containerDiv.clientWidth = 800; containerDiv.clientHeight = 600;
    const bridge = { sel: new Set() };
    const layer = createLabelLayer(containerDiv, bridge, doc);

    const tok = { id: "t1", owner: 1, unit: "u1", name: "Intercessor", shape: "c", dmm: 32,
      x: 5, y: 5, rot: 0, wounds: 3, maxW: 5, kw: [] };
    const state = { tokens: [tok] };
    layer.tick(rig, state, { heightFor: () => 0 });

    const v = new THREE.Vector3(5, 0, 5);
    const ndc = v.clone().project(camera);
    const exp = ndcToPx(ndc.x, ndc.y, 800, 600);

    const woundEl = containerDiv.children.find(c => c.textContent === "3/5");
    assert(!!woundEl, "wound label '3/5' rendered for a damaged token");
    assert(woundEl && near(parseFloat(woundEl.style.cssText.match(/left:([\d.]+)px/)[1]), exp.x, 0.5),
      "wound label CSS left matches hand-computed camera.project() NDC->px");
    assert(woundEl && near(parseFloat(woundEl.style.cssText.match(/top:([\d.]+)px/)[1]), exp.y, 0.5),
      "wound label CSS top matches hand-computed camera.project() NDC->px");
    assert(woundEl && woundEl.style.cssText.includes("#c03d3d"), "wound label carries the red #c03d3d border");
  }

  // ---------- test 2: behind-camera token is hidden ----------
  {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 5, 0);
    camera.lookAt(0, 0, -10); // camera looks toward -z
    camera.updateMatrixWorld(true);
    const rig = makeRig(camera);

    const containerDiv = doc.createElement();
    containerDiv.clientWidth = 800; containerDiv.clientHeight = 600;
    const layer = createLabelLayer(containerDiv, { sel: new Set() }, doc);

    // token behind the camera (+z, camera looks -z)
    const tok = { id: "t2", owner: 1, unit: "u2", name: "Behind", shape: "c", dmm: 32,
      x: 0, y: 20, rot: 0, wounds: 2, maxW: 5, kw: [] };
    const state = { tokens: [tok] };
    layer.tick(rig, state, { heightFor: () => 0 });

    const visibleWound = containerDiv.children.find(c => c.textContent === "2/5" && c.style.display !== "none");
    assert(!visibleWound, "token behind the camera produces no visible label (display:none)");
  }

  // ---------- test 3: pooled divs reused across ticks (no growth in steady state) ----------
  {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const rig = makeRig(camera);

    const containerDiv = doc.createElement();
    containerDiv.clientWidth = 800; containerDiv.clientHeight = 600;
    const layer = createLabelLayer(containerDiv, { sel: new Set() }, doc);

    const tok = { id: "t3", owner: 1, unit: "u3", name: "Steady", shape: "c", dmm: 32,
      x: 3, y: 3, rot: 0, wounds: 1, maxW: 5, kw: [], sgt: true };
    const state = { tokens: [tok] };
    layer.tick(rig, state, { heightFor: () => 0 });
    const sizeAfter1 = containerDiv.children.length;
    for (let i = 0; i < 8; i++) layer.tick(rig, state, { heightFor: () => 0 });
    const sizeAfter9 = containerDiv.children.length;
    assert(sizeAfter1 > 0, "pool grows to cover the first tick's needed labels");
    assert(sizeAfter1 === sizeAfter9, "pool size stable across 8 more identical ticks (no per-tick create/destroy)");
  }

  // ---------- test 4: labelEvery throttling skips rig.project on skipped ticks ----------
  {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const baseRig = makeRig(camera);
    let calls = 0;
    const spyRig = { project(v3) { calls++; return baseRig.project(v3); } };

    const containerDiv = doc.createElement();
    containerDiv.clientWidth = 800; containerDiv.clientHeight = 600;
    const layer = createLabelLayer(containerDiv, { sel: new Set() }, doc);

    const tok = { id: "t4", owner: 1, unit: "u4", name: "Throttled", shape: "c", dmm: 32,
      x: 2, y: 2, rot: 0, wounds: 1, maxW: 4, kw: [] };
    const state = { tokens: [tok] };
    const extras = { heightFor: () => 0, labelEvery: 3 };

    layer.tick(spyRig, state, extras);
    const posAfterTick1 = containerDiv.children.find(c => c.textContent === "1/4").style.cssText;
    layer.tick(spyRig, state, extras);
    layer.tick(spyRig, state, extras);
    const posAfterTick3 = containerDiv.children.find(c => c.textContent === "1/4").style.cssText;

    assert(calls === 1, "rig.project called exactly once across 3 ticks with labelEvery=3 (calls=" + calls + ")");
    assert(posAfterTick1 === posAfterTick3, "label position held from the cached projection across the throttled ticks");

    layer.tick(spyRig, state, extras); // tick 4 = (4-1)%3===0 -> re-project
    assert(calls === 2, "the 4th tick (Nth again) re-projects (calls=" + calls + ")");
  }

  // ---------- test 5: wound label only when wounds<maxW ----------
  {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const rig = makeRig(camera);

    const containerDiv = doc.createElement();
    containerDiv.clientWidth = 800; containerDiv.clientHeight = 600;
    const layer = createLabelLayer(containerDiv, { sel: new Set() }, doc);

    const hurt = { id: "h1", owner: 1, unit: "u5", name: "Hurt", shape: "c", dmm: 32, x: 1, y: 1, rot: 0, wounds: 2, maxW: 5, kw: [] };
    const full = { id: "h2", owner: 1, unit: "u5", name: "Full", shape: "c", dmm: 32, x: 2, y: 1, rot: 0, wounds: 5, maxW: 5, kw: [] };
    const state = { tokens: [hurt, full] };
    layer.tick(rig, state, { heightFor: () => 0 });

    assert(!!containerDiv.children.find(c => c.textContent === "2/5"), "damaged token (wounds<maxW) shows its wound fraction");
    assert(!containerDiv.children.some(c => c.textContent === "5/5"), "full-health token (wounds===maxW) shows no wound label");
  }

  // ---------- test 6: delegation — extras.moveReadout shown byte-for-byte ----------
  {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const rig = makeRig(camera);

    const containerDiv = doc.createElement();
    containerDiv.clientWidth = 800; containerDiv.clientHeight = 600;
    const selTok = { id: "sel1", owner: 1, unit: "u6", name: "Mover", shape: "c", dmm: 32, x: 0, y: 0, rot: 0, wounds: 5, maxW: 5, kw: [] };
    const bridge = { sel: new Set(["sel1"]) };
    const layer = createLabelLayer(containerDiv, bridge, doc);
    const state = { tokens: [selTok] };

    const weirdReadout = "6.0\" of 8\"+D6 — M8 <b>advance</b> pending";
    layer.tick(rig, state, { heightFor: () => 0, moveReadout: weirdReadout });
    assert(!!containerDiv.children.find(c => c.textContent === weirdReadout),
      "extras.moveReadout text appears verbatim, unmodified (delegation, not reformatted)");

    // ruler distance display: also a direct pass-through of the pre-supplied dist number
    layer.tick(rig, state, { heightFor: () => 0, ruler: { x0: 0, y0: 0, x1: 3, y1: 4, dist: 5 } });
    assert(!!containerDiv.children.find(c => c.textContent === '5.0"'),
      'ruler pill shows dist.toFixed(1)+\'"\' (matches wh40k-tabletop.html drawRuler formatting)');

    // hovered-unit name label: shows token.name verbatim
    layer.tick(rig, state, { heightFor: () => 0, hoveredId: "sel1" });
    assert(!!containerDiv.children.find(c => c.textContent === "Mover"),
      "hovered token's name label shows state.tokens[].name verbatim");
  }

  // ---------- test 7: dispose() detaches pooled divs ----------
  {
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000);
    camera.position.set(0, 30, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const rig = makeRig(camera);

    const containerDiv = doc.createElement();
    containerDiv.clientWidth = 800; containerDiv.clientHeight = 600;
    const layer = createLabelLayer(containerDiv, { sel: new Set() }, doc);
    const tok = { id: "d1", owner: 1, unit: "u7", name: "Disposable", shape: "c", dmm: 32, x: 1, y: 1, rot: 0, wounds: 1, maxW: 5, kw: [] };
    layer.tick(rig, { tokens: [tok] }, { heightFor: () => 0 });
    assert(containerDiv.children.length > 0, "pool populated containerDiv before dispose");
    layer.dispose();
    assert(containerDiv.children.length === 0, "dispose() removes all pooled divs from the container");
  }

  console.log(failed ? "WP3D-3 TESTS: " + failed + " FAILURES" : "WP3D-3 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
})().catch(e => {
  console.error("WP3D-3 TESTS: threw " + (e && e.stack || e));
  process.exitCode = 1;
});
