;(function(){
  let fails=0;
  const assert=(c,msg)=>{ if(!c){ console.error("FAIL:",msg); fails++; } else console.log("ok -",msg); };
  state.tokens.push({id:"a",owner:1,unit:"u1",name:"Boy",shape:"c",dmm:32,x:10,y:10,wounds:1,maxW:1,Mv:6,OC:2},
                    {id:"b",owner:1,unit:"u1",name:"Boss Nob",shape:"c",dmm:32,x:11,y:10,wounds:2,maxW:2,Mv:5,OC:2},
                    {id:"c",owner:1,unit:"u2",name:"Legacy",shape:"c",dmm:32,x:12,y:10,wounds:1,maxW:1});
  sel.add("a");
  let cp=wp2Cap(); assert(cp.cap===6&&cp.mixed===false,"single-unit cap = 6, not mixed");
  sel.add("b"); cp=wp2Cap(); assert(cp.cap===5&&cp.mixed===true,"mixed selection -> lowest Mv 5, mixed flag");
  sel.clear(); sel.add("a");
  wp2DragStart(10,10);
  for(let i=1;i<=83;i++) wp2DragMove(10+i*0.1,10);
  assert(Math.abs(wp2Move.dist-8.3)<1e-9,'cumulative path = 8.3" (got '+wp2Move.dist.toFixed(3)+')');
  assert(wp2Color({d:wp2Move.dist,cap:6})==="#e8b23a","8.3/6 -> yellow (advance)");
  assert(wp2Color({d:5.9,cap:6})==="#fff","5.9/6 -> white");
  assert(wp2Color({d:12.2,cap:6})==="#ff5050","12.2/6 -> red (beyond M+6)");
  assert(wp2Color({d:12.2,cap:null})==="#fff","no Mv stat -> white, no cap");
  const before=wp2Move.dist, endX=10+83*0.1;
  for(let i=0;i<20;i++) wp2DragMove(endX+(i%2?0.01:-0.01),10);
  assert(wp2Move.dist===before,"micro-jitter <0.05\" ignored");
  // strict snapback beyond M+6
  document.getElementById("strictMove").checked=true;
  const tok=state.tokens.find(t=>t.id==="a");
  tok.x=25; drag={snap:[{id:"a",x:10,y:10}]};
  wp2Move={pts:[[10,10],[25,10]],dist:15,cap:6,mixed:false};
  assert(wp2DropCheck()===true,"strict mode snaps a 15\" drag of a 6\" mover");
  assert(tok.x===10,"token position restored by snapback");
  document.getElementById("strictMove").checked=false;
  wp2Move={pts:[],dist:15,cap:6,mixed:false};
  assert(wp2DropCheck()===false,"no snap when strict mode is off");
  document.getElementById("strictMove").checked=true;
  wp2Move={pts:[],dist:8,cap:6,mixed:false};
  assert(wp2DropCheck()===false,"advance range (M..M+6] never snaps even in strict mode");
  wp2Move={pts:[],dist:99,cap:null,mixed:false};
  assert(wp2DropCheck()===false,"legacy tokens (no Mv) never snap");
  // legacy tokens: cap null on drag start
  sel.clear(); sel.add("c"); wp2DragStart(12,10);
  assert(wp2Move.cap===null,"legacy token -> cap null");
  wp2DragEnd(); assert(wp2Move===null,"drag end clears local path");
  // opponent path over the wire
  onMsg({t:"movepath",mp:{p:[[0,0],[1,0]],d:1,cap:6,mixed:false}});
  assert(wp2Their&&wp2Their.d===1,"opponent movepath stored + drawn");
  onMsg({t:"movepath",mp:null});
  assert(wp2Their===null,"opponent movepath cleared on drop");
  // full drag pipeline through the real event handlers (mousedown/mousemove/mouseup)
  sel.clear();
  const cvEl=document.getElementById("board");
  view.x=0; view.y=0; view.s=10; // 10 px per inch
  cvEl.handlers.pointerdown({offsetX:100,offsetY:100,button:0,shiftKey:false,altKey:false}); // token a at (10,10)
  assert(drag&&drag.mode==="tokens"&&wp2Move,"mousedown on token starts measured drag");
  winHandlers.pointermove({clientX:130,clientY:100}); // +3"
  assert(Math.abs(wp2Move.dist-3)<1e-9,"handler-driven move measures 3\"");
  winHandlers.pointerup({});
  assert(wp2Move===null&&drag===null,"mouseup ends drag and clears path");
  assert(Math.abs(state.tokens.find(t=>t.id==="a").x-13)<1e-9,"token actually moved 3\"");
  console.log(fails?("WP2 TESTS: "+fails+" FAILURES"):"WP2 TESTS: ALL PASSED");
  process.exitCode=fails?1:0;
})();
