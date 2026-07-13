// WP3D-12 battle-cam tests: run via `node wp3d-12-battlecam-tests.js` from tools/tests/.
// Plain node, no DOM/WebGL — three.js core objects are pure JS/math and construct fine
// without a canvas or GL context (same precedent as wp3d-10-motion-tests.js). The integration
// fakes use a SELF-CONSISTENT fake camera rig (real spherical math mirroring
// wp3d-2-renderer.js's createCameraRig) so convergence tests exercise the real relative-API
// technique end-to-end, not just "panBy/orbitBy/zoomBy were called".
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log('ok - ' + name); } else { failed++; console.log('FAIL: ' + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

  const THREE = await import('../../vendor/three.module.min.js');
  const M = await import('../../sections/wp3d-12-battlecam.js');
  const {
    createBattlecam, computeFraming, shortestAngleDelta, pulseMarkerPose, readRigState,
    BATTLECAM_POLAR, BATTLECAM_AZIMUTH_OFFSET, BATTLECAM_RADIUS_MIN, BATTLECAM_RADIUS_PAD,
    BATTLECAM_RADIUS_PER_IN, PULSE_TOTAL_MS, PULSE_CYCLES, BATTLECAM_CANCEL_QUIET_MS,
    BATTLECAM_YIELD_MS,
  } = M;

  // =========================================================================================
  console.log('== computeFraming: pure framing math ==');
  {
    const a = { x: 10, y: 10 }, b = { x: 20, y: 10 };
    const f = computeFraming(a, b);
    assert(near(f.targetX, 15) && near(f.targetZ, 10), 'target = midpoint of attacker/target');
    assert(near(f.polar, BATTLECAM_POLAR), 'polar is the fixed "low 3/4" constant');
    const expectedAz = Math.atan2(10, 0) + BATTLECAM_AZIMUTH_OFFSET; // dx=10,dz=0
    assert(near(f.azimuth, expectedAz, 1e-9), 'azimuth = attacker->target line angle + the fixed offset');
    const expectedRadius = 10 * BATTLECAM_RADIUS_PER_IN + BATTLECAM_RADIUS_PAD;
    assert(near(f.radius, expectedRadius, 1e-9), 'radius scales with token separation plus the fixed pad');

    // adjacent (melee) tokens: radius floors at BATTLECAM_RADIUS_MIN, never collapses to ~0
    const close = computeFraming({ x: 0, y: 0 }, { x: 0.5, y: 0 });
    assert(close.radius >= BATTLECAM_RADIUS_MIN, `adjacent tokens: radius floors at BATTLECAM_RADIUS_MIN (got ${close.radius})`);

    // symmetry: swapping attacker/target keeps the same midpoint (order-independent target)
    const fSwap = computeFraming(b, a);
    assert(near(fSwap.targetX, f.targetX) && near(fSwap.targetZ, f.targetZ), 'midpoint is order-independent (attacker/target swapped)');
  }

  console.log('== shortestAngleDelta: wraparound-safe angle delta ==');
  {
    assert(near(shortestAngleDelta(0, Math.PI / 2), Math.PI / 2, 1e-9), 'simple forward delta, no wrap');
    assert(near(shortestAngleDelta(3.0, -3.0), 0.2831853, 1e-6), 'crossing the +/-PI seam takes the SHORT way (not almost a full turn)');
    assert(near(shortestAngleDelta(0, 4 * Math.PI + 0.3), 0.3, 1e-6), 'a "to" value far outside (-PI,PI] still normalizes correctly');
    assert(Math.abs(shortestAngleDelta(1, 1)) < 1e-9, 'zero delta when from===to');
  }

  console.log('== pulseMarkerPose: 3 pulses over PULSE_TOTAL_MS, then invisible ==');
  {
    const p0 = pulseMarkerPose(0);
    assert(p0.visible === true && near(p0.opacity, 0, 1e-6), 'pulse starts visible but at opacity 0 (wave starts at the trough)');
    const perCycle = PULSE_TOTAL_MS / PULSE_CYCLES;
    const pPeak1 = pulseMarkerPose(perCycle * 0.5);
    assert(pPeak1.visible && pPeak1.opacity > 0.5 && pPeak1.scale > 1.3, 'mid-first-pulse: opacity/scale near their peak');
    const pTrough = pulseMarkerPose(perCycle);
    assert(near(pTrough.opacity, 0, 0.05), 'between pulses: opacity dips back near 0');
    const pPeak2 = pulseMarkerPose(perCycle * 1.5);
    assert(pPeak2.visible && pPeak2.opacity > 0.3, 'second pulse also peaks (not just the first)');
    const pEnd = pulseMarkerPose(PULSE_TOTAL_MS);
    assert(pEnd.visible === false, 'marker goes invisible once PULSE_TOTAL_MS has fully elapsed');
    const pPast = pulseMarkerPose(PULSE_TOTAL_MS + 500);
    assert(pPast.visible === false, 'stays invisible well past its lifetime');
    // overall fade envelope: the 3rd pulse's peak is quieter than the 1st's (fade * wave)
    const pPeak3 = pulseMarkerPose(perCycle * 2.5);
    assert(pPeak3.opacity < pPeak1.opacity, 'later pulses are quieter than earlier ones (overall fade envelope)');
  }

  console.log('== readRigState: round-trips a known spherical camera pose ==');
  {
    const az = 0.6, polar = 1.1, radius = 40, target = { x: 12, z: -8 };
    const camera = {
      position: new THREE.Vector3(
        target.x + radius * Math.sin(polar) * Math.sin(az),
        radius * Math.cos(polar),
        target.z + radius * Math.sin(polar) * Math.cos(az),
      ),
    };
    const rig = { camera, screenToBoard: (nx, ny) => (nx === 0 && ny === 0 ? [target.x, target.z] : null) };
    const st = readRigState(rig);
    assert(near(st.targetX, target.x, 1e-6) && near(st.targetZ, target.z, 1e-6), 'readRigState recovers the target via screenToBoard(0,0)');
    assert(near(st.azimuth, az, 1e-6), 'readRigState recovers azimuth');
    assert(near(st.polar, polar, 1e-6), 'readRigState recovers polar');
    assert(near(st.radius, radius, 1e-6), 'readRigState recovers radius');

    // fallback when screenToBoard is unavailable: falls back to camera position itself
    const rigNoScreenToBoard = { camera: { position: new THREE.Vector3(5, 5, 5) } };
    const st2 = readRigState(rigNoScreenToBoard);
    assert(near(st2.targetX, 5) && near(st2.targetZ, 5), 'readRigState degrades gracefully without screenToBoard');
  }

  // =========================================================================================
  console.log('== createBattlecam: integration (self-consistent fake rig, real spherical math) ==');

  function makeScene() {
    const added = [];
    return { added, add(o) { added.push(o); }, remove(o) { const i = added.indexOf(o); if (i !== -1) added.splice(i, 1); } };
  }
  function makeBridge(tokens) {
    let cb = null;
    return {
      state() { return { tokens }; },
      onAttackStaged(fn) { cb = fn; },
      _stage(aId, tId) { if (cb) cb(aId, tId); },
    };
  }
  function makeModes(initialQuietMs) {
    let q = initialQuietMs;
    return { userQuietFor() { return q; }, _setQuiet(v) { q = v; } };
  }
  // Self-consistent fake rig: REAL spherical camera math (mirrors createCameraRig's
  // applyPose/panBy/orbitBy/zoomBy/groundBasis), so a convergence test proves the actual
  // relative-API technique works end-to-end, not just "the fns got called".
  function makeSelfConsistentRig(az, polar, radius, targetX, targetZ) {
    const st = { azimuth: az, polar, radius, target: { x: targetX, z: targetZ } };
    const camera = { position: new THREE.Vector3() };
    function applyPose() {
      camera.position.set(
        st.target.x + st.radius * Math.sin(st.polar) * Math.sin(st.azimuth),
        st.radius * Math.cos(st.polar),
        st.target.z + st.radius * Math.sin(st.polar) * Math.cos(st.azimuth),
      );
    }
    applyPose();
    camera.getWorldDirection = (out) => {
      const dx = st.target.x - camera.position.x;
      const dy = 0 - camera.position.y;
      const dz = st.target.z - camera.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      out.set(dx / len, dy / len, dz / len);
      return out;
    };
    const calls = { pan: 0, orbit: 0, zoom: 0 };
    return {
      camera,
      screenToBoard(nx, ny) { return (nx === 0 && ny === 0) ? [st.target.x, st.target.z] : null; },
      panBy(dx, dy) {
        calls.pan++;
        const forward = { x: -Math.sin(st.azimuth), z: -Math.cos(st.azimuth) };
        const right = { x: forward.z, z: -forward.x };
        st.target.x += right.x * dx + forward.x * dy;
        st.target.z += right.z * dx + forward.z * dy;
        applyPose();
      },
      orbitBy(dAz, dPolar) { calls.orbit++; st.azimuth += dAz; st.polar += dPolar; applyPose(); },
      zoomBy(f) { calls.zoom++; st.radius *= f; applyPose(); },
      _state: st,
      _calls: calls,
    };
  }

  // ---- yield-gate: userQuietFor() <= 5000ms blocks staging entirely ----
  {
    const scene = makeScene();
    const tokA = { id: 'a1', x: 0, y: 0 }, tokB = { id: 'b1', x: 10, y: 0 };
    const bridge = makeBridge([tokA, tokB]);
    const modes = makeModes(1000); // NOT quiet long enough (<=5000ms)
    const rig = makeSelfConsistentRig(Math.PI / 4, 0.95, 30, 5, 0);
    const bc = createBattlecam({ THREE, scene, rig, sceneSync: {}, motion: {}, bridge, modes });

    bridge._stage('a1', 'b1');
    for (let i = 0; i < 10; i++) bc.tick(16, {});
    assert(rig._calls.pan === 0 && rig._calls.orbit === 0 && rig._calls.zoom === 0,
      'yield-gate BLOCKS staging when userQuietFor() <= 5000ms (no camera calls at all)');
    assert(bc._debug.camAnim() === null, 'no camera animation started while the user was recently active');
    bc.dispose();
  }

  // ---- yield-gate: userQuietFor() > 5000ms allows staging ----
  {
    const scene = makeScene();
    const tokA = { id: 'a1', x: 0, y: 0 }, tokB = { id: 'b1', x: 10, y: 0 };
    const bridge = makeBridge([tokA, tokB]);
    const modes = makeModes(6000); // quiet long enough
    const rig = makeSelfConsistentRig(Math.PI / 4, 0.95, 30, 5, 0);
    const bc = createBattlecam({ THREE, scene, rig, sceneSync: {}, motion: {}, bridge, modes });

    bridge._stage('a1', 'b1');
    bc.tick(16, {});
    assert(bc._debug.camAnim() !== null, 'yield-gate ALLOWS staging once userQuietFor() > 5000ms');
    assert(rig._calls.pan > 0 || rig._calls.orbit > 0 || rig._calls.zoom > 0, 'at least one relative-API call issued on the first tick of a real cinematic');
    bc.dispose();
  }

  // ---- guard for stub absence: modes has no userQuietFor at all -> always allowed ----
  {
    const scene = makeScene();
    const tokA = { id: 'a1', x: 0, y: 0 }, tokB = { id: 'b1', x: 10, y: 0 };
    const bridge = makeBridge([tokA, tokB]);
    const modesStub = {}; // wp3d-11-modes.js's CURRENT stub shape — no userQuietFor
    const rig = makeSelfConsistentRig(Math.PI / 4, 0.95, 30, 5, 0);
    const bc = createBattlecam({ THREE, scene, rig, sceneSync: {}, motion: {}, bridge, modes: modesStub });

    bridge._stage('a1', 'b1');
    bc.tick(16, {});
    assert(bc._debug.camAnim() !== null, 'guard: absence of modes.userQuietFor (stub) is treated as "always allowed", never crashes');
    bc.dispose();
  }

  // ---- gate: both ids must resolve to LIVE tokens ----
  {
    const scene = makeScene();
    const tokA = { id: 'a1', x: 0, y: 0 };
    const bridge = makeBridge([tokA]); // no 'b1' token exists
    const modes = makeModes(6000);
    const rig = makeSelfConsistentRig(Math.PI / 4, 0.95, 30, 5, 0);
    const bc = createBattlecam({ THREE, scene, rig, sceneSync: {}, motion: {}, bridge, modes });

    bridge._stage('a1', 'b1'); // target id doesn't resolve
    bc.tick(16, {});
    assert(bc._debug.camAnim() === null, 'unresolved target token: no cinematic starts');

    bridge._stage(null, 'a1'); // null attacker id (the "may be null" contract case)
    bc.tick(16, {});
    assert(bc._debug.camAnim() === null, 'null attacker id: no cinematic starts (guarded, no crash)');
    bc.dispose();
  }

  // ---- convergence: framing math drives the rig to the desired target/azimuth/polar/radius ----
  {
    const scene = makeScene();
    const tokA = { id: 'a1', x: 10, y: 10 }, tokB = { id: 'b1', x: 22, y: 14 };
    const bridge = makeBridge([tokA, tokB]);
    const modes = makeModes(6000); // stays "quiet" throughout — never triggers the cancel path
    const rig = makeSelfConsistentRig(Math.PI / 4, 0.95, 60, 0, 0); // starts far off-framing
    const bc = createBattlecam({ THREE, scene, rig, sceneSync: {}, motion: {}, bridge, modes });

    const expected = computeFraming(tokA, tokB);
    bridge._stage('a1', 'b1');
    for (let i = 0; i < 90; i++) bc.tick(16, {}); // ~1.44s of frames — past BATTLECAM_MAX_MS if needed

    const finalSt = readRigState(rig);
    assert(Math.hypot(finalSt.targetX - expected.targetX, finalSt.targetZ - expected.targetZ) < 0.15,
      `camera target converges to the framing midpoint (final=(${finalSt.targetX.toFixed(2)},${finalSt.targetZ.toFixed(2)}), expected=(${expected.targetX.toFixed(2)},${expected.targetZ.toFixed(2)}))`);
    assert(Math.abs(shortestAngleDelta(finalSt.azimuth, expected.azimuth)) < 0.05, 'camera azimuth converges to the desired framing angle');
    assert(near(finalSt.polar, expected.polar, 0.02), 'camera polar converges to the "low 3/4" constant');
    assert(Math.abs(finalSt.radius / expected.radius - 1) < 0.05, 'camera radius converges to the desired framing distance (within 5%)');
    assert(rig._calls.pan > 1 && rig._calls.orbit > 1 && rig._calls.zoom > 1, 'driven via MULTIPLE eased per-tick relative-API steps, not one jump');
    assert(bc._debug.camAnim() === null, 'animation self-terminates once converged (stops issuing further steps)');

    const panCallsAtConvergence = rig._calls.pan;
    bc.tick(16, {});
    assert(rig._calls.pan === panCallsAtConvergence, 'no further panBy() calls once converged');
    bc.dispose();
  }

  // ---- cancel-on-input: userQuietFor() dropping to ~0 mid-flight cancels instantly ----
  {
    const scene = makeScene();
    const tokA = { id: 'a1', x: 0, y: 0 }, tokB = { id: 'b1', x: 20, y: 0 };
    const bridge = makeBridge([tokA, tokB]);
    const modes = makeModes(6000);
    const rig = makeSelfConsistentRig(Math.PI / 4, 0.95, 60, -20, -20); // far off-framing
    const bc = createBattlecam({ THREE, scene, rig, sceneSync: {}, motion: {}, bridge, modes });

    bridge._stage('a1', 'b1');
    for (let i = 0; i < 5; i++) bc.tick(16, {}); // a few ticks into the flight
    assert(bc._debug.camAnim() !== null, 'mid-flight (before any fresh input): animation is still running');
    const callsBeforeCancel = rig._calls.pan + rig._calls.orbit + rig._calls.zoom;

    modes._setQuiet(BATTLECAM_CANCEL_QUIET_MS - 20); // simulate a fresh pointerdown/wheel just landed
    bc.tick(16, {});
    assert(bc._debug.camAnim() === null, 'cancel-on-input: a fresh (near-zero) userQuietFor() cancels the cinematic instantly');

    for (let i = 0; i < 5; i++) bc.tick(16, {});
    const callsAfterCancel = rig._calls.pan + rig._calls.orbit + rig._calls.zoom;
    assert(callsAfterCancel === callsBeforeCancel + 0 || callsAfterCancel <= callsBeforeCancel + 1,
      'no further relative-API calls accumulate after cancel (the one cancel-detecting tick issues none)');
    bc.dispose();
  }

  // ---- ground pulse marker: appears on stage, pulses, auto-hides; dispose() removes it ----
  {
    const scene = makeScene();
    const tokA = { id: 'a1', x: 0, y: 0 }, tokB = { id: 'b1', x: 10, y: 0 };
    const bridge = makeBridge([tokA, tokB]);
    const modes = makeModes(6000);
    const rig = makeSelfConsistentRig(Math.PI / 4, 0.95, 30, 5, 0);
    const bc = createBattlecam({ THREE, scene, rig, sceneSync: {}, motion: {}, bridge, modes });
    const pulseMesh = bc._debug.pulseMesh();

    assert(scene.added.includes(pulseMesh), 'pulse marker mesh is added to the scene up front');
    assert(pulseMesh.visible === false, 'pulse marker starts hidden (no attack staged yet)');

    const expected = computeFraming(tokA, tokB);
    bridge._stage('a1', 'b1');
    bc.tick(16, {});
    assert(pulseMesh.visible === true, 'staging an attack shows the pulse marker');
    assert(near(pulseMesh.position.x, expected.targetX, 1e-6) && near(pulseMesh.position.z, expected.targetZ, 1e-6),
      'pulse marker is positioned under the framing midpoint');

    for (let i = 0; i < 200; i++) bc.tick(16, {}); // well past PULSE_TOTAL_MS
    assert(pulseMesh.visible === false, 'pulse marker auto-hides once its 3 pulses finish');

    bc.dispose();
    assert(!scene.added.includes(pulseMesh), 'dispose() removes the pulse marker from the scene');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
