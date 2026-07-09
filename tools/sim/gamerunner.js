// gamerunner.js — plays ONE complete 2000-pt WH40k game headless and emits artifacts.
//
// Architecture (mirrors tools/tests/harness.js): the whole single-file app is loaded under
// Node with DOM stubs, then the sim sources (challenger + auditor + driver) are concatenated
// into the SAME eval scope so they can read the app's `let`-scoped globals (state, mySide, …)
// and call its own mutation paths (op, aiTryTranslate, aiFireWeapon, wp7Step, …).
//
// The built-in AI only ever plays side 2 (it gates on state.phase.side===2 / t.owner===2), so
// side 1 is driven by challenger.js. Determinism: aiSeed(seed) + Math.random=mulberry32(seed).
//
// Usage:
//   node gamerunner.js [--seed N] [--layout "Official 1A ..."] [--sideA AS] [--sideB TAU]
//                      [--pts 2000] [--game 0] [--out <dir>] [--tier N]
//
// Emits into <out>: game-NN.jsonl, game-NN.md, game-NN.summary.json, and appends findings.jsonl.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HTML = path.join(ROOT, "wh40k-tabletop.html");

// ---- args ----
function parseArgs(argv) {
  const a = { seed: 1, layout: "Official 1A", sideA: "AS", sideB: "TAU", pts: 2000, game: 0, tier: "N", out: path.join(__dirname, "out") };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--seed") { a.seed = +v; i++; }
    else if (k === "--layout") { a.layout = v; i++; }
    else if (k === "--sideA") { a.sideA = v; i++; }
    else if (k === "--sideB") { a.sideB = v; i++; }
    else if (k === "--pts") { a.pts = +v; i++; }
    else if (k === "--game") { a.game = +v; i++; }
    else if (k === "--tier") { a.tier = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
  }
  return a;
}
const CONFIG = parseArgs(process.argv);
CONFIG.gameId = String(CONFIG.game).padStart(2, "0");
fs.mkdirSync(CONFIG.out, { recursive: true });

// ---- read the app + resolve the two embedded JSON blobs + the app script body ----
const html = fs.readFileSync(HTML, "utf8");
const grab = id => html.match(new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>'))[1];
const dbJson = grab("db40k-data"), layoutsJson = grab("layouts40k-data");
const start = html.lastIndexOf("<script>");
const appCode = html.slice(start + 8, html.indexOf("</script>", start));

// ---- DOM stubs (verbatim shape from tools/tests/harness.js so the app boots identically) ----
function makeEl(id) {
  const el = {
    id, value: "", checked: false, textContent: "", innerHTML: "", tagName: "DIV",
    style: {}, dataset: {}, children: [], scrollTop: 0, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); }, removeChild() {}, click() {},
    addEventListener() {}, showModal() {}, close() {},
    getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; },
    insertAdjacentHTML() {}, setPointerCapture() {}, releasePointerCapture() {},
    parentNode: { insertBefore() {}, appendChild() {}, removeChild() {} },
  };
  if (id === "db40k-data") el.textContent = dbJson;
  if (id === "layouts40k-data") el.textContent = layoutsJson;
  if (id === "board") {
    el.width = 800; el.height = 600;
    el.parentElement = { getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; } };
    el.getContext = () => ctxStub;
    el.handlers = {};
    el.addEventListener = (t, f) => { el.handlers[t] = e => f(Object.assign({ preventDefault() {}, stopPropagation() {}, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, clientX: e && e.offsetX || 0, clientY: e && e.offsetY || 0 }, e)); };
  }
  return el;
}
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === "measureText") return () => ({ width: 10 });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
const els = {};
global.els = els;
global.document = {
  head: { insertAdjacentHTML() {}, appendChild() {} },
  getElementById: id => els[id] || (els[id] = makeEl(id)),
  createElement: tag => makeEl("_" + tag + Math.random()),
  querySelectorAll: () => [],
};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.navigator = {};
global.devicePixelRatio = 1;
global.winHandlers = {};
global.window = {
  addEventListener: (t, f) => {
    const wrapped = e => f(Object.assign({ preventDefault() {}, stopPropagation() {}, pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, ctrlKey: false, metaKey: false }, e));
    const prev = global.winHandlers[t];
    global.winHandlers[t] = prev ? (e => { prev(e); wrapped(e); }) : wrapped;
  }, open() {}
};
global.alert = () => {}; global.confirm = () => true; global.prompt = () => "1";
global.Peer = function () { this.on = () => {}; this.connect = () => ({ on() {} }); };
global.URL = global.URL || { createObjectURL: () => "" };
global.Blob = global.Blob || function () {};

// ---- shared handle the eval'd sim sources reach Node through ----
global.SIM = { fs, path, config: CONFIG, out: CONFIG.out };

// ---- concatenate app + sim sources into one eval scope ----
const challengerSrc = fs.readFileSync(path.join(__dirname, "challenger.js"), "utf8");
const auditorSrc = fs.readFileSync(path.join(__dirname, "auditor.js"), "utf8");
const driverSrc = fs.readFileSync(path.join(__dirname, "driver.js"), "utf8");

// driver.js ends by calling simRun(); everything runs in this one eval scope.
eval(appCode + "\n" + challengerSrc + "\n" + auditorSrc + "\n" + driverSrc);
