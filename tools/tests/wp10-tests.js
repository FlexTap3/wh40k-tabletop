;(function(){
  // WP10 — solo mode / AI opponent. Runs under harness.js (full app in node with DOM stubs).
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);
  const logHtml=()=>els["log"].children.map(d=>String(d.innerHTML||"")).join("\n");

  // ---- determinism: seed the AI RNG and the app's real dice (Math.random) ----
  aiSeed(42);
  const mb=s=>{let a=s;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};
  Math.random=mb(1337);
  aiDelay=1;

  // ---- solo / netplay mutual exclusion ----
  solo=true;
  hostGame();
  assert(peer===null,"hostGame refused while solo is on");
  joinPrompt();
  assert(peer===null&&conn===null,"joinPrompt refused while solo is on");
  solo=false;
  conn={open:true};
  aiSoloToggle();
  assert(solo===false,"solo entry refused while a peer is connected");
  conn=null;

  // ---- scripted solo game on Official 1A, fixed seed ----
  const key=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
  assert(!!key,"Official 1A layout present");
  g("terrLayout").value=key;
  loadLayout();
  assert(state.objectives.length===5&&state.dz.length===2,"layout 1A loaded (5 objectives, 2 DZs)");

  // player army: two Intercessor squads placed inside the red (side-1) DZ
  mySide=1;
  const smIdx=DB.units.SM.findIndex(u=>u.n==="Intercessor Squad");
  assert(smIdx>=0,"DB has Intercessor Squad");
  myArmy=[];
  [0,1].forEach(()=>{ const c=addFromDb("SM",smIdx,5,true); deployCard(c); });
  const red=state.tokens.filter(t=>t.owner===1);
  assert(red.length===10,"player deployed 10 models");
  red.forEach((t,i)=>{ t.x=50+(i%5)*1.6; t.y=6+Math.floor(i/5)*10; });
  op({k:"tok~",toks:red.map(t=>({id:t.id,x:t.x,y:t.y}))});
  broadcastCards();

  aiStart("ORK",1000);
  assert(solo===true,"solo mode entered");
  assert((state.cards[2]||[]).length>0,"AI cards synced into state.cards[2] (inspector works)");
  const aiPts=state.cards[2].reduce((s,c)=>s+(parseInt(c.pts)||0),0);
  assert(aiPts>0&&aiPts<=1000,"AI list respects the points limit ("+aiPts+" <= 1000)");
  const aiToks=()=>state.tokens.filter(t=>t.owner===2);
  assert(aiToks().length>0,"AI deployed models ("+aiToks().length+")");
  const bluePoly=state.dz[1];
  assert(aiToks().every(t=>wp7PtInPoly(t.x,t.y,bluePoly)),"every AI model deployed inside the side-2 DZ polygon");
  assert(aiToks().every(t=>!wp5Illegal(t)),"no AI model deployed onto impassable terrain");
  checkCoherency();
  assert(aiToks().every(t=>!incoherent.has(t.id)),"AI deployment is coherent");
  const rsvHeld=(state.reserves[2]||[]).length;
  console.log("   (AI holds "+rsvHeld+" unit(s) in Strategic Reserves)");

  // ---- 2 full AI turns via the real phase engine ----
  const aiLegal=label=>{
    assert(aiToks().every(t=>!wp5Illegal(t)),label+": no AI model ends on impassable terrain");
    checkCoherency();
    assert(aiToks().every(t=>!incoherent.has(t.id)),label+": AI unit coherency holds");
    assert(aiToks().every(t=>t.x>=0&&t.x<=state.board.w&&t.y>=0&&t.y<=state.board.h),label+": AI models on the battlefield");
  };
  const cp0={1:state.trackers.cp1,2:state.trackers.cp2};
  for(let i=0;i<6;i++) wp7Step(1);            // Deploy -> my Command..End (round 1)
  wp7Step(1);                                  // hand over -> AI Command r1
  assert(state.phase.side===2&&state.phase.ph===0,"AI turn 1 begins (side 2, Command)");
  assert(state.trackers.cp1===cp0[1]+2&&state.trackers.cp2===cp0[2]+2,"CP ticked once per Command phase so far");
  aiFinishTurn();                              // ⏭-equivalent: play the whole AI turn synchronously
  assert(state.phase.side===1&&state.phase.ph===0&&state.trackers.round===2,"AI finished turn 1; round 2 back to the player");
  aiLegal("turn 1");
  assert(aiToks().some(t=>!wp7PtInPoly(t.x,t.y,bluePoly)),"AI pushed units out of its deployment zone");
  assert(aiShotLog.filter(s=>!s.melee).every(s=>s.vis&&s.dist<=s.rng+0.02),"every AI shot was at a visible unit in range ("+aiShotLog.length+" attacks logged)");

  for(let i=0;i<5;i++) wp7Step(1);             // my r2 Command..End
  wp7Step(1);                                  // -> AI r2
  aiFinishTurn();
  assert(state.phase.side===1&&state.phase.ph===0&&state.trackers.round===3,"AI finished turn 2; round 3 back to the player");
  aiLegal("turn 2");
  assert(aiShotLog.filter(s=>!s.melee).every(s=>s.vis&&s.dist<=s.rng+0.02),"turn 2: all AI shooting still range+LoS legal");
  assert(state.trackers.cp1===cp0[1]+5&&state.trackers.cp2===cp0[2]+5,"CP ticked exactly once per Command phase (5 grants)");
  assert(/End of AI turn/.test(logHtml()),"AI logs an end-of-turn objective summary");
  if(rsvHeld) assert((state.reserves[2]||[]).length<rsvHeld||/Strategic Reserves/.test(logHtml()),"reserve unit arrived (or attempt logged) from round 2");

  // ---- battle-shock: force an AI unit below half, replay its Command logic ----
  const bigUnit=(function(){ const by={}; aiToks().forEach(t=>(by[t.unit]=by[t.unit]||[]).push(t));
    return Object.values(by).filter(ms=>ms.length>=4).sort((a,b)=>b.length-a.length)[0]; })();
  assert(!!bigUnit,"a multi-model AI unit exists for the battle-shock test");
  if(bigUnit){
    const start=Math.max(...bigUnit.map(t=>+t.u0||0))||bigUnit.length;
    const keep=Math.floor(start/2);
    op({k:"tok-",ids:bigUnit.slice(keep).map(t=>t.id)});
    const before=els["log"].children.length;
    aiCommand();
    while(aiQueue.length) aiQueue.shift()();
    const ms=state.tokens.filter(t=>t.unit===bigUnit[0].unit);
    assert(ms.length>0&&ms.every(t=>typeof t.bs==="boolean"),"below-half AI unit took a battle-shock test (bs flag set)");
    assert(els["log"].children.slice(before).some(d=>/Battle-shock/.test(String(d.innerHTML))),"battle-shock 2D6 roll logged");
  }

  // ---- casualty allocation: closest first, sergeant last, packet spill lost ----
  const mk=(id,x,sgt,w)=>({id,owner:2,unit:"casU",name:"CasBoy",shape:"c",dmm:32,x,y:40,rot:0,
    wounds:w||1,maxW:w||1,Mv:6,OC:2,T:5,Sv:"5+",iv:"-",kw:["INFANTRY"],u0:5,sgt:sgt||false});
  op({k:"tok+",toks:[mk("ct1",10),mk("ct2",12),mk("ct3",14),mk("ct4",16),mk("ct5",18,true)]});
  op({k:"tok+",toks:[{id:"at1",owner:1,unit:"atkU",name:"Shooter",shape:"c",dmm:32,x:6,y:40,rot:0,wounds:2,maxW:2,kw:["INFANTRY"]}]});
  aiApplyCasualties("casU",[1,1,1],3,"atkU");
  assert(["ct1","ct2","ct3"].every(id=>!state.tokens.some(t=>t.id===id)),"3 damage removed the 3 models closest to the attacker");
  assert(state.tokens.some(t=>t.id==="ct5"),"sergeant is allocated last (still alive)");
  aiApplyCasualties("casU",[5],5,"atkU");
  assert(!state.tokens.some(t=>t.id==="ct4")&&state.tokens.some(t=>t.id==="ct5"),"excess damage in one packet is lost (one model per packet)");
  // wounded model must take the next packet first
  op({k:"tok+",toks:[
    {id:"nw1",owner:2,unit:"nobU",name:"Nob",shape:"c",dmm:32,x:20,y:40,rot:0,wounds:2,maxW:2,kw:["INFANTRY"],u0:2},
    {id:"nw2",owner:2,unit:"nobU",name:"Nob",shape:"c",dmm:32,x:10,y:40,rot:0,wounds:1,maxW:2,kw:["INFANTRY"],u0:2}]});
  aiApplyCasualties("nobU",[1],1,"atkU");
  assert(!state.tokens.some(t=>t.id==="nw2")&&state.tokens.some(t=>t.id==="nw1"),"already-wounded model takes damage first (despite being closer/farther)");

  // ---- player-staged attack offers auto-apply (confirm stub says yes) ----
  op({k:"tok+",toks:[mk("pc1",30),Object.assign(mk("pc2",32),{id:"pc2"})]});
  state.tokens.filter(t=>["pc1","pc2"].includes(t.id)).forEach(t=>t.unit="pcU");
  op({k:"tok~",toks:[{id:"pc1",unit:"pcU"},{id:"pc2",unit:"pcU"}]});
  wp3Label="⚔ test → CasBoy · Testgun";
  aiNoteStage({tok:{unit:"atkU"}},{unit:"pcU"});
  g("akD").value="1";
  wp10AttackDone(2,2,0,[]);
  assert(state.tokens.filter(t=>t.unit==="pcU").length===0,"player-rolled staged attack auto-applied casualties on confirm");
  wp3Label="";

  // ---- cancel safety: aiInterrupt kills the queue and timer ----
  aiQueue.push(()=>{});
  aiInterrupt();
  assert(aiQueue.length===0&&aiTimer===null,"aiInterrupt clears the AI action queue and timer");

  // ---- 5-round fuzz: random seed, no exceptions, score line logged ----
  aiSeed((Date.now()&0xffffffff)>>>0);
  let threw=null;
  try{
    let guard=0;
    while(state.trackers.round<=5&&guard++<300){
      if(state.phase.side===1) wp7Step(1);
      else aiFinishTurn();
    }
  }catch(e){ threw=e; }
  assert(!threw,"5-round fuzz run threw no exceptions"+(threw?(" — "+threw.message):""));
  assert(state.trackers.round>5,"fuzz reached the end of round 5 (round now "+state.trackers.round+")");
  assert(aiToks().every(t=>!wp5Illegal(t)),"fuzz: no AI model on impassable terrain at the end");
  assert(/End of AI turn/.test(logHtml()),"fuzz: end-of-turn score lines logged");

  // ---- exiting solo restores netplay ----
  aiStop();
  assert(solo===false,"solo mode exits cleanly");
  hostGame();
  assert(peer!==null,"hosting works again after leaving solo mode");

  console.log(fails?("WP10 TESTS: "+fails+" FAILURES"):"WP10 TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
