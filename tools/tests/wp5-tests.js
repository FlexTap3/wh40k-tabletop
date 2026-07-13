// WP5 collision regression: run via  node harness.js wp5-tests.js
// Drives real pointer handlers: drag a token onto impassable terrain and
// assert the drop snaps back (or stands, per the Setup toggle).
{
  const cvEl = els["board"];
  const g = id => els[id] || (els[id] = (() => { const e = document.getElementById(id); return e; })());
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // defaults that exist as HTML attributes in the real page
  document.getElementById("wp5Strict").checked = true;
  document.getElementById("strictCoh").checked = false;   // isolate WP5 from coherency snapback
  document.getElementById("strictMove").checked = false;

  view.x = 0; view.y = 0; view.s = 10; // 10px per inch → offset px = inches*10

  const drag = (fromIn, toIn) => {
    cvEl.handlers.pointerdown({ offsetX: fromIn[0] * 10, offsetY: fromIn[1] * 10, button: 0, shiftKey: false, altKey: false });
    winHandlers.pointermove({ clientX: toIn[0] * 10, clientY: toIn[1] * 10 });
    winHandlers.pointerup({});
  };

  // scene: a thin wall, a container, a ruin
  state.tokens.length = 0; state.terrain.length = 0; sel.clear();
  state.terrain.push({ id: "w1", kind: "wall",  x: 20, y: 19.2, w: 6, h: 1.6, rot: 0 });
  state.terrain.push({ id: "c1", kind: "crate", x: 30, y: 18,   w: 4, h: 4,   rot: 0 });
  state.terrain.push({ id: "r1", kind: "ruin",  x: 40, y: 16,   w: 8, h: 8,   rot: 0 });

  const mkTok = (id, x, y, kw) => ({ id, owner: 1, unit: "u" + id, name: id, shape: "c", dmm: 32,
    x, y, rot: 0, wounds: 1, maxW: 1, Mv: 6, OC: 1, T: 4, Sv: "3+", iv: "-", kw });

  // 1. drop dead-centre on the wall → snap back
  state.tokens.push(mkTok("a", 10, 20, ["VEHICLE"]));
  drag([10, 20], [23, 20]); // wall centre y=20
  assert(Math.abs(state.tokens[0].x - 10) < .01 && Math.abs(state.tokens[0].y - 20) < .01, "drop centred on wall snaps back");

  // 2. base EDGE overlapping the wall (centre off it) → still snaps back
  drag([10, 20], [23, 21.3]); // centre 0.5" below wall bottom edge (y=20.8); base r=0.63" overlaps
  assert(Math.abs(state.tokens[0].x - 10) < .01 && Math.abs(state.tokens[0].y - 20) < .01, "base-edge overlap on wall snaps back (centre off the wall)");

  // 3. clearly past the wall → stands
  drag([10, 20], [23, 23]);
  assert(Math.abs(state.tokens[0].y - 23) < .01, "drop clear of the wall stands");

  // 4. container blocks everything, even infantry
  state.tokens[0].x = 23; state.tokens[0].y = 23;
  state.tokens.push(mkTok("b", 10, 30, ["INFANTRY"]));
  drag([10, 30], [32, 20]); // into crate c1
  assert(Math.abs(state.tokens[1].x - 10) < .01, "infantry can't end on a container");

  // 5. infantry may end inside a ruin; vehicle may not
  drag([10, 30], [44, 20]); // into ruin r1
  assert(Math.abs(state.tokens[1].x - 44) < .01, "infantry may end inside a ruin");
  drag([23, 23], [44, 22]); // vehicle token a into ruin
  assert(Math.abs(state.tokens[0].x - 23) < .01, "vehicle can't end inside a ruin");

  // 6. toggle off → illegal drop stands with a warning only
  document.getElementById("wp5Strict").checked = false;
  drag([23, 23], [23, 20]); // vehicle onto wall
  assert(Math.abs(state.tokens[0].y - 20) < .01, "with enforcement off, illegal drop stands");

  // 7. FLOORS: cycleFloor caps at the ruin's rendered storey count (ruinMaxLvl), and only
  //    INFANTRY/BEASTS/SWARM climb — no floating models, no pure-FLY skimmers on upper floors.
  state.tokens.length = 0; state.terrain.length = 0; sel.clear();
  const large = { id: "rL", kind: "ruin", x: 0,  y: 0,  w: 12, h: 12, rot: 0 }; // longSide 12 → maxLvl 2
  const med   = { id: "rM", kind: "ruin", x: 20, y: 0,  w: 8,  h: 8,  rot: 0 }; // longSide 8  → maxLvl 1
  const small = { id: "rS", kind: "ruin", x: 40, y: 0,  w: 5,  h: 5,  rot: 0 }; // longSide 5  → maxLvl 0
  state.terrain.push(large, med, small);
  assert(ruinMaxLvl(large) === 2 && ruinMaxLvl(med) === 1 && ruinMaxLvl(small) === 0, "ruinMaxLvl: 12x12→2, 8x8→1, 5x5→0 (matches 3D storey thresholds)");

  const cyc = (tok, n) => { sel.clear(); sel.add(tok.id); for (let i = 0; i < n; i++) cycleFloor(); };
  // large ruin: INFANTRY climbs 0→1→2 then wraps to 0 (never lvl 3 — there is no y=9 slab)
  const inf = mkTok("f", 6, 6, ["INFANTRY"]); state.tokens.push(inf);
  cyc(inf, 1); assert(inf.lvl === 1, "large ruin: floor 0→1");
  cyc(inf, 1); assert(inf.lvl === 2, "large ruin: floor 1→2");
  cyc(inf, 1); assert(inf.lvl === 0, "large ruin: floor caps at 2, wraps 2→0 (no floating floor 3)");
  // medium ruin: caps at 1
  const inf2 = mkTok("g", 24, 4, ["INFANTRY"]); state.tokens.push(inf2);
  cyc(inf2, 1); assert(inf2.lvl === 1, "medium ruin: floor 0→1");
  cyc(inf2, 1); assert(inf2.lvl === 0, "medium ruin: floor caps at 1, wraps 1→0");
  // small ruin: no upper floor at all
  const inf3 = mkTok("h", 42, 2, ["INFANTRY"]); state.tokens.push(inf3);
  cyc(inf3, 1); assert(inf3.lvl === 0 || inf3.lvl === undefined || !inf3.lvl, "small 1-storey ruin: cannot climb (stays floor 0)");
  // pure-FLY skimmer (VEHICLE+FLY, no INFANTRY) in the large ruin: forbidden to climb
  const skimmer = mkTok("s", 6, 6, ["VEHICLE", "FLY"]); state.tokens.push(skimmer);
  cyc(skimmer, 1); assert(!skimmer.lvl, "pure-FLY skimmer can't climb a ruin it may not enter (KW_ENTER_RUINS gate)");
  // jump-pack infantry (INFANTRY+FLY) in the large ruin: may climb (via INFANTRY)
  const jump = mkTok("j", 6, 6, ["INFANTRY", "FLY"]); state.tokens.push(jump);
  cyc(jump, 1); assert(jump.lvl === 1, "jump-pack INFANTRY+FLY may climb (INFANTRY grants entry)");

  console.log(failed ? "WP5 TESTS: " + failed + " FAILURES" : "WP5 TESTS: ALL PASSED");
  if (failed) process.exit(1);
}
