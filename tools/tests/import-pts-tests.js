;(function(){
  // WP-IMPORT-PTS — imported lists are priced truly: stated header points win (they include
  // the enhancement in every supported export format), otherwise size-matched datasheet cost
  // plus the enhancement's cost (explicit "+N" or matched by name in DB.enh). Runs under harness.js.
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);
  const armyTotal=()=>myArmy.reduce((s,c)=>s+(parseInt(c.pts)||0),0);
  const pasteImport=(text,fid,deploy)=>{ clearTable(); myArmy=[];
    g("listText").value=text; g("listFaction").value=fid||""; g("listDeploy").checked=!!deploy;
    importArmyList(); };

  /* ================= (a) pricing helpers ================= */
  const fakeU={p:[["5 models","80"],["10 models","160"]]};
  assert(wpImpSizedPts(fakeU,5)===80,"wpImpSizedPts: exact size option (5 models -> 80)");
  assert(wpImpSizedPts(fakeU,10)===160,"wpImpSizedPts: exact size option (10 models -> 160)");
  assert(wpImpSizedPts(fakeU,7)===160,"wpImpSizedPts: between options -> the smallest option that fits (7 -> 10-man cost)");
  assert(wpImpSizedPts(fakeU,12)===160,"wpImpSizedPts: more models than any option -> largest option's cost");
  assert(wpImpSizedPts(fakeU,null)===80,"wpImpSizedPts: unknown size -> first option (old behaviour, now only a last resort)");
  assert(wpImpSizedPts({p:[]},5)===0&&wpImpSizedPts(null,5)===0,"wpImpSizedPts: no points data -> 0, never throws");

  const e1=wpImpParseEnh([{indent:0,text:"Enhancement: Artificer Armour (+10 pts)"}]);
  assert(e1&&e1.n==="Artificer Armour"&&e1.c===10,"wpImpParseEnh: explicit '+10 pts' cost captured, name cleaned");
  const e2=wpImpParseEnh([{indent:0,text:"Enhancements: Saintly Example"}]);
  assert(e2&&e2.n==="Saintly Example"&&e2.c===0,"wpImpParseEnh: costless GW-app form -> cost 0 (to be filled from DB.enh)");
  const e3=wpImpParseEnh([{indent:2,text:"Enhancement: Fusillade (+25 Points)"}]);
  assert(e3&&e3.n==="Fusillade"&&e3.c===25,"wpImpParseEnh: '(+25 Points)' form, indented bullet");
  assert(wpImpParseEnh([{indent:0,text:"1x Bolt pistol"},{indent:0,text:"Warlord"}])===null,
    "wpImpParseEnh: no enhancement line -> null");

  // DB.enh lookup: use a real enhancement from the embedded DB so the test survives data refreshes
  const smEnh=(DB.enh&&DB.enh.SM&&DB.enh.SM[0])||null;
  assert(!!smEnh,"DB.enh.SM has enhancements to match against");
  if(smEnh){
    const hit=wpImpEnhCost("SM",{n:smEnh.n,c:0});
    assert(hit&&hit.c===(+smEnh.c||0),"wpImpEnhCost: costless enhancement filled from DB.enh by exact name ('"+smEnh.n+"' -> "+hit.c+")");
    const hitUp=wpImpEnhCost("SM",{n:smEnh.n+" (Upgrade)",c:0});
    assert(hitUp&&hitUp.c===(+smEnh.c||0),"wpImpEnhCost: GW-app '(Upgrade)' suffix stripped before matching");
  }
  const stated=wpImpEnhCost("SM",{n:"Totally Made Up",c:15});
  assert(stated.c===15,"wpImpEnhCost: an explicitly-stated cost is never second-guessed");
  assert(wpImpEnhCost("SM",{n:"Totally Made Up Enhancement",c:0}).c===0,
    "wpImpEnhCost: unknown name stays cost 0 (no phantom points)");
  assert(wpImpEnhCost("SM",null)===null,"wpImpEnhCost: null passes through");

  /* ================= (b) meta-list fixtures: totals now match the printed totals ================= */
  // Before this WP, the paste path priced every unit at u.p[0][1] (first size option, no stated
  // points, no enhancements) — e.g. a 10-man Terminator Assault Squad at the 5-man cost.
  const fixtures=[
    {rx:/Iron Hands/, total:2000},
    {rx:/Adepta Sororitas/, total:2000},
    {rx:/T'au Empire/, total:1995},
  ];
  fixtures.forEach(fx=>{
    const m=AI_META_LISTS.find(x=>fx.rx.test(x.name));
    assert(!!m,"embedded meta list found for "+fx.rx);
    if(!m) return;
    // document the before-number: what the old base-pts pricing would have charged
    const parsed=wp11ParseList(m.text), fid=parsed.fid||m.fid, unitsDb=DB.units[fid]||[];
    let oldTotal=0;
    parsed.units.forEach(u=>{ const i=matchUnit(unitsDb,u.name); if(i>=0) oldTotal+=parseInt((unitsDb[i].p||[["",0]])[0][1])||0; });
    pasteImport(m.text,"",false);
    console.log("   ("+m.name+": old base-pts total "+oldTotal+" -> now "+armyTotal()+", printed "+fx.total+")");
    assert(armyTotal()===fx.total,m.name+": paste-path army total equals the printed total ("+armyTotal()+" = "+fx.total+")");
    assert(myArmy.length===parsed.units.length,m.name+": every listed unit matched ("+myArmy.length+"/"+parsed.units.length+")");
    assert(myList.importedNote===0,m.name+": no base-datasheet fallbacks (importedNote count 0)");
    renderArmy();
    assert(!/base datasheet pts/.test(g("armySummary").innerHTML),m.name+": Army-tab summary shows no caveat");
    assert(new RegExp("<b[^>]*>"+fx.total+" pts</b>").test(g("armySummary").innerHTML),
      m.name+": Army-tab summary shows the true total "+fx.total+" pts");
  });

  // enhancement bullets land on the card as a note (Sororitas list: Palatine + Canoness carry one)
  const sor=AI_META_LISTS.find(x=>/Adepta Sororitas/.test(x.name));
  pasteImport(sor.text,"",false);
  const enhCards=myArmy.filter(c=>/✦/.test(c.notes||""));
  assert(enhCards.length===2,"Sororitas import: both enhancements noted on their unit cards ("+enhCards.length+" = 2)");
  assert(enhCards.some(c=>/Saintly Example/.test(c.notes)),"Sororitas import: 'Saintly Example' named in the card note");

  /* ================= (c) synthetic BCP/app-style list: stated pts, '+N' bullets, pts/[] headers, fallback ================= */
  // Real SM datasheet costs + a real enhancement, read from the DB so the test survives points refreshes.
  const smUnits=DB.units.SM;
  const inter=smUnits[matchUnit(smUnits,"Intercessor Squad")];
  const cap=smUnits[matchUnit(smUnits,"Captain")];
  const inter10=wpImpSizedPts(inter,10), cap1=wpImpSizedPts(cap,1);
  const synth=[
    "Synthetic GT List (9999 points)",
    "Space Marines",
    "Strike Force (2000 points)",
    "Gladius Task Force (3 Detachment Points)",
    "",
    "Captain (95 points)",                        // stated points INCLUDING the +10 enhancement (app-export style)
    "• 1x Captain",
    "• Enhancement: "+smEnh.n+" (+10 Points)",
    "",
    "Intercessor Squad (160 pts)",                // '(N pts)' header form — previously not even recognised
    "• 1x Intercessor Sergeant",
    "• 9x Intercessor",
    "",
    "Intercessor Squad [80 pts]",                 // New Recruit bracket form
    "• 1x Intercessor Sergeant",
    "• 4x Intercessor",
    "",
    "Captain (0 points)",                         // no usable stated points -> datasheet + DB.enh fallback
    "• 1x Captain",
    "• Enhancement: "+smEnh.n,
    "",
    "Intercessor Squad (0 points)",               // fallback must charge the 10-man option, not u.p[0]
    "• 1x Intercessor Sergeant",
    "• 9x Intercessor",
  ].join("\n");
  pasteImport(synth,"",true);
  assert(myArmy.length===5,"synthetic list: all 5 units matched ("+myArmy.length+")");
  const byOrder=myArmy.map(c=>parseInt(c.pts)||0);
  assert(byOrder[0]===95,"stated 95 wins for the enhanced Captain — the '+10' bullet is NOT double-added ("+byOrder[0]+")");
  assert(byOrder[1]===160,"'(160 pts)' header form is parsed and used ("+byOrder[1]+")");
  assert(byOrder[2]===80,"'[80 pts]' New Recruit bracket form is parsed and used ("+byOrder[2]+")");
  assert(byOrder[3]===cap1+(+smEnh.c||0),"fallback Captain = datasheet cost + DB.enh cost ("+byOrder[3]+" = "+cap1+"+"+smEnh.c+")");
  assert(byOrder[4]===inter10,"fallback 10-man Intercessors charge the 10-model option, not the 5-man u.p[0] ("+byOrder[4]+" = "+inter10+")");
  assert(myList.importedNote===2,"importedNote counts exactly the 2 fallback-priced units");
  renderArmy();
  assert(/2 units at base datasheet pts/.test(g("armySummary").innerHTML),
    "Army-tab caveat now names the fallback count ('2 units at base datasheet pts')");
  assert(/✦/.test(myArmy[0].notes||"")&&/\+10pts/.test(myArmy[0].notes||""),
    "enhancement note (with its cost) rides the enhanced Captain's card");
  const toks=state.tokens.filter(t=>t.owner===mySide);
  assert(toks.length===1+10+5+1+10,"deploy still works and wp11CountUnitModels still counts models, not wargear ("+toks.length+" = 27)");

  // legacy saves: importedNote:true (old boolean) still renders the old caveat text
  myList.importedNote=true; renderArmy();
  assert(/\(base datasheet pts\)/.test(g("armySummary").innerHTML),"legacy importedNote:true still shows the old caveat");
  myList.importedNote=0; bSave();

  /* ================= (d) AI meta-muster path still lands on printed points ================= */
  clearTable(); myArmy=[];
  const layoutKey=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
  g("terrLayout").value=layoutKey; loadLayout();
  const ihIdx=AI_META_LISTS.findIndex(x=>/Iron Hands/.test(x.name));
  wp11StartMeta(ihIdx);
  const aiCards=(state.cards&&state.cards[2])||[];
  const aiPts=aiCards.reduce((s,c)=>s+(parseInt(c.pts)||0),0);
  assert(aiPts===2000,"AI meta muster (wp11MusterList) still totals the printed 2000 ("+aiPts+")");
  assert(state.tokens.some(t=>t.owner===2),"AI meta muster still deploys side-2 tokens");
  clearTable(); myArmy=[];

  if(fails){ console.error(fails+" FAILURES in import-pts-tests"); process.exit(1); }
  console.log("import-pts-tests: all passed");
})();
