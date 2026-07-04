// WP1 simulation: run the WP1 section from the extracted app.js with a DOM/net stub.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
const start = src.indexOf("/* ==== WP1: resilience — autosave");
const end = src.indexOf("/* ==== end WP1 ==== */", start);
if (start < 0 || end < 0) { console.error("WP1 block not found"); process.exit(1); }
const wp1 = src.slice(start, end);

// ---- stubs ----
const store = {}; let writes = 0;
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); writes++; },
  removeItem: k => { delete store[k]; },
};
global.document = { getElementById: () => null };
global.window = { addEventListener: () => {} };
global.confirm = () => true;
let state = { board:{w:60,h:44}, tokens:[], terrain:[], objectives:[], dz:[], sec:[], mission:null,
  trackers:{round:1,cp1:0,cp2:0,vp1:0,vp2:0}, names:{1:"P1",2:"P2"}, cards:{1:[],2:[]} };
let mySide = 1, myName = "Tester", conn = null, peer = null, isHost = false;
const sel = new Set();
const logs = []; const logSys = s => logs.push(s); const logShared = s => logs.push(s);
const esc = s => String(s);
const sent = [];
const setConn = () => {}; const refreshTrackers = () => {}; const renderCards = () => {};
const fitView = () => {}; const draw = () => {};
function hostGame(){} function wireConn(){}

// minimal applyOp mirroring the app's structure (restore case + autosave at end)
function applyOp(o, mine) {
  switch (o.k) {
    case "tok+": o.toks.forEach(t => state.tokens.push(t)); break;
    case "tok~": o.toks.forEach(u => { const t = state.tokens.find(x => x.id === u.id); if (t) Object.assign(t, u); }); break;
    case "tok-": o.ids.forEach(id => { const i = state.tokens.findIndex(x => x.id === id); if (i >= 0) state.tokens.splice(i, 1); }); break;
    case "restore": wp1ApplyRestore(o.state); break;
  }
  if (mine) sent.push(o);
  draw();
  wp1Autosave();
}
function op(o) { wp1Snapshot(); applyOp(o, true); }

eval(wp1 + ";global.__wp1={get stack(){return wp1UndoStack;},get pending(){return wp1Pending;}};"); // brings wp1* into scope

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(name, cond) { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) fails++; }

(async () => {
  // 1. wp1Compat fills defaults on a bare/legacy state
  const c = wp1Compat({ tokens: [{ id: "a" }] });
  check("compat: trackers/names/cards/sec defaulted",
    c.trackers.round === 1 && c.names[1] === "Player 1" && Array.isArray(c.cards[1]) && Array.isArray(c.sec) && c.board.w === 60);
  check("compat: existing fields preserved", wp1Compat({ trackers: { round: 3 } }).trackers.round === 3 && wp1Compat({}).trackers.cp1 === 0);

  // 2. autosave debounce: many ops -> exactly one localStorage write
  writes = 0;
  for (let i = 0; i < 20; i++) op({ k: "tok+", toks: [{ id: "t" + i, x: i, y: 0, owner: 1, unit: "u1" }] });
  check("autosave: no synchronous write", writes === 0);
  await sleep(600);
  check("autosave: exactly one debounced write after burst", writes === 1);
  const saved = JSON.parse(store["wh40k_autosave"]);
  check("autosave: payload has v/ts/side/state", saved.v === 1 && saved.side === 1 && saved.state.tokens.length === 20);

  // 3. undo: burst above = one snapshot? (all 20 ops in same... no — each op in its own iteration but same tick)
  check("undo: same-tick burst coalesced to 1 snapshot", __wp1.stack.length === 1);

  // 4. separate-tick ops = separate snapshots; ring buffer caps at 30
  for (let i = 0; i < 40; i++) { op({ k: "tok~", toks: [{ id: "t0", x: 100 + i }] }); await sleep(2); }
  check("undo: ring buffer capped at 30", __wp1.stack.length === 30);

  // 5. undo restores previous snapshot and broadcasts restore op
  const beforeX = JSON.parse(__wp1.stack[__wp1.stack.length - 1]).tokens.find(t => t.id === "t0").x;
  sent.length = 0;
  wp1Undo();
  check("undo: state reverted to prior snapshot", state.tokens.find(t => t.id === "t0").x === beforeX);
  check("undo: broadcast a restore op", sent.length === 1 && sent[0].k === "restore");
  check("undo: restore did not push a new snapshot", __wp1.stack.length === 29);

  // 6. pre-gesture snapshot: mutate directly (drag), then op — undo returns to pre-drag position
  await sleep(5);
  const t0 = state.tokens.find(t => t.id === "t0");
  const preX = t0.x;
  wp1PreMutate();                 // mousedown
  t0.x += 7.5;                    // direct drag mutation
  op({ k: "tok~", toks: [{ id: "t0", x: t0.x }] });  // mouseup op
  await sleep(5);
  wp1Undo();
  check("undo: drag undone to pre-gesture position", state.tokens.find(t => t.id === "t0").x === preX);

  // 7. restore idempotent: applying same restore twice converges to same state
  const snap = JSON.stringify(state);
  applyOp({ k: "restore", state: JSON.parse(snap) }, false);
  const once = JSON.stringify(state);
  applyOp({ k: "restore", state: JSON.parse(snap) }, false);
  check("restore: idempotent", JSON.stringify(state) === once);

  // 8. remote op invalidates a stale pending pre-gesture snapshot
  wp1PreMutate();
  applyOp({ k: "tok~", toks: [{ id: "t0", x: 55 }] }, false); // remote op -> autosave -> pending cleared
  check("pending cleared by applied op", __wp1.pending === null);

  // 9. room persistence + host code reuse
  wp1SaveRoom("wh40k-abc12", true);
  check("room: host code reused", wp1HostCode() === "wh40k-abc12");
  store["wh40k_room"] = JSON.stringify({ code: "wh40k-old00", host: true, ts: Date.now() - 13 * 36e5 });
  check("room: stale (>12h) code not reused", wp1HostCode() !== "wh40k-old00");
  wp1PeerError({ type: "unavailable-id" });
  check("room: cleared on unavailable-id", !store["wh40k_room"]);

  // 10. resume: non-trivial autosave restores state
  await sleep(600); // flush any pending autosave
  store["wh40k_autosave"] = JSON.stringify({ v: 1, ts: Date.now() - 90000, side: 2, state: { tokens: [{ id: "z", x: 1, y: 1 }], terrain: [], trackers: { round: 4 } } });
  state = wp1Compat({});
  wp1MaybeResume();
  check("resume: state restored + compat applied", state.tokens.length === 1 && state.trackers.round === 4 && state.trackers.cp1 === 0 && Array.isArray(state.cards[1]));
  check("resume: side restored", mySide === 2);

  // 11. resume declined -> autosave moved to backup key
  global.confirm = () => false;
  store["wh40k_autosave"] = JSON.stringify({ v: 1, ts: Date.now(), side: 1, state: { tokens: [{ id: "q" }] } });
  wp1MaybeResume();
  check("resume declined: key cleared, backup kept", !store["wh40k_autosave"] && !!store["wh40k_autosave_prev"]);

  // 12. trivial autosave (empty board) -> no prompt
  global.confirm = () => { throw new Error("should not prompt"); };
  store["wh40k_autosave"] = JSON.stringify({ v: 1, ts: Date.now(), side: 1, state: { tokens: [], terrain: [], sec: [] } });
  wp1MaybeResume();
  check("resume: trivial autosave skipped", true);

  console.log(fails ? "\n" + fails + " FAILURES" : "\nALL WP1 TESTS PASSED");
  process.exit(fails ? 1 : 0);
})();
