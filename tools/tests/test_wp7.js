// WP7 simulation: phase engine CP grants, reserves legality + round-trip, attach/detach, old-save compat.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
const start = src.indexOf("/* ==== WP7: phases — turn/phase engine");
const end = src.indexOf("/* ==== end WP7 ==== */", start);
if (start < 0 || end < 0) { console.error("WP7 block not found"); process.exit(1); }
let wp7 = src.slice(start, end);
// strip browser-only wiring (keydown listener) — we test the engine/logic functions
wp7 = wp7.replace(/window\.addEventListener\([\s\S]*?\n\}\);/g, "");

// ---- stubs (mirror the app's helpers the block leans on) ----
global.document = { getElementById: () => null };
const mmIn = mm => mm / 25.4;
const tokRadius = t => t.shape === "c" ? mmIn(t.dmm) / 2 : Math.min(t.wIn, t.hIn) / 2;
const edgeDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) - tokRadius(a) - tokRadius(b);
const tokKw = t => (t.kw || []).map(k => String(k).toUpperCase());
let state = { board: {w:60,h:44}, tokens: [], dz: [], names: {1:"Red",2:"Blue"},
  trackers: {round:1,cp1:0,cp2:0,vp1:0,vp2:0}, reserves: {1:[],2:[]}, phase: {side:1,ph:-1,cpDone:{}} };
let mySide = 1, myName = "T", tool = "select";
const cv = { style: {} };
const sel = new Set(); const logs = [];
const logSys = h => logs.push(String(h)); const logShared = h => logs.push(String(h));
const esc = s => String(s);
const refreshTrackers = () => {}; const draw = () => {};
const wp3CardFor = () => null; const wp3Hide = () => {};
const px = (x,y)=>[x,y]; const view = {s:14};
const ctx = new Proxy({}, { get: () => () => 0, set: () => true });
const applied = [];
function op(o) {
  applied.push(o);
  switch (o.k) {
    case "phase": wp7ApplyPhase(o); break;
    case "rsv+": { const L = state.reserves[o.res.owner] || (state.reserves[o.res.owner] = []);
      const i = L.findIndex(r => r.id === o.res.id); if (i >= 0) L[i] = o.res; else L.push(o.res); } break;
    case "rsv-": [1,2].forEach(s => { const L = state.reserves[s] || []; const i = L.findIndex(r => r.id === o.id); if (i >= 0) L.splice(i, 1); }); break;
    case "tok+": o.toks.forEach(t => state.tokens.push(t)); break;
    case "tok-": o.ids.forEach(id => { const i = state.tokens.findIndex(t => t.id === id); if (i >= 0) state.tokens.splice(i, 1); }); break;
    case "tok~": o.toks.forEach(u => { const t = state.tokens.find(x => x.id === u.id); if (t) Object.assign(t, u); }); break;
  }
}

eval(wp7);

let fails = 0;
const check = (n, c) => { console.log((c ? "PASS" : "FAIL") + "  " + n); if (!c) fails++; };

// ---- 1. CP ticks once per Command phase across a full 5-round loop ----
for (let i = 0; i < 60; i++) wp7Step(1); // Deploy -> 5 rounds x 2 sides x 6 phases
check("5-round loop: round tracker reaches 5", state.trackers.round === 5);
check("5-round loop: ends at End phase, player 2", state.phase.ph === 5 && state.phase.side === 2);
check("CP ticked exactly once per Command phase (10 each)", state.trackers.cp1 === 10 && state.trackers.cp2 === 10);
// wobble back and forth across a Command boundary — no double grant
for (let i = 0; i < 5; i++) wp7Step(-1);  // End r5s2 -> back to Command r5 s2
check("stepped back to Command r5s2", state.phase.ph === 0 && state.phase.side === 2 && state.trackers.round === 5);
wp7Step(-1); wp7Step(1);                   // End r5s1 -> Command r5s2 again
check("re-entering a Command phase grants no extra CP", state.trackers.cp1 === 10 && state.trackers.cp2 === 10);
wp7Step(-1); wp7Step(-1);                  // -> End r5s1 -> Fight r5s1
check("stepping back before round 5 s1 Command decrements round", (() => {
  for (let i = 0; i < 4; i++) wp7Step(-1); // Fight r5s1 -> Command r5s1
  wp7Step(-1);                             // -> End r4 s2
  return state.trackers.round === 4 && state.phase.ph === 5 && state.phase.side === 2;
})());
check("manual CP override still works alongside the stepper", (() => {
  state.trackers.cp1 += 3; return state.trackers.cp1 === 13; })());

// ---- 2. reserves arrival legality (deep strike 7.5" reject / 8.5" accept) ----
const T0 = (x, y) => ({ x, y, shape: "c", dmm: 0 });   // dmm 0 => radius 0 => centre distance = edge distance
const enemy = [T0(30, 22)];
const B = { w: 60, h: 44 };
check("DS at 7.5\" from an enemy rejected", wp7ArriveIllegal([T0(37.5, 22)], true, 2, B, null, enemy) !== null);
check("DS at 8.5\" from an enemy accepted", wp7ArriveIllegal([T0(38.5, 22)], true, 2, B, null, enemy) === null);
check("no arrivals in round 1", wp7ArriveIllegal([T0(38.5, 22)], true, 1, B, null, enemy) !== null);
check("strategic: within 6\" of an edge ok", wp7ArriveIllegal([T0(3, 22)], false, 2, B, null, enemy) === null);
check("strategic: mid-board rejected without DS", wp7ArriveIllegal([T0(20, 22)], false, 2, B, null, enemy) !== null);
const dzTop = [[0, 0], [60, 0], [60, 12], [0, 12]];
check("strategic: enemy DZ rejected in round 2", wp7ArriveIllegal([T0(3, 6)], false, 2, B, dzTop, enemy) !== null);
check("strategic: enemy DZ allowed from round 3", wp7ArriveIllegal([T0(3, 6)], false, 3, B, dzTop, enemy) === null);
check("off-board placement rejected", wp7ArriveIllegal([T0(-1, 22)], true, 2, B, null, enemy) !== null);

// ---- 3. reserves survive a state round-trip; rsv+ replaces by id; rsv- removes ----
op({ k: "rsv+", res: { id: "u9", owner: 1, name: "Termies", ds: true,
  toks: [{ id: "t1", unit: "u9", owner: 1, x: 5, y: 5, shape: "c", dmm: 40, u0: 5, kw: ["INFANTRY"] }] } });
let rt = JSON.parse(JSON.stringify(state));
check("round-trip: reserve entry survives JSON save/load",
  rt.reserves[1].length === 1 && rt.reserves[1][0].ds === true && rt.reserves[1][0].toks[0].dmm === 40 && rt.reserves[1][0].toks[0].u0 === 5);
check("round-trip: cpDone grants survive", Object.keys(rt.phase.cpDone).length === 10);
op({ k: "rsv+", res: Object.assign(JSON.parse(JSON.stringify(state.reserves[1][0])), { ds: false }) });
check("rsv+ replaces by id (DS toggle, no duplicate)", state.reserves[1].length === 1 && state.reserves[1][0].ds === false);
op({ k: "rsv-", id: "u9" });
check("rsv- removes the entry", state.reserves[1].length === 0);

// ---- 4. attach / detach restores original unit ids ----
state.tokens = [
  { id: "c1", unit: "cu", owner: 1, name: "Captain", shape: "c", dmm: 40, kw: ["CHARACTER", "INFANTRY"], x: 1, y: 1 },
  { id: "m1", unit: "mu", owner: 1, name: "Intercessor", shape: "c", dmm: 32, kw: ["INFANTRY"], x: 2, y: 1 },
  { id: "m2", unit: "mu", owner: 1, name: "Intercessor", shape: "c", dmm: 32, kw: ["INFANTRY"], x: 3, y: 1 },
];
sel.clear(); sel.add("c1"); sel.add("m1"); sel.add("m2");
wp7Attach();
const c1 = state.tokens.find(t => t.id === "c1");
check("attach: character joins the unit (shared unit id)", c1.unit === "mu" && c1.attachedFrom === "cu");
check("attach: squad tokens untouched", state.tokens.find(t => t.id === "m1").unit === "mu" && !state.tokens.find(t => t.id === "m1").attachedFrom);
sel.clear(); sel.add("m1");     // A on the merged unit = detach
wp7Attach();
check("detach restores the original unit id", c1.unit === "cu" && !c1.attachedFrom);
// refuse to attach units that aren't yours
state.tokens.push({ id: "e1", unit: "eu", owner: 2, name: "Boy", shape: "c", dmm: 32, kw: ["INFANTRY"], x: 9, y: 9 });
sel.clear(); sel.add("c1"); sel.add("e1");
wp7Attach();
check("attach refused across owners", c1.unit === "cu" && state.tokens.find(t => t.id === "e1").unit === "eu");

// ---- 5. old saves without WP7 fields load fine ----
const old = { board: { w: 60, h: 44 }, tokens: [], trackers: { round: 3 } };
wp7Compat(old);
check("wp7Compat fills reserves + phase on an old save",
  old.reserves && old.reserves[1].length === 0 && old.phase.ph === -1 && old.phase.side === 1 && !!old.phase.cpDone);
delete state.phase;   // even a raw op against a stripped state must not throw
state.trackers = { round: 2, cp1: 0, cp2: 0 };
wp7ApplyPhase({ k: "phase", ph: 0, side: 1, round: 2 });
check("phase op on a state missing .phase: no crash, CP granted once",
  state.phase.ph === 0 && state.trackers.cp1 === 1 && state.trackers.cp2 === 1 && state.phase.cpDone["2:1"] === 1);
wp7ApplyPhase({ k: "phase", ph: 0, side: 1, round: 2 }); // idempotent re-apply
check("re-applying the same phase op grants nothing", state.trackers.cp1 === 1 && state.trackers.cp2 === 1);

// ---- 6. half-strength battle-shock reminder ----
state.tokens = [];
for (let i = 0; i < 5; i++) state.tokens.push({ id: "b" + i, unit: "bz", owner: 1, name: "Boyz", u0: 10, wounds: 1, maxW: 1, x: i, y: 0, shape: "c", dmm: 32 });
state.tokens.push({ id: "w1", unit: "kn", owner: 1, name: "Knight", wounds: 6, maxW: 12, u0: 1, x: 9, y: 9, shape: "r", wIn: 4, hIn: 2.5 });
state.tokens.push({ id: "l1", unit: "lg", owner: 1, name: "Legacy", wounds: 1, maxW: 1, x: 12, y: 9, shape: "c", dmm: 32 });
let below = wp7BelowHalf(1);
check("below-half: 5/10 models flagged, 6/12 W single flagged, legacy (no u0) not",
  below.length === 2 && below.some(s => s.includes("Boyz")) && below.some(s => s.includes("Knight")));
state.tokens.push({ id: "b9", unit: "bz", owner: 1, name: "Boyz", u0: 10, wounds: 1, maxW: 1, x: 6, y: 0, shape: "c", dmm: 32 });
below = wp7BelowHalf(1);
check("below-half: 6/10 models no longer flagged", !below.some(s => s.includes("Boyz")));

process.exit(fails ? 1 : 0);
