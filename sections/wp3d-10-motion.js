/* ==== WP3D-10: motion & feel pack ==== TTS-style piece animation (remote moves lift-arc-
 * drop), drag lift, hover outline, camera focus, 3D tape ruler, physical dice tied to the
 * app's real rolls (bridge.onDice).
 *
 * ---------------------------------------------------------------------------------------
 * Design notes (documented per the contract's "document your choice"):
 *
 * 1. REMOTE-MOVE HEURISTIC (jump vs. drag). createMotion keeps a Map of tokenId ->
 *    {x,y,rot,streak}: the last position we SAW plus a "streak" counter of how many
 *    consecutive prior ticks that token was already in continuous motion. Every tick we
 *    diff the live state position against that last-known value:
 *      - dist === 0            -> token idle; streak resets to 0.
 *      - dist > 0, streak === 0, dist > JUMP_THRESHOLD_IN (0.5") -> classified REMOTE MOVE:
 *        the token was sitting still and then, between two ticks, teleported >0.5" in one
 *        step. That single-frame discontinuity is exactly what a committed op looks like
 *        on the wire (only the FINAL position ever lands in state; nothing streams the
 *        drag itself) — including the local peer's OWN drag lookback, since a local drag
 *        writes state.x/y (and calls draw()) on every pointermove, i.e. every frame is a
 *        small delta, never one big one.
 *      - dist > 0, streak > 0 (already moving last tick) -> classified DRAG CONTINUATION
 *        regardless of how big this particular frame's delta is (a fast mouse flick can
 *        legitimately cover >0.5" in one frame) — the deciding signal is "was this token
 *        already mid-motion", not the raw magnitude alone. sceneSync already re-syncs the
 *        instance transform on every dirty tick during a local drag, so drag continuation
 *        needs zero help from this module: we just update last-known and move on.
 *    This is the "consecutive-frame delta profile" the packet brief asks for: a lone big
 *    delta preceded by stillness triggers the tween; a run of deltas (regardless of size)
 *    never does. classifyMotionTick() is the pure, directly-testable core of this rule.
 *
 * 2. TWEEN SHAPE. tweenRemoteMove(start, end, elapsedMs) is a pure function: 0..450ms
 *    (MOTION_ARC_MS) eases x/y/rot from start->end via smoothstep, with a parabolic lift
 *    (peak LIFT_HEIGHT_IN at the midpoint, exactly 0 at both endpoints — "arc y>start
 *    mid-flight, endpoints exact" per the verification list). The next 60ms (SQUASH_MS)
 *    holds position at the endpoint and plays a squash/stretch bump (scaleY dips, scaleXZ
 *    bulges) that settles back to identity — the "tiny 60ms squash/settle" on landing.
 *    createMotion re-asserts this transform on the token's InstancedMesh slot every tick
 *    while the animation is active (found via sceneSync.pickMeshes() +
 *    mesh.userData.slotTokenId, per the orchestrator wiring notes) so it survives
 *    sceneSync's dirty-tick rewrites, since motion.tick() runs after sceneSync.tick().
 *    Concurrent animations are capped at MAX_CONCURRENT_ANIM (~40); beyond that a new jump
 *    is left unanimated (sceneSync's own raw-position write already snapped it there).
 *
 * 3. HOVER / DOUBLE-CLICK are pure observers: a passive, throttled (~30Hz) pointermove
 *    listener drives a single non-instanced ring mesh (reusing sceneSync's ring-at-token
 *    visual language: a flat RingGeometry scaled to the token's footprint half-extents),
 *    and a dblclick listener starts a camera "focus" pan. Neither ever calls
 *    preventDefault/stopPropagation — the interaction layer (WP3D-4) owns gesture
 *    handling; this module only reads pointer position and raycasts.
 *
 * 4. FOCUS PAN. The camera rig (WP3D-2) exposes only a RELATIVE panBy(dx,dy) — there is no
 *    "set target" API — so a smooth pan to an absolute point has to be driven as repeated
 *    panBy() calls, one per tick, each covering a shrinking fraction of the remaining
 *    distance (same exponential-ease shape the rig itself uses internally for its own
 *    orbit/zoom damping). rig.screenToBoard(0,0) doubles as a "read the current camera
 *    target" query (NDC (0,0) is dead-center, which is exactly where camera.lookAt(target)
 *    points), so each tick recomputes the remaining world-space delta to the destination,
 *    projects it onto the camera's current ground-plane forward/right basis (derived from
 *    camera.getWorldDirection() — camera.position/lookAt already guarantee the target sits
 *    on y=0, so this reconstructs the same basis createInteraction's pan gain math uses),
 *    and calls panBy() with that tick's eased share. Stops once the remaining distance is
 *    under 0.1", per the packet brief.
 *
 * 5. DICE. bridge.onDice(cb) fires cb(r) once per real d6 (r = the rolled face value,
 *    1-6 — see wh40k-tabletop.html's d6()/wp20Note wiring). createDiceBatcher() coalesces
 *    a burst into one throw by resetting a 120ms window on every new roll (an attack burst
 *    of 10-30 d6 calls typically lands within a handful of ms of each other, so the window
 *    closes shortly after the burst ends). Overflow beyond DICE_CAP (12) physical dice is
 *    handled by selectDiceSubset(), a literal prefix of the real rolled values — never an
 *    invented one, satisfying "the 12 shown must be a subset of ACTUAL rolled values".
 *    Geometry: one shared BufferGeometry (built once, reused via .geometry on every THREE
 *    .Mesh instance — "dice share one geometry+material set") built from THREE crossing
 *    boxes (full-length along one axis each, inset on the other two) whose union chamfers
 *    the cube's corners — a cheap fake-rounded-box silhouette with zero runtime cost, which
 *    matters because the shared pool material used throughout this app (and this module)
 *    is UNLIT vertex-color Basic — an actual smooth-normal rounded box would look
 *    IDENTICAL to a sharp-cornered one under flat/unlit shading, so the visual payoff is
 *    entirely in silhouette, not shading, and the chamfer delivers that for free. Pips are
 *    small dark boxes glued onto each face per the standard 5-dot layouts. Which local face
 *    shows which value is a fixed table (DIE_FACE_NORMALS) baked into both the geometry and
 *    quaternionForFaceUp() — a pure, exported function (the packet's "testable core") that
 *    returns the quaternion rotating a die so DIE_FACE_NORMALS[value] points to world +Y,
 *    with an optional extra spin around that same +Y axis for visual variety (a rotation
 *    about the up axis leaves "which face is up" invariant, so it never desyncs value from
 *    orientation). Throw choreography (spawn near the camera's current lower-right screen
 *    area via rig.screenToBoard, arc down into a spiral cluster near the current camera
 *    target, tumble via a fixed per-die random axis/speed for the first 75% of the 700ms
 *    flight, then slerp into the exact landing quaternion for the last 25%) is fake physics
 *    per the brief — no collision/overlap solving against tokens or terrain.
 * ------------------------------------------------------------------------------------- */
import { mergeGeometries } from './wp3d-1-geometry.js';

/* ---------------------------------------------------------------------------------------
 * Small pure math helpers (no THREE dependency).
 * ------------------------------------------------------------------------------------- */
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { const c = clamp01(t); return c * c * (3 - 2 * c); }
function lerpAngleDeg(a, b, t) {
  const diff = (((b - a + 540) % 360) + 360) % 360 - 180; // shortest signed delta in (-180,180]
  return a + diff * t;
}

/* ---------------------------------------------------------------------------------------
 * 1. Remote-move tween — pure core.
 * ------------------------------------------------------------------------------------- */
export const JUMP_THRESHOLD_IN = 0.5;
export const MOTION_ARC_MS = 450;
export const SQUASH_MS = 60;
export const LIFT_HEIGHT_IN = 1.2;
export const SQUASH_AMOUNT = 0.14;
export const MAX_CONCURRENT_ANIM = 40;

/* classifyMotionTick(prevStreak, dist) -> {isRemoteJump, nextStreak}
 * See design note 1 above. dist is the inches moved THIS tick vs. last-known. */
export function classifyMotionTick(prevStreak, dist) {
  if (dist <= 1e-9) return { isRemoteJump: false, nextStreak: 0 };
  if (prevStreak === 0 && dist > JUMP_THRESHOLD_IN) return { isRemoteJump: true, nextStreak: 0 };
  return { isRemoteJump: false, nextStreak: Math.min(prevStreak + 1, 999) };
}

/* tweenRemoteMove(start, end, elapsedMs) -> {x, y, rot, lift, scaleY, scaleXZ, done}
 * start/end = {x, y, rot} in board-state space (x/y inches, rot degrees). Pure — no THREE,
 * no side effects; the caller composes the actual world-space matrix. */
export function tweenRemoteMove(start, end, elapsedMs) {
  const rawT = clamp01(elapsedMs / MOTION_ARC_MS);
  const s = smoothstep(rawT);
  const x = lerp(start.x, end.x, s);
  const y = lerp(start.y, end.y, s);
  const rot = lerpAngleDeg(start.rot || 0, end.rot || 0, s);
  const lift = 4 * LIFT_HEIGHT_IN * s * (1 - s); // parabola: 0 at s=0/1, peak at s=0.5
  let scaleY = 1, scaleXZ = 1;
  if (elapsedMs >= MOTION_ARC_MS) {
    const st = clamp01((elapsedMs - MOTION_ARC_MS) / SQUASH_MS);
    const bump = Math.sin(Math.PI * st); // 0 -> 1 -> 0 over the squash window
    scaleY = 1 - bump * SQUASH_AMOUNT;
    scaleXZ = 1 + bump * SQUASH_AMOUNT * 0.6;
  }
  const done = elapsedMs >= MOTION_ARC_MS + SQUASH_MS;
  return { x, y, rot, lift, scaleY, scaleXZ, done };
}

/* ---------------------------------------------------------------------------------------
 * 2. Dice — pure batching/selection/orientation core.
 * ------------------------------------------------------------------------------------- */
export const DICE_CAP = 12;
export const DICE_BATCH_WINDOW_MS = 120;
export const DICE_THROW_MS = 700;
export const DICE_REST_MS = 2500;
export const DICE_FADE_MS = 300;
export const DIE_HALF = 0.32;
export const DIE_BEVEL = 0.07;
export const DIE_SPAWN_HEIGHT_IN = 9;

/* createDiceBatcher({windowMs}) -> {push(value,t), ready(t), flush(), peek()}
 * Pure w.r.t. time: the caller supplies `t` (real clock) so this is deterministically
 * testable with synthetic timestamps. Every push() resets the window (see design note 5). */
export function createDiceBatcher(opts) {
  const windowMs = (opts && opts.windowMs) || DICE_BATCH_WINDOW_MS;
  let pending = [];
  let lastAt = null;
  return {
    push(value, t) { pending.push(value); lastAt = t; },
    ready(t) { return pending.length > 0 && lastAt != null && (t - lastAt) >= windowMs; },
    flush() { const out = pending; pending = []; lastAt = null; return out; },
    peek() { return pending.slice(); },
  };
}

/* selectDiceSubset(rolls, cap) -> rolls.slice(0,cap) when over cap — a literal PREFIX of
 * the real rolled values, i.e. always an honest subset (never an invented value). */
export function selectDiceSubset(rolls, cap) {
  const n = cap || DICE_CAP;
  return rolls.length <= n ? rolls.slice() : rolls.slice(0, n);
}

/* Local die-space face table: which local axis-normal shows which pip value. Arbitrary but
 * internally consistent (this is a game-visual approximation, not a real-die chirality
 * claim) — opposite faces still sum to 7 (1<->6, 2<->5, 3<->4), matching a real d6's feel. */
const DIE_FACES = [
  { value: 1, normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { value: 6, normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { value: 2, normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { value: 5, normal: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { value: 3, normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { value: 4, normal: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
];
export const DIE_FACE_NORMALS = DIE_FACES.reduce((m, f) => { m[f.value] = f.normal; return m; }, {});
const PIP_PATTERNS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
function axisIndex(v) { return v[0] !== 0 ? 0 : (v[1] !== 0 ? 1 : 2); }

/* quaternionForFaceUp(THREE, value, yawRad) -> THREE.Quaternion
 * The testable core of the dice showpiece: rotates DIE_FACE_NORMALS[value] to world +Y,
 * with an optional extra spin around that same +Y axis (invariant — never changes which
 * face ends up up) for visual variety between dice showing the same value. */
export function quaternionForFaceUp(THREE, value, yawRad) {
  const n = DIE_FACE_NORMALS[value];
  if (!n) throw new Error('quaternionForFaceUp: invalid die value ' + value);
  const from = new THREE.Vector3(n[0], n[1], n[2]);
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(from, up);
  if (yawRad) {
    const spin = new THREE.Quaternion().setFromAxisAngle(up, yawRad);
    q.premultiply(spin);
  }
  return q;
}

/* buildDieGeometry(THREE) -> merged BufferGeometry, vertex-colored (ivory body + dark
 * pips). Built once and shared by every physical die mesh (see design note 5). */
export function buildDieGeometry(THREE) {
  const H = DIE_HALF, C = DIE_HALF - DIE_BEVEL;
  const body = new THREE.Color('#e9e1cf');
  const pip = new THREE.Color('#2a251d');
  const PIP_THIN = 0.045, PIP_WIDE = 0.085, PIP_SPACING = 0.16;
  const parts = [];
  // 3 crossing full-length/inset-cross-section boxes -> chamfered-cube silhouette.
  const crossings = [
    [2 * H, 2 * C, 2 * C],
    [2 * C, 2 * H, 2 * C],
    [2 * C, 2 * C, 2 * H],
  ];
  for (const [w, h, d] of crossings) parts.push({ geometry: new THREE.BoxGeometry(w, h, d), color: body });
  for (const face of DIE_FACES) {
    const ni = axisIndex(face.normal);
    for (const [pu, pv] of PIP_PATTERNS[face.value]) {
      const dims = [PIP_WIDE, PIP_WIDE, PIP_WIDE];
      dims[ni] = PIP_THIN;
      const g = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
      const cx = face.normal[0] * (H + PIP_THIN / 2) + face.u[0] * pu * PIP_SPACING + face.v[0] * pv * PIP_SPACING;
      const cy = face.normal[1] * (H + PIP_THIN / 2) + face.u[1] * pu * PIP_SPACING + face.v[1] * pv * PIP_SPACING;
      const cz = face.normal[2] * (H + PIP_THIN / 2) + face.u[2] * pu * PIP_SPACING + face.v[2] * pv * PIP_SPACING;
      g.translate(cx, cy, cz);
      parts.push({ geometry: g, color: pip });
    }
  }
  return mergeGeometries(parts);
}

/* ---------------------------------------------------------------------------------------
 * 3. createMotion(deps) -> { tick(dtMs, state), dispose() }
 * deps = { THREE, scene, rig, sceneSync, bridge, canvas, renderer }
 * ------------------------------------------------------------------------------------- */
export function createMotion(deps) {
  const { THREE, scene, rig, sceneSync, bridge, canvas } = deps;
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let disposed = false;

  // ---- scratch objects (perf rule: no per-frame allocation) ----
  const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _euler = new THREE.Euler();
  const _scl = new THREE.Vector3(1, 1, 1), _mat4 = new THREE.Matrix4();
  const _camDir = new THREE.Vector3();

  function footprintHalfExtentsFor(t) {
    if (t.shape === 'c') { const d = (t.dmm || 32) / 25.4; return { hx: d / 2, hz: d / 2 }; }
    return { hx: (t.wIn || 1) / 2, hz: (t.hIn || 1) / 2 };
  }
  function findTokenSlot(meshes, tokenId) {
    for (const mesh of meshes) {
      const ids = mesh.userData && mesh.userData.slotTokenId;
      if (!ids) continue;
      const slot = ids.indexOf(tokenId);
      if (slot !== -1) return { mesh, slot };
    }
    return null;
  }

  // =======================================================================================
  // 1. Remote-move tween
  // =======================================================================================
  const lastKnown = new Map();   // tokenId -> {x,y,rot,streak}
  const activeMoves = new Map(); // tokenId -> {start,end,elapsed}

  function applyAnimatedPose(t, pose, meshes) {
    const hit = findTokenSlot(meshes, t.id);
    if (!hit) return;
    const el = sceneSync.elevationFor ? sceneSync.elevationFor(t) : 0;
    _pos.set(pose.x, el + pose.lift, pose.y);
    _quat.setFromEuler(_euler.set(0, -(pose.rot || 0) * Math.PI / 180, 0));
    _scl.set(pose.scaleXZ, pose.scaleY, pose.scaleXZ);
    _mat4.compose(_pos, _quat, _scl);
    hit.mesh.setMatrixAt(hit.slot, _mat4);
    hit.mesh.instanceMatrix.needsUpdate = true;
    _scl.set(1, 1, 1);
  }

  function processRemoteMoves(dtMs, state) {
    const tokens = (state && state.tokens) || [];
    const seen = new Set();
    let meshes = null; // lazily fetched only if something is actually animating
    for (const t of tokens) {
      seen.add(t.id);
      const lk = lastKnown.get(t.id);
      if (!lk) {
        lastKnown.set(t.id, { x: t.x, y: t.y, rot: t.rot || 0, streak: 0 });
      } else {
        const dist = Math.hypot(t.x - lk.x, t.y - lk.y);
        const cls = classifyMotionTick(lk.streak, dist);
        if (cls.isRemoteJump && (activeMoves.has(t.id) || activeMoves.size < MAX_CONCURRENT_ANIM)) {
          activeMoves.set(t.id, {
            start: { x: lk.x, y: lk.y, rot: lk.rot },
            end: { x: t.x, y: t.y, rot: t.rot || 0 },
            elapsed: 0,
          });
        }
        lk.x = t.x; lk.y = t.y; lk.rot = t.rot || 0; lk.streak = cls.nextStreak;
      }
      const anim = activeMoves.get(t.id);
      if (anim) {
        anim.elapsed += dtMs;
        const pose = tweenRemoteMove(anim.start, anim.end, anim.elapsed);
        if (!meshes) meshes = sceneSync.pickMeshes ? sceneSync.pickMeshes() : [];
        applyAnimatedPose(t, pose, meshes);
        if (pose.done) activeMoves.delete(t.id);
      }
    }
    for (const id of Array.from(lastKnown.keys())) {
      if (!seen.has(id)) { lastKnown.delete(id); activeMoves.delete(id); }
    }
  }

  // =======================================================================================
  // 2. Hover feedback
  // =======================================================================================
  const HOVER_THROTTLE_MS = 33; // ~30Hz
  const hoverRingGeo = new THREE.RingGeometry(0.88, 1.06, 24);
  hoverRingGeo.rotateX(Math.PI / 2);
  const hoverRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
  });
  const hoverRing = new THREE.Mesh(hoverRingGeo, hoverRingMat);
  hoverRing.visible = false;
  scene.add(hoverRing);

  let lastPointer = null;
  let lastHoverCheck = 0;
  const onPointerMove = (e) => { lastPointer = { x: e.clientX, y: e.clientY }; };
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });

  function processHover() {
    if (!lastPointer) { hoverRing.visible = false; canvas.style.cursor = ''; return; }
    const now = nowMs();
    if (now - lastHoverCheck < HOVER_THROTTLE_MS) return;
    lastHoverCheck = now;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { hoverRing.visible = false; return; }
    const nx = ((lastPointer.x - rect.left) / rect.width) * 2 - 1;
    const ny = -(((lastPointer.y - rect.top) / rect.height) * 2 - 1);
    let tokenId = null;
    if (rig.raycastFromScreen && sceneSync.pickMeshes && sceneSync.tokenAt) {
      const raycaster = rig.raycastFromScreen(nx, ny);
      const hits = raycaster.intersectObjects(sceneSync.pickMeshes(), true);
      for (const h of hits) { const id = sceneSync.tokenAt(h); if (id != null) { tokenId = id; break; } }
    }
    const st = bridge.state();
    const tok = tokenId != null && st && st.tokens ? st.tokens.find((x) => x.id === tokenId) : null;
    const mine = !!(tok && bridge.mySide && tok.owner === bridge.mySide());
    if (tok && mine) {
      const hx = footprintHalfExtentsFor(tok);
      const el = sceneSync.elevationFor ? sceneSync.elevationFor(tok) : 0;
      hoverRing.position.set(tok.x, el + 0.028, tok.y);
      hoverRing.rotation.y = -(tok.rot || 0) * Math.PI / 180;
      hoverRing.scale.set(hx.hx + 0.10, 1, hx.hz + 0.10);
      hoverRing.visible = true;
      canvas.style.cursor = 'pointer';
    } else {
      hoverRing.visible = false;
      canvas.style.cursor = '';
    }
  }

  // =======================================================================================
  // 3. Double-click camera focus
  // =======================================================================================
  const FOCUS_LAMBDA = 9; // matches the rig's own ~10/s internal damping feel
  const FOCUS_EPS_IN = 0.1;
  const FOCUS_MAX_MS = 900; // safety cutoff well past the ~350ms nominal duration
  let focusAnim = null; // {targetWorld:[x,z], elapsed}

  function groundBasisFromCamera(camera) {
    camera.getWorldDirection(_camDir);
    const len = Math.hypot(_camDir.x, _camDir.z) || 1;
    const forward = { x: _camDir.x / len, z: _camDir.z / len };
    const right = { x: forward.z, z: -forward.x };
    return { forward, right };
  }

  const onDblClick = (e) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!rig.raycastFromScreen || !sceneSync.pickMeshes || !sceneSync.tokenAt) return;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const raycaster = rig.raycastFromScreen(nx, ny);
    const hits = raycaster.intersectObjects(sceneSync.pickMeshes(), true);
    let tokenId = null;
    for (const h of hits) { const id = sceneSync.tokenAt(h); if (id != null) { tokenId = id; break; } }
    if (tokenId == null) return;
    const st = bridge.state();
    const tok = st && st.tokens && st.tokens.find((x) => x.id === tokenId);
    if (!tok) return;
    focusAnim = { targetWorld: [tok.x, tok.y], elapsed: 0 };
  };
  canvas.addEventListener('dblclick', onDblClick);

  function processFocus(dtMs) {
    if (!focusAnim) return;
    focusAnim.elapsed += dtMs;
    const cur = rig.screenToBoard ? rig.screenToBoard(0, 0) : null;
    if (!cur || focusAnim.elapsed > FOCUS_MAX_MS) { focusAnim = null; return; }
    const remX = focusAnim.targetWorld[0] - cur[0];
    const remZ = focusAnim.targetWorld[1] - cur[1];
    if (Math.hypot(remX, remZ) < FOCUS_EPS_IN) { focusAnim = null; return; }
    const k = 1 - Math.exp(-FOCUS_LAMBDA * (Math.max(0, dtMs) / 1000));
    const stepX = remX * k, stepZ = remZ * k;
    const basis = groundBasisFromCamera(rig.camera);
    const dx = stepX * basis.right.x + stepZ * basis.right.z;
    const dy = stepX * basis.forward.x + stepZ * basis.forward.z;
    if (rig.panBy) rig.panBy(dx, dy);
  }

  // =======================================================================================
  // 4. Dice
  // =======================================================================================
  const dieGeometry = buildDieGeometry(THREE);
  const diceMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
  const diceBatcher = createDiceBatcher();
  let diceThrow = null; // {startedAt, dice:[{value,mesh,spawn,land,seed,restQuat}]}

  bridge.onDice((v) => {
    if (disposed || typeof v !== 'number') return;
    diceBatcher.push(v, nowMs());
  });

  function clearDice() {
    if (diceThrow) for (const d of diceThrow.dice) scene.remove(d.mesh);
    diceThrow = null;
  }

  function boardCenterFallback() {
    const st = bridge.state();
    const b = (st && st.board) || { w: 60, h: 44 };
    return [b.w / 2, b.h / 2];
  }

  function startDiceThrow(rolls, t) {
    clearDice();
    const shown = selectDiceSubset(rolls, DICE_CAP);
    const spawnXZ = (rig.screenToBoard && rig.screenToBoard(0.55, -0.55)) || boardCenterFallback();
    const landCenter = (rig.screenToBoard && rig.screenToBoard(0, 0)) || spawnXZ;
    const GOLDEN_ANGLE = 2.399963229728653;
    const dice = shown.map((value, i) => {
      const mesh = new THREE.Mesh(dieGeometry, diceMaterial);
      mesh.userData.dieValue = value; // testability hook + easy debugging; not read internally
      scene.add(mesh);
      const r = 0.6 + 0.55 * Math.sqrt(i);
      const theta = i * GOLDEN_ANGLE;
      const land = [landCenter[0] + r * Math.cos(theta), landCenter[1] + r * Math.sin(theta)];
      const seed = {
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        speed: 6 + Math.random() * 6, // rad/s
        phase: Math.random() * Math.PI * 2,
        yaw: Math.random() * Math.PI * 2,
      };
      const restQuat = quaternionForFaceUp(THREE, value, seed.yaw);
      return { value, mesh, spawn: spawnXZ, land, seed, restQuat };
    });
    diceThrow = { startedAt: t, dice };
    diceMaterial.opacity = 1;
  }

  function processDiceBatch() {
    const t = nowMs();
    if (diceBatcher.ready(t)) {
      const rolls = diceBatcher.flush();
      if (rolls.length) startDiceThrow(rolls, t);
    }
  }

  const _tumbleQ = new THREE.Quaternion();
  function processDiceThrow() {
    if (!diceThrow) return;
    const elapsed = nowMs() - diceThrow.startedAt;
    const total = DICE_THROW_MS + DICE_REST_MS + DICE_FADE_MS;
    if (elapsed >= total) { clearDice(); return; }
    diceMaterial.opacity = elapsed > DICE_THROW_MS + DICE_REST_MS
      ? 1 - clamp01((elapsed - DICE_THROW_MS - DICE_REST_MS) / DICE_FADE_MS)
      : 1;
    const ALIGN_START = 0.75;
    for (const d of diceThrow.dice) {
      if (elapsed <= DICE_THROW_MS) {
        const rawT = clamp01(elapsed / DICE_THROW_MS);
        const s = smoothstep(rawT);
        const x = lerp(d.spawn[0], d.land[0], s);
        const z = lerp(d.spawn[1], d.land[1], s);
        const y = lerp(DIE_SPAWN_HEIGHT_IN, DIE_HALF, s);
        d.mesh.position.set(x, y, z);
        if (rawT < ALIGN_START) {
          const ang = d.seed.phase + d.seed.speed * (elapsed / 1000);
          d.mesh.quaternion.setFromAxisAngle(d.seed.axis, ang);
        } else {
          const at = smoothstep((rawT - ALIGN_START) / (1 - ALIGN_START));
          const ang = d.seed.phase + d.seed.speed * (DICE_THROW_MS * ALIGN_START / 1000);
          _tumbleQ.setFromAxisAngle(d.seed.axis, ang);
          d.mesh.quaternion.copy(_tumbleQ).slerp(d.restQuat, at);
        }
      } else {
        d.mesh.position.set(d.land[0], DIE_HALF, d.land[1]);
        d.mesh.quaternion.copy(d.restQuat);
      }
    }
  }

  // =======================================================================================
  return {
    tick(dtMs, state) {
      processRemoteMoves(dtMs, state);
      processHover();
      processFocus(dtMs);
      processDiceBatch();
      processDiceThrow();
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.style.cursor = '';
      scene.remove(hoverRing);
      hoverRingGeo.dispose();
      hoverRingMat.dispose();
      clearDice();
      dieGeometry.dispose();
      diceMaterial.dispose();
      lastKnown.clear();
      activeMoves.clear();
      focusAnim = null;
    },
  };
}
