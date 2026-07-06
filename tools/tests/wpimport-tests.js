;(function(){
  // WP-C — auto-import dropdown (embedded top-5 lists + optional web-fetched lists). Runs under harness.js.
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);

  /* ================= (a) registry builder ================= */
  assert(typeof wpImportRegistry==="function","wpImportRegistry() exists");
  const reg0=wpImportRegistry();
  assert(reg0.length>=5,"registry has at least the 5 embedded lists ("+reg0.length+")");
  assert(AI_META_LISTS.every(m=>reg0.some(r=>r.name===m.name&&r.text===m.text)),
    "every AI_META_LISTS entry appears in the registry with its full text");

  /* ================= (b) dropdown path == paste path ================= */
  g("listDeploy").checked=true;
  const pick=reg0[0]; // Iron Hands — deterministic first entry

  // Path A: the existing paste-box pipeline, driven directly
  clearTable(); myArmy=[];
  g("listText").value=pick.text; g("listFaction").value=pick.fid||"";
  importArmyList();
  const armyA=myArmy.map(c=>({name:c.name,pts:String(c.pts)})).sort((x,y)=>x.name<y.name?-1:1);
  const tokA=state.tokens.filter(t=>t.owner===mySide).length;
  assert(armyA.length>0&&tokA>0,"paste-path import mustered cards and deployed tokens ("+armyA.length+" cards, "+tokA+" tokens)");

  // Path B: the new dropdown, via wpImportSelected() -> importArmyList()
  clearTable(); myArmy=[];
  wpImportPopulate();
  const selEl=g("metaListPick");
  const idxB=wpImportRegistry().findIndex(r=>r.name===pick.name);
  selEl.value=String(idxB);
  wpImportSelected();
  const armyB=myArmy.map(c=>({name:c.name,pts:String(c.pts)})).sort((x,y)=>x.name<y.name?-1:1);
  const tokB=state.tokens.filter(t=>t.owner===mySide).length;

  assert(JSON.stringify(armyA)===JSON.stringify(armyB),
    "dropdown-selected import produces the same cards as the paste-box import of the same text");
  assert(tokA===tokB,"dropdown-selected import deploys the same token count as the paste-box import ("+tokB+" = "+tokA+")");
  assert(g("listText").value===pick.text,"wpImportSelected() feeds the chosen entry's text into the EXISTING paste box (no reimplemented parser)");

  /* ================= (c) web-list merge + de-dupe ================= */
  const collideName=AI_META_LISTS[0].name;
  const fakeWeb=[
    {name:collideName,faction:"ORK",text:"SHOULD BE IGNORED — embedded wins on name collision"},
    {name:"Totally New Web List",faction:"ORK",text:"New Web List (500 points)\nOrks\n\nBoyz (100 points)\n1x Boy"},
    null,                               // malformed: not an object
    {name:"",text:"no name — skipped"}, // malformed: empty name
    {name:"No text — skipped"},         // malformed: missing text
    {faction:"ORK",text:"no name field"}, // malformed: missing name
    42,                                  // malformed: not even object-shaped
  ];
  const origGetItem=global.localStorage.getItem;
  global.localStorage.getItem=id=> id==="wh40k_web_lists" ? JSON.stringify(fakeWeb) : null;
  let reg2;
  try{
    reg2=wpImportRegistry();
  } finally {
    // restore immediately so later assertions/tests aren't affected by the stubbed localStorage
  }
  assert(reg2.length===AI_META_LISTS.length+1,
    "merge adds exactly the one new, non-colliding, well-formed web list ("+reg2.length+" total)");
  const collided=reg2.find(r=>r.name===collideName);
  assert(!!collided&&collided.text===AI_META_LISTS[0].text,
    "embedded entry's text wins over a colliding web entry of the same name");
  const fresh=reg2.find(r=>r.name==="Totally New Web List");
  assert(!!fresh&&fresh.fid==="ORK"&&/Boyz/.test(fresh.text),
    "a genuinely new web list is merged into the registry");
  global.localStorage.getItem=origGetItem;
  assert(wpImportRegistry().length===AI_META_LISTS.length,
    "registry reverts to just the embedded lists once localStorage has no web lists (fetch never required)");

  /* ================= fetch never throws, never touches the network in this harness ================= */
  assert(typeof wpImportFetchWeb==="function","wpImportFetchWeb() exists");
  let threw=false;
  const origFetch=global.fetch;
  global.fetch=()=>{ throw new Error("simulated offline failure"); };
  try{ wpImportFetchWeb(); }catch(e){ threw=true; }
  global.fetch=origFetch;
  assert(!threw,"a synchronously-throwing fetch() is swallowed, not propagated");

  console.log(fails?("WPIMPORT TESTS: "+fails+" FAILURES"):"WPIMPORT TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
