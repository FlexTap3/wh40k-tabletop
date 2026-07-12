/* ==== WP3D-4: interaction (picking + drag) ====
 * Pure gesture state machine (createGestureMachine) + a thin DOM glue layer
 * (createInteraction) that answers pick-checks via rig/sceneSync and drives
 * the bridge's tokDragBegin/Move/Commit commit pipeline. See
 * scratchpad/WP3D-CONTRACT.md for the frozen inter-packet API.
 *
 * Design notes (documented per the contract's "document your choice"):
 *
 * 1. SLOP GATING: tokDragBegin is NOT called at pointerdown. The gesture
 *    machine "arms" on down (after a pick-check resolves what's under the
 *    cursor) and only resolves into a concrete drag/orbit/pan once the
 *    pointer has moved past `slopNdc` from the down point. A sub-slop
 *    release is a pure click (`click-select`), with zero bridge calls —
 *    this avoids spurious tokDragBegin/Commit pairs (and their coherency/
 *    terrain-collision/undo-snapshot side effects) for plain clicks.
 *
 * 2. TWO-FINGER CANCEL PROTOCOL: when a second pointer touches down while a
 *    1-finger token-drag is active, camera control ALWAYS takes over
 *    (`mode -> camera2`). What happens to the in-flight drag depends on its
 *    age at that instant:
 *      - age < twoFingerGraceMs (300ms, the "a 2nd finger landed on a mini
 *        by accident" grace window) -> emit `drag-cancel`. The glue's
 *        cancel handler calls tokDragMove(startIx,startIy) then
 *        tokDragCommit() — i.e. snap back to the drag's start position and
 *        let commit's own snap-back/coherency logic settle it, exactly as
 *        the assignment's "better" option suggests.
 *      - age >= twoFingerGraceMs -> emit `drag-commit` at the CURRENT
 *        position instead of cancelling. Rationale (not specified by the
 *        contract, my call): an established, deliberate drag shouldn't
 *        lose the user's placement just because a second finger touched
 *        down; only the "so fresh it's probably not intentional" case gets
 *        the destructive snap-back.
 *    `pointercancel` on a token-drag pointer is UNCONDITIONAL `drag-cancel`
 *    regardless of age (a system-forced abort, not a graceful hand-off).
 *
 * 3. SELECTION SEMANTICS: the machine never touches bridge.sel directly —
 *    it only emits `click-select` {tokenId, shift}; the glue applies it
 *    with the exact 2D rule (see wh40k-tabletop.html ~3073-3076):
 *      already selected + shift  -> remove
 *      already selected + !shift -> leave selection AS-IS (this is what
 *                                    lets a plain click-drag on a token
 *                                    that's part of a multi-selection drag
 *                                    the whole group, matching 2D's marquee
 *                                    -> multi-drag behaviour)
 *      not selected + shift      -> add (accumulate)
 *      not selected + !shift     -> clear() then add (replace)
 *    Selection granularity is SINGLE TOKEN, not whole-unit — this matches
 *    the 2D pointer pipeline, which does `sel.add(tk.id)` (one model), not
 *    `sel.add(...unit mates)`; whole-unit selection is a separate feature
 *    2D doesn't have at the pointer layer either. Flagged for the
 *    integrator in case 3D wants unit-level select later.
 *    NOT replicated: 2D's quirk where shift-clicking an ALREADY-selected
 *    token does `return` immediately and blocks ALL further pointer
 *    handling (even camera) until pointerup. That reads as an artifact of
 *    2D's single global `drag` variable rather than intentional UX; here
 *    shift+click-to-deselect an already-selected own token still arms a
 *    (now selection-neutral) drag/camera gesture like any other pointer
 *    press. Called out for the integrator to override if parity is
 *    actually wanted.
 *
 * 4. MULTI-DRAG: computed by the glue at drag-begin time (not by the pure
 *    machine, which only ever tracks a single primary tokenId): if the
 *    primary token is in bridge.sel AND bridge.sel contains >1 tokens I
 *    own, tokDragBegin is called with ALL of those ids.
 *
 * 5. GAIN CALIBRATION (per integrator update, WP3D-2 pinned units):
 *      orbitBy(dx,dy)  — RADIANS added directly to azimuth/polar.
 *      panBy(dx,dy)    — WORLD-INCHES along camera's ground-plane basis.
 *      zoomBy(f)       — multiplicative factor on orbit radius.
 *    The gesture machine stays unit-agnostic: 'orbit'/'pan' actions carry
 *    raw NDC deltas, and 'zoom' actions carry an already-computed
 *    dimensionless ratio (wheel: integrator's exact formula; pinch: ratio
 *    of finger distances). The GLUE (createInteraction) converts NDC
 *    deltas -> px -> radians/inches using canvas size + rig.camera
 *    fov/distance, per WP3D4_GAINS below.
 */

import * as THREE from '../vendor/three.module.min.js';

/* ---------------------------------------------------------------------- *
 * Tunables — integration/feel knobs, safe to retune without touching the
 * state machine logic.
 * ---------------------------------------------------------------------- */
export const WP3D4_GAINS = {
  slopPx: 4,               // px of pointer travel before a press resolves to drag/orbit/pan (vs. click)
  orbitRadPerPx: 0.006,    // rad added to azimuth/polar per px dragged (integrator target ~0.005-0.008)
  panInchGain: 1,          // multiplier on the camera-distance-derived inches-per-px pan conversion
  zoomWheelBase: 0.95,     // wheel: f = zoomWheelBase ^ (-deltaY / zoomWheelDivisor)
  zoomWheelDivisor: 53,
  pinchZoomGain: 1,        // exponent on the raw (prevDist/currDist) finger-distance ratio
  twoFingerGraceMs: 300,   // 1-finger token-drag younger than this cancels (snap-back) on a 2nd finger; older commits in place
};

/* ---------------------------------------------------------------------- *
 * rayToBoardInches(ray) — pure: THREE.Ray (or ray-shaped {origin,direction})
 * intersected with the y=0 board plane, in inches. Returns [ix, iz] | null.
 * ---------------------------------------------------------------------- */
export function rayToBoardInches(ray) {
  if (!ray || !ray.origin || !ray.direction) return null;
  const oy = ray.origin.y, dy = ray.direction.y;
  if (Math.abs(dy) < 1e-9) return null;       // parallel to the plane — no (unique) intersection
  const t = -oy / dy;
  if (t < 0) return null;                     // plane is behind the ray's forward direction
  const ix = ray.origin.x + ray.direction.x * t;
  const iz = ray.origin.z + ray.direction.z * t;
  return [ix, iz];
}

/* ---------------------------------------------------------------------- *
 * createGestureMachine(opts) — pure state machine over normalized pointer
 * events. No DOM, no THREE, no bridge access: consumed by createInteraction
 * below and independently by the test suite.
 *
 * opts.slopNdc     — NDC-space slop threshold (glue computes this from
 *                     WP3D4_GAINS.slopPx + canvas size; defaults to a
 *                     conservative guess if omitted, e.g. for ad hoc tests).
 * opts.graceMs      — two-finger cancel grace window (defaults to
 *                     WP3D4_GAINS.twoFingerGraceMs).
 *
 * Input events: {type:'down'|'move'|'up'|'cancel'|'wheel', id, nx, ny,
 *   buttons, shiftKey, isTouch, deltaY?, t?}
 *   `t` (ms timestamp) is an optional extension beyond the contract's
 *   documented shape, defaulting to Date.now() — needed so tests can drive
 *   the 300ms two-finger grace window deterministically.
 *
 * machine.handle(evt) -> Action[]   (see kinds below)
 * machine.resolvePick(tokenId, ownedByMe) -> Action[]  (answers the most
 *   recent pending 'pick-check'; call synchronously right after receiving
 *   one, before feeding any further events)
 *
 * Action kinds emitted:
 *   {kind:'pick-check', nx, ny, pointerId}
 *   {kind:'click-select', tokenId, shift}
 *   {kind:'drag-begin', tokenId, nx, ny}       (nx,ny = DOWN position)
 *   {kind:'drag-move', nx, ny}                 (nx,ny = CURRENT position)
 *   {kind:'drag-commit', tokenId}
 *   {kind:'drag-cancel'}
 *   {kind:'orbit', dx, dy}   — NDC delta since last move
 *   {kind:'pan', dx, dy}     — NDC delta since last move
 *   {kind:'zoom', factor}    — dimensionless multiplicative ratio
 *   {kind:'none'}
 * ---------------------------------------------------------------------- */
export function createGestureMachine(opts = {}) {
  const slopNdc = opts.slopNdc != null ? opts.slopNdc : 0.02;
  const graceMs = opts.graceMs != null ? opts.graceMs : WP3D4_GAINS.twoFingerGraceMs;

  const pointers = new Map();  // id -> {nx, ny}
  let mode = 'idle';           // idle | pending | armed | token-drag | orbit | pan | camera2
  let pending = null;          // {pointerId, downNx, downNy, downTime, shiftKey}
  let armed = null;            // {pointerId, downNx, downNy, downTime, shiftKey, tokenId, kind}
  let drag = null;             // {pointerId, tokenId, beginTime}
  let cam = null;              // {pointerId, lastNx, lastNy}
  let twoFinger = null;        // {ids:[a,b], lastDist, lastCentroid:{nx,ny}}

  const now = evt => (evt && evt.t != null) ? evt.t : Date.now();

  function collapseToCamera2(t) {
    const actions = [];
    if (mode === 'token-drag' && drag) {
      const elapsed = t - drag.beginTime;
      if (elapsed < graceMs) actions.push({ kind: 'drag-cancel' });
      else actions.push({ kind: 'drag-commit', tokenId: drag.tokenId });
      drag = null;
    }
    pending = null; armed = null; cam = null;
    const ids = [...pointers.keys()].slice(0, 2);
    if (ids.length === 2) {
      const p0 = pointers.get(ids[0]), p1 = pointers.get(ids[1]);
      twoFinger = {
        ids,
        lastDist: Math.hypot(p1.nx - p0.nx, p1.ny - p0.ny),
        lastCentroid: { nx: (p0.nx + p1.nx) / 2, ny: (p0.ny + p1.ny) / 2 },
      };
    } else {
      twoFinger = null;
    }
    mode = 'camera2';
    return actions;
  }

  function onDown(evt) {
    pointers.set(evt.id, { nx: evt.nx, ny: evt.ny });
    const n = pointers.size;
    if (n === 1) {
      const buttons = evt.buttons || 0;
      const isRight = !evt.isTouch && (buttons & 2) !== 0;
      const isMiddle = !evt.isTouch && (buttons & 4) !== 0;
      if (isRight || isMiddle) {
        armed = { pointerId: evt.id, downNx: evt.nx, downNy: evt.ny, downTime: now(evt), shiftKey: false, tokenId: null, kind: 'pan' };
        mode = 'armed';
        return [];
      }
      pending = { pointerId: evt.id, downNx: evt.nx, downNy: evt.ny, downTime: now(evt), shiftKey: !!evt.shiftKey };
      mode = 'pending';
      return [{ kind: 'pick-check', nx: evt.nx, ny: evt.ny, pointerId: evt.id }];
    }
    if (n === 2) return collapseToCamera2(now(evt));
    // 3rd+ pointer: ignore for gesture purposes, but make sure we're in camera2.
    if (mode !== 'camera2') return collapseToCamera2(now(evt));
    return [];
  }

  function onMove(evt) {
    if (!pointers.has(evt.id)) return [];
    const p = pointers.get(evt.id);
    p.nx = evt.nx; p.ny = evt.ny;

    if (mode === 'camera2') {
      if (!twoFinger || twoFinger.ids.indexOf(evt.id) === -1) return [];
      const p0 = pointers.get(twoFinger.ids[0]), p1 = pointers.get(twoFinger.ids[1]);
      const dist = Math.hypot(p1.nx - p0.nx, p1.ny - p0.ny);
      const centroid = { nx: (p0.nx + p1.nx) / 2, ny: (p0.ny + p1.ny) / 2 };
      const ratio = dist > 1e-9 ? (twoFinger.lastDist / dist) : 1; // spread apart (dist grows) -> ratio<1 -> zoom in
      const factor = Math.pow(ratio, WP3D4_GAINS.pinchZoomGain);
      const dx = centroid.nx - twoFinger.lastCentroid.nx;
      const dy = centroid.ny - twoFinger.lastCentroid.ny;
      twoFinger.lastDist = dist; twoFinger.lastCentroid = centroid;
      return [{ kind: 'zoom', factor }, { kind: 'pan', dx, dy }];
    }

    if (mode === 'pending') return []; // resolvePick answers synchronously before any move arrives — nothing to do

    if (mode === 'armed') {
      if (evt.id !== armed.pointerId) return [];
      const dist = Math.hypot(evt.nx - armed.downNx, evt.ny - armed.downNy);
      if (dist < slopNdc) return [];
      const a = armed; armed = null;
      if (a.kind === 'own') {
        mode = 'token-drag';
        drag = { pointerId: a.pointerId, tokenId: a.tokenId, beginTime: now(evt) };
        return [
          { kind: 'click-select', tokenId: a.tokenId, shift: a.shiftKey },
          { kind: 'drag-begin', tokenId: a.tokenId, nx: a.downNx, ny: a.downNy },
          { kind: 'drag-move', nx: evt.nx, ny: evt.ny },
        ];
      }
      // enemy | empty | pan — all become camera control past slop
      mode = (a.kind === 'pan') ? 'pan' : 'orbit';
      cam = { pointerId: a.pointerId, lastNx: a.downNx, lastNy: a.downNy };
      const dx = evt.nx - cam.lastNx, dy = evt.ny - cam.lastNy;
      cam.lastNx = evt.nx; cam.lastNy = evt.ny;
      return [{ kind: mode, dx, dy }];
    }

    if (mode === 'token-drag') {
      if (evt.id !== drag.pointerId) return [];
      return [{ kind: 'drag-move', nx: evt.nx, ny: evt.ny }];
    }

    if (mode === 'orbit' || mode === 'pan') {
      if (!cam || evt.id !== cam.pointerId) return [];
      const dx = evt.nx - cam.lastNx, dy = evt.ny - cam.lastNy;
      cam.lastNx = evt.nx; cam.lastNy = evt.ny;
      return [{ kind: mode, dx, dy }];
    }

    return [];
  }

  function dropTwoFingerPointer(id) {
    const remaining = twoFinger.ids.filter(x => x !== id);
    twoFinger = null;
    if (remaining.length === 1 && pointers.has(remaining[0])) {
      const rp = pointers.get(remaining[0]);
      mode = 'orbit';
      cam = { pointerId: remaining[0], lastNx: rp.nx, lastNy: rp.ny };
    } else {
      mode = pointers.size ? 'camera2' : 'idle';
    }
  }

  function onUp(evt) {
    pointers.delete(evt.id);

    if (mode === 'pending' && pending && evt.id === pending.pointerId) {
      pending = null; mode = 'idle';
      return [{ kind: 'none' }];
    }
    if (mode === 'armed' && armed && evt.id === armed.pointerId) {
      const a = armed; armed = null; mode = 'idle';
      if (a.kind === 'own' || a.kind === 'enemy') return [{ kind: 'click-select', tokenId: a.tokenId, shift: a.shiftKey }];
      return [{ kind: 'none' }];
    }
    if (mode === 'token-drag' && drag && evt.id === drag.pointerId) {
      const tokenId = drag.tokenId; drag = null; mode = 'idle';
      return [{ kind: 'drag-commit', tokenId }];
    }
    if ((mode === 'orbit' || mode === 'pan') && cam && evt.id === cam.pointerId) {
      cam = null; mode = 'idle';
      return [{ kind: 'none' }];
    }
    if (mode === 'camera2' && twoFinger && twoFinger.ids.indexOf(evt.id) !== -1) {
      dropTwoFingerPointer(evt.id);
      return [{ kind: 'none' }];
    }
    return [{ kind: 'none' }];
  }

  function onCancel(evt) {
    pointers.delete(evt.id);

    if (mode === 'token-drag' && drag && evt.id === drag.pointerId) {
      drag = null; mode = 'idle';
      return [{ kind: 'drag-cancel' }];
    }
    if (mode === 'pending' && pending && evt.id === pending.pointerId) { pending = null; mode = 'idle'; return []; }
    if (mode === 'armed' && armed && evt.id === armed.pointerId) { armed = null; mode = 'idle'; return []; }
    if ((mode === 'orbit' || mode === 'pan') && cam && evt.id === cam.pointerId) { cam = null; mode = 'idle'; return []; }
    if (mode === 'camera2' && twoFinger && twoFinger.ids.indexOf(evt.id) !== -1) {
      dropTwoFingerPointer(evt.id);
      return [];
    }
    return [];
  }

  function onWheel(evt) {
    const deltaY = evt.deltaY || 0;
    const factor = Math.pow(WP3D4_GAINS.zoomWheelBase, -deltaY / WP3D4_GAINS.zoomWheelDivisor);
    return [{ kind: 'zoom', factor }];
  }

  return {
    handle(evt) {
      switch (evt.type) {
        case 'down': return onDown(evt);
        case 'move': return onMove(evt);
        case 'up': return onUp(evt);
        case 'cancel': return onCancel(evt);
        case 'wheel': return onWheel(evt);
        default: return [];
      }
    },
    resolvePick(tokenId, ownedByMe) {
      if (!pending) return [];
      const p = pending; pending = null;
      let kind;
      if (tokenId != null && ownedByMe) kind = 'own';
      else if (tokenId != null && !ownedByMe) kind = 'enemy';
      else kind = p.shiftKey ? 'pan' : 'empty';
      armed = {
        pointerId: p.pointerId, downNx: p.downNx, downNy: p.downNy, downTime: p.downTime,
        shiftKey: p.shiftKey, tokenId: (kind === 'own' || kind === 'enemy') ? tokenId : null, kind,
      };
      mode = 'armed';
      return [];
    },
    // debug/test introspection only — not part of the frozen contract
    _debugMode() { return mode; },
  };
}

/* ---------------------------------------------------------------------- *
 * createInteraction(canvas, bridge, rig, sceneSync) -> {dispose()}
 * The DOM glue: owns all pointer/wheel listeners, feeds normalized events
 * into createGestureMachine(), answers pick-checks, and routes resolved
 * actions to bridge/rig calls.
 * ---------------------------------------------------------------------- */
export function createInteraction(canvas, bridge, rig, sceneSync) {
  const slopNdc = () => {
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    return WP3D4_GAINS.slopPx / (Math.min(w, h) / 2);
  };
  const machine = createGestureMachine({ slopNdc: slopNdc(), graceMs: WP3D4_GAINS.twoFingerGraceMs });

  let activeDrag = null; // {tokenIds, startIx, startIy}

  function isMine(id) {
    const st = bridge.state();
    const tok = st && st.tokens && st.tokens.find(t => t.id === id);
    return !!tok && tok.owner === bridge.mySide();
  }

  function applySelect(tokenId, shift) {
    const sel = bridge.sel;
    if (!sel) return;
    if (sel.has(tokenId)) {
      if (shift) sel.delete(tokenId);
      // !shift: leave selection as-is (enables multi-drag on a plain click within an existing multi-select)
    } else {
      if (!shift) sel.clear();
      sel.add(tokenId);
    }
  }

  function computeInchesPerPx() {
    const cam = rig.camera;
    const st = bridge.state();
    const board = (st && st.board) || { w: 60, h: 44 };
    const target = new THREE.Vector3(board.w / 2, 0, board.h / 2);
    const dist = (cam && cam.position) ? cam.position.distanceTo(target) : 40;
    const fovDeg = (cam && cam.fov) || 50;
    const fovRad = fovDeg * Math.PI / 180;
    const h = canvas.clientHeight || 600;
    return 2 * dist * Math.tan(fovRad / 2) / h;
  }

  function beginDrag(a) {
    const sel = bridge.sel;
    let ids = [a.tokenId];
    if (sel && sel.has(a.tokenId)) {
      const mine = [...sel].filter(isMine);
      if (mine.length > 1) ids = mine;
    }
    const pos = rig.screenToBoard(a.nx, a.ny) || [0, 0];
    activeDrag = { tokenIds: ids, startIx: pos[0], startIy: pos[1] };
    bridge.tokDragBegin(ids, pos[0], pos[1]);
  }

  function moveDrag(a) {
    if (!activeDrag) return;
    const pos = rig.screenToBoard(a.nx, a.ny);
    if (!pos) return;
    bridge.tokDragMove(pos[0], pos[1]);
  }

  function commitDrag() {
    if (!activeDrag) return;
    bridge.tokDragCommit();
    activeDrag = null;
  }

  function cancelDrag() {
    if (!activeDrag) return;
    bridge.tokDragMove(activeDrag.startIx, activeDrag.startIy);
    bridge.tokDragCommit();
    activeDrag = null;
  }

  function handlePickCheck(a) {
    let tokenId = null;
    if (rig.raycastFromScreen && sceneSync.pickMeshes) {
      const raycaster = rig.raycastFromScreen(a.nx, a.ny);
      const meshes = sceneSync.pickMeshes();
      const hits = raycaster.intersectObjects(meshes, true);
      for (const h of hits) {
        const id = sceneSync.tokenAt(h);
        if (id != null) { tokenId = id; break; }
      }
    }
    const ownedByMe = tokenId != null && isMine(tokenId);
    processActions(machine.resolvePick(tokenId, ownedByMe));
  }

  function processActions(actions) {
    for (const a of actions) {
      switch (a.kind) {
        case 'pick-check': handlePickCheck(a); break;
        case 'click-select': applySelect(a.tokenId, a.shift); break;
        case 'drag-begin': beginDrag(a); break;
        case 'drag-move': moveDrag(a); break;
        case 'drag-commit': commitDrag(); break;
        case 'drag-cancel': cancelDrag(); break;
        case 'orbit': {
          const pxDx = a.dx * (canvas.clientWidth || 800) / 2;
          const pxDy = a.dy * (canvas.clientHeight || 600) / 2;
          rig.orbitBy(pxDx * WP3D4_GAINS.orbitRadPerPx, -pxDy * WP3D4_GAINS.orbitRadPerPx);
          break;
        }
        case 'pan': {
          const ipp = computeInchesPerPx();
          const pxDx = a.dx * (canvas.clientWidth || 800) / 2;
          const pxDy = a.dy * (canvas.clientHeight || 600) / 2;
          rig.panBy(-pxDx * ipp * WP3D4_GAINS.panInchGain, pxDy * ipp * WP3D4_GAINS.panInchGain);
          break;
        }
        case 'zoom': rig.zoomBy(a.factor); break;
        case 'none': default: break;
      }
    }
  }

  function normalize(e, type) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const nx = rect.width ? (px / rect.width) * 2 - 1 : 0;
    const ny = rect.height ? -((py / rect.height) * 2 - 1) : 0;
    return {
      type, id: e.pointerId, nx, ny,
      buttons: e.buttons || 0, shiftKey: !!e.shiftKey,
      isTouch: e.pointerType === 'touch',
      t: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    };
  }

  const onPointerDown = e => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not all pointer types support capture */ }
    processActions(machine.handle(normalize(e, 'down')));
  };
  const onPointerMove = e => processActions(machine.handle(normalize(e, 'move')));
  const onPointerUp = e => {
    processActions(machine.handle(normalize(e, 'up')));
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
  };
  const onPointerCancel = e => processActions(machine.handle(normalize(e, 'cancel')));
  const onWheel = e => {
    e.preventDefault();
    processActions(machine.handle({ type: 'wheel', id: -1, nx: 0, ny: 0, deltaY: e.deltaY, buttons: 0, shiftKey: false, isTouch: false }));
  };
  const onContextMenu = e => e.preventDefault(); // RMB drives pan, not the browser menu

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
