/* ==== WP3D-13: extras ==== Procedural WebAudio (dice clatter, piece thunk — gesture-gated,
 * persisted mute), 📸 battle-photo (WebGLRenderTarget @2x + toBlob PNG + navigator.share,
 * download fallback), camera preset buttons (¾ / ⬇ top / 👁 table-level). All DOM lives in an
 * overlay this pack creates inside deps.container (#boardwrap); no core-HTML edits.
 *
 * ---------------------------------------------------------------------------------------
 * Design notes (documented per the contract's "document your choice"):
 *
 * 1. HOVER TICK — SKIPPED. The contract flags this as optional, my call. Motion's own hover
 *    detection (WP3D-10) is internal — it never emits a hover *event* via motion.on(), only
 *    'tweenland'/'diceland'/'remotemove' are exposed. Shipping a hover sound would mean this
 *    pack re-implementing its own ~30Hz raycasting hover-poll purely to gate a sound, which
 *    is (a) duplicated logic already owned by WP3D-10, and (b) exactly the kind of
 *    continuous-retrigger-on-every-mouse-drift sound that reads as annoying rather than
 *    subtle on a board with 20+ minis under the cursor path. Skipped.
 *
 * 2. GESTURE-GATED AUDIOCONTEXT. One-time `window` pointerdown/keydown listeners (removed
 *    after the first fire, whichever comes first) construct the AudioContext lazily — never
 *    before, satisfying autoplay policy. `window` (not `canvas`) because keydown only
 *    bubbles through the currently-focused element's ancestor chain, and the focused element
 *    is very often <body> — a canvas- or container-scoped listener would miss keyboard-only
 *    first interactions. Matches this app's own existing idiom (hotkey '3' is a
 *    window-level keydown listener in wh40k-tabletop.html).
 *
 * 3. SYNTH PARAMS ARE PURE + RNG-INJECTABLE. diceClatterParams(count, rng) and
 *    pieceThunkParams(rng) never touch AudioContext — they return plain param objects within
 *    documented bands, so the test suite can inject a fixed rng and assert exact values
 *    (rather than just "runs without throwing"). Both are worst-case bounded well under the
 *    150ms/sound cap (dice: 3*18ms stagger + 50ms burst = 104ms; thunk: fixed 90ms).
 *
 * 4. CAMERA PRESETS — RELATIVE-API, PER-TICK, SELF-CORRECTING. The rig (WP3D-2) only exposes
 *    relative movers (orbitBy/zoomBy/panBy) plus one absolute reset (lookAtBoard); it has no
 *    "read current target spherical state" getter. ¾ is literally rig.lookAtBoard() — a
 *    single call, already eased for free by the rig's own internal update() damping. Top and
 *    table-level have no equivalent absolute setter, so each tick this pack DERIVES the
 *    live polar/radius from rig.camera.position + rig.screenToBoard(0,0) (the current
 *    look-at target), computes the remaining delta to the preset's target polar/radius, and
 *    issues an exponentially-damped FRACTION of that delta via orbitBy(0,dPolar) /
 *    zoomBy(radiusFactor) — same technique WP3D-10's double-click camera-focus pan uses for
 *    the same reason (panBy is relative too). Re-deriving from the live camera position each
 *    tick (rather than tracking a local running target) makes the animation self-correcting
 *    and enables true instant-cancel: any user pointerdown/wheel on the 3D canvas clears
 *    `activePreset` immediately (in the event handler, not polled), so a mid-flight preset
 *    never fights a user grabbing the camera mid-transition. Azimuth is left untouched by
 *    top/table (only ¾ resets it) per the brief's wording ("orbit to near-vertical polar",
 *    "low polar... + closer radius") — neither preset says anything about facing direction.
 *
 * 5. BATTLE PHOTO: NEVER touches the live renderer's size (that flickers — the canvas would
 *    visibly resize for one frame). Instead: one THREE.WebGLRenderTarget at 2x the canvas's
 *    CSS backing size, rendered into off-loop-cycle inside the click handler, read back via
 *    readRenderTargetPixels (GL's bottom-up row order), row-flipped (flipRowsRGBA — the pure,
 *    directly-testable core) into a scratch 2D <canvas> via putImageData, then toBlob PNG.
 *    renderer.setRenderTarget(prevTarget) restores state before returning so the next normal
 *    frame (rendered by the orchestrator's own loop right after) is unaffected. Delivery:
 *    navigator.share({files:[...]}) when share+canShare+File all exist AND canShare() itself
 *    returns true for this exact file; any share failure/cancel is swallowed silently (no
 *    fallback download — the user already saw and dismissed a share sheet, re-surfacing a
 *    browser download prompt on top of that would be surprising). Otherwise: object-URL
 *    anchor-click download, timestamped filename.
 *
 * 6. VISIBILITY: the button strip must hide the instant mode3d/mode3d-pip drop off (e.g. the
 *    user flips 3D fully "off"), but wh40k-3d.js's stop() halts the RAF loop entirely on
 *    "off" — extras.tick() simply stops being called, so a tick-only visibility check would
 *    leave the strip stuck visible. A MutationObserver on deps.container's `class` attribute
 *    (fires independent of the RAF loop) is the primary mechanism; tick() also re-checks
 *    every frame as a cheap fallback for environments without MutationObserver (kept for
 *    plain-node testability without a DOM-standard global).
 * ------------------------------------------------------------------------------------- */

/* =========================================================================================
 * Pure helpers — no THREE, no DOM, no AudioContext. Directly unit-testable.
 * ======================================================================================= */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

/* ---- localStorage mute persistence (default ON = not muted) --------------------------- */
export const SOUND_STORAGE_KEY = 'wh40k_3d_sound';
export function readMuted() {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(SOUND_STORAGE_KEY) === '0';
  } catch (e) { return false; }
}
export function writeMuted(muted) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SOUND_STORAGE_KEY, muted ? '0' : '1');
  } catch (e) { /* ignore (private mode / quota) */ }
}

/* ---- Synth parameter tables (pure, rng-injectable) ------------------------------------ */
export const DICE_SOUND_CAP_COUNT = 40; // matches bridge.onRemoteDice's own cap
export function diceClatterParams(count, rng) {
  const r = rng || Math.random;
  const n = clamp(count || 1, 1, DICE_SOUND_CAP_COUNT);
  const bursts = clamp(Math.round(1 + n / 6), 2, 4); // count-scaled, capped 2-4
  const out = [];
  for (let i = 0; i < bursts; i++) {
    out.push({
      delayMs: i * (10 + r() * 8),      // 10-18ms stagger per successive burst
      freqHz: 2000 + r() * 2000,        // bandpass center 2-4kHz
      q: 3 + r() * 3,                   // 3-6: tight-ish bandpass -> "clatter" not "hiss"
      durMs: 20 + r() * 30,             // 20-50ms per burst: quick decay
      detuneCents: (r() - 0.5) * 300,   // +/-150 cents random detune per burst
      gain: 0.04 + r() * 0.03,          // 0.04-0.07: subtle
    });
  }
  return out; // worst-case span: (bursts-1)*18 + 50 <= 3*18+50 = 104ms < 150ms cap
}
export function pieceThunkParams(rng) {
  const r = rng || Math.random;
  return {
    freqHz: 80 + r() * 40,      // 80-120Hz per spec
    durMs: 90,                   // fixed ~90ms per spec
    gain: 0.08 + r() * 0.02,     // subtle
    noiseMix: 0.15 + r() * 0.10, // fraction of gain blended in as low-passed noise texture
  };
}

/* ---- Camera preset math (pure) --------------------------------------------------------- */
// Mirrors WP3D-2's own private clamps (RADIUS_MIN=6, POLAR_MAX=1.45) so presets land inside
// the range the rig will accept anyway (orbitBy/zoomBy clamp internally regardless).
export const PRESET_RADIUS_MIN = 6;
export const PRESET_LAMBDA = 9;         // matches WP3D-10's FOCUS_LAMBDA / the rig's own damping feel
export const PRESET_POLAR_EPS = 0.01;   // rad
export const PRESET_RADIUS_EPS_REL = 0.01; // 1%
export const TOP_POLAR = 0.18;          // near-vertical (rig POLAR_MIN=0.1, kept off the hard clamp)
export const TABLE_POLAR = 1.35;        // low grazing eye-level (rig POLAR_MAX=1.45)
export const TOP_RADIUS_FACTOR = 0.55;  // * board diagonal: tight top-down full-board frame
export const TABLE_RADIUS_FACTOR = 0.42; // * board diagonal: closer-in eye-level frame

export function presetTargetFor(kind, board) {
  const b = board || { w: 60, h: 44 };
  const diag = Math.hypot(b.w || 60, b.h || 44);
  if (kind === 'top') return { polar: TOP_POLAR, radius: clamp(diag * TOP_RADIUS_FACTOR, PRESET_RADIUS_MIN, diag * 2.2) };
  if (kind === 'table') return { polar: TABLE_POLAR, radius: clamp(diag * TABLE_RADIUS_FACTOR, PRESET_RADIUS_MIN, diag * 2.2) };
  return null; // '34' has no target object — handled via rig.lookAtBoard() directly
}

/* derivePolarRadius(camPos, targetXZ) -> {radius, polar}
 * camPos = {x,y,z}; targetXZ = [tx, tz] (target.y is always 0 in the rig). Pure spherical
 * decomposition matching WP3D-2's own applyPose() convention. */
export function derivePolarRadius(camPos, targetXZ) {
  const tx = (targetXZ && targetXZ[0]) || 0, tz = (targetXZ && targetXZ[1]) || 0;
  const vx = camPos.x - tx, vy = camPos.y, vz = camPos.z - tz;
  const radius = Math.hypot(vx, vy, vz);
  const polar = radius > 1e-9 ? Math.acos(clamp(vy / radius, -1, 1)) : 0;
  return { radius, polar };
}

/* presetStep(cur, target, dtMs, lambda) -> {dPolar, radiusFactor, done}
 * cur/target = {polar, radius}. dPolar is an ADDITIVE radians step for rig.orbitBy(0,dPolar);
 * radiusFactor is a MULTIPLICATIVE step for rig.zoomBy(radiusFactor) (radius converges in
 * log-space so repeated multiplicative zoomBy calls land exactly on target, same as the
 * additive polar case lands via repeated orbitBy calls). */
export function presetStep(cur, target, dtMs, lambda) {
  const lam = lambda == null ? PRESET_LAMBDA : lambda;
  const dt = Math.max(0, dtMs || 0) / 1000;
  const a = clamp01(1 - Math.exp(-lam * dt));
  const remainingPolar = target.polar - cur.polar;
  const dPolar = remainingPolar * a;
  const radiusFactor = cur.radius > 1e-9 ? Math.pow(target.radius / cur.radius, a) : 1;
  const donePolar = Math.abs(remainingPolar) < PRESET_POLAR_EPS;
  const doneRadius = cur.radius > 1e-9 ? Math.abs(target.radius / cur.radius - 1) < PRESET_RADIUS_EPS_REL : true;
  return { dPolar, radiusFactor, done: donePolar && doneRadius };
}

/* ---- Photo pipeline pure parts --------------------------------------------------------- */
/* flipRowsRGBA(src, width, height) -> same-type typed array, rows in reverse order.
 * GL readRenderTargetPixels returns bottom-up rows; a 2D canvas expects top-down. */
export function flipRowsRGBA(src, width, height) {
  const Ctor = src.constructor || Uint8Array;
  const out = new Ctor(src.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcStart = y * rowBytes;
    const dstStart = (height - 1 - y) * rowBytes;
    for (let i = 0; i < rowBytes; i++) out[dstStart + i] = src[srcStart + i];
  }
  return out;
}

export function photoFilename(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `wh40k-battle-${stamp}.png`;
}

/* canUseShare(blob, filename) -> bool. Feature-detects navigator.share/canShare/File and
 * confirms canShare() itself accepts this exact file (some browsers expose share() but
 * reject image files, or expose no File support at all). */
export function canUseShare(blob, filename, nav, FileCtor) {
  const n = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : null);
  const F = FileCtor !== undefined ? FileCtor : (typeof File !== 'undefined' ? File : null);
  if (!n || typeof n.share !== 'function' || typeof n.canShare !== 'function' || !F) return false;
  try {
    const file = new F([blob], filename, { type: 'image/png' });
    return !!n.canShare({ files: [file] });
  } catch (e) { return false; }
}

/* =========================================================================================
 * createExtras(deps) -> { tick(dtMs, state), dispose() }
 * deps = { THREE, canvas, renderer, rig, scene, sceneSync, motion, bridge, container }
 * ======================================================================================= */
export function createExtras(deps) {
  const { THREE, canvas, renderer, rig, scene, sceneSync, motion, bridge, container } = deps;
  const doc = (container && container.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  let disposed = false;

  // =======================================================================================
  // Overlay DOM
  // =======================================================================================
  const BTN_CSS = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(22,19,23,.88);backdrop-filter:blur(4px);border:1px solid #3e3840;'
    + 'border-radius:16px;box-shadow:0 2px 6px rgba(0,0,0,.45);color:#ddd6cc;font-size:15px;'
    + 'line-height:1;cursor:pointer;pointer-events:auto;padding:0;';

  let overlay = null;
  const buttonHandlers = []; // [{el, fn}] for dispose
  function mkBtn(root, id, label, title, onClick) {
    const b = doc.createElement('button');
    b.id = id;
    if ('type' in b) b.type = 'button';
    b.textContent = label;
    if (title) b.title = title;
    b.style.cssText = BTN_CSS;
    b.addEventListener('click', onClick);
    buttonHandlers.push({ el: b, fn: onClick });
    root.appendChild(b);
    return b;
  }

  if (doc) {
    const root = doc.createElement('div');
    root.id = 'wp3dExtras';
    root.style.cssText = 'position:absolute;left:8px;bottom:8px;display:none;flex-direction:column;'
      + 'gap:4px;pointer-events:none;z-index:7;';
    const muteBtn = mkBtn(root, 'wp3dMute', readMuted() ? '🔇' : '🔊', 'Mute/unmute 3D sound', onMuteClick);
    const photoBtn = mkBtn(root, 'wp3dPhoto', '📸', 'Battle photo', onPhotoClick);
    const presetTQ = mkBtn(root, 'wp3dCamTQ', '¾', 'Camera: 3/4 view', () => startPreset('tq'));
    const presetTop = mkBtn(root, 'wp3dCamTop', '⬇', 'Camera: top-down', () => startPreset('top'));
    const presetTable = mkBtn(root, 'wp3dCamTable', '👁', 'Camera: table-level', () => startPreset('table'));
    container.appendChild(root);
    overlay = { root, muteBtn, photoBtn, presetTQ, presetTop, presetTable };
  }

  function isActive() {
    return !!(container && container.classList
      && (container.classList.contains('mode3d') || container.classList.contains('mode3d-pip')));
  }
  function syncVisibility() {
    if (overlay) overlay.root.style.display = isActive() ? 'flex' : 'none';
  }
  syncVisibility();

  let mo = null;
  if (container && typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(syncVisibility);
    mo.observe(container, { attributes: true, attributeFilter: ['class'] });
  }

  // =======================================================================================
  // Procedural WebAudio (gesture-gated, lazy AudioContext)
  // =======================================================================================
  let actx = null, master = null, noiseBuffer = null;
  let muted = readMuted();

  function ensureNoiseBuffer() {
    if (noiseBuffer || !actx) return;
    const len = Math.max(1, Math.floor(actx.sampleRate * 0.3));
    noiseBuffer = actx.createBuffer(1, len, actx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  function initAudioContext() {
    if (actx || disposed) return;
    const Ctor = (typeof AudioContext !== 'undefined') ? AudioContext
      : (typeof window !== 'undefined' && window.webkitAudioContext) ? window.webkitAudioContext : null;
    if (!Ctor) return;
    actx = new Ctor();
    master = actx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(actx.destination);
    ensureNoiseBuffer();
  }

  const onGesture = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    }
    initAudioContext();
  };
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pointerdown', onGesture, { once: true, passive: true });
    window.addEventListener('keydown', onGesture, { once: true });
  }

  function onMuteClick() {
    muted = !muted;
    writeMuted(muted);
    if (master) master.gain.value = muted ? 0 : 1;
    if (overlay) overlay.muteBtn.textContent = muted ? '🔇' : '🔊';
  }

  function scheduleBurst(b) {
    if (!actx || !noiseBuffer || muted) return;
    const src = actx.createBufferSource();
    src.buffer = noiseBuffer;
    if (src.detune) src.detune.value = b.detuneCents;
    const filt = actx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = b.freqHz;
    filt.Q.value = b.q;
    const g = actx.createGain();
    const t0 = actx.currentTime + b.delayMs / 1000;
    const durS = b.durMs / 1000;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(b.gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
    src.connect(filt); filt.connect(g); g.connect(master);
    const offset = Math.max(0, Math.random() * Math.max(0, noiseBuffer.duration - durS - 0.02));
    src.start(t0, offset, durS + 0.02);
    src.stop(t0 + durS + 0.03);
  }

  function playDice(count) {
    if (!actx || muted) return;
    const bursts = diceClatterParams(count);
    for (const b of bursts) scheduleBurst(b);
  }

  function playThunk() {
    if (!actx || muted) return;
    const p = pieceThunkParams();
    const t0 = actx.currentTime;
    const durS = p.durMs / 1000;
    const osc = actx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.freqHz, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, p.freqHz * 0.7), t0 + durS);
    const oscGain = actx.createGain();
    oscGain.gain.setValueAtTime(p.gain, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
    osc.connect(oscGain); oscGain.connect(master);
    osc.start(t0); osc.stop(t0 + durS + 0.02);

    if (noiseBuffer) {
      const src = actx.createBufferSource();
      src.buffer = noiseBuffer;
      const filt = actx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 200;
      const ng = actx.createGain();
      ng.gain.setValueAtTime(p.gain * p.noiseMix, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
      src.connect(filt); filt.connect(ng); ng.connect(master);
      src.start(t0, 0, durS + 0.02);
      src.stop(t0 + durS + 0.03);
    }
  }

  if (motion && typeof motion.on === 'function') {
    motion.on('tweenland', () => playThunk());
    motion.on('diceland', (payload) => playDice(payload && payload.count));
  }

  // =======================================================================================
  // Battle photo
  // =======================================================================================
  function capturePhoto() {
    return new Promise((resolve) => {
      if (!doc || !THREE || !renderer || !scene || !rig || !rig.camera) { resolve(null); return; }
      const w = canvas.width || canvas.clientWidth || 800;
      const h = canvas.height || canvas.clientHeight || 600;
      const rtW = Math.max(1, Math.round(w * 2));
      const rtH = Math.max(1, Math.round(h * 2));
      const rt = new THREE.WebGLRenderTarget(rtW, rtH);
      const prevTarget = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
      try {
        renderer.setRenderTarget(rt);
        renderer.render(scene, rig.camera);
        const buf = new Uint8Array(rtW * rtH * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, rtW, rtH, buf);
        renderer.setRenderTarget(prevTarget || null);
        rt.dispose();

        const flipped = flipRowsRGBA(buf, rtW, rtH);
        const outCanvas = doc.createElement('canvas');
        outCanvas.width = rtW; outCanvas.height = rtH;
        const ctx2d = outCanvas.getContext('2d');
        const imgData = ctx2d.createImageData(rtW, rtH);
        imgData.data.set(flipped);
        ctx2d.putImageData(imgData, 0, 0);
        outCanvas.toBlob((blob) => resolve(blob), 'image/png');
      } catch (e) {
        try { renderer.setRenderTarget(prevTarget || null); } catch (e2) { /* ignore */ }
        resolve(null);
      }
    });
  }

  function downloadBlob(blob, filename) {
    if (!doc || typeof URL === 'undefined' || !URL.createObjectURL) return;
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url; a.download = filename;
    if (doc.body && doc.body.appendChild) doc.body.appendChild(a);
    a.click();
    if (doc.body && doc.body.removeChild) { try { doc.body.removeChild(a); } catch (e) { /* ignore */ } }
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 1000);
  }

  async function deliverPhoto(blob) {
    const filename = photoFilename();
    if (canUseShare(blob, filename)) {
      try {
        const file = new File([blob], filename, { type: 'image/png' });
        await navigator.share({ files: [file], title: 'WH40k battle photo' });
        return;
      } catch (e) { return; } // user cancelled / share failed — no fallback surprise
    }
    downloadBlob(blob, filename);
  }

  function onPhotoClick() {
    capturePhoto().then((blob) => { if (blob) deliverPhoto(blob); });
  }

  // =======================================================================================
  // Camera presets
  // =======================================================================================
  let activePreset = null; // {kind, target:{polar,radius}}

  function startPreset(kind) {
    if (kind === 'tq') {
      activePreset = null;
      if (rig.lookAtBoard) rig.lookAtBoard();
      return;
    }
    const st = bridge && bridge.state ? bridge.state() : null;
    const board = (st && st.board) || { w: 60, h: 44 };
    const target = presetTargetFor(kind, board);
    if (target) activePreset = { kind, target };
  }

  const onUserCamInput = () => { activePreset = null; };
  if (canvas && canvas.addEventListener) {
    canvas.addEventListener('pointerdown', onUserCamInput, { passive: true });
    canvas.addEventListener('wheel', onUserCamInput, { passive: true });
  }

  function tickPresets(dtMs) {
    if (!activePreset) return;
    const camPos = rig.camera && rig.camera.position;
    if (!camPos || !rig.screenToBoard || !rig.orbitBy || !rig.zoomBy) { activePreset = null; return; }
    const targetXZ = rig.screenToBoard(0, 0) || [camPos.x, camPos.z];
    const cur = derivePolarRadius(camPos, targetXZ);
    const step = presetStep(cur, activePreset.target, dtMs);
    rig.orbitBy(0, step.dPolar);
    rig.zoomBy(step.radiusFactor);
    if (step.done) activePreset = null;
  }

  // =======================================================================================
  return {
    tick(dtMs, state) {
      if (disposed) return;
      syncVisibility();
      tickPresets(dtMs);
    },
    dispose() {
      disposed = true;
      if (mo) { mo.disconnect(); mo = null; }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('keydown', onGesture);
      }
      if (canvas && canvas.removeEventListener) {
        canvas.removeEventListener('pointerdown', onUserCamInput);
        canvas.removeEventListener('wheel', onUserCamInput);
      }
      for (const { el, fn } of buttonHandlers) { try { el.removeEventListener('click', fn); } catch (e) { /* ignore */ } }
      if (overlay && overlay.root && overlay.root.parentNode) overlay.root.parentNode.removeChild(overlay.root);
      overlay = null;
      activePreset = null;
      if (actx) {
        try { if (actx.state !== 'closed' && typeof actx.close === 'function') actx.close(); } catch (e) { /* ignore */ }
      }
      actx = null; master = null; noiseBuffer = null;
    },
  };
}
