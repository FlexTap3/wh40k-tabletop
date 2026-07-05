// WP22 exact edge-to-edge distances: run via  node harness.js wp22-tests.js
// The old edgeDist treated every rect token as a circle of radius min(wIn,hIn)/2,
// understating a vehicle hull's long half-dimension (6×4.4 Land Raider: 2.2" instead
// of 3.0"). WP22 replaces it with exact footprint separation: circle↔circle unchanged,
// circle↔rect = point-to-rotated-box SDF minus radius, rect↔rect = corner containment
// (negative) else min of the 16 edge-pair segment distances (0 when perimeters cross).
// All expected values below are hand-computed; approx() uses the WP22 tolerance ±0.01.
;(function(){
  let fails=0, count=0;
  const assert=(c,msg)=>{ count++; if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const approx=(a,b,eps=0.01)=>Math.abs(a-b)<=eps;
  const R32=16/25.4;                      // 32mm base radius = 0.629921…"
  const R25=12.5/25.4;                    // 25mm base radius = 0.492126…"
  const C=(x,y,dmm=32)=>({shape:"c",dmm,x,y,rot:0});
  const R=(x,y,wIn,hIn,rot=0)=>({shape:"r",wIn,hIn,x,y,rot});
  // the OLD (pre-WP22) formula, kept inline so tests can prove the new values differ
  const oldDist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)
    -(a.shape==="c"?a.dmm/2/25.4:Math.min(a.wIn,a.hIn)/2)
    -(b.shape==="c"?b.dmm/2/25.4:Math.min(b.wIn,b.hIn)/2);

  // ---------- circle ↔ circle: unchanged ----------
  assert(approx(edgeDist(C(10,10),C(13,10)),3-2*R32),      'c-c gap: 3" centers − two 32mm radii = 1.7402"');
  assert(approx(edgeDist(C(10,10),C(11,10)),1-2*R32)&&edgeDist(C(10,10),C(11,10))<0,
                                                            'c-c overlap: −0.2598" (exact penetration, negative)');
  assert(approx(edgeDist(C(10,10),C(10,12,25)),2-R32-R25),  'c-c mixed 32/25mm: 0.8780"');
  assert(Math.abs(edgeDist(C(10,10),C(10+2*R32,10)))<1e-9,  "c-c touching bases: exactly 0");
  assert(approx(edgeDist(C(10,10),C(13,10)),oldDist(C(10,10),C(13,10)),1e-9),
                                                            "c-c identical to the old formula (hot path unchanged)");

  // ---------- circle ↔ axis-aligned rect (6×4.4 Land Raider hull at 20,20) ----------
  const LR=R(20,20,6,4.4);
  assert(approx(edgeDist(C(25,20),LR),5-3-R32),   'circle off the ±x face (3.0" half-width): 1.3701" — old said 2.1701"');
  assert(!approx(edgeDist(C(25,20),LR),oldDist(C(25,20),LR),0.5),
                                                  '…and differs from the old min-radius value by >0.5" (0.8")');
  assert(approx(edgeDist(C(20,25),LR),5-2.2-R32), 'circle off the ±y face (2.2" half-height): 2.1701" (old happened to be right here)');
  assert(approx(edgeDist(C(25,24.2),LR),Math.hypot(2,2)-R32),
                                                  "circle corner-on at 45°: hypot(2,2)−r = 2.1985\"");
  {
    const d=edgeDist(C(21,20.5),LR);
    assert(d<=0&&approx(d,-1.7-R32),              'circle center inside the rect: ≤0 (exact −depth−r = −2.3299")');
  }
  // symmetry: circle-first and rect-first argument order agree
  assert(approx(edgeDist(LR,C(25,20)),edgeDist(C(25,20),LR),1e-9),"edgeDist(rect,circle) === edgeDist(circle,rect)");

  // ---------- circle ↔ rotated rect ----------
  const LR90=R(20,20,6,4.4,90);
  assert(approx(edgeDist(C(25,20),LR90),5-2.2-R32),"rot 90°: ±x now faces the 2.2\" half-height — 2.1701\" (long/short swapped)");
  assert(approx(edgeDist(C(20,25),LR90),5-3-R32),  "rot 90°: ±y now faces the 3.0\" half-width — 1.3701\"");
  {
    // circle along the rect's local +x axis (rect rotated 45°), 5" from center:
    // exact = 5 − 3 − r = 1.3701". Old formula: 5 − 2.2 − r = 2.1701" — wrong by 0.8".
    const c45=C(20+5*Math.SQRT1_2,20+5*Math.SQRT1_2), old=oldDist(c45,R(20,20,6,4.4,45));
    const d=edgeDist(c45,R(20,20,6,4.4,45));
    assert(approx(d,5-3-R32),                      "rot 45°: circle down the local long axis = 1.3701\" exact");
    assert(approx(old,5-2.2-R32)&&Math.abs(d-old)>0.5,
                                                   'rot 45°: old formula gave 2.1701" — new value differs by 0.8" (>0.5")');
  }

  // ---------- rect ↔ rect ----------
  assert(approx(edgeDist(R(10,10,6,4.4),R(18,10,6,4.4)),2.0),
    'r-r parallel gap along x: 8 − 3 − 3 = 2.0" (old: 3.6")');
  assert(approx(edgeDist(R(10,10,6,4.4),R(16,15,4,2)),Math.hypot(1,1.8)),
    "r-r corner-to-corner diagonal: hypot(1,1.8) = 2.0591\"");
  {
    // plus-shape crossing: perimeters intersect, no corner contained → documented 0
    const d=edgeDist(R(10,10,6,1),R(10,10,1,6));
    assert(d<=1e-9,"r-r crossing (plus shape): ≤0");
    assert(Math.abs(d)<=1e-9,"r-r crossing reports exactly 0 (documented perimeter-touch convention)");
  }
  {
    const d=edgeDist(R(10,10,6,4.4),R(10,10,2,1));
    assert(d<0&&approx(d,-1.7),"r-r fully contained: negative corner-containment depth (−1.7\")");
  }
  {
    const d=edgeDist(R(10,10,6,4.4),R(13,12,4,2));
    assert(d<0&&approx(d,-1.2),"r-r partial overlap (corner inside): negative (−1.2\")");
  }
  {
    // both hulls rotated 90°, stacked along y: half-extents along y become 3.0"
    const A=R(10,10,6,4.4,90), B=R(10,17,6,4.4,90);
    const d=edgeDist(A,B), old=oldDist(A,B);
    assert(approx(d,1.0),                          'r-r both rot 90° along y: 7 − 3 − 3 = 1.0" exact');
    assert(approx(old,2.6)&&Math.abs(d-old)>0.5,   '…old formula said 2.6" — wrong by 1.6" (>0.5")');
  }
  assert(approx(edgeDist(R(0,0,2,2,45),R(5,0,2,2)),4-Math.SQRT2),
    "r-r diamond (2×2 @45°) vertex to square edge: 4 − √2 = 2.5858\"");
  assert(approx(edgeDist(R(18,10,6,4.4),R(10,10,6,4.4)),edgeDist(R(10,10,6,4.4),R(18,10,6,4.4)),1e-9),
    "r-r symmetric in argument order");

  // ---------- wp22RectPts sanity ----------
  {
    const P=wp22RectPts(R(2,1,4,2,90)); // 4×2 at (2,1) rot 90 → spans x∈[1,3], y∈[-1,3]
    const xs=P.map(p=>p[0]), ys=P.map(p=>p[1]);
    assert(approx(Math.min(...xs),1,1e-9)&&approx(Math.max(...xs),3,1e-9)
         &&approx(Math.min(...ys),-1,1e-9)&&approx(Math.max(...ys),3,1e-9),
      "wp22RectPts: 90°-rotated 4×2 spans x[1,3] y[-1,3] (matches hitToken/draw convention)");
  }

  // ---------- coherency integration (checkCoherency uses edgeDist ≤ 2.02) ----------
  state.tokens.length=0; incoherent=new Set();
  const V1=Object.assign(R(10,10,6,4.4),{id:"v1",owner:1,unit:"sq",name:"Land Raider"});
  const V2=Object.assign(R(17.9,10,6,4.4),{id:"v2",owner:1,unit:"sq",name:"Land Raider"});
  state.tokens.push(V1,V2);
  // Long-axis gap: 7.9 − 3 − 3 = 1.9" → coherent. Old math: 7.9 − 2.2 − 2.2 = 3.5" → it
  // wrongly flagged this squadron incoherent. Assert the direction of the fix.
  assert(approx(edgeDist(V1,V2),1.9),               'squadron long-axis gap measures 1.9" edge-to-edge');
  assert(oldDist(V1,V2)>2.02,                       'old formula measured 3.5" — would have flagged incoherent');
  checkCoherency();
  assert(incoherent.size===0,                       '1.9" along the long axis now counts coherent');
  // wp8 memo must pick up rotation changes (rot is now in the signature): rotating V2
  // 90° widens the gap to 7.9 − 3 − 2.2 = 2.7" > 2" → incoherent, via wp8Coherency only.
  wp8CohSig=null; wp8Coherency();
  assert(incoherent.size===0,                       "wp8Coherency memo agrees while unrotated");
  V2.rot=90; wp8Coherency();
  assert(incoherent.has("v1")&&incoherent.has("v2"),"rotating a hull re-runs coherency through the memo (rot in signature) → 2.7\" flags both");

  // ---------- wp3UnitDist smoke with a rect attacker ----------
  {
    const d=wp3UnitDist([R(10,10,6,4.4)],[C(20,10)]);
    assert(approx(d,10-3-R32),                      "wp3UnitDist rect attacker → circle target: 6.3701\" (edge-to-edge, no radius re-added)");
    assert(wp3UnitDist([R(10,10,6,4.4)],[R(10,10,2,1)])===0,
                                                    "wp3UnitDist clamps overlap to 0 (unchanged caller semantics)");
  }

  state.tokens.length=0; incoherent=new Set(); wp8CohSig=null;
  console.log(fails?("WP22 TESTS: "+fails+" FAILURES"):("WP22 TESTS: ALL PASSED ("+count+")"));
  process.exitCode=fails?1:0;
})();
