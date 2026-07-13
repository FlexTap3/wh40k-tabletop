/* ==== WP3D-12: battle-cam ==== Attack cinematic (bridge.onAttackStaged → frame attacker→
 * target), shared-dice consumer (bridge.onRemoteDice → opponent's rolls tumble on YOUR
 * table, visually tagged as theirs — actually implemented in wp3d-10-motion.js, which owns
 * the whole dice system; battle-cam's own job is purely the camera cinematic + ground pulse),
 * yields to user camera input per the shared rule.
 *
 * ---------------------------------------------------------------------------------------
 * Design notes:
 *
 * 1. FRAMING MATH (computeFraming, pure, no THREE). Given the attacker's and target's
 *    board-space {x,y} (board 'y' == world 'z'), returns the desired camera target (their
 *    midpoint), azimuth, polar and radius:
 *      - target = midpoint of the two tokens.
 *      - azimuth = angle of the attacker->target line PLUS a fixed ~51° offset
 *        (BATTLECAM_AZIMUTH_OFFSET) — a dead-on azimuth would look straight down the attack
 *        line with one token occluding the other; the offset gives the "low 3/4 angle"
 *        framing the brief asks for (an angled corner view of the pair, same visual family
 *        as the rig's own DEFAULT_AZIMUTH=π/4 overview shot).
 *      - polar = a fixed BATTLECAM_POLAR (1.15rad ≈ 66°), lower/closer to the table than the
 *        rig's DEFAULT_POLAR (0.95rad) for a more dramatic, less top-down angle, but well
 *        short of the rig's own POLAR_MAX (1.45rad, near edge-on) so the ground stays legible.
 *      - radius = scaled to the tokens' separation (BATTLECAM_RADIUS_PER_IN) plus a fixed pad
 *        (BATTLECAM_RADIUS_PAD, generous enough that two base-to-base melee tokens still get
 *        breathing room), clamped to a sane minimum.
 *
 * 2. DRIVING THE CAMERA (relative-API technique). The rig (wp3d-2-renderer.js) exposes only
 *    RELATIVE panBy/orbitBy/zoomBy — no "set target/azimuth/radius" setter — the exact same
 *    situation wp3d-10-motion.js's double-click focus-pan is in, and this module uses the
 *    identical shape of solution: read the CURRENT camera state back out (readRigState, via
 *    rig.camera.position + rig.screenToBoard(0,0) as the "what is the target right now"
 *    query — NDC (0,0) is dead-center, exactly where camera.lookAt(target) points), compute
 *    the remaining delta to the desired framing, and step it down via one exponential-eased
 *    fraction per tick (BATTLECAM_LAMBDA tuned so ~90% of the move lands within the brief's
 *    ~600ms: time-to-90% ≈ ln(10)/λ, so λ≈3.84 for 0.6s). Every tick recomputes both "where
 *    are we now" and "how far to go", so orbitBy/panBy/zoomBy are driven off the CURRENT
 *    displayed state each frame, not a one-shot precomputed path — this is what makes
 *    instant-cancel (note 4) actually instant: we simply stop calling them.
 *
 * 3. GROUND PULSE MARKER. A single flat ring mesh (RingGeometry, built once, reused across
 *    attacks rather than reallocated) is repositioned under the framing midpoint and made
 *    visible on stage; pulseMarkerPose(elapsedMs) is a pure function producing 3 pulses
 *    (sin-wave scale/opacity bumps) over PULSE_TOTAL_MS with an overall fade envelope, after
 *    which the marker goes invisible again ("auto-remove" = becomes invisible + inert, not a
 *    literal scene.remove/recreate each time — cheaper, and the mesh is only truly removed
 *    from the scene in dispose()).
 *
 * 4. YIELD + CANCEL (shared rule, consumed here — deps.modes.userQuietFor). Staging gate:
 *    per the packet brief literally, `deps.modes.userQuietFor ? userQuietFor() > 5000 : true`
 *    — if the mode manager hasn't wired the shared yield API yet (stub absence — this pack
 *    ships independently of WP2's wp3d-11-modes.js), battle-cam simply always allows itself
 *    to fire; it has no OTHER way to know whether the user is mid-orbit. Cancel-mid-flight:
 *    every tick, if userQuietFor() is available and reports a very small value (< 50ms —
 *    "0-ish"), that means a pointerdown/wheel landed on the canvas within about a frame or
 *    two, i.e. the user just grabbed the camera — cancel instantly. This can't false-positive
 *    at animation START: userQuietFor() only just cleared 5000ms+ to pass the gate above, so
 *    it's nowhere near the cancel threshold on the animation's first tick; it only drops back
 *    near zero from an ACTUAL fresh input event. battle-cam has no `canvas` reference in its
 *    frozen deps shape, so listening for pointerdown/wheel directly isn't an option here —
 *    userQuietFor() is the only signal available, which is why the gate is written to degrade
 *    gracefully (note above) rather than hard-require it.
 * ------------------------------------------------------------------------------------- */

// ---------------------------------------------------------------------------------------
// Pure math (directly testable, no THREE).
// ---------------------------------------------------------------------------------------
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export const BATTLECAM_POLAR = 1.15; // radians; "low 3/4" — lower than the default overview
export const BATTLECAM_AZIMUTH_OFFSET = 0.9; // radians (~51°) off the attacker->target line
export const BATTLECAM_RADIUS_PER_IN = 1.15; // radius scales with token separation
export const BATTLECAM_RADIUS_MIN = 8; // inches — floor even for two adjacent (melee) tokens
export const BATTLECAM_RADIUS_PAD = 4; // inches of headroom baked into the radius
export const BATTLECAM_LAMBDA = 3.8; // 1/s — exponential ease rate, tuned for a ~600ms move
export const BATTLECAM_MOVE_EPS_IN = 0.08;
export const BATTLECAM_ANGLE_EPS_RAD = 0.01;
export const BATTLECAM_RADIUS_EPS_FACTOR = 0.01;
export const BATTLECAM_MAX_MS = 1400; // safety cutoff well past the ~600ms nominal duration
export const BATTLECAM_CANCEL_QUIET_MS = 50; // "0-ish" — a fresh input landed within ~a frame
export const BATTLECAM_YIELD_MS = 5000; // shared yield rule threshold

/* computeFraming(attacker, target) -> {targetX, targetZ, azimuth, polar, radius}
 * attacker/target = {x, y} in board inches (board 'y' == world 'z'). Pure — see design note 1. */
export function computeFraming(attacker, target) {
  const midX = (attacker.x + target.x) / 2;
  const midZ = (attacker.y + target.y) / 2;
  const dx = target.x - attacker.x, dz = target.y - attacker.y;
  const sep = Math.hypot(dx, dz);
  const lineAz = Math.atan2(dx, dz); // same (x,z)->azimuth convention the rig's applyPose uses
  const azimuth = lineAz + BATTLECAM_AZIMUTH_OFFSET;
  const radius = Math.max(BATTLECAM_RADIUS_MIN, sep * BATTLECAM_RADIUS_PER_IN + BATTLECAM_RADIUS_PAD);
  return { targetX: midX, targetZ: midZ, azimuth, polar: BATTLECAM_POLAR, radius };
}

/* shortestAngleDelta(from, to) -> signed delta in (-PI, PI], the short way around the wrap. */
export function shortestAngleDelta(from, to) {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/* pulseMarkerPose(elapsedMs) -> {visible, scale, opacity} — 3 sin-wave pulses over
 * PULSE_TOTAL_MS with an overall fade envelope. Pure — see design note 3. */
export const PULSE_TOTAL_MS = 1500;
export const PULSE_CYCLES = 3;
export const PULSE_MAX_SCALE = 1.9;
export function pulseMarkerPose(elapsedMs) {
  const t = clamp01(elapsedMs / PULSE_TOTAL_MS);
  if (elapsedMs >= PULSE_TOTAL_MS) return { visible: false, scale: 1, opacity: 0 };
  const phase = t * PULSE_CYCLES;
  const cyclePos = phase - Math.floor(phase); // 0..1 within the current pulse
  const wave = Math.sin(cyclePos * Math.PI); // 0 -> 1 -> 0 per pulse
  const fade = 1 - t; // overall fade across the marker's whole lifetime
  return { visible: true, scale: 1 + wave * (PULSE_MAX_SCALE - 1), opacity: wave * fade };
}

/* readRigState(rig) -> {targetX, targetZ, azimuth, polar, radius} — reconstructs the rig's
 * CURRENT spherical camera state from its only public surface (camera.position +
 * screenToBoard(0,0) as the "current target" query). See design note 2. Target.y is always 0
 * (ground plane), matching centerTarget()/panBy's own assumption in wp3d-2-renderer.js. */
export function readRigState(rig) {
  const cam = rig.camera;
  const t2 = rig.screenToBoard ? rig.screenToBoard(0, 0) : null;
  const targetX = t2 ? t2[0] : cam.position.x;
  const targetZ = t2 ? t2[1] : cam.position.z;
  const dx = cam.position.x - targetX;
  const dy = cam.position.y; // - target.y(0)
  const dz = cam.position.z - targetZ;
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
  const polar = Math.acos(clampN(dy / radius, -1, 1));
  const azimuth = Math.atan2(dx, dz);
  return { targetX, targetZ, azimuth, polar, radius };
}

// ---------------------------------------------------------------------------------------
// createBattlecam(deps) -> { tick(dtMs, state), dispose() }
// deps = { THREE, scene, rig, sceneSync, motion, bridge, modes }
// ---------------------------------------------------------------------------------------
export function createBattlecam(deps) {
  const { THREE, scene, rig, bridge, modes } = deps;
  // sceneSync/motion are accepted per the frozen orchestrator wiring shape but unused here —
  // battle-cam's own job is camera framing + the ground pulse, not scene/token bookkeeping.
  let disposed = false;

  const _camDir = new THREE.Vector3();
  function groundBasisFromCamera(camera) {
    camera.getWorldDirection(_camDir);
    const len = Math.hypot(_camDir.x, _camDir.z) || 1;
    const forward = { x: _camDir.x / len, z: _camDir.z / len };
    const right = { x: forward.z, z: -forward.x };
    return { forward, right };
  }

  // ---- ground pulse marker (built once, reused across attacks). depthTest:false + a high
  // renderOrder make it a "ping": it reads even when the framing midpoint sits under/behind
  // a ruin slab (visual-iteration finding — a depth-tested ground ring is fully occluded on
  // dense boards exactly when the battle-cam is pointing at the middle of the terrain). ----
  const pulseGeo = new THREE.RingGeometry(1.0, 1.35, 32);
  pulseGeo.rotateX(Math.PI / 2);
  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c0, transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false, depthTest: false,
  });
  const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
  pulseMesh.renderOrder = 999;
  pulseMesh.visible = false;
  scene.add(pulseMesh);
  let pulseElapsed = 0;

  // ---- camera cinematic state ----
  let camAnim = null; // { desired:{targetX,targetZ,azimuth,polar,radius}, elapsed }

  function userQuietMs() {
    return modes && typeof modes.userQuietFor === 'function' ? modes.userQuietFor() : null;
  }

  function onStaged(aId, tId) {
    if (disposed) return;
    if (aId == null || tId == null) return;
    const st = bridge.state();
    const tokens = (st && st.tokens) || [];
    const attacker = tokens.find((t) => t.id === aId);
    const target = tokens.find((t) => t.id === tId);
    if (!attacker || !target) return; // "both ids resolve to live tokens"
    const uq = userQuietMs();
    const allowed = uq != null ? uq > BATTLECAM_YIELD_MS : true; // guard for modes stub absence
    if (!allowed) return;

    const framing = computeFraming(attacker, target);
    camAnim = { desired: framing, elapsed: 0 };
    pulseElapsed = 0;
    pulseMesh.position.set(framing.targetX, 0.05, framing.targetZ);
    pulseMesh.scale.set(1, 1, 1);
    pulseMat.opacity = 0;
    pulseMesh.visible = true;
  }
  if (bridge.onAttackStaged) bridge.onAttackStaged(onStaged);

  function processCamAnim(dtMs) {
    if (!camAnim) return;
    const uq = userQuietMs();
    if (uq != null && uq < BATTLECAM_CANCEL_QUIET_MS) { camAnim = null; return; } // instant cancel
    camAnim.elapsed += dtMs;
    const cur = readRigState(rig);
    const d = camAnim.desired;
    const remX = d.targetX - cur.targetX;
    const remZ = d.targetZ - cur.targetZ;
    const remAz = shortestAngleDelta(cur.azimuth, d.azimuth);
    const remPolar = d.polar - cur.polar;
    const radiusFactor = d.radius / (cur.radius || 1e-6);
    const converged = Math.hypot(remX, remZ) < BATTLECAM_MOVE_EPS_IN
      && Math.abs(remAz) < BATTLECAM_ANGLE_EPS_RAD
      && Math.abs(remPolar) < BATTLECAM_ANGLE_EPS_RAD
      && Math.abs(radiusFactor - 1) < BATTLECAM_RADIUS_EPS_FACTOR;
    if (converged || camAnim.elapsed > BATTLECAM_MAX_MS) { camAnim = null; return; }

    const k = 1 - Math.exp(-BATTLECAM_LAMBDA * (Math.max(0, dtMs) / 1000));
    const stepX = remX * k, stepZ = remZ * k;
    const basis = groundBasisFromCamera(rig.camera);
    const panDx = stepX * basis.right.x + stepZ * basis.right.z;
    const panDy = stepX * basis.forward.x + stepZ * basis.forward.z;
    if (rig.panBy) rig.panBy(panDx, panDy);
    if (rig.orbitBy) rig.orbitBy(remAz * k, remPolar * k);
    if (rig.zoomBy) rig.zoomBy(1 + (radiusFactor - 1) * k);
  }

  function processPulse(dtMs) {
    if (!pulseMesh.visible) return;
    pulseElapsed += dtMs;
    const pose = pulseMarkerPose(pulseElapsed);
    if (!pose.visible) { pulseMesh.visible = false; pulseMat.opacity = 0; return; }
    pulseMesh.scale.set(pose.scale, 1, pose.scale);
    pulseMat.opacity = pose.opacity;
  }

  return {
    tick(dtMs /*, state */) {
      if (disposed) return;
      processCamAnim(dtMs);
      processPulse(dtMs);
    },
    /* _debug — WP3D-v3 test/inspection hook (documented, intentionally minimal), same
       convention as wp3d-10-motion.js's _debug surface. Not part of the frozen contract. */
    _debug: { camAnim: () => camAnim, pulseMesh: () => pulseMesh },
    dispose() {
      disposed = true;
      camAnim = null;
      scene.remove(pulseMesh);
      pulseGeo.dispose();
      pulseMat.dispose();
    },
  };
}
