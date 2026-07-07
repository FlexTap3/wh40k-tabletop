;(function(){
  // Correctness probe for the June-27 meta refresh (AI_META_LISTS replaced with 5 new lists).
  // Not a pass/fail regression suite by itself — reports per-list faction detection + unit
  // match rate against the app's real DB.units, via the verified wp11ParseList/importArmyList
  // pipeline (no reimplemented parser). Runs under harness.js like the other wpXX-tests.
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);

  assert(AI_META_LISTS.length===5,"5 meta lists embedded");

  console.log("\n==== per-list report ====");
  AI_META_LISTS.forEach((m,i)=>{
    const parsed=wp11ParseList(m.text);
    assert(parsed.fid===m.fid,`[${i}] ${m.name}: header fid ${parsed.fid} matches entry fid ${m.fid}`);

    // drive the real import pipeline exactly like the paste-box path
    clearTable(); myArmy=[];
    g("listText").value=m.text; g("listFaction").value=m.fid; g("listDeploy").checked=false;
    importArmyList();

    const matched=myArmy.length;
    const totalUnits=parsed.units.length;
    // recover the "missed" list the same way importArmyList/logShared reports it, by re-running
    // matchUnit() ourselves against the same parsed unit names (importArmyList doesn't expose
    // `missed` outside its own closure, so recompute with the same matchUnit() the app uses).
    const units=DB.units[m.fid]||[];
    const missedNames=parsed.units.map(u=>u.name).filter(n=>matchUnit(units,n)<0);
    const missRate=totalUnits?(missedNames.length/totalUnits):0;

    console.log(`[${i}] ${m.name}`);
    console.log(`     fid=${parsed.fid}  disposition="${parsed.disp}"  plan=${wp11PlanFromDisposition(parsed.disp||m.disposition)}`);
    console.log(`     parsed units: ${totalUnits}   matched via importArmyList: ${matched}   missed (matchUnit<0): ${missedNames.length}`);
    if(missedNames.length) console.log(`     MISSED: ${missedNames.join("; ")}`);
    console.log(`     miss rate: ${(missRate*100).toFixed(1)}%`);
    if(missRate>0.3) console.log(`     *** FLAG: >30% of units unmatched — this list will field poorly ***`);

    assert(missRate<=0.3,`[${i}] ${m.name}: miss rate ${(missRate*100).toFixed(1)}% is <=30%`);
  });

  /* ==== WP-MODELFIX probe ==================================================================
     The 5 embedded lists are FULL BCP exports: each unit lists its models AND their wargear as
     bullet lines ("• 2x Paragon" then, nested, "  • 2x Multi-melta"). Before the fix, model
     counting read every "• Nx …" line as N models regardless of nesting, so wargear got counted
     as models too — the Sororitas list alone mustered ~238 tokens instead of ~76. This section
     hand-tallies the TRUE model count for every unit in every list (by reading the list text:
     count only the base-bullet-level "Nx <model>" lines, never their indented wargear; a lone
     character's only bullets are wargear/metadata, so it counts as its datasheet's default model
     count, normally 1) and asserts the AI muster (wp11StartMeta -> wp11MusterList -> the same
     importArmyList() pipeline) actually deploys that many tokens. It also re-checks the count via
     wp11ParseList() directly, since importArmyList() and wp11ParseList() must now agree exactly
     (both call the same wp11CountUnitModels() helper — the old wp11LooseCount escape hatch that
     let the AI-muster path overcount is retired). =============================================== */
  console.log("\n==== model-count probe (models vs wargear) ====");
  const layoutKey=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
  // Hand-tally, unit by unit, reading each AI_META_LISTS[i].text top to bottom (see report for the
  // per-unit breakdown this reduces to — every unit checks out exactly, no fudge/tolerance needed).
  const expectedModels=[
    76+2, // [0] Sororitas: 76 non-Sanctifiers units (verified below) + Sanctifiers' true 9 (2x Missionary + ... = 9, not the pluralization-bug's 7)
    44,   // [1] T'au: Coldstar(1)+Ethereal(1)+Ethereal(1)+TwinLance(2)+Fireknife(3)+Ghostkeel(1)+Pathfinder(10)+Pathfinder(10)+Riptide(1)+Riptide(1)+Riptide(1)+SkyRay(1)+SkyRay(1)+Stealth(5)+Stealth(5)
    46,   // [2] Dark Angels: Azrael(1)+Lt(1)+Hellblaster(10)+RWCmd(3)+Outrider(3)+Sammael(1)+RWBK(6)+RWCmd(3)+RWBK(6)+Outrider(3)+Outrider(3)+DropPod(1)+LandSpeeder(1)+LSVeng(1)+LSVeng(1)+StormHammer(1)+StormThunder(1)
    53,   // [3] Iron Hands: CaanokVar(1)+TermAssault(10)+Librarian(1)+Sternguard(10)+LibrarianTerm(1)+TermAssault(10)+Lt(1)+Intercessor(5)+Incursor(5)+Infiltrator(5)+LandSpeeder(1)+LandSpeeder(1)+Predator(1)+Predator(1)
    84,   // [4] Drukhari: LadyMalys(1)+Incubi(5)+Archon(1)+Incubi(10)+Kabalite(10)+Kabalite(10)+Raider(1)+Venom(1)+Venom(1)+Venom(1)+Hellions(10)+Hellions(5)+Mandrakes(5)+Mandrakes(5)+Reavers(3)+Reavers(3)+Scourges(5)+Scourges(5)+Talos(2)
  ];
  AI_META_LISTS.forEach((m,i)=>{
    const parsed=wp11ParseList(m.text);
    const parsedModels=parsed.units.reduce((s,u)=>s+(u.models||1),0);
    assert(parsedModels===expectedModels[i],
      `[${i}] ${m.name}: wp11ParseList model count ${parsedModels} matches hand-tally ${expectedModels[i]}`);

    clearTable();
    g("terrLayout").value=layoutKey; loadLayout();
    wp11StartMeta(i);
    const nTok=state.tokens.filter(t=>t.owner===2).length+((state.reserves[2]||[]).reduce((s,r)=>s+(r.toks||[]).length,0));
    console.log(`[${i}] ${m.name}: muster tokens=${nTok}  (hand-tally=${expectedModels[i]})`);
    assert(nTok===expectedModels[i],
      `[${i}] ${m.name}: AI muster deploys ${nTok} models, matches hand-tally ${expectedModels[i]}`);
  });

  // Hard sanity gate: the bug put ~238 tokens on the table for the Sororitas list instead of ~76-80.
  const sororitasTok=(()=>{
    clearTable(); g("terrLayout").value=layoutKey; loadLayout();
    wp11StartMeta(0);
    return state.tokens.filter(t=>t.owner===2).length+((state.reserves[2]||[]).reduce((s,r)=>s+(r.toks||[]).length,0));
  })();
  assert(sororitasTok>=70&&sororitasTok<=95,
    `Sororitas list musters ${sororitasTok} models — in the expected 70-95 range (NOT ~238)`);
  AI_META_LISTS.forEach((m,i)=>{
    clearTable(); g("terrLayout").value=layoutKey; loadLayout();
    wp11StartMeta(i);
    const nTok=state.tokens.filter(t=>t.owner===2).length+((state.reserves[2]||[]).reduce((s,r)=>s+(r.toks||[]).length,0));
    assert(nTok<=130,`[${i}] ${m.name}: a ~2000pt list musters ${nTok} models, <=130`);
  });

  // Old-style simplified list (no wargear at all) must still count models exactly as before the fix.
  {
    const AS_UNITS=DB.units["AS"]||[];
    const battleSisters=AS_UNITS.find(u=>norm(u.n)===norm("Battle Sisters Squad"));
    assert(!!battleSisters,"sanity: Battle Sisters Squad exists in the AS DB for the old-style-list check");
    const simpleText="Simple List (100 points)\nAdepta Sororitas\nStrike Force (100 points)\n\nBattle Sisters Squad (100 points)\n• 5x Battle Sister";
    clearTable(); myArmy=[];
    g("listText").value=simpleText; g("listFaction").value="AS"; g("listDeploy").checked=false;
    importArmyList();
    assert(myArmy.length===1,"old-style list: 1 unit imported");
    const profCount=(myArmy[0]&&myArmy[0].profiles||[]).reduce((s,p)=>s+p.count,0);
    assert(profCount===5,`old-style simplified list ("• 5x Battle Sister", no wargear) still counts exactly 5 (got ${profCount})`);
  }

  console.log(fails?("META-REFRESH PROBE: "+fails+" FAILURES"):"META-REFRESH PROBE: ALL PASSED");
  process.exitCode=fails?1:0;
})();
