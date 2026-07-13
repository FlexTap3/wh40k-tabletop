/* ==== WP3D-11: mode manager ==== 2D-first tri-state (off/pip/full). Owns PiP canvas-rect
 * sizing (the boardwrap ResizeObserver does NOT fire on the CSS inset change — this module
 * drives the resize path from the canvas rect on every mode change), tier pixel-ratio
 * recompute, PiP camera auto-frame with the shared user-input yield rule.
 *
 * ---------------------------------------------------------------------------------------
 * Design notes (documented per the contract's "document your choice"):
 *
 * 1. PiP RESIZE BLOCKER FIX. The boardwrap's ResizeObserver watches the WRAP element, not
 *    #board3d itself — a CSS class flip that only changes #board3d's own size (position:
 *    absolute inset, per the frozen CSS) never fires it. setMode() is the actual hook: by
 *    the time the orchestrator's exported setMode() reaches this module, wh40k-tabletop.
 *    html's wp3dSetMode() has ALREADY toggled the boardwrap class (see its source — the
 *    class toggle happens before `wp3dModule.setMode(mode)`), so a synchronous
 *    canvas.getBoundingClientRect() read here already reflects the new layout (className
 *    changes apply synchronously; getBoundingClientRect forces layout). Every setMode()
 *    call re-reads the rect and drives deps.sizeTo(w,h) — the same path the ResizeObserver
 *    would have driven — so the renderer buffer + camera aspect stay in sync with the CSS.
 *
 *    A second, subtler race only visible on the FIRST-EVER 3D activation (found via the
 *    behavioral pip-smoke test, not guessed): the orchestrator's build() wires up
 *    `observeResize(wrap, sizeTo)` AND fires one immediate `sizeTo(wrap.clientWidth,
 *    wrap.clientHeight)` — using the WRAP's size, not the canvas's — and it does this
 *    BEFORE wp3dSetMode() has applied the mode3d-pip class (build() runs synchronously
 *    inside `wp3dModule.init()`, which the HTML calls before its own class-toggle line).
 *    ResizeObserver's OWN initial observation for that wrap is delivered asynchronously
 *    (per the HTML "update the rendering" steps, resize-observer notifications run in the
 *    same rendering opportunity as, but after, that frame's requestAnimationFrame
 *    callbacks) — so it lands sometime after this module's synchronous setMode() call has
 *    already run, and re-applies the WRAP's full size right over the correct PiP size this
 *    module just set. Not something this packet can fix at the source (build()'s own
 *    resize wiring is outside the one marked wiring region this packet owns) — worked
 *    around here instead: setMode() also schedules a DOUBLE requestAnimationFrame
 *    (one frame is the same rendering opportunity the stray ResizeObserver delivery can
 *    still land in; two frames guarantees this module's re-apply is the LAST word) that
 *    re-reads the canvas rect and re-applies sizeTo/pixel-ratio once more. A no-op in node
 *    tests (no rAF global) and a harmless redundant re-apply in the steady state where the
 *    race never fires.
 *
 * 2. PIXEL-RATIO POLICY (pixelRatioFor, pure/exported). full → the device's DPR clamped to
 *    the perf tier's normal cap (unchanged from WP3D-2's own renderer default). pip → the
 *    inset is tiny (340×220 CSS px), so it can afford up to DPR 2 even on a phone-tier
 *    device (tier.pixelRatioCap 1.5) without the fill-rate cost a full-size canvas at DPR 2
 *    would carry — sharper glyphs/edges in the corner inset for ~free. off → tier cap
 *    (harmless; canvas is hidden either way).
 *
 * 3. INTERACTION LAYER px→NDC CHECK (contract item). Read wp3d-4-interaction.js: both
 *    createInteraction's `normalize()` (pointer/wheel handling) and `computeInchesPerPx()`
 *    (pan gain) call canvas.getBoundingClientRect()/canvas.clientHeight FRESH on every
 *    event — nothing is cached at creation. So px→NDC and the pan gain both already track
 *    the live canvas rect through a PiP resize with zero changes needed; wp3d-4 is
 *    untouched by this packet.
 *
 * 4. PiP DRAG-BLOCK MECHANISM. The goal: in PiP, the 3D inset must stop being a token-drag
 *    surface (2D stays the one true play surface) while camera orbit/pan/zoom on empty
 *    space still works. wp3d-4's own pointerdown listener is registered on #board3d at
 *    BUBBLE phase (`canvas.addEventListener('pointerdown', fn)`, no capture flag) by the
 *    time this module is created (the orchestrator builds interaction before modes). A
 *    same-target capture-phase listener does NOT reliably run before an already-registered
 *    same-target bubble listener — per the DOM dispatch algorithm, listeners on the EVENT
 *    TARGET ITSELF all fire during the "at target" step in REGISTRATION ORDER, regardless
 *    of their capture flag; the capture/bubble distinction only orders listeners on
 *    ANCESTORS relative to the target. So this module registers its interception listener
 *    on `window` (an ancestor of the canvas in the event path) with capture:true — that
 *    guarantees it runs during the capturing phase, strictly before ANY listener on the
 *    canvas itself, independent of registration order. (In non-browser test environments
 *    with no `window` global, it falls back to listening directly on the canvas — weaker
 *    ordering guarantee, but there's no competing listener to race in a unit test.)
 *    The handler: only active in PiP mode; on pointerdown targeting the canvas, it
 *    raycasts via deps.rig.raycastFromScreen + deps.sceneSync.pickMeshes/tokenAt (the
 *    exact pick path wp3d-4 itself uses) to see whether the press would hit ANY token
 *    (own or enemy — the point is "no drags/selection off the 3D inset", not just "no
 *    drags of my own tokens"). If it hits a token, `stopImmediatePropagation()` (+
 *    preventDefault) kills the event before it ever reaches wp3d-4's gesture machine — no
 *    pick-check, no click-select, no drag-begin. If it hits empty space, the event is left
 *    alone and flows through to wp3d-4 exactly as normal, so orbit/pan/zoom keep working.
 *    The pure decision (`shouldBlockPipPointerdown`) is factored out for direct testing.
 *
 * 5. PiP AUTO-FRAME. Runs every tick() while mode==='pip' AND userQuietFor() > the shared
 *    5000ms yield gate (shouldAutoFrame, pure/exported — also the seam P3's battle-cam
 *    consumes via modes.userQuietFor()). Target priority (pickFocusTargets, pure/exported):
 *    selected tokens (deps.bridge.sel, live Set) > the last 'remotemove' motion event
 *    (deps.motion.on is optional — P3's file may still be a stub without it, guarded) >
 *    the whole board (rig.lookAtBoard(), which resets the rig's own target/pose — no manual
 *    easing needed since the rig already eases toward it every frame). For a concrete
 *    point (selection/remotemove), there is no "set absolute camera target" API — rig only
 *    exposes RELATIVE panBy(dx,dy)/zoomBy(f) — so this recomputes the remaining distance to
 *    the destination from the CURRENT (already-eased) target every tick and applies a
 *    shrinking per-tick fraction via the same exponential-ease shape the rig uses
 *    internally (k = 1 - exp(-λ·dt)), exactly the idiom wp3d-10-motion.js's dblclick focus
 *    uses — reimplemented locally here (that file is not touched). Zoom follows the same
 *    per-tick partial-step idea in log-space (radius ratio ** k) toward a "sensible" radius
 *    derived from the framed points' spread (desiredRadiusForSpread, pure/exported): a
 *    close-up default for a single token, a bounding-diagonal-based distance for a group.
 *    Recomputing fresh from live state every qualifying tick (rather than a one-shot
 *    "animation object" with a fixed start/end) means a moving remote-move target or a
 *    growing/shrinking selection is tracked continuously, and control silently reverts to
 *    the user the instant they touch the canvas again (userQuietFor() resets to 0).
 *
 * 6. LABELS. PiP already hides #wp3dLabels via CSS (`display:none !important`) and the
 *    orchestrator ticks labels unconditionally outside this module's control — nothing
 *    else to do here; per the contract, over-engineering a separate skip path isn't
 *    warranted.
 * ------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------
 * Pure helpers — no THREE/DOM dependency, directly unit-testable.
 * ------------------------------------------------------------------------------------- */

export const PIP_DPR_CAP = 2;
export const PIP_AUTOFRAME_YIELD_MS = 5000;
export const PIP_FOCUS_LAMBDA = 9;   // matches the rig's own ~10/s internal damping feel
export const PIP_FOCUS_EPS_IN = 0.15; // stop panning once this close (board inches)
export const PIP_ZOOM_EPS = 0.03;     // stop zooming once |radius ratio - 1| is under this

/* pixelRatioFor(mode, tier, dpr) -> number. See design note 2. */
export function pixelRatioFor(mode, tier, dpr) {
  const d = dpr == null ? 1 : dpr;
  const tierCap = (tier && tier.pixelRatioCap != null) ? tier.pixelRatioCap : 2;
  const cap = mode === 'pip' ? Math.max(PIP_DPR_CAP, tierCap) : tierCap;
  return Math.min(d, cap);
}

/* shouldBlockPipPointerdown(mode, tokenId) -> bool. See design note 4. */
export function shouldBlockPipPointerdown(mode, tokenId) {
  return mode === 'pip' && tokenId != null;
}

/* shouldAutoFrame(mode, quietMs, yieldMs=PIP_AUTOFRAME_YIELD_MS) -> bool. The shared yield
 * rule this packet owns (contract: ALL auto-motion gated on userQuietFor() > 5000). */
export function shouldAutoFrame(mode, quietMs, yieldMs) {
  const y = yieldMs == null ? PIP_AUTOFRAME_YIELD_MS : yieldMs;
  return mode === 'pip' && quietMs > y;
}

/* centroidOf(points:[{x,y}]) -> {x,y} | null */
export function centroidOf(points) {
  if (!points || !points.length) return null;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / points.length, y: sy / points.length };
}

/* desiredRadiusForSpread(points:[{x,y}]) -> number (world inches). See design note 5. */
export function desiredRadiusForSpread(points) {
  if (!points || points.length <= 1) return 10;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  return Math.max(8, Math.min(40, diag * 1.6 + 6));
}

/* pickFocusTargets({sel, tokensById, lastRemoteMove}) -> {kind:'selection'|'remotemove'|'board', points}
 * Pure priority resolution: sel > remotemove > board. See design note 5. */
export function pickFocusTargets(opts) {
  const o = opts || {};
  const tokensById = o.tokensById || {};
  const sel = o.sel;
  if (sel && sel.size) {
    const pts = [...sel].map((id) => tokensById[id]).filter(Boolean);
    if (pts.length) return { kind: 'selection', points: pts };
  }
  const lrm = o.lastRemoteMove;
  if (lrm && lrm.tokenIds && lrm.tokenIds.length) {
    const pts = lrm.tokenIds.map((id) => tokensById[id]).filter(Boolean);
    if (pts.length) return { kind: 'remotemove', points: pts };
  }
  return { kind: 'board', points: null };
}

/* ---------------------------------------------------------------------------------------
 * createModes(deps) -> { setMode(m), getMode(), tick(dtMs, state), dispose(), userQuietFor() }
 * deps = { THREE, canvas, rendererCtl {renderer,setSize}, rig, labels, interaction,
 *          sceneSync, motion, bridge, tier, sizeTo(w,h), now()? }
 * `now` is an optional injectable clock (defaults to performance.now/Date.now) — purely a
 * testability seam; the orchestrator wiring never needs to supply it.
 * ------------------------------------------------------------------------------------- */
export function createModes(deps) {
  const { THREE, canvas, bridge } = deps;
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const curDpr = () => (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);

  let mode = 'full';
  let lastInputAt = now();
  let lastRemoteMove = null; // {tokenIds:[...]} — most recent motion 'remotemove' event
  let disposed = false;
  const _camDir = THREE ? new THREE.Vector3() : null;

  function markInput() { lastInputAt = now(); }

  // ---- (5) subscribe to motion's remote-move event, if the file exposes it (P3 owns it;
  // guard for a stub per the contract's "consumers must tolerate `on` missing" rule). ----
  if (deps.motion && typeof deps.motion.on === 'function') {
    deps.motion.on('remotemove', (payload) => {
      if (payload && Array.isArray(payload.tokenIds) && payload.tokenIds.length) {
        lastRemoteMove = { tokenIds: payload.tokenIds.slice() };
      }
    });
  }

  // ---- (1)+(2) PiP resize + pixel-ratio recompute, driven on every setMode(). ----
  function applyRectAndRatio() {
    let rect = null;
    try { rect = canvas.getBoundingClientRect(); } catch (e) { rect = null; }
    if (rect && rect.width > 0 && rect.height > 0 && typeof deps.sizeTo === 'function') {
      deps.sizeTo(rect.width, rect.height);
    }
    const ratio = pixelRatioFor(mode, deps.tier, curDpr());
    const renderer = deps.rendererCtl && deps.rendererCtl.renderer;
    if (renderer && typeof renderer.setPixelRatio === 'function') {
      try { renderer.setPixelRatio(ratio); } catch (e) {}
    }
  }

  // See design note 1: a stray belated ResizeObserver delivery (wired up outside this
  // packet's owned surface) can re-apply the WRAP's full size over a just-set PiP size.
  // A double-rAF re-apply guarantees this module's numbers are the last word, with zero
  // effect in node tests (no rAF global) or once the race has already settled.
  function scheduleReapply() {
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      if (disposed) return;
      requestAnimationFrame(() => {
        if (disposed) return;
        applyRectAndRatio();
      });
    });
  }

  function setMode(m) {
    mode = m;
    applyRectAndRatio();
    scheduleReapply();
  }

  function getMode() { return mode; }

  function userQuietFor() { return now() - lastInputAt; }

  // ---- (4) PiP drag-block: capture-phase listener on an ancestor of the canvas. ----
  const hasWindow = typeof window !== 'undefined' && window && typeof window.addEventListener === 'function';
  const captureTarget = hasWindow ? window : canvas;
  const targetsAncestor = captureTarget !== canvas;

  function pickTokenAt(nx, ny) {
    const rig = deps.rig, sceneSync = deps.sceneSync;
    if (!rig || typeof rig.raycastFromScreen !== 'function') return null;
    if (!sceneSync || typeof sceneSync.pickMeshes !== 'function' || typeof sceneSync.tokenAt !== 'function') return null;
    const raycaster = rig.raycastFromScreen(nx, ny);
    const meshes = sceneSync.pickMeshes();
    const hits = raycaster.intersectObjects(meshes, true);
    for (const h of hits) {
      const id = sceneSync.tokenAt(h);
      if (id != null) return id;
    }
    return null;
  }

  function onCapturePointerDown(e) {
    if (targetsAncestor && e.target !== canvas) return;
    markInput();
    if (mode !== 'pip') return;
    let rect = null;
    try { rect = canvas.getBoundingClientRect(); } catch (err) { return; }
    if (!rect || !rect.width || !rect.height) return;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const tokenId = pickTokenAt(nx, ny);
    if (shouldBlockPipPointerdown(mode, tokenId)) {
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      else if (typeof e.stopPropagation === 'function') e.stopPropagation();
      if (typeof e.preventDefault === 'function') e.preventDefault();
    }
  }
  captureTarget.addEventListener('pointerdown', onCapturePointerDown, true);

  // ---- userQuietFor input tracking: pointermove/wheel are never blocked, so plain
  // bubble-phase passive listeners on the canvas are enough for those. ----
  const onPointerMove = () => markInput();
  const onWheel = () => markInput();
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('wheel', onWheel, { passive: true });

  // ---- (5) PiP auto-frame ----
  function groundBasisFromCamera(camera) {
    camera.getWorldDirection(_camDir);
    const len = Math.hypot(_camDir.x, _camDir.z) || 1;
    const forward = { x: _camDir.x / len, z: _camDir.z / len };
    const right = { x: forward.z, z: -forward.x };
    return { forward, right };
  }

  function stepFocus(centroid, points, dtMs) {
    const rig = deps.rig;
    if (!rig || typeof rig.screenToBoard !== 'function') return;
    const cur = rig.screenToBoard(0, 0);
    if (!cur) return;
    const k = 1 - Math.exp(-PIP_FOCUS_LAMBDA * (Math.max(0, dtMs) / 1000));

    // pan toward the centroid
    const remX = centroid.x - cur[0], remZ = centroid.y - cur[1];
    if (Math.hypot(remX, remZ) >= PIP_FOCUS_EPS_IN
        && typeof rig.panBy === 'function' && rig.camera && typeof rig.camera.getWorldDirection === 'function') {
      const stepX = remX * k, stepZ = remZ * k;
      const basis = groundBasisFromCamera(rig.camera);
      const dx = stepX * basis.right.x + stepZ * basis.right.z;
      const dy = stepX * basis.forward.x + stepZ * basis.forward.z;
      rig.panBy(dx, dy);
    }

    // ease toward a sensible zoom radius for the framed spread
    if (typeof rig.zoomBy === 'function' && rig.camera && rig.camera.position) {
      const desired = desiredRadiusForSpread(points);
      const dxp = rig.camera.position.x - cur[0];
      const dzp = rig.camera.position.z - cur[1];
      const dyp = rig.camera.position.y;
      const curRadius = Math.sqrt(dxp * dxp + dyp * dyp + dzp * dzp);
      if (curRadius > 1e-6) {
        const ratio = desired / curRadius;
        if (Math.abs(ratio - 1) >= PIP_ZOOM_EPS) rig.zoomBy(Math.pow(ratio, k));
      }
    }
  }

  function tick(dtMs, state) {
    if (!shouldAutoFrame(mode, userQuietFor())) return;
    const tokensById = {};
    const tokens = (state && state.tokens) || [];
    for (const t of tokens) tokensById[t.id] = { x: t.x, y: t.y };
    const focus = pickFocusTargets({ sel: bridge && bridge.sel, tokensById, lastRemoteMove });
    if (focus.kind === 'board') {
      if (deps.rig && typeof deps.rig.lookAtBoard === 'function') deps.rig.lookAtBoard();
      return;
    }
    const centroid = centroidOf(focus.points);
    if (!centroid) return;
    stepFocus(centroid, focus.points, dtMs);
  }

  function dispose() {
    disposed = true;
    try { captureTarget.removeEventListener('pointerdown', onCapturePointerDown, true); } catch (e) {}
    try { canvas.removeEventListener('pointermove', onPointerMove); } catch (e) {}
    try { canvas.removeEventListener('wheel', onWheel); } catch (e) {}
  }

  return { setMode, getMode, tick, dispose, userQuietFor };
}
