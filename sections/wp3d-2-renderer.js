/* ==== WP3D-2: renderer, camera rig, perf ====
   Fragment consumed by the integrator (concatenated into wh40k-3d.js). Pure ES module,
   no cross-section imports, no top-level side effects. three.js is taken as an argument
   (THREE) everywhere rather than imported at module scope for THIS file's own factories
   that don't strictly need it (wp3dPerfTier, createLoop, createFpsGovernor) so those stay
   importable/testable with zero three.js dependency at all; createRenderer/createCameraRig
   receive THREE explicitly per the contract signatures. */

// ---------------------------------------------------------------------------
// 1. wp3dPerfTier — pure device -> render-quality tier
// ---------------------------------------------------------------------------
/**
 * @param {{phone?:boolean, dpr?:number, memoryGB?:number}} deviceInfo
 * @returns {{pixelRatioCap:number, antialias:boolean, labelEvery:number, shadows:boolean}}
 */
export function wp3dPerfTier(deviceInfo) {
  const d = deviceInfo || {};
  // shadows: !phone (WP3D-v2 immersion pass) — real shadow maps are desktop/iPad-tier only;
  // phones skip shadow-map rendering entirely (see createRenderer below).
  if (d.phone) return { pixelRatioCap: 1.5, antialias: false, labelEvery: 2, shadows: false };
  return { pixelRatioCap: 2, antialias: true, labelEvery: 1, shadows: true };
}

// The FPS governor's downgrade target (contract: "degraded (set by governor)").
// Exported as a convenience constant for the integrator's onDowngrade handler;
// not part of the frozen call signatures, purely additive.
export const WP3D_DEGRADED_TIER = { pixelRatioCap: 1, antialias: false, labelEvery: 3, shadows: false };

// ---------------------------------------------------------------------------
// 2. createRenderer
// ---------------------------------------------------------------------------
/**
 * @param {typeof import('../vendor/three.module.min.js')} THREE
 * @param {HTMLCanvasElement} canvas
 * @param {{pixelRatioCap:number, antialias:boolean, shadows?:boolean}} tier
 * @returns {{renderer:any, setSize:(w:number,h:number)=>void, onContextLost:(cb:Function)=>void, onContextRestored:(cb:Function)=>void, dispose:()=>void}}
 */
export function createRenderer(THREE, canvas, tier) {
  // ALL construction lives inside this factory (never at module scope) so the
  // module itself imports cleanly under plain node with no real canvas/GL.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !!tier.antialias,
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(
    (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1),
    tier.pixelRatioCap
  ));
  // Shadow maps: desktop/iPad-tier only (tier.shadows, WP3D-v2 immersion pass). Soft PCF so
  // token/terrain shadow edges aren't jagged at the board's normal viewing distances.
  renderer.shadowMap.enabled = !!tier.shadows;
  if (renderer.shadowMap.enabled && THREE.PCFSoftShadowMap != null) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  // sRGB output (r170 API name).
  if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  let lostCb = null;
  let restoredCb = null;
  const handleLost = (e) => {
    e.preventDefault();
    if (lostCb) lostCb();
  };
  const handleRestored = () => {
    if (restoredCb) restoredCb();
  };
  canvas.addEventListener("webglcontextlost", handleLost, false);
  canvas.addEventListener("webglcontextrestored", handleRestored, false);

  return {
    renderer,
    setSize(w, h) {
      renderer.setSize(w, h, false);
    },
    onContextLost(cb) { lostCb = cb; },
    onContextRestored(cb) { restoredCb = cb; },
    dispose() {
      canvas.removeEventListener("webglcontextlost", handleLost, false);
      canvas.removeEventListener("webglcontextrestored", handleRestored, false);
      renderer.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// 3. createCameraRig
// ---------------------------------------------------------------------------
const POLAR_MIN = 0.1;
const POLAR_MAX = 1.45;
const RADIUS_MIN = 6;
const DAMP_LAMBDA = 10; // 1/s — exponential damping rate, frame-rate independent

/**
 * @param {typeof import('../vendor/three.module.min.js')} THREE
 * @param {HTMLCanvasElement} canvas
 * @param {{w:number,h:number}} board  board.w/h in inches
 */
export function createCameraRig(THREE, canvas, board) {
  const w = board.w, h = board.h;
  const diag = Math.hypot(w, h);
  const radiusMax = 2.2 * diag;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, radiusMax * 4 + 100);

  // Default TTS-style 3/4 framing: elevated, angled corner view of the whole board.
  const DEFAULT_AZIMUTH = Math.PI / 4;
  const DEFAULT_POLAR = 0.95;
  // Frame the whole board diagonal comfortably inside the vertical FOV.
  const DEFAULT_RADIUS = clamp(diag * 0.85, RADIUS_MIN, radiusMax);

  const centerTarget = () => new THREE.Vector3(w / 2, 0, h / 2);

  // "current" (eased/displayed) and "target" (desired) spherical state.
  const cur = { azimuth: DEFAULT_AZIMUTH, polar: DEFAULT_POLAR, radius: DEFAULT_RADIUS, target: centerTarget() };
  const tgt = { azimuth: DEFAULT_AZIMUTH, polar: DEFAULT_POLAR, radius: DEFAULT_RADIUS, target: centerTarget() };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function applyPose() {
    const { azimuth, polar, radius, target } = cur;
    const x = target.x + radius * Math.sin(polar) * Math.sin(azimuth);
    const y = target.y + radius * Math.cos(polar);
    const z = target.z + radius * Math.sin(polar) * Math.cos(azimuth);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }
  applyPose();

  function update(dtMs) {
    const dt = Math.max(0, dtMs || 0) / 1000;
    const a = 1 - Math.exp(-DAMP_LAMBDA * dt); // ease factor, frame-rate independent
    cur.azimuth += (tgt.azimuth - cur.azimuth) * a;
    cur.polar += (tgt.polar - cur.polar) * a;
    cur.radius += (tgt.radius - cur.radius) * a;
    cur.target.x += (tgt.target.x - cur.target.x) * a;
    cur.target.y += (tgt.target.y - cur.target.y) * a;
    cur.target.z += (tgt.target.z - cur.target.z) * a;
    applyPose();
  }

  // Ground-plane forward/right basis for the CURRENT (displayed) orientation.
  function groundBasis() {
    const az = cur.azimuth;
    // forward = horizontal direction the camera is looking (toward the target)
    const forward = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    const right = new THREE.Vector3(forward.z, 0, -forward.x); // forward rotated -90deg about Y
    return { forward, right };
  }

  function orbitBy(dx, dy) {
    tgt.azimuth += dx;
    tgt.polar = clamp(tgt.polar + dy, POLAR_MIN, POLAR_MAX);
  }

  function panBy(dx, dy) {
    const { forward, right } = groundBasis();
    tgt.target.x += right.x * dx + forward.x * dy;
    tgt.target.z += right.z * dx + forward.z * dy;
  }

  function zoomBy(f) {
    tgt.radius = clamp(tgt.radius * f, RADIUS_MIN, radiusMax);
  }

  function lookAtBoard() {
    tgt.azimuth = DEFAULT_AZIMUTH;
    tgt.polar = DEFAULT_POLAR;
    tgt.radius = DEFAULT_RADIUS;
    tgt.target = centerTarget();
  }

  function raycastFromScreen(nx, ny) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    return raycaster;
  }

  function screenToBoard(nx, ny) {
    const raycaster = raycastFromScreen(nx, ny);
    const origin = raycaster.ray.origin, dir = raycaster.ray.direction;
    if (Math.abs(dir.y) < 1e-9) return null;
    const t = -origin.y / dir.y;
    if (t < 0) return null;
    const ix = origin.x + dir.x * t;
    const iz = origin.z + dir.z * t;
    return [ix, iz];
  }

  function project(v3) {
    camera.updateMatrixWorld();
    // Behind-camera check in view space (three.js camera looks down -Z).
    const view = v3.clone().applyMatrix4(camera.matrixWorldInverse);
    const behind = view.z > 0;
    const ndc = v3.clone().project(camera);
    const inFrustum = ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1 && ndc.z >= -1 && ndc.z <= 1;
    return { x: ndc.x, y: ndc.y, visible: !behind && inFrustum };
  }

  return {
    camera,
    update,
    orbitBy, panBy, zoomBy,
    lookAtBoard,
    raycastFromScreen,
    screenToBoard,
    project,
  };
}

// ---------------------------------------------------------------------------
// 4. createLoop — RAF lifecycle
// ---------------------------------------------------------------------------
/**
 * @param {(dtMs:number)=>void} fn
 * @param {{raf?:Function, caf?:Function, doc?:Document}} [opts] injectables for node tests
 */
export function createLoop(fn, opts) {
  const o = opts || {};
  const raf = o.raf || (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : globalThis.requestAnimationFrame);
  const caf = o.caf || (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : globalThis.cancelAnimationFrame);
  const doc = o.doc || (typeof document !== "undefined" ? document : undefined);

  let running = false;   // logical "should be running" state (start() was called, stop() wasn't)
  let ticking = false;   // an RAF is actually scheduled right now
  let handle = null;
  let lastT = null;

  function isHidden() {
    return !!(doc && doc.hidden);
  }

  function frame(t) {
    handle = null;
    if (!running) { ticking = false; return; }
    if (isHidden()) { ticking = false; return; } // auto-stop while hidden; resumes on visibilitychange
    const dt = lastT == null ? 0 : (t - lastT);
    lastT = t;
    fn(dt);
    if (running && !isHidden()) {
      handle = raf(frame);
    } else {
      ticking = false;
    }
  }

  function scheduleIfNeeded() {
    if (running && !ticking && !isHidden()) {
      ticking = true;
      lastT = null;
      handle = raf(frame);
    }
  }

  function onVisibilityChange() {
    if (isHidden()) {
      if (handle != null) { caf(handle); handle = null; }
      ticking = false;
    } else {
      scheduleIfNeeded();
    }
  }

  if (doc && doc.addEventListener) {
    doc.addEventListener("visibilitychange", onVisibilityChange);
  }

  return {
    start() {
      if (running) return; // guard double-start
      running = true;
      scheduleIfNeeded();
    },
    stop() {
      running = false;
      if (handle != null) { caf(handle); handle = null; }
      ticking = false;
    },
  };
}

// ---------------------------------------------------------------------------
// 5. createFpsGovernor
// ---------------------------------------------------------------------------
/**
 * @param {()=>void} onDowngrade
 * @param {{windowMs?:number, minFps?:number, now?:()=>number}} [opts]
 * @returns {{sample(dtMs:number):void, reset():void}}
 */
export function createFpsGovernor(onDowngrade, opts) {
  const o = opts || {};
  const windowMs = o.windowMs || 2000;
  const minFps = o.minFps != null ? o.minFps : 30;

  let elapsed = 0;
  let frames = 0;
  let fired = false;
  let done = false; // window fully sampled

  function sample(dtMs) {
    if (fired || done) return;
    // Ignore the very first frame of a run (dt==0/unknown baseline).
    if (dtMs > 0) {
      elapsed += dtMs;
      frames += 1;
    }
    if (elapsed >= windowMs) {
      done = true;
      const avgFps = frames > 0 ? (frames * 1000) / elapsed : 0;
      if (avgFps < minFps) {
        fired = true;
        if (onDowngrade) onDowngrade();
      }
    }
  }

  function reset() {
    elapsed = 0; frames = 0; fired = false; done = false;
  }

  return { sample, reset };
}

// ---------------------------------------------------------------------------
// 6. observeResize
// ---------------------------------------------------------------------------
/**
 * @param {Element} container
 * @param {(w:number,h:number,dpr:number)=>void} cb
 * @param {{RO?:Function, dpr?:number}} [opts] injectable ResizeObserver ctor for node tests
 * @returns {{disconnect():void}}
 */
export function observeResize(container, cb, opts) {
  const o = opts || {};
  const RO = o.RO || (typeof ResizeObserver !== "undefined" ? ResizeObserver : globalThis.ResizeObserver);
  const dpr = o.dpr != null ? o.dpr : (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1);

  const ro = new RO((entries) => {
    for (const entry of entries) {
      const box = entry.contentRect || (container.getBoundingClientRect && container.getBoundingClientRect());
      if (box) cb(box.width, box.height, dpr);
    }
  });
  ro.observe(container);
  return { disconnect() { ro.disconnect(); } };
}
