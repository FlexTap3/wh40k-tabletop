// WP-A/B — structured movement (move-once lock + done + snap-back) and free
// drag-to-rotate vehicle bases. Run via  node harness.js wpmove-tests.js
;(function(){
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);
  const cvEl=els["board"];
  const logHtml=()=>els["log"].children.map(d=>String(d.innerHTML||"")).join("\n");

  view.x=0; view.y=0; view.s=10; // 10px per inch -> px offset = inches*10
  g("strictCoh").checked=false; g("strictMove").checked=false; g("wp5Strict").checked=false;

  const dragTo=(fromIn,toIn)=>{
    cvEl.handlers.pointerdown({offsetX:fromIn[0]*10,offsetY:fromIn[1]*10,button:0,shiftKey:false,altKey:false});
    winHandlers.pointermove({clientX:toIn[0]*10,clientY:toIn[1]*10});
    winHandlers.pointerup({});
  };
  const resetWpMove=()=>{ wpMoved.clear(); wpDone.clear(); for(const k in wpMoveStart) delete wpMoveStart[k]; };
  const mkTok=(id,unit,x,y,o)=>Object.assign({id,owner:1,unit,name:unit,shape:"c",dmm:32,x,y,rot:0,
    wounds:1,maxW:1,Mv:6,OC:2,T:4,Sv:"3+",iv:"-",kw:["INFANTRY"]},o||{});

  /* ================= (a)-(d): move-once lock, "Movement complete", snap-back undo ================= */
  g("structMove").checked=true;
  state.tokens.length=0; state.terrain.length=0; sel.clear(); resetWpMove();
  op({k:"tok+",toks:[mkTok("m1","MU",10,20),mkTok("m2","MU",15,20),mkTok("m3","MU",20,20)]});
  const tok=id=>state.tokens.find(t=>t.id===id);

  // (a) a moved model lands in wpMoved after a legit drop
  dragTo([10,20],[10.5,20]);
  assert(Math.abs(tok("m1").x-10.5)<0.01,"(a) m1 dragged 0.5\" and the move committed");
  assert(wpMoved.has("m1"),"(a) m1 recorded in wpMoved after a successful drop");
  assert(!wpMoved.has("m2")&&!wpMoved.has("m3"),"(a) unmoved squadmates are not in wpMoved");

  // (b) re-dragging a moved model while the unit still has unmoved members is refused
  const beforeLog=els["log"].children.length;
  dragTo([10.5,20],[13,20]);
  assert(Math.abs(tok("m1").x-10.5)<0.01,"(b) refused re-move: m1's position is unchanged");
  assert(els["log"].children.slice(beforeLog).some(d=>/Move the rest of this unit/.test(String(d.innerHTML))),
    "(b) refusal is logged with the documented message");

  // (c) once every member has moved this phase, re-moving any of them is allowed again
  dragTo([15,20],[15.5,20]);           // m2 moves
  dragTo([20,20],[20.5,20]);           // m3 moves
  assert(wpMoved.has("m1")&&wpMoved.has("m2")&&wpMoved.has("m3"),"(c) all three members have now moved");
  dragTo([10.5,20],[13,20]);           // m1 again — unit fully moved, unlocked
  assert(Math.abs(tok("m1").x-13)<0.01,"(c) unit fully moved -> re-move allowed (m1 relocated)");

  // wpDone overrides the "all moved -> unlocked" rule: an explicitly completed unit stays locked
  wpMarkDone("MU");
  assert(wpDone.has("MU")&&["m1","m2","m3"].every(id=>wpMoved.has(id)),"wpMarkDone flags the unit done and (re)marks every member moved");
  const m1xBeforeLockedTry=tok("m1").x;
  dragTo([tok("m1").x,20],[tok("m1").x+2,20]);
  assert(Math.abs(tok("m1").x-m1xBeforeLockedTry)<0.01,"Movement complete blocks dragging even though every member had already moved");

  // (d) Undo move restores the unit's exact pre-phase x/y/rot and clears the lock + done flag
  const snap=wpMoveStart["MU"];
  assert(!!snap&&snap.length===3,"(d) a phase-start snapshot (x,y,rot) was captured for MU");
  const orig={}; snap.forEach(s=>orig[s.id]={x:s.x,y:s.y,rot:s.rot});
  wpUndoMove("MU");
  ["m1","m2","m3"].forEach(id=>{
    const t=tok(id), o=orig[id];
    assert(t.x===o.x&&t.y===o.y&&t.rot===o.rot,"(d) "+id+" restored to its exact pre-move x/y/rot");
  });
  assert(!wpMoved.has("m1")&&!wpMoved.has("m2")&&!wpMoved.has("m3"),"(d) undo clears wpMoved for every member");
  assert(!wpDone.has("MU"),"(d) undo also clears wpDone");

  // no snapshot yet for a fresh unit -> undo is a friendly no-op, not a crash
  const beforeLog2=els["log"].children.length;
  wpUndoMove("NEVER_MOVED_UNIT");
  assert(els["log"].children.slice(beforeLog2).some(d=>/No movement to undo/.test(String(d.innerHTML))),"undo on an unmoved unit logs a friendly note");

  /* ================= (e) free drag-to-rotate vehicle bases ================= */
  state.tokens.length=0; sel.clear(); resetWpMove();
  const veh={id:"veh1",owner:1,unit:"VU",name:"Rhino",shape:"r",wIn:6,hIn:3,x:30,y:30,rot:0,
    wounds:10,maxW:10,Mv:8,OC:0,T:9,Sv:"3+",iv:"-",kw:["VEHICLE"]};
  op({k:"tok+",toks:[veh]});
  sel.clear(); sel.add("veh1"); // as if the vehicle were already selected (a prior click opened its inspector)

  // handle sits 3.6" "north" of centre at rot 0 -> board (30,26.4) -> screen (300,264) at view.s=10
  cvEl.handlers.pointerdown({offsetX:300,offsetY:264,button:0,shiftKey:false,altKey:false});
  assert(drag&&drag.mode==="rotate"&&drag.id==="veh1","(e) grabbing the rotate handle starts a rotate drag, not a token drag");

  winHandlers.pointermove({clientX:336,clientY:300}); // handle swung to due "east" -> ~90°
  assert(Math.abs(((tok("veh1").rot%360)+360)%360-90)<0.5,"(e) live drag updates rot continuously before commit");

  winHandlers.pointerup({});
  assert(Math.abs(((tok("veh1").rot%360)+360)%360-90)<0.5,"(e) rotate commit sets rot via a normal (synced/undoable) tok~ op");
  assert(drag===null,"(e) drag state cleared after the rotate commits");

  // menu ±5° nudge helper (WP-B item 3) does the same op-based commit
  wp13Tok=veh; sel.clear(); sel.add("veh1");
  const rotBefore=tok("veh1").rot;
  wp13RotateBy(5);
  assert(Math.abs(tok("veh1").rot-((rotBefore+5+360)%360))<0.01,"+5° menu nudge rotates by exactly 5°");
  wp13RotateBy(-5);
  assert(Math.abs(tok("veh1").rot-rotBefore)<0.01,"-5° menu nudge returns to the original angle");
  wp13Tok=null;

  /* ================= (f) structured-movement toggle off = free drag ================= */
  g("structMove").checked=false;
  state.tokens.length=0; sel.clear(); resetWpMove();
  op({k:"tok+",toks:[mkTok("f1","FU",20,20),mkTok("f2","FU",26,20)]});
  dragTo([20,20],[20.5,20]);
  assert(Math.abs(tok("f1").x-20.5)<0.01,"(f) toggle off: first move commits normally");
  assert(wpMoved.has("f1"),"(f) toggle off: bookkeeping (wpMoved) still records the move");
  dragTo([20.5,20],[21.5,20]); // re-drag f1 immediately, f2 (squadmate) never moved
  assert(Math.abs(tok("f1").x-21.5)<0.01,"(f) toggle off: re-dragging an already-moved model with unmoved squadmates is a free drag");

  console.log(fails?("WPMOVE TESTS: "+fails+" FAILURES"):"WPMOVE TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
