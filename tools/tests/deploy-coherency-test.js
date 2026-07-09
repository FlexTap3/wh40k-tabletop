// deploy-coherency-test.js — regression guard for the Gen-6 deploy-coherency fidelity fix.
//
// 11th-ed requires every unit to be SET UP in coherency. A latent bug let the AI deploy
// models out of coherency: solo INFANTRY characters merged into a squad by
// aiAttachCharacters whose 8-offset "snuggle" failed against a tightly-packed squad were
// left 2"+ from every squadmate (repro: Sororitas "Hospitaller" at 2.13", T'au "Cadre
// Fireblade" at 4.06", Drukhari "Death Jester" at 2.15"). aiDeployAll now runs a
// coherency-repair pass. This test musters the built-in AI across factions/seeds and
// asserts checkCoherency() flags NOTHING right after deploy. It fails on the pre-fix code
// (e.g. TAU seed 7 flagged 7 models) and passes on the fixed code.
//
// Self-contained (own DOM stubs, no challenger) so it runs under run_all.sh with plain node.
const fs = require("fs"), path = require("path");
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

let fails=0, checks=0;
global.__report=(fid,seed,bad)=>{
  checks++;
  if(bad.length){ fails++; console.log(`FAIL ${fid} seed ${seed}: ${bad.length} model(s) out of coherency after deploy — ${bad.slice(0,4).join("; ")}`); }
};

// seeds chosen to include cases that FAIL on the pre-fix code, plus a general sweep.
eval(appCode + `
const key=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
document.getElementById("terrLayout").value=key; loadLayout();
const FIDS=["AS","TAU","DA","DRU","SM"];
const SEEDS=[7,18,31,34,36,29,35,42,99,123];
for(const fid of FIDS) for(const seed of SEEDS){
  state.tokens=[]; incoherent=new Set();
  aiSeed(seed>>>0);
  Math.random=(function(){let a=(seed*2654435761)>>>0||1;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};})();
  try{ aiStart(fid,2000); }catch(e){ __report(fid,seed,["threw: "+e.message]); continue; }
  checkCoherency();
  const by={}; state.tokens.forEach(t=>{ if(t.owner===2)(by[t.unit]=by[t.unit]||[]).push(t); });
  const bad=[];
  for(const uk in by){
    const ms=by[uk]; if(ms.length<2) continue;
    ms.forEach(m=>{
      if(!incoherent.has(m.id)) return;
      let nn=Infinity; ms.forEach(o=>{ if(o!==m) nn=Math.min(nn,edgeDist(m,o)); });
      bad.push(m.name+" nn="+nn.toFixed(2)+String.fromCharCode(34));
    });
  }
  __report(fid,seed,bad);
}
`);

console.log(`deploy-coherency: ${checks} muster(s) checked, ${fails} with out-of-coherency models`);
if(fails){ console.log("DEPLOY-COHERENCY TEST FAILED"); process.exit(1); }
console.log("ok - AI deploys every unit in coherency across factions/seeds");
