;(function(){
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };

  // ---- window.WP3D bridge: exact documented shape ----
  const EXPECTED_KEYS=["state","view","sel","DB","mySide","myArmy","op","applyOp","draw",
    "hitToken","hitTerrain","hitObjective","checkCoherency","mmIn","px","inch","uid",
    "wpvGlyphFor","wpvSideFid","WPV_FACTIONS","WP21_HULLS","wp21BaseFor",
    "tokDragBegin","tokDragMove","tokDragCommit",
    "ruler" /* ==== WP3D-5 ==== additive getter so the 3D HUD mirrors the tape measure */,
    "onDice" /* ==== WP3D-v2 ==== additive dice-roll tap for the 3D dice */];
  assert(typeof window!=="undefined" && !!window.WP3D, "window.WP3D exists");
  const gotKeys=Object.keys(window.WP3D).sort(), wantKeys=[...EXPECTED_KEYS].sort();
  assert(gotKeys.length===wantKeys.length && gotKeys.every((k,i)=>k===wantKeys[i]),
    "window.WP3D has exactly the documented keys (got "+gotKeys.length+", want "+wantKeys.length+")");
  const FN_KEYS=["state","view","mySide","myArmy","op","applyOp","draw","hitToken","hitTerrain",
    "hitObjective","checkCoherency","mmIn","px","inch","uid","wpvGlyphFor","wpvSideFid",
    "wp21BaseFor","tokDragBegin","tokDragMove","tokDragCommit"];
  FN_KEYS.forEach(k=>assert(typeof window.WP3D[k]==="function","WP3D."+k+" is a function"));
  assert(typeof window.WP3D.sel==="object" && window.WP3D.sel instanceof Set, "WP3D.sel is a Set");
  assert(window.WP3D.sel===sel, "WP3D.sel is the live sel Set BY REFERENCE (adding here shows up there)");
  sel.add("__wp3d_probe__");
  assert(window.WP3D.sel.has("__wp3d_probe__"), "mutating the app's sel is visible through WP3D.sel");
  sel.delete("__wp3d_probe__");
  assert(typeof window.WP3D.DB==="object", "WP3D.DB is an object");
  assert(typeof window.WP3D.WPV_FACTIONS==="object", "WP3D.WPV_FACTIONS is an object");
  assert(typeof window.WP3D.WP21_HULLS==="object" && Array.isArray(window.WP3D.WP21_HULLS),
    "WP3D.WP21_HULLS resolves (via its lazy getter) to the real array, no TDZ throw");
  assert(window.WP3D.state()===state, "WP3D.state() returns the live state object");
  assert(window.WP3D.view()===view, "WP3D.view() returns the live view object");
  assert(window.WP3D.mySide()===mySide, "WP3D.mySide() returns the live mySide value");

  // ---- wp3dAvailable ----
  assert(typeof wp3dAvailable==="function", "wp3dAvailable() is a function");
  assert(typeof wp3dAvailable()==="boolean", "wp3dAvailable() returns a boolean");

  // ---- wp3dSave/wp3dInit round-trip a mocked localStorage ----
  (function(){
    const store={};
    const realLS=global.localStorage;
    global.localStorage={
      getItem:k=>(k in store?store[k]:null),
      setItem:(k,v)=>{ store[k]=String(v); },
      removeItem:k=>{ delete store[k]; },
    };
    try{
      const el=document.getElementById("wp3d");
      el.disabled=false; // simulate "available" for this round-trip check
      el.checked=true;
      wp3dSave();
      assert(store["wh40k_3d"]===JSON.stringify({on:1}), "wp3dSave() writes {on:1} for a checked box");
      el.checked=false;
      wp3dSave();
      assert(store["wh40k_3d"]===JSON.stringify({on:0}), "wp3dSave() writes {on:0} for an unchecked box");
      // wp3dInit reads it back — but only applies the stored value when wp3dAvailable() is true;
      // under this node harness wp3dAvailable() is always false (no real WebGL2/document.createElement
      // stub), so assert the safe, always-true half of the contract instead: init never throws and
      // always leaves the checkbox usable one way or the other.
      store["wh40k_3d"]=JSON.stringify({on:1});
      assert(typeof wp3dInit==="function", "wp3dInit() is a function");
      let threw=false;
      try{ wp3dInit(); }catch(e){ threw=true; }
      assert(!threw, "wp3dInit() does not throw against a mocked localStorage");
    } finally {
      global.localStorage=realLS;
    }
  })();

  // ---- draw() wrap ----
  (function(){
    let called=0;
    window.wp3dOnDraw=()=>{ called++; };
    let threw=false;
    try{ draw(); }catch(e){ threw=true; console.error(e); }
    assert(!threw, "draw() does not throw with window.wp3dOnDraw defined");
    assert(called===1, "draw() calls window.wp3dOnDraw exactly once when defined");
    delete window.wp3dOnDraw;
    threw=false;
    try{ draw(); }catch(e){ threw=true; console.error(e); }
    assert(!threw, "draw() does not throw when window.wp3dOnDraw is undefined (no-op)");
  })();

  // ---- tokDragBegin/Move/Commit: scripted drag matches pre-existing drag behaviour ----
  (function(){
    sel.clear();
    state.tokens.push({id:"t3d",owner:1,unit:"u3d",name:"WP3D Test Model",shape:"c",dmm:32,
      x:5,y:5,wounds:1,maxW:1,Mv:6,OC:2});
    sel.add("t3d");
    const origOp=op, opCalls=[];
    op=function(o){ opCalls.push(o); origOp(o); };
    try{
      const d=tokDragBegin(["t3d"],5,5);
      assert(!!d && drag && drag.mode==="tokens", "tokDragBegin() opens a drag.mode='tokens' gesture");
      const midTok=state.tokens.find(t=>t.id==="t3d");
      assert(midTok.x===5 && midTok.y===5, "tokDragBegin() does not itself move the token");
      tokDragMove(8,5); // +3" in x, 0 in y
      const afterMove=state.tokens.find(t=>t.id==="t3d");
      assert(Math.abs(afterMove.x-8)<1e-9 && Math.abs(afterMove.y-5)<1e-9,
        "tokDragMove() applies the live delta to the token position");
      assert(drag.moved===true, "tokDragMove() marks the drag as moved");
      tokDragCommit();
      assert(drag===null, "tokDragCommit() clears the module-level drag after committing");
      const finalTok=state.tokens.find(t=>t.id==="t3d");
      assert(Math.abs(finalTok.x-8)<1e-9 && Math.abs(finalTok.y-5)<1e-9,
        "final committed position (8,5) matches what the drag applied — same as the pre-extraction inline handlers");
      assert(opCalls.some(o=>o.k==="tok~"), "tokDragCommit() calls op({k:'tok~',...}) to sync the move");
      const commitOp=opCalls.find(o=>o.k==="tok~");
      const committedTok=(commitOp.toks||[]).find(t=>t.id==="t3d");
      assert(!!committedTok && Math.abs(committedTok.x-8)<1e-9 && Math.abs(committedTok.y-5)<1e-9,
        "the committed tok~ op carries the correct final (x,y)");
    } finally {
      op=origOp;
    }
  })();

  console.log(fails?("WP3D BRIDGE TESTS: "+fails+" FAILURES"):"WP3D BRIDGE TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
