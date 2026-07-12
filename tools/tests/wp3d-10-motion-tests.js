// WP3D-10 motion & feel tests: run via `node wp3d-10-motion-tests.js` from tools/tests/.
// Plain node, no DOM/WebGL — three.js core objects are pure JS/math (as established by the
// other wp3d-*-tests.js suites) and construct fine without a canvas or GL context. Fakes for
// scene/canvas/rig/sceneSync/bridge follow the exact patterns wp3d-4-interaction-tests.js
// already established (makeCanvas/_fire, makeBridge, makeRig with call-tracking arrays).
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log('ok - ' + name); } else { failed++; console.log('FAIL: ' + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const THREE = await import('../../vendor/three.module.min.js');
  const M = await import('../../sections/wp3d-10-motion.js');
  const {
    createMotion, classifyMotionTick, tweenRemoteMove, createDiceBatcher, selectDiceSubset,
    quaternionForFaceUp, DIE_FACE_NORMALS, buildDieGeometry,
    JUMP_THRESHOLD_IN, MOTION_ARC_MS, SQUASH_MS, LIFT_HEIGHT_IN, DICE_CAP, MAX_CONCURRENT_ANIM,
  } = M;

  // =========================================================================================
  console.log('== tweenRemoteMove: pure tween math ==');
  {
    const start = { x: 0, y: 0, rot: 0 }, end = { x: 10, y: 4, rot: 90 };
    const p0 = tweenRemoteMove(start, end, 0);
    assert(p0.x === 0 && p0.y === 0 && p0.lift === 0, 'elapsedMs=0: endpoints exact (x/y/lift at start)');
    const pEnd = tweenRemoteMove(start, end, MOTION_ARC_MS);
    assert(near(pEnd.x, 10) && near(pEnd.y, 4) && near(pEnd.lift, 0, 1e-9),
      'elapsedMs=MOTION_ARC_MS: endpoints exact (x/y/lift at end, lift back to 0)');
    const pMid = tweenRemoteMove(start, end, MOTION_ARC_MS / 2);
    assert(pMid.lift > 0, 'mid-flight: lift (arc height) > 0');
    assert(pMid.lift <= LIFT_HEIGHT_IN + 1e-9, 'mid-flight: lift never exceeds the configured peak');
    assert(pMid.x > 0 && pMid.x < 10, 'mid-flight: x strictly between start and end');
    // peak should land at/near the temporal midpoint (parabola over smoothstepped time)
    const p25 = tweenRemoteMove(start, end, MOTION_ARC_MS * 0.25);
    const p75 = tweenRemoteMove(start, end, MOTION_ARC_MS * 0.75);
    assert(pMid.lift > p25.lift && pMid.lift > p75.lift, 'lift peaks near the middle of the flight, not the edges');

    // squash/settle window: position frozen at the endpoint, scale bumps then returns to 1
    const pSquashMid = tweenRemoteMove(start, end, MOTION_ARC_MS + SQUASH_MS / 2);
    assert(near(pSquashMid.x, 10) && near(pSquashMid.y, 4), 'squash window: x/y stay pinned at the endpoint');
    assert(pSquashMid.scaleY < 1 && pSquashMid.scaleXZ > 1, 'squash window: scaleY dips, scaleXZ bulges mid-squash');
    const pDone = tweenRemoteMove(start, end, MOTION_ARC_MS + SQUASH_MS);
    assert(near(pDone.scaleY, 1, 1e-6) && near(pDone.scaleXZ, 1, 1e-6), 'squash window: settles back to scale 1 by its end');
    assert(pDone.done === true, 'done=true once elapsed >= MOTION_ARC_MS+SQUASH_MS');
    assert(tweenRemoteMove(start, end, 10).done === false, 'done=false while still mid-flight');

    // rotation shortest-path
    const pRot = tweenRemoteMove({ x: 0, y: 0, rot: 350 }, { x: 0, y: 0, rot: 10 }, MOTION_ARC_MS / 2);
    assert(pRot.rot > 350 || pRot.rot < 20, 'rotation interpolates the SHORT way across the 0/360 wrap');
  }

  // =========================================================================================
  console.log('== classifyMotionTick: jump-vs-drag heuristic over synthetic delta sequences ==');
  {
    // A local drag: many small per-tick deltas. None should ever classify as a remote jump,
    // even once the CUMULATIVE distance covered is well past JUMP_THRESHOLD_IN.
    let streak = 0;
    const dragDeltas = [0.05, 0.06, 0.04, 0.07, 0.9, 0.05]; // note: one single-tick delta (0.9") > threshold, but mid-drag
    let anyJump = false;
    for (const d of dragDeltas) {
      const cls = classifyMotionTick(streak, d);
      if (cls.isRemoteJump) anyJump = true;
      streak = cls.nextStreak;
    }
    assert(!anyJump, 'many-small-deltas (drag), even with one fast in-drag frame, never classifies as a remote jump');
    assert(streak === dragDeltas.length, 'streak keeps incrementing across a continuous drag');

    // A remote move: token idle (streak=0), then ONE big delta, then idle again.
    let s2 = 0;
    const c1 = classifyMotionTick(s2, 0); s2 = c1.nextStreak; // idle tick
    assert(!c1.isRemoteJump && s2 === 0, 'idle tick: no jump, streak stays 0');
    const c2 = classifyMotionTick(s2, 6.0); s2 = c2.nextStreak; // single large delta after stillness
    assert(c2.isRemoteJump === true, 'single large delta (>0.5") after stillness classifies as a remote jump');
    assert(s2 === 0, 'streak resets after a classified jump (it is a discrete event, not a drag start)');
    const c3 = classifyMotionTick(s2, 0);
    assert(!c3.isRemoteJump, 'token settles back to idle after the jump; no further jump fires');

    // A small nudge under the threshold, from idle, is NOT a jump (below JUMP_THRESHOLD_IN).
    const c4 = classifyMotionTick(0, JUMP_THRESHOLD_IN - 0.01);
    assert(!c4.isRemoteJump, 'a delta under JUMP_THRESHOLD_IN from idle does not classify as a jump');
    const c5 = classifyMotionTick(0, JUMP_THRESHOLD_IN + 0.01);
    assert(c5.isRemoteJump, 'a delta just over JUMP_THRESHOLD_IN from idle DOES classify as a jump');
  }

  // =========================================================================================
  console.log('== quaternionForFaceUp: dice face round-trip ==');
  {
    for (const v of [1, 2, 3, 4, 5, 6]) {
      const q = quaternionForFaceUp(THREE, v, 0);
      const inv = q.clone().invert();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
      const n = DIE_FACE_NORMALS[v];
      assert(near(up.x, n[0], 1e-6) && near(up.y, n[1], 1e-6) && near(up.z, n[2], 1e-6),
        `value ${v}: Q^-1 . (0,1,0) round-trips to the correct local face normal (yaw=0)`);
    }
    // yaw spin around the up axis must never change WHICH face ends up up.
    for (const v of [1, 4, 6]) {
      for (const yaw of [0.7, 2.1, -1.4]) {
        const q = quaternionForFaceUp(THREE, v, yaw);
        const inv = q.clone().invert();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
        const n = DIE_FACE_NORMALS[v];
        assert(near(up.x, n[0], 1e-6) && near(up.y, n[1], 1e-6) && near(up.z, n[2], 1e-6),
          `value ${v}, yaw=${yaw}: round-trip still holds (yaw spin about +Y is up-invariant)`);
      }
    }
    // opposite faces sum to 7, matching a real d6's feel.
    for (const [a, b] of [[1, 6], [2, 5], [3, 4]]) {
      const na = DIE_FACE_NORMALS[a], nb = DIE_FACE_NORMALS[b];
      assert(near(na[0], -nb[0]) && near(na[1], -nb[1]) && near(na[2], -nb[2]), `values ${a}/${b} sit on opposite local faces`);
    }
    let threw = false;
    try { quaternionForFaceUp(THREE, 7, 0); } catch (e) { threw = true; }
    assert(threw, 'invalid value 7 throws');
  }

  console.log('== buildDieGeometry: sanity ==');
  {
    const g = buildDieGeometry(THREE);
    assert(g && g.attributes && g.attributes.position.count > 0, 'die geometry builds with verts>0');
    assert(g.index && g.index.count > 0, 'die geometry has triangles>0');
    g.computeBoundingBox();
    const bb = g.boundingBox;
    assert(bb.max.x - bb.min.x <= 0.8 && bb.max.y - bb.min.y <= 0.8 && bb.max.z - bb.min.z <= 0.8,
      'die geometry is a small, tabletop-die-scaled object (<=0.8in per axis, incl. pip protrusion)');
  }

  // =========================================================================================
  console.log('== createDiceBatcher + selectDiceSubset: batching and overflow honesty ==');
  {
    const batcher = createDiceBatcher();
    // "30 cbs in 50ms" — a burst well within the 120ms coalescing window.
    for (let i = 0; i < 30; i++) batcher.push((i % 6) + 1, i * (50 / 30));
    assert(!batcher.ready(49), 'batch not ready while still inside the 120ms window since the last push');
    assert(batcher.ready(49 + 121), 'batch ready once 120ms of silence has passed since the last push');
    const rolls = batcher.flush();
    assert(rolls.length === 30, 'flush() returns every rolled value pushed during the burst');
    assert(batcher.peek().length === 0, 'flush() clears the pending buffer');

    const shown = selectDiceSubset(rolls, DICE_CAP);
    assert(shown.length === DICE_CAP, `overflow: exactly ${DICE_CAP} dice shown for a 30-roll burst`);
    const counts = (arr) => arr.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {});
    const rollCounts = counts(rolls), shownCounts = counts(shown);
    let honest = true;
    for (const v of Object.keys(shownCounts)) if (shownCounts[v] > (rollCounts[v] || 0)) honest = false;
    assert(honest, 'overflow subset honesty: every shown value (with multiplicity) actually appears among the real rolls');

    // small batch: nothing is dropped.
    const small = selectDiceSubset([3, 3, 5], DICE_CAP);
    assert(small.length === 3 && small.every((v, i) => v === [3, 3, 5][i]), 'batch under the cap is returned unchanged');

    // window resets on every new push.
    const b2 = createDiceBatcher({ windowMs: 100 });
    b2.push(4, 0);
    assert(!b2.ready(90), 'not ready yet (90ms since last push < 100ms window)');
    b2.push(2, 90); // new roll arrives, resets the window
    assert(!b2.ready(150), 'a fresh push resets the window (150-90=60ms < 100ms)');
    assert(b2.ready(191), 'ready once 100ms have passed since the LATEST push (90+101)');
  }

  // =========================================================================================
  console.log('== createMotion: integration (fakes for scene/canvas/rig/sceneSync/bridge) ==');

  function makeScene() {
    const added = [];
    return { added, add(o) { added.push(o); }, remove(o) { const i = added.indexOf(o); if (i !== -1) added.splice(i, 1); } };
  }
  function makeCanvas(w = 800, h = 600) {
    const handlers = {};
    return {
      style: {},
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      removeEventListener(type, fn) { if (handlers[type]) handlers[type] = handlers[type].filter((f) => f !== fn); },
      getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
      _fire(type, e) { (handlers[type] || []).forEach((fn) => fn(e)); },
      _handlerCount(type) { return (handlers[type] || []).length; },
    };
  }
  function makePoolMesh(tokenIds) {
    const matrices = new Map();
    return {
      userData: { slotTokenId: tokenIds.slice() },
      setMatrixAt(slot, m) { matrices.set(slot, m.clone()); },
      instanceMatrix: { needsUpdate: false },
      _matrices: matrices,
    };
  }
  function makeSceneSync(meshes, elevationMap) {
    return {
      pickMeshes() { return meshes; },
      tokenAt(hit) { return hit && hit.tokenId != null ? hit.tokenId : null; },
      elevationFor(t) { return (elevationMap && elevationMap[t.id]) || 0; },
    };
  }
  function makeRig(hits) {
    return {
      camera: { getWorldDirection(t) { t.x = 0; t.y = 0; t.z = -1; return t; } },
      raycastFromScreen() { return { intersectObjects: () => this._hits || [] }; },
      screenToBoard(nx, ny) { return nx === 0.55 && ny === -0.55 ? [50, 40] : [30, 22]; },
      panBy() {},
      _hits: hits || [],
    };
  }
  function makeBridge(mySide, tokens, board) {
    let diceCb = null;
    return {
      state() { return { tokens, board: board || { w: 60, h: 44 } }; },
      mySide() { return mySide; },
      onDice(cb) { diceCb = cb; },
      _fireDice(v) { if (diceCb) diceCb(v); },
    };
  }

  // ---- remote-move tween wiring: a scripted jump animates the token's InstancedMesh slot ----
  {
    const scene = makeScene();
    const canvas = makeCanvas();
    const rig = makeRig([]);
    const tok = { id: 'tA', owner: 1, x: 5, y: 5, rot: 0, shape: 'c', dmm: 32 };
    const poolMesh = makePoolMesh(['tA']);
    const sceneSync = makeSceneSync([poolMesh]);
    const bridge = makeBridge(1, [tok]);
    const motion = createMotion({ THREE, scene, rig, sceneSync, bridge, canvas, renderer: {} });

    assert(scene.added.length === 1, 'createMotion adds exactly one scene object up front (the hover ring)');

    motion.tick(16, bridge.state()); // baseline sighting — no animation yet
    assert(poolMesh._matrices.size === 0, 'baseline tick: no animation triggered for a token seen for the first time');

    tok.x = 12; tok.y = 5; // committed remote move: single-frame jump of 7"
    motion.tick(16, bridge.state()); // elapsed=16ms into the tween
    assert(poolMesh._matrices.size === 1, 'jump tick: the token slot got an animated matrix write');
    const mMid = poolMesh._matrices.get(0);
    const posMid = new THREE.Vector3(), qMid = new THREE.Quaternion(), sMid = new THREE.Vector3();
    mMid.decompose(posMid, qMid, sMid);

    motion.tick(209, bridge.state()); // elapsed=225ms (midpoint of the 450ms arc)
    const mHalf = poolMesh._matrices.get(0);
    const posHalf = new THREE.Vector3(), qHalf = new THREE.Quaternion(), sHalf = new THREE.Vector3();
    mHalf.decompose(posHalf, qHalf, sHalf);
    assert(posHalf.y > 0.5, 'mid-flight (225ms): world-space y (lift) is clearly airborne (>0.5in)');

    motion.tick(300, bridge.state()); // elapsed=525ms — past the 510ms total, animation done
    const mEnd = poolMesh._matrices.get(0);
    const posEnd = new THREE.Vector3(), qEnd = new THREE.Quaternion(), sEnd = new THREE.Vector3();
    mEnd.decompose(posEnd, qEnd, sEnd);
    assert(near(posEnd.x, 12, 1e-3) && near(posEnd.z, 5, 1e-3) && near(posEnd.y, 0, 1e-3),
      'landed: final matrix decomposes to the exact committed position, back on the ground');
    assert(near(sEnd.x, 1, 1e-3) && near(sEnd.y, 1, 1e-3), 'landed: squash has fully settled back to scale 1');

    const writesBeforeIdle = poolMesh._matrices.size;
    motion.tick(16, bridge.state()); // token idle now — no further writes for it
    assert(poolMesh._matrices.size === writesBeforeIdle, 'once the animation is done, no further matrix writes happen for an idle token');

    motion.dispose();
    assert(scene.added.length === 0, 'dispose() removes the hover ring from the scene');
    assert(canvas._handlerCount('pointermove') === 0 && canvas._handlerCount('dblclick') === 0, 'dispose() removes all canvas listeners');
  }

  // ---- concurrency cap: ~40 simultaneous jumps, extras left unanimated (snap) ----
  {
    const scene = makeScene();
    const canvas = makeCanvas();
    const rig = makeRig([]);
    const N = 45;
    const tokens = [];
    for (let i = 0; i < N; i++) tokens.push({ id: 't' + i, owner: 1, x: 0, y: 0, rot: 0, shape: 'c', dmm: 32 });
    const poolMesh = makePoolMesh(tokens.map((t) => t.id));
    const sceneSync = makeSceneSync([poolMesh]);
    const bridge = makeBridge(1, tokens);
    const motion = createMotion({ THREE, scene, rig, sceneSync, bridge, canvas, renderer: {} });

    motion.tick(16, bridge.state()); // baseline
    for (const t of tokens) { t.x = 10; } // every token jumps at once (a whole-squad commit)
    motion.tick(16, bridge.state());
    assert(poolMesh._matrices.size <= MAX_CONCURRENT_ANIM, `concurrency cap: at most ${MAX_CONCURRENT_ANIM} tokens animate at once (got ${poolMesh._matrices.size} of ${N})`);
    assert(poolMesh._matrices.size === MAX_CONCURRENT_ANIM, 'concurrency cap is actually hit (not just incidentally under it) for a 45-token simultaneous commit');
    motion.dispose();
  }

  // ---- hover feedback ----
  {
    const scene = makeScene();
    const canvas = makeCanvas();
    const tok = { id: 'tH', owner: 1, x: 3, y: 3, rot: 0, shape: 'c', dmm: 32 };
    const enemy = { id: 'tE', owner: 2, x: 8, y: 8, rot: 0, shape: 'c', dmm: 32 };
    const poolMesh = makePoolMesh(['tH', 'tE']);
    const sceneSync = makeSceneSync([poolMesh]);
    const rig = makeRig([]);
    const bridge = makeBridge(1, [tok, enemy]);
    const motion = createMotion({ THREE, scene, rig, sceneSync, bridge, canvas, renderer: {} });
    const hoverRing = scene.added[0];

    assert(hoverRing.visible === false, 'hover ring starts hidden');
    rig._hits = [{ tokenId: 'tH' }];
    canvas._fire('pointermove', { clientX: 400, clientY: 300 });
    motion.tick(16, bridge.state());
    assert(hoverRing.visible === true, 'hovering an own token shows the hover ring');
    assert(canvas.style.cursor === 'pointer', 'hovering an own token sets cursor:pointer');
    assert(near(hoverRing.position.x, 3, 1e-6) && near(hoverRing.position.z, 3, 1e-6), 'hover ring is positioned at the hovered token');

    await sleep(40); // clear the ~30Hz hover throttle window (real-wall-clock gated)
    rig._hits = [{ tokenId: 'tE' }]; // enemy token — not mine
    canvas._fire('pointermove', { clientX: 401, clientY: 300 });
    motion.tick(50, bridge.state());
    assert(hoverRing.visible === false, 'hovering an ENEMY token does not show the hover ring');
    assert(canvas.style.cursor === '', 'hovering an enemy token clears the pointer cursor');

    motion.dispose();
  }

  // ---- double-click focus: repeated eased panBy calls converge the camera target ----
  {
    const scene = makeScene();
    const canvas = makeCanvas();
    const tok = { id: 'tF', owner: 1, x: 20, y: 15, rot: 0, shape: 'c', dmm: 32 };
    const poolMesh = makePoolMesh(['tF']);
    const sceneSync = makeSceneSync([poolMesh]);
    const bridge = makeBridge(1, [tok]);

    // self-consistent fake rig: panBy(dx,dy) actually moves camTarget using the SAME
    // ground-basis math the module derives from camera.getWorldDirection(), so this test
    // verifies real end-to-end convergence, not just "panBy was called".
    const camDir = { x: 0, y: -0.5, z: -1 };
    let camTarget = [0, 0];
    const panCalls = [];
    const rig = {
      camera: { getWorldDirection(t) { t.x = camDir.x; t.y = camDir.y; t.z = camDir.z; return t; } },
      raycastFromScreen() { return { intersectObjects: () => rig._hits || [] }; },
      screenToBoard(nx, ny) { return (nx === 0 && ny === 0) ? camTarget.slice() : null; },
      panBy(dx, dy) {
        panCalls.push({ dx, dy });
        const len = Math.hypot(camDir.x, camDir.z) || 1;
        const forward = { x: camDir.x / len, z: camDir.z / len };
        const right = { x: forward.z, z: -forward.x };
        camTarget = [camTarget[0] + right.x * dx + forward.x * dy, camTarget[1] + right.z * dx + forward.z * dy];
      },
      _hits: [{ tokenId: 'tF' }],
    };
    const motion = createMotion({ THREE, scene, rig, sceneSync, bridge, canvas, renderer: {} });

    canvas._fire('dblclick', { clientX: 400, clientY: 300 });
    for (let i = 0; i < 40; i++) motion.tick(16, bridge.state()); // ~640ms of frames
    const remaining = Math.hypot(20 - camTarget[0], 15 - camTarget[1]);
    assert(remaining < 0.15, `double-click focus: camera target converges close to the token (remaining=${remaining.toFixed(4)}in)`);
    assert(panCalls.length > 1, 'double-click focus: driven via multiple eased panBy() calls, not one jump');

    const callsAtConvergence = panCalls.length;
    motion.tick(16, bridge.state());
    assert(panCalls.length === callsAtConvergence, 'focus animation stops issuing panBy() once converged (<0.1in remaining)');

    motion.dispose();
  }

  // ---- dice: batching close, overflow subset, clear-on-new-throw, post-dispose no-op ----
  {
    const scene = makeScene();
    const canvas = makeCanvas();
    const rig = makeRig([]);
    const bridge = makeBridge(1, []);
    const motion = createMotion({ THREE, scene, rig, sceneSync: makeSceneSync([]), bridge, canvas, renderer: {} });
    const baseline = scene.added.length; // hover ring only

    const realNow = performance.now.bind(performance);
    let fakeT = 1000;
    performance.now = () => fakeT;
    try {
      const rolls = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]; // 18 > DICE_CAP
      for (const v of rolls) bridge._fireDice(v); // all pushed at the same fake instant
      motion.tick(16, bridge.state());
      assert(scene.added.length === baseline, 'dice batch still open (<120ms since last push): no dice spawned yet');

      fakeT += 121; // close the batching window
      motion.tick(16, bridge.state());
      const diceMeshes = scene.added.slice(baseline);
      assert(diceMeshes.length === DICE_CAP, `dice batch closes: exactly ${DICE_CAP} physical dice spawned for an 18-roll burst`);
      const shownValues = diceMeshes.map((m) => m.userData.dieValue);
      const counts = (arr) => arr.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {});
      const rollCounts = counts(rolls), shownCounts = counts(shownValues);
      let honest = true;
      for (const v of Object.keys(shownCounts)) if (shownCounts[v] > (rollCounts[v] || 0)) honest = false;
      assert(honest, 'every spawned die shows a value that was actually rolled (overflow honesty, end-to-end)');
      assert(diceMeshes.every((m) => m.isMesh), 'spawned dice are real THREE.Mesh objects sharing the module\'s geometry/material');
      assert(diceMeshes.every((m) => m.geometry === diceMeshes[0].geometry && m.material === diceMeshes[0].material),
        'all dice share one geometry + one material instance (perf rule)');

      // a second throw clears the first before the first even finishes resting.
      fakeT += 200;
      bridge._fireDice(6);
      fakeT += 121;
      motion.tick(16, bridge.state());
      const afterSecond = scene.added.slice(baseline);
      assert(afterSecond.length === 1, 'a new throw clears the previous dice before spawning the new batch');
      assert(!diceMeshes.some((m) => afterSecond.includes(m)), 'none of the first throw\'s meshes remain in the scene after the second throw');

      motion.dispose();
      const countAfterDispose = scene.added.length;
      bridge._fireDice(3); // fired after dispose — must be a silent no-op
      fakeT += 200;
      assert(scene.added.length === countAfterDispose, 'onDice callback is a no-op after dispose() (guarded by the disposed flag)');
    } finally {
      performance.now = realNow;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
