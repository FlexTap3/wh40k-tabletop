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

  console.log(fails?("META-REFRESH PROBE: "+fails+" FAILURES"):"META-REFRESH PROBE: ALL PASSED");
  process.exitCode=fails?1:0;
})();
