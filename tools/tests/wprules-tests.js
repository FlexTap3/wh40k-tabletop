// WP-RULES — CP economy tracker, Core Stratagems (game-functional data only), per-phase
// reminders, per-detachment user notes. Run via  node harness.js wprules-tests.js
;(function(){
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);
  const logHtml=()=>els["log"].children.map(d=>String(d.innerHTML||"")).join("\n");

  mySide=1;
  const mkTok=(id,unit,owner,x,y,o)=>Object.assign({id,owner,unit,name:unit,shape:"c",dmm:32,x,y,rot:0,
    wounds:1,maxW:1,Mv:6,OC:2,T:4,Sv:"3+",iv:"-",kw:["INFANTRY"],u0:5},o||{});

  /* ================= Core Stratagems: data shape, count, no rules prose ================= */
  assert(Array.isArray(CORE_STRATS)&&CORE_STRATS.length===11,"CORE_STRATS ships exactly the 11 universal Core Stratagems ("+CORE_STRATS.length+")");
  CORE_STRATS.forEach(s=>{
    assert(typeof s.name==="string"&&s.name.length>0,"stratagem has a name: "+JSON.stringify(s));
    assert(typeof s.cp==="number"&&s.cp>0,"stratagem "+s.name+" has a positive CP cost");
    assert(typeof s.phase==="string"&&s.phase.length>0,"stratagem "+s.name+" has a phase tag");
  });
  // game-functional data ONLY: no field beyond name/cp/phase, and no long prose hiding in the name
  CORE_STRATS.forEach(s=>{
    assert(Object.keys(s).sort().join(",")==="cp,name,phase","stratagem "+s.name+" carries only {name,cp,phase} — no effect text field");
    assert(s.name.length<=30,"stratagem name is a short label, not prose: "+s.name);
  });
  const names=CORE_STRATS.map(s=>s.name);
  ["Command Re-roll","Counter-offensive","Epic Challenge","Insane Bravery","Grenade","Tank Shock",
   "Fire Overwatch","Rapid Ingress","Go to Ground","Smokescreen","Heroic Intervention"].forEach(n=>
    assert(names.includes(n),"CORE_STRATS includes "+n));

  /* ================= per-phase filtering ================= */
  const tagsOf=ph=>wpRulesStratsForPhase(ph).map(s=>s.name);
  const command=tagsOf(0), movement=tagsOf(1), shooting=tagsOf(2), charge=tagsOf(3), fight=tagsOf(4), end=tagsOf(5);
  assert(command.includes("Insane Bravery")&&command.includes("Command Re-roll"),"Command phase: Insane Bravery + the any-phase Command Re-roll");
  assert(!command.includes("Tank Shock"),"Command phase excludes Charge-phase stratagems");
  assert(movement.includes("Fire Overwatch")&&movement.includes("Command Re-roll"),"Movement phase: Fire Overwatch (+ any-phase)");
  assert(shooting.includes("Grenade")&&shooting.includes("Go to Ground")&&shooting.includes("Smokescreen"),"Shooting phase: Grenade, Go to Ground, Smokescreen");
  assert(charge.includes("Tank Shock")&&charge.includes("Heroic Intervention"),"Charge phase: Tank Shock, Heroic Intervention");
  assert(fight.includes("Counter-offensive")&&fight.includes("Epic Challenge"),"Fight phase: Counter-offensive, Epic Challenge");
  assert(end.includes("Rapid Ingress"),"End phase: Rapid Ingress");
  // "any" phase stratagem shows up in every phase; a phase-specific one is excluded elsewhere
  [command,movement,shooting,charge,fight,end].forEach(list=>assert(list.includes("Command Re-roll"),"Command Re-roll (any phase) appears in every phase's list"));
  assert(!shooting.includes("Tank Shock")&&!fight.includes("Tank Shock")&&!movement.includes("Tank Shock")&&!command.includes("Tank Shock")&&!end.includes("Tank Shock"),
    "Tank Shock (Charge only) is excluded from every other phase");

  /* ================= CP economy: +1 on Command phase, spend/block on stratagem use ================= */
  state.tokens.length=0; sel.clear();
  state.trackers={round:1,cp1:0,cp2:0,vp1:0,vp2:0}; state.phase={side:1,ph:-1,cpDone:{}};
  op({k:"phase",ph:0,side:1,round:1});
  assert(state.trackers.cp1===1&&state.trackers.cp2===1,"entering the Command phase grants +1 CP to BOTH players, automatically");
  op({k:"phase",ph:0,side:1,round:1}); // idempotent re-apply of the identical op
  assert(state.trackers.cp1===1&&state.trackers.cp2===1,"re-applying the same Command-phase op grants nothing extra");

  // manual +/- buttons still work and now log a shared spend line
  const beforeLog=els["log"].children.length;
  stepTracker("cp1",1);
  assert(state.trackers.cp1===2,"manual + button still adjusts CP");
  assert(els["log"].children.slice(beforeLog).some(d=>/gained 1 CP \(now 2\)/.test(String(d.innerHTML))),"manual CP gain is logged (shared)");
  const beforeLog2=els["log"].children.length;
  stepTracker("cp1",-1);
  assert(state.trackers.cp1===1&&els["log"].children.slice(beforeLog2).some(d=>/spent 1 CP \(now 1\)/.test(String(d.innerHTML))),"manual − button logs a spend line");

  // stratagem click spends CP and logs it
  state.trackers.cp1=2;
  const beforeLog3=els["log"].children.length;
  wpRulesUseStrat("Command Re-roll"); // 1CP
  assert(state.trackers.cp1===1,"using a 1CP stratagem deducts exactly 1 CP");
  assert(els["log"].children.slice(beforeLog3).some(d=>/used <b>Command Re-roll<\/b> \(1CP\)/.test(String(d.innerHTML))),"stratagem use is logged: \"used <name> (nCP)\"");

  // blocked when CP too low
  state.trackers.cp1=0;
  const beforeLog4=els["log"].children.length;
  wpRulesUseStrat("Counter-offensive"); // 2CP
  assert(state.trackers.cp1===0,"insufficient CP: the spend is blocked, CP unchanged");
  assert(els["log"].children.slice(beforeLog4).some(d=>/Not enough CP/.test(String(d.innerHTML))),"the block is logged with a reason");

  // spending is always from MY side's pool, even if I'm looking at the other player's tracker
  state.trackers.cp1=5; state.trackers.cp2=5;
  wpRulesUseStrat("Grenade"); // mySide=1
  assert(state.trackers.cp1===4&&state.trackers.cp2===5,"a stratagem spends the CURRENT player's (mySide) CP only");

  /* ================= per-phase reminder banner ================= */
  op({k:"phase",ph:0,side:1,round:2});
  assert(g("wpRulesReminder").style.display==="block","the reminder banner shows on a phase change");
  assert(/Gain 1 CP/.test(g("wpRulesReminder").innerHTML),"Command-phase reminder mentions gaining CP");
  g("wpRulesReminder").style.display="none"; // dismiss
  op({k:"phase",ph:1,side:1,round:2});
  assert(g("wpRulesReminder").style.display==="block","the next phase change re-shows the (dismissed) banner");
  assert(/Fall Back/.test(g("wpRulesReminder").innerHTML),"Movement-phase reminder mentions Fall Back");

  // Space Marines: Oath of Moment surfaces specifically in the Command phase
  myArmy.length=0;
  myArmy.push({name:"Intercessors",pts:"100",weapons:"",notes:"",kw:["SPACE MARINES","INFANTRY"],
    profiles:[{n:"Intercessors",count:5,base:"32mm",M:'6"',T:4,Sv:"3+",Inv:"-",W:2,Ld:"6+",OC:2}]});
  op({k:"phase",ph:0,side:1,round:3});
  assert(/Oath of Moment/.test(g("wpRulesReminder").innerHTML),"Space Marines get the Oath of Moment reminder in the Command phase");
  op({k:"phase",ph:1,side:1,round:3});
  assert(!/Oath of Moment/.test(g("wpRulesReminder").innerHTML),"Oath of Moment is Command-phase only, not shown in Movement");
  myArmy.length=0;

  /* ================= per-detachment notes: user-entered, localStorage only ================= */
  g("wpRulesNotes").value="Rhino Rush — 1CP, Charge phase — my note";
  wpRulesSaveNotes();
  assert(wpRulesNotes==="Rhino Rush — 1CP, Charge phase — my note","saving the notes textarea updates the in-memory copy");
  wpRulesNotes="something else entirely";
  wpRulesLoadNotes();
  assert(g("wpRulesNotes").value==="something else entirely","loading notes pushes the stored text back into the textarea");

  console.log(fails?("WPRULES TESTS: "+fails+" FAILURES"):"WPRULES TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
