// ai-move-coherency-test.js — regression guard for the Gen-7 AI-fidelity fixes.
//
// BUG 1 (movement coherency after casualties): aiMoveUnit rigid-translates a unit, so a squad that
//   lost models keeps its (now-broken) spread and can END its Movement phase OUT of coherency
//   (11th-ed illegal; documented repro: SM Execrator, game 61 rounds 4–5). aiMoveUnit now runs
//   aiReformUnit, which pulls stragglers back into coherency AFTER the move, respecting the per-model
//   move cap, board bounds, no base overlap, and (non-charge) enemy-engagement range.
//
// BUG 2 (attach snuggle base overlap / stranding): the character seat guarantees a positive edge gap
//   AND coherency (edge ≤ 2.02") to its host, with a ring-scan fallback when the old 8 fixed offsets
//   are all blocked.
//
// Part 1 replays the real repro through the sim (gamerunner) and asserts 0 rules findings — it FAILS
// on the pre-fix code (game 61 flags 2 coherency violations) and passes on the fixed code.
// Parts 2 & 3 are self-contained unit checks (own DOM stubs, no challenger).
const fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");

let fails = 0;
const fail = (tag, msg) => { fails++; console.log(`FAIL ${tag}: ${msg}`); };

// ---------- Part 1: documented repro through the full sim ----------
const SIM = path.join(__dirname, "..", "sim");
const outDir = path.join(__dirname, "..", "sim", "out", "test-gen7");
fs.mkdirSync(outDir, { recursive: true });
// SM AI is the coherency-prone side (big Execrator/Blood Claws squads); a couple of seeds/foes.
const REPROS = [
  { ai: "SM", ch: "AS", seed: 42, game: 8061 },
  { ai: "SM", ch: "AS", seed: 7,  game: 8062 },
  { ai: "SM", ch: "DRU", seed: 42, game: 8063 },
];
for (const r of REPROS) {
  execFileSync("node", [path.join(SIM, "gamerunner.js"),
    "--seed", String(r.seed), "--tier", "S", "--sideA", r.ch, "--sideB", r.ai,
    "--game", String(r.game), "--out", outDir], { stdio: "ignore" });
  const findings = fs.readFileSync(path.join(outDir, "findings.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
    .filter(f => f.gen === r.game && f.category === "coherency");
  if (findings.length) fail("repro-coherency", `${r.ai} vs ${r.ch} seed ${r.seed}: ${findings.length} coherency violation(s) — ${findings[0].detail}`);
}
console.log(`ai-move-coherency part 1: ${REPROS.length} repro game(s) replayed — coherency findings expected 0`);

// ---------- Parts 2 & 3: headless unit checks ----------
const html = fs.readFileSync(path.join(__dirname, "..", "..", "wh40k-tabletop.html"), "utf8");
const grab = id => html.match(new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>'))[1];
const dbJson = grab("db40k-data"), layoutsJson = grab("layouts40k-data");
const start = html.lastIndexOf("<script>");
const appCode = html.slice(start + 8, html.indexOf("</script>", start));

function makeEl(id){const el={id,value:"",checked:false,textContent:"",innerHTML:"",tagName:"DIV",style:{},dataset:{},children:[],scrollTop:0,scrollHeight:0,classList:{add(){},remove(){},toggle(){},contains(){return false;}},appendChild(c){this.children.push(c);},removeChild(){},click(){},addEventListener(){},showModal(){},close(){},getBoundingClientRect(){return{width:800,height:600,left:0,top:0};},insertAdjacentHTML(){},setPointerCapture(){},releasePointerCapture(){},parentNode:{insertBefore(){},appendChild(){},removeChild(){}}};if(id==="db40k-data")el.textContent=dbJson;if(id==="layouts40k-data")el.textContent=layoutsJson;if(id==="board"){el.width=800;el.height=600;el.parentElement={getBoundingClientRect(){return{width:800,height:600,left:0,top:0};}};el.getContext=()=>ctxStub;el.handlers={};el.addEventListener=()=>{};}return el;}
const ctxStub=new Proxy({},{get(t,k){if(k==="measureText")return()=>({width:10});if(k in t)return t[k];return()=>{};},set(t,k,v){t[k]=v;return true;}});
const els={}; global.els=els;
global.document={head:{insertAdjacentHTML(){},appendChild(){}},getElementById:id=>els[id]||(els[id]=makeEl(id)),createElement:tag=>makeEl("_"+tag+Math.random()),querySelectorAll:()=>[]};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}}; global.navigator={}; global.devicePixelRatio=1; global.winHandlers={};
global.window={addEventListener(){},open(){}}; global.alert=()=>{}; global.confirm=()=>true; global.prompt=()=>"1";
global.Peer=function(){this.on=()=>{};this.connect=()=>({on(){}});}; global.URL=global.URL||{createObjectURL:()=>""}; global.Blob=global.Blob||function(){};

global.__fail = (tag, msg) => fail(tag, msg);
const stats = { move: 0, reformed: 0, attach: 0, chars: 0 };
global.__stats = stats;

eval(appCode + `
const key=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
document.getElementById("terrLayout").value=key; loadLayout();
const FIDS=["AS","TAU","DA","DRU","SM"];
const SEEDS=[7,18,31,34,42,99,123];
const Q=String.fromCharCode(34);
for(const fid of FIDS) for(const seed of SEEDS){
  state.tokens=[]; incoherent=new Set(); if(typeof aiMoved!=='undefined') for(const k in aiMoved) delete aiMoved[k];
  aiSeed(seed>>>0);
  Math.random=(function(){let a=(seed*2654435761)>>>0||1;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};})();
  try{ aiStart(fid,2000); }catch(e){ __fail('aiStart',fid+' seed '+seed+': '+e.message); continue; }

  // ---- Part 3: attach seat has a positive base gap and is within coherency ----
  checkCoherency();
  const attached=state.tokens.filter(t=>t.owner===2&&t.attachedFrom);
  __stats.attach++; __stats.chars+=attached.length;
  attached.forEach(chr=>{
    let minEdge=Infinity; state.tokens.forEach(o=>{ if(o.id!==chr.id) minEdge=Math.min(minEdge,edgeDist(chr,o)); });
    if(minEdge<=0) __fail('attach-overlap',fid+' seed '+seed+': '+chr.name+' overlaps a base (minEdge '+minEdge.toFixed(2)+Q+')');
    const host=state.tokens.filter(t=>t.owner===2&&t.unit===chr.unit&&t.id!==chr.id);
    const nn=host.length?Math.min.apply(null,host.map(o=>edgeDist(chr,o))):Infinity;
    if(nn>2.02) __fail('attach-coherency',fid+' seed '+seed+': '+chr.name+' not in coherency with host (nearest '+nn.toFixed(2)+Q+')');
  });

  // ---- Part 2: a stranded survivor is re-formed into coherency within the move cap, no overlap ----
  // Realistic casualty artefact: displace ONE model outward until it is isolated (no squadmate within
  // 2.02"), leaving the rest a coherent blob — then move the unit and require it to end coherent.
  const byU={}; state.tokens.forEach(t=>{ if(t.owner===2)(byU[t.unit]=byU[t.unit]||[]).push(t); });
  let target=null;
  for(const uk in byU){ const ms=byU[uk];
    const M=Math.min.apply(null,ms.map(t=>(typeof t.Mv==='number'&&t.Mv>0)?t.Mv:6));
    if(ms.length>=4 && M>=5 && !ms.some(t=>t.attachedFrom)){ target={uk,ms,M}; break; }
  }
  if(!target) continue;
  const {uk,ms,M}=target;
  const cx=ms.reduce((s,t)=>s+t.x,0)/ms.length, cy=ms.reduce((s,t)=>s+t.y,0)/ms.length;
  const victim=ms[0];
  // push the victim ~2.8" further out along its centroid→model direction (toward open space), clamped
  let vx=victim.x-cx, vy=victim.y-cy; const vl=Math.hypot(vx,vy)||1; vx/=vl; vy/=vl;
  const nx=Math.min(state.board.w-1,Math.max(1,victim.x+vx*2.8)), ny=Math.min(state.board.h-1,Math.max(1,victim.y+vy*2.8));
  op({k:'tok~',toks:[{id:victim.id,x:nx,y:ny}]});
  // only proceed if we produced a legal (non-overlapping) but INCOHERENT setup
  let vOverlap=false; state.tokens.forEach(o=>{ if(o.id!==victim.id&&edgeDist(victim,o)<-0.05) vOverlap=true; });
  if(vOverlap) continue;
  checkCoherency();
  if(!state.tokens.filter(t=>t.unit===uk).some(t=>incoherent.has(t.id))) continue; // didn't isolate — skip
  const pre={}; state.tokens.filter(t=>t.unit===uk).forEach(t=>{ pre[t.id]={x:t.x,y:t.y}; });
  try{ aiMoveUnit(uk); }catch(e){ __fail('aiMoveUnit',fid+' seed '+seed+': '+e.message); continue; }
  checkCoherency();
  const now=state.tokens.filter(t=>t.unit===uk);
  __stats.move++; __stats.reformed++;
  const stillBad=now.filter(t=>incoherent.has(t.id));
  if(stillBad.length) __fail('move-coherency',fid+' seed '+seed+': '+ms[0].name+' ('+now.length+' models) still incoherent after move: '+stillBad.length+' model(s)');
  now.forEach(t=>{ const p=pre[t.id]; if(!p) return; const d=Math.hypot(t.x-p.x,t.y-p.y);
    if(d>M+6+0.2) __fail('move-cap',fid+' seed '+seed+': '+ms[0].name+' model moved '+d.toFixed(2)+Q+' > allowance '+(M+6)+Q); });
  const all=state.tokens;
  for(let i=0;i<all.length;i++){ let br=false; for(let j=i+1;j<all.length;j++){ if(edgeDist(all[i],all[j])<-0.05){ __fail('move-overlap',fid+' seed '+seed+': '+all[i].name+' / '+all[j].name+' overlap after reform'); br=true; break; } } if(br) break; }
}
`);

console.log(`ai-move-coherency part 2/3: ${stats.move} reform scenario(s) exercised, ${stats.attach} muster(s) attach-checked (${stats.chars} attached chars)`);
if (fails) { console.log("AI-MOVE-COHERENCY TEST FAILED"); process.exit(1); }
if (stats.reformed === 0) { console.log("AI-MOVE-COHERENCY TEST INCONCLUSIVE: reform never exercised"); process.exit(1); }
console.log("ok - documented coherency repro (game 61 et al.) replays with 0 rules violations");
console.log("ok - a stranded survivor is re-formed into coherency within the move cap, no overlap");
console.log("ok - attached characters seat with a positive base gap and within coherency");
