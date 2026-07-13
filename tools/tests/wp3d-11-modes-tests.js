// WP3D-11 mode manager tests: run via `node wp3d-11-modes-tests.js` from tools/tests/.
// Plain node, no DOM/WebGL — three.js core objects are pure JS/math (established by the
// other wp3d-*-tests.js suites). Fakes for canvas/rig/sceneSync/bridge follow the exact
// patterns wp3d-4-interaction-tests.js / wp3d-10-motion-tests.js already established
// (makeCanvas/_fire with capture-arg tolerance, makeBridge, makeRig with call-tracking).
(async () => {
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log('ok - ' + name); } else { failed++; console.log('FAIL: ' + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

  const THREE = await import('../../vendor/three.module.min.js');
  const M = await import('../../sections/wp3d-11-modes.js');
  const {
    createModes, pixelRatioFor, shouldBlockPipPointerdown, shouldAutoFrame,
    centroidOf, desiredRadiusForSpread, pickFocusTargets,
    PIP_AUTOFRAME_YIELD_MS, PIP_DPR_CAP,
  } = M;

  // =========================================================================================
  console.log('== pixelRatioFor: policy table ==');
  {
    const rows = [
      // [mode, tier, dpr, expected, label]
      ['full', { pixelRatioCap: 2 }, 1, 1, 'full, desktop tier, dpr1 -> 1'],
      ['full', { pixelRatioCap: 2 }, 3, 2, 'full, desktop tier, dpr3 -> capped at tier 2'],
      ['full', { pixelRatioCap: 1.5 }, 3, 1.5, 'full, phone tier, dpr3 -> capped at tier 1.5'],
      ['pip', { pixelRatioCap: 1.5 }, 3, 2, 'pip, phone tier, dpr3 -> allowed up to 2 despite phone tier cap'],
      ['pip', { pixelRatioCap: 1.5 }, 1, 1, 'pip, phone tier, dpr1 -> just the device dpr (no upscaling)'],
      ['pip', { pixelRatioCap: 2 }, 3, 2, 'pip, desktop tier, dpr3 -> capped at 2 (pip cap == tier cap here)'],
      ['off', { pixelRatioCap: 1.5 }, 3, 1.5, 'off falls back to tier cap like full'],
    ];
    for (const [mode, tier, dpr, expected, label] of rows) {
      assert(near(pixelRatioFor(mode, tier, dpr), expected, 1e-9), label);
    }
    assert(PIP_DPR_CAP === 2, 'PIP_DPR_CAP constant is 2 (small inset affords DPR2 even on phone tier)');
  }

  // =========================================================================================
  console.log('== shouldBlockPipPointerdown: pure drag-block decision ==');
  {
    assert(shouldBlockPipPointerdown('pip', 't1') === true, 'pip + token hit -> block');
    assert(shouldBlockPipPointerdown('pip', null) === false, 'pip + empty-space (no token) -> do not block (camera must still work)');
    assert(shouldBlockPipPointerdown('full', 't1') === false, 'full mode + token hit -> never block (3D is the play surface in full)');
    assert(shouldBlockPipPointerdown('off', 't1') === false, 'off mode -> never block');
  }

  // =========================================================================================
  console.log('== shouldAutoFrame: shared 5s yield gate ==');
  {
    assert(shouldAutoFrame('pip', 5001) === true, 'pip, quiet just over 5000ms -> auto-frame allowed');
    assert(shouldAutoFrame('pip', 5000) === false, 'pip, quiet exactly at 5000ms -> gate is a strict >, not >=');
    assert(shouldAutoFrame('pip', 4999) === false, 'pip, quiet under 5000ms -> gated off (user still "recently" interacted)');
    assert(shouldAutoFrame('full', 9999) === false, 'full mode never auto-frames (PiP-only feature)');
    assert(shouldAutoFrame('off', 9999) === false, 'off mode never auto-frames');
    assert(shouldAutoFrame('pip', 9999, 2000) === true, 'custom yieldMs override respected');
    assert(PIP_AUTOFRAME_YIELD_MS === 5000, 'PIP_AUTOFRAME_YIELD_MS constant matches the contract-mandated 5000ms');
  }

  // =========================================================================================
  console.log('== centroidOf / desiredRadiusForSpread: pure framing math ==');
  {
    assert(centroidOf([]) === null, 'centroidOf([]) is null');
    assert(centroidOf(null) === null, 'centroidOf(null) is null');
    const c = centroidOf([{ x: 0, y: 0 }, { x: 10, y: 4 }]);
    assert(near(c.x, 5) && near(c.y, 2), 'centroidOf averages x/y across all points');

    assert(desiredRadiusForSpread([{ x: 5, y: 5 }]) === 10, 'single-token spread -> fixed close-up default radius (10)');
    assert(desiredRadiusForSpread([]) === 10, 'empty spread -> same close-up default (defensive)');
    const rTight = desiredRadiusForSpread([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    const rWide = desiredRadiusForSpread([{ x: 0, y: 0 }, { x: 30, y: 30 }]);
    assert(rWide > rTight, 'a wider spread of tokens wants a larger framing radius than a tight cluster');
    assert(rTight >= 8 && rWide <= 40, 'radius always stays within the sane [8,40] clamp');
  }

  // =========================================================================================
  console.log('== pickFocusTargets: priority sel > remotemove > board ==');
  {
    const tokensById = { a: { x: 1, y: 1 }, b: { x: 3, y: 3 }, c: { x: 9, y: 9 } };

    const selSet = new Set(['a', 'b']);
    const withSel = pickFocusTargets({ sel: selSet, tokensById, lastRemoteMove: { tokenIds: ['c'] } });
    assert(withSel.kind === 'selection' && withSel.points.length === 2, 'a non-empty selection wins over a pending remote-move');

    const noSel = pickFocusTargets({ sel: new Set(), tokensById, lastRemoteMove: { tokenIds: ['c'] } });
    assert(noSel.kind === 'remotemove' && noSel.points.length === 1, 'empty selection falls back to the last remote move');

    const nothing = pickFocusTargets({ sel: new Set(), tokensById, lastRemoteMove: null });
    assert(nothing.kind === 'board' && nothing.points === null, 'no selection and no remote move -> whole-board framing');

    const staleSel = pickFocusTargets({ sel: new Set(['ghost']), tokensById, lastRemoteMove: { tokenIds: ['c'] } });
    assert(staleSel.kind === 'remotemove', 'a selection referencing only vanished tokens falls through to remotemove, not a dead frame');

    const staleBoth = pickFocusTargets({ sel: new Set(['ghost']), tokensById, lastRemoteMove: { tokenIds: ['ghost2'] } });
    assert(staleBoth.kind === 'board', 'both selection and remote-move stale -> falls all the way through to board');

    const undefSel = pickFocusTargets({ tokensById, lastRemoteMove: null });
    assert(undefSel.kind === 'board', 'missing sel entirely (no bridge.sel) does not throw, falls through to board');
  }

  // =========================================================================================
  console.log('== createModes: integration (fakes for canvas/rig/sceneSync/bridge/rendererCtl) ==');

  function makeCanvas(w, h) {
    const handlers = {};
    return {
      _w: w, _h: h,
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      removeEventListener(type, fn) { if (handlers[type]) handlers[type] = handlers[type].filter((f) => f !== fn); },
      getBoundingClientRect() { return { left: 0, top: 0, width: this._w, height: this._h }; },
      _fire(type, e) { (handlers[type] || []).slice().forEach((fn) => fn(e)); },
      _handlerCount(type) { return (handlers[type] || []).length; },
    };
  }
  function makeSceneSync(hits) {
    return {
      pickMeshes() { return []; },
      tokenAt(hit) { return hit && hit.tokenId != null ? hit.tokenId : null; },
      _hits: hits || [],
    };
  }
  function makeRig(opts) {
    const o = opts || {};
    const camTarget = o.camTarget || [30, 22];
    const camPos = o.camPos || { x: 30, y: 30, z: 62 };
    const panCalls = [], zoomCalls = [];
    return {
      camera: { position: camPos, getWorldDirection(t) { t.x = 0; t.y = -0.5; t.z = -1; return t; } },
      raycastFromScreen() { return { intersectObjects: () => o.hits || [] }; },
      screenToBoard(nx, ny) { return (nx === 0 && ny === 0) ? camTarget.slice() : null; },
      panBy(dx, dy) { panCalls.push({ dx, dy }); },
      zoomBy(f) { zoomCalls.push(f); },
      lookAtBoard() { this._lookedAtBoard = (this._lookedAtBoard || 0) + 1; },
      _panCalls: panCalls, _zoomCalls: zoomCalls,
    };
  }
  function makeBridge(sel) { return { sel }; }
  function makeRendererCtl() {
    const ratios = [];
    return { renderer: { setPixelRatio(r) { ratios.push(r); } }, _ratios: ratios };
  }

  // ---- setMode drives sizeTo with canvas-rect dims + pixel ratio recompute ----
  {
    const canvas = makeCanvas(340, 220);
    const rendererCtl = makeRendererCtl();
    const sizeCalls = [];
    const tier = { pixelRatioCap: 1.5 }; // phone tier, to exercise the pip DPR2 override
    global.devicePixelRatio = 3;
    const modes = createModes({
      THREE, canvas, rendererCtl, rig: makeRig(), labels: {}, interaction: {},
      sceneSync: makeSceneSync(), motion: {}, bridge: makeBridge(new Set()), tier,
      sizeTo: (w, h) => sizeCalls.push({ w, h }),
    });

    modes.setMode('pip');
    assert(sizeCalls.length === 1 && sizeCalls[0].w === 340 && sizeCalls[0].h === 220,
      'setMode(pip) reads the canvas rect (340x220) and drives sizeTo with those exact dims');
    assert(near(rendererCtl._ratios[rendererCtl._ratios.length - 1], 2),
      'setMode(pip) on a phone-tier device still sets pixel ratio to 2 (pip DPR2 override)');
    assert(modes.getMode() === 'pip', 'getMode() reflects the mode just set');

    canvas._w = 1440; canvas._h = 900; // simulate the boardwrap class flip resizing #board3d to full
    modes.setMode('full');
    assert(sizeCalls.length === 2 && sizeCalls[1].w === 1440 && sizeCalls[1].h === 900,
      'setMode(full) re-reads the (now different) canvas rect and drives sizeTo again — the PiP resize blocker fix');
    assert(near(rendererCtl._ratios[rendererCtl._ratios.length - 1], 1.5),
      'setMode(full) on the same phone-tier device drops back to the tier cap (1.5)');

    modes.dispose();
    delete global.devicePixelRatio;
  }

  // ---- setMode skips sizeTo on a degenerate (hidden) rect but still updates mode/ratio ----
  {
    const canvas = makeCanvas(0, 0);
    const rendererCtl = makeRendererCtl();
    const sizeCalls = [];
    const modes = createModes({
      THREE, canvas, rendererCtl, rig: makeRig(), sceneSync: makeSceneSync(), motion: {},
      bridge: makeBridge(new Set()), tier: { pixelRatioCap: 2 }, sizeTo: (w, h) => sizeCalls.push({ w, h }),
    });
    modes.setMode('off');
    assert(sizeCalls.length === 0, 'a zero-size (hidden) canvas rect never drives a bogus sizeTo(0,0) call');
    assert(modes.getMode() === 'off', 'mode bookkeeping still updates even when the canvas is hidden');
    modes.dispose();
  }

  // ---- userQuietFor: injectable clock ----
  {
    let fakeT = 1000;
    const canvas = makeCanvas(340, 220);
    const modes = createModes({
      THREE, canvas, rendererCtl: makeRendererCtl(), rig: makeRig(), sceneSync: makeSceneSync(),
      motion: {}, bridge: makeBridge(new Set()), tier: { pixelRatioCap: 2 },
      sizeTo() {}, now: () => fakeT,
    });
    assert(modes.userQuietFor() === 0, 'freshly created: quiet-for is 0 at its own creation instant');
    fakeT += 3000;
    assert(near(modes.userQuietFor(), 3000), 'quiet-for grows with the injected clock when nothing touches the canvas');
    canvas._fire('wheel', {});
    assert(near(modes.userQuietFor(), 0), 'a wheel event on the canvas resets quiet-for to 0');
    fakeT += 2000;
    canvas._fire('pointermove', {});
    assert(near(modes.userQuietFor(), 0), 'a pointermove on the canvas also resets quiet-for');
    fakeT += 6000;
    assert(near(modes.userQuietFor(), 6000), 'quiet-for keeps counting up with no further input');
    modes.dispose();
  }

  // ---- auto-frame target selection priority + 5s yield gate, driven through tick() ----
  {
    let fakeT = 0;
    const canvas = makeCanvas(340, 220);
    const rig = makeRig({ camTarget: [0, 0], camPos: { x: 0, y: 30, z: 30 } });
    const sel = new Set();
    const state = { tokens: [{ id: 'a', x: 20, y: 15 }, { id: 'b', x: 24, y: 15 }, { id: 'c', x: 5, y: 5 }] };
    const modes = createModes({
      THREE, canvas, rendererCtl: makeRendererCtl(), rig, sceneSync: makeSceneSync(),
      motion: {}, bridge: makeBridge(sel), tier: { pixelRatioCap: 2 }, sizeTo() {}, now: () => fakeT,
    });
    modes.setMode('pip');

    modes.tick(16, state);
    assert(rig._panCalls.length === 0 && !rig._lookedAtBoard, 'no auto-frame at all while quiet-for is still under the 5s gate');

    fakeT = 5001;
    sel.add('a'); sel.add('b');
    modes.tick(16, state);
    assert(rig._panCalls.length > 0, 'once quiet, a non-empty selection drives pan steps toward its centroid');
    assert(!rig._lookedAtBoard, 'selection present -> whole-board framing is NOT used');

    const panCallsWithSel = rig._panCalls.length;
    sel.clear();
    modes.tick(16, state); // no motion.on wired (stub-guarded) -> no lastRemoteMove -> falls to board
    assert(rig._lookedAtBoard === 1, 'selection cleared, no remote-move recorded -> falls through to whole-board framing (rig.lookAtBoard called)');
    assert(rig._panCalls.length === panCallsWithSel, 'board framing does not also issue manual panBy steps');

    canvas._fire('wheel', {}); // user touches the canvas -> quiet-for resets -> auto-frame must stop
    modes.tick(16, state);
    assert(rig._lookedAtBoard === 1, 'a fresh user input resets the yield gate; auto-frame does not fire again immediately');

    modes.dispose();
  }

  // ---- motion.on missing (stub) is tolerated; motion.on present feeds remotemove into priority ----
  {
    let fakeT = 0;
    const canvas = makeCanvas(340, 220);
    const rig = makeRig({ camTarget: [0, 0], camPos: { x: 0, y: 30, z: 30 } });
    let remoteCb = null;
    const motion = { on(evt, cb) { if (evt === 'remotemove') remoteCb = cb; } };
    const state = { tokens: [{ id: 'z', x: 40, y: 30 }] };
    const modes = createModes({
      THREE, canvas, rendererCtl: makeRendererCtl(), rig, sceneSync: makeSceneSync(),
      motion, bridge: makeBridge(new Set()), tier: { pixelRatioCap: 2 }, sizeTo() {}, now: () => fakeT,
    });
    modes.setMode('pip');
    assert(typeof remoteCb === 'function', 'createModes subscribes to motion.on(\'remotemove\', ...) when the API is present');
    remoteCb({ tokenIds: ['z'] });
    fakeT = 6000; // past the 5s yield gate
    modes.tick(16, state);
    assert(rig._panCalls.length > 0 && !rig._lookedAtBoard, 'with no selection, a recorded remote-move drives the auto-frame instead of the whole board');
    modes.dispose();

    // stub-less motion (contract: consumers must tolerate `on` missing) must not throw.
    let threw = false;
    try {
      const m2 = createModes({
        THREE, canvas: makeCanvas(340, 220), rendererCtl: makeRendererCtl(), rig: makeRig(),
        sceneSync: makeSceneSync(), motion: {}, bridge: makeBridge(new Set()),
        tier: { pixelRatioCap: 2 }, sizeTo() {},
      });
      m2.dispose();
    } catch (e) { threw = true; }
    assert(!threw, 'a motion dep with no .on at all (older stub shape) never throws during createModes/dispose');
  }

  // ---- PiP drag-block: capture listener blocks a token-hit pointerdown, lets empty-space through ----
  {
    const canvas = makeCanvas(340, 220);
    const rig = makeRig();
    const sceneSync = makeSceneSync();
    const modes = createModes({
      THREE, canvas, rendererCtl: makeRendererCtl(), rig, sceneSync, motion: {},
      bridge: makeBridge(new Set()), tier: { pixelRatioCap: 2 }, sizeTo() {},
    });
    modes.setMode('pip');

    let stopped = false, prevented = false;
    rig.raycastFromScreen = () => ({ intersectObjects: () => [{ tokenId: 'hitme' }] });
    canvas._fire('pointerdown', {
      clientX: 170, clientY: 110,
      stopImmediatePropagation() { stopped = true; },
      preventDefault() { prevented = true; },
    });
    assert(stopped && prevented, 'PiP + pointerdown that would pick a token -> event is stopped before reaching wp3d-4');

    stopped = false; prevented = false;
    rig.raycastFromScreen = () => ({ intersectObjects: () => [] }); // empty space
    canvas._fire('pointerdown', {
      clientX: 170, clientY: 110,
      stopImmediatePropagation() { stopped = true; },
      preventDefault() { prevented = true; },
    });
    assert(!stopped && !prevented, 'PiP + pointerdown on empty space is left alone -> orbit/pan/zoom still reach wp3d-4');

    modes.setMode('full');
    stopped = false;
    rig.raycastFromScreen = () => ({ intersectObjects: () => [{ tokenId: 'hitme' }] });
    canvas._fire('pointerdown', {
      clientX: 170, clientY: 110,
      stopImmediatePropagation() { stopped = true; },
      preventDefault() {},
    });
    assert(!stopped, 'in full mode, token pointerdowns are never intercepted (3D is the play surface there)');

    modes.dispose();
  }

  // ---- dispose() removes listeners ----
  {
    const canvas = makeCanvas(340, 220);
    const modes = createModes({
      THREE, canvas, rendererCtl: makeRendererCtl(), rig: makeRig(), sceneSync: makeSceneSync(),
      motion: {}, bridge: makeBridge(new Set()), tier: { pixelRatioCap: 2 }, sizeTo() {},
    });
    assert(canvas._handlerCount('pointerdown') === 1, 'createModes registers exactly one pointerdown listener on the fallback (no-window) target');
    assert(canvas._handlerCount('pointermove') === 1 && canvas._handlerCount('wheel') === 1,
      'createModes registers exactly one pointermove + one wheel listener for quiet-tracking');
    modes.dispose();
    assert(canvas._handlerCount('pointerdown') === 0 && canvas._handlerCount('pointermove') === 0 && canvas._handlerCount('wheel') === 0,
      'dispose() removes every listener it registered');
  }

  console.log(failed ? `WP3D-11 MODES TESTS: ${failed} FAILURES (${passed} passed)` : `WP3D-11 MODES TESTS: ALL ${passed} PASSED`);
  process.exitCode = failed ? 1 : 0;
})();
