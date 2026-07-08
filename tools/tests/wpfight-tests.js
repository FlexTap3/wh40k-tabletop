// WP-FIGHT — Fire Overwatch, Pile in / Consolidate (3" hard cap), Fall Back.
// Run via  node harness.js wpfight-tests.js
;(function(){
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);
  const logHtml=()=>els["log"].children.map(d=>String(d.innerHTML||"")).join("\n");
  const cvEl=els["board"];
  const dragTo=(fromIn,toIn)=>{
    cvEl.handlers.pointerdown({offsetX:fromIn[0]*10,offsetY:fromIn[1]*10,button:0,shiftKey:false,altKey:false});
    winHandlers.pointermove({clientX:toIn[0]*10,clientY:toIn[1]*10});
    winHandlers.pointerup({});
  };
  const mkTok=(id,unit,owner,x,y,o)=>Object.assign({id,owner,unit,name:unit,shape:"c",dmm:32,x,y,rot:0,
    wounds:1,maxW:1,Mv:6,OC:2,T:4,Sv:"3+",iv:"-",kw:["INFANTRY"],u0:5},o||{});
  const tok=id=>state.tokens.find(t=>t.id===id);
  const toks=uk=>state.tokens.filter(t=>t.unit===uk);

  view.x=0; view.y=0; view.s=10;
  g("strictCoh").checked=false; g("strictMove").checked=false; g("wp5Strict").checked=false; g("structMove").checked=false;
  mySide=1;

  /* ================= Pile in: hard 3" cap, snap back beyond it ================= */
  state.tokens.length=0; sel.clear(); wpResetMove(); wpCapMode=null;
  op({k:"tok+",toks:[mkTok("p1","PU",1,10,20),mkTok("p2","PU",1,10,24)]});
  op({k:"tok+",toks:[mkTok("e1","EU",2,40,20)]}); // enemy far off — just needed for the "nearest enemy" hint, never blocks

  assert(wpCapMode===null,"nothing armed before Pile in is used");
  sel.clear(); sel.add("p1"); // arm off a single model — each model is dragged independently below
  wpFightMove("pile");
  assert(!!wpCapMode&&wpCapMode.mode==="pile"&&wpCapMode.unit==="PU"&&wpCapMode.cap===3,"Pile in arms {mode:'pile',unit:'PU',cap:3}");
  assert(/Pile in.*armed/.test(logHtml()),"arming Pile in is logged with a nearest-enemy hint");

  // a 4" drag attempt is refused — the whole move snaps back to where it started
  dragTo([10,20],[14,20]);
  assert(Math.abs(tok("p1").x-10)<0.01,"pile-in: a 4\" attempt snaps back to the start position");
  assert(/Pile in undone/.test(logHtml()),"the snap-back is logged");

  // a 2" drag (within the 3" cap) commits normally, and is logged as a pile-in move
  const beforeLog=els["log"].children.length;
  dragTo([10,20],[12,20]);
  assert(Math.abs(tok("p1").x-12)<0.01,"pile-in: a 2\" move within the cap commits");
  assert(els["log"].children.slice(beforeLog).some(d=>/piled in/.test(String(d.innerHTML))),"a committed pile-in move is logged distinctly");

  // exactly 3" (within jitter) also commits — the cap is inclusive
  dragTo([10,24],[13,24]);
  assert(Math.abs(tok("p2").x-13)<0.05,"pile-in: exactly 3\" commits (cap is inclusive)");

  /* ================= Consolidate: same mechanic, different mode/label ================= */
  state.tokens.length=0; sel.clear(); wpResetMove(); wpCapMode=null;
  op({k:"tok+",toks:[mkTok("c1","CU",1,10,20)]});
  sel.clear(); sel.add("c1");
  wpFightMove("consolidate");
  assert(!!wpCapMode&&wpCapMode.mode==="consolidate"&&wpCapMode.cap===3,"Consolidate arms the same hard cap under a different mode label");
  dragTo([10,20],[15,20]); // 5" — beyond cap
  assert(Math.abs(tok("c1").x-10)<0.01,"consolidate: beyond 3\" also snaps back");
  const beforeLog2=els["log"].children.length;
  dragTo([10,20],[11,20]); // 1" — within cap
  assert(Math.abs(tok("c1").x-11)<0.01,"consolidate: within 3\" commits");
  assert(els["log"].children.slice(beforeLog2).some(d=>/consolidated/.test(String(d.innerHTML))),"a committed consolidate move is logged distinctly");

  // Escape drops the armed cap mode
  wpFightMove("pile");
  assert(!!wpCapMode,"re-armed for the Esc test");
  winHandlers.keydown({key:"Escape",target:{tagName:"CANVAS"}});
  assert(wpCapMode===null,"Esc drops any armed pile-in/consolidate");

  // ordinary Movement-phase drags (no cap armed) are completely unaffected: full Mv, +6" advance leeway
  state.tokens.length=0; sel.clear(); wpResetMove(); wpCapMode=null;
  g("strictMove").checked=true;
  op({k:"tok+",toks:[mkTok("m1","MU",1,10,20,{Mv:6})]});
  dragTo([10,20],[10+6+6+1,20]); // 13" > M+6"(12") — should still snap back under the ORIGINAL logic
  assert(Math.abs(tok("m1").x-10)<0.01,"regression: normal movement-cap snap-back (M+6\") still works when no pile-in is armed");
  g("strictMove").checked=false;

  /* ================= Fall Back: Movement-phase flag, visibly marked, cleared on the next fresh Movement phase ================= */
  state.tokens.length=0; sel.clear(); wpResetMove(); wpCapMode=null;
  op({k:"tok+",toks:[mkTok("f1","FU",1,10,10),mkTok("f2","FU",1,10,12)]});

  op({k:"phase",ph:1,side:1,round:1}); // my Movement phase
  wpFallBack("FU");
  assert(toks("FU").every(t=>t.fellBack===true),"Fall Back stamps fellBack on every model in the unit");
  assert(/falls back/.test(logHtml()),"Fall Back is logged (shared)");

  op({k:"phase",ph:2,side:1,round:1}); // Shooting — flag must persist (can't shoot/charge THIS turn)
  assert(toks("FU").every(t=>t.fellBack===true),"fellBack persists through Shooting");
  op({k:"phase",ph:3,side:1,round:1}); // Charge
  assert(toks("FU").every(t=>t.fellBack===true),"fellBack persists through Charge");
  op({k:"phase",ph:4,side:1,round:1}); // Fight
  op({k:"phase",ph:5,side:1,round:1}); // End
  op({k:"phase",ph:0,side:2,round:1}); // opponent's Command
  assert(toks("FU").every(t=>t.fellBack===true),"fellBack still set through the opponent's Command phase");
  op({k:"phase",ph:1,side:2,round:1}); // a FRESH Movement phase begins (even for the other side)
  assert(toks("FU").every(t=>!t.fellBack),"a fresh Movement phase clears every Fall Back flag");

  // Fall Back only works in the Movement phase
  op({k:"phase",ph:2,side:1,round:2});
  const beforeLog3=els["log"].children.length;
  wpFallBack("FU");
  assert(toks("FU").every(t=>!t.fellBack),"Fall Back outside the Movement phase is refused");
  assert(els["log"].children.slice(beforeLog3).some(d=>/Movement-phase action/.test(String(d.innerHTML))),"the refusal is logged");

  // visibly marked: the canvas badge hook fires without throwing (drawFallBackBadge is exercised via draw())
  op({k:"phase",ph:1,side:1,round:3});
  wpFallBack("FU");
  assert(typeof drawFallBackBadge==="function","drawFallBackBadge exists for the canvas badge");
  let threw=false; try{ draw(); }catch(e){ threw=true; }
  assert(!threw,"draw() renders a fallen-back unit without throwing");

  /* ================= Fire Overwatch: routed through the real attack roller (wp15Go/wp3Stage) ================= */
  state.tokens.length=0; sel.clear(); myArmy.length=0; state.cards={1:[],2:[]}; wpResetMove(); wpCapMode=null;
  mySide=1;
  const smIdx=DB.units.SM.findIndex(u=>u.n==="Intercessor Squad");
  const orkIdx=DB.units.ORK.findIndex(u=>u.n==="Boyz");
  assert(smIdx>=0&&orkIdx>=0,"DB has Intercessor Squad + Boyz");
  const atkCard=addFromDb("SM",smIdx,5,true); deployCard(atkCard);
  mySide=2;
  const tgtCard=addFromDb("ORK",orkIdx,10,true); deployCard(tgtCard);
  mySide=1;
  myArmy=myArmy.filter(c=>c!==tgtCard);
  const atkToks=state.tokens.filter(t=>t.owner===1), tgtToks=state.tokens.filter(t=>t.owner===2);
  assert(atkToks.length===5&&tgtToks.length===10,"5 Intercessors (mine) + 10 Boyz (enemy) deployed");
  atkToks.forEach((t,i)=>{ t.x=10+i*1.5; t.y=20; });
  tgtToks.forEach((t,i)=>{ t.x=10+i*1.5; t.y=30; }); // 10" apart — in range of the Boltgun

  // wrong phase: Fire Overwatch is Movement/Charge only
  op({k:"phase",ph:2,side:2,round:1}); // Shooting phase, opponent's turn
  sel.clear(); sel.add(atkToks[0].id); sel.add(tgtToks[0].id);
  const beforeOw1=els["log"].children.length;
  wpFightOverwatch();
  assert(g("akStage").style.display!=="block"||g("akStage").style.display==="none","wrong phase: nothing staged");
  assert(els["log"].children.slice(beforeOw1).some(d=>/Movement or Charge/.test(String(d.innerHTML))),"wrong-phase refusal is logged");

  // wrong side: Overwatch is for the player who is NOT taking their turn
  op({k:"phase",ph:1,side:1,round:1}); // MY Movement phase — I can't Overwatch on my own turn
  const beforeOw2=els["log"].children.length;
  wpFightOverwatch();
  assert(els["log"].children.slice(beforeOw2).some(d=>/NOT taking their turn/.test(String(d.innerHTML))),"active-side refusal is logged");

  // right phase + right side (their Movement phase, I'm the reactive player) but only one unit selected
  op({k:"phase",ph:1,side:2,round:1});
  sel.clear(); sel.add(atkToks[0].id);
  const beforeOw3=els["log"].children.length;
  wpFightOverwatch();
  assert(els["log"].children.slice(beforeOw3).some(d=>/shift-click/.test(String(d.innerHTML))),"single-unit selection is refused with guidance");

  // the real thing: my unit + their unit selected, correct phase/side
  sel.clear(); sel.add(atkToks[0].id); sel.add(tgtToks[0].id);
  wp3Label="";
  wpFightOverwatch();
  assert(wp3Label&&/→/.test(wp3Label),"Fire Overwatch stages a real attack (wp3Label set by wp3Stage)");
  assert(g("akBS").value==="6+","Overwatch forces \"Hit on\" to 6+ (unmodified-6 convention) after staging");
  assert(/Fire Overwatch/.test(logHtml()),"Fire Overwatch is logged (shared)");
  assert(g("akStage").style.display==="block","the attack stage banner is shown, ready to roll like any other attack");

  /* ================= P2-3 fidelity gate: a Fell-Back / Advanced unit can't shoot; Fell Back can't charge/fight ================= */
  // Reuse the Intercessors (mine, ranged+melee) vs Boyz (enemy) from the Overwatch setup, 10" apart.
  const auk=atkToks[0].unit, euk=tgtToks[0].unit;
  assert(typeof wpMoveActionBlock==="function","wpMoveActionBlock gate helper exists");
  // baseline: no flag -> not blocked, and a real shot stages
  state.tokens.filter(t=>t.unit===auk).forEach(t=>{ t.advanced=false; t.fellBack=false; });
  assert(wpMoveActionBlock(auk,false)===""&&wpMoveActionBlock(auk,true)==="","a normal unit is not gated (shoot or melee)");
  op({k:"phase",ph:2,side:1,round:1}); // my Shooting phase
  sel.clear(); wp15Atk={unit:auk,owner:1}; wp3Label="";
  wp15Go(tgtToks[0]);
  assert(!!wp3Label,"control: a normal unit still stages a shot (legal action preserved)");

  // Advanced: shooting blocked, melee (fight) still allowed
  state.tokens.filter(t=>t.unit===auk).forEach(t=>{ t.advanced=true; });
  assert(/Advanced/.test(wpMoveActionBlock(auk,false)),"Advanced unit: ranged is gated with an 'Advanced' reason");
  assert(wpMoveActionBlock(auk,true)==="","Advanced unit: melee (fight) is NOT gated");
  wp15Atk={unit:auk,owner:1}; wp3Label="";
  const rBlocked=wp15Go(tgtToks[0]);
  assert(rBlocked===undefined||!wp3Label,"Advanced unit: wp15Go stages nothing (wp3Label stays empty)");
  assert(!wp3Label,"Advanced unit: no shot staged");
  assert(/Advanced/.test(g("akStage").innerHTML)&&/Blocked/.test(g("akStage").innerHTML),"Advanced block shows a clear ⛔ reason banner");

  // Fell Back: both shooting AND charge/fight blocked
  state.tokens.filter(t=>t.unit===auk).forEach(t=>{ t.advanced=false; t.fellBack=true; });
  assert(/Fell Back/.test(wpMoveActionBlock(auk,false)),"Fell-Back unit: ranged is gated");
  assert(/charge or fight/.test(wpMoveActionBlock(auk,true)),"Fell-Back unit: melee (charge/fight) is gated too");
  // integration: the inspector melee ⚔ aim path (wp3Aim/wp3PickTarget) also refuses to stage
  sel.clear(); state.tokens.filter(t=>t.unit===auk).forEach(t=>sel.add(t.id)); wp3Inspect();
  const mi=wp3Ctx?wp3Ctx.weapons.findIndex(w=>w.melee):-1;
  if(mi>=0){ wp3Label=""; wp3Aim(mi); wp3PickTarget(tgtToks[0].x,tgtToks[0].y);
    assert(!wp3Label,"Fell-Back unit: melee ⚔ aim stages nothing"); }
  else assert(true,"(no melee profile on the test unit — melee-aim assertion skipped)");
  // clear the flag: unit acts normally again
  state.tokens.filter(t=>t.unit===auk).forEach(t=>{ t.fellBack=false; });
  assert(wpMoveActionBlock(auk,false)===""&&wpMoveActionBlock(auk,true)==="","clearing the flags un-gates the unit");

  console.log(fails?("WPFIGHT TESTS: "+fails+" FAILURES"):"WPFIGHT TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
