// WP3D-4 interaction tests: run via  node wp3d-4-interaction-tests.js
// Plain node, no DOM — dynamic import() loads the ES-module section fragment.
// Covers: rayToBoardInches plane-intersection math; the pure gesture machine
// (own-token drag past slop, sub-slop click select w/ shift accumulate vs.
// replace, enemy-token drag -> orbit w/ zero tokDrag calls, empty-space drag
// -> orbit, wheel -> zoom w/ the integrator's exact formula, two-finger pinch
// -> zoom+pan, pointercancel mid-drag); and the createInteraction glue layer
// (inch-coordinate drag begin/move/commit, multi-select drag passes all
// selected ids, the two-finger cancel-vs-commit grace-window protocol).

async function main() {
  const mod = await import('../../sections/wp3d-4-interaction.js');
  const { createGestureMachine, rayToBoardInches, createInteraction, WP3D4_GAINS } = mod;

  let passed = 0, failed = 0;
  const assert = (ok, name) => {
    if (ok) { passed++; console.log('ok - ' + name); }
    else { failed++; console.log('FAIL: ' + name); }
  };
  const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

  // ---------------------------------------------------------------------
  // rayToBoardInches — pure plane-intersection math
  // ---------------------------------------------------------------------
  console.log('== rayToBoardInches ==');
  {
    // straight down from (10,5,7) -> hits (10,7)
    const r1 = { origin: { x: 10, y: 5, z: 7 }, direction: { x: 0, y: -1, z: 0 } };
    const hit1 = rayToBoardInches(r1);
    assert(hit1 && approx(hit1[0], 10) && approx(hit1[1], 7), 'straight-down ray hits [ix,iz] under the origin');

    // angled ray
    const r2 = { origin: { x: 0, y: 10, z: 0 }, direction: { x: 1, y: -1, z: 1 } };
    const len = Math.hypot(1, 1, 1);
    const r2n = { origin: r2.origin, direction: { x: 1 / len, y: -1 / len, z: 1 / len } };
    const hit2 = rayToBoardInches(r2n);
    assert(hit2 && approx(hit2[0], 10) && approx(hit2[1], 10), 'angled ray intersects y=0 at expected [ix,iz]');

    // parallel to the plane -> null
    const r3 = { origin: { x: 0, y: 3, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
    assert(rayToBoardInches(r3) === null, 'ray parallel to the board plane -> null');

    // plane behind the ray (pointing away) -> null
    const r4 = { origin: { x: 0, y: 3, z: 0 }, direction: { x: 0, y: 1, z: 0 } };
    assert(rayToBoardInches(r4) === null, 'ray pointing away from the plane -> null');

    // degenerate/missing input -> null, no throw
    assert(rayToBoardInches(null) === null, 'null ray -> null, no throw');
  }

  // ---------------------------------------------------------------------
  // createGestureMachine — pure state machine
  // ---------------------------------------------------------------------
  console.log('== createGestureMachine ==');
  const SLOP = 0.05;
  const mk = (over = {}) => createGestureMachine({ slopNdc: SLOP, graceMs: 300, ...over });

  // -- own token: down, move past slop, move again, up -> begin/move/.../commit
  {
    const m = mk();
    let acts = m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, shiftKey: false, isTouch: false, t: 0 });
    assert(acts.length === 1 && acts[0].kind === 'pick-check', 'own-token: down emits a single pick-check');
    let followUp = m.resolvePick('t1', true);
    assert(Array.isArray(followUp) && followUp.length === 0, 'resolvePick itself emits no actions (deferred to move)');

    // sub-slop move -> nothing yet
    acts = m.handle({ type: 'move', id: 1, nx: SLOP * 0.3, ny: 0, t: 1 });
    assert(acts.length === 0, 'own-token: sub-slop move produces no actions yet');

    // past-slop move -> select + drag-begin + drag-move
    acts = m.handle({ type: 'move', id: 1, nx: SLOP * 3, ny: 0, t: 2 });
    assert(acts.length === 3
      && acts[0].kind === 'click-select' && acts[0].tokenId === 't1' && acts[0].shift === false
      && acts[1].kind === 'drag-begin' && acts[1].tokenId === 't1' && acts[1].nx === 0 && acts[1].ny === 0
      && acts[2].kind === 'drag-move' && approx(acts[2].nx, SLOP * 3),
      'own-token: past-slop move -> [click-select, drag-begin@down-pos, drag-move@current-pos]');

    // subsequent move -> plain drag-move
    acts = m.handle({ type: 'move', id: 1, nx: SLOP * 5, ny: 0.1, t: 3 });
    assert(acts.length === 1 && acts[0].kind === 'drag-move' && approx(acts[0].nx, SLOP * 5) && approx(acts[0].ny, 0.1),
      'own-token: further move -> single drag-move at current position');

    // up -> drag-commit
    acts = m.handle({ type: 'up', id: 1, nx: SLOP * 5, ny: 0.1, t: 4 });
    assert(acts.length === 1 && acts[0].kind === 'drag-commit' && acts[0].tokenId === 't1',
      'own-token: up after a real drag -> drag-commit');
  }

  // -- sub-slop click: select, plain click replaces, shift-click accumulates
  {
    const m = mk();
    m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, shiftKey: false, t: 0 });
    m.resolvePick('t1', true);
    let acts = m.handle({ type: 'up', id: 1, nx: 0, ny: 0, t: 1 }); // no movement at all
    assert(acts.length === 1 && acts[0].kind === 'click-select' && acts[0].tokenId === 't1' && acts[0].shift === false,
      'sub-slop plain click -> click-select {shift:false} (replace semantics live in the glue)');

    m.handle({ type: 'down', id: 2, nx: 0.5, ny: 0.5, buttons: 1, shiftKey: true, t: 2 });
    m.resolvePick('t2', true);
    acts = m.handle({ type: 'up', id: 2, nx: 0.5, ny: 0.5, t: 3 }); // sub-slop
    assert(acts.length === 1 && acts[0].kind === 'click-select' && acts[0].tokenId === 't2' && acts[0].shift === true,
      'sub-slop shift-click -> click-select {shift:true} (accumulate semantics live in the glue)');
  }

  // -- enemy token: drag past slop -> orbit, zero tokDrag-shaped actions
  {
    const m = mk();
    m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, shiftKey: false, t: 0 });
    m.resolvePick('e1', false); // hit, not owned by me
    let acts = m.handle({ type: 'move', id: 1, nx: SLOP * 4, ny: 0, t: 1 });
    assert(acts.length === 1 && acts[0].kind === 'orbit', 'enemy token: past-slop drag resolves to orbit, not drag-begin');
    const anyDragKind = acts.some(a => a.kind.indexOf('drag') === 0);
    assert(!anyDragKind, 'enemy token drag: zero drag-* actions emitted');
    acts = m.handle({ type: 'move', id: 1, nx: SLOP * 6, ny: 0, t: 2 });
    assert(acts.length === 1 && acts[0].kind === 'orbit', 'enemy token: subsequent move keeps orbiting');
    acts = m.handle({ type: 'up', id: 1, nx: SLOP * 6, ny: 0, t: 3 });
    assert(acts.length === 1 && acts[0].kind === 'none', 'enemy token: orbit release -> none (no click-select, no drag-commit)');
  }

  // -- empty space: drag -> orbit
  {
    const m = mk();
    m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, shiftKey: false, t: 0 });
    m.resolvePick(null, false);
    const acts = m.handle({ type: 'move', id: 1, nx: 0, ny: SLOP * 3, t: 1 });
    assert(acts.length === 1 && acts[0].kind === 'orbit', 'empty space: past-slop drag -> orbit');
  }

  // -- RMB / shift+LMB-on-empty -> pan
  {
    const m = mk();
    // RMB: no pick-check at all, immediately armed for pan
    let acts = m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 2, shiftKey: false, t: 0 });
    assert(acts.length === 0, 'RMB down: no pick-check (unconditional pan arm)');
    acts = m.handle({ type: 'move', id: 1, nx: SLOP * 3, ny: 0, t: 1 });
    assert(acts.length === 1 && acts[0].kind === 'pan', 'RMB drag -> pan');

    const m2 = mk();
    m2.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, shiftKey: true, t: 0 });
    m2.resolvePick(null, false); // shift + empty
    acts = m2.handle({ type: 'move', id: 1, nx: 0, ny: SLOP * 3, t: 1 });
    assert(acts.length === 1 && acts[0].kind === 'pan', 'shift+LMB on empty space -> pan');
  }

  // -- wheel -> zoom, integrator's exact formula: f = base^(-deltaY/divisor)
  {
    const m = mk();
    const deltaY = 106; // -> exponent -2 with the default divisor (53)
    const acts = m.handle({ type: 'wheel', id: -1, nx: 0, ny: 0, deltaY });
    const expected = Math.pow(WP3D4_GAINS.zoomWheelBase, -deltaY / WP3D4_GAINS.zoomWheelDivisor);
    assert(acts.length === 1 && acts[0].kind === 'zoom' && approx(acts[0].factor, expected),
      `wheel -> zoom{factor} matches base^(-deltaY/divisor) (got ${acts[0] && acts[0].factor}, expected ${expected})`);
  }

  // -- two-finger pinch: spreading fingers -> zoom in (factor<1) + centroid move -> pan
  {
    const m = mk();
    m.handle({ type: 'down', id: 1, nx: -0.1, ny: 0, buttons: 1, t: 0 });
    m.resolvePick(null, false); // arm empty/orbit for pointer 1 (still pre-slop, no camera mode entered yet)
    let acts = m.handle({ type: 'down', id: 2, nx: 0.1, ny: 0, buttons: 1, t: 1 });
    assert(acts.length === 0, 'second finger while first is still pre-slop armed: no cancel needed, silently collapses to camera2');

    // fingers spread apart + centroid shifts right
    acts = m.handle({ type: 'move', id: 1, nx: -0.3, ny: 0, t: 2 });
    const zoomAct = acts.find(a => a.kind === 'zoom');
    const panAct = acts.find(a => a.kind === 'pan');
    assert(!!zoomAct && !!panAct, 'two-finger move emits both a zoom and a pan action');
    assert(zoomAct.factor < 1, 'fingers spreading apart -> zoom factor < 1 (zoom in)');
    assert(approx(panAct.dx, -0.1), 'pan dx matches the centroid shift');
  }

  // -- second finger cancels a FRESH (<300ms) 1-finger token drag: drag-cancel path
  {
    const m = mk();
    m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, t: 0 });
    m.resolvePick('t1', true);
    let acts = m.handle({ type: 'move', id: 1, nx: SLOP * 3, ny: 0, t: 10 }); // begins the drag at t=10
    assert(acts.some(a => a.kind === 'drag-begin'), 'sanity: token-drag actually began');

    acts = m.handle({ type: 'down', id: 2, nx: 0.5, ny: 0.5, buttons: 1, t: 50 }); // 40ms later, < 300ms grace
    assert(acts.length === 1 && acts[0].kind === 'drag-cancel', 'fresh (<300ms) token-drag + 2nd finger -> drag-cancel');
  }

  // -- second finger against an ESTABLISHED (>=300ms) drag: drag-commit-in-place instead
  {
    const m = mk();
    m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, t: 0 });
    m.resolvePick('t1', true);
    m.handle({ type: 'move', id: 1, nx: SLOP * 3, ny: 0, t: 10 });

    const acts = m.handle({ type: 'down', id: 2, nx: 0.5, ny: 0.5, buttons: 1, t: 500 }); // 490ms later
    assert(acts.length === 1 && acts[0].kind === 'drag-commit' && acts[0].tokenId === 't1',
      'established (>=300ms) token-drag + 2nd finger -> drag-commit in place (documented, not contract-mandated)');
  }

  // -- pointercancel mid-drag -> drag-cancel
  {
    const m = mk();
    m.handle({ type: 'down', id: 1, nx: 0, ny: 0, buttons: 1, t: 0 });
    m.resolvePick('t1', true);
    m.handle({ type: 'move', id: 1, nx: SLOP * 3, ny: 0, t: 1 });
    const acts = m.handle({ type: 'cancel', id: 1, nx: SLOP * 3, ny: 0, t: 2 });
    assert(acts.length === 1 && acts[0].kind === 'drag-cancel', 'pointercancel mid-drag -> drag-cancel (unconditional, no grace check)');
  }

  // ---------------------------------------------------------------------
  // createInteraction — DOM glue layer (mock canvas/bridge/rig/sceneSync)
  // ---------------------------------------------------------------------
  console.log('== createInteraction (glue) ==');

  function makeCanvas(w = 800, h = 600) {
    const handlers = {};
    return {
      clientWidth: w, clientHeight: h,
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      removeEventListener(type, fn) { if (handlers[type]) handlers[type] = handlers[type].filter(f => f !== fn); },
      getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
      setPointerCapture() {}, releasePointerCapture() {},
      _fire(type, e) { (handlers[type] || []).forEach(fn => fn(Object.assign({ preventDefault() {}, pointerType: 'mouse' }, e))); },
    };
  }

  function makeBridge(mySide, tokens) {
    const calls = { tokDragBegin: [], tokDragMove: [], tokDragCommit: 0 };
    return {
      calls,
      sel: new Set(),
      state() { return { tokens, board: { w: 60, h: 44 } }; },
      mySide() { return mySide; },
      tokDragBegin(ids, ix, iy) { calls.tokDragBegin.push({ ids: [...ids], ix, iy }); },
      tokDragMove(ix, iy) { calls.tokDragMove.push({ ix, iy }); },
      tokDragCommit() { calls.tokDragCommit++; },
    };
  }

  // deterministic screenToBoard: ix = nx*30+30, iy = ny*22+22 (invertible, easy to hand-check)
  function makeRig() {
    return {
      camera: { fov: 50, position: { distanceTo() { return 40; } } },
      screenToBoard(nx, ny) { return [nx * 30 + 30, ny * 22 + 22]; },
      raycastFromScreen(nx, ny) { return { intersectObjects: () => this._hits || [] }; },
      orbitBy(dx, dy) { this.orbitCalls = (this.orbitCalls || []).concat([{ dx, dy }]); },
      panBy(dx, dy) { this.panCalls = (this.panCalls || []).concat([{ dx, dy }]); },
      zoomBy(f) { this.zoomCalls = (this.zoomCalls || []).concat([f]); },
    };
  }

  function makeSceneSync(hitTokenId) {
    return {
      pickMeshes() { return ['mesh-stub']; },
      tokenAt() { return hitTokenId; },
    };
  }

  const TOKENS = [
    { id: 't1', owner: 1, unit: 'u1' },
    { id: 't2', owner: 1, unit: 'u1' },
    { id: 't3', owner: 1, unit: 'u2' },
    { id: 'e1', owner: 2, unit: 'eu1' },
  ];

  // -- own-token drag: begin/move/commit called with screenToBoard-converted inch coords
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    const rig = makeRig();
    rig._hits = [{ dummy: true }];
    const sceneSync = makeSceneSync('t1');
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, buttons: 1, shiftKey: false }); // center -> nx=0,ny=0
    canvas._fire('pointermove', { pointerId: 1, clientX: 500, clientY: 300, buttons: 1 }); // nx moves right past slop
    canvas._fire('pointerup', { pointerId: 1, clientX: 500, clientY: 300, buttons: 0 });

    assert(bridge.calls.tokDragBegin.length === 1 && bridge.calls.tokDragBegin[0].ids[0] === 't1'
      && approx(bridge.calls.tokDragBegin[0].ix, 30) && approx(bridge.calls.tokDragBegin[0].iy, 22),
      'own-token drag: tokDragBegin called once with screenToBoard(down-nx,down-ny) inches');
    assert(bridge.calls.tokDragMove.length >= 1, 'own-token drag: tokDragMove called at least once');
    const lastMove = bridge.calls.tokDragMove[bridge.calls.tokDragMove.length - 1];
    const expectedNx = (500 / 800) * 2 - 1; // 0.25
    assert(approx(lastMove.ix, expectedNx * 30 + 30), 'own-token drag: final tokDragMove uses screenToBoard(current-nx,current-ny)');
    assert(bridge.calls.tokDragCommit === 1, 'own-token drag: tokDragCommit called exactly once on up');
    assert(bridge.sel.has('t1'), 'own-token drag: t1 ended up selected');
    inter.dispose();
  }

  // -- multi-select drag: clicked token already in a multi-selection of my own tokens -> drag ALL of them
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    bridge.sel.add('t1'); bridge.sel.add('t2'); bridge.sel.add('t3');
    const rig = makeRig();
    rig._hits = [{ dummy: true }];
    const sceneSync = makeSceneSync('t2'); // click lands on t2, already part of the selection
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, buttons: 1, shiftKey: false });
    canvas._fire('pointermove', { pointerId: 1, clientX: 500, clientY: 300, buttons: 1 });
    canvas._fire('pointerup', { pointerId: 1, clientX: 500, clientY: 300, buttons: 0 });

    const begun = bridge.calls.tokDragBegin[0];
    assert(begun && begun.ids.length === 3 && ['t1', 't2', 't3'].every(id => begun.ids.includes(id)),
      'multi-select drag: tokDragBegin passes all 3 selected own-token ids, not just the clicked one');
    inter.dispose();
  }

  // -- multi-select drag does NOT pull in enemy tokens that happen to be in sel
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    bridge.sel.add('t1'); bridge.sel.add('e1');
    const rig = makeRig();
    rig._hits = [{ dummy: true }];
    const sceneSync = makeSceneSync('t1');
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, buttons: 1, shiftKey: false });
    canvas._fire('pointermove', { pointerId: 1, clientX: 500, clientY: 300, buttons: 1 });
    canvas._fire('pointerup', { pointerId: 1, clientX: 500, clientY: 300, buttons: 0 });

    const begun = bridge.calls.tokDragBegin[0];
    assert(begun && begun.ids.length === 1 && begun.ids[0] === 't1',
      'multi-select drag: enemy token in sel is excluded (only 1 own token selected -> single drag)');
    inter.dispose();
  }

  // -- enemy-token drag: camera orbitBy called, zero tokDrag* bridge calls
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    const rig = makeRig();
    rig._hits = [{ dummy: true }];
    const sceneSync = makeSceneSync('e1');
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, buttons: 1, shiftKey: false });
    canvas._fire('pointermove', { pointerId: 1, clientX: 500, clientY: 300, buttons: 1 });
    canvas._fire('pointerup', { pointerId: 1, clientX: 500, clientY: 300, buttons: 0 });

    assert(bridge.calls.tokDragBegin.length === 0 && bridge.calls.tokDragMove.length === 0 && bridge.calls.tokDragCommit === 0,
      'enemy-token drag: zero tokDrag* bridge calls');
    assert((rig.orbitCalls || []).length >= 1, 'enemy-token drag: rig.orbitBy was called');
    inter.dispose();
  }

  // -- empty-space drag: orbitBy called
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    const rig = makeRig();
    rig._hits = [];
    const sceneSync = makeSceneSync(null);
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, buttons: 1, shiftKey: false });
    canvas._fire('pointermove', { pointerId: 1, clientX: 400, clientY: 400, buttons: 1 });
    canvas._fire('pointerup', { pointerId: 1, clientX: 400, clientY: 400, buttons: 0 });

    assert((rig.orbitCalls || []).length >= 1, 'empty-space drag: rig.orbitBy was called');
    assert(bridge.calls.tokDragBegin.length === 0, 'empty-space drag: no tokDragBegin');
    inter.dispose();
  }

  // -- wheel over the glue: rig.zoomBy called with the expected factor
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    const rig = makeRig();
    const sceneSync = makeSceneSync(null);
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('wheel', { deltaY: 106 });
    const expected = Math.pow(WP3D4_GAINS.zoomWheelBase, -106 / WP3D4_GAINS.zoomWheelDivisor);
    assert((rig.zoomCalls || []).length === 1 && approx(rig.zoomCalls[0], expected), 'wheel: rig.zoomBy called with base^(-deltaY/divisor)');
    inter.dispose();
  }

  // -- cancel snap-back protocol: fresh 2nd finger cancels a token drag via tokDragMove(start)+tokDragCommit()
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    const rig = makeRig();
    rig._hits = [{ dummy: true }];
    const sceneSync = makeSceneSync('t1');
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, buttons: 1, shiftKey: false });
    canvas._fire('pointermove', { pointerId: 1, clientX: 500, clientY: 300, buttons: 1 }); // begins drag @ (30,22), moves to (37.5,22)
    const startCall = bridge.calls.tokDragBegin[0];

    canvas._fire('pointerdown', { pointerId: 2, clientX: 600, clientY: 300, buttons: 1, shiftKey: false }); // 2nd finger, immediately (fresh)

    const lastMove = bridge.calls.tokDragMove[bridge.calls.tokDragMove.length - 1];
    assert(approx(lastMove.ix, startCall.ix) && approx(lastMove.iy, startCall.iy),
      'cancel protocol: final tokDragMove snaps back to the drag-begin (start) coordinates');
    assert(bridge.calls.tokDragCommit === 1, 'cancel protocol: tokDragCommit called once to let commit\'s own snap-back settle it');
    inter.dispose();
  }

  // -- pointercancel mid-drag over the glue: same cancel protocol fires
  {
    const canvas = makeCanvas();
    const bridge = makeBridge(1, TOKENS);
    const rig = makeRig();
    rig._hits = [{ dummy: true }];
    const sceneSync = makeSceneSync('t1');
    const inter = createInteraction(canvas, bridge, rig, sceneSync);

    canvas._fire('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, buttons: 1, shiftKey: false });
    canvas._fire('pointermove', { pointerId: 1, clientX: 500, clientY: 300, buttons: 1 });
    const startCall = bridge.calls.tokDragBegin[0];
    canvas._fire('pointercancel', { pointerId: 1, clientX: 500, clientY: 300, buttons: 0 });

    const lastMove = bridge.calls.tokDragMove[bridge.calls.tokDragMove.length - 1];
    assert(approx(lastMove.ix, startCall.ix) && approx(lastMove.iy, startCall.iy) && bridge.calls.tokDragCommit === 1,
      'pointercancel mid-drag (glue): snaps back to start and commits once');
    inter.dispose();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => {
  console.error('FAIL: uncaught error - ' + (err && err.stack || err));
  process.exitCode = 1;
});
