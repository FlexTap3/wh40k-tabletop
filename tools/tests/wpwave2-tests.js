// Wave 2 — WP-IMPORTFIX (faction/detachment label sync), WP-DEEPLINK-APP (?list=/?import=
// auto-import), WP-MOBILE (narrow-viewport phone-layout trigger). Run via  node harness.js wpwave2-tests.js
;(function(){
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  const g=id=>document.getElementById(id);

  /* ================= WP-IMPORTFIX ================= */

  // (a) wp11ParseList now also captures the detachment line
  const ironHands=AI_META_LISTS.find(m=>/Iron Hands/.test(m.name));
  const parsedIH=wp11ParseList(ironHands.text);
  assert(parsedIH.det==="Hammer of Avernii and Librarius Conclave",
    "wp11ParseList captures the detachment line ('"+parsedIH.det+"')");
  // (WP-META-REFRESH: none of the current 5 embedded lists happens to use a single-word
  // detachment name — they're all "X and Y"/"X / Y" combined detachments — so this specific
  // regex case (a short, single-word detachment line) is tested against a synthetic header
  // instead of embedded content. The real assertion — wp11ParseList's detachment regex works
  // on short names, not just long combined ones — is unchanged.)
  assert(wp11ParseList("Test List (500 points)\nSpace Marines\nMont'ka (3 Detachment Points)\nForce Dispositions: Priority Assets").det==="Mont'ka",
    "wp11ParseList captures a single-word detachment line too");
  assert(wp11ParseList("Just some prose\nwith no header lines at all").det==="",
    "wp11ParseList.det is blank when no detachment line is present");

  // (b) importArmyList syncs myList.faction/det to the IMPORTED army, not the Builder default
  clearTable(); myArmy=[];
  myList.faction="XX_BUILDER_DEFAULT"; myList.det="XX_BUILDER_DEFAULT_DET"; myList.importedNote=false; bSave();
  g("listText").value=ironHands.text; g("listFaction").value="XX_BUILDER_DEFAULT"; g("listDeploy").checked=true;
  wp11LooseCount=true;
  importArmyList();
  wp11LooseCount=false;
  assert(myList.faction==="SM","importArmyList() syncs myList.faction to the auto-detected fid ('"+myList.faction+"')");
  assert(myList.det==="Hammer of Avernii and Librarius Conclave",
    "importArmyList() syncs myList.det from the list's own detachment line");
  assert(myList.importedNote===true,"importArmyList() flags myList.importedNote (base-datasheet-pts caveat)");
  renderArmy();
  const summaryHtml=g("armySummary").innerHTML;
  assert(/Space Marines/.test(summaryHtml),"Army-tab summary now names the IMPORTED faction (Space Marines), not the Builder default");
  assert(/Hammer of Avernii/.test(summaryHtml),"Army-tab summary shows the imported detachment");
  assert(/base datasheet pts/.test(summaryHtml),"Army-tab summary carries the 'base datasheet pts' caveat after a list import");

  // (c) a manual Builder muster (bToGame) prices enhancements properly -> caveat clears
  clearTable(); myArmy=[]; myList.items=[]; myList.faction="SM"; myList.det="Anvil Siege Force"; bSave();
  // give the roster one throwaway custom item so bToGame() has something to muster
  myList.items.push({custom:{name:"Test Unit",pts:"100",profiles:[{n:"Test Unit",count:1,base:"32mm",M:'6"',T:4,Sv:"3+",Inv:"-",W:1,Ld:"6+",OC:1}],weapons:"",notes:"",kw:[]}});
  bSave();
  bToGame();
  assert(myList.importedNote===false,"bToGame() (manual Builder muster) clears importedNote — enhancements/wargear are priced properly there");
  renderArmy();
  assert(!/base datasheet pts/.test(g("armySummary").innerHTML),"Army-tab summary drops the caveat after a Builder muster");

  // (d) the AI-muster path (wp11MusterList, via wp11StartMeta) must NOT leak its faction/det into
  // the HUMAN's myList — it borrows myArmy/mySide=2 through the same importArmyList() pipeline.
  clearTable();
  myList.faction="SM"; myList.det="Gladius Task Force"; myList.importedNote=false; bSave();
  const layoutKey=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
  g("terrLayout").value=layoutKey; loadLayout();
  // (WP-META-REFRESH: pick any embedded list whose faction differs from the human's (SM) — the
  // point of this check is cross-faction isolation, not this specific faction.)
  const otherFidIdx=AI_META_LISTS.findIndex(m=>m.fid!=="SM");
  wp11StartMeta(otherFidIdx); // mustered fid differs from SM, side 2 — must not touch the human's myList (SM)
  assert(myList.faction==="SM","AI muster (other faction) does not overwrite the human's myList.faction ('"+myList.faction+"')");
  assert(myList.det==="Gladius Task Force","AI muster does not overwrite the human's myList.det");
  assert(myList.importedNote===false,"AI muster does not flip the human's importedNote flag");

  /* ================= WP-DEEPLINK-APP ================= */

  const origSearch=global.window.location;
  const setSearch=params=>{ global.window.location={search:"?"+new URLSearchParams(params).toString()}; };

  // (a) ?list=<name> — case/whitespace-insensitive match against the registry, feeds the existing import pipeline
  clearTable(); myArmy=[];
  // case-mangled + padded variant of the real name (content-agnostic — survives list renames)
  const mangledName="  "+ironHands.name.split("").map((c,i)=>i%2?c.toUpperCase():c.toLowerCase()).join("")+"  ";
  setSearch({list:mangledName});
  wpDeepLinkInit();
  assert(myArmy.length>0,"?list= deep-link matched the registry entry and imported it ("+myArmy.length+" cards)");
  assert(myList.faction==="SM","?list= deep-link import synced myList.faction via the same importArmyList() path");

  // (b) ?list= with no match -> friendly log line, no import, no throw
  clearTable(); myArmy=[];
  const logCountBefore=els["log"].children.length;
  setSearch({list:"Definitely Not A Real List Name XYZ"});
  let threwA=false;
  try{ wpDeepLinkInit(); }catch(e){ threwA=true; }
  assert(!threwA,"?list= with no match never throws");
  assert(myArmy.length===0,"?list= with no match does not import anything");
  assert(els["log"].children.length>logCountBefore,"?list= with no match logs a friendly 'not found' message");

  // (c) ?import=<raw text> — decoded straight into #listText and imported as-is
  clearTable(); myArmy=[];
  const rawList="Iron Wolves (2000 points)\nSpace Marines\nStrike Force (2000 points)\n\nIntercessor Squad (80 points)\n• 1x Intercessor Sergeant\n• 4x Intercessor";
  setSearch({import:rawList});
  wpDeepLinkInit();
  assert(g("listText").value===rawList,"?import= decodes straight into #listText");
  assert(myArmy.length>0,"?import= raw text was imported ("+myArmy.length+" cards)");

  // (d) ?list= takes priority over ?import= when both are present
  clearTable(); myArmy=[];
  setSearch({list:ironHands.name,import:"garbage that must be ignored"});
  wpDeepLinkInit();
  assert(myArmy.length>0&&g("listText").value===ironHands.text,"?list= wins when both ?list and ?import are present");

  // (e) malformed URL never breaks load
  clearTable(); myArmy=[];
  global.window.location={search:"?list=%"}; // invalid percent-encoding
  let threwB=false;
  try{ wpDeepLinkInit(); }catch(e){ threwB=true; }
  assert(!threwB,"a malformed query string never throws out of wpDeepLinkInit()");

  // (f) no query params at all -> quiet no-op
  clearTable(); myArmy=[];
  global.window.location={search:""};
  let threwC=false;
  try{ wpDeepLinkInit(); }catch(e){ threwC=true; }
  assert(!threwC,"an empty query string never throws");
  assert(myArmy.length===0,"no query params -> nothing imported");

  global.window.location=origSearch;

  /* ================= WP-MOBILE: narrow-viewport trigger ================= */

  const prevIW=global.window.innerWidth;
  global.screen={width:1680,height:1050};
  // node ≥21 ships a read-only global navigator — swap in a writable stub (same trick as wp12-tests.js)
  Object.defineProperty(global,"navigator",{value:{userAgent:"",maxTouchPoints:0},configurable:true,writable:true});
  global.window.matchMedia=q=>({matches:false}); // fine pointer, desktop-y screen

  global.window.innerWidth=390;
  assert(wp12Detect()==="phone","narrow viewport (innerWidth=390) on a desktop UA/pointer now triggers phone layout");

  global.window.innerWidth=820;
  assert(wp12Detect()==="phone","innerWidth exactly 820 is still phone (boundary is inclusive)");

  global.window.innerWidth=821;
  assert(wp12Detect()==="desktop","innerWidth just above the 820 threshold stays desktop (screen/pointer are desktop-y)");

  global.window.innerWidth=1440;
  assert(wp12Detect()==="desktop","wide viewport (1440) stays desktop — MacBook path unaffected");

  // iPad UA still deliberately stays desktop even if the viewport is narrow (e.g. Split View)
  global.navigator.userAgent="Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)";
  global.window.innerWidth=390;
  assert(wp12Detect()==="desktop","iPad UA still stays desktop even at a narrow innerWidth — WP8 touch pass covers it");
  global.navigator.userAgent="";

  global.window.innerWidth=prevIW;

  console.log(fails?("WPWAVE2 TESTS: "+fails+" FAILURES"):"WPWAVE2 TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
