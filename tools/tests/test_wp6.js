// WP6 simulation: OC tally math, battle-shock, secured stickiness, obj~ op.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
const start = src.indexOf("/* ==== WP6: objectives — OC auto-scoring");
const end = src.indexOf("/* ==== end WP6 ==== */", start);
if (start < 0 || end < 0) { console.error("WP6 block not found"); process.exit(1); }
let wp6 = src.slice(start, end);
// strip browser-only wiring (listeners + panel bootstrap) — we test the math/logic functions
wp6 = wp6.replace(/window\.addEventListener\([\s\S]*?\n\}\);/g, "")
         .replace(/cv\.addEventListener\([\s\S]*?\n\}\);/g, "")
         .replace(/\(function\(\)\{ \/\/ objective-control panel[\s\S]*?\n\}\)\(\);/g, "");

// ---- stubs ----
global.document = { getElementById: () => null };
const mmIn = mm => mm / 25.4;
const tokRadius = t => t.shape === "c" ? mmIn(t.dmm) / 2 : Math.min(t.wIn, t.hIn) / 2;
let state = { tokens: [], objectives: [], names: {1:"Red",2:"Blue"}, trackers: { round: 1 } };
const sel = new Set(); const logs = [];
const logEntry = (h) => logs.push(h); const logShared = (h) => logs.push(h);
const esc = s => String(s); const myName = "T";
const applied = [];
function op(o) { applied.push(o); if (o.k === "tok~") o.toks.forEach(u => { const t = state.tokens.find(x => x.id === u.id); if (t) Object.assign(t, u); }); }
// canvas stub for wp6Overlay (not exercised here, but keep eval happy if called)
const ctx = new Proxy({}, { get: () => () => 0, set: () => true });
const px = (x, y) => [x, y]; const view = { s: 14 };

eval(wp6 + ";global.__wp6={tallies:wp6Tallies,shock:wp6ToggleShock,roundLog:wp6RoundLog};");

let fails = 0;
const check = (n, c) => { console.log((c ? "PASS" : "FAIL") + "  " + n); if (!c) fails++; };
const tok = (id, owner, x, y, OC, extra) => Object.assign({ id, owner, unit: "u" + owner, name: "U" + id, x, y, shape: "c", dmm: 32, OC }, extra || {});

// Objective at (30,22). Marker radius = 20mm = .787". 32mm base radius = .63".
// Control range: center distance <= 3 + .787 + .63 = 4.417"
state.objectives = [{ id: "o1", x: 30, y: 22 }];

// 1. basic tally: 4 Boyz (OC2) at 2" vs 1 Marine (OC2) at 2"
state.tokens = [tok("a",1,32,22,2),tok("b",1,28,22,2),tok("c",1,30,24,2),tok("d",1,30,20,2),tok("e",2,30,25.5,2)];
let t = __wp6.tallies()[0];
check("tally: 8-2, red holds", t.oc1 === 8 && t.oc2 === 2 && t.holder === 1);

// 2. edge-to-edge range: token center at exactly 4.4" counts, at 4.5" doesn't
state.tokens = [tok("a",1,30+4.40,22,5), tok("b",2,30-4.50,22,5)];
t = __wp6.tallies()[0];
check("range: 4.40\" in (edge math), 4.50\" out", t.oc1 === 5 && t.oc2 === 0);

// 3. big base reaches farther: 6"x3.5" rect (radius=1.75) at 5.5" counts
state.tokens = [tok("r",2,30,27.5,8,{shape:"r",wIn:6,hIn:3.5})];
t = __wp6.tallies()[0];
check("range: rect base min-dim radius honoured", t.oc2 === 8 && t.holder === 2);

// 4. battle-shock flips control instantly
state.tokens = [tok("a",1,30,24,2),tok("b",1,30,20,2),tok("e",2,30,25.5,2)];
check("pre-shock: red 4-2", __wp6.tallies()[0].holder === 1);
state.tokens[0].bs = true; state.tokens[1].bs = true;
t = __wp6.tallies()[0];
check("battle-shocked OC counts 0 -> blue takes it", t.oc1 === 0 && t.oc2 === 2 && t.holder === 2);

// 5. tie -> nobody, unless secured
state.tokens = [tok("a",1,30,24,2),tok("e",2,30,20,2)];
check("tie: contested (holder 0)", __wp6.tallies()[0].holder === 0);
state.objectives[0].sec = 1;
check("tie + secured red: red keeps it (sticky)", __wp6.tallies()[0].holder === 1);
state.tokens = [tok("e",2,30,20,2)];
check("secured beaten by real control: blue 0-2 wins", __wp6.tallies()[0].holder === 2);
state.tokens = [];
check("empty + secured red: red keeps it", __wp6.tallies()[0].holder === 1);

// 6. legacy tokens without OC don't crash, count 0
state.tokens = [{ id:"L", owner:1, unit:"u1", name:"Legacy", x:30, y:23, shape:"c", dmm:32 }];
t = __wp6.tallies()[0];
check("legacy token: OC 0, no crash", t.oc1 === 0 && t.holder === 1 /* still secured red */);

// 7. B-toggle: whole unit flips via tok~ op, toggles back
state.objectives[0].sec = 0;
state.tokens = [tok("a",1,10,10,2),tok("b",1,11,10,2),tok("c",2,40,10,2)];
sel.add("a");
applied.length = 0;
__wp6.shock();
check("shock toggle: one tok~ op for the whole unit", applied.length === 1 && applied[0].k === "tok~" && applied[0].toks.length === 2 && applied[0].toks.every(x => x.bs === true));
__wp6.shock();
check("shock toggle: toggles back off", state.tokens[0].bs === false && state.tokens[1].bs === false);

// 8. round log: fires on increment with counts, not on decrement
state.objectives = [{id:"o1",x:30,y:22},{id:"o2",x:10,y:10}];
state.tokens = [tok("a",1,30,22,2),tok("b",2,10,10,2)];
const tal = __wp6.tallies();
logs.length = 0;
__wp6.roundLog(tal);            // initializes at round 1
state.trackers.round = 2;
__wp6.roundLog(tal);
check("round log: end-of-round summary logged", logs.length === 1 && /End of round 1/.test(logs[0]) && /holds 1/.test(logs[0]));
state.trackers.round = 1;
logs.length = 0;
__wp6.roundLog(tal);
check("round log: decrement is silent", logs.length === 0);

console.log(fails ? "\n" + fails + " FAILURES" : "\nALL WP6 TESTS PASSED");
process.exit(fails ? 1 : 0);
