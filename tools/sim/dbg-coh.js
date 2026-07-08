// dbg-coh.js — reproduce the coherency finding: load app, muster AS AI (seed 7), inspect
// each owner-2 unit's model spread right after deploy (before any casualties).
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(ROOT, "wh40k-tabletop.html"), "utf8");
const grab = id => html.match(new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>'))[1];
const dbJson = grab("db40k-data"), layoutsJson = grab("layouts40k-data");
const start = html.lastIndexOf("<script>");
const appCode = html.slice(start + 8, html.indexOf("</script>", start));
// minimal DOM stubs (copy from gamerunner)
function makeEl(id){const el={id,value:"",checked:false,textContent:"",innerHTML:"",tagName:"DIV",style:{},dataset:{},children:[],scrollTop:0,scrollHeight:0,classList:{add(){},remove(){},toggle(){},contains(){return false;}},appendChild(c){this.children.push(c);},removeChild(){},click(){},addEventListener(){},showModal(){},close(){},getBoundingClientRect(){return{width:800,height:600,left:0,top:0};},insertAdjacentHTML(){},setPointerCapture(){},releasePointerCapture(){},parentNode:{insertBefore(){},appendChild(){},removeChild(){}}};if(id==="db40k-data")el.textContent=dbJson;if(id==="layouts40k-data")el.textContent=layoutsJson;if(id==="board"){el.width=800;el.height=600;el.parentElement={getBoundingClientRect(){return{width:800,height:600,left:0,top:0};}};el.getContext=()=>ctxStub;el.handlers={};el.addEventListener=()=>{};}return el;}
const ctxStub=new Proxy({},{get(t,k){if(k==="measureText")return()=>({width:10});if(k in t)return t[k];return()=>{};},set(t,k,v){t[k]=v;return true;}});
const els={};global.els=els;
global.document={head:{insertAdjacentHTML(){},appendChild(){}},getElementById:id=>els[id]||(els[id]=makeEl(id)),createElement:tag=>makeEl("_"+tag+Math.random()),querySelectorAll:()=>[]};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.navigator={};global.devicePixelRatio=1;global.winHandlers={};
global.window={addEventListener(){},open(){}};global.alert=()=>{};global.confirm=()=>true;global.prompt=()=>"1";
global.Peer=function(){this.on=()=>{};this.connect=()=>({on(){}});};global.URL=global.URL||{createObjectURL:()=>""};global.Blob=global.Blob||function(){};

const fid = process.argv[2] || "AS", seed = +(process.argv[3] || 7);
const chFid = process.argv[4] || "SM";
global.SIM = { fs, path, config: {}, out: "/tmp" };
const challengerSrc = fs.readFileSync(path.join(__dirname, "challenger.js"), "utf8");
eval(appCode + "\n" + challengerSrc + `
aiSeed(${seed}>>>0);
const mb=s=>{let a=s;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};
Math.random=mb(((${seed}*2654435761)>>>0)||1);
const key=Object.keys(LAYOUTS).find(k=>k.startsWith("Official 1A"));
document.getElementById("terrLayout").value=key; loadLayout();
challengerMuster("${chFid}",2000);
aiStart("${fid}",2000);
checkCoherency();
const by={}; state.tokens.forEach(t=>{ if(t.owner===2)(by[t.unit]=by[t.unit]||[]).push(t); });
console.log("=== ${fid} AI muster @ seed ${seed}: per-unit coherency AT DEPLOY (no casualties) ===");
for(const uk in by){ const ms=by[uk]; if(ms.length<2) continue;
  const inc=ms.filter(m=>incoherent.has(m.id)).length;
  // pairwise nearest-neighbor edge distances
  let maxNN=0; ms.forEach(m=>{ let nn=Infinity; ms.forEach(o=>{ if(o!==m) nn=Math.min(nn,edgeDist(m,o)); }); maxNN=Math.max(maxNN,nn); });
  console.log((ms[0].name).padEnd(28), "models",String(ms.length).padStart(2), "incoherent",String(inc).padStart(2), "worst nearest-neighbor edgeDist", maxNN.toFixed(2)+'"', "radius", tokRadius(ms[0]).toFixed(2));
}
`);
