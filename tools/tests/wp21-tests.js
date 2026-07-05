// WP21 base-size & shape correctness: run via  node harness.js wp21-tests.js
// Covers: baseFrom's new oval flag + decimal parsing + super-heavy/titan wounds tiers,
// wp21BaseFor's curated hull table (name beats base string; platforms/aircraft/jetbikes
// deliberately fall through), deployCard minting oval Knight tokens end-to-end,
// hitToken's ellipse test (rect corner misses an oval, hits a plain rect),
// wp21Refit converting wrongly-sized saved tokens (r resize + c→r with field
// clearing, no-op when everything is already right), and a draw() smoke pass
// over a rotated oval with sgt + role pip + wound badge.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps || 0.01);

  // ---------- baseFrom: oval flag + decimals ----------
  let b = baseFrom("170 x 109mm", 26);
  assert(b.shape === "r" && near(b.wIn, 6.693) && near(b.hIn, 4.291) && b.oval === true, 'baseFrom "170 x 109mm" → 6.69×4.29 oval (Knight base)');
  b = baseFrom("28.5mm", 2);
  assert(b.shape === "c" && b.dmm === 28.5 && !b.oval, 'baseFrom "28.5mm" → 28.5mm circle (decimal parse intact)');
  b = baseFrom("60 x 35.5mm", 3);
  assert(b.shape === "r" && near(b.wIn, 2.362) && near(b.hIn, 1.398) && b.oval === true, 'baseFrom "60 x 35.5mm" → oval (decimal A x B)');
  b = baseFrom("32mm", 2);
  assert(b.shape === "c" && b.dmm === 32, 'baseFrom "32mm" → circle (unchanged)');

  // ---------- baseFrom: new wounds tiers ----------
  assert(JSON.stringify(baseFrom("Use model", 100)) === JSON.stringify({shape:"r",wIn:11,hIn:7}), "baseFrom W=100 → 11×7 titan tier");
  assert(JSON.stringify(baseFrom("Use model", 24)) === JSON.stringify({shape:"r",wIn:9,hIn:5.5}), "baseFrom W=24 → 9×5.5 super-heavy tier");
  assert(JSON.stringify(baseFrom("Use model", 16)) === JSON.stringify({shape:"r",wIn:7.5,hIn:4.5}), "baseFrom W=16 → 7.5×4.5 (old tier preserved)");
  assert(JSON.stringify(baseFrom("Use model", 8)) === JSON.stringify({shape:"r",wIn:4,hIn:2.5}), "baseFrom W=8 → 4×2.5 (old tier preserved)");

  // ---------- wp21BaseFor: hull table hits ----------
  b = wp21BaseFor("Rhino", "Use model", 10);
  assert(b.shape === "r" && b.wIn === 4.6 && b.hIn === 3.0 && !b.oval, "Rhino → 4.6×3.0 hull, no oval flag");
  b = wp21BaseFor("Leman Russ Punisher", "Use model", 13);
  assert(b.shape === "r" && b.wIn === 5.7 && b.hIn === 4.0, "Leman Russ Punisher → 5.7×4.0 (variant matches the chassis row)");
  b = wp21BaseFor("Hammerhead Gunship", "60mm flying base", 14);
  assert(b.shape === "r" && b.wIn === 7.0 && b.hIn === 4.5, "Hammerhead Gunship → 7.0×4.5 hull (table beats the 60mm stand string)");
  b = wp21BaseFor("Baneblade", "Use model", 24);
  assert(b.shape === "r" && b.wIn === 9.3 && b.hIn === 5.5, "Baneblade → 9.3×5.5 from the table (not the wounds tier)");
  b = wp21BaseFor("Drop Pod", "Use model", 8);
  assert(b.shape === "c" && b.dmm === 140, "Drop Pod → 140mm circle from the table");
  b = wp21BaseFor("ATTACK BIKE", "90 x 52mm", 3);
  assert(b.shape === "r" && b.oval === true && near(b.wIn, 3.55) && near(b.hIn, 2.05), "Attack Bike → 90×52mm-equivalent OVAL from the table");

  // ---------- wp21BaseFor: deliberate fall-throughs ----------
  b = wp21BaseFor("Armiger Helverin", "100mm", 14);
  assert(b.shape === "c" && b.dmm === 100, "Armiger '100mm' → circle via baseFrom, NOT a table hull");
  b = wp21BaseFor("Manticore Platform", "Use model", 8);
  assert(b.shape === "r" && b.wIn === 4 && b.hIn === 2.5, "Manticore Platform does NOT match the chimera row (falls to the W-tier)");
  b = wp21BaseFor("Hydra Platform", "Use model", 8);
  assert(b.shape === "r" && b.wIn === 4 && b.hIn === 2.5, "Hydra Platform falls through too");
  b = wp21BaseFor("Manticore", "Use model", 12);
  assert(b.wIn === 5.3 && b.hIn === 3.7, "the Manticore TANK still gets the chimera chassis");
  b = wp21BaseFor("Warlord Titan", "Use model", 100);
  assert(b.shape === "r" && b.wIn === 11 && b.hIn === 7, "Warlord Titan (no table row) → 11×7 titan tier");
  b = wp21BaseFor("Some Unknown Thing", "Use model", 8);
  assert(b.shape === "r" && b.wIn === 4 && b.hIn === 2.5, "unknown 'Use model' W=8 → 4×2.5 fallback");
  b = wp21BaseFor("Valkyrie", "60mm flying base", 14);
  assert(b.shape === "c" && b.dmm === 60, "true aircraft keeps its flying-stand circle (a 2D hull token would be unusable)");
  b = wp21BaseFor("Warp Hunter", "Use model", 12);
  assert(b.wIn === 6.3 && b.hIn === 4.0, "Warp Hunter reaches ITS grav-tank row (predator row's hunter is anchored)");
  b = wp21BaseFor("Crimson Hunter", "120 x 92mm flying base", 12);
  assert(b.oval === true && near(b.wIn, 4.724), "Crimson Hunter keeps its 120×92 oval stand (no predator hull)");
  b = wp21BaseFor("War Dog Stalker", "100mm", 14);
  assert(b.shape === "c" && b.dmm === 100, "War Dog Stalker keeps its 100mm round base (stalker is anchored)");
  b = wp21BaseFor("Vertus Praetors", "75 x 42mm", 5);
  assert(b.oval === true && near(b.wIn, 2.953), "Vertus Praetors keep their jetbike oval (praetor row is word-bounded)");

  // ---------- deployCard end-to-end: Knight card mints oval tokens ----------
  state.tokens.length = 0; sel.clear(); mySide = 1; myArmy.length = 0;
  const qi = DB.units.QI || [];
  const ki = qi.findIndex(u => u.n === "Knight Paladin");
  assert(ki >= 0, "DB sanity: Knight Paladin exists in Imperial Knights");
  const kCard = addFromDb("QI", ki, 1, true);
  deployCard(migrateCard(kCard));
  const kt = state.tokens.filter(t => /knight paladin/i.test(t.name));
  assert(kt.length === 1, "deployCard minted one Knight token");
  assert(kt[0].shape === "r" && kt[0].oval === true && near(kt[0].wIn, 6.693) && near(kt[0].hIn, 4.291),
    "Knight token stores oval:true + 6.69×4.29 at mint");

  // ---------- hitToken: ellipse vs rect ----------
  state.tokens.length = 0;
  const OV = {id:"ov",owner:1,unit:"u1",name:"Bike",shape:"r",wIn:3.55,hIn:2.05,oval:true,x:10,y:10,rot:0,wounds:3,maxW:3};
  const RC = {id:"rc",owner:1,unit:"u2",name:"Rhino",shape:"r",wIn:3.55,hIn:2.05,x:30,y:30,rot:0,wounds:10,maxW:10};
  state.tokens.push(OV, RC);
  assert(hitToken(10, 10) === OV, "oval: centre hit");
  assert(hitToken(10 + 1.7, 10) === OV, "oval: point on the long axis hits");
  assert(hitToken(10 + 1.6, 10 + 0.9) === null, "oval: rect-corner point (inside the box, outside the ellipse) MISSES");
  assert(hitToken(30 + 1.6, 30 + 0.9) === RC, "plain rect: the same corner point still HITS a non-oval rect");
  OV.rot = 90; // long axis now vertical
  assert(hitToken(10, 10 + 1.7) === OV, "oval: rotation respected (long axis point after 90°)");
  assert(hitToken(10 + 1.7, 10) === null, "oval: old long-axis point misses after rotation");
  OV.rot = 0;

  // ---------- wp21Refit: fixes wrongly-sized saved tokens ----------
  state.tokens.length = 0; mySide = 1;
  myArmy.length = 0;
  myArmy.push(
    {name:"Rhino", pts:"", weapons:"", notes:"", kw:["VEHICLE"],
     profiles:[{n:"Rhino",count:1,base:"Use model",M:'12"',T:9,Sv:"3+",Inv:"-",W:10,Ld:"6+",OC:2}]},
    {name:"Hammerhead Gunship", pts:"", weapons:"", notes:"", kw:["VEHICLE","FLY"],
     profiles:[{n:"Hammerhead Gunship",count:1,base:"60mm flying base",M:'10"',T:10,Sv:"3+",Inv:"-",W:14,Ld:"7+",OC:3}]});
  const badRhino = {id:"t1",owner:1,unit:"uA",name:"Rhino",shape:"r",wIn:6,hIn:3.5,x:10,y:10,rot:45,wounds:10,maxW:10};   // old wounds-guess size
  const badHam   = {id:"t2",owner:1,unit:"uB",name:"Hammerhead Gunship",shape:"c",dmm:60,x:20,y:20,wounds:14,maxW:14};    // old stand circle
  const enemyTok = {id:"t3",owner:2,unit:"uC",name:"Rhino",shape:"r",wIn:6,hIn:3.5,x:40,y:40,rot:0,wounds:10,maxW:10};    // NOT mine — untouched
  state.tokens.push(badRhino, badHam, enemyTok);
  wp21Refit();
  assert(badRhino.wIn === 4.6 && badRhino.hIn === 3.0 && badRhino.shape === "r", "Refit: 6×3.5 Rhino corrected to 4.6×3.0 via applyOp");
  assert(badRhino.rot === 45 && !badRhino.oval, "Refit: rotation preserved, no stray oval flag");
  assert(badHam.shape === "r" && badHam.wIn === 7.0 && badHam.hIn === 4.5, "Refit: Hammerhead stand circle became the 7.0×4.5 hull");
  assert(badHam.dmm === null && badHam.rot === 0, "Refit: c→r conversion nulls dmm and supplies rot:0");
  assert(enemyTok.wIn === 6 && enemyTok.hIn === 3.5, "Refit: opponent's token untouched");
  // second run is a no-op: no tok~ sent at all
  const _op = op; let refitOps = 0;
  op = o => { refitOps++; _op(o); };
  wp21Refit();
  op = _op;
  assert(refitOps === 0, "Refit: second run sends nothing (already correct)");
  assert(badRhino.wIn === 4.6 && badHam.wIn === 7.0, "Refit: dims stable after the no-op run");

  // ---------- draw() smoke: rotated oval + sgt + role pip ----------
  state.tokens.length = 0;
  state.tokens.push({id:"k1",owner:1,unit:"uK",name:"Knight Paladin",shape:"r",wIn:6.69,hIn:4.29,oval:true,rot:37,
    x:30,y:22,wounds:12,maxW:26,sgt:true,role:"HVY",tag:"KP"});
  let drew = true;
  try { draw(); } catch (e) { drew = false; console.log("draw threw: " + (e && e.message)); }
  assert(drew, "draw() renders a rotated oval with sgt chevron + role pip + wound badge without throwing");

  console.log(failed ? "WP21 TESTS: " + failed + " FAILURES" : "WP21 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
