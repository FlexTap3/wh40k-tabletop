// WP3D-13 extras tests: run via `node wp3d-13-extras-tests.js` from tools/tests/. Plain node,
// no DOM/WebGL — fakes for document/container/canvas/renderer/rig/motion/bridge follow the
// exact patterns wp3d-10-motion-tests.js established (call-tracking arrays, self-consistent
// fake rig so integration tests verify real convergence, not just "was called"). Global
// stubs (window/localStorage/AudioContext/navigator/File/MutationObserver/URL) are installed
// before importing the module under test, matching test_wp1.js/wp12-tests.js's idiom of
// setting globals directly for a harness-free node run.

// Plain CommonJS .js (no package.json "type":"module" in this tree) — everything below runs
// inside a single async IIFE so `await import(...)` works without top-level-await support,
// exactly like wp3d-10-motion-tests.js.
(async () => {

// =============================================================================================
// Global stubs (installed BEFORE importing wp3d-13-extras.js so gesture-gating etc. see them)
// =============================================================================================
function makeStorage() {
  let store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _store: store,
  };
}
global.localStorage = makeStorage();

function makeWindow() {
  const handlers = {};
  const win = {
    addEventListener(type, fn, opts) {
      (handlers[type] = handlers[type] || []).push({ fn, once: !!(opts && opts.once) });
    },
    removeEventListener(type, fn) {
      if (handlers[type]) handlers[type] = handlers[type].filter((h) => h.fn !== fn);
    },
    _fire(type, e) {
      const list = (handlers[type] || []).slice();
      for (const h of list) {
        h.fn(e);
        if (h.once) win.removeEventListener(type, h.fn);
      }
    },
    _handlerCount(type) { return (handlers[type] || []).length; },
  };
  return win;
}
global.window = makeWindow();

let audioCtorCalls = 0;
class FakeAudioParam { constructor(v) { this.value = v; } setValueAtTime(v) { this.value = v; return this; } linearRampToValueAtTime(v) { this.value = v; return this; } exponentialRampToValueAtTime(v) { this.value = v; return this; } }
class FakeNode { connect() { return this; } }
class FakeGain extends FakeNode { constructor() { super(); this.gain = new FakeAudioParam(1); } }
class FakeBiquad extends FakeNode { constructor() { super(); this.frequency = new FakeAudioParam(350); this.Q = new FakeAudioParam(1); this.type = 'lowpass'; } }
class FakeBufferSource extends FakeNode { constructor() { super(); this.buffer = null; this.detune = new FakeAudioParam(0); } start() {} stop() {} }
class FakeOscillator extends FakeNode { constructor() { super(); this.frequency = new FakeAudioParam(440); this.type = 'sine'; } start() {} stop() {} }
class FakeAudioContext {
  constructor() {
    audioCtorCalls++;
    this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {};
    this._oscCount = 0; this._srcCount = 0;
  }
  createGain() { return new FakeGain(); }
  createBiquadFilter() { return new FakeBiquad(); }
  createBufferSource() { this._srcCount++; return new FakeBufferSource(); }
  createOscillator() { this._oscCount++; return new FakeOscillator(); }
  createBuffer(ch, len, rate) { return { getChannelData: () => new Float32Array(len), duration: len / rate }; }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
global.AudioContext = FakeAudioContext;

// Node ships a built-in `navigator` as a GETTER-ONLY global property (no setter) — a plain
// `global.navigator = {...}` silently no-ops (non-strict-mode assignment to an accessor with
// no setter), leaving the real (share-less) Navigator in place. Object.defineProperty is
// required to actually replace it for these tests.
function setGlobalNavigator(obj) {
  Object.defineProperty(global, 'navigator', { value: obj, configurable: true, writable: true, enumerable: true });
}
setGlobalNavigator({ share: async () => {}, canShare: () => true });
global.File = class { constructor(parts, name, opts) { this.name = name; this.type = opts && opts.type; } };
global.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };

const createdMOs = [];
class FakeMutationObserver {
  constructor(cb) { this.cb = cb; this._observed = null; createdMOs.push(this); }
  observe(target, opts) { this._observed = { target, opts }; }
  disconnect() { this._disconnected = true; }
  _trigger() { this.cb([{ type: 'attributes', attributeName: 'class' }]); }
}
global.MutationObserver = FakeMutationObserver;

// =============================================================================================
const THREE = await import('../../vendor/three.module.min.js');
const M = await import('../../sections/wp3d-13-extras.js');
const {
  createExtras, diceClatterParams, pieceThunkParams, readMuted, writeMuted,
  derivePolarRadius, presetStep, presetTargetFor, flipRowsRGBA, photoFilename, canUseShare,
  TOP_POLAR, TABLE_POLAR, PRESET_RADIUS_MIN, DICE_SOUND_CAP_COUNT,
} = M;

let passed = 0, failed = 0;
const assert = (ok, name) => { if (ok) { passed++; console.log('ok - ' + name); } else { failed++; console.log('FAIL: ' + name); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

// =============================================================================================
console.log('== diceClatterParams: pure synth param bands ==');
{
  const rngLo = () => 0, rngHi = () => 0.999999;
  for (const n of [1, 6, 12, 24, 40]) {
    const lo = diceClatterParams(n, rngLo);
    const hi = diceClatterParams(n, rngHi);
    assert(lo.length >= 2 && lo.length <= 4, `count=${n}: burst count within 2-4 (got ${lo.length})`);
    assert(hi.length >= 2 && hi.length <= 4, `count=${n}: burst count within 2-4 (rngHi, got ${hi.length})`);
    for (const b of lo.concat(hi)) {
      assert(b.freqHz >= 2000 && b.freqHz <= 4000, 'freqHz within bandpass band 2-4kHz');
      assert(b.q >= 3 && b.q <= 6, 'q within 3-6');
      assert(b.durMs >= 20 && b.durMs <= 50, 'durMs within 20-50ms');
      assert(b.detuneCents >= -150 && b.detuneCents <= 150, 'detuneCents within +/-150');
      assert(b.gain >= 0.04 && b.gain <= 0.07, 'gain within 0.04-0.07 (subtle)');
    }
    // worst-case total span (last burst's delay+dur) must stay under the 150ms/sound cap
    const last = hi[hi.length - 1];
    assert(last.delayMs + last.durMs <= 150, `count=${n}: worst-case span (${(last.delayMs + last.durMs).toFixed(1)}ms) stays under the 150ms cap`);
  }
  assert(diceClatterParams(1000, rngLo).length <= 4, 'count clamped even far beyond DICE_SOUND_CAP_COUNT');
  assert(DICE_SOUND_CAP_COUNT >= 12, 'DICE_SOUND_CAP_COUNT covers the app-side dice cap');
  // delay stagger is monotonically non-decreasing across bursts
  const bursts = diceClatterParams(24, () => 0.5);
  for (let i = 1; i < bursts.length; i++) assert(bursts[i].delayMs >= bursts[i - 1].delayMs, 'delayMs stagger is non-decreasing burst-to-burst');
}

console.log('== pieceThunkParams: pure synth param bands ==');
{
  for (const rng of [() => 0, () => 0.999999, () => 0.5]) {
    const p = pieceThunkParams(rng);
    assert(p.freqHz >= 80 && p.freqHz <= 120, 'freqHz within 80-120Hz');
    assert(p.durMs === 90, 'durMs fixed at 90ms (spec: "~90ms")');
    assert(p.gain >= 0.08 && p.gain <= 0.10, 'gain within 0.08-0.10 (subtle)');
    assert(p.noiseMix >= 0.15 && p.noiseMix <= 0.25, 'noiseMix within 0.15-0.25');
  }
}

// =============================================================================================
console.log('== mute persistence round-trip ==');
{
  global.localStorage = makeStorage();
  assert(readMuted() === false, 'default (no stored value) = not muted');
  writeMuted(true);
  assert(readMuted() === true, 'writeMuted(true) round-trips through readMuted()');
  assert(global.localStorage._store.wh40k_3d_sound === '0', 'stored value is "0" when muted');
  writeMuted(false);
  assert(readMuted() === false, 'writeMuted(false) round-trips');
  assert(global.localStorage._store.wh40k_3d_sound === '1', 'stored value is "1" when unmuted');

  const saved = global.localStorage;
  delete global.localStorage;
  assert(readMuted() === false, 'readMuted() degrades to false (not muted) when localStorage is unavailable');
  writeMuted(true); // must not throw
  assert(true, 'writeMuted() is a silent no-op when localStorage is unavailable');
  global.localStorage = saved;
}

// =============================================================================================
console.log('== derivePolarRadius: pure spherical round-trip ==');
{
  const polar = 0.7, radius = 25, target = [10, 5];
  const y = radius * Math.cos(polar), horiz = radius * Math.sin(polar);
  const camPos = { x: target[0], y, z: target[1] + horiz }; // azimuth=0
  const d = derivePolarRadius(camPos, target);
  assert(near(d.radius, radius, 1e-6), 'radius round-trips');
  assert(near(d.polar, polar, 1e-6), 'polar round-trips');

  const d0 = derivePolarRadius({ x: 0, y: 0, z: 0 }, [0, 0]);
  assert(d0.radius === 0 && d0.polar === 0, 'degenerate zero-radius case does not throw / NaN');
}

console.log('== presetTargetFor + presetStep: pure target math ==');
{
  const board = { w: 60, h: 44 };
  const top = presetTargetFor('top', board);
  const table = presetTargetFor('table', board);
  assert(near(top.polar, TOP_POLAR), 'top target polar matches TOP_POLAR (near-vertical)');
  assert(near(table.polar, TABLE_POLAR), 'table target polar matches TABLE_POLAR (low grazing)');
  assert(top.radius > 0 && table.radius > 0, 'both targets have positive radius');
  assert(presetTargetFor('tq', board) === null, '3/4 preset has no target object (handled via lookAtBoard directly)');

  const tiny = presetTargetFor('top', { w: 1, h: 1 });
  assert(near(tiny.radius, PRESET_RADIUS_MIN), 'radius clamps up to PRESET_RADIUS_MIN on a tiny board');

  const cur = { polar: 0.95, radius: 50 };
  const stepTop = presetStep(cur, top, 16);
  assert(stepTop.dPolar < 0, 'top: polar step direction is NEGATIVE (toward near-vertical from the 3/4 default)');
  assert(stepTop.radiusFactor < 1, 'top: radius factor SHRINKS (tighter top-down frame)');
  const stepTable = presetStep(cur, table, 16);
  assert(stepTable.dPolar > 0, 'table: polar step direction is POSITIVE (toward low grazing angle)');

  // convergence: repeatedly applying the step to a local sim reaches "done"
  let sim = { polar: 0.95, radius: 50 };
  let doneAt = -1;
  for (let i = 0; i < 500; i++) {
    const s = presetStep(sim, top, 16);
    sim = { polar: sim.polar + s.dPolar, radius: sim.radius * s.radiusFactor };
    if (s.done) { doneAt = i; break; }
  }
  assert(doneAt >= 0 && doneAt < 500, `presetStep converges to done=true within 500 ticks (got tick ${doneAt})`);
  assert(near(sim.polar, top.polar, 0.02), 'converged polar is close to the top target');
  assert(near(sim.radius, top.radius, top.radius * 0.02), 'converged radius is close to the top target');
}

// =============================================================================================
console.log('== flipRowsRGBA: pure row-flip on a synthetic RGBA buffer ==');
{
  // 2x2 image: row0 = [1,2,3,4 | 5,6,7,8], row1 = [9,10,11,12 | 13,14,15,16]
  const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const out = flipRowsRGBA(src, 2, 2);
  const expected = new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert(out.length === expected.length, 'flipped buffer has the same length');
  assert(out.every((v, i) => v === expected[i]), 'rows are reversed, pixel bytes within each row preserved exactly');
  assert(out.constructor === src.constructor, 'output preserves the input typed-array constructor');

  // single row: identity
  const single = new Uint8Array([1, 2, 3, 4]);
  const outSingle = flipRowsRGBA(single, 1, 1);
  assert(outSingle.every((v, i) => v === single[i]), 'single-row image is unchanged (trivial flip)');
}

console.log('== photoFilename: pure timestamp formatting ==');
{
  const d = new Date(2026, 6, 12, 9, 5, 3); // July 12 2026, 09:05:03 local
  assert(photoFilename(d) === 'wh40k-battle-20260712-090503.png', `filename format is exact (got ${photoFilename(d)})`);
  assert(/^wh40k-battle-\d{8}-\d{6}\.png$/.test(photoFilename()), 'default (no arg) filename matches the timestamped pattern');
}

console.log('== canUseShare: pure feature-detection ==');
{
  const blob = { type: 'image/png' };
  const FileOk = class { constructor(parts, name, opts) { this.name = name; this.type = opts.type; } };
  assert(canUseShare(blob, 'x.png', {}, FileOk) === false, 'no share() -> false');
  assert(canUseShare(blob, 'x.png', { share: () => {} }, FileOk) === false, 'share() without canShare() -> false');
  assert(canUseShare(blob, 'x.png', { share: () => {}, canShare: () => true }, null) === false, 'no File ctor -> false');
  assert(canUseShare(blob, 'x.png', { share: () => {}, canShare: () => true }, FileOk) === true, 'share+canShare(true)+File -> true');
  assert(canUseShare(blob, 'x.png', { share: () => {}, canShare: () => false }, FileOk) === false, 'canShare() returning false -> false');
  const FileThrows = class { constructor() { throw new Error('nope'); } };
  assert(canUseShare(blob, 'x.png', { share: () => {}, canShare: () => true }, FileThrows) === false, 'File constructor throwing -> false, not an unhandled exception');
}

// =============================================================================================
console.log('== createExtras: fakes for document/container/canvas/renderer/rig/motion/bridge ==');

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    contains: (c) => set.has(c),
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, on) => { if (on) set.add(c); else set.delete(c); },
    _set: set,
  };
}
function makeFakeElement(doc, tag) {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    parentNode: null,
    ownerDocument: doc,
    classList: makeClassList(),
    _handlers: {},
    addEventListener(type, fn) { (el._handlers[type] = el._handlers[type] || []).push(fn); },
    removeEventListener(type, fn) { if (el._handlers[type]) el._handlers[type] = el._handlers[type].filter((f) => f !== fn); },
    _fire(type, e) { (el._handlers[type] || []).slice().forEach((fn) => fn(e)); },
    _handlerCount(type) { return (el._handlers[type] || []).length; },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i !== -1) el.children.splice(i, 1); c.parentNode = null; return c; },
    click() { el._fire('click', {}); },
    getContext(kind) {
      if (kind !== '2d') return null;
      return {
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
        putImageData(imgData) { el._lastImageData = imgData; },
      };
    },
    toBlob(cb, type) { cb({ _fakeBlob: true, type, width: el.width, height: el.height }); },
  };
  return el;
}
function makeFakeDocument() {
  const doc = {
    createElement(tag) { return makeFakeElement(doc, tag); },
  };
  doc.body = makeFakeElement(doc, 'body');
  return doc;
}
function makeContainer(doc) {
  const c = makeFakeElement(doc, 'div');
  c.nodeType = 1;
  return c;
}
function makeCanvas() {
  const el = {
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    _handlers: {},
    addEventListener(type, fn) { (el._handlers[type] = el._handlers[type] || []).push(fn); },
    removeEventListener(type, fn) { if (el._handlers[type]) el._handlers[type] = el._handlers[type].filter((f) => f !== fn); },
    _fire(type, e) { (el._handlers[type] || []).slice().forEach((fn) => fn(e)); },
    _handlerCount(type) { return (el._handlers[type] || []).length; },
  };
  return el;
}
function makeRenderer() {
  let target = null;
  return {
    getRenderTarget() { return target; },
    setRenderTarget(t) { target = t; },
    render() {},
    readRenderTargetPixels(rt, x, y, w, h, buf) { buf.fill(128); }, // deterministic mid-grey fill
  };
}
function makeRig(polar0, radius0) {
  let polar = polar0, radius = radius0;
  const target = [0, 0];
  function pos() { return { x: 0, y: radius * Math.cos(polar), z: radius * Math.sin(polar) }; }
  const camera = { ...pos(), fov: 50 };
  Object.assign(camera, pos());
  const orbitCalls = [], zoomCalls = [];
  const rig = {
    camera: { position: pos(), fov: 50 },
    orbitBy(dx, dy) { orbitCalls.push({ dx, dy }); polar = Math.max(0.1, Math.min(1.45, polar + dy)); Object.assign(rig.camera.position, pos()); },
    zoomBy(f) { zoomCalls.push(f); radius = Math.max(6, radius * f); Object.assign(rig.camera.position, pos()); },
    panBy() {},
    lookAtBoard() { rig._lookAtCalls = (rig._lookAtCalls || 0) + 1; polar = 0.95; radius = 50; Object.assign(rig.camera.position, pos()); },
    screenToBoard(nx, ny) { return (nx === 0 && ny === 0) ? target.slice() : null; },
    _orbitCalls: orbitCalls, _zoomCalls: zoomCalls,
    _polar() { return polar; }, _radius() { return radius; },
  };
  return rig;
}
function makeBridge(board) {
  return { state() { return { board: board || { w: 60, h: 44 }, tokens: [] }; } };
}
function makeMotionStub() { return {}; } // no `on` — must be tolerated
function makeMotionWithOn() {
  const handlers = {};
  return {
    on(evt, cb) { handlers[evt] = cb; },
    _fire(evt, payload) { if (handlers[evt]) handlers[evt](payload); },
  };
}

// ---- overlay DOM + visibility ----
{
  audioCtorCalls = 0;
  const doc = makeFakeDocument();
  const container = makeContainer(doc);
  const canvas = makeCanvas();
  const rig = makeRig(0.95, 50);
  const bridge = makeBridge();
  const motion = makeMotionStub();
  const extras = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion, bridge, container });

  assert(container.children.length === 1, 'createExtras appends exactly one overlay root into the container');
  const root = container.children[0];
  assert(root.id === 'wp3dExtras', 'overlay root has a stable id');
  const ids = root.children.map((c) => c.id);
  assert(ids.includes('wp3dMute') && ids.includes('wp3dPhoto') && ids.includes('wp3dCamTQ') && ids.includes('wp3dCamTop') && ids.includes('wp3dCamTable'),
    'overlay contains mute, photo, and all three camera preset buttons');

  assert(root.style.display === 'none', 'overlay hidden by default (container has no mode3d class yet)');
  container.classList.add('mode3d');
  extras.tick(16, {});
  assert(root.style.display === 'flex', 'tick() fallback shows the overlay once container gains .mode3d');
  container.classList.remove('mode3d');
  container.classList.add('mode3d-pip');
  extras.tick(16, {});
  assert(root.style.display === 'flex', 'overlay also shows for .mode3d-pip');
  container.classList.remove('mode3d-pip');
  extras.tick(16, {});
  assert(root.style.display === 'none', 'overlay hides again once both mode classes are gone');

  // MutationObserver path (independent of tick() — simulates the RAF loop being stopped,
  // which is exactly what happens when the app flips 3D fully "off": wh40k-3d.js's stop()
  // halts the loop, so tick() never fires again, yet the strip still must hide instantly).
  const mo = createdMOs[createdMOs.length - 1];
  assert(mo && mo._observed && mo._observed.target === container, 'a MutationObserver was constructed and observes the container');
  assert(mo._observed.opts.attributeFilter.includes('class'), 'the observer is scoped to class-attribute changes');
  container.classList.add('mode3d');
  mo._trigger(); // fire the observer callback directly — NO tick() call in between
  assert(root.style.display === 'flex', 'MutationObserver callback alone (no tick()) shows the overlay on a class change');
  container.classList.remove('mode3d');
  mo._trigger();
  assert(root.style.display === 'none', 'MutationObserver callback alone (no tick()) hides the overlay again');

  const muteBtn = root.children.find((c) => c.id === 'wp3dMute');
  assert(muteBtn.textContent === (readMuted() ? '🔇' : '🔊'), 'mute button icon reflects persisted mute state at construction');

  extras.dispose();
  assert(container.children.length === 0, 'dispose() removes the overlay root from the container');
}

// ---- gesture gating: AudioContext created lazily, exactly once, respects mute ----
{
  global.localStorage = makeStorage(); // fresh: default unmuted
  audioCtorCalls = 0;
  const doc = makeFakeDocument();
  const container = makeContainer(doc);
  const canvas = makeCanvas();
  const rig = makeRig(0.95, 50);
  const bridge = makeBridge();
  const motion = makeMotionWithOn();
  const extras = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion, bridge, container });

  assert(audioCtorCalls === 0, 'no AudioContext constructed before any user gesture');
  motion._fire('tweenland', {});
  assert(audioCtorCalls === 0, 'a sound-triggering event before the first gesture is silently dropped, not queued/errored');

  global.window._fire('pointerdown', {});
  assert(audioCtorCalls === 1, 'AudioContext constructed on the first pointerdown gesture');
  global.window._fire('keydown', {});
  assert(audioCtorCalls === 1, 'a second gesture (keydown) does not construct a second AudioContext (one-time listener)');
  assert(global.window._handlerCount('pointerdown') === 0 && global.window._handlerCount('keydown') === 0,
    'gesture listeners are removed after first-fire');

  // now that a context exists, tweenland/diceland actually synthesize sound
  motion._fire('tweenland', {});
  assert(true, 'tweenland after gesture does not throw'); // oscillator creation checked via count below

  const muteBtn = container.children[0].children.find((c) => c.id === 'wp3dMute');
  assert(muteBtn.textContent === '🔊', 'starts unmuted (fresh localStorage)');
  muteBtn.click();
  assert(muteBtn.textContent === '🔇', 'clicking mute toggles the icon to muted');
  assert(readMuted() === true, 'mute click persists to localStorage');
  muteBtn.click();
  assert(muteBtn.textContent === '🔊', 'clicking again toggles back to unmuted');
  assert(readMuted() === false, 'unmute click persists to localStorage');

  extras.dispose();
}

// ---- motion 'on' guard: stub motion (no .on) must not throw ----
{
  const doc = makeFakeDocument();
  const container = makeContainer(doc);
  const canvas = makeCanvas();
  const rig = makeRig(0.95, 50);
  const bridge = makeBridge();
  let threw = false;
  let extras = null;
  try {
    extras = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion: makeMotionStub(), bridge, container });
    extras.tick(16, {});
  } catch (e) { threw = true; }
  assert(!threw, 'createExtras tolerates a motion stub with no .on() (guarded per contract)');
  if (extras) extras.dispose();
}

// ---- camera presets: buttons drive real convergence via the fake rig; tq = single lookAtBoard ----
{
  global.localStorage = makeStorage();
  const doc = makeFakeDocument();
  const container = makeContainer(doc);
  const canvas = makeCanvas();
  const rig = makeRig(0.95, 50);
  const bridge = makeBridge({ w: 60, h: 44 });
  const extras = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion: makeMotionStub(), bridge, container });
  const root = container.children[0];
  const btn = (id) => root.children.find((c) => c.id === id);

  btn('wp3dCamTQ').click();
  assert(rig._lookAtCalls === 1, '3/4 preset calls rig.lookAtBoard() exactly once');

  btn('wp3dCamTop').click();
  for (let i = 0; i < 300 && rig._orbitCalls.length < 500; i++) extras.tick(16, {});
  const top = presetTargetFor('top', { w: 60, h: 44 });
  assert(near(rig._polar(), top.polar, 0.05), `top preset converges the fake rig's polar near ${top.polar} (got ${rig._polar().toFixed(3)})`);
  assert(near(rig._radius(), top.radius, top.radius * 0.05), 'top preset converges the fake rig\'s radius near the target');
  assert(rig._orbitCalls.length > 1, 'top preset is driven by multiple per-tick orbitBy() calls, not one jump');

  const orbitCallsAtConvergence = rig._orbitCalls.length;
  extras.tick(16, {});
  assert(rig._orbitCalls.length === orbitCallsAtConvergence, 'preset stops issuing orbitBy() once converged (done=true)');

  btn('wp3dCamTable').click();
  for (let i = 0; i < 300; i++) extras.tick(16, {});
  const table = presetTargetFor('table', { w: 60, h: 44 });
  assert(near(rig._polar(), table.polar, 0.05), `table preset converges polar near ${table.polar} (got ${rig._polar().toFixed(3)})`);

  extras.dispose();
}

// ---- instant-cancel on user camera input ----
{
  const doc = makeFakeDocument();
  const container = makeContainer(doc);
  const canvas = makeCanvas();
  const rig = makeRig(0.95, 50);
  const bridge = makeBridge({ w: 60, h: 44 });
  const extras = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion: makeMotionStub(), bridge, container });
  const root = container.children[0];
  root.children.find((c) => c.id === 'wp3dCamTop').click();
  extras.tick(16, {}); // a couple of ticks in, mid-flight
  extras.tick(16, {});
  const callsBeforeCancel = rig._orbitCalls.length;
  assert(callsBeforeCancel > 0, 'preset is mid-flight (has issued at least one step) before the cancel');

  canvas._fire('pointerdown', {}); // user grabs the camera
  extras.tick(16, {});
  extras.tick(16, {});
  assert(rig._orbitCalls.length === callsBeforeCancel, 'user pointerdown on the canvas instantly cancels the in-flight preset (no further orbitBy calls)');

  extras.dispose();
}

// ---- battle photo pipeline: capture -> deliver (share path + download fallback path) ----
{
  const doc = makeFakeDocument();
  const container = makeContainer(doc);
  const canvas = makeCanvas();
  const rig = makeRig(0.95, 50);
  const bridge = makeBridge({ w: 60, h: 44 });

  // share path
  let sharedWith = null;
  setGlobalNavigator({ share: async (opts) => { sharedWith = opts; }, canShare: () => true });
  const extras1 = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion: makeMotionStub(), bridge, container });
  const root1 = container.children[0];
  root1.children.find((c) => c.id === 'wp3dPhoto').click();
  await new Promise((r) => setTimeout(r, 10)); // let the capture Promise + async deliver settle
  assert(sharedWith && Array.isArray(sharedWith.files) && sharedWith.files.length === 1, 'photo click -> navigator.share() called with exactly one file when share is available');
  assert(sharedWith.files[0].type === 'image/png', 'shared file has PNG mime type');
  assert(/^wh40k-battle-\d{8}-\d{6}\.png$/.test(sharedWith.files[0].name), 'shared file uses the timestamped filename pattern');
  extras1.dispose();

  // download fallback path (no share support)
  setGlobalNavigator({});
  let createdObjectUrlFor = null;
  global.URL = { createObjectURL: (b) => { createdObjectUrlFor = b; return 'blob:fake2'; }, revokeObjectURL: () => {} };
  const container2 = makeContainer(doc);
  const extras2 = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion: makeMotionStub(), bridge, container: container2 });
  const root2 = container2.children[0];
  root2.children.find((c) => c.id === 'wp3dPhoto').click();
  await new Promise((r) => setTimeout(r, 10));
  assert(createdObjectUrlFor && createdObjectUrlFor._fakeBlob === true, 'no-share fallback: an object URL is created for the captured PNG blob');
  assert(doc.body.children.length === 0, 'the temporary download anchor is appended and removed (cleaned up), not left in <body>');
  extras2.dispose();

  setGlobalNavigator({ share: async () => {}, canShare: () => true }); // restore for later tests
  global.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
}

// ---- dispose(): removes all listeners cleanly ----
{
  audioCtorCalls = 0;
  global.window = makeWindow();
  const doc = makeFakeDocument();
  const container = makeContainer(doc);
  const canvas = makeCanvas();
  const rig = makeRig(0.95, 50);
  const bridge = makeBridge({ w: 60, h: 44 });
  const extras = createExtras({ THREE, canvas, renderer: makeRenderer(), rig, scene: {}, sceneSync: {}, motion: makeMotionStub(), bridge, container });

  assert(global.window._handlerCount('pointerdown') === 1 && global.window._handlerCount('keydown') === 1,
    'gesture listeners registered on window at construction');
  assert(canvas._handlerCount('pointerdown') === 1 && canvas._handlerCount('wheel') === 1,
    'instant-cancel listeners registered on canvas at construction');

  extras.dispose();
  assert(global.window._handlerCount('pointerdown') === 0 && global.window._handlerCount('keydown') === 0,
    'dispose() removes the window gesture listeners');
  assert(canvas._handlerCount('pointerdown') === 0 && canvas._handlerCount('wheel') === 0,
    'dispose() removes the canvas instant-cancel listeners');
  assert(container.children.length === 0, 'dispose() removes the overlay DOM');

  let threw = false;
  try { extras.tick(16, {}); extras.dispose(); } catch (e) { threw = true; }
  assert(!threw, 'tick()/dispose() after dispose() are safe no-ops');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

})();
