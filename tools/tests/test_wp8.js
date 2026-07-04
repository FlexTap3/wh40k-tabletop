// WP8 simulation: memoized coherency, pinch math, side claim, pointer/gesture bookkeeping.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
const start = src.indexOf("/* ==== WP8: hardening — touch input");
const end = src.indexOf("/* ==== end WP8 ==== */", start);
if (start < 0 || end < 0) { console.error("WP8 block not found"); process.exit(1); }
let wp8 = src.slice(start, end);
wp8 = wp8.replace(/^cv\.style\.touchAction.*$/m, "")
         .replace(/^document\.head\.insertAdjacentHTML[\s\S]*?<\/style>"\);$/m, "");

// ---- stubs ----
const cv = { getBoundingClientRect: () => ({ left: 50, top: 100 }) };
let view = { x: 0, y: 0, s: 14 };
const inch = (cx, cy) => [(cx - view.x) / view.s, (cy - view.y) / view.s];
let drag = null, marquee = null, panning = null, ruler = null;
let state = { tokens: [], names: {1:"P1",2:"P2"} };
let mySide = 1, isHost = false, myName = "Guest";
const sel = new Set(); const logs = [];
const logSys = s => logs.push(s);
global.document = { getElementById: () => ({ set value(v){ document._side = v; } }) };
global.window = { addEventListener: () => {} };
let cohCalls = 0; const checkCoherency = () => { cohCalls++; };
const refreshTrackers = () => {};
const draw = () => {};
const hitToken = () => null;
const op = o => { ops.push(o); }; const ops = [];
global.prompt = () => null;

eval(wp8 + ";global.__wp8={down:wp8PointerDown,move:wp8PointerMove,up:wp8PointerUp,claim:wp8SideClaim,coh:wp8Coherency,getDrag:()=>drag,setDrag:d=>{drag=d;},getPanning:()=>panning,getView:()=>view};");

let fails = 0;
const check = (n, c) => { console.log((c ? "PASS" : "FAIL") + "  " + n); if (!c) fails++; };
const pe = (id, type, x, y) => ({ pointerId: id, pointerType: type, clientX: x, clientY: y, button: 0, preventDefault(){ this.pd = true; } });

(async () => {
  // 1. memoized coherency: repeated draws with unchanged tokens -> one real check
  state.tokens = [
    { id:"a", unit:"u1", x:10, y:10 }, { id:"b", unit:"u1", x:11, y:10 },
    { id:"c", unit:"u2", x:30, y:30 } ];
  cohCalls = 0;
  for (let i = 0; i < 100; i++) __wp8.coh();      // 100 frames of pan/zoom
  check("coherency: 100 idle frames -> 1 recompute", cohCalls === 1);
  state.tokens[0].x += 0.5;                        // token moved
  __wp8.coh(); __wp8.coh();
  check("coherency: token move -> exactly 1 more recompute", cohCalls === 2);
  state.tokens.pop();                              // membership change
  __wp8.coh();
  check("coherency: token removal -> recompute", cohCalls === 3);
  state.tokens.push({ id:"d", unit:"u3", x:30, y:30 });
  __wp8.coh();
  check("coherency: unit id feeds the hash", cohCalls === 4);

  // 2. mouse events pass straight through
  check("mouse pointerdown ignored by touch layer", __wp8.down(pe(1, "mouse", 5, 5)) === false);
  __wp8.up(pe(1, "mouse", 5, 5));

  // 3. pinch: second finger cancels gesture, move zooms about the midpoint
  __wp8.setDrag({ mode: "tokens" });
  const f1 = pe(10, "touch", 150, 200), f2 = pe(11, "touch", 250, 200);
  check("first touch falls through to main handler", __wp8.down(f1) === false && f1.pd === true);
  check("second touch starts pinch + cancels drag", __wp8.down(f2) === true && __wp8.getDrag() === null);
  // midpoint (200,200) client = (150,100) canvas -> board point before zoom
  const [aix, aiy] = inch(150, 100);
  const m1 = pe(10, "touch", 130, 200), m2 = pe(11, "touch", 270, 200); // spread 100 -> 140
  check("pinch move consumed", __wp8.move(m1) === true && __wp8.move(m2) === true);
  const v = __wp8.getView();
  check("pinch: zoomed in ~1.4x", Math.abs(v.s - 14 * 1.4) < 0.6);
  const [bix, biy] = inch(150, 100); // same canvas point, midpoint unchanged at (200,200)
  check("pinch: board point under midpoint is stable", Math.abs(aix - bix) < 0.05 && Math.abs(aiy - biy) < 0.05);
  check("pinch: first finger up consumed, pinch ends", __wp8.up(pe(10, "touch", 130, 200)) === true);
  check("remaining finger up falls through", __wp8.up(pe(11, "touch", 270, 200)) === false);

  // 4. long-press converts a marquee to panning
  const lp = pe(20, "touch", 300, 300);
  __wp8.down(lp);
  __wp8.setDrag({ mode: "marquee" });
  await new Promise(r => setTimeout(r, 520));
  check("long-press: marquee -> pan", __wp8.getDrag() === null && __wp8.getPanning() !== null);
  __wp8.up(pe(20, "touch", 300, 300));

  // 5. side claim: guest flips, host keeps
  isHost = false; mySide = 1; logs.length = 0;
  __wp8.claim({ side: 1, name: "Host" });
  check("guest with clashing side flips to 2", mySide === 2 && logs.length === 1);
  __wp8.claim({ side: 1, name: "Host" });
  check("no flip when sides differ", mySide === 2);
  isHost = true; mySide = 2; state.names[2] = "Guest";
  __wp8.claim({ side: 2, name: "Guest" });
  check("host re-asserts its own name", state.names[2] === "Guest" ? mySide === 2 && state.names[2] === "Guest" : true);
  check("host keeps side", mySide === 2 && state.names[2] === myName);

  console.log(fails ? "\n" + fails + " FAILURES" : "\nALL WP8 TESTS PASSED");
  process.exit(fails ? 1 : 0);
})();
