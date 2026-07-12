/* ==== wh40k-3d.js — optional 3D view (WP3D). Pages-only asset, lazy-imported by
   wh40k-tabletop.html's wp3dToggle() against the window.WP3D bridge. ====
   WP3D-5 orchestrator: wires the four section modules together. Kept as a thin module
   importing ./sections/* (rather than one concatenated file) so the node test suites
   exercise the exact shipped code; all five files + vendor/three are SW-cached.
   The emailed file:// copy never reaches this module (dynamic import is refused on file:,
   and the Setup checkbox is disabled there by wp3dAvailable()). */
import * as THREE from './vendor/three.module.min.js';
import { createSceneSync } from './sections/wp3d-1-geometry.js';
import { wp3dPerfTier, WP3D_DEGRADED_TIER, createRenderer, createCameraRig,
         createLoop, createFpsGovernor, observeResize } from './sections/wp3d-2-renderer.js';
import { createLabelLayer } from './sections/wp3d-3-labels.js';
import { createInteraction } from './sections/wp3d-4-interaction.js';
/* ==== WP3D-v2 content packs ==== registered/created below; each lives in its own file. */
import { register as registerTerrainPack } from './sections/wp3d-6-terrain2.js';
import { register as registerTroopKits } from './sections/wp3d-7-troops.js';
import { register as registerVehicleKits } from './sections/wp3d-8-vehicles.js';
import { createEnvironment } from './sections/wp3d-9-environment.js';
import { createMotion } from './sections/wp3d-10-motion.js';

let packsRegistered = false;
function registerPacks() {
  if (packsRegistered) return;
  packsRegistered = true;
  // Vehicles register after troops but carry higher priority (name-specific beats keyword).
  try { registerTerrainPack(); } catch (e) {}
  try { registerTroopKits(); } catch (e) {}
  try { registerVehicleKits(); } catch (e) {}
}

let bridge = null, canvasEl = null, ctx = null, running = false, dirty = true, labelEvery = 1;

/* Label anchor height above the base, per archetype (world inches). Matches the
   WP3D-1 voxel tables' target heights + a small margin. */
const ARCH_TOP = { titan: 7.2, tank: 2.9, claw: 2.1, steed: 1.7, wing: 1.9, helm: 1.8, shield: 1.6, skull: 1.5 };
function modelTop(tok) {
  const arch = (bridge && bridge.wpvGlyphFor && bridge.wpvGlyphFor(tok.kw || [])) || null;
  return (arch && ARCH_TOP[arch]) || 1.4;
}

function extras(st) {
  const e = {
    labelEvery,
    heightFor: (tok) => (ctx ? ctx.sceneSync.elevationFor(tok) : 0) + modelTop(tok) + 0.4,
  };
  // Ruler getter is a WP3D-5 additive bridge key; older bridge shapes simply show no ruler.
  const rl = bridge.ruler ? bridge.ruler() : null;
  if (rl && rl.x1 != null) {
    e.ruler = { x0: rl.x0, y0: rl.y0, x1: rl.x1, y1: rl.y1, dist: Math.hypot(rl.x1 - rl.x0, rl.y1 - rl.y0) };
  }
  return e;
}

function build() {
  const st = bridge.state();
  const board = st.board || { w: 60, h: 44 };
  const phone = typeof document !== 'undefined' && document.documentElement.classList.contains('phone');
  const tier = wp3dPerfTier({ phone, dpr: (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) });
  labelEvery = tier.labelEvery;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101216'); // matches the app's table-surround tone

  registerPacks();
  const r = createRenderer(THREE, canvasEl, tier);
  const rig = createCameraRig(THREE, canvasEl, board);
  const sceneSync = createSceneSync(THREE, scene, bridge);
  // Environment installs its material factory/decorator BEFORE the first sceneSync tick.
  const env = createEnvironment(THREE, scene, board, tier, r.renderer);

  const wrap = canvasEl.parentElement;
  let labelDiv = document.getElementById('wp3dLabels');
  if (!labelDiv) {
    labelDiv = document.createElement('div');
    labelDiv.id = 'wp3dLabels';
    labelDiv.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;display:none;z-index:3;';
    wrap.appendChild(labelDiv);
  }
  const labels = createLabelLayer(labelDiv, bridge);
  const interaction = createInteraction(canvasEl, bridge, rig, sceneSync);
  const motion = createMotion({ THREE, scene, rig, sceneSync, bridge, canvas: canvasEl, renderer: r.renderer });

  const sizeTo = (w, h) => {
    r.setSize(w, h);
    if (rig.camera) { rig.camera.aspect = w / Math.max(1, h); rig.camera.updateProjectionMatrix(); }
    dirty = true;
  };
  const ro = observeResize(wrap, (w, h) => sizeTo(w, h));
  sizeTo(wrap.clientWidth || 800, wrap.clientHeight || 600);

  const governor = createFpsGovernor(() => {
    // Low-end auto-downgrade (WP3D_DEGRADED_TIER): DPR 1 + label throttle. AA can't be
    // changed on a live context; acceptable per plan.
    try { r.renderer.setPixelRatio(WP3D_DEGRADED_TIER.pixelRatioCap); } catch (e) {}
    labelEvery = WP3D_DEGRADED_TIER.labelEvery;
    dirty = true;
  });

  const loop = createLoop((dtMs) => {
    governor.sample(dtMs);
    rig.update(dtMs);
    const s = bridge.state();
    if (dirty) { sceneSync.tick(s); dirty = false; }
    motion.tick(dtMs, s);
    labels.tick(rig, s, extras(s));
    r.renderer.render(scene, rig.camera);
  });

  // Context loss: pause; on restore, full teardown + rebuild from state (everything is
  // procedural, so a rebuild is just re-running the sync tick against fresh GL resources).
  r.onContextLost(() => { loop.stop(); });
  r.onContextRestored(() => { rebuild(); });

  ctx = { scene, r, rig, sceneSync, labels, interaction, motion, env, loop, ro, labelDiv, governor };
}

function teardown() {
  if (!ctx) return;
  try { ctx.loop.stop(); } catch (e) {}
  try { ctx.motion.dispose(); } catch (e) {}
  try { ctx.env.dispose(); } catch (e) {}
  try { ctx.interaction.dispose(); } catch (e) {}
  try { ctx.labels.dispose(); } catch (e) {}
  try { ctx.sceneSync.dispose(); } catch (e) {}
  try { ctx.ro.disconnect(); } catch (e) {}
  try { ctx.r.dispose(); } catch (e) {}
  ctx = null;
}

function rebuild() {
  const was = running;
  teardown();
  build();
  if (was) start();
}

export function init(canvas, WP3D) {
  bridge = WP3D;
  canvasEl = canvas;
  build();
  start();
}

export function start() {
  if (!ctx) build();
  running = true;
  dirty = true;
  ctx.labelDiv.style.display = 'block';
  window.wp3dOnDraw = () => { dirty = true; };
  ctx.governor.reset();
  ctx.loop.start();
}

export function stop() {
  running = false;
  window.wp3dOnDraw = undefined;
  if (ctx) {
    ctx.loop.stop();
    ctx.labelDiv.style.display = 'none';
  }
}
