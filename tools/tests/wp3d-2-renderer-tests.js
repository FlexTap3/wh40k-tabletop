// WP3D-2 renderer/camera-rig/perf tests — plain node, no DOM/WebGL.
// Run: node tools/tests/wp3d-2-renderer-tests.js
// Everything except createRenderer's GL internals is covered here: wp3dPerfTier truth
// table, camera-rig math against a real THREE.PerspectiveCamera, createLoop RAF lifecycle
// with an injected fake RAF, the FPS governor, and observeResize wiring.

import * as THREE from "../../vendor/three.module.min.js";
import {
  wp3dPerfTier,
  WP3D_DEGRADED_TIER,
  createCameraRig,
  createLoop,
  createFpsGovernor,
  observeResize,
} from "../../sections/wp3d-2-renderer.js";

let passed = 0, failed = 0;
const assert = (ok, name) => {
  if (ok) { passed++; console.log("ok - " + name); }
  else { failed++; console.log("FAIL: " + name); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const fakeCanvas = () => ({ addEventListener() {}, removeEventListener() {} });

// ---------------------------------------------------------------------------
// 1. wp3dPerfTier truth table
// ---------------------------------------------------------------------------
{
  const desktop = wp3dPerfTier({ phone: false, dpr: 2 });
  assert(desktop.pixelRatioCap === 2 && desktop.antialias === true && desktop.labelEvery === 1,
    "wp3dPerfTier: desktop/iPad tier");

  const ipadLike = wp3dPerfTier({ phone: false, dpr: 2, memoryGB: 4 });
  assert(ipadLike.pixelRatioCap === 2 && ipadLike.antialias === true && ipadLike.labelEvery === 1,
    "wp3dPerfTier: iPad-like (non-phone) tier matches desktop");

  const phone = wp3dPerfTier({ phone: true, dpr: 3 });
  assert(phone.pixelRatioCap === 1.5 && phone.antialias === false && phone.labelEvery === 2,
    "wp3dPerfTier: phone tier");

  const noInfo = wp3dPerfTier({});
  assert(noInfo.pixelRatioCap === 2 && noInfo.antialias === true,
    "wp3dPerfTier: missing deviceInfo fields default to desktop tier");

  assert(WP3D_DEGRADED_TIER.pixelRatioCap === 1 && WP3D_DEGRADED_TIER.antialias === false
    && WP3D_DEGRADED_TIER.labelEvery === 3,
    "WP3D_DEGRADED_TIER: matches contract's degraded tier shape");
}

// ---------------------------------------------------------------------------
// 2. camera rig math
// ---------------------------------------------------------------------------
{
  const board = { w: 44, h: 60 };
  const diag = Math.hypot(board.w, board.h);

  // --- default framing ---
  const rig0 = createCameraRig(THREE, fakeCanvas(), board);
  assert(rig0.camera.position.y > 0, "default view: camera above the board plane (y>0)");
  const centerProj = rig0.project(new THREE.Vector3(board.w / 2, 0, board.h / 2));
  assert(centerProj.visible, "default view: board center is visible/framed");

  // --- orbitBy: azimuth free, polar clamped ---
  const rigOrbit = createCameraRig(THREE, fakeCanvas(), board);
  rigOrbit.orbitBy(0.4, 0.05);
  rigOrbit.update(1e6); // huge dt fully converges the exponential damping
  const azExpected = Math.PI / 4 + 0.4;
  const azActual = Math.atan2(
    rigOrbit.camera.position.x - board.w / 2,
    rigOrbit.camera.position.z - board.h / 2
  );
  assert(near(azActual, azExpected, 1e-4), "orbitBy: azimuth advances by dx");

  const rigPolarHi = createCameraRig(THREE, fakeCanvas(), board);
  rigPolarHi.orbitBy(0, 10); // push polar way past the max clamp
  rigPolarHi.update(1e6);
  assert(rigPolarHi.camera.position.y > 0, "orbitBy: polar clamp keeps camera above the table (upper bound)");
  const rMax = rigPolarHi.camera.position.distanceTo(new THREE.Vector3(board.w / 2, 0, board.h / 2));
  const yAtMax = rMax * Math.cos(1.45);
  assert(near(rigPolarHi.camera.position.y, yAtMax, 1e-3), "orbitBy: polar clamps at ~1.45rad");

  const rigPolarLo = createCameraRig(THREE, fakeCanvas(), board);
  rigPolarLo.orbitBy(0, -10); // push polar way past the min clamp (near top-down)
  rigPolarLo.update(1e6);
  const rMin = rigPolarLo.camera.position.distanceTo(new THREE.Vector3(board.w / 2, 0, board.h / 2));
  const yAtMin = rMin * Math.cos(0.1);
  assert(near(rigPolarLo.camera.position.y, yAtMin, 1e-3), "orbitBy: polar clamps at ~0.1rad");

  // --- zoomBy: radius clamped ---
  const rigZoomIn = createCameraRig(THREE, fakeCanvas(), board);
  rigZoomIn.zoomBy(0.0001);
  rigZoomIn.update(1e6);
  const distIn = rigZoomIn.camera.position.distanceTo(new THREE.Vector3(board.w / 2, 0, board.h / 2));
  assert(near(distIn, 6, 1e-3), "zoomBy: radius clamps at the ~6in minimum");

  const rigZoomOut = createCameraRig(THREE, fakeCanvas(), board);
  rigZoomOut.zoomBy(1e9);
  rigZoomOut.update(1e6);
  const distOut = rigZoomOut.camera.position.distanceTo(new THREE.Vector3(board.w / 2, 0, board.h / 2));
  assert(near(distOut, 2.2 * diag, 1e-3), "zoomBy: radius clamps at the ~2.2x board-diagonal maximum");

  // --- panBy: moves target on the ground plane, y stays 0 ---
  const rigPan = createCameraRig(THREE, fakeCanvas(), board);
  rigPan.update(1e6);
  const before = rigPan.camera.position.clone();
  rigPan.panBy(5, 3);
  rigPan.update(1e6);
  const after = rigPan.camera.position.clone();
  const delta = after.clone().sub(before);
  assert(delta.length() > 0, "panBy: camera position moves");
  assert(near(after.y, before.y, 1e-6), "panBy: camera height (y) unchanged — pan stays on the ground plane");

  // --- screenToBoard round-trip via project() ---
  const rigRT = createCameraRig(THREE, fakeCanvas(), board);
  rigRT.orbitBy(0.2, -0.1);
  rigRT.zoomBy(1.3);
  rigRT.update(1e6);
  const knownPoint = [12.5, 40.25]; // inches
  const ndc = rigRT.project(new THREE.Vector3(knownPoint[0], 0, knownPoint[1]));
  assert(ndc.visible, "screenToBoard round-trip: known board point projects as visible");
  const back = rigRT.screenToBoard(ndc.x, ndc.y);
  assert(back !== null, "screenToBoard: returns non-null for a visible on-board point");
  assert(near(back[0], knownPoint[0], 1e-3) && near(back[1], knownPoint[1], 1e-3),
    "screenToBoard round-trip: recovers the same inches within epsilon");

  // --- project(): visible === false for points behind the camera ---
  const rigBehind = createCameraRig(THREE, fakeCanvas(), board);
  rigBehind.update(1e6);
  const dir = new THREE.Vector3();
  rigBehind.camera.getWorldDirection(dir);
  const behindPoint = rigBehind.camera.position.clone().add(dir.multiplyScalar(-10));
  const behindProj = rigBehind.project(behindPoint);
  assert(behindProj.visible === false, "project(): visible=false for a point behind the camera");

  // --- lookAtBoard(): resets framing back to defaults after drift ---
  const rigReset = createCameraRig(THREE, fakeCanvas(), board);
  rigReset.orbitBy(2, 0.3);
  rigReset.zoomBy(5);
  rigReset.panBy(20, 20);
  rigReset.update(1e6);
  rigReset.lookAtBoard();
  rigReset.update(1e6);
  const rig0check = createCameraRig(THREE, fakeCanvas(), board);
  assert(rigReset.camera.position.distanceTo(rig0check.camera.position) < 1e-3,
    "lookAtBoard: converges back to the default framing");
}

// ---------------------------------------------------------------------------
// 3. createLoop — injected fake RAF
// ---------------------------------------------------------------------------
{
  // --- basic start/stop drives fn(dtMs) each tick ---
  let queue = [];
  let nextHandle = 1;
  const raf = (cb) => { const h = nextHandle++; queue.push({ h, cb }); return h; };
  const caf = (h) => { queue = queue.filter(q => q.h !== h); };
  const flushOne = (t) => {
    const batch = queue; queue = [];
    batch.forEach(q => q.cb(t));
  };
  const doc = { hidden: false, _l: {}, addEventListener(t, f) { this._l[t] = this._l[t] || []; this._l[t].push(f); },
    fire(t) { (this._l[t] || []).forEach(f => f()); } };

  const calls = [];
  const loop = createLoop((dt) => calls.push(dt), { raf, caf, doc });
  assert(queue.length === 0, "createLoop: does not schedule before start()");
  loop.start();
  assert(queue.length === 1, "createLoop: start() schedules exactly one RAF");
  flushOne(16);
  assert(calls.length === 1 && calls[0] === 0, "createLoop: first tick fires with dt=0 (no prior timestamp)");
  flushOne(33);
  assert(calls.length === 2 && near(calls[1], 17, 1e-9), "createLoop: subsequent ticks pass real dtMs");

  // double-start guard
  const queueLenBefore = queue.length;
  loop.start();
  assert(queue.length === queueLenBefore, "createLoop: double-start is a no-op (guarded)");

  loop.stop();
  assert(queue.length === 0, "createLoop: stop() cancels the pending RAF");
  flushOne(50);
  assert(calls.length === 2, "createLoop: no further ticks fire after stop()");

  // restart works after stop
  loop.start();
  assert(queue.length === 1, "createLoop: start() after stop() re-schedules");
  flushOne(60);
  assert(calls.length === 3, "createLoop: ticking resumes after restart");

  // auto-stop while hidden, resume on visible
  doc.hidden = true;
  doc.fire("visibilitychange");
  assert(queue.length === 0, "createLoop: going hidden cancels the pending RAF");
  doc.hidden = false;
  doc.fire("visibilitychange");
  assert(queue.length === 1, "createLoop: becoming visible again re-schedules (loop was started)");

  // defensive path: a previously-scheduled frame fires after hidden flips true
  // without a visibilitychange event ever firing — must not call fn or reschedule.
  const calls2 = [];
  let q2 = [];
  let h2 = 1;
  const raf2 = (cb) => { const h = h2++; q2.push({ h, cb }); return h; };
  const caf2 = (h) => { q2 = q2.filter(x => x.h !== h); };
  const doc2 = { hidden: false, addEventListener() {} };
  const loop2 = createLoop((dt) => calls2.push(dt), { raf: raf2, caf: caf2, doc: doc2 });
  loop2.start();
  assert(q2.length === 1, "createLoop: start() schedules one RAF (second loop instance)");
  const pending = q2[0];
  q2 = [];
  doc2.hidden = true;
  pending.cb(16);
  assert(calls2.length === 0, "createLoop: fn does not fire for a frame that lands while hidden");
  assert(q2.length === 0, "createLoop: a frame firing while hidden does not reschedule");
}

// ---------------------------------------------------------------------------
// 4. FPS governor
// ---------------------------------------------------------------------------
{
  // below threshold (avg < 30fps over ~2s window) -> fires exactly once
  let downgrades = 0;
  const gov = createFpsGovernor(() => downgrades++, { windowMs: 2000, minFps: 30 });
  // 40 frames of 60ms each = 2400ms elapsed, ~16.7fps avg -> should downgrade
  for (let i = 0; i < 40; i++) gov.sample(60);
  assert(downgrades === 1, "createFpsGovernor: fires once when avg fps is below threshold");
  // keep sampling after the window closed — must not fire again
  for (let i = 0; i < 40; i++) gov.sample(60);
  assert(downgrades === 1, "createFpsGovernor: never fires more than once");

  // above threshold -> never fires
  let downgrades2 = 0;
  const gov2 = createFpsGovernor(() => downgrades2++, { windowMs: 2000, minFps: 30 });
  // 200 frames of 8ms each = 1600ms across the window at ~125fps, then a couple more to close the window
  for (let i = 0; i < 260; i++) gov2.sample(8);
  assert(downgrades2 === 0, "createFpsGovernor: never fires when avg fps is above threshold");

  // reset() clears state
  gov2.reset();
  let downgrades3 = 0;
  const gov3 = createFpsGovernor(() => downgrades3++, { windowMs: 500, minFps: 30 });
  for (let i = 0; i < 5; i++) gov3.sample(200); // 1000ms @ 5fps
  assert(downgrades3 === 1, "createFpsGovernor: fires on a short window too when configured");
}

// ---------------------------------------------------------------------------
// 5. observeResize wiring (injectable RO)
// ---------------------------------------------------------------------------
{
  let observed = null, disconnected = false, capturedCb = null;
  class FakeRO {
    constructor(cb) { capturedCb = cb; }
    observe(el) { observed = el; }
    disconnect() { disconnected = true; }
  }
  const container = { getBoundingClientRect() { return { width: 800, height: 600 }; } };
  const calls = [];
  const handle = observeResize(container, (w, h, dpr) => calls.push([w, h, dpr]), { RO: FakeRO, dpr: 2 });
  assert(observed === container, "observeResize: observes the given container");

  // simulate a RO callback firing with a contentRect
  capturedCb([{ contentRect: { width: 500, height: 400 } }]);
  assert(calls.length === 1 && calls[0][0] === 500 && calls[0][1] === 400 && calls[0][2] === 2,
    "observeResize: forwards width/height/dpr to the callback");

  handle.disconnect();
  assert(disconnected === true, "observeResize: disconnect() tears down the observer");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
