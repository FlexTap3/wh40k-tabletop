;(function(){
  // WP11 — defender casualty allocation + meta-doctrine AI. Runs under harness.js.
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);
  const logHtml=()=>els["log"].children.map(d=>String(d.innerHTML||"")).join("\n");
  const cvEl=els["board"];
  const click=(x,y)=>cvEl.handlers.pointerdown({offsetX:x*10,offsetY:y*10,button:0,shiftKey:false,altKey:false});
  const key=k=>winHandlers.keydown({key:k,target:{tagName:"DIV"},preventDefault(){}});

  // determinism
  aiSeed(42);
  const mb=s=>{let a=s;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};
  Math.random=mb(1337);
  aiDelay=1;
  view.x=0; view.y=0; view.s=10;
  g("strictCoh").checked=false; g("strictMove").checked=false; g("wp5Strict").checked=true;
  g("wp11AutoCas").checked=false; // defender allocation is the default behaviour

  const mkTok=(id,unit,owner,x,y,o)=>Object.assign({id,owner,unit,name:unit,shape:"c",dmm:32,x,y,rot:0,
    wounds:1,maxW:1,Mv:6,OC:2,T:4,Sv:"3+",iv:"-",kw:["INFANTRY"],u0:5},o||{});
  const toks=uk=>state.tokens.filter(t=>t.unit===uk);

  /* ================= Part A: defender allocates casualties ================= */
  solo=true; state.objectives=[]; state.tokens=[]; state.terrain=[]; sel.clear();

  // AI attack damages the player's unit → packets queue, banner shows, AI queue pauses
  op({k:"tok+",toks:[1,2,3,4,5].map(i=>mkTok("p"+i,"pu",1,10+i*2,20,{wounds:2,maxW:2,sgt:i===5}))});
  op({k:"tok+",toks:[mkTok("a1","au",2,4,20)]});
  let markerRan=false; aiQueue.push(()=>{markerRan=true;});
  aiActing=true; aiCurTgt="pu"; aiCurAtk="au";
  wp10AttackDone(4,3,1,[1,1,1]);           // 3 failed saves ×1 dmg + 1 mortal, total 4
  aiActing=false; aiCurTgt=null; aiCurAtk=null;
  assert(!!wp11Alloc,"AI attack on a player unit queues damage packets instead of auto-applying");
  assert(wp11Alloc&&wp11Alloc.packets.length===4&&wp11Alloc.budget===4,"packets: one per failed save + one per mortal, capped at the rolled total");
  assert(g("wp11Banner").style.display==="block"&&/packet/.test(g("wp11Banner").innerHTML),"allocation banner is shown with the packet count");
  aiPump();
  assert(!markerRan&&aiTimer===null,"AI action queue does NOT advance while packets are pending (aiPump held)");
  aiFinishTurn();
  assert(!markerRan,"⏭ fast-forward also waits for allocation");

  // Esc does not cancel (damage is owed)
  key("Escape");
  assert(!!wp11Alloc,"Esc does not cancel a pending allocation");

  // player clicks allocate one packet at a time; a wounded model must take packets first
  click(12,20);                             // p1 (2W) takes 1 → wounded 1/2
  assert(toks("pu").find(t=>t.id==="p1").wounds===1&&wp11Alloc.packets.length===3,"clicking a model applies exactly one packet (via tok~)");
  const before=els["log"].children.length;
  click(18,20);                             // p3 clicked, but p1 is wounded → redirected
  assert(toks("pu").every(t=>t.id!=="p1"),"wounded-first guardrail: packet redirected to the wounded model (now slain via tok-)");
  assert(toks("pu").find(t=>t.id==="p3").wounds===2,"the clicked fresh model was NOT damaged while a wounded model existed");
  assert(els["log"].children.slice(before).some(d=>/redirected/i.test(String(d.innerHTML))),"redirection is logged");

  // A key auto-finishes the rest; the AI queue resumes
  key("a");
  assert(wp11Alloc===null,"A auto-assigns the remaining packets and closes the allocation");
  assert(g("wp11Banner").style.display==="none","banner hides when allocation completes");
  assert(toks("pu").reduce((s,t)=>s+t.wounds,0)===10-4,"exactly the rolled 4 damage was applied in total");
  aiFinishTurn();
  assert(markerRan,"AI action queue resumes after allocation completes");

  // auto-finish (A) matches WP10's automatic allocation exactly
  state.tokens=[]; sel.clear();
  op({k:"tok+",toks:[mkTok("atk2","atk2",2,5,30)]});
  [1,2,3,4,5].forEach(i=>op({k:"tok+",toks:[mkTok("x"+i,"UX",1,8+i*2,30,{sgt:i===5})]}));
  [1,2,3,4,5].forEach(i=>op({k:"tok+",toks:[mkTok("y"+i,"UY",1,8+i*2,34,{sgt:i===5})]}));
  aiActing=true; aiCurTgt="UX"; aiCurAtk="atk2"; wp10AttackDone(3,3,0,[1,1,1]); aiActing=false; aiCurTgt=null; aiCurAtk=null;
  assert(!!wp11Alloc,"second allocation pends");
  wp11AllocAuto();                          // player path: A / banner button
  aiApplyCasualties("UY",[1,1,1],3,"atk2"); // WP10 automatic path, identical inputs
  const survX=toks("UX").map(t=>t.id.slice(1)).sort().join(","), survY=toks("UY").map(t=>t.id.slice(1)).sort().join(",");
  assert(survX===survY&&survX==="4,5","A = auto-finish allocates exactly like WP10 (closest first, sgt last): survivors "+survX);

  // Setup toggle restores the hands-off behaviour
  g("wp11AutoCas").checked=true;
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("z"+i,"UZ",1,8+i*2,38))});
  aiActing=true; aiCurTgt="UZ"; aiCurAtk="atk2"; wp10AttackDone(2,2,0,[1,1]); aiActing=false; aiCurTgt=null; aiCurAtk=null;
  assert(wp11Alloc===null&&toks("UZ").length===1,"'Auto-apply my casualties' toggle: damage applied automatically, nothing pends");
  g("wp11AutoCas").checked=false;

  // AI-owned casualties stay automatic (the AI is the defender there)
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("b"+i,"BU",2,30+i*2,38))});
  wp3Label="⚔ test"; aiNoteStage({tok:{unit:"UZ"}},{unit:"BU"});
  g("akD").value="1";
  wp10AttackDone(2,2,0,[1,1]);
  wp3Label="";
  assert(wp11Alloc===null&&toks("BU").length===1,"player-rolled attack on an AI unit stays auto-applied (no allocation pause)");

  // clear discards pending packets
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("c"+i,"CU",1,8+i*2,42))});
  aiActing=true; aiCurTgt="CU"; aiCurAtk="atk2"; wp10AttackDone(2,2,0,[1,1]); aiActing=false; aiCurTgt=null; aiCurAtk=null;
  assert(!!wp11Alloc,"allocation pending before clear");
  clearTable();
  assert(wp11Alloc===null&&g("wp11Banner").style.display==="none","Clear table discards the pending queue and hides the banner");

  // undo discards pending packets too
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("d"+i,"DU",1,8+i*2,20))});
  aiActing=true; aiCurTgt="DU"; aiCurAtk="atk2"; wp10AttackDone(2,2,0,[1,1]); aiActing=false; aiCurTgt=null; aiCurAtk=null;
  assert(!!wp11Alloc,"allocation pending before undo");
  wp1Undo();
  assert(wp11Alloc===null,"Undo discards the pending queue (damage never half-applied)");

  /* ================= Part B: meta lists + plan profiles ================= */
  assert(AI_META_LISTS.length===5,"5 meta lists embedded");
  assert(wp11PlanFromDisposition("Priority Assets")==="hold","Priority Assets → hold plan");
  assert(wp11PlanFromDisposition("Purge the Foe")==="purge","Purge the Foe → purge plan");
  assert(wp11PlanFromDisposition("Disruption, Take and Hold")==="hold","Disruption, Take and Hold → hold plan");
  assert(wp11PlanFromDisposition("Reconnaissance")==="recon","Reconnaissance → recon plan");
  // no GW rules prose in the embedded list text: unit/points/count/header/structural lines only.
  // (WP-META-REFRESH: the June-27 refresh switched to FULL verbatim list text — including wargear
  // breakdowns and section headers — so the source lists still parse cleanly for faction/disposition
  // detection. That legitimately introduces new, non-prose line shapes: section headers, "Attached
  // Unit N" markers, "Attached as: Leader/Bodyguard/Support (Character)", "Warlord",
  // "Enhancement(s): <name>", and legion/chapter declaration lines (e.g. "Dark Angels", "Iron Hands" —
  // proper nouns, not rules text). None of these are GW rules PROSE (ability wording/rules text) —
  // they're still just names/structure — so the allow-list grows but the real assertion (no rules
  // prose ever gets embedded) is unchanged and still enforced.)
  const chapterNames=new Set(["dark angels","iron hands"]);
  AI_META_LISTS.forEach(m=>{
    const bad=m.text.split("\n").filter(l=>{
      l=l.replace(/[•●▪]/g,"").trim();
      return l&&!/^\d+x\s+/.test(l)&&!/\(\d[\d,]*\s*points?\)$/i.test(l)&&!/^force dispositions?:/i.test(l)
        &&!/\(\d[\d,]*\s*detachment points?\)$/i.test(l)&&!DB.factions.some(([id,n])=>norm(n)===norm(l))
        &&!chapterNames.has(norm(l))
        &&!/^attached units?(\s+\d+)?$/i.test(l)
        &&!/^attached as:\s*(leader|bodyguard|support)(\s*\(character\))?$/i.test(l)
        &&!/^(characters|battleline|dedicated transports|other datasheets)$/i.test(l)
        &&!/^enhancements?:/i.test(l)
        &&!/^warlord$/i.test(l);
    });
    assert(bad.length===0,m.name+": list text is names/points/counts/structural-header lines only, no rules prose"+(bad.length?" (offending: "+bad[0]+")":""));
  });

  const layoutKey=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
  const expect=[ // printed totals + plan per list header (June-27 refresh: 5 new top-table lists)
    {pts:2000,plan:"hold",units:18},{pts:1995,plan:"hold",units:15},{pts:1985,plan:"hold",units:17},
    {pts:2000,plan:"hold",units:14},{pts:1975,plan:"recon",units:19}];
  AI_META_LISTS.forEach((m,i)=>{
    clearTable();
    g("terrLayout").value=layoutKey; loadLayout();
    const parsed=wp11ParseList(m.text);
    assert(parsed.fid===m.fid,m.name+": faction auto-detected from header ("+parsed.fid+")");
    assert(parsed.units.length===expect[i].units,m.name+": parsed "+parsed.units.length+" unit entries (expected "+expect[i].units+")");
    assert(parsed.units.reduce((s,u)=>s+u.pts,0)===expect[i].pts,m.name+": unit points sum to the printed total "+expect[i].pts);
    wp11StartMeta(i);
    const cards=state.cards[2]||[];
    assert(cards.length===parsed.units.length,m.name+": every unit mustered via importArmyList ("+cards.length+"/"+parsed.units.length+")");
    const cpts=cards.reduce((s,c)=>s+(parseInt(c.pts)||0),0);
    assert(cpts===expect[i].pts,m.name+": musters at printed points ("+cpts+" = "+expect[i].pts+")");
    const nTok=state.tokens.filter(t=>t.owner===2).length+((state.reserves[2]||[]).reduce((s,r)=>s+(r.toks||[]).length,0));
    const nList=parsed.units.reduce((s,u)=>s+(u.models||1),0);
    assert(nTok===nList,m.name+": model count on table+reserves matches the list ("+nTok+" = "+nList+")");
    assert(aiPlan===expect[i].plan,m.name+": plan '"+aiPlan+"' picked from disposition '"+(parsed.disp||m.disposition)+"'");
    assert(new RegExp("Game plan").test(logHtml()),m.name+": AI announced its game plan at muster");
  });
  // auto-built lists default to Take and Hold
  clearTable();
  g("terrLayout").value=layoutKey; loadLayout();
  aiStart("ORK",1000);
  assert(aiPlan==="hold","auto-built list plays the Take and Hold profile");

  /* ================= seeded doctrine scenarios ================= */
  g("wp11AutoCas").checked=true; // hands-off casualties: these scenarios test decisions, not allocation
  const card=(owner,name,pts,o)=>{
    const c=Object.assign({name,pts:String(pts),notes:"",kw:["INFANTRY"],
      profiles:[{n:name,count:5,M:'6"',T:4,Sv:"3+",W:1,Ld:"6+",OC:2,base:"32mm"}],weapons:""},o||{});
    state.cards[owner]=(state.cards[owner]||[]).concat([c]); return c;
  };
  const reset=()=>{ clearTable(); state.cards={1:[],2:[]}; aiShotLog.length=0; wp11ShotMark=0; wp11MoveCache={key:""};
    solo=true; aiSeed(7); Math.random=mb(7); wp11SetPlan("hold",""); els["log"].children.length=0; };

  // 1. Hidden: a quiet, eligible dense-terrain infantry unit gets toggled Hidden after shooting
  reset();
  state.terrain.push({id:"r1",kind:"ruin",x:20,y:16,w:8,h:8,rot:0});
  card(2,"Quiet Squad",80,{weapons:'Popgun | 12" | 1 | 4+ | 3 | 0 | 1'});
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("h"+i,"HQU",2,22+i*1.5,20,{name:"Quiet Squad"}))});
  op({k:"tok+",toks:[mkTok("e1","ENE",1,55,40)]});     // enemy far outside the popgun's reach
  card(1,"ENE",100,{profiles:[{n:"ENE",count:1,M:'6"',T:4,Sv:"3+",W:1,Ld:"6+",OC:2,base:"32mm"}]});
  wp11ShotMark=aiShotLog.length;
  wp11HiddenSweep();
  while(aiQueue.length) aiQueue.shift()();
  assert(state.tokens.filter(t=>t.unit==="HQU").every(t=>t.hid===true),"doctrine 1: quiet low-output infantry in dense terrain goes Hidden");
  assert(/Hidden/.test(logHtml()),"doctrine 1: Hidden toggle is logged");
  // ...and a unit that shot this turn does not
  aiShotLog.push({atk:"HQU",tgt:"ENE",dist:10,rng:12,vis:true,weapon:"Popgun"});
  wp11HiddenSweep(); while(aiQueue.length) aiQueue.shift()();
  assert(state.tokens.filter(t=>t.unit==="HQU").every(t=>!t.hid),"doctrine 1: a unit that opened fire loses / doesn't take Hidden");

  // 2. Screening: a cheap unit pickets between the fast melee threat and the valuable unit
  reset();
  card(2,"Big Brick",300,{profiles:[{n:"Big Brick",count:3,M:'5"',T:6,Sv:"2+",W:3,Ld:"6+",OC:2,base:"40mm"}]});
  card(2,"Cheap Screen",60);
  card(1,"Fast Blender",150,{profiles:[{n:"Fast Blender",count:3,M:'12"',T:5,Sv:"3+",W:3,Ld:"6+",OC:2,base:"40mm"}],
    weapons:"Claws | Melee | 4 | 3+ | 6 | -2 | 2"});
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("bb"+i,"BBU",2,49+i,22,{name:"Big Brick",Mv:5}))});
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("cs"+i,"CSU",2,45+i,18,{name:"Cheap Screen",Mv:10}))});
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("fb"+i,"FBU",1,29+i,22,{name:"Fast Blender",Mv:12}))});
  aiMoveUnit("CSU");
  const csx=toks("CSU").reduce((s,t)=>s+t.x,0)/3, csy=toks("CSU").reduce((s,t)=>s+t.y,0)/3;
  const dProt=Math.hypot(csx-51,csy-22), dThreat=Math.hypot(csx-30,csy-22);
  assert(dProt>=3&&dProt<=11&&dThreat<Math.hypot(51-30,0),"doctrine 2: cheap unit screens 6–8\" ahead of the valuable unit, threat side (at "+dProt.toFixed(1)+"\" from it)");

  // 3. Staging: round 1, outgunned shooter prefers the out-of-LoS dense spot over an open lane
  reset();
  state.trackers.round=1;
  state.terrain.push({id:"r2",kind:"ruin",x:38,y:18,w:8,h:8,rot:0});
  card(2,"Shy Gunners",100,{weapons:'Carbine | 18" | 1 | 4+ | 4 | 0 | 1'});
  card(1,"Big Guns",300,{profiles:[{n:"Big Guns",count:3,M:'5"',T:5,Sv:"3+",W:2,Ld:"6+",OC:2,base:"32mm"}],
    weapons:'Cannon | 36" | 3 | 3+ | 8 | -2 | 3'});
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("sg"+i,"SGU",2,39.2+i*1.4,27.5,{name:"Shy Gunners"}))});
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("bg"+i,"BGU",1,10+i*2,28,{name:"Big Guns",Mv:5}))});
  aiMoveUnit("SGU");
  const inRuin=toks("SGU").filter(t=>t.x>=38&&t.x<=46&&t.y>=18&&t.y<=26).length;
  assert(inRuin>=2,"doctrine 3: outgunned shooters stage into dense terrain round 1 ("+inRuin+"/3 models in the ruin)");

  // 4a. Focus fire: the AI finishes the wounded unit instead of spreading onto a fresh one
  reset();
  card(2,"Gunline",120,{weapons:'Rifle | 24" | 2 | 3+ | 4 | -1 | 1'});
  card(1,"Fresh Squad",100);
  card(1,"Hurt Squad",100);
  op({k:"tok+",toks:[1,2,3,4,5].map(i=>mkTok("gl"+i,"GLU",2,20+i*1.5,10,{name:"Gunline"}))});
  op({k:"tok+",toks:[1,2,3,4,5].map(i=>mkTok("fs"+i,"FSU",1,18+i*1.5,22,{name:"Fresh Squad"}))});
  op({k:"tok+",toks:[1,2].map(i=>mkTok("hs"+i,"HSU",1,24+i*1.5,22,{name:"Hurt Squad"}))}); // 2 of 5 left
  aiShootUnit("GLU");
  while(aiQueue.length) aiQueue.shift()();
  const shots=aiShotLog.filter(s=>s.atk==="GLU");
  assert(shots.length>0&&shots.every(s=>s.tgt==="HSU"),"doctrine 4: fire concentrated to finish the wounded unit (targets: "+shots.map(s=>s.tgt).join(",")+")");

  // 6. Don't chase kiters: slow melee holds its objective instead of chasing a faster shooter
  reset();
  card(2,"Slow Choppas",90,{profiles:[{n:"Slow Choppas",count:5,M:'5"',T:5,Sv:"5+",W:1,Ld:"7+",OC:2,base:"32mm"}],
    weapons:"Choppa | Melee | 3 | 3+ | 5 | -1 | 1"});
  card(1,"Kite Bikes",120,{profiles:[{n:"Kite Bikes",count:3,M:'12"',T:5,Sv:"3+",W:3,Ld:"6+",OC:2,base:"40mm"}],
    weapons:'Twin Gun | 24" | 4 | 3+ | 5 | -1 | 2'});
  op({k:"obj+",obj:{id:"homeObj",x:44,y:22}});
  op({k:"tok+",toks:[1,2,3,4,5].map(i=>mkTok("sc"+i,"SCU",2,42+i*1.2,20,{name:"Slow Choppas",Mv:5}))});
  op({k:"tok+",toks:[1,2,3].map(i=>mkTok("kb"+i,"KBU",1,20+i*2,22,{name:"Kite Bikes",Mv:12}))});
  const d0=Math.min(...state.tokens.filter(t=>t.unit==="SCU").map(t=>Math.min(...state.tokens.filter(e=>e.unit==="KBU").map(e=>Math.hypot(t.x-e.x,t.y-e.y)))));
  aiMoveUnit("SCU");
  const d1=Math.min(...state.tokens.filter(t=>t.unit==="SCU").map(t=>Math.min(...state.tokens.filter(e=>e.unit==="KBU").map(e=>Math.hypot(t.x-e.x,t.y-e.y)))));
  const scx=toks("SCU").reduce((s,t)=>s+t.x,0)/5, scy=toks("SCU").reduce((s,t)=>s+t.y,0)/5;
  const onObj=Math.hypot(scx-44,scy-22)<=4;
  assert(d1>=d0-1.5&&onObj,"doctrine 6: slow melee declines the chase (closed "+(d0-d1).toFixed(1)+"\") and sits on the objective");

  // once-per-round strategic brief
  reset();
  g("terrLayout").value=layoutKey; loadLayout();
  aiStart("ORK",1000);
  els["log"].children.length=0;
  for(let i=0;i<6;i++) wp7Step(1);
  wp7Step(1); aiFinishTurn();
  const briefs=els["log"].children.filter(d=>/Round \d — /.test(String(d.innerHTML)));
  assert(briefs.length===1,"exactly one strategic brief logged for the AI round ("+briefs.length+")");

  // netplay untouched: solo off → hosting works
  aiStop();
  hostGame();
  assert(peer!==null,"netplay unaffected: hosting works after solo + allocation session");

  console.log(fails?("WP11 TESTS: "+fails+" FAILURES"):"WP11 TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
