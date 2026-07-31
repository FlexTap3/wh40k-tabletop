
"use strict";
/* ============ state ============ */
const uid = () => Math.random().toString(36).slice(2,9);
let state = {
  board:{w:60,h:44},
  tokens:[],     // {id,owner,unit,name,shape:'c'|'r',dmm|wIn/hIn,x,y,rot,wounds,maxW, WP0: Mv,OC,T,Sv,iv,kw (may be absent on old saves)}
  terrain:[],    // {id,kind,x,y,w,h,rot}
  objectives:[], // {id,x,y}
  dz:[],         // deployment zones: [redPoly, bluePoly] in board inches
  sec:[],        // drawn secondary cards: {id,owner,name}
  mission:null,  // {name, m} current primary mission from loaded layout
  trackers:{round:1,cp1:0,cp2:0,vp1:0,vp2:0},
  names:{1:"Player 1",2:"Player 2"},
  cards:{1:[],2:[]}, /* ==== WP0: foundations ==== display-only unit cards per side, synced via "cards" op */
  reserves:{1:[],2:[]}, /* ==== WP7: phases ==== per-player reserves tray: [{id,owner,name,ds,toks:[…]}], synced via rsv+/rsv- */
  phase:{side:1,ph:-1,cpDone:{}}, /* ==== WP7: phases ==== ph -1 = Deploy, 0–5 = Command…End; cpDone marks "round:side" CP grants */
};
let myArmy = JSON.parse(localStorage.getItem("wh40k_army")||"[]");
let mySide = 1, myName = localStorage.getItem("wh40k_name")||"Player";
document.getElementById("myName").value = myName;

/* ============ networking (PeerJS) ============ */
let peer=null, conn=null, isHost=false;
function setConn(on,txt){ document.getElementById("connDot").className="dot"+(on?" on":""); document.getElementById("connText").textContent=txt; }
function hostGame(){
  if(typeof aiSoloBlocksNet==="function"&&aiSoloBlocksNet()) return; /* ==== WP10: ai ==== solo and netplay are mutually exclusive */
  const code = wp1HostCode(); /* WP1: stable room code so a dropped game can be re-hosted */
  peer = new Peer(code);
  peer.on("open", id=>{
    const short=id.replace("wh40k-","").toUpperCase();
    setConn(false,"Room "+short+" — waiting…");
    navigator.clipboard && navigator.clipboard.writeText(short).catch(()=>{});
    logSys(`Hosting room. Code: ${short} (copied). Your brother clicks Join and enters it.`);
    isHost=true;
  });
  peer.on("connection", c=>{ conn=c; wireConn(); });
  peer.on("error", e=>{ setConn(false,"Error"); logSys("Connection error: "+e.type); wp1PeerError(e); /* WP1 */ });
}
function joinPrompt(){
  if(typeof aiSoloBlocksNet==="function"&&aiSoloBlocksNet()) return; /* ==== WP10: ai ==== solo and netplay are mutually exclusive */
  const code = prompt("Enter room code:"); if(!code) return;
  wp1SaveRoom("wh40k-"+code.trim().toLowerCase(),false); /* WP1: remember the room for reconnect */
  peer = new Peer();
  peer.on("open", ()=>{
    conn = peer.connect("wh40k-"+code.trim().toLowerCase(), {reliable:true});
    wireConn();
  });
  peer.on("error", e=>{ setConn(false,"Error"); logSys("Connection error: "+e.type); wp1PeerError(e); /* WP1 */ });
}
function wireConn(){
  conn.on("open", ()=>{
    setConn(true,"Connected");
    logSys("Connected!");
    send({t:"hello", name:myName, side:mySide});
    if(isHost) send({t:"state", state});
    wp1OnConnect(); /* WP1 */
  });
  conn.on("data", onMsg);
  conn.on("close", ()=>{ setConn(false,"Disconnected"); logSys("Opponent disconnected."); conn=null; wp1OnDisconnect(); /* WP1 */ });
}
function send(m){ if(conn && conn.open) conn.send(m); }
function onMsg(m){
  switch(m.t){
    case "hello": { const hn=secStr(m.name,40)||"Player"; /* SEC */ state.names[m.side]=hn; refreshTrackers(); logSys(hn+" joined as "+(m.side==1?"Red":"Blue")+"."); wp8SideClaim(m); /* WP8 */ } break;
    case "state": state=m.state; if(!state.sec)state.sec=[]; if(!state.cards)state.cards={1:[],2:[]}; /* WP0 back-compat */ wp1Compat(state); wp1Autosave(); /* WP1 */ wpCapMode=null; /* ==== WP-FIGHT ==== */ fitView(); refreshTrackers(); renderCards(); if(typeof wpRulesRenderStrats==="function"){wpRulesRenderStrats();wpRulesShowReminder();} /* ==== WP-RULES ==== */ draw(); break;
    case "op": applyOp(m.op,false); break;
    case "chat": logChat(secStr(m.name,40),secStr(m.text,500),false); break; /* SEC */
    case "log": logEntry(secSanLog(m.html),secStr(m.cls,12)); break; /* SEC: never render raw peer HTML */
    case "ruler": theirRuler=m.r; draw(); if(theirRulerTimer)clearTimeout(theirRulerTimer); theirRulerTimer=setTimeout(()=>{theirRuler=null;draw();},4000); break;
    /* ==== WP2: move measure ==== */
    case "movepath": wp2TheirPath(m.mp); break;
    /* ==== end WP2 ==== */
    /* ==== WP18 ==== P2P defender allocation: rolled damage handed over as a transient direct message (like "ruler" — never in state, lost on reconnect) */
    case "dmg": if(typeof wp18OnDmg==="function") wp18OnDmg(m); break; /* SEC: every field coerced/capped inside wp18OnDmg */
    /* ==== end WP18 ==== */
    /* ==== WP3D-v3 ==== transient shared dice (like "ruler": never in state, lost on reconnect).
       SEC: values coerced to 1-6 ints, capped at 40. */
    case "dice": { const vals=(Array.isArray(m.vals)?m.vals:[]).slice(0,40).map(v=>Math.max(1,Math.min(6,Math.floor(+v)||1))); if(vals.length&&typeof wp3dRemoteDiceCbs!=="undefined"){ for(const cb of wp3dRemoteDiceCbs){ try{cb(vals);}catch(e){} } } } break;
    /* ==== end WP3D-v3 ==== */
  }
}
/* ops mutate state identically on both ends */
function op(o){ wp1Snapshot(); /* WP1: undo snapshot before local ops */ applyOp(o,true); }
function applyOp(o,mine){
  const T=state.tokens, R=state.terrain, O=state.objectives;
  switch(o.k){
    case "tok+": o.toks.forEach(t=>T.push(t)); break;
    case "tok~": o.toks.forEach(u=>{const t=T.find(x=>x.id===u.id); if(t)Object.assign(t,u);}); break;
    case "tok-": o.ids.forEach(id=>{const i=T.findIndex(x=>x.id===id); if(i>=0)T.splice(i,1);}); break;
    case "ter+": R.push(o.ter); break;
    case "ter~": {const t=R.find(x=>x.id===o.ter.id); if(t)Object.assign(t,o.ter);} break;
    case "ter-": {const i=R.findIndex(x=>x.id===o.id); if(i>=0)R.splice(i,1);} break;
    case "obj+": O.push(o.obj); break;
    case "obj-": {const i=O.findIndex(x=>x.id===o.id); if(i>=0)O.splice(i,1);} break;
    case "track": state.trackers=o.trackers; refreshTrackers(); break;
    case "sec+": if(o.card) state.sec.push({id:secStr(o.card.id,20),owner:o.card.owner===2?2:1,name:secStr(o.card.name,120)}); renderCards(); break; /* SEC: coerce shape */
    case "sec-": {const i=state.sec.findIndex(c=>c.id===o.id); if(i>=0)state.sec.splice(i,1); renderCards();} break;
    case "mission": state.mission=o.mission; renderCards(); break;
    case "cardtext": if(mine!==true){ const cn=secStr(o.name,120); if(cn&&cn!=="__proto__"&&cn!=="constructor") cardText[cn]=secStr(o.text,4000); /* SEC */ localStorage.setItem("wh40k_cardtext",JSON.stringify(cardText)); renderCards(); } break;
    case "board": state.board=o.board; fitView(); break;
    case "name": state.names[o.side]=secStr(o.name,40)||"Player"; refreshTrackers(); break; /* SEC */
    case "clear": state.tokens=[]; state.terrain=[]; state.objectives=[]; state.dz=[]; state.sec=[]; state.cards={1:[],2:[]}; state.reserves={1:[],2:[]}; state.phase={side:1,ph:-1,cpDone:{}}; /* WP7 */ if(typeof wpResetMove==="function") wpResetMove(); /* ==== WP-A ==== */ wpCapMode=null; if(typeof wpRulesRenderStrats==="function"){wpRulesRenderStrats();wpRulesShowReminder();} /* ==== WP-RULES/WP-FIGHT ==== */ break;
    case "dz": state.dz=o.dz; break;
    /* ==== WP0: foundations ==== */
    case "cards": if(!state.cards)state.cards={1:[],2:[]}; state.cards[o.owner]=o.cards||[]; break;
    /* ==== end WP0 ==== */
    /* ==== WP1: resilience ==== full-state replace (undo / recovery); idempotent */
    case "restore": wp1ApplyRestore(o.state); break;
    /* ==== end WP1 ==== */
    /* ==== WP6: objectives ==== update-by-id (secured flag etc.); idempotent */
    case "obj~": {const ob=O.find(x=>x.id===o.obj.id); if(ob)Object.assign(ob,o.obj);} break;
    /* ==== end WP6 ==== */
    /* ==== WP7: phases ==== turn/phase stepper + reserves tray; idempotent (replace-by-value / replace-by-id) */
    case "phase": wp7ApplyPhase(o); break;
    case "rsv+": { if(!state.reserves)state.reserves={1:[],2:[]}; const L=state.reserves[o.res.owner]||(state.reserves[o.res.owner]=[]); const i=L.findIndex(r=>r.id===o.res.id); if(i>=0)L[i]=o.res; else L.push(o.res); } break;
    case "rsv-": if(state.reserves) [1,2].forEach(s=>{ const L=state.reserves[s]||[]; const i=L.findIndex(r=>r.id===o.id); if(i>=0)L.splice(i,1); }); break;
    /* ==== end WP7 ==== */
  }
  if(mine) send({t:"op",op:o});
  draw();
  wp1Autosave(); /* ==== WP1: resilience ==== debounced autosave after every op */
}

/* ============ log / chat / dice ============ */
/* ==== SEC: remote-input hardening (public-hosting security pass) ==== */
const secStr=(s,n)=>String(s??"").slice(0,n); // coerce+cap any remote string
function secSanLog(h){
  // Remote log lines may carry simple formatting; allow ONLY harmless inline tags,
  // strip every attribute. Falls back to full escaping outside a real DOM.
  try{
    const t=document.createElement("template");
    if(!t.content||!t.content.querySelectorAll) return esc(String(h).slice(0,4000));
    t.innerHTML=String(h).slice(0,4000);
    const ok={B:1,I:1,EM:1,STRONG:1,BR:1,SMALL:1,SPAN:1};
    for(let guard=0;guard<40;guard++){
      let changed=false;
      for(const el of [...t.content.querySelectorAll("*")]){
        if(!ok[el.tagName]){ el.replaceWith(...el.childNodes); changed=true; }
        else for(const a of [...el.attributes]) el.removeAttribute(a.name);
      }
      if(!changed) break;
    }
    return t.innerHTML;
  }catch(e){ return esc(String(h).slice(0,4000)); }
}
function secCode(n){
  // Crypto-strength room codes (no lookalike chars). ~50 bits at n=10.
  const a="abcdefghjkmnpqrstuvwxyz23456789"; let out="";
  try{ const b=new Uint32Array(n); crypto.getRandomValues(b); for(let i=0;i<n;i++) out+=a[b[i]%a.length]; }
  catch(e){ for(let i=0;i<n;i++) out+=a[Math.floor(Math.random()*a.length)]; }
  return out;
}
/* ==== end SEC ==== */
const logEl=document.getElementById("log");
function logEntry(html,cls){ const d=document.createElement("div"); d.className="e "+(cls||""); d.innerHTML=html; logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; if(typeof wp12PeekUpdate==="function")wp12PeekUpdate(); /* ==== WP12: phone ==== peek ticker */ }
function logSys(s){ logEntry("· "+esc(s),"sys"); }
function logShared(html,cls){ logEntry(html,cls); send({t:"log",html,cls}); }
function logChat(name,text,mine){ logEntry("<b>"+esc(name)+":</b> "+esc(text), mine?"me":"them"); }
function sendChat(){ const i=document.getElementById("chatIn"); const v=i.value.trim(); if(!v)return; i.value=""; logChat(myName,v,true); send({t:"chat",name:myName,text:v}); }
document.getElementById("chatIn").addEventListener("keydown",e=>{ if(e.key==="Enter") sendChat(); });
const esc = s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const d6 = ()=>{ const r=1+Math.floor(Math.random()*6); if(typeof wp20Note==="function") wp20Note(r); return r; }; /* ==== WP20 ==== every d6 rolled on this screen (mine and the AI's) feeds the dice-stats panel */
function quickRoll(){
  const n=Math.min(60,Math.max(1,+document.getElementById("qtyDice").value||1));
  const r=Array.from({length:n},d6).sort((a,b)=>b-a);
  logShared("🎲 <b>"+esc(myName)+"</b> rolls "+n+"D6: <b>"+r.join(" ")+"</b>","dice");
}
function rollLeadership(){
  const t=parseInt(document.getElementById("ldTarget").value);
  const a=d6(),b=d6(); const ok=a+b>=t;
  logShared("🎲 <b>"+esc(myName)+"</b> Battle-shock (Ld "+t+"+): "+a+"+"+b+" = "+(a+b)+" — <b>"+(ok?"PASSED":"FAILED — battle-shocked!")+"</b>","dice");
}

/* ============ attack helper ============ */
function parseDice(s){ // "10" | "D6" | "2D6+3" | "D3"
  s=String(s).trim().toUpperCase();
  const m=s.match(/^(\d*)D(3|6)([+-]\d+)?$/);
  if(m){ const n=+(m[1]||1), die=+m[2], add=+(m[3]||0);
    return {roll:()=>{let t=add,rolls=[];for(let i=0;i<n;i++){let v=die===3?Math.ceil(d6()/2):d6();rolls.push(v);t+=v;}return{total:Math.max(1,t),rolls};}, txt:s}; }
  const v=Math.max(0,parseInt(s)||0); return {roll:()=>({total:v,rolls:null}), txt:String(v)};
}
function rollAttack(){
  const g=id=>document.getElementById(id);
  const A=parseDice(g("akA").value).roll();
  const bsSel=g("akBS").value, auto=bsSel==="auto", bs=auto?0:parseInt(bsSel);
  let hitMod=parseInt(g("akHitMod").value); if(g("tgCover").checked) hitMod-=1; hitMod=Math.max(-1,Math.min(1,hitMod));
  const wndMod=Math.max(-1,Math.min(1,parseInt(g("akWndMod").value)));
  const S=+g("akS").value, AP=Math.abs(parseInt(g("akAP").value)), Dspec=parseDice(g("akD").value);
  const T=+g("tgT").value, sv=parseInt(g("tgSv").value), inv=+g("tgInv").value, fnp=+g("tgFNP").value;
  const lethal=g("akLethal").checked, twin=g("akTwin").checked, dev=g("akDev").checked;
  const sus=+g("akSus").value, anti=+g("akAnti").value;
  const rrHit=g("akRrHit").value, rrWnd=twin?"all":g("akRrWnd").value;

  const nA=A.total; let lines=[];
  if(wp3Label) lines.push(wp3Label); /* ==== WP3: inspector ==== attacker → target line from the staged attack */
  lines.push(`${nA} attack${nA!==1?"s":""}${A.rolls?` (rolled ${A.rolls.join(",")})`:""} | ${auto?"Torrent":"hit "+bs+"+"} S${S} AP-${AP} D${Dspec.txt}  vs  T${T} Sv${sv>6?"–":sv+"+"}${inv?" Inv"+inv+"+":""}${fnp?" FNP"+fnp+"+":""}`);

  // --- hits ---
  let hits=0, critHits=0, hitRolls=[];
  if(auto){ hits=nA; lines.push(`Auto-hits: ${nA}`); }
  else{
    for(let i=0;i<nA;i++){
      let r=d6();
      if((rrHit==="ones"&&r===1)||(rrHit==="all"&&r!==6&&(r===1||r+hitMod<bs))){ r=d6(); }
      hitRolls.push(r);
      if(r===1) continue;
      if(r===6){ hits++; critHits++; continue; }
      if(r+hitMod>=bs) hits++;
    }
    hits+=critHits*sus;
    lines.push(`Hit rolls: ${hitRolls.join(" ")} → ${hits} hit${hits!==1?"s":""}${critHits?` (${critHits} crit${sus?`, +${critHits*sus} sustained`:""})`:""}`);
  }

  // --- wounds ---
  const need = S>=2*T?2 : S>T?3 : S===T?4 : 2*S<=T?6 : 5;
  let autoW = lethal?critHits:0;
  let toRoll = hits-autoW;
  let wounds=autoW, critWounds=0, wndRolls=[];
  for(let i=0;i<toRoll;i++){
    let r=d6();
    if((rrWnd==="ones"&&r===1)||(rrWnd==="all"&&r!==6&&(r===1||r+wndMod<need))){ r=d6(); }
    wndRolls.push(r);
    if(r===1) continue;
    const crit = r===6 || (anti&&r>=anti);
    if(crit){ wounds++; critWounds++; continue; }
    if(r+wndMod>=need) wounds++;
  }
  lines.push(`Wound rolls (need ${need}+${anti?`, Anti crits on ${anti}+`:""}): ${wndRolls.join(" ")||"—"}${autoW?` +${autoW} auto (Lethal)`:""} → ${wounds} wound${wounds!==1?"s":""}${critWounds?` (${critWounds} crit)`:""}`);

  // --- devastating wounds: crit wounds bypass saves as mortals ---
  let mortals=0, mortalDetail="";
  let savable = wounds;
  if(dev && critWounds){
    savable -= critWounds;
    let mw=0, rolls=[];
    for(let i=0;i<critWounds;i++){ const dr=Dspec.roll(); mw+=dr.total; if(dr.rolls)rolls.push(dr.total); }
    mortals=mw; mortalDetail=`Dev Wounds: ${critWounds} crit → ${mw} mortal wounds${rolls.length?` (D rolls: ${rolls.join(",")})`:""}`;
    lines.push(mortalDetail);
  }

  // --- saves ---
  const svNeed = Math.min(7, sv+AP), useInv = inv && inv<svNeed ? inv : 0;
  const target = useInv||svNeed;
  let failed=0, svRolls=[];
  for(let i=0;i<savable;i++){ const r=d6(); svRolls.push(r); if(r===1||r<target) failed++; }
  lines.push(`Saves (${useInv?`Inv ${inv}+`:target>6?"no save!":target+"+"}): ${svRolls.join(" ")||"—"} → ${failed} failed`);

  // --- damage ---
  let dmg=0, dmgRolls=[];
  for(let i=0;i<failed;i++){ const dr=Dspec.roll(); dmg+=dr.total; if(dr.rolls)dmgRolls.push(dr.total); }
  let totalRaw=dmg+mortals;
  lines.push(`Damage: ${failed}×D${Dspec.txt}${dmgRolls.length?` (${dmgRolls.join(",")})`:""} = ${dmg}${mortals?` + ${mortals} mortal = ${totalRaw}`:""}`);

  // --- feel no pain ---
  let final=totalRaw;
  if(fnp && totalRaw){
    let saved=0, rolls=[];
    for(let i=0;i<totalRaw;i++){ const r=d6(); rolls.push(r); if(r>=fnp)saved++; }
    final=totalRaw-saved;
    lines.push(`FNP ${fnp}+: ${rolls.join(" ")} → ${saved} ignored`);
  }
  lines.push(`⚑ TOTAL: ${final} damage`);
  document.getElementById("akResult").textContent=lines.join("\n");
  logShared("⚔ <b>"+esc(myName)+"</b> attack:\n"+esc(lines.join("\n")),"dice");
  if(typeof wp10AttackDone==="function") wp10AttackDone(final,failed,mortals,dmgRolls); /* ==== WP10: ai ==== solo auto-casualties */
  if(typeof wp13AfterRoll==="function") wp13AfterRoll(); /* ==== WP13 ==== phone: staged roll done → back to the board */
  if(typeof wp16AfterRoll==="function") wp16AfterRoll(final,failed,mortals,dmgRolls); /* ==== WP16 ==== network/hotseat: offer the one-tap apply-damage button ==== end WP16 ==== */
}

/* ============ unit database ============ */
let DB={factions:[],units:{}};
try{ DB=JSON.parse(document.getElementById("db40k-data").textContent); }catch(e){ console.warn("No unit DB embedded",e); }
const norm=s=>String(s).toLowerCase().replace(/[’'`-]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
function populateFactions(){
  const opts=DB.factions.map(([id,n])=>`<option value="${id}">${esc(n)}</option>`).join("");
  document.getElementById("listFaction").innerHTML=opts;
}
function baseFrom(str,W){
  if(str){ let m=String(str).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm/i);
    if(m) return {shape:"r",wIn:+m[1]/25.4,hIn:+m[2]/25.4,oval:true}; /* ==== WP21 ==== "A x Bmm" GW bases are OVALS, not rects */
    m=String(str).match(/(\d+(?:\.\d+)?)\s*mm/i);
    if(m) return {shape:"c",dmm:+m[1]}; // "NNmm flying base" keeps the stand circle on purpose: a true-hull AIRCRAFT token would be unusable on a 2D table (WP21 hull table catches the ground-skimmers that matter)
    m=String(str).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*in/i);
    if(m) return {shape:"r",wIn:+m[1],hIn:+m[2]};
  }
  const w=+W||1; // no base (hull/frame vehicles): size by wounds
  if(w>=30) return {shape:"r",wIn:11,hIn:7};    /* ==== WP21 ==== titan-class tiers (Warlord, gargants) */
  if(w>=20) return {shape:"r",wIn:9,hIn:5.5};   /* ==== WP21 ==== super-heavy tier (Baneblade class) */
  if(w>=16) return {shape:"r",wIn:7.5,hIn:4.5};
  if(w>=10) return {shape:"r",wIn:6,hIn:3.5};
  if(w>=6)  return {shape:"r",wIn:4,hIn:2.5};
  return {shape:"c",dmm:40};
}
function weaponLines(u){
  return (u.w||[]).map(w=>{
    const [n,rng,t,A,BS,S,AP,D,ab]=w;
    const r=t==="M"?"Melee":(String(rng).match(/^\d+$/)?rng+'"':rng);
    const hit=String(BS).match(/^\d$/)?BS+"+":BS;
    return `${n}${ab?" ["+ab+"]":""} | ${r} | ${A} | ${hit} | ${S} | ${AP} | ${D}`;
  }).join("\n");
}
function profilesFromDb(u,targetSize){
  // parse composition lines like "9 Boyz", "1 Boss Nob"
  let profs=(u.m||[]).map(m=>({n:m.n,count:0,base:m.b,M:m.M,T:m.T,Sv:m.Sv,Inv:m.iv||"-",W:+m.W||1,Ld:m.Ld,OC:m.OC}));
  (u.c||[]).forEach(line=>{
    const mm=line.match(/(\d+)[-–]?(\d+)?\s+(.+)/); if(!mm) return;
    const cnt=+mm[1], nm=norm(mm[3]).replace(/s$/,"");
    let p=profs.find(p=>norm(p.n).replace(/s$/,"")===nm)||profs.find(p=>nm.includes(norm(p.n).replace(/s$/,""))||norm(p.n).replace(/s$/,"").includes(nm));
    if(p) p.count+=cnt;
  });
  if(profs.every(p=>!p.count)) profs[0].count=1;
  const cur=profs.reduce((s,p)=>s+p.count,0);
  if(targetSize&&targetSize!==cur&&profs.length){
    const big=profs.reduce((a,b)=>a.count>=b.count?a:b);
    big.count=Math.max(1,big.count+targetSize-cur);
  }
  return profs.filter(p=>p.count>0);
}
function addFromDb(fid,idx,forcedSize,quiet){
  const u=(DB.units[fid]||[])[idx]; if(!u) return null;
  let size=forcedSize, pts="";
  if(!size && u.p && u.p.length>1){
    const menu=u.p.map((o,i)=>`${i+1}) ${o[0]} — ${o[1]}pts`).join("\n");
    const pick=quiet?1:parseInt(prompt(u.n+" — unit size?\n"+menu,"1"))||1;
    const opt=u.p[Math.min(u.p.length,Math.max(1,pick))-1];
    const m=opt[0].match(/(\d+)/); size=m?+m[1]:null; pts=opt[1];
  } else if(u.p&&u.p.length) pts=u.p[0][1];
  const card={name:u.n, pts, profiles:profilesFromDb(u,size), weapons:weaponLines(u), notes:u.r||"", kw:(u.k||[]).slice() /* WP0: card carries DB keywords */};
  myArmy.push(card); localStorage.setItem("wh40k_army",JSON.stringify(myArmy)); renderArmy();
  return card;
}
/* ==== WP-MODELFIX: distinguish MODEL lines from WARGEAR lines in a pasted/embedded army-list block.
   Full BCP exports list a unit's models AND their wargear as bullet lines at different indent depths
   ("• 2x Paragon" then, nested one level deeper, "  • 2x Multi-melta"). Two signals disambiguate:
   (1) indentation — a line indented under a model line is its wargear, never a model, full stop;
   (2) for base-level (unindented) lines, does the name match one of the datasheet's own model names?
   We match against BOTH u.m (the DB's stat-profile names) and u.c (the datasheet's own composition
   lines, e.g. "1 Paragon Superior"/"2 Paragons") because some datasheets (Paragon Warsuits included)
   collapse several differently-named roles onto ONE shared stat profile — u.c is the only place
   those per-role BCP names actually appear in the DB. Lone characters whose only bullets are
   wargear/metadata (no base-level line names a model at all — e.g. Morvenn Vahl: "Attached as:",
   "Warlord", "1x Fidelis") fall back to the datasheet's own default composition count via
   profilesFromDb(), the same function addFromDb() already uses for default sizing everywhere else. */
function wp11Singular(s){ // "missionaries"->"missionary", "paragons"->"paragon", "talos"->"talos"
  s=norm(s);
  if(/ies$/.test(s)) return s.replace(/ies$/,"y");
  if(/s$/.test(s)) return s.replace(/s$/,"");
  return s;
}
function wp11ModelNameSet(u){
  const names=new Set();
  (u.m||[]).forEach(mp=>{ if(mp.n) names.add(wp11Singular(mp.n)); });
  (u.c||[]).forEach(line=>{
    const mm=String(line).match(/^(\d+)[-–]?(\d+)?\s+(.+)$/);
    if(mm) names.add(wp11Singular(mm[3]));
  });
  return names;
}
function wp11IsModelBulletName(name,nameSet){
  const nm=wp11Singular(name);
  if(!nm) return false;
  for(const pn of nameSet){ if(pn&&(pn===nm||nm.includes(pn)||pn.includes(nm))) return true; }
  return false;
}
function wp11CountUnitModels(u,blockLines){
  // blockLines: [{indent,text}] — every line under one unit header up to (not including) the next
  // unit header, with the ORIGINAL leading-whitespace indent preserved by the caller.
  const names=wp11ModelNameSet(u);
  let count=0, matched=false;
  (blockLines||[]).forEach(({indent,text})=>{
    if(indent>=2) return; // indented under a model line => wargear, never a model
    const bm=text.match(/^(\d+)x\s+(.+)/i); if(!bm) return;
    if(wp11IsModelBulletName(bm[2],names)){ count+=+bm[1]; matched=true; }
  });
  if(matched) return count;
  const profs=profilesFromDb(u); // character/vehicle fallback: datasheet's own default model count
  return profs.reduce((s,p)=>s+p.count,0)||1;
}
/* ==== WP-IMPORT-PTS: true costing for imported lists ==== Every export format we accept
   (GW app / BCP "(360 Points)", "(95 pts)", New Recruit "[95 pts]", and this app's own
   bExportText) states each unit's points ON its header line, and in all of them that stated
   number already INCLUDES the enhancement's cost (bExportText writes opt.pts+enh.c on the
   header and repeats "+N" on the bullet; the GW app bakes it in silently — verified: all 5
   embedded meta lists' stated unit points sum exactly to their printed totals). So: stated
   points win, and nothing is ever added on top of them. Only when a header states no usable
   points (0 / a future format) do we fall back to the datasheet's own cost — picked from the
   size option matching the counted models, not blindly u.p[0] — plus the enhancement's cost
   (explicit "+N" if printed, else matched by name in the Builder's DB.enh). */
const WPIMP_HEADER=/^(.+?)\s*[\(\[](\d+)\s*(?:pts?|points?)[\)\]]$/i; // "(360 Points)" · "(95 pts)" · "[95 pts]"
function wpImpSizedPts(u,size){ // datasheet cost for the size option matching the imported model count
  if(!u||!u.p||!u.p.length) return 0;
  const opts=u.p.map(o=>({n:+((String(o[0]).match(/(\d+)/)||[])[1]||0),c:parseInt(o[1])||0}));
  if(!size) return opts[0].c;
  const exact=opts.find(o=>o.n===size); if(exact) return exact.c;
  const bigger=opts.filter(o=>o.n>=size).sort((a,b)=>a.n-b.n)[0]; if(bigger) return bigger.c;
  return opts.slice().sort((a,b)=>b.n-a.n)[0].c; // more models than any option: charge the largest
}
function wpImpParseEnh(lines){ // "Enhancement: Name" / "Enhancements: Name (+10 pts)" -> {n,c|0} | null
  for(const {text} of (lines||[])){
    const m=String(text).match(/^Enhancements?:\s*(.+)$/i); if(!m) continue;
    let n=m[1].trim(), c=0;
    const cm=n.match(/\(\s*\+?\s*(\d+)\s*(?:pts?|points?)?\s*\)\s*$/i);
    if(cm){ c=+cm[1]; n=n.slice(0,cm.index).trim(); }
    return {n,c};
  }
  return null;
}
function wpImpEnhCost(fid,enh){ // fill a missing enhancement cost from the Builder's own DB.enh
  if(!enh||enh.c) return enh;
  const list=(DB.enh&&DB.enh[fid])||[];
  const q=norm(enh.n.replace(/\s*\(upgrade\)\s*$/i,"")); // the GW app suffixes "(Upgrade)" on some enhancements
  const hit=list.find(e=>norm(e.n)===q)||list.find(e=>norm(e.n).includes(q)||q.includes(norm(e.n)));
  return hit?{n:enh.n,c:+hit.c||0}:enh;
}
/* ==== end WP-IMPORT-PTS helpers ==== */
/* ---- army list import ---- */
function openListImport(){
  const sel=document.getElementById("listFaction");
  if(myList.faction) sel.value=myList.faction;
  if(typeof wpImportPopulate==="function") wpImportPopulate(); /* ==== WP-C: auto-import dropdown ==== */
  document.getElementById("listDlg").showModal();
}
function importArmyList(){
  const text=document.getElementById("listText").value;
  let fid=document.getElementById("listFaction").value;
  /* ==== WP-MODELFIX: keep each line's leading-whitespace INDENT alongside its cleaned text — the
     original `.trim()`-only version threw indentation away, which is exactly the signal that tells
     a model line ("• 2x Paragon") apart from its nested wargear ("  • 2x Multi-melta"). ==== */
  const lines=text.split("\n").map(raw=>({indent:(raw.match(/^\s*/)||[""])[0].length,text:raw.replace(/[•●▪]/g,"").trim()}));
  // auto-detect faction from a line exactly matching a faction name
  for(const {text:l} of lines.slice(0,8)){ const f=DB.factions.find(([id,n])=>norm(n)===norm(l)); if(f){ fid=f[0]; break; } }
  /* ==== WP-IMPORTFIX: the Army-tab summary (renderArmy) reads myList.faction/myList.det, which
     otherwise stay at the Builder's default (first faction alphabetically, its first detachment) —
     that's what caused the imported army to display under the WRONG faction/detachment label even
     though the deployed tokens/cards were correct. Sync the builder state to the import's real fid,
     and to the list's own detachment line when the parser found one (blank otherwise — we'd rather
     show nothing than a guessed/stale detachment name). Reuses wp11ParseList so there's one parser. */
  let importedDet="";
  try{ importedDet=wp11ParseList(text).det||""; }catch(e){ importedDet=""; }
  myList.faction=fid; myList.det=importedDet;
  bSave();
  /* ==== end WP-IMPORTFIX (faction/detachment sync) ==== */
  const units=DB.units[fid]||[];
  const found=[], missed=[];
  const sizeRx=/^(incursion|strike force|onslaught|combat patrol)\s*[\(\[]/i; /* ==== WP-IMPORT-PTS: bracket headers too ==== */
  let current=null;
  const flush=()=>{ if(!current) return;
    const match=matchUnit(units,current.name);
    if(match<0){ missed.push(current.name); current=null; return; }
    const size=wp11CountUnitModels(units[match],current.lines)||null; /* ==== WP-MODELFIX: models vs wargear, DB-matched ==== */
    found.push({idx:match,size,name:units[match].n,pts:current.pts||0,enh:wpImpParseEnh(current.lines)}); /* ==== WP-IMPORT-PTS: carry stated points + enhancement ==== */
    current=null; };
  lines.forEach(({indent,text:l},li)=>{
    if(!l) return;
    const um=l.match(WPIMP_HEADER); /* ==== WP-IMPORT-PTS: also matches "(95 pts)" and "[95 pts]" ==== */
    if(um && !sizeRx.test(l) && li>0){ flush(); current={name:um[1],pts:+um[2],lines:[]}; return; }
    if(current) current.lines.push({indent,text:l});
  });
  flush();
  const deploy=document.getElementById("listDeploy").checked;
  myArmy=[]; // the Army tab mirrors the imported list
  /* ==== WP-IMPORT-PTS: price each imported unit truly ==== stated header points win (they
     already include the enhancement — see the helper block above); otherwise fall back to the
     size-matched datasheet cost plus the enhancement's cost, and count those fallbacks so
     renderArmy can keep its "(base datasheet pts)" caveat honest. */
  let basePriced=0;
  found.forEach(f=>{ const c=addFromDb(fid,f.idx,f.size||undefined,true); if(!c) return;
    const enh=wpImpEnhCost(fid,f.enh);
    if(f.pts>0) c.pts=String(f.pts);
    else { c.pts=String(wpImpSizedPts((DB.units[fid]||[])[f.idx],f.size)+(enh&&enh.c?enh.c:0)); basePriced++; }
    if(enh) c.notes=(c.notes?c.notes+" — ":"")+"✦ "+enh.n+(enh.c?" (+"+enh.c+"pts)":"");
    if(deploy) deployCard(c);
  });
  myList.importedNote=basePriced; bSave();                    // 0 (falsy) when every unit had stated points
  localStorage.setItem("wh40k_army",JSON.stringify(myArmy));  // re-persist: pts/notes were stamped after addFromDb's save
  renderArmy();
  /* ==== end WP-IMPORT-PTS ==== */
  broadcastCards(); /* WP0: card sync on list import */
  document.getElementById("listDlg").close();
  logShared(`· <b>${esc(myName)}</b> imported a list: ${found.length} unit${found.length!==1?"s":""} matched${missed.length?", "+missed.length+" not found: "+esc(missed.join("; ")):""}`,"sys");
}
function matchUnit(units,name){
  const q=norm(name).replace(/\s*\[.*\]$/,"");
  let i=units.findIndex(u=>norm(u.n)===q); if(i>=0) return i;
  i=units.findIndex(u=>norm(u.n)===q.replace(/s$/,"")||norm(u.n)+"s"===q); if(i>=0) return i;
  i=units.findIndex(u=>q.startsWith(norm(u.n))||norm(u.n).startsWith(q)); if(i>=0) return i;
  i=units.findIndex(u=>norm(u.n).includes(q)||q.includes(norm(u.n))); if(i>=0) return i;
  // token-overlap fallback
  const qt=new Set(q.split(" ")); let best=-1,score=0;
  units.forEach((u,j)=>{ const ut=norm(u.n).split(" "); const s=ut.filter(t=>qt.has(t)).length/Math.max(ut.length,qt.size);
    if(s>score){score=s;best=j;} });
  return score>=0.6?best:-1;
}

/* ============ terrain layouts (official Event Companion 2026, pp.9-53) ============ */
let LAYOUTS={};
try{ LAYOUTS=JSON.parse(document.getElementById("layouts40k-data").textContent); }catch(e){ console.warn("No layouts embedded",e); }
function populateLayouts(){
  const sel=document.getElementById("terrLayout"); sel.innerHTML="";
  const groups={};
  Object.keys(LAYOUTS).forEach(k=>{
    const m=k.match(/^Official \d+[ABC] \u00b7 (.+)$/);
    const g=m?m[1]:"Custom (unofficial)";
    (groups[g]=groups[g]||[]).push(k);
  });
  for(const g in groups){
    const og=document.createElement("optgroup"); og.label=g;
    groups[g].forEach(k=>{ const o=document.createElement("option"); o.value=k;
      const mm=k.match(/^Official \d+([ABC])/); o.textContent=mm?("Layout "+mm[1]):k.replace("Custom \u00b7 ",""); og.appendChild(o); });
    sel.appendChild(og);
  }
  sel.onchange=updateLayoutInfo; updateLayoutInfo();
}
function updateLayoutInfo(){
  const L=LAYOUTS[document.getElementById("terrLayout").value];
  document.getElementById("layoutInfo").textContent=L&&L.m?("Missions: "+L.m):"";
}
function loadLayout(){
  const name=document.getElementById("terrLayout").value, L=LAYOUTS[name]; if(!L) return;
  if(state.terrain.length||state.objectives.length){ if(!confirm("Replace current terrain, objectives and deployment zones?")) return; }
  while(state.terrain.length) op({k:"ter-",id:state.terrain[0].id});
  while(state.objectives.length) op({k:"obj-",id:state.objectives[0].id});
  const sx=state.board.w/60, sy=state.board.h/44;
  const locked=name.startsWith("Official");
  L.t.forEach(f=>op({k:"ter+",ter:{id:uid(),kind:f.kind,x:f.x*sx,y:f.y*sy,w:f.w*sx,h:f.h*sy,rot:f.rot||0,locked,
    ...(f.shape?{shape:f.shape,tc:f.tc||0}:{}),
    ...(f.fp?{fp:f.fp.map(p=>[p[0]*sx,p[1]*sy])}:{})}})); /* WP3D-v4: triangle fields + real official footprint outline (fp) */
  L.o.forEach(([x,y])=>op({k:"obj+",obj:{id:uid(),x:x*sx,y:y*sy}}));
  op({k:"dz",dz:(L.dz||[]).map(poly=>poly.map(([x,y])=>[x*sx,y*sy]))});
  op({k:"mission",mission:{name,m:L.m||""}});
  logShared("\u00b7 <b>"+esc(myName)+"</b> loaded "+esc(name)+(L.m?" \u2014 missions: "+esc(L.m):""),"sys");
}

/* ============ army / unit cards ============ */
let editIdx=-1;
function migrateCard(u){
  if(u.profiles){ if(!u.kw) u.kw=[]; /* WP0: manual/legacy cards default to no keywords */ return u; }
  return {name:u.name, pts:u.pts||"", weapons:u.weapons||"", notes:u.notes||"", kw:u.kw||[],
    profiles:[{n:u.name,count:u.count||1,base:u.base||"32mm",M:u.M,T:u.T,Sv:u.Sv,Inv:u.Inv,W:u.W||1,Ld:u.Ld,OC:u.OC}]};
}
let editorTarget="army";
function openUnitEditor(i=-1,target="army"){
  editIdx=i; editorTarget=target;
  const u=i>=0?migrateCard(myArmy[i]):null, p=u?u.profiles[0]:null, g=id=>document.getElementById(id);
  g("uName").value=u?u.name:""; g("uCount").value=p?p.count:5; g("uBase").value=p&&p.base?p.base:"32mm";
  g("uM").value=p?p.M:'6"'; g("uT").value=p?p.T:4; g("uSv").value=p?p.Sv:"3+"; g("uInv").value=p?p.Inv:"-";
  g("uW").value=p?p.W:2; g("uLd").value=p?p.Ld:"6+"; g("uOC").value=p?p.OC:2;
  g("uWeapons").value=u?u.weapons:""; g("uNotes").value=u?u.notes:"";
  document.getElementById("unitDlg").showModal();
}
function saveUnitCard(){
  const g=id=>document.getElementById(id);
  const u={name:g("uName").value||"Unit", pts:editIdx>=0?(myArmy[editIdx].pts||""):"",
    profiles:[{n:g("uName").value||"Unit", count:+g("uCount").value||1, base:g("uBase").value,
      M:g("uM").value,T:+g("uT").value,Sv:g("uSv").value,Inv:g("uInv").value,W:+g("uW").value,Ld:g("uLd").value,OC:+g("uOC").value}],
    weapons:g("uWeapons").value, notes:g("uNotes").value};
  if(editorTarget==="list"){
    myList.items.push({custom:u}); bSave(); renderRoster();
    document.getElementById("unitDlg").close(); return;
  }
  if(editIdx>=0){ const old=migrateCard(myArmy[editIdx]); if(old.profiles.length>1) u.profiles=[u.profiles[0],...old.profiles.slice(1)]; myArmy[editIdx]=u; }
  else myArmy.push(u);
  localStorage.setItem("wh40k_army",JSON.stringify(myArmy));
  document.getElementById("unitDlg").close(); renderArmy();
}
function renderArmy(){
  const sum=document.getElementById("armySummary");
  if(sum){
    if(myArmy.length){
      const fname=(DB.factions.find(f=>f[0]===myList.faction)||["",""])[1];
      const pts=myArmy.reduce((s,c)=>s+(parseInt(c.pts)||0),0);
      sum.innerHTML=`<div class="card" style="margin-bottom:8px"><b>${esc(fname||"Your army")}</b>${myList.det?` · ${esc(myList.det)}`:""}<br>
        <span class="small">${myArmy.length} unit${myArmy.length!==1?"s":""} · <b style="color:var(--accent)">${pts} pts</b>
        ${myList.importedNote?` <span class="small" style="color:var(--dim)">(${myList.importedNote===true?"":myList.importedNote+" unit"+(myList.importedNote===1?"":"s")+" at "}base datasheet pts)</span>`:""}</span></div>`;/* ==== WP-IMPORT-PTS: caveat only for units that fell back to datasheet pricing; legacy saves may still hold `true` ==== */
    } else sum.innerHTML="";
  }
  const el=document.getElementById("unitList"); el.innerHTML="";
  myArmy.forEach((raw,i)=>{
    const u=migrateCard(raw);
    const total=u.profiles.reduce((s,p)=>s+(+p.count||0),0);
    const div=document.createElement("div"); div.className="card";
    const stats=u.profiles.map(p=>`<div class="statline">${u.profiles.length>1?`<b>${esc(p.n)}</b> ×${p.count} · `:""}M <b>${esc(p.M||"?")}</b> T <b>${p.T??"?"}</b> Sv <b>${esc(p.Sv||"?")}</b> Inv <b>${esc(p.Inv||"-")}</b> W <b>${p.W??"?"}</b> Ld <b>${esc(p.Ld||"?")}</b> OC <b>${p.OC??"?"}</b></div>`).join("");
    const wrows=(u.weapons||"").split("\n").filter(x=>x.trim()).map(l=>{
      const p=l.split("|").map(x=>x.trim());
      return `<tr><td>${esc(p[0]||"")}</td><td>${esc(p[1]||"")}</td><td>${esc(p[2]||"")}</td><td>${esc(p[3]||"")}</td><td>${esc(p[4]||"")}</td><td>${esc(p[5]||"")}</td><td>${esc(p[6]||"")}</td></tr>`;
    }).join("");
    div.innerHTML=`<div class="title"><span>${esc(u.name)} <span class="small">×${total}${u.pts?" · "+esc(u.pts)+"pts":""}</span></span>
      <span><button onclick="deployUnit(${i})" title="Add models to the table">Deploy</button>
      <button onclick="openUnitEditor(${i})">✎</button>
      <button onclick="myArmy.splice(${i},1);localStorage.setItem('wh40k_army',JSON.stringify(myArmy));renderArmy()">✕</button></span></div>
      ${stats}
      ${wrows?`<table class="wtable"><tr><th>Weapon</th><th>R</th><th>A</th><th>Hit</th><th>S</th><th>AP</th><th>D</th></tr>${wrows}</table>`:""}
      ${u.notes?`<div class="small" style="margin-top:4px">${esc(u.notes)}</div>`:""}`;
    el.appendChild(div);
  });
  if(!myArmy.length) el.innerHTML='<div class="small">No army yet. Build one in the Builder and hit Muster — this tab becomes your quick reference: every unit\'s stats, weapons, enhancement and loadout at a glance.</div>';
}
function deployUnit(i){ deployCard(migrateCard(myArmy[i])); }
/* ==== WP0: foundations ==== */
// Parse a Move stat: '6"' -> 6, "-" -> 0, missing -> 0.
function mvNum(v){ const n=parseFloat(String(v??"").replace(/[^0-9.]/g,"")); return isNaN(n)?0:n; }
// Broadcast my army's cards (display-only copies) so the opponent can inspect my units.
function broadcastCards(){ op({k:"cards", owner:mySide, cards:JSON.parse(JSON.stringify(myArmy.map(migrateCard)))}); }
/* ==== end WP0 ==== */
function deployCard(raw){
  const u=migrateCard(raw), toks=[], unitId=uid();
  const total=u.profiles.reduce((s,p)=>s+(+p.count||0),0)||1;
  const cx=state.board.w*(0.15+Math.random()*0.7), cy= mySide===1 ? state.board.h-4 : 4;
  const per=Math.ceil(Math.sqrt(total)), gap=1.6;
  let k=0;
  const maxCount=Math.max(...u.profiles.map(p=>+p.count||0));
  u.profiles.forEach(p=>{
    const b=wp21BaseFor(p.n||u.name,p.base,p.W); /* ==== WP21 ==== hull table by name first, then base string / wounds */
    const isLeader=u.profiles.length>1 && (+p.count||0)<maxCount;
    for(let c=0;c<(+p.count||0);c++){
      const col=k%per, row=Math.floor(k/per); k++;
      const t={id:uid(),owner:mySide,unit:unitId,name:p.n||u.name,rot:0,wounds:+p.W||1,maxW:+p.W||1,
        x:cx+(col-per/2)*gap, y:cy+(mySide===1?-row:row)*gap, ...b,
        /* ==== WP0: stat-bearing tokens ==== */
        Mv:mvNum(p.M), OC:+p.OC||0, T:+p.T||0, Sv:p.Sv??"", iv:p.Inv??"-", kw:(u.kw||[]).slice(),
        u0:total /* ==== WP7: phases ==== starting strength (models at deploy) for the half-strength battle-shock reminder */};
      if(isLeader){ t.sgt=true; t.role="SGT"; } /* ==== WP14 ==== leader is a role too */
      toks.push(t);
    }
  });
  wp14AutoRoles(u,toks); /* ==== WP14 ==== best-effort weapon pips from the card's loadout text */
  op({k:"tok+",toks});
  wp5DeployWarn(toks); /* ==== WP5: deploy collision warning ==== */
  logShared("· <b>"+esc(myName)+"</b> deployed "+esc(u.name)+" ×"+total,"sys");
}
function exportArmy(){ dl("army.json",JSON.stringify(myArmy,null,1)); }
function importArmy(inp){ const f=inp.files[0]; if(!f)return; f.text().then(t=>{ myArmy=JSON.parse(t); localStorage.setItem("wh40k_army",JSON.stringify(myArmy)); renderArmy(); broadcastCards(); /* WP0: card sync on army import */ }); inp.value=""; }
function dl(name,text){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text])); a.download=name; a.click(); }

/* ============ army list builder ============ */
let myList=JSON.parse(localStorage.getItem("wh40k_list")||'{"faction":"","limit":2000,"items":[]}');
function bSave(){ localStorage.setItem("wh40k_list",JSON.stringify(myList)); }
function bInit(){
  const sel=document.getElementById("bFaction");
  sel.innerHTML=DB.factions.map(([id,n])=>`<option value="${id}">${esc(n)}</option>`).join("");
  sel.value=myList.faction||localStorage.getItem("wh40k_faction")||(DB.factions[0]||[""])[0];
  myList.faction=sel.value;
  document.getElementById("bLimit").value=String(myList.limit||2000);
  bPopDet(); renderBrowser(); renderRoster();
}
function bPopDet(){
  const sel=document.getElementById("bDet"), list=(DB.det&&DB.det[myList.faction])||[];
  sel.innerHTML=list.length?list.map(d=>`<option>${esc(d)}</option>`).join(""):"<option value=''>No detachment data</option>";
  if(!(myList.det&&list.includes(myList.det))) myList.det=list[0]||"";
  sel.value=myList.det; bSave();
}
function bDetChange(){ myList.det=document.getElementById("bDet").value; bSave(); renderRoster(); }
function bSetFaction(){
  const v=document.getElementById("bFaction").value;
  if(myList.items.length && v!==myList.faction && !confirm("Changing faction clears the roster. Continue?")){ document.getElementById("bFaction").value=myList.faction; return; }
  if(v!==myList.faction) myList.items=[];
  myList.faction=v; myList.det=""; bPopDet(); bSave(); renderBrowser(); renderRoster();
}
function bLimitChange(){ myList.limit=+document.getElementById("bLimit").value; bSave(); renderRoster(); }
function bUnits(){ return DB.units[myList.faction]||[]; }
function bSizes(u){
  return (u.p&&u.p.length?u.p:[["1 model","0"]]).map(o=>{const m=o[0].match(/(\d+)/);return {label:o[0],models:m?+m[1]:1,pts:+o[1]||0};});
}
function openBuilder(){ document.getElementById("builderOverlay").classList.add("open"); renderBrowser(); renderRoster(); }
function closeBuilder(){ document.getElementById("builderOverlay").classList.remove("open"); }
function renderBrowser(){
  const q=norm(document.getElementById("bSearch").value||"");
  const el=document.getElementById("bBrowser"); el.innerHTML="";
  const byRole={};
  bUnits().forEach((u,i)=>{ if(q&&!norm(u.n).includes(q))return; const r=u.r||"Other"; (byRole[r]=byRole[r]||[]).push([u,i]); });
  Object.keys(byRole).sort().forEach(role=>{
    const h=document.createElement("div"); h.className="bRole"; h.textContent=role.toUpperCase(); el.appendChild(h);
    const grid=document.createElement("div"); grid.className="bGrid"; el.appendChild(grid);
    byRole[role].forEach(([u,i])=>{
      const sz=bSizes(u), m=u.m&&u.m[0];
      const d=document.createElement("div"); d.className="bCard"; d.title="Click to add to roster";
      d.innerHTML=`<div style="display:flex;justify-content:space-between;gap:6px"><b>${esc(u.n)}</b><span class="bPts">${sz.map(o=>o.pts).join(" / ")} pts</span></div>
        ${m?`<div class="small">M ${esc(m.M)} · T ${m.T} · Sv ${esc(m.Sv)}${m.iv&&m.iv!=="-"?" · Inv "+esc(m.iv)+"+":""} · W ${m.W} · OC ${m.OC}${m.b?" · "+esc(m.b):""}</div>`:""}
        <div class="small">${sz.map(o=>esc(o.label)).join(" · ")}${u.o&&u.o.length?` · <span style="color:var(--dim)">⚙ ${u.o.length} wargear option${u.o.length>1?"s":""}</span>`:""}</div>`;
      d.onclick=()=>bAdd(i);
      grid.appendChild(d);
    });
  });
  if(!el.children.length) el.innerHTML='<div class="small">No matches.</div>';
}
function bAdd(idx){
  const u=bUnits()[idx], sz=bSizes(u);
  let s=0;
  if(sz.length>1){
    const pick=parseInt(prompt(u.n+" — unit size?\n"+sz.map((o,i)=>`${i+1}) ${o.label} — ${o.pts}pts`).join("\n"),"1"));
    if(isNaN(pick)&&pick!==0) return;
    s=Math.min(sz.length,Math.max(1,pick||1))-1;
  }
  myList.items.push({n:u.n, sz:s});
  bSave(); renderRoster();
}
function bFind(name){ return bUnits().findIndex(u=>u.n===name); }
function bItemInfo(it){
  if(it.custom){
    const c=migrateCard(it.custom), models=c.profiles.reduce((s,p)=>s+(+p.count||0),0), pts=parseInt(c.pts)||0;
    return {custom:c, u:{n:c.name,r:"Custom",o:[],m:c.profiles}, opt:{label:models+" model"+(models!==1?"s":""),models,pts}, sz:[{label:"custom",models,pts}], sIdx:0};
  }
  const i=bFind(it.n); if(i<0) return null;
  const u=bUnits()[i], sz=bSizes(u), s=Math.min(it.sz||0,sz.length-1);
  return {u,i,opt:sz[s],sz,sIdx:s};
}
function bTotalPts(){ return myList.items.reduce((s,it)=>{const i=bItemInfo(it);return s+(i?i.opt.pts:0)+(it.enh?it.enh.c:0);},0); }
function renderRoster(){
  const el=document.getElementById("bRoster"); el.innerHTML="";
  let total=0; const counts={};
  myList.items.forEach((it,k)=>{
    const info=bItemInfo(it);
    const d=document.createElement("div");
    d.style.cssText="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--edge)";
    if(!info){ d.innerHTML=`<span class="small">${esc(it.n)} (not found in this faction)</span><button onclick="myList.items.splice(${k},1);bSave();renderRoster()">✕</button>`; el.appendChild(d); return; }
    const enhC=it.enh?it.enh.c:0;
    total+=info.opt.pts+enhC; counts[it.n]=(counts[it.n]||0)+1;
    const sub=[esc(info.opt.label)];
    if(it.enh) sub.push(`<span style="color:var(--accent)">✦ ${esc(it.enh.n)} (+${it.enh.c})</span>`);
    if(it.wg) sub.push(`<span title="${esc(it.wg)}">⚙ loadout</span>`);
    d.innerHTML=`<span>${esc(it.n)}<br><span class="small">${sub.join(" · ")}</span></span>
      <span style="white-space:nowrap"><b>${info.opt.pts+enhC}</b>
      ${info.u.r==="Characters"?`<button title="Enhancement" onclick="bEnhance(${k})">✦</button>`:""}
      ${info.u.o&&info.u.o.length?`<button title="Wargear options" onclick="bWargear(${k})">⚙</button>`:""}
      ${info.sz.length>1?`<button title="Change unit size" onclick="bCycle(${k})">⇄</button>`:""}
      <button title="Duplicate" onclick="bDup(${k})">⧉</button>
      <button onclick="myList.items.splice(${k},1);bSave();renderRoster()">✕</button></span>`;
    el.appendChild(d);
  });
  if(!myList.items.length) el.innerHTML='<div class="small">Click units above to add them. Points update live.</div>';
  const t=document.getElementById("bTotal");
  t.innerHTML=`<b style="color:${total>myList.limit?"var(--bad)":"var(--good)"}">${total}</b> / ${myList.limit} pts`;
  const warns=[];
  if(total>myList.limit) warns.push("Over the points limit!");
  const enhNames={}; let enhTotal=0;
  myList.items.forEach(it=>{ if(!it.enh) return; enhTotal++;
    enhNames[it.enh.n]=(enhNames[it.enh.n]||0)+1;
    if(myList.det&&it.enh.d&&it.enh.d!==myList.det) warns.push(`${it.enh.n} belongs to ${it.enh.d}, not ${myList.det}.`);
  });
  for(const n in enhNames) if(enhNames[n]>1) warns.push(`${n} is taken ${enhNames[n]} times (each enhancement once per army).`);
  if(enhTotal>3) warns.push(`${enhTotal} enhancements (max 3 per army).`);
  for(const n in counts){
    const i=bFind(n), u=i>=0?bUnits()[i]:null, cap=(u&&u.r==="Battleline")?6:3;
    if(counts[n]>cap) warns.push(`${n}: ${counts[n]} copies (matched play allows ${cap}).`);
  }
  document.getElementById("bWarn").innerHTML=warns.map(w=>"⚠ "+esc(w)).join("<br>");
}
function bCycle(k){ const it=myList.items[k], info=bItemInfo(it); if(!info)return; it.sz=(info.sIdx+1)%info.sz.length; bSave(); renderRoster(); }
function bDup(k){ myList.items.splice(k+1,0,{...myList.items[k]}); bSave(); renderRoster(); }
function bClear(){ if(confirm("Clear the roster?")){ myList.items=[]; bSave(); renderRoster(); } }
function bEnhance(k){
  const it=myList.items[k], info=bItemInfo(it); if(!info) return;
  const all=(DB.enh&&DB.enh[myList.faction])||[];
  let list=all.filter(e=>e.d===myList.det);
  if(!list.length) list=all;
  if(!list.length){ alert("No enhancement data for this faction."); return; }
  const menu=list.map((e,i)=>`${i+1}) ${e.n} \u2014 ${e.c}pts${e.d!==myList.det?" ["+e.d+"]":""}`).join("\n");
  const pick=parseInt(prompt((it.enh?"Current: "+it.enh.n+"\n":"")+myList.det+" enhancements (0 to remove):\n"+menu, it.enh?"0":"1"));
  if(isNaN(pick)) return;
  if(pick===0) delete it.enh;
  else { const e=list[Math.min(list.length,Math.max(1,pick))-1]; it.enh={n:e.n,c:e.c,d:e.d}; }
  bSave(); renderRoster();
}
let wgIdx=-1;
function bWargear(k){
  const it=myList.items[k], info=bItemInfo(it); if(!info) return;
  wgIdx=k;
  document.getElementById("wgTitle").textContent=it.n+" \u2014 wargear options";
  document.getElementById("wgBody").innerHTML=(info.u.o||[]).map(o=>"<div style='margin-bottom:6px'>\u2022 "+esc(o)+"</div>").join("")||"<div class='small'>This unit has no wargear options.</div>";
  document.getElementById("wgNotes").value=it.wg||"";
  document.getElementById("wgDlg").showModal();
}
function wgSave(){
  if(wgIdx>=0&&myList.items[wgIdx]){
    const v=document.getElementById("wgNotes").value.trim();
    if(v) myList.items[wgIdx].wg=v; else delete myList.items[wgIdx].wg;
    bSave(); renderRoster();
  }
  document.getElementById("wgDlg").close();
}
function bToGame(){
  if(!myList.items.length) return;
  myArmy=[]; // the Army tab mirrors the mustered list
  myList.importedNote=false; bSave(); /* ==== WP-IMPORTFIX: Builder muster prices enhancements/wargear properly — no "base datasheet pts" caveat needed ==== */
  let n=0;
  const wp17Before=state.tokens.length; /* ==== WP17 ==== snapshot: tokens minted below are the fresh muster ==== end WP17 ==== */
  myList.items.forEach(it=>{
    const info=bItemInfo(it); if(!info) return;
    let c;
    if(it.custom){ c=migrateCard(it.custom); myArmy.push(c); }
    else c=addFromDb(myList.faction,info.i,info.opt.models,true);
    if(c){
      c.pts=String(info.opt.pts+(it.enh?it.enh.c:0));
      let extra=[];
      if(it.enh) extra.push("\u2726 "+it.enh.n+" (+"+it.enh.c+"pts)");
      if(it.wg) extra.push("\u2699 "+it.wg);
      if(it.wg) c.wg=it.wg; /* ==== WP14 ==== raw loadout text rides the card \u2192 auto role pips at deploy */
      if(extra.length) c.notes=(c.notes?c.notes+" \u2014 ":"")+extra.join(" \u00b7 ");
      deployCard(c); n++;
    }
  });
  localStorage.setItem("wh40k_army",JSON.stringify(myArmy)); renderArmy(); showTab("army"); closeBuilder();
  broadcastCards(); /* WP0: card sync on muster */
  logShared(`· <b>${esc(myName)}</b> mustered their army: ${n} units, ${bTotalPts()} pts`,"sys");
  /* ==== WP17 ==== auto-deploy the fresh muster (pre-battle only — a mid-game muster keeps the classic edge drop) */
  if(wp17PreBattle()){
    const wp17New=Array.from(new Set(state.tokens.slice(wp17Before).map(t=>t.unit)));
    if(wp17New.length){
      wp17DeploySide(mySide,wp17New);
      logShared(`· <b>${esc(myName)}</b> auto-deployed their army — drag anything you want to adjust`,"sys");
    }
  }
  /* ==== end WP17 ==== */
}
function bExportText(){
  const fname=(DB.factions.find(f=>f[0]===myList.faction)||["",""])[1];
  const lines=[`My Army (${bTotalPts()} Points)`,fname,myList.det||"",`Strike Force (${myList.limit} Points)`,""];
  myList.items.forEach(it=>{
    const info=bItemInfo(it); if(!info) return;
    lines.push(`${it.n} (${info.opt.pts+(it.enh?it.enh.c:0)} Points)`);
    lines.push(`  • ${info.opt.models}x ${info.u.m[0]?info.u.m[0].n:it.n}`);
    if(it.enh) lines.push(`  • Enhancement: ${it.enh.n} (+${it.enh.c} Points)`);
    if(it.wg) lines.push(`  • Wargear: ${it.wg}`);
    lines.push("");
  });
  dl("army-list.txt",lines.join("\n"));
}

/* ============ secondary objectives / mission cards ============ */
const DEFAULT_SEC=["Behind Enemy Lines","Engage on All Fronts","Assassination","Bring It Down",
  "No Prisoners","Storm Hostile Objective","Cleanse","Secure No Man's Land","Extend Battle Lines",
  "Overwhelming Force","Defend Stronghold","Area Denial","Recover Assets","Sabotage",
  "Establish Locus","Containment","Marked for Death","Deploy Teleport Homers","Investigate Signals",
  "A Tempting Target","Titanic Slayer"];
let secDeck=JSON.parse(localStorage.getItem("wh40k_secdeck")||"null")||DEFAULT_SEC.slice();
// Brief factual summaries in my own words (game mechanics only — not the official card text).
// Edit any card in-app to paste the exact scoring from the deck you own.
const CARD_SUMMARY={
  "Behind Enemy Lines":"Rewards having a qualifying unit within the enemy's deployment zone.",
  "Engage on All Fronts":"Rewards spreading units across the table quarters.",
  "Assassination":"Rewards destroying enemy CHARACTER units.",
  "Bring It Down":"Rewards destroying enemy MONSTER and VEHICLE units.",
  "No Prisoners":"Rewards destroying enemy units outright.",
  "Storm Hostile Objective":"Rewards controlling an objective in the enemy's half.",
  "Cleanse":"Rewards performing an action to cleanse objectives you hold.",
  "Secure No Man's Land":"Rewards controlling objectives in No Man's Land.",
  "Extend Battle Lines":"Rewards controlling objectives in No Man's Land and your own half.",
  "Overwhelming Force":"Rewards destroying enemy units that are on an objective.",
  "Defend Stronghold":"Rewards controlling the objective in your own deployment zone.",
  "Area Denial":"Rewards holding the centre while keeping the enemy away from it.",
  "Recover Assets":"Rewards performing actions on objectives to recover assets.",
  "Sabotage":"Rewards performing a sabotage action on terrain or objectives.",
  "Establish Locus":"Rewards performing an action near the centre of the battlefield.",
  "Containment":"Rewards having units near the far edges of the enemy's zone.",
  "Marked for Death":"Rewards destroying enemy units marked at the start of the game.",
  "Deploy Teleport Homers":"Rewards performing actions out in No Man's Land.",
  "Investigate Signals":"Rewards performing actions on objectives.",
  "A Tempting Target":"Rewards controlling one nominated objective this turn.",
  "Titanic Slayer":"Rewards destroying enemy TITANIC units.",
};
const PRIMARY_SUMMARY={
  "Battlefield Dominance":"Progressive primary: score in your Command phase for the objectives you control.",
  "Immovable Object":"Rewards holding the fixed/central objectives against the attacker.",
  "Unstoppable Force":"Rewards pushing forward to seize contested objectives.",
  "Determined Acquisition":"Progressive scoring for controlling objectives, with a bonus for grabbing more.",
  "Death Trap":"Objectives can be trapped/deadly — score for control while managing the hazard.",
  "Purge and Secure":"Blends holding objectives with clearing enemy units off them.",
  "Reconnaissance Sweep":"Rewards moving units across the board to scout/hold ground.",
  "Inescapable Dominion":"Progressive control scoring that ramps up in the later rounds.",
  "Secure Asset":"Rewards securing and keeping a key asset objective.",
  "Meatgrinder":"Attrition primary: score for controlling objectives and grinding down the foe.",
  "Punishment":"Rewards destroying enemy units, especially on objectives.",
  "Delaying Action":"Rewards holding ground and slowing the enemy advance.",
  "Consecrate":"Rewards performing actions to consecrate objectives you hold.",
  "Triangulation":"Rewards holding a spread of objectives to triangulate the field.",
  "Destroyer's Wrath":"Rewards aggressive destruction of enemy units.",
  "Vital Link":"Rewards holding a chain/line of linked objectives.",
  "Outmanoeuvre":"Rewards out-positioning the enemy across shifting objectives.",
  "Smoke and Mirrors":"Rewards misdirection — scoring actions plus objective control.",
  "Surveil the Foe":"Rewards performing surveillance actions across the board.",
  "Locate and Deny":"Rewards holding objectives while denying them to the enemy.",
  "Extract Relic":"Rewards picking up and extracting a relic objective.",
  "Gather Intel":"Rewards performing intel actions across the battlefield.",
  "Search and Scour":"Rewards sweeping the board — actions plus objective control.",
  "Vanguard Operation":"Rewards pushing vanguard units into contested ground.",
  "Sabotage (primary)":"Rewards sabotage actions plus holding objectives.",
};
let cardText=JSON.parse(localStorage.getItem("wh40k_cardtext")||"{}");
function cardDefault(name){ return CARD_SUMMARY[name]||PRIMARY_SUMMARY[name]||""; }
function cardInfo(name){ return cardText[name]!==undefined?cardText[name]:cardDefault(name); }
let cardDlgName="";
function openCardReader(name){
  cardDlgName=name;
  document.getElementById("cardDlgTitle").textContent=name;
  document.getElementById("cardDlgText").value=cardInfo(name);
  document.getElementById("cardDlg").showModal();
}
function saveCardText(){
  const v=document.getElementById("cardDlgText").value;
  cardText[cardDlgName]=v; localStorage.setItem("wh40k_cardtext",JSON.stringify(cardText));
  op({k:"cardtext",name:cardDlgName,text:v}); // share with opponent
  document.getElementById("cardDlg").close(); renderCards();
}
function resetCardText(){ document.getElementById("cardDlgText").value=cardDefault(cardDlgName); }
function lookupCard(){ if(cardDlgName) window.open("https://www.google.com/search?q="+encodeURIComponent("wahapedia "+cardDlgName+" warhammer 40k"),"_blank"); }
// Open the user's own free Event Companion PDF to the loaded mission's official layout page.
let ecPath=localStorage.getItem("wh40k_ecpath")||"../Free Rules Downloads/03 Event Companions/Warhammer Event Companion.pdf";
function layoutPdfPage(name){ const m=name&&name.match(/Official (\d+)([ABC])/); return m?6+3*(+m[1])+"ABC".indexOf(m[2]):null; }
function openMissionPdf(){
  const p=layoutPdfPage(state.mission&&state.mission.name);
  if(!p){ alert("Load an official layout in Setup first."); return; }
  const url=ecPath.split("/").map(s=>s===".."||s==="."?s:encodeURIComponent(s)).join("/")+"#page="+p;
  window.open(url,"_blank");
}
function setEcPath(){ const v=prompt("Path to your free Warhammer Event Companion.pdf (relative to this HTML file, or an absolute file:// URL):",ecPath); if(v){ ecPath=v.trim(); localStorage.setItem("wh40k_ecpath",ecPath); } }
function openBulk(){ document.getElementById("bulkText").value=""; document.getElementById("bulkDlg").showModal(); }
function bulkImportCards(){
  const raw=document.getElementById("bulkText").value; let added=0;
  const apply=(name,text)=>{ name=name.trim(); if(!name)return; text=text.trim(); cardText[name]=text; op({k:"cardtext",name,text}); added++; };
  if(/^##/m.test(raw)){
    raw.split(/^##[ \t]*/m).forEach(block=>{ block=block.replace(/^\s+/,""); if(!block.trim())return;
      const nl=block.indexOf("\n"); apply(nl<0?block:block.slice(0,nl), nl<0?"":block.slice(nl+1)); });
  } else {
    raw.split("\n").forEach(line=>{ const m=line.match(/^(.+?)\s*(?:::|\|)\s*(.+)$/); if(m) apply(m[1],m[2]); });
  }
  localStorage.setItem("wh40k_cardtext",JSON.stringify(cardText));
  document.getElementById("bulkDlg").close(); renderCards();
  logSys(added+" card text"+(added===1?"":"s")+" imported"+(added?" and shared with your opponent.":". Check the format — use ## Card Name headers."));
}
function renderScore(){
  const el=document.getElementById("scoreboard"); if(!el) return;
  const t=state.trackers||{round:1,cp1:0,cp2:0,vp1:0,vp2:0}; /* WP8: spectator/legacy-safe */
  const over=wpGameOver(); /* ==== WP-END ==== */
  const overBanner=over?(()=>{ const v1=t.vp1||0,v2=t.vp2||0,nm=s=>esc((state.names&&state.names[s])||("Player "+s));
    const verdict=v1===v2?`Draw — ${v1}–${v2}`:(v1>v2?`<b style="color:var(--p1)">${nm(1)}</b> wins ${v1}–${v2}`:`<b style="color:var(--p2)">${nm(2)}</b> wins ${v2}–${v1}`);
    return `<div class="card" style="padding:8px;margin-bottom:6px;border-left:3px solid var(--accent);background:rgba(212,175,55,.12)"><b>🏁 Game over</b> <span class="small">— battle round ${WP7_LAST_ROUND} complete.</span><div style="margin-top:3px">${verdict}</div><div class="small">Add any end-of-game secondaries, then tweak VP with the steppers if the tally differs.</div></div>`; })():"";
  el.innerHTML=overBanner+[1,2].map(s=>{
    const nm=esc(state.names[s]||("Player "+s)), col=s===1?"var(--p1)":"var(--p2)";
    return `<div class="card" style="padding:8px;margin-bottom:6px;border-left:3px solid ${col}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b style="color:${col}">${nm}</b><span class="small">${s===mySide?"you":""}</span></div>
      <div style="display:flex;gap:14px;margin-top:4px;align-items:center">
        <span>VP <button onclick="stepTracker('vp${s}',-1)">−</button> <b style="font-size:17px">${t['vp'+s]}</b> <button onclick="stepTracker('vp${s}',1)">+</button></span>
        <span>CP <button onclick="stepTracker('cp${s}',-1)">−</button> <b style="font-size:17px">${t['cp'+s]}</b> <button onclick="stepTracker('cp${s}',1)">+</button></span>
      </div></div>`;
  }).join("")+`<div class="small" style="margin-bottom:6px">Battle round <button onclick="stepTracker('round',-1)">−</button> <b>${over?(WP7_LAST_ROUND+" ✓"):t.round}</b> <button onclick="stepTracker('round',1)">+</button> · synced with the top bar</div>`;
}
function renderCards(){
  renderScore();
  const mi=document.getElementById("missionInfo");
  if(mi){
    if(state.mission){
      const names=[...new Set((state.mission.m||"").split("/").map(s=>s.trim()).filter(Boolean))];
      const objs=state.objectives.length;
      const pg=layoutPdfPage(state.mission.name);
      mi.innerHTML=`<div class="card" style="padding:8px"><b>${esc(state.mission.name)}</b>
        <div class="small">${objs} objective${objs!==1?"s":""} on the table.</div>
        ${names.map(nm=>`<div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;gap:6px">
          <span>${esc(nm)}<br><span class="small">${esc(cardInfo(nm)||"Tap 📖 to add scoring from your deck.")}</span></span>
          <button title="Read / edit" onclick="openCardReader(${JSON.stringify(nm).replace(/"/g,'&quot;')})">📖</button></div>`).join("")}
        ${pg?`<div class="row" style="margin-top:8px"><button onclick="openMissionPdf()">📄 Open in Event Companion (p.${pg})</button><button title="Set PDF location" onclick="setEcPath()">⚙</button></div>
        <div class="small">Opens your free Event Companion PDF to this mission's official layout page. The full VP scoring is in the paid Chapter Approved Mission Deck.</div>`:""}</div>`;
    } else mi.textContent="No layout loaded. Load one in Setup to see the primary mission and objectives.";
  }
  const el=document.getElementById("secDraws"); if(!el) return;
  el.innerHTML="";
  [mySide,mySide===1?2:1].forEach(side=>{
    const cards=state.sec.filter(c=>c.owner===side);
    const h=document.createElement("div"); h.className="bRole";
    h.style.color=side===1?"var(--p1)":"var(--p2)";
    h.textContent=(side===mySide?"Your hand":(state.names[side]||("Player "+side))+"'s hand")+" ("+cards.length+")";
    el.appendChild(h);
    if(!cards.length){ const e=document.createElement("div"); e.className="small"; e.textContent="— no cards —"; el.appendChild(e); }
    cards.forEach(c=>{
      const d=document.createElement("div"); d.className="card"; d.style.padding="6px 8px";
      d.innerHTML=`<div class="title"><span>🎴 ${esc(c.name)}</span>
        <span style="white-space:nowrap"><button title="Read / edit" onclick="openCardReader(${JSON.stringify(c.name).replace(/"/g,'&quot;')})">📖</button>${side===mySide?`<button title="Discard" onclick="discardSec('${c.id}')">✕</button>`:""}</span></div>
        <div class="small">${esc(cardInfo(c.name)||"Tap 📖 to add scoring from your deck.")}</div>`;
      el.appendChild(d);
    });
  });
}
function drawSecondary(){
  if(!secDeck.length){ alert("Your deck is empty. Click Edit deck."); return; }
  const inHand=new Set(state.sec.filter(c=>c.owner===mySide).map(c=>c.name));
  let pool=secDeck.filter(n=>!inHand.has(n)); if(!pool.length) pool=secDeck;
  const name=pool[Math.floor(Math.random()*pool.length)];
  op({k:"sec+",card:{id:uid(),owner:mySide,name}});
  logShared("🎴 <b>"+esc(myName)+"</b> drew a secondary: <b>"+esc(name)+"</b>","dice");
}
function discardSec(id){
  const c=state.sec.find(x=>x.id===id); op({k:"sec-",id});
  if(c) logShared("🎴 <b>"+esc(myName)+"</b> discarded <b>"+esc(c.name)+"</b>","sys");
}
function openSecDeck(){ document.getElementById("secDeckText").value=secDeck.join("\n"); document.getElementById("secDeckDlg").showModal(); }
function saveSecDeck(){ secDeck=document.getElementById("secDeckText").value.split("\n").map(s=>s.trim()).filter(Boolean);
  localStorage.setItem("wh40k_secdeck",JSON.stringify(secDeck)); document.getElementById("secDeckDlg").close(); }
function resetSecDeck(){ document.getElementById("secDeckText").value=DEFAULT_SEC.join("\n"); }

/* ============ trackers / setup ============ */
function stepTracker(key,dv){ state.trackers[key]=Math.max(key==="round"?1:0,(state.trackers[key]||0)+dv); refreshTrackers(); op({k:"track",trackers:state.trackers}); /* WP1: route through applyOp so autosave (and redraws) fire */
  /* ==== WP-RULES: CP economy ==== manual CP adjustments get a shared log line too (auto Command-phase +1 already logs via wp7ApplyPhase) */
  if(/^cp[12]$/.test(key)){ const side=key.slice(2), nm=esc((state.names&&state.names[side])||("Player "+side));
    logShared(`· <b>${nm}</b> ${dv>0?"gained":"spent"} ${Math.abs(dv)} CP (now ${state.trackers[key]})`,"sys"); }
}
function refreshTrackers(){
  const t=state.trackers||{round:1,cp1:0,cp2:0,vp1:0,vp2:0}, g=id=>document.getElementById(id); /* WP8: spectator/legacy-safe */
  g("tRound").textContent=wpGameOver()?(WP7_LAST_ROUND+" ✓"):t.round; /* WP-END: never show a bogus round 6 — the game ends at round 5 */
  g("tCp1").textContent=t.cp1; g("tCp2").textContent=t.cp2; g("tVp1").textContent=t.vp1; g("tVp2").textContent=t.vp2;
  g("n1").textContent=(state.names&&state.names[1])||"Player 1"; g("n2").textContent=(state.names&&state.names[2])||"Player 2"; /* WP8: spectator/legacy-safe */
  renderScore();
}
function setName(v){ myName=v||"Player"; localStorage.setItem("wh40k_name",myName); op({k:"name",side:mySide,name:myName}); }
function setSide(v){ wp23SetSide(v); } /* ==== WP23 ==== was: mySide=+v + name op — now the switch re-homes synced cards/tokens pre-battle in a network game and refuses mid-battle; offline keeps the legacy hot-seat flip (see wp23SetSide) ==== end WP23 ==== */
function setBoard(v){ const [w,h]=v.split("x").map(Number); op({k:"board",board:{w,h}}); }
function clearTable(){ if(typeof aiInterrupt==="function") aiInterrupt(); /* ==== WP10: ai ==== */ op({k:"clear"}); logShared("· Table cleared","sys"); }
function saveGame(){ dl("wh40k-game.json",JSON.stringify(state)); }
function loadGame(inp){ const f=inp.files[0]; if(!f)return; f.text().then(t=>{ if(typeof aiInterrupt==="function") aiInterrupt(); /* ==== WP10: ai ==== */ state=JSON.parse(t); if(!state.sec)state.sec=[]; if(!state.cards)state.cards={1:[],2:[]}; /* WP0 back-compat */ wp1Compat(state); wp1Autosave(); /* WP1 */ wpCapMode=null; /* ==== WP-FIGHT ==== */ refreshTrackers(); if(typeof wpRulesRenderStrats==="function"){wpRulesRenderStrats();wpRulesShowReminder();} /* ==== WP-RULES ==== */ fitView(); send({t:"state",state}); logSys("Game loaded."); }); inp.value=""; }
function showTab(name){
  document.querySelectorAll(".tabpane").forEach(p=>p.classList.toggle("active",p.id==="tab-"+name));
  document.querySelectorAll("#tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
}

/* ============ board rendering ============ */
const cv=document.getElementById("board"), ctx=cv.getContext("2d");
let view={x:0,y:0,s:14}; // s = px per inch
let tool="select", sel=new Set(), drag=null, marquee=null, ruler=null, theirRuler=null, theirRulerTimer=null, rings=0;
/* ==== WP-A: structured movement ==== client-local bookkeeping, NOT synced and NOT saved —
   same philosophy as `sel`. Every peer/tab tracks its own view of "have I moved this yet". */
const wpMoved=new Set();      // model ids that have completed their one move this Movement phase
const wpMoveStart={};         // unit -> [{id,x,y,rot}] snapshot taken the first time any of its models is dragged this phase
const wpDone=new Set();       // unit ids explicitly marked "Movement complete" — locked regardless of wpMoved state
function wpResetMove(){ wpMoved.clear(); wpDone.clear(); for(const k in wpMoveStart) delete wpMoveStart[k]; }
/* ==== end WP-A ==== */
/* ==== WP-FIGHT: pile-in / consolidate ==== client-local armed state, same philosophy as `sel` —
   {mode:"pile"|"consolidate", unit, cap:3} while armed, else null. Not synced, not saved. */
let wpCapMode=null;
/* ==== end WP-FIGHT ==== */
/* ---- unit coherency (2" of one squadmate, 9" of all squadmates) ---- */
let incoherent=new Set();
const tokRadius=t=>t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2;
/* ==== WP22 ==== exact edge-to-edge distance between token footprints (helpers live in
   the WP22 section before init). Rect tokens use their true rotated w×h footprint
   instead of the old min-half-dimension shortcut, which understated a vehicle hull's
   long side by up to ~0.8" per rect. Sign convention: positive = gap, negative =
   overlapping. Circle↔circle and circle↔rect return the exact penetration depth when
   overlapping; rect↔rect returns 0 when the perimeters touch/cross and a negative
   corner-containment depth when a corner of one lies inside the other (a value ≤0 on
   any overlap — not an exact depth). Oval (WP21) tokens are measured as their full
   bounding rect: slightly generous at the corners, never short. */
const edgeDist=(a,b)=>{
  if(a.shape==="c"){
    if(b.shape==="c") return Math.hypot(a.x-b.x,a.y-b.y)-tokRadius(a)-tokRadius(b); // hot path: one hypot, no allocations
    return wp22PtRectSd(a.x,a.y,b)-mmIn(a.dmm)/2;
  }
  if(b.shape==="c") return wp22PtRectSd(b.x,b.y,a)-mmIn(b.dmm)/2;
  return wp22RectRect(a,b);
};
/* ==== end WP22 ==== */
function checkCoherency(){
  incoherent=new Set();
  const byUnit={};
  state.tokens.forEach(t=>{ (byUnit[t.unit]=byUnit[t.unit]||[]).push(t); });
  for(const uk in byUnit){ const ms=byUnit[uk]; if(ms.length<2) continue;
    ms.forEach(m=>{
      const near=ms.some(o=>o!==m&&edgeDist(m,o)<=2.02);
      const far=ms.some(o=>o!==m&&edgeDist(m,o)>9.02);
      if(!near||far) incoherent.add(m.id);
    });
  }
}
const unitCoherent=uk=>state.tokens.filter(t=>t.unit===uk).every(t=>!incoherent.has(t.id));
const RING_SIZES=[6,9,12,24];
function setTool(t){ tool=t; document.querySelectorAll("#toolbar button[id]").forEach(b=>b.classList.toggle("active",b.id==="tool-"+t)); cv.style.cursor = t==="select"?"default":"crosshair"; if(t!=="attack"&&typeof wp15Disarm==="function") wp15Disarm(); /* ==== WP15 ==== leaving the tool drops the armed attacker */ if(t!=="ruler"&&typeof wp19End==="function") wp19End(true); /* ==== WP19 ==== leaving the tool ends the waypoint chain */ }
function resize(){ const r=cv.parentElement.getBoundingClientRect(); cv.width=r.width*devicePixelRatio; cv.height=r.height*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); draw(); }
window.addEventListener("resize",resize);
function fitView(){
  const r=cv.parentElement.getBoundingClientRect();
  view.s=Math.min((r.width-40)/state.board.w,(r.height-40)/state.board.h);
  view.x=(r.width-state.board.w*view.s)/2; view.y=(r.height-state.board.h*view.s)/2; draw();
}
const px=(ix,iy)=>[view.x+ix*view.s, view.y+iy*view.s];
const inch=(cx,cy)=>[(cx-view.x)/view.s,(cy-view.y)/view.s];
const mmIn=mm=>mm/25.4;
const TERR_COLORS={ruin:"#3a4250",wood:"#2f4434",crate:"#4a4436",wall:"#44484e",crater:"#3c3640"};
/* ==== WP9: board & terrain visuals ==== cosmetic only — footprint geometry, hit-testing
   and rules math are untouched. All randomness is seeded from the feature id so both
   peers render identical scenery and nothing shimmers between frames. Gradient/pattern
   helpers fall back to flat colors under the node test stubs. */
function wp9Hash(s){ let h=2166136261; s=String(s); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function wp9Rng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function wp9LinGrad(x0,y0,x1,y1,stops,fallback){
  try{ const g=ctx.createLinearGradient(x0,y0,x1,y1); if(!g||!g.addColorStop) return fallback;
    for(const s of stops) g.addColorStop(s[0],s[1]); return g; }catch(e){ return fallback; }
}
function wp9RadGrad(x0,y0,r0,x1,y1,r1,stops,fallback){
  try{ const g=ctx.createRadialGradient(x0,y0,r0,x1,y1,r1); if(!g||!g.addColorStop) return fallback;
    for(const s of stops) g.addColorStop(s[0],s[1]); return g; }catch(e){ return fallback; }
}
let wp9Mat=null, wp9MatTried=false;
function wp9MatPattern(){ // battlefield-mat grit, built once
  if(wp9MatTried) return wp9Mat;
  wp9MatTried=true;
  try{
    const c=document.createElement("canvas"); if(!c.getContext) return null;
    c.width=c.height=160;
    const g=c.getContext("2d"); if(!g||!g.createImageData||!g.putImageData) return null;
    const img=g.createImageData(160,160), rnd=wp9Rng(40000);
    for(let i=0;i<img.data.length;i+=4){
      const v=36+rnd()*13, fleck=rnd();
      img.data[i]=v+(fleck<.05?12:0); img.data[i+1]=v+2+(fleck<.05?9:0); img.data[i+2]=v-4; img.data[i+3]=255;
    }
    g.putImageData(img,0,0);
    wp9Mat=ctx.createPattern(c,"repeat")||null;
  }catch(e){ wp9Mat=null; }
  return wp9Mat;
}
const wp9HatchCache={};
function wp9Hatch(col){ // diagonal-line pattern for DZ shading
  if(col in wp9HatchCache) return wp9HatchCache[col];
  try{
    const c=document.createElement("canvas"); if(!c.getContext) return wp9HatchCache[col]=null;
    c.width=c.height=12;
    const g=c.getContext("2d"); if(!g||!g.beginPath) return wp9HatchCache[col]=null;
    g.strokeStyle=col; g.lineWidth=1.2;
    g.beginPath(); g.moveTo(-3,15); g.lineTo(15,-3); g.moveTo(-3,3); g.lineTo(3,-3); g.moveTo(9,15); g.lineTo(15,9); g.stroke();
    return wp9HatchCache[col]=(ctx.createPattern(c,"repeat")||null);
  }catch(e){ return wp9HatchCache[col]=null; }
}
// Each wp9<Kind> draws in local terrain space: origin = feature centre, already rotated; w/h in px.
/* ==== WP3D-v4b (11th-ed, matched to GW's official "Terrain Area Footprints") ==== A terrain
   area footprint is a FLAT battle-damaged deck: rusty riveted rockcrete/metal plating with
   crushed-rockcrete RUBBLE spilling over the edges and scattered girder debris. NOT tall clean
   buildings. wp9Plate draws that deck; wp9Ruin = the heavy-rubble footprint itself. */
function wp9Rubble(cx,cy,r,rnd){ // pale crushed-rockcrete rubble CLUSTER (GW "popcorn" look)
  ctx.fillStyle="rgba(20,16,10,.22)"; ctx.beginPath(); ctx.arc(cx+r*.12,cy+r*.15,r*.98,0,7); ctx.fill(); // soft shadow
  const nb=Math.max(6,Math.round((r/view.s)*15)); // count from WORLD radius so RNG stream is zoom-invariant (bits stay fixed, only scale)
  for(let i=0;i<nb;i++){
    const a=rnd()*6.283, rr=Math.sqrt(rnd())*r, bx=cx+Math.cos(a)*rr, by=cy+Math.sin(a)*rr, br=Math.max(1.5,r*(0.14+rnd()*0.2));
    ctx.beginPath(); const m=5; for(let j=0;j<m;j++){ const aa=j/m*6.283+rnd()*.5, cr=br*(0.7+rnd()*0.5), x=bx+Math.cos(aa)*cr, y=by+Math.sin(aa)*cr; j?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.closePath();
    const t=rnd(); ctx.fillStyle=t<.45?"#ddd0ac":t<.78?"#c6b689":"#a5946c"; ctx.fill();
    ctx.fillStyle="rgba(247,241,224,.5)"; ctx.beginPath(); ctx.arc(bx-br*.3,by-br*.35,br*.3,0,7); ctx.fill(); // lit top
  }
}
function wp9Girder(cx,cy,l,ang,rnd){ // dark steel I-beam / bar debris
  const th=view.s*.24; ctx.save(); ctx.translate(cx,cy); ctx.rotate(ang);
  ctx.fillStyle="rgba(0,0,0,.3)"; ctx.fillRect(-l/2+1.4,-th/2+1.6,l,th);
  ctx.fillStyle="#565c62"; ctx.fillRect(-l/2,-th/2,l,th);
  ctx.fillStyle="#6e757c"; ctx.fillRect(-l/2,-th/2,l,th*.34);
  ctx.strokeStyle="rgba(18,20,24,.6)"; ctx.lineWidth=1; ctx.strokeRect(-l/2,-th/2,l,th);
  ctx.restore();
}
function wp9Fan(cx,cy,r){ // circular vent/fan cover
  ctx.fillStyle="#3a362f"; ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.fill();
  ctx.strokeStyle="rgba(150,146,132,.5)"; ctx.lineWidth=1.4;
  for(let k=0;k<6;k++){ const a=k/6*6.283; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(a)*r*.86,cy+Math.sin(a)*r*.86); ctx.stroke(); }
  ctx.strokeStyle="rgba(28,24,18,.7)"; ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.stroke();
}
function wp9Deck(w,h,seed){ // rusty riveted metal deck plating with drainage slots + verdigris
  const rnd=wp9Rng((seed^0x1a2b3c)>>>0), s=view.s, L=-w/2,T=-h/2,R=w/2,B=h/2;
  ctx.fillStyle=wp9LinGrad(L,T,R,B,[[0,"#8a6540"],[1,"#5f4526"]],"#755130"); ctx.fillRect(L,T,w,h);
  for(let i=0;i<Math.round(w*h/(s*s*3))+3;i++){ const t=rnd(); ctx.fillStyle=t<.35?"rgba(152,98,50,.20)":t<.6?"rgba(62,42,22,.24)":t<.82?"rgba(78,112,94,.16)":"rgba(122,72,36,.16)"; const bx=L+rnd()*w,by=T+rnd()*h,br=s*(.35+rnd()*.9); ctx.beginPath(); ctx.arc(bx,by,br,0,7); ctx.fill(); }
  const pw=Math.max(11,s*2.1);
  for(let px0=L; px0<R-1; px0+=pw) for(let py0=T; py0<B-1; py0+=pw){
    const pxe=Math.min(px0+pw,R), pye=Math.min(py0+pw,B), pwv=pxe-px0, phv=pye-py0;
    ctx.strokeStyle="rgba(26,16,8,.5)"; ctx.lineWidth=1; ctx.strokeRect(px0+.5,py0+.5,pwv-1,phv-1);
    ctx.fillStyle="rgba(38,26,12,.55)"; [[px0+2.2,py0+2.2],[pxe-2.2,py0+2.2],[px0+2.2,pye-2.2],[pxe-2.2,pye-2.2]].forEach(([rx,ry])=>{ctx.beginPath();ctx.arc(rx,ry,1.05,0,7);ctx.fill();});
    // drainage slots
    const midx=(px0+pxe)/2, midy=(py0+pye)/2, sw=pwv*0.52, sh=phv*0.5;
    ctx.fillStyle="rgba(20,14,8,.5)"; for(let k=-1;k<=1;k++) ctx.fillRect(midx-sw/2, midy+k*sh*0.3-sh*0.05, sw, Math.max(1.4,sh*0.1));
  }
}
/* GW official terrain-area footprint graphic: a rusty RIVETED METAL DECK, strewn with pale
   CRUSHED-ROCKCRETE rubble (biased to edges/corners) and dark STEEL GIRDER debris, plus the odd
   fan/vent. wp9Terrain clips this to the real footprint outline (rules footprint = the rectangle). */
function wp9Plate(w,h,seed,heavy){
  const rnd=wp9Rng(seed), s=view.s, L=-w/2,T=-h/2,R=w/2,B=h/2, area=(w*h)/(s*s);
  wp9Deck(w,h,seed);
  if(Math.min(w,h)>s*3 && rnd()<.6){ const fr=s*.85, fx=Math.max(L+fr,Math.min(R-fr,(rnd()-.5)*w)), fy=Math.max(T+fr,Math.min(B-fr,(rnd()-.5)*h)); wp9Fan(fx,fy,fr); }
  for(let i=0;i<(heavy?4:2);i++){ const l=s*(1.4+rnd()*1.8), mg=l/2+s*.2, dx=Math.min(R-mg,Math.max(L+mg,L+rnd()*w)), dy=Math.min(B-s*.5,Math.max(T+s*.5,T+rnd()*h)); wp9Girder(dx,dy,l,rnd()*Math.PI,rnd); }
  const nR=(heavy?7:4)+Math.round(area/26);
  for(let i=0;i<nR;i++){
    const rr=s*(.7+rnd()*(heavy?1.5:1.0));
    let cx,cy;
    if(rnd()<.6){ const side=Math.floor(rnd()*4), m=rr*.5;
      cx=side===0?L+m:side===1?R-m:L+m+rnd()*(w-2*m);
      cy=side===2?T+m:side===3?B-m:T+m+rnd()*(h-2*m);
    } else { cx=L+(.15+rnd()*.7)*w; cy=T+(.15+rnd()*.7)*h; }
    cx=Math.max(L+rr*.35,Math.min(R-rr*.35,cx)); cy=Math.max(T+rr*.35,Math.min(B-rr*.35,cy));
    wp9Rubble(cx,cy,rr,rnd);
  }
}
/* 11th-ed terrain-area footprint (ruin): the heavy crushed-rockcrete rubble field ON the deck.
   Flat — the footprint IS the obscuring area (per the 11th-ed rules), not a tall building. */
function wp9Ruin(w,h,seed){ wp9Plate(w,h,seed,true); }
function wp9Wood(w,h,seed){
  const rnd=wp9Rng(seed), s=view.s;
  ctx.fillStyle=wp9LinGrad(0,-h/2,0,h/2,[[0,"#2c4630"],[1,"#233828"]],"#273e2c");
  ctx.fillRect(-w/2,-h/2,w,h);
  ctx.strokeStyle="rgba(110,150,110,.35)"; ctx.lineWidth=1; ctx.setLineDash([4,3]);
  ctx.strokeRect(-w/2,-h/2,w,h); ctx.setLineDash([]);
  const n=Math.max(3,Math.min(26,Math.round((w*h)/(s*s*4.5))));
  for(let i=0;i<n;i++){
    const tx=(rnd()-.5)*(w-s*1.2), ty=(rnd()-.5)*(h-s*1.2), r=s*(.5+rnd()*.6);
    ctx.fillStyle=wp9RadGrad(tx-r*.3,ty-r*.3,r*.15,tx,ty,r,[[0,"#41653c"],[1,"#28422a"]],"#33512f");
    ctx.beginPath(); ctx.arc(tx,ty,r,0,7); ctx.fill();
    ctx.strokeStyle="rgba(15,28,16,.55)"; ctx.lineWidth=1.2; ctx.stroke();
    ctx.fillStyle="rgba(190,220,160,.10)"; ctx.beginPath(); ctx.arc(tx-r*.3,ty-r*.35,r*.32,0,7); ctx.fill();
  }
  wpvWoodStipple(w,h,seed); /* ==== WP-VISUALS ==== leafy canopy stipple (toggle-gated) */
}
function wp9Crate(w,h,seed){
  const s=view.s;
  ctx.fillStyle=wp9LinGrad(0,-h/2,0,h/2,[[0,"#5c4a2e"],[1,"#443620"]],"#4f3f27");
  ctx.fillRect(-w/2,-h/2,w,h);
  ctx.strokeStyle="rgba(0,0,0,.30)"; ctx.lineWidth=1; // corrugation across the long axis
  const step=Math.max(3,s*.38);
  if(w>=h){ for(let x=-w/2+step;x<w/2;x+=step){ ctx.beginPath(); ctx.moveTo(x,-h/2+1.5); ctx.lineTo(x,h/2-1.5); ctx.stroke(); } }
  else { for(let y=-h/2+step;y<h/2;y+=step){ ctx.beginPath(); ctx.moveTo(-w/2+1.5,y); ctx.lineTo(w/2-1.5,y); ctx.stroke(); } }
  ctx.strokeStyle="#77613b"; ctx.lineWidth=2; ctx.strokeRect(-w/2,-h/2,w,h);
  ctx.fillStyle="rgba(230,215,180,.16)"; const cp=Math.max(2.5,s*.28);
  [[-w/2,-h/2],[w/2-cp,-h/2],[-w/2,h/2-cp],[w/2-cp,h/2-cp]].forEach(([cx2,cy2])=>ctx.fillRect(cx2,cy2,cp,cp));
  wpvCrateDetail(w,h); /* ==== WP-VISUALS ==== corrugation highlights + door seams (toggle-gated) */
}
/* 11th-ed long/short DEFENCE LINE footprint: a thin rusty riveted-deck strip strewn with
   crushed-rockcrete rubble and girder debris — same graphic as the larger decks, just thin
   (matches the thin footprints in GW's official set). */
function wp9Wall(w,h,seed){
  wp9Plate(w,h,seed);
  wpvWallEdge(w,h); /* ==== WP-VISUALS ==== bold blocking-line edge (toggle-gated) */
}
function wp9Crater(w,h,seed){
  const rnd=wp9Rng(seed), n=14, pts=[];
  for(let i=0;i<n;i++){ const a=i/n*Math.PI*2, k=.72+rnd()*.26; pts.push([Math.cos(a)*w/2*.94*k,Math.sin(a)*h/2*.94*k]); }
  ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
  ctx.fillStyle=wp9RadGrad(0,0,Math.min(w,h)*.08,0,0,Math.max(w,h)/2,[[0,"#161216"],[.75,"#332b31"],[1,"#453a41"]],"#332b31");
  ctx.fill();
  ctx.strokeStyle="#5b4d54"; ctx.lineWidth=2; ctx.stroke();
  ctx.strokeStyle="rgba(0,0,0,.4)"; ctx.lineWidth=4; ctx.globalAlpha=.4; ctx.stroke(); ctx.globalAlpha=1;
}
function wp9DrawKind(t,w,h,seed){
  switch(t.kind){
    case "ruin": wp9Ruin(w,h,seed); break;
    case "wood": wp9Wood(w,h,seed); break;
    case "crate": wp9Crate(w,h,seed); break;
    case "wall": wp9Wall(w,h,seed); break;
    case "crater": wp9Crater(w,h,seed); break;
    default: ctx.fillStyle=TERR_COLORS[t.kind]||"#3a4250"; ctx.fillRect(-w/2,-h/2,w,h);
  }
}
/* ==== WP3D-v4 ==== 11th-ed pieces include right-angle TRIANGLE footprints (t.shape==="tri",
   t.tc = right-angle corner 0 TL/1 TR/2 BR/3 BL). We clip the kind render to the triangle;
   RULES keep the rectangular bounding footprint (LoS/placement unchanged — documented). */
function wp9TriPts(w,h,tc){
  const L=-w/2,T=-h/2,R=w/2,B=h/2;
  return [[[L,T],[R,T],[L,B]],[[L,T],[R,T],[R,B]],[[R,T],[R,B],[L,B]],[[L,T],[L,B],[R,B]]][tc||0];
}
/* The official terrain-area footprints are battle-damaged decks with real torn edges — mostly
   straight with occasional broken nibbles/corners. Each Official piece carries the ACTUAL official
   outline in `t.fp` (local coords, inches, relative to centre — from the Event-Companion data).
   We clip the deck to that outline and stroke it. The RULES footprint stays the exact rectangle
   (geomPointInRect etc. unchanged). Pieces without an fp (Custom layouts, hand-drawn terrain) fall
   back to the crisp rectangle / right-triangle. */
function wp9PolyPath(p){ ctx.beginPath(); p.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])); ctx.closePath(); }
function wp9FootOutline(t,w,h){ // px points of the footprint edge in local space
  if(Array.isArray(t.fp)&&t.fp.length>=3) return t.fp.map(p=>[p[0]*view.s, p[1]*view.s]);
  if(t.shape==="tri") return wp9TriPts(w,h,t.tc);
  return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
}
function wp9Terrain(t,w,h){
  const seed=wp9Hash(t.id);
  const path=wp9FootOutline(t,w,h);
  ctx.save(); wp9PolyPath(path); ctx.clip(); wp9DrawKind(t,w,h,seed); ctx.restore();
  ctx.strokeStyle="rgba(22,17,9,.7)"; ctx.lineWidth=1.8; wp9PolyPath(path); ctx.stroke();
}
const WP9_P1={hi:"#e07a6a",mid:"#b23a34",lo:"#5f1e1a"}, WP9_P2={hi:"#74aade",mid:"#3a72ae",lo:"#1c3d63"};
/* ==== end WP9 ==== */
/* ==== WP-VISUALS ==== faction colour schemes + unit-type silhouettes + terrain detail.
   Draw-layer ONLY: no geometry, hit-testing, ops or rules math is touched. Three Setup
   toggles (wpvFaction / wpvGlyphs / wpvTerrain, default ON, persisted in
   localStorage["wh40k_visuals"]) gate everything; with all three off the board renders
   exactly as before this section existed. Ownership stays instantly readable: the token
   BODY takes the faction palette, the base RIM (and inner ring) takes the owner's
   red/blue — the gold leader rim (WP14 contract) is never overridden.
   Under the node test stubs every checkbox reads false, so all of this is dormant there. */
let wpvFlags={f:false,g:false,t:false};
function wpvSync(){
  const g=id=>{ try{ const el=document.getElementById(id); return el?!!el.checked:false; }catch(e){ return false; } };
  wpvFlags={f:g("wpvFaction"),g:g("wpvGlyphs"),t:g("wpvTerrain")};
}
function wpvSave(){
  wpvSync();
  try{ localStorage.setItem("wh40k_visuals",JSON.stringify({f:wpvFlags.f?1:0,g:wpvFlags.g?1:0,t:wpvFlags.t?1:0})); }catch(e){}
  try{ draw(); }catch(e){}
}
function wpvInit(){
  try{
    const v=JSON.parse(localStorage.getItem("wh40k_visuals")||"{}");
    [["wpvFaction","f"],["wpvGlyphs","g"],["wpvTerrain","t"]].forEach(([id,k])=>{
      const el=document.getElementById(id); if(el&&(k in v)) el.checked=!!v[k];
    });
  }catch(e){}
  wpvSync();
}
/* Faction palettes — {hi,mid,lo} feeds the same radial/linear base gradients WP9 uses.
   Mids are kept mid-dark so the ivory stat text (dark drop shadow + #f4efe6) and the
   Okabe-Ito weapon pips stay readable, and none sit close to the WP14 leader gold. */
const WPV_FACTIONS={
  AS:{hi:"#c8a288",mid:"#8a2430",lo:"#3a0d12"},   // Sororitas: martyr red under bone
  AC:{hi:"#e0bc62",mid:"#96702a",lo:"#443010"},   // Custodes: auric gold
  AdM:{hi:"#d8825a",mid:"#8f3a20",lo:"#3c1608"},  // Mechanicus: Mars rust
  TL:{hi:"#8a97ad",mid:"#4e5a70",lo:"#20283a"},   // Titanicus: god-engine steel
  AE:{hi:"#72d0c0",mid:"#2a8078",lo:"#0e3834"},   // Aeldari: seer teal
  AM:{hi:"#a8a86e",mid:"#5c5e34",lo:"#282a14"},   // Militarum: olive drab
  CD:{hi:"#d86a92",mid:"#8a2a4c",lo:"#380e1e"},   // Daemons: warp crimson
  QT:{hi:"#a8925a",mid:"#4a4238",lo:"#1a1712"},   // Chaos Knights: black iron & brass
  CSM:{hi:"#c0a052",mid:"#443a42",lo:"#171319"},  // CSM: legion black & gold
  DG:{hi:"#b2b272",mid:"#68703e",lo:"#2c301a"},   // Death Guard: plague green
  DRU:{hi:"#48b0a0",mid:"#1e564e",lo:"#0a2422"},  // Drukhari: kabalite dark teal
  EC:{hi:"#dc8cc4",mid:"#8e3a76",lo:"#3a1232"},   // Emperor's Children: slaaneshi pink
  GC:{hi:"#a898cc",mid:"#544684",lo:"#221b3c"},   // GSC: cult purple
  GK:{hi:"#bcc4d2",mid:"#68727e",lo:"#2c3239"},   // Grey Knights: silver
  AoI:{hi:"#8a8aa2",mid:"#464660",lo:"#1c1c2a"},  // Agents: inquisitorial slate
  QI:{hi:"#ccae58",mid:"#4e5e80",lo:"#222c44"},   // Imperial Knights: heraldic blue & gold
  LoV:{hi:"#c89a4c",mid:"#5a6848",lo:"#242c1c"},  // Votann: kin green & copper
  NEC:{hi:"#48d868",mid:"#1c6434",lo:"#0a2412"},  // Necrons: gauss green on black
  ORK:{hi:"#8cbc4c",mid:"#4a7626",lo:"#1e360e"},  // Orks: da green
  SM:{hi:"#5a86cc",mid:"#2a4e92",lo:"#122446"},   // Space Marines: Ultramar blue
  TS:{hi:"#d0a648",mid:"#2c5694",lo:"#122844"},   // Thousand Sons: lapis & gold
  TYR:{hi:"#c0a088",mid:"#6e4470",lo:"#2e1830"},  // Tyranids: leviathan purple & bone
  TAU:{hi:"#dcae66",mid:"#9a6c2e",lo:"#442e10"},  // T'au: fio'tak ochre
  UN:{hi:"#a0a0a0",mid:"#585858",lo:"#262626"},   // Unaligned: neutral grey
  UA:{hi:"#a08080",mid:"#544040",lo:"#241a1a"},   // Unbound Adversaries: ashen maroon
  WE:{hi:"#d8ccb8",mid:"#96302a",lo:"#38100e"},   // World Eaters: arena white & red
};
/* Which faction is each SIDE playing? Cards/tokens don't carry a faction id, so derive it
   by majority-vote of the side's unit names against the DB (unit + profile names). Memoized
   on a cheap composition key; recomputed only when armies/tokens change. */
let wpvNameMap=null;
function wpvNameFid(){
  if(wpvNameMap) return wpvNameMap;
  wpvNameMap=new Map();
  try{
    for(const fid in DB.units) for(const u of DB.units[fid]){
      const add=n=>{ if(!n) return; const key=norm(n); let s=wpvNameMap.get(key); if(!s){ s=new Set(); wpvNameMap.set(key,s); } s.add(fid); };
      add(u.n); (u.m||[]).forEach(p=>add(p.n));
    }
  }catch(e){}
  return wpvNameMap;
}
const wpvFidCache={};
function wpvSideFid(side){
  const cards=(state.cards&&state.cards[side])||[];
  const mine=(side===mySide&&typeof myArmy!=="undefined")?myArmy:[];
  const key=side+":"+mySide+":"+cards.length+":"+mine.length+":"+state.tokens.length;
  const c=wpvFidCache[side];
  if(c&&c.key===key) return c.fid;
  const map=wpvNameFid(), votes={};
  const vote=n=>{ const s=map.get(norm(n||"")); if(!s) return; for(const f of s) votes[f]=(votes[f]||0)+1/s.size; };
  cards.forEach(cd=>vote(cd.name));
  if(!cards.length) mine.forEach(cd=>vote(cd.name));
  let best=null,bv=0;
  for(const f in votes) if(votes[f]>bv){ bv=votes[f]; best=f; }
  if(!best){ // last resort: vote over the side's token (profile) names
    state.tokens.forEach(t=>{ if(t.owner===side) vote(t.name); });
    for(const f in votes) if(votes[f]>bv){ bv=votes[f]; best=f; }
  }
  wpvFidCache[side]={key,fid:best};
  return best;
}
function wpvPal(t){ // token body palette: faction if known & enabled, else the WP9 player palette
  if(wpvFlags.f){ const fid=wpvSideFid(t.owner), p=fid&&WPV_FACTIONS[fid]; if(p) return p; }
  return t.owner===1?WP9_P1:WP9_P2;
}
function wpvRimCol(t,fb){ // base rim = ownership when faction bodies are on (fb = the pre-WPV dark rim)
  return wpvFlags.f ? (t.owner===1?"#e0483a":"#3f8fe8") : fb;
}
function wpvInnerCol(t,fb){ // inner ring keeps ownership readable on gold-rimmed leaders too
  return wpvFlags.f ? (t.owner===1?"rgba(255,128,108,.75)":"rgba(126,188,255,.78)") : fb;
}
/* ---- unit-type silhouettes ---- keyword-derived glyph, pre-rendered to a sprite per
   (kind, size-bucket) so the per-frame cost is one drawImage per token. */
function wpvGlyphFor(kwArr){
  const k=(kwArr||[]).map(s=>String(s).toUpperCase());
  const has=x=>k.indexOf(x)>=0;
  if(has("TITANIC")||has("TOWERING")) return "titan";
  if(has("AIRCRAFT")) return "wing";
  if(has("VEHICLE")) return "tank";
  if(has("MONSTER")) return "claw";
  if(has("MOUNTED")) return "steed";
  if(has("FLY")||has("JUMP PACK")) return "wing";
  if(has("CHARACTER")) return "helm";
  if(has("BATTLELINE")) return "shield";
  if(has("INFANTRY")||has("BEASTS")||has("SWARM")) return "skull";
  return null;
}
/* Each glyph draws in a 100×100 box (centre 50,50). fs(g) = fill+stroke the current path;
   rc = rect fill+stroke. Pale fill + dark stroke on EVERY subpath so the emblem separates
   from any faction body colour; detail is punched out with destination-out. */
function wpvFS(g){ g.fill(); g.stroke(); }
function wpvRC(g,x,y,w,h){ g.beginPath(); g.rect(x,y,w,h); wpvFS(g); }
const WPV_GLYPHS={
  skull(g){
    g.beginPath(); g.arc(50,44,26,Math.PI,0); g.lineTo(76,56); g.quadraticCurveTo(76,66,66,68); g.lineTo(66,80); g.lineTo(34,80); g.lineTo(34,68); g.quadraticCurveTo(24,66,24,56); g.closePath();
    wpvFS(g);
    g.globalCompositeOperation="destination-out";
    g.beginPath(); g.arc(39,48,7,0,7); g.fill(); g.beginPath(); g.arc(61,48,7,0,7); g.fill(); // eye sockets
    g.beginPath(); g.moveTo(50,58); g.lineTo(45,66); g.lineTo(55,66); g.closePath(); g.fill(); // nose
    g.fillRect(41,71,3.5,9); g.fillRect(48,71,3.5,9); g.fillRect(55,71,3.5,9);  // teeth
    g.globalCompositeOperation="source-over";
  },
  helm(g){
    g.beginPath(); g.moveTo(26,38); g.quadraticCurveTo(50,6,74,38); g.lineTo(74,44); g.lineTo(80,48); g.lineTo(74,52); g.lineTo(72,78); g.lineTo(60,84); g.lineTo(40,84); g.lineTo(28,78); g.lineTo(26,52); g.lineTo(20,48); g.lineTo(26,44); g.closePath();
    wpvFS(g);
    g.beginPath(); g.moveTo(38,20); g.quadraticCurveTo(50,10,62,20); g.lineTo(58,28); g.quadraticCurveTo(50,22,42,28); g.closePath(); wpvFS(g); // crest
    g.globalCompositeOperation="destination-out";
    g.fillRect(30,48,40,8);                                                     // visor slit
    g.fillRect(46,58,8,20);                                                     // breather line
    g.globalCompositeOperation="source-over";
  },
  shield(g){
    g.beginPath(); g.moveTo(28,24); g.lineTo(72,24); g.lineTo(72,52); g.quadraticCurveTo(72,72,50,84); g.quadraticCurveTo(28,72,28,52); g.closePath();
    wpvFS(g);
    g.globalCompositeOperation="destination-out";
    g.fillRect(46,32,8,32); g.fillRect(36,42,28,8);                             // cross boss
    g.globalCompositeOperation="source-over";
  },
  tank(g){
    g.beginPath(); g.moveTo(38,32); g.lineTo(62,32); g.lineTo(64,42); g.lineTo(94,38); g.lineTo(94,44); g.lineTo(66,48); g.lineTo(36,48); g.closePath(); wpvFS(g); // turret + gun
    g.beginPath(); g.moveTo(24,48); g.lineTo(78,48); g.lineTo(84,57); g.lineTo(80,59); g.lineTo(20,59); g.lineTo(16,57); g.closePath(); wpvFS(g);                 // hull
    g.beginPath(); g.moveTo(20,59); g.arc(30,68,10,Math.PI,Math.PI*1.5); g.lineTo(70,58); g.arc(70,68,10,Math.PI*1.5,0); g.lineTo(80,68); g.arc(70,68,10,0,Math.PI*.5); g.lineTo(30,78); g.arc(30,68,10,Math.PI*.5,Math.PI); g.closePath(); wpvFS(g); // track run
    g.globalCompositeOperation="destination-out";
    g.beginPath(); g.arc(30,68,4,0,7); g.fill(); g.beginPath(); g.arc(50,68,4,0,7); g.fill(); g.beginPath(); g.arc(70,68,4,0,7); g.fill(); // road wheels
    g.globalCompositeOperation="source-over";
  },
  claw(g){
    for(let i=0;i<3;i++){
      const x=26+i*20;
      g.beginPath();
      g.moveTo(x,18+i*4);
      g.quadraticCurveTo(x+16,42,x+8,82-i*4);
      g.quadraticCurveTo(x+2,50,x-8,26+i*4);
      g.closePath(); wpvFS(g);
    }
  },
  steed(g){
    g.beginPath();
    g.moveTo(30,84); g.lineTo(34,52); g.quadraticCurveTo(36,38,46,30);          // neck front
    g.lineTo(44,18); g.lineTo(54,26);                                           // ear
    g.quadraticCurveTo(66,26,74,36); g.lineTo(78,44); g.lineTo(68,46);          // muzzle
    g.quadraticCurveTo(62,52,56,54); g.quadraticCurveTo(52,66,52,84);           // jaw → neck back
    g.closePath(); wpvFS(g);
    g.globalCompositeOperation="destination-out";
    g.beginPath(); g.arc(56,38,4,0,7); g.fill();                                // eye
    g.globalCompositeOperation="source-over";
  },
  wing(g){
    g.beginPath();
    g.moveTo(50,64);
    g.lineTo(14,30); g.lineTo(30,44); g.lineTo(24,40); g.lineTo(36,52); g.lineTo(32,50); g.lineTo(44,60); // feather steps left
    g.closePath(); wpvFS(g);
    g.beginPath();
    g.moveTo(50,64);
    g.lineTo(86,30); g.lineTo(70,44); g.lineTo(76,40); g.lineTo(64,52); g.lineTo(68,50); g.lineTo(56,60);
    g.closePath(); wpvFS(g);
    g.beginPath(); g.moveTo(50,34); g.lineTo(58,56); g.lineTo(50,78); g.lineTo(42,56); g.closePath(); wpvFS(g); // body diamond
  },
  titan(g){
    g.beginPath(); g.arc(50,26,10,Math.PI,0); g.lineTo(60,32); g.lineTo(40,32); g.closePath(); wpvFS(g); // dome head
    wpvRC(g,12,36,8,18); wpvRC(g,80,36,8,18);                                   // weapon arms
    wpvRC(g,20,32,60,14);                                                       // shoulder block
    g.beginPath(); g.moveTo(32,46); g.lineTo(68,46); g.lineTo(62,66); g.lineTo(38,66); g.closePath(); wpvFS(g); // torso
    wpvRC(g,38,66,8,20); wpvRC(g,54,66,8,20);                                   // legs
    wpvRC(g,34,84,14,6); wpvRC(g,52,84,14,6);                                   // feet
    g.globalCompositeOperation="destination-out";
    g.fillRect(46,36,8,6);                                                      // visor
    g.globalCompositeOperation="source-over";
  },
};
const wpvSpriteCache=new Map();
function wpvSprite(kind,px){
  const q=Math.max(10,Math.round(px/4)*4); // bucketed size so zooming reuses sprites
  const key=kind+"|"+q;
  if(wpvSpriteCache.has(key)) return wpvSpriteCache.get(key);
  let spr=null;
  try{
    const c=document.createElement("canvas");
    if(c.getContext){
      c.width=c.height=q;
      const g=c.getContext("2d");
      if(g&&g.beginPath&&g.scale){
        g.scale(q/100,q/100);
        // pale fill + dark stroke on every subpath → separates from any faction body colour
        g.fillStyle="rgba(240,234,222,.50)"; g.strokeStyle="rgba(10,8,12,.60)";
        g.lineWidth=3.5; g.lineJoin="round"; g.lineCap="round";
        WPV_GLYPHS[kind](g);
        spr=c;
      }
    }
  }catch(e){ spr=null; }
  if(wpvSpriteCache.size>240) wpvSpriteCache.clear();
  wpvSpriteCache.set(key,spr);
  return spr;
}
const wpvKindCache=new WeakMap(); // token object → glyph kind (tokens are replaced by ops, so this self-invalidates)
function wpvGlyph(t,rpx){
  if(!wpvFlags.g||!(rpx>11)) return;
  let kind=wpvKindCache.get(t);
  if(kind===undefined){ kind=wpvGlyphFor(t.kw); wpvKindCache.set(t,kind); }
  if(!kind) return;
  const spr=wpvSprite(kind,Math.min(rpx*1.7,rpx*2-4));
  if(!spr||!ctx.drawImage) return;
  try{ ctx.drawImage(spr,-spr.width/2,-spr.height/2); }catch(e){}
}
/* ---- terrain detail (hooked from the wp9<Kind> painters; footprints untouched) ---- */
let wpvBrickPat=null, wpvBrickTried=false;
function wpvBrick(){
  if(wpvBrickTried) return wpvBrickPat;
  wpvBrickTried=true;
  try{
    const c=document.createElement("canvas"); if(!c.getContext) return wpvBrickPat=null;
    c.width=26; c.height=16;
    const g=c.getContext("2d"); if(!g||!g.beginPath) return wpvBrickPat=null;
    g.strokeStyle="rgba(0,0,0,.30)"; g.lineWidth=1;
    g.beginPath();
    g.moveTo(0,3.5); g.lineTo(26,3.5); g.moveTo(0,11.5); g.lineTo(26,11.5);    // mortar courses
    g.moveTo(7.5,3.5); g.lineTo(7.5,11.5); g.moveTo(20.5,11.5); g.lineTo(20.5,16); g.moveTo(20.5,0); g.lineTo(20.5,3.5); // staggered joints
    g.stroke();
    g.strokeStyle="rgba(200,210,235,.06)"; g.beginPath(); g.moveTo(0,4.5); g.lineTo(26,4.5); g.moveTo(0,12.5); g.lineTo(26,12.5); g.stroke(); // lit brick tops
    wpvBrickPat=ctx.createPattern(c,"repeat")||null;
  }catch(e){ wpvBrickPat=null; }
  return wpvBrickPat;
}
function wpvRuinFloor(w,h){ // tiled rubble-brick floor inside the ruin footprint (under the wall slabs)
  if(!wpvFlags.t) return;
  const p=wpvBrick(); if(!p) return;
  ctx.save(); ctx.fillStyle=p; ctx.fillRect(-w/2,-h/2,w,h); ctx.restore();
}
function wpvWoodStipple(w,h,seed){ // leafy canopy stipple over the wood blobs
  if(!wpvFlags.t) return;
  const rnd=wp9Rng((seed^0x5f356495)>>>0), s=view.s;
  const n=Math.max(8,Math.min(120,Math.round((w*h)/(s*s*0.9))));
  for(let i=0;i<n;i++){
    const x=(rnd()-.5)*w*.92, y=(rnd()-.5)*h*.92, r=Math.max(.7,s*.055*(.5+rnd()));
    ctx.fillStyle=rnd()<.45?"rgba(186,220,146,.14)":"rgba(8,22,10,.22)";
    ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
  }
}
function wpvCrateDetail(w,h){ // corrugation highlights + door seams so containers read as containers
  if(!wpvFlags.t) return;
  const s=view.s, step=Math.max(3,s*.38);
  ctx.strokeStyle="rgba(240,226,190,.10)"; ctx.lineWidth=1;
  if(w>=h){ for(let x=-w/2+step+1;x<w/2;x+=step){ ctx.beginPath(); ctx.moveTo(x,-h/2+1.5); ctx.lineTo(x,h/2-1.5); ctx.stroke(); } }
  else { for(let y=-h/2+step+1;y<h/2;y+=step){ ctx.beginPath(); ctx.moveTo(-w/2+1.5,y); ctx.lineTo(w/2-1.5,y); ctx.stroke(); } }
  ctx.strokeStyle="rgba(18,13,6,.55)"; ctx.lineWidth=Math.max(1.5,s*.08);
  ctx.beginPath();
  if(w>=h){ const dx=w/2-Math.max(3,s*.4); ctx.moveTo(dx,-h/2+1); ctx.lineTo(dx,h/2-1); ctx.moveTo(-dx,-h/2+1); ctx.lineTo(-dx,h/2-1); }
  else { const dy=h/2-Math.max(3,s*.4); ctx.moveTo(-w/2+1,dy); ctx.lineTo(w/2-1,dy); ctx.moveTo(-w/2+1,-dy); ctx.lineTo(w/2-1,-dy); }
  ctx.stroke();
}
function wpvWallEdge(w,h){ // walls are the blocking lines — give them a crisp bold edge
  if(!wpvFlags.t) return;
  ctx.strokeStyle="rgba(8,6,2,.9)"; ctx.lineWidth=2.5; ctx.strokeRect(-w/2,-h/2,w,h);
  ctx.strokeStyle="#a68c52"; ctx.lineWidth=1.2; ctx.strokeRect(-w/2,-h/2,w,h);
}
wpvInit();
/* ==== end WP-VISUALS ==== */
/* ==== WP3D-0: 3D foundation ====
   Optional 3D board. Everything below is additive/append-only and gated behind the
   `wp3d` Setup checkbox (default OFF, localStorage["wh40k_3d"]) — with it unchecked
   the app behaves exactly as before this section existed (stated contract: all
   toggles off => pixel-identical 2D output). Downstream WPs (WP3D-1..4) build the
   real module at ./wh40k-3d.js against the window.WP3D bridge defined here; WP3D-5
   wires the orchestration. This packet (WP3D-0) never renders anything in 3D itself.

   Placement note: this section sits textually BEFORE draw() (further down the file) and
   before hitToken/hitTerrain/hitObjective/WP21_HULLS/wp21BaseFor (all further down
   the file). That's safe for plain `function` declarations and `let`-reassigned
   bindings (draw, hitToken, hitTerrain, hitObjective, wp21BaseFor, DB, sel, state,
   view, mySide, myArmy, op, applyOp, checkCoherency, mmIn/px/inch, uid) because
   JS hoists function declarations fully and none of the wrapped/bridged code below
   actually RUNS until user interaction — long after the whole script (ending in the
   init calls at the bottom of the file) has executed once, top to bottom. The one
   exception is WP21_HULLS, a `const` (TDZ risk) — bridged via a getter so it's read
   lazily at access time, not at bridge-creation time. */

/* ---- (a) Setup toggle + persistence, cloned from the wpv-functions / wh40k_visuals pattern ---- */
let wp3dOn=false;
function wp3dSync(){
  const g=id=>{ try{ const el=document.getElementById(id); return el?!!el.checked:false; }catch(e){ return false; } };
  wp3dOn=g("wp3d");
}
function wp3dSave(){
  wp3dSync();
  try{ localStorage.setItem("wh40k_3d",JSON.stringify({on:wp3dOn?1:0})); }catch(e){}
}
/* ---- (b) Availability gate: file:// or no WebGL2 => unavailable, checkbox disabled+tooltipped ---- */
function wp3dAvailable(){
  try{ if(typeof location!=="undefined" && location.protocol==="file:") return false; }catch(e){}
  try{
    const c=document.createElement("canvas");
    const gl=c.getContext && (c.getContext("webgl2"));
    return !!gl;
  }catch(e){ return false; }
}
function wp3dInit(){
  try{
    const el=document.getElementById("wp3d");
    if(el){
      if(!wp3dAvailable()){
        el.disabled=true; el.checked=false;
        el.title="3D needs the online version (WebGL2)";
        const hint=document.getElementById("wp3dHint");
        if(hint) hint.textContent="3D needs the online version (WebGL2) — unavailable here.";
      } else {
        const v=JSON.parse(localStorage.getItem("wh40k_3d")||"{}");
        if("on" in v) el.checked=!!v.on;
      }
    }
  }catch(e){}
  wp3dSync();
}
/* ---- (d) Lazy loader — bound to the checkbox's onchange, not wp3dSave itself (wp3dSave stays a
   pure persistence clone of wpvSave so it round-trips cleanly under tests with no async side
   effects; this is the one deliberate deviation from a literal wpv* clone, documented per the
   packet brief). First toggle-on imports+inits the module; later toggle-ons reuse it (start()). */
let wp3dModule=null;
/* ==== WP3D-v3 ==== tri-state mode: "off" | "pip" | "full". wh40k_3d stays the on/off
   master (checkbox + existing tests untouched); wh40k_3d_mode remembers the last NON-off
   mode so the checkbox and the toolbar 🎲 cycle round-trip cleanly. Phone gets Off/Full
   only (PiP inset is too small to be useful there). */
function wp3dLastMode(){ try{ const m=localStorage.getItem("wh40k_3d_mode"); return (m==="full"||m==="pip")?m:"pip"; }catch(e){ return "pip"; } }
function wp3dCurMode(){
  const wrap=document.getElementById("boardwrap");
  if(!wrap) return "off";
  return wrap.classList.contains("mode3d")?"full":(wrap.classList.contains("mode3d-pip")?"pip":"off");
}
function wp3dBadge(){
  const b=document.getElementById("wp3dBadge");
  if(b){ const m=wp3dCurMode(); b.textContent=(m==="full"?"3D":(m==="pip"?"PiP":"")); }
}
async function wp3dSetMode(mode){
  const el=document.getElementById("wp3d"), wrap=document.getElementById("boardwrap");
  const phone=document.documentElement.classList.contains("phone");
  if(mode==="pip"&&phone) mode="full";
  if(mode!=="off"&&!wp3dAvailable()) mode="off";
  if(mode==="off"){
    if(wrap){ wrap.classList.remove("mode3d"); wrap.classList.remove("mode3d-pip"); }
    if(wp3dModule && typeof wp3dModule.stop==="function") wp3dModule.stop();
    if(el){ el.checked=false; } wp3dSave(); wp3dBadge(); draw(); return;
  }
  try{
    if(!wp3dModule){
      wp3dModule=await import("./wh40k-3d.js");
      wp3dModule.init(document.getElementById("board3d"),window.WP3D);
    } else if(typeof wp3dModule.start==="function"){
      wp3dModule.start();
    }
    if(wrap){
      wrap.classList.toggle("mode3d",mode==="full");
      wrap.classList.toggle("mode3d-pip",mode==="pip");
    }
    if(typeof wp3dModule.setMode==="function") wp3dModule.setMode(mode);
    try{ localStorage.setItem("wh40k_3d_mode",mode); }catch(e){}
    if(el){ el.checked=true; } wp3dSave(); wp3dBadge(); draw();
  }catch(e){
    logSys("3D view couldn't load ("+(e&&e.message||e)+") — staying on the 2D board.");
    if(wrap){ wrap.classList.remove("mode3d"); wrap.classList.remove("mode3d-pip"); }
    if(el){ el.checked=false; } wp3dSave(); wp3dBadge();
  }
}
function wp3dCycle(){
  const m=wp3dCurMode();
  const phone=document.documentElement.classList.contains("phone");
  wp3dSetMode(m==="off"?(phone?"full":"pip"):(m==="pip"?"full":"off"));
}
async function wp3dToggle(){
  /* Setup checkbox: Off <-> last non-off mode (the checkbox stays the on/off master). */
  const el=document.getElementById("wp3d");
  wp3dSetMode(el&&el.checked?wp3dLastMode():"off");
}
/* hotkey 3 — same own-listener + form-guard idiom as the app's other key handlers */
window.addEventListener("keydown",(e)=>{
  if(e.key!=="3"||e.metaKey||e.ctrlKey||e.altKey) return;
  const tn=(e.target&&e.target.tagName)||"";
  if(tn==="INPUT"||tn==="TEXTAREA"||tn==="SELECT") return;
  wp3dCycle();
});
/* ==== end WP3D-v3 (mode plumbing) ==== */
/* ---- (e) window.WP3D bridge — THE WHOLE contract between the app and wh40k-3d.js.
   Downstream WPs should mock exactly this shape when testing against it in isolation.
   Deviations from the packet-brief literal shape: WP21_HULLS is a getter (TDZ, see note
   above) instead of a bare property; everything else matches verbatim. */
window.WP3D={
  state: ()=>state, view: ()=>view, sel, DB,
  mySide: ()=>mySide, myArmy: ()=>myArmy,
  op, applyOp, draw: ()=>draw(),
  hitToken, hitTerrain, hitObjective, checkCoherency,
  mmIn, px, inch, uid,
  wpvGlyphFor, wpvSideFid, WPV_FACTIONS,
  get WP21_HULLS(){ return WP21_HULLS; }, // const declared later in the file (TDZ) — lazy getter
  wp21BaseFor,
  tokDragBegin, tokDragMove, tokDragCommit,
  ruler: ()=>ruler, /* ==== WP3D-5 ==== additive: lets the 3D HUD mirror the tape measure */
  onDice: (cb)=>{ wp3dDiceCbs.push(cb); }, /* ==== WP3D-v2 ==== additive: 3D dice mirror real rolls */
  /* ==== WP3D-v3 ==== additive: battle-cam + shared-dice taps */
  onAttackStaged: (cb)=>{ wp3dAtkCbs.push(cb); },
  onRemoteDice: (cb)=>{ wp3dRemoteDiceCbs.push(cb); },
};
/* ==== WP3D-v2 ==== dice tap — append-only wrap of wp20Note (the hook d6() already calls
   for every die on this screen); zero behaviour change when no 3D listener registered. */
const wp3dDiceCbs=[];
/* ==== WP3D-v3 ==== shared dice: batch this screen's real rolls (150ms window) and send a
   TRANSIENT {t:"dice"} message (the ephemeral "ruler" pattern — never an op, never in
   state; old peers ignore unknown message types since onMsg has no default case). */
const wp3dRemoteDiceCbs=[];
let wp3dDiceBatch=null, wp3dDiceTimer=null;
function wp3dDiceSend(r){
  if(!wp3dDiceBatch) wp3dDiceBatch=[];
  if(wp3dDiceBatch.length<40) wp3dDiceBatch.push(r);
  if(wp3dDiceTimer) clearTimeout(wp3dDiceTimer);
  wp3dDiceTimer=setTimeout(()=>{
    const vals=wp3dDiceBatch; wp3dDiceBatch=null; wp3dDiceTimer=null;
    try{ if(typeof conn!=="undefined"&&conn&&conn.open) send({t:"dice",vals}); }catch(e){}
  },150);
}
const wp3dOrigWp20Note=wp20Note;
wp20Note=function(r){ wp3dOrigWp20Note(r); for(const cb of wp3dDiceCbs){ try{cb(r);}catch(e){} } wp3dDiceSend(r); };
/* ==== WP3D-v3 ==== battle-cam tap: append-only wrap of wp3Stage (covers BOTH the two-click
   ⚔ flow and the inspector flow). Fires only when the stage wasn't blocked; passes token
   ids (may be null — consumers must guard). */
const wp3dAtkCbs=[];
const wp3dOrigWp3Stage=wp3Stage;
wp3Stage=function(ctx0,wi,tgtTok){
  const res=wp3dOrigWp3Stage(ctx0,wi,tgtTok);
  if(res!==false){
    const aId=(ctx0&&ctx0.tok&&ctx0.tok.id)||null, tId=(tgtTok&&tgtTok.id)||null;
    for(const cb of wp3dAtkCbs){ try{cb(aId,tId);}catch(e){} }
  }
  return res;
};
/* ---- (f) draw() wrap — append-only. window.wp3dOnDraw is defined by the 3D module once
   loaded; undefined (module never loaded, or toggled off) is a no-op, i.e. zero behaviour
   change for anyone who never touches the wp3d checkbox. ---- */
const wp3dOrigDraw=draw;
draw=function(){ wp3dOrigDraw(); if(window.wp3dOnDraw) window.wp3dOnDraw(); };
wp3dInit();
/* ==== end WP3D-0 ==== */
/* ==== WP-B: vehicle rotate handle ==== geometry shared by hit-test (pointerdown/inches) and draw (screen px).
   Local offset before rotation is (0,-(rad+gap)) — the same convention drawToken uses for shape "r"
   (ctx.rotate(rot) about the centre), so the handle always sits at the model's "front". */
function wpHandleOffset(t){
  const rad=Math.max(t.wIn||0,t.hIn||0)/2+0.6; // inches beyond the longer side
  const a=(t.rot||0)*Math.PI/180;
  return [rad*Math.sin(a), -rad*Math.cos(a)];
}
function wpHandlePosIn(t){ // board inches — used by the (inch-space) pointerdown hit-test
  const [dx,dy]=wpHandleOffset(t);
  return [t.x+dx, t.y+dy];
}
function wpHandlePos(t){ // screen px — used by draw()
  const [tx,ty]=px(t.x,t.y), [dx,dy]=wpHandleOffset(t);
  return [tx+dx*view.s, ty+dy*view.s];
}
function wpDrawRotateHandle(){
  const rsel=state.tokens.filter(t=>sel.has(t.id)&&t.shape==="r");
  if(rsel.length!==1) return;
  const t=rsel[0], [tx,ty]=px(t.x,t.y), [hx,hy]=wpHandlePos(t);
  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,.55)"; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(hx,hy); ctx.stroke();
  ctx.beginPath(); ctx.arc(hx,hy,7,0,7);
  ctx.fillStyle="#e8c34a"; ctx.fill();
  ctx.strokeStyle="rgba(10,8,10,.9)"; ctx.lineWidth=1.5; ctx.stroke();
  ctx.restore();
}
/* ==== end WP-B ==== */
function draw(){
  wp8Coherency(); /* WP8: memoized — full O(n²) checkCoherency() only when tokens actually changed */
  const W=cv.width/devicePixelRatio,H=cv.height/devicePixelRatio;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#141118"; ctx.fillRect(0,0,W,H); /* WP9: table surround */
  const [bx,by]=px(0,0), bw=state.board.w*view.s, bh=state.board.h*view.s;
  // board — battlefield mat with grit texture + framed edge (WP9)
  ctx.fillStyle="#262821"; ctx.fillRect(bx,by,bw,bh);
  const mat=wp9MatPattern();
  if(mat){ ctx.save(); ctx.fillStyle=mat; ctx.globalAlpha=.9; ctx.fillRect(bx,by,bw,bh); ctx.restore(); }
  const vin=wp9RadGrad(bx+bw/2,by+bh/2,Math.min(bw,bh)*.25,bx+bw/2,by+bh/2,Math.max(bw,bh)*.72,[[0,"rgba(0,0,0,0)"],[1,"rgba(0,0,0,.30)"]],null);
  if(vin){ ctx.fillStyle=vin; ctx.fillRect(bx,by,bw,bh); }
  ctx.strokeStyle="#0d0b0e"; ctx.lineWidth=5; ctx.strokeRect(bx-2.5,by-2.5,bw+5,bh+5);
  ctx.strokeStyle="#59511f"; ctx.lineWidth=1.5; ctx.strokeRect(bx,by,bw,bh);
  // deployment zones
  (state.dz||[]).forEach((poly,i)=>{
    if(!poly||!poly.length) return;
    ctx.beginPath();
    poly.forEach((p,j)=>{ const q=px(p[0],p[1]); j?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]); });
    ctx.closePath();
    /* WP9: quiet fill + diagonal hatch instead of a heavy colour wash */
    ctx.fillStyle=i===0?"rgba(192,61,61,.05)":"rgba(61,126,192,.05)"; ctx.fill();
    const hz=wp9Hatch(i===0?"rgba(192,61,61,.16)":"rgba(61,126,192,.16)");
    if(hz){ ctx.fillStyle=hz; ctx.fill(); }
    ctx.strokeStyle=i===0?"rgba(192,61,61,.5)":"rgba(61,126,192,.5)";
    ctx.setLineDash([7,5]); ctx.lineWidth=1.5; ctx.stroke(); ctx.setLineDash([]);
  });
  // 6" grid + centre line
  ctx.strokeStyle="rgba(230,235,215,.05)"; ctx.lineWidth=1;
  for(let i=6;i<state.board.w;i+=6){ const [gx]=px(i,0); ctx.beginPath(); ctx.moveTo(gx,by); ctx.lineTo(gx,by+bh); ctx.stroke(); }
  for(let j=6;j<state.board.h;j+=6){ const [,gy]=px(0,j); ctx.beginPath(); ctx.moveTo(bx,gy); ctx.lineTo(bx+bw,gy); ctx.stroke(); }
  ctx.setLineDash([6,6]); ctx.strokeStyle="rgba(201,162,39,.3)";
  ctx.beginPath(); const [,my_]=px(0,state.board.h/2); ctx.moveTo(bx,my_); ctx.lineTo(bx+bw,my_); ctx.stroke(); ctx.setLineDash([]);
  // terrain — drawn in rules-layer order (exposed, then dense, then light on top)
  // so light walls sitting on a terrain area footprint read as stacked features
  const TERR_ORDER={crater:0,ruin:1,wood:1,crate:1,wall:2};
  [...state.terrain].sort((a,b)=>(TERR_ORDER[a.kind]??1)-(TERR_ORDER[b.kind]??1)).forEach(t=>{
    ctx.save(); const [tx,ty]=px(t.x+t.w/2,t.y+t.h/2); ctx.translate(tx,ty); ctx.rotate((t.rot||0)*Math.PI/180);
    wp9Terrain(t,t.w*view.s,t.h*view.s); /* WP9: styled scenery per kind (footprint unchanged) */
    if(sel.has(t.id)){
      ctx.strokeStyle="#e8c34a"; ctx.lineWidth=2;
      ctx.strokeRect(-t.w/2*view.s,-t.h/2*view.s,t.w*view.s,t.h*view.s);
    }
    ctx.restore();
  });
  // objectives
  state.objectives.forEach(o=>{ /* WP9: machined-marker look */
    const [ox,oy]=px(o.x,o.y), r=mmIn(40)/2*view.s;
    ctx.beginPath(); ctx.arc(ox,oy,r,0,7);
    ctx.fillStyle=wp9RadGrad(ox-r*.3,oy-r*.35,r*.1,ox,oy,r,[[0,"#3a3322"],[1,"#1d1912"]],"#241f15"); ctx.fill();
    ctx.strokeStyle=sel.has(o.id)?"#fff":"#c9a227"; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.arc(ox,oy,r*.62,0,7); ctx.strokeStyle="rgba(232,195,74,.5)"; ctx.lineWidth=1; ctx.stroke();
    ctx.strokeStyle="rgba(232,195,74,.75)"; ctx.lineWidth=Math.max(1.5,r*.09);
    for(let q=0;q<4;q++){ const a=q*Math.PI/2+Math.PI/4;
      ctx.beginPath(); ctx.moveTo(ox+Math.cos(a)*r*.68,oy+Math.sin(a)*r*.68); ctx.lineTo(ox+Math.cos(a)*r*.92,oy+Math.sin(a)*r*.92); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(ox,oy,Math.max(1.6,r*.09),0,7); ctx.fillStyle="#e8c34a"; ctx.fill();
  });
  // range rings under tokens
  if(rings && sel.size){
    ctx.strokeStyle="rgba(120,200,255,.5)"; ctx.setLineDash([4,4]); ctx.lineWidth=1.2;
    state.tokens.filter(t=>sel.has(t.id)).forEach(t=>{
      const [tx,ty]=px(t.x,t.y); const rad=(t.shape==="c"?mmIn(t.dmm)/2:Math.max(t.wIn,t.hIn)/2);
      ctx.beginPath(); ctx.arc(tx,ty,(rings+rad)*view.s,0,7); ctx.stroke();
    });
    ctx.setLineDash([]);
  }
  // tokens
  state.tokens.forEach(t=>{
    const col=t.owner===1?"#d84a4a":"#4a8fd8"; /* WP9: shaded bases */
    const P=wpvPal(t); /* ==== WP-VISUALS ==== body = faction palette when on; falls back to WP9_P1/P2 */
    const [tx,ty]=px(t.x,t.y);
    ctx.save(); ctx.translate(tx,ty);
    if(t.shape==="c"){
      const r=mmIn(t.dmm)/2*view.s;
      ctx.beginPath(); ctx.arc(0,0,r,0,7);
      ctx.fillStyle=wp9RadGrad(-r*.32,-r*.36,r*.12,0,0,r,[[0,P.hi],[.55,P.mid],[1,P.lo]],P.mid); ctx.fill();
      ctx.lineWidth=Math.max(1.5,r*.14); ctx.strokeStyle=t.sgt?"#c9922e":wpvRimCol(t,"rgba(10,8,10,.8)"); ctx.stroke(); /* ==== WP14 ==== gold rim = squad leader */ /* ==== WP-VISUALS ==== else rim = owner colour when faction bodies on */
      ctx.beginPath(); ctx.arc(0,0,Math.max(1,r-ctx.lineWidth*.9),0,7);
      ctx.lineWidth=sel.has(t.id)?2.5:1.2; ctx.strokeStyle=sel.has(t.id)?"#fff":wpvInnerCol(t,"rgba(255,255,255,.28)"); ctx.stroke(); /* ==== WP-VISUALS ==== inner ring keeps ownership on gold-rim leaders */
      wpvGlyph(t,r); /* ==== WP-VISUALS ==== unit-type silhouette under the label */
      if(r>8){
        ctx.font="bold "+Math.max(8,r*.5)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillStyle="rgba(0,0,0,.5)"; ctx.fillText(initials(t.name),0,1.2);
        ctx.fillStyle="#f4efe6"; ctx.fillText(initials(t.name),0,0);
      }
    } else {
      ctx.rotate((t.rot||0)*Math.PI/180);
      const w=t.wIn*view.s,h=t.hIn*view.s;
      if(t.oval){ /* ==== WP21 ==== oval base (Knights, bikes, monster ovals): true ellipse, no hull-inset rect */
        const lw=Math.max(1.5,Math.min(w,h)/2*.14);
        ctx.beginPath(); ctx.ellipse(0,0,w/2,h/2,0,0,7);
        ctx.fillStyle=wp9LinGrad(-w/2,-h/2,w/2,h/2,[[0,P.mid],[1,P.lo]],P.mid); ctx.fill();
        ctx.lineWidth=lw; ctx.strokeStyle=t.sgt?"#c9922e":wpvRimCol(t,"rgba(10,8,10,.8)"); ctx.stroke(); /* WP14 contract: gold rim = leader */ /* ==== WP-VISUALS ==== else owner rim */
        ctx.beginPath(); ctx.ellipse(0,0,Math.max(1,w/2-lw*.9),Math.max(1,h/2-lw*.9),0,0,7); /* slightly inset selection ring */
        ctx.lineWidth=sel.has(t.id)?2.5:1.2; ctx.strokeStyle=sel.has(t.id)?"#fff":wpvInnerCol(t,"rgba(255,255,255,.28)"); ctx.stroke(); /* ==== WP-VISUALS ==== owner inner ring */
      } else { /* ==== end WP21 ==== */
      ctx.fillStyle=wp9LinGrad(-w/2,-h/2,w/2,h/2,[[0,P.mid],[1,P.lo]],P.mid); ctx.fillRect(-w/2,-h/2,w,h);
      ctx.strokeStyle=wpvInnerCol(t,"rgba(255,255,255,.14)"); ctx.lineWidth=1; ctx.strokeRect(-w/2+2.5,-h/2+2.5,w-5,h-5); /* hull inset */ /* ==== WP-VISUALS ==== owner-tinted when faction bodies on */
      ctx.lineWidth=sel.has(t.id)?2.5:1.5; ctx.strokeStyle=sel.has(t.id)?"#fff":(t.sgt?"#c9922e":wpvRimCol(t,"rgba(10,8,10,.85)")); ctx.strokeRect(-w/2,-h/2,w,h); /* ==== WP14 ==== gold border = leader */ /* ==== WP-VISUALS ==== else owner border */
      }
      wpvGlyph(t,Math.min(w,h)/2); /* ==== WP-VISUALS ==== unit-type silhouette under the label */
      ctx.font="bold "+Math.max(8,h*.28)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillStyle="rgba(0,0,0,.5)"; ctx.fillText(initials(t.name),0,1.2);
      ctx.fillStyle="#f4efe6"; ctx.fillText(initials(t.name),0,0);
    }
    /* ==== WP14 ==== squad leader: double gold chevron at the top of the base (rim is already gold) */
    if(t.sgt){
      const rr=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
      if(rr>6){
        ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
        const cw=Math.max(3.5,view.s*.3), cy0=-rr+cw*.5;
        ctx.beginPath();
        ctx.moveTo(-cw,cy0+cw); ctx.lineTo(0,cy0); ctx.lineTo(cw,cy0+cw);
        ctx.moveTo(-cw,cy0+cw*1.8); ctx.lineTo(0,cy0+cw*.8); ctx.lineTo(cw,cy0+cw*1.8);
        ctx.strokeStyle="rgba(10,8,10,.9)"; ctx.lineWidth=Math.max(2.5,view.s*.16); ctx.stroke();
        ctx.strokeStyle="#e8b23a"; ctx.lineWidth=Math.max(1.4,view.s*.09); ctx.stroke();
        ctx.restore();
      }
    }
    /* ==== WP14 ==== weapon-role pip: colour + letter at the bottom of the base (3-letter chip when zoomed in) */
    if(t.role&&t.role!=="SGT"){
      const R=WP14_ROLES[t.role]||WP14_ROLES.SPC;
      const rr=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
      if(rr>6){
        ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
        const br=Math.max(5,view.s*.35);
        if(rr>14&&br>8){ // zoomed in: rounded chip with the full code
          ctx.font="bold "+Math.max(7,view.s*.42)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
          const tw=ctx.measureText(t.role).width;
          ctx.fillStyle=R.c; ctx.fillRect(-tw/2-4,rr*.72-br*.8,tw+8,br*1.6);
          ctx.strokeStyle="rgba(10,8,10,.85)"; ctx.lineWidth=1; ctx.strokeRect(-tw/2-4,rr*.72-br*.8,tw+8,br*1.6);
          ctx.fillStyle=R.tc; ctx.fillText(t.role,0,rr*.72+.5);
        } else { // normal zoom: round pip with the first letter
          ctx.beginPath(); ctx.arc(0,rr*.72,br,0,7);
          ctx.fillStyle=R.c; ctx.fill();
          ctx.strokeStyle="rgba(10,8,10,.85)"; ctx.lineWidth=1; ctx.stroke();
          ctx.fillStyle=R.tc; ctx.font="bold "+Math.max(7,view.s*.45)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
          ctx.fillText(t.role[0],0,rr*.72+.5);
        }
        ctx.restore();
      }
    }
    // weapon/role tag chip below the base
    if(t.tag){
      const rr=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
      ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
      ctx.font="bold "+Math.max(8,view.s*.45)+"px sans-serif";
      const tw=ctx.measureText(t.tag).width;
      ctx.fillStyle="rgba(16,18,22,.85)"; ctx.fillRect(-tw/2-3,rr+1,tw+6,Math.max(11,view.s*.6));
      ctx.fillStyle="#e8b23a"; ctx.textAlign="center"; ctx.textBaseline="top"; ctx.fillText(t.tag,0,rr+2.5);
      ctx.restore();
    }
    // coherency warning ring
    if(incoherent.has(t.id)){
      const rr=(t.shape==="c"?mmIn(t.dmm)/2:Math.hypot(t.wIn,t.hIn)/2)*view.s+3;
      ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
      ctx.beginPath(); ctx.arc(0,0,rr,0,7);
      ctx.strokeStyle="#ff4040"; ctx.lineWidth=2; ctx.setLineDash([5,3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    if(t.hid) drawHiddenBadge(t); /* ==== WP4: Hidden badge ==== */
    if(t.lvl) drawLvlBadge(t); /* ==== WP5: floor badge ==== */
    if(t.fellBack) drawFallBackBadge(t); /* ==== WP-FIGHT: Fell back badge ==== */
    else if(t.advanced) drawAdvancedBadge(t); /* ==== WP-FIGHT (P2-3): Advanced badge (no shooting/charging) ==== */
    /* ==== WP-A: structured movement ==== a green ring/pip marks a model that's used its move this
       phase; a solid ✓ pip (unit marked "Movement complete") is drawn on top and reads at a glance. */
    if(wpMoved.has(t.id)||wpDone.has(t.unit)){
      const rr=(t.shape==="c"?mmIn(t.dmm)/2:Math.hypot(t.wIn,t.hIn)/2)*view.s+1.5;
      ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
      ctx.beginPath(); ctx.arc(0,0,rr,0,7);
      ctx.strokeStyle=wpDone.has(t.unit)?"#5fbf6f":"rgba(95,191,111,.55)";
      ctx.lineWidth=wpDone.has(t.unit)?2:1.5; ctx.stroke();
      if(wpDone.has(t.unit)){
        const br=Math.max(5,view.s*.32);
        ctx.beginPath(); ctx.arc(rr*.72,rr*.1,br,0,7);
        ctx.fillStyle="#5fbf6f"; ctx.fill();
        ctx.strokeStyle="rgba(10,8,10,.85)"; ctx.lineWidth=1; ctx.stroke();
        ctx.fillStyle="#0e0c0f"; ctx.font="bold "+Math.max(7,view.s*.4)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("✓",rr*.72,rr*.1+.5);
      }
      ctx.restore();
    }
    /* ==== end WP-A ==== */
    // wound badge
    if(t.maxW>1){
      const r=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
      ctx.rotate(t.shape==="r"?-(t.rot||0)*Math.PI/180:0);
      ctx.fillStyle=t.wounds<t.maxW?"#d86a5a":"#5fbf6f";
      ctx.beginPath(); ctx.arc(r*.75,-r*.75,Math.max(6,view.s*.4),0,7); ctx.fill();
      ctx.fillStyle="#101216"; ctx.font="bold "+Math.max(8,view.s*.5)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(t.wounds,r*.75,-r*.75+.5);
    }
    ctx.restore();
  });
  wpDrawRotateHandle(); /* ==== WP-B: vehicle rotate handle ==== */
  wp6Overlay(); /* ==== WP6: objectives ==== control glow, OC tallies, battle-shock badges */
  if(typeof wp18Overlay==="function") wp18Overlay(); /* ==== WP18 ==== casualty-suggestion ring + numbered badges while allocation pends */
  // marquee
  if(marquee){ ctx.strokeStyle="rgba(255,255,255,.6)"; ctx.setLineDash([4,3]);
    ctx.strokeRect(...px(Math.min(marquee.x0,marquee.x1),Math.min(marquee.y0,marquee.y1)),Math.abs(marquee.x1-marquee.x0)*view.s,Math.abs(marquee.y1-marquee.y0)*view.s); ctx.setLineDash([]); }
  // rulers
  drawRuler(ruler,"#e8b23a"); drawRuler(theirRuler,"#7ec8ff");
  drawLos(); /* ==== WP4: LoS overlay ==== */
  wp2DrawPaths(); /* ==== WP2: move measure ==== */
  wp7Overlay(); /* ==== WP7: phases ==== reserves placement shading + phase/tray UI refresh */
  // coherency banner
  if(incoherent.size){
    ctx.font="bold 12px sans-serif"; const msg="⚠ "+incoherent.size+" model"+(incoherent.size>1?"s":"")+" out of unit coherency";
    const w=ctx.measureText(msg).width;
    ctx.fillStyle="rgba(30,10,10,.85)"; ctx.fillRect(W-w-70,8,w+16,22);
    ctx.fillStyle="#ff7060"; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(msg,W-w-62,19);
  }
}
function drawRuler(r,color){
  if(!r) return;
  if(r.pts&&r.pts.length>=2){ wp19DrawChain(r,color); return; } /* ==== WP19 ==== waypoint chain rendering ==== end WP19 ==== */
  const [ax,ay]=px(r.x0,r.y0),[bx2,by2]=px(r.x1,r.y1);
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx2,by2); ctx.stroke();
  ctx.beginPath(); ctx.arc(ax,ay,3,0,7); ctx.arc(bx2,by2,3,0,7); ctx.fillStyle=color; ctx.fill();
  const d=Math.hypot(r.x1-r.x0,r.y1-r.y0);
  ctx.font="bold 13px sans-serif"; const label=d.toFixed(1)+'"';
  const mx=(ax+bx2)/2,myy=(ay+by2)/2;
  ctx.fillStyle="#101216"; const w=ctx.measureText(label).width;
  ctx.fillRect(mx-w/2-4,myy-20,w+8,16);
  ctx.fillStyle=color; ctx.textAlign="center"; ctx.fillText(label,mx,myy-8);
}
const initials=s=>s.split(/\s+/).map(w=>w[0]||"").join("").slice(0,3).toUpperCase();

/* ==== WP4: visibility & cover (11th-ed area rules) ==== */
/* WP4-GEOM-BEGIN — pure geometry + LoS core. NO DOM/state access in this block:
   tools/test_geometry.js extracts it verbatim from this file and unit-tests it in node. */
function geomSegSeg(ax,ay,bx,by,cx,cy,dx,dy){
  // Segment AB vs segment CD proper-intersection test (grazes along a parallel edge don't count).
  const rx=bx-ax, ry=by-ay, sx=dx-cx, sy=dy-cy;
  const den=rx*sy-ry*sx;
  if(den===0) return false;
  const qx=cx-ax, qy=cy-ay;
  const t=(qx*sy-qy*sx)/den, u=(qx*ry-qy*rx)/den;
  return t>=0&&t<=1&&u>=0&&u<=1;
}
function geomCorners(r){
  // Rotated rect {x,y,w,h,rot°} — x,y is the UNROTATED top-left, rotation about the centre (app convention).
  const cx=r.x+r.w/2, cy=r.y+r.h/2, a=(r.rot||0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return [[-r.w/2,-r.h/2],[r.w/2,-r.h/2],[r.w/2,r.h/2],[-r.w/2,r.h/2]]
    .map(p=>[cx+p[0]*c-p[1]*s, cy+p[0]*s+p[1]*c]);
}
function geomEdges(r){ const C=geomCorners(r); return C.map((p,i)=>[p[0],p[1],C[(i+1)%4][0],C[(i+1)%4][1]]); }
function geomPointInRect(px,py,r){
  const cx=r.x+r.w/2, cy=r.y+r.h/2, a=-(r.rot||0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  const dx=px-cx, dy=py-cy, lx=dx*c-dy*s, ly=dx*s+dy*c;
  return Math.abs(lx)<=r.w/2 && Math.abs(ly)<=r.h/2;
}
function geomSegHitsEdges(x1,y1,x2,y2,edges){
  for(let i=0;i<4;i++){ const e=edges[i]; if(geomSegSeg(x1,y1,x2,y2,e[0],e[1],e[2],e[3])) return true; }
  return false;
}
const LOS_OBSC={ruin:1,wood:1,crate:1,wall:1};  // obscuring terrain-area kinds; crater = exposed, never obscures
const LOS_DENSE={ruin:1,wood:1,crate:1};        // dense features (Hidden eligibility); wall = light
function losPrep(terrain){
  // Precompute per-terrain edge lists once per scan — perf requirement for full-army scans.
  const out=[];
  for(const t of (terrain||[])) if(LOS_OBSC[t.kind]) out.push({t, edges:geomEdges(t), wall:t.kind==="wall", dense:!!LOS_DENSE[t.kind]});
  return out;
}
function losSamples(m){ // model {x,y,r} → centre + 4 cardinal base-edge points
  const r=m.r||0;
  return [[m.x,m.y],[m.x,m.y-r],[m.x+r,m.y],[m.x,m.y+r],[m.x-r,m.y]];
}
function losPair(a,b,prep,ignoreWalls){
  // 9 sampled sight lines: centre↔centre + centre↔4 cardinal points, both ways.
  // NOT visible iff every line crosses ≥1 obscuring rect, excluding rects containing a or b
  // (area rules: crossing an area blocks; into/out of an area doesn't).
  const rel=[];
  for(let i=0;i<prep.length;i++){ const p=prep[i];
    if(ignoreWalls&&p.wall) continue;
    if(geomPointInRect(a.x,a.y,p.t)||geomPointInRect(b.x,b.y,p.t)) continue;
    rel.push(p);
  }
  if(!rel.length) return {vis:true,part:false};
  const A=losSamples(a), B=losSamples(b);
  let clear=false, blocked=false;
  for(let li=0;li<9;li++){
    const s=li<5?A[0]:A[li-4], e=li<5?B[li]:B[0];
    let hit=false;
    for(let i=0;i<rel.length&&!hit;i++) hit=geomSegHitsEdges(s[0],s[1],e[0],e[1],rel[i].edges);
    if(hit) blocked=true; else clear=true;
    if(clear&&blocked) break;
  }
  return {vis:clear, part:blocked};
}
function losUnitVs(msA,msB,prep,coverKw){
  // Unit-level: B is visible if ANY sampled model pair is visible.
  // Cover (documented approximation): a visible pair had sight lines clipped by an obscuring
  // area, or (coverKw: target has INFANTRY/BEASTS/SWARM) a target model's centre is inside one.
  // Returns {vis,cover,dist(edge-to-edge),ai,bi,vai,vbi} — ai/bi = closest pair (used to explain a
  // BLOCKED result); vai/vbi = the first pair that actually SEES (so the 👁 overlay draws the sightline
  // that grants visibility, not a nearer blocked pair whose line would cut straight through a ruin).
  let vis=false, cover=false, dist=Infinity, ai=0, bi=0, vai=-1, vbi=-1;
  for(let j=0;j<msB.length;j++) for(let i=0;i<msA.length;i++){
    const d=Math.hypot(msA[i].x-msB[j].x,msA[i].y-msB[j].y)-(msA[i].r||0)-(msB[j].r||0);
    if(d<dist){ dist=d; ai=i; bi=j; }
  }
  outer:
  for(let i=0;i<msA.length;i++){
    const ig=(msA[i].lvl||0)>=1; // WP5 hook: raised models see over low (wall) areas; lvl absent → 0
    for(let j=0;j<msB.length;j++){
      const r=losPair(msA[i],msB[j],prep,ig);
      if(r.vis){ vis=true; if(vai<0){ vai=i; vbi=j; } if(r.part) cover=true; }
      if(vis&&cover) break outer;
    }
  }
  if(vis&&!cover&&coverKw)
    cover=msB.some(b=>prep.some(p=>geomPointInRect(b.x,b.y,p.t)));
  return {vis,cover,dist:Math.max(0,dist),ai,bi,vai:vai<0?ai:vai,vbi:vbi<0?bi:vbi};
}
/* WP4-GEOM-END */
let losSrc=null; // unit id currently observed with the 👁 tool
const KW_COVER=["INFANTRY","BEASTS","BEAST","SWARM"];
const tokKw=t=>(t.kw||[]).map(k=>String(k).toUpperCase());
const unitHasKw=(toks,list)=>toks.some(t=>tokKw(t).some(k=>list.includes(k)));
function tokLosModel(t){ return {x:t.x,y:t.y,r:tokRadius(t),lvl:t.lvl||0}; }
function unitHiddenEligible(toks){
  const dense=losPrep(state.terrain).filter(p=>p.dense);
  return toks.length>0 && unitHasKw(toks,KW_COVER) && toks.every(t=>dense.some(p=>geomPointInRect(t.x,t.y,p.t)));
}
function losCheckUnits(unitA,unitB){
  // Public API (used by the wired attack flow, WP3): visibility/cover between two units on the table.
  const A=state.tokens.filter(t=>t.unit===unitA), B=state.tokens.filter(t=>t.unit===unitB);
  if(!A.length||!B.length) return null;
  const res=losUnitVs(A.map(tokLosModel),B.map(tokLosModel),losPrep(state.terrain),unitHasKw(B,KW_COVER));
  if(res.vis && B.every(t=>t.hid) && res.dist>15){ res.vis=false; res.hidden=true; }
  return res;
}
function losToolClick(ix,iy){
  const tk=hitToken(ix,iy);
  losSrc=tk?tk.unit:null;
  if(tk && tk.owner===mySide){
    const toks=state.tokens.filter(t=>t.unit===tk.unit);
    if(!toks.every(t=>t.hid) && unitHiddenEligible(toks))
      logSys(tk.name+" is wholly inside dense terrain — press H to mark it Hidden (reads as undetectable beyond 15\" while it stays quiet).");
  }
  draw();
}
function toggleHidden(){
  const units=[...new Set(state.tokens.filter(t=>sel.has(t.id)).map(t=>t.unit))];
  if(!units.length){ logSys("Select a unit first, then press H to toggle Hidden."); return; }
  units.forEach(uk=>{
    const toks=state.tokens.filter(t=>t.unit===uk); if(!toks.length) return;
    const on=!toks.every(t=>t.hid);
    op({k:"tok~",toks:toks.map(t=>({id:t.id,hid:on}))});
    if(on && !unitHiddenEligible(toks)) logSys("Note: "+toks[0].name+" doesn't look wholly inside a dense terrain area with INFANTRY/BEASTS/SWARM — check the Hidden conditions.");
    logShared("· <b>"+esc(myName)+"</b> "+(on?"marks":"unmarks")+" <b>"+esc(toks[0].name)+"</b> "+(on?"Hidden 🙈":"visible"),"sys");
  });
}
function drawHiddenBadge(t){
  const r=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
  ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
  const br=Math.max(5,view.s*.35);
  ctx.beginPath(); ctx.arc(-r*.75,-r*.75,br,0,7); ctx.fillStyle="#3a4250"; ctx.fill();
  ctx.strokeStyle="#9aa4b2"; ctx.lineWidth=1; ctx.stroke();
  ctx.fillStyle="#cfd6df"; ctx.font="bold "+Math.max(7,view.s*.45)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText("H",-r*.75,-r*.75+.5);
  ctx.restore();
}
/* ==== WP-FIGHT: Fell back badge ==== top-right pip, orange, so it never collides with the
   Hidden badge (top-left) or the floor/role/tag chips (bottom). Visual-only, drawn from t.fellBack. */
function drawFallBackBadge(t){
  const r=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
  ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
  const br=Math.max(5,view.s*.35);
  ctx.beginPath(); ctx.arc(r*.75,-r*.75,br,0,7); ctx.fillStyle="#a85a1a"; ctx.fill();
  ctx.strokeStyle="#e8b23a"; ctx.lineWidth=1; ctx.stroke();
  ctx.fillStyle="#fff2d6"; ctx.font="bold "+Math.max(7,view.s*.45)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText("F",r*.75,-r*.75+.5);
  ctx.restore();
}
/* ==== WP-FIGHT (P2-3): Advanced badge — a blue "A" pip; the unit can't shoot or charge this turn */
function drawAdvancedBadge(t){
  const r=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
  ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
  const br=Math.max(5,view.s*.35);
  ctx.beginPath(); ctx.arc(r*.75,-r*.75,br,0,7); ctx.fillStyle="#1a4a85"; ctx.fill();
  ctx.strokeStyle="#7ec8ff"; ctx.lineWidth=1; ctx.stroke();
  ctx.fillStyle="#e6f2ff"; ctx.font="bold "+Math.max(7,view.s*.45)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText("A",r*.75,-r*.75+.5);
  ctx.restore();
}
function drawLos(){
  if(tool!=="los"||!losSrc) return;
  const src=state.tokens.filter(t=>t.unit===losSrc);
  if(!src.length){ losSrc=null; return; }
  const prep=losPrep(state.terrain), msA=src.map(tokLosModel), owner=src[0].owner;
  ctx.save();
  src.forEach(t=>{ const [tx,ty]=px(t.x,t.y); ctx.beginPath(); ctx.arc(tx,ty,tokRadius(t)*view.s+4,0,7); ctx.strokeStyle="rgba(126,200,255,.9)"; ctx.lineWidth=2; ctx.stroke(); });
  const byUnit={};
  state.tokens.forEach(t=>{ if(t.owner!==owner) (byUnit[t.unit]=byUnit[t.unit]||[]).push(t); });
  for(const uk in byUnit){
    const toks=byUnit[uk], msB=toks.map(tokLosModel);
    const res=losUnitVs(msA,msB,prep,unitHasKw(toks,KW_COVER));
    let col="#5fbf6f", note="visible";
    if(res.vis && toks.every(t=>t.hid) && res.dist>15){ res.vis=false; note="hidden"; }
    if(!res.vis){ col="#ff5050"; if(note!=="hidden") note="no LoS"; }
    else if(res.cover){ col="#e8b23a"; note="cover"; }
    const ia=res.vis?res.vai:res.ai, ib=res.vis?res.vbi:res.bi; // draw the seeing pair when visible, the closest pair when blocked
    const a=src[ia]||src[0], b=toks[ib]||toks[0];
    const [ax,ay]=px(a.x,a.y),[bx2,by2]=px(b.x,b.y);
    ctx.strokeStyle=col; ctx.lineWidth=1.6; if(!res.vis) ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx2,by2); ctx.stroke(); ctx.setLineDash([]);
    const label=res.dist.toFixed(1)+'" · '+note;
    ctx.font="bold 11px sans-serif"; const w=ctx.measureText(label).width;
    const mx=(ax+bx2)/2, myy=(ay+by2)/2;
    ctx.fillStyle="rgba(16,18,22,.85)"; ctx.fillRect(mx-w/2-3,myy-8,w+6,15);
    ctx.fillStyle=col; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(label,mx,myy);
  }
  ctx.restore();
}
/* ==== end WP4 ==== */

/* ==== WP5: terrain physicality (collision + floors) ==== */
const KW_ENTER_RUINS=["INFANTRY","BEASTS","BEAST","SWARM"];           // may end a move inside ruin footprints — and, being able to be there, may climb its floors
const WP5_NAMES={wall:"low wall",crate:"container",ruin:"ruin footprint (needs INFANTRY/BEASTS/SWARM)"};
function wp5Enforce(){
  // Own toggle, default ON — impassable terrain is physics, not a house rule
  // (movement caps stay opt-in under WP2's separate strictMove toggle).
  const el=document.getElementById("wp5Strict");
  return el?el.checked:true;
}
function wp5BaseOverlaps(t,ter){
  // Token base (circle of tokRadius) vs the rotated terrain rect — true overlap,
  // not just centre-inside, so thin walls can't hide under a base edge.
  // WP21: oval bases deliberately keep this bounding-circle approximation (as rects always did) — collision stays shape-agnostic.
  const cx=ter.x+ter.w/2, cy=ter.y+ter.h/2, a=-(ter.rot||0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  const dx=t.x-cx, dy=t.y-cy, lx=dx*c-dy*s, ly=dx*s+dy*c;
  const qx=Math.max(Math.abs(lx)-ter.w/2,0), qy=Math.max(Math.abs(ly)-ter.h/2,0);
  return Math.hypot(qx,qy) < tokRadius(t)*0.95; // brushing the edge doesn't count
}
function wp5Illegal(t){
  // A token may not END overlapping a wall/container (base-overlap test), or inside a
  // ruin footprint (centre test — "inside the area") unless it has INFANTRY/BEASTS/SWARM.
  // Woods/craters are enterable by everything.
  // Back-compat: legacy/manual tokens with no keyword info (kw missing or empty) get the
  // benefit of the doubt on ruins — DB-built tokens always carry a real keyword list.
  const okRuin=!(t.kw&&t.kw.length)||tokKw(t).some(k=>KW_ENTER_RUINS.includes(k));
  for(const ter of state.terrain){
    if(ter.kind==="wall"||ter.kind==="crate"){ if(wp5BaseOverlaps(t,ter)) return ter.kind; }
    else if(ter.kind==="ruin"&&!okRuin){ if(geomPointInRect(t.x,t.y,ter)) return "ruin"; }
  }
  return null;
}
function wp5BlockDrop(dr){
  // Called from mouseup on a token drop. True = drop was illegal and snapped back.
  const bad=state.tokens.filter(t=>sel.has(t.id)).map(t=>({t,why:wp5Illegal(t)})).filter(x=>x.why);
  if(!bad.length) return false;
  if(!wp5Enforce()){ logSys("⚠ "+bad.length+" model(s) ended on impassable terrain ("+WP5_NAMES[bad[0].why]+")."); return false; }
  op({k:"tok~",toks:dr.snap});
  logSys("Move undone: "+bad[0].t.name+" can't end on a "+WP5_NAMES[bad[0].why]+". Untick enforcement in Setup to allow it.");
  return true;
}
function wp5DeployWarn(toks){
  const n=toks.filter(t=>wp5Illegal(t)).length;
  if(n) logSys("⚠ "+n+" deployed model(s) landed on impassable terrain — drag them clear.");
}
function ruinMaxLvl(ter){
  // How many UPPER floors a ruin actually renders, derived from its footprint size — this MUST
  // stay in sync with the storey thresholds in sections/wp3d-6-terrain2.js (longSide>=9 builds
  // slabs at y=3 AND y=6 → 2 upper floors; >=6.5 builds y=3 only → 1; smaller = 1-storey stub,
  // no upper floor). Keeps the rules layer from offering a floor the 3D building has no slab for
  // (a model set above the top slab would otherwise float in mid-air).
  const longSide=Math.max(ter.w||0,ter.h||0);
  return longSide>=9?2:longSide>=6.5?1:0;
}
function cycleFloor(){
  // F cycles floor level 0→…→maxLvl→0 on selected models; ruins only, INFANTRY/BEASTS/SWARM only.
  // maxLvl comes from the ruin's own size (ruinMaxLvl) so we never send a model to a non-existent floor.
  const toks=state.tokens.filter(t=>sel.has(t.id));
  if(!toks.length){ logSys("Select models first, then press F to cycle their floor level."); return; }
  const ups=[]; let denied=0, noFloor=0, maxStep=0;
  toks.forEach(t=>{
    const okKw=!(t.kw&&t.kw.length)||tokKw(t).some(k=>KW_ENTER_RUINS.includes(k)); // kw unknown → allow
    const ruin=state.terrain.find(ter=>ter.kind==="ruin"&&geomPointInRect(t.x,t.y,ter));
    if(!okKw||!ruin){ denied++; return; }
    const maxLvl=ruinMaxLvl(ruin);
    if(maxLvl<1){ noFloor++; return; }                 // single-storey ruin: no upper floor to climb
    const cur=t.lvl||0, nl=cur>=maxLvl?0:cur+1;
    maxStep=Math.max(maxStep,Math.abs(nl-cur));
    ups.push({id:t.id,lvl:nl});
  });
  if(denied) logSys(denied+" model(s) can't change floors — needs INFANTRY/BEASTS/SWARM and the model inside a ruin footprint.");
  if(noFloor) logSys(noFloor+" model(s) are on a single-storey ruin — it has no upper floor to climb.");
  if(!ups.length) return;
  op({k:"tok~",toks:ups});
  if(drag&&drag.mode==="tokens") drag.lvlExtra=(drag.lvlExtra||0)+3*maxStep; // WP2 hook: move readout adds drag.lvlExtra inches
  logShared("· <b>"+esc(myName)+"</b> sets "+ups.length+" model(s) to floor level "+ups[0].lvl+" (each level counts 3\" of movement)","sys");
}
function plungingFire(aTok,bTok){ return (aTok.lvl||0)>=1&&(bTok.lvl||0)===0; } // WP3 inspector hook: suggest "+1 BS (Plunging Fire)"
function drawLvlBadge(t){
  const r=(t.shape==="c"?mmIn(t.dmm)/2:Math.min(t.wIn,t.hIn)/2)*view.s;
  ctx.save(); if(t.shape==="r") ctx.rotate(-(t.rot||0)*Math.PI/180);
  const label="▲"+t.lvl; ctx.font="bold "+Math.max(8,view.s*.45)+"px sans-serif";
  const w=ctx.measureText(label).width;
  ctx.fillStyle="rgba(16,18,22,.85)"; ctx.fillRect(-r*.75-w/2-2,r*.45,w+4,Math.max(10,view.s*.55));
  ctx.fillStyle="#7ec8ff"; ctx.textAlign="center"; ctx.textBaseline="top"; ctx.fillText(label,-r*.75,r*.45+1);
  ctx.restore();
}
/* ==== end WP5 ==== */

/* ==== WP2: move measure ==== */
// Live move measurement: while dragging tokens, track the cumulative drag-path length
// and compare it to the dragged unit's Move stat (WP0 stamps Mv on tokens).
let wp2Move=null;                 // {pts:[[x,y]…], dist, cap, mixed} during a token drag
let wp2Their=null, wp2TheirTimer=null, wp2LastSend=0;
const WP2_JITTER=0.05;            // inches — micro-jitter below this doesn't count
const wp2Extra=()=>(drag&&drag.lvlExtra)||0; // WP5 floors: F mid-drag adds 3"/level to the measured move
function wp2Cap(){
  /* ==== WP-FIGHT: pile-in/consolidate ==== armed + the drag touches the armed unit → hard 3" cap overrides Mv */
  if(wpCapMode&&state.tokens.some(t=>sel.has(t.id)&&t.unit===wpCapMode.unit)) return {cap:wpCapMode.cap,mixed:false};
  // lowest Mv among the dragged (selected) tokens; cap=null if none carry stats (legacy tokens)
  const vals=state.tokens.filter(t=>sel.has(t.id)&&typeof t.Mv==="number").map(t=>t.Mv);
  if(!vals.length) return {cap:null,mixed:false};
  return {cap:Math.min(...vals), mixed:new Set(vals).size>1};
}
function wp2DragStart(ix,iy){
  const c=wp2Cap();
  // ==== WP-FIGHT: this particular drag is under an armed pile-in/consolidate cap (no M+6 advance leeway, always enforced)
  const forced=!!(wpCapMode&&state.tokens.some(t=>sel.has(t.id)&&t.unit===wpCapMode.unit));
  wp2Move={pts:[[ix,iy]], dist:0, cap:c.cap, mixed:c.mixed, forced};
}
function wp2DragMove(ix,iy){
  if(!wp2Move) return;
  const last=wp2Move.pts[wp2Move.pts.length-1];
  const seg=Math.hypot(ix-last[0],iy-last[1]);
  if(seg<WP2_JITTER) return;      // wait until micro-movements add up to something real
  wp2Move.pts.push([ix,iy]); wp2Move.dist+=seg;
  const now=Date.now();
  if(now-wp2LastSend>90){ wp2LastSend=now; send({t:"movepath",mp:{p:wp2Move.pts,d:wp2Move.dist+wp2Extra(),cap:wp2Move.cap,mixed:wp2Move.mixed}}); }
}
function wp2DragEnd(){
  if(!wp2Move) return;
  wp2Move=null;
  send({t:"movepath",mp:null});
}
// On drop with strict mode: snap back if the path exceeded M+6" (advance cap). Returns true if snapped.
function wp2DropCheck(){
  if(!wp2Move||wp2Move.cap===null) return false;
  const d=wp2Move.dist+wp2Extra();
  /* ==== WP-FIGHT: pile-in/consolidate — hard cap, no advance leeway, always enforced regardless of the Setup toggle */
  if(wp2Move.forced){
    if(d>wp2Move.cap+WP2_JITTER){
      op({k:"tok~",toks:drag.snap});
      logSys(`${wpCapMode&&wpCapMode.mode==="consolidate"?"Consolidate":"Pile in"} undone: ${d.toFixed(1)}" is beyond the 3" cap.`);
      return true;
    }
    return false;
  }
  if(d>wp2Move.cap+6+WP2_JITTER && document.getElementById("strictMove").checked){
    op({k:"tok~",toks:drag.snap});
    logSys(`Move undone: ${d.toFixed(1)}" is beyond M+6" (M ${wp2Move.cap}"). Untick "Enforce movement caps" in Setup to allow it.`);
    return true;
  }
  return false;
}
// After a move that stood, log advance-territory moves (M < d ≤ M+6 is a legal advance — never block).
function wp2LogMove(){
  if(!wp2Move||wp2Move.cap===null) return;
  const d=wp2Move.dist+wp2Extra(), cap=wp2Move.cap;
  /* ==== WP-FIGHT: pile-in/consolidate move log ==== */
  if(wp2Move.forced){
    if(d>WP2_JITTER) logShared(`· <b>${esc(myName)}</b> ${wpCapMode&&wpCapMode.mode==="consolidate"?"consolidated":"piled in"} ${d.toFixed(1)}" (cap 3")`,"sys");
    return;
  }
  /* ==== WP-FIGHT fidelity (P2-3) ==== a move past M (into M+D6 advance territory) is an Advance —
     stamp t.advanced on every model of the moved unit(s) so the shooting/charge gate can enforce
     "no shooting or charging this turn"; a fresh move within M clears a stale flag. Synced via tok~;
     auto-cleared when a fresh Movement phase begins (wp7ApplyPhase), same lifecycle as t.fellBack. */
  const adv=d>cap+WP2_JITTER;
  const movedUnits=new Set(state.tokens.filter(t=>sel.has(t.id)).map(t=>t.unit));
  const advChg=state.tokens.filter(t=>movedUnits.has(t.unit)&&(!!t.advanced)!==adv).map(t=>({id:t.id,advanced:adv}));
  if(advChg.length) op({k:"tok~",toks:advChg});
  if(d<=cap+WP2_JITTER) return;
  if(d<=cap+6+WP2_JITTER) logShared(`· <b>${esc(myName)}</b> moved ${d.toFixed(1)}" (M ${cap}") — advance? (M+D6", no shooting or charging)`,"sys");
  else logShared(`· <b>${esc(myName)}</b> moved ${d.toFixed(1)}" — beyond M+6" (M ${cap}")`,"sys");
}
function wp2TheirPath(mp){
  wp2Their=mp||null; draw();
  if(wp2TheirTimer) clearTimeout(wp2TheirTimer);
  if(wp2Their) wp2TheirTimer=setTimeout(()=>{wp2Their=null;draw();},4000);
}
function wp2Color(m){
  if(m.cap===null||m.d<=m.cap+WP2_JITTER) return "#fff";
  return m.d<=m.cap+6+WP2_JITTER?"#e8b23a":"#ff5050";
}
function wp2DrawOne(m,pathCol){
  if(!m||!m.p||m.p.length<2) return;
  ctx.strokeStyle=pathCol; ctx.lineWidth=1.5; ctx.setLineDash([5,4]);
  ctx.beginPath();
  m.p.forEach((pt,i)=>{ const q=px(pt[0],pt[1]); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]); });
  ctx.stroke(); ctx.setLineDash([]);
  const end=px(m.p[m.p.length-1][0],m.p[m.p.length-1][1]);
  let label=m.d.toFixed(1)+'"';
  if(m.cap!==null){
    label+=` / ${m.cap}"${m.mixed?"+":""}`;
    if(m.d>m.cap+WP2_JITTER && m.d<=m.cap+6+WP2_JITTER) label+=" +D6?";
  }
  ctx.font="bold 13px sans-serif";
  const w=ctx.measureText(label).width;
  ctx.fillStyle="rgba(16,18,22,.9)"; ctx.fillRect(end[0]+12,end[1]-24,w+10,18);
  ctx.fillStyle=wp2Color(m); ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText(label,end[0]+17,end[1]-15);
}
function wp2DrawPaths(){
  if(wp2Move) wp2DrawOne({p:wp2Move.pts,d:wp2Move.dist+wp2Extra(),cap:wp2Move.cap,mixed:wp2Move.mixed},"rgba(232,178,58,.45)");
  if(wp2Their) wp2DrawOne(wp2Their,"rgba(126,200,255,.45)");
}
/* ==== end WP2 ==== */

/* ==== WP3: inspector ==== */
// Unit inspector (single-click a token) + wired attack flow:
// weapon ⚔ → targeting mode → click an enemy model → Attack tab pre-filled.
const inspEl=document.getElementById("inspector");
let wp3Ctx=null;      // {tok, card, weapons:[...]} for the open inspector
let wp3Aiming=null;   // {wi} weapon index while picking a target
let wp3Label="";      // "attacker → target · weapon" line added to the attack log

// Find the display card for a token: own units from myArmy, the opponent's from the
// state.cards copies synced by WP0. Tokens store the profile name, cards the unit name.
function wp3CardFor(t){
  const src = t.owner===mySide ? myArmy.map(migrateCard) : ((state.cards&&state.cards[t.owner])||[]);
  const nn=norm(t.name||"");
  return src.find(c=>(c.profiles||[]).some(p=>norm(p.n||"")===nn))
      || src.find(c=>norm(c.name||"")===nn)
      || src.find(c=>(c.profiles||[]).some(p=>{const q=norm(p.n||"");return q&&(q.includes(nn)||nn.includes(q));}))
      || null;
}
// Parse one line of card.weapons: "Name [abilities] | R | A | Hit | S | AP | D"
function wp3ParseWeapon(line){
  const parts=line.split("|").map(s=>s.trim());
  if(parts.length<7||!parts[0]) return null;
  let n=parts[0], ab="";
  const bm=n.match(/^(.*?)\s*\[(.*)\]\s*$/);
  if(bm){ n=bm[1]; ab=bm[2]; }
  const melee=/^melee$/i.test(parts[1]);
  return {n,ab,melee,rng:melee?0:parseFloat(parts[1])||0,rngTxt:parts[1],A:parts[2],BS:parts[3],S:parts[4],AP:parts[5],D:parts[6]};
}
// Parse a weapon ability string ("rapid fire 2, sustained hits 1, anti-vehicle 4+, …")
// into the flags the Attack tab understands. Unrecognised abilities land in .extra.
function wp3ParseAbilities(ab){
  const out={rapid:0,sus:0,susTxt:"",anti:[],torrent:false,blast:false,twin:false,lethal:false,dev:false,extra:[]};
  String(ab||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).forEach(a=>{
    let m;
    if(m=a.match(/^rapid fire (\d+)$/)) out.rapid=+m[1];
    else if(m=a.match(/^sustained hits (\d+)$/)) out.sus=+m[1];
    else if(m=a.match(/^sustained hits (d\d+)$/)){ out.susTxt=m[1].toUpperCase(); out.extra.push("sustained hits "+m[1]); }
    else if(m=a.match(/^anti[- ]([a-z' ]+?)\s*(\d)\+$/)) out.anti.push({kw:m[1].trim().toUpperCase(),v:+m[2]});
    else if(a==="torrent") out.torrent=true;
    else if(a==="blast") out.blast=true;
    else if(a==="twin-linked"||a==="twin linked") out.twin=true;
    else if(a==="lethal hits") out.lethal=true;
    else if(a==="devastating wounds") out.dev=true;
    else out.extra.push(a);
  });
  return out;
}
// Add flat attacks to an attacks spec: "2"+2→"4", "D6"+2→"D6+2", "2D6+1"+2→"2D6+3".
function wp3AddA(spec,add){
  spec=String(spec).trim().toUpperCase();
  if(!add) return spec;
  const m=spec.match(/^(\d*D\d+)([+-]\d+)?$/);
  if(m){ const base=+(m[2]||0)+add; return m[1]+(base>0?"+"+base:base<0?String(base):""); }
  const v=parseInt(spec); return isNaN(v)?spec:String(v+add);
}
function wp3Hide(){ inspEl.style.display="none"; wp3Ctx=null; }
function wp3CancelAim(){ if(!wp3Aiming) return; wp3Aiming=null; setTool(tool); logSys("Targeting cancelled."); }
// Open the inspector for the first selected token (click without movement).
function wp3Inspect(){
  const tok=state.tokens.find(t=>sel.has(t.id)); if(!tok){ wp3Hide(); return; }
  const card=wp3CardFor(tok);
  const unitToks=state.tokens.filter(t=>t.unit===tok.unit);
  const col=tok.owner===1?"var(--p1)":"var(--p2)";
  const weapons=card?String(card.weapons||"").split("\n").map(wp3ParseWeapon).filter(Boolean):[];
  wp3Ctx={tok,card,weapons};
  let html=`<div class="title"><span style="color:${col}">${esc(card?card.name:tok.name)}</span>
    <span><span class="small">×${unitToks.length}${card&&card.pts?" · "+esc(card.pts)+"pts":""}</span> <button title="Model actions (wounds, role, hidden, floors…)" onclick="wp13MenuFromInspector(event)">⋯</button> <button title="Close (Esc)" onclick="wp3Hide()">✕</button></span></div>`;
  if(card){
    html+=(card.profiles||[]).map(p=>`<div class="statline">${(card.profiles||[]).length>1?`<b>${esc(p.n)}</b> · `:""}M <b>${esc(p.M??"?")}</b> T <b>${p.T??"?"}</b> Sv <b>${esc(p.Sv??"?")}</b> Inv <b>${esc(p.Inv??"-")}</b> W <b>${p.W??"?"}</b> Ld <b>${esc(p.Ld??"?")}</b> OC <b>${p.OC??"?"}</b></div>`).join("");
  } else {
    html+=`<div class="statline">M <b>${tok.Mv??"?"}"</b> T <b>${tok.T||"?"}</b> Sv <b>${esc(tok.Sv||"?")}</b> Inv <b>${esc(tok.iv||"-")}</b> OC <b>${tok.OC??"?"}</b></div>
      <div class="small">No card synced for this unit — stats read from the token.</div>`;
  }
  html+=`<div class="small">Clicked model: <b>${esc(tok.name)}</b> — ${tok.wounds}/${tok.maxW} W${tok.sgt?" · leader":""}${tok.tag?" · "+esc(tok.tag):""}</div>`;
  if(weapons.length){
    html+=`<table class="wtable"><tr><th>Weapon</th><th>R</th><th>A</th><th>Hit</th><th>S</th><th>AP</th><th>D</th><th></th></tr>`+
      weapons.map((w,i)=>`<tr><td>${esc(w.n)}${w.ab?` <span class="small">[${esc(w.ab)}]</span>`:""}</td><td>${esc(w.rngTxt)}</td><td>${esc(w.A)}</td><td>${esc(w.BS)}</td><td>${esc(w.S)}</td><td>${esc(w.AP)}</td><td>${esc(w.D)}</td>
        <td><button class="aim" title="Attack with this weapon — then click an enemy model" onclick="wp3Aim(${i})">⚔</button></td></tr>`).join("")+`</table>`;
  }
  if(card&&card.kw&&card.kw.length) html+=`<div class="small" style="margin-top:4px">${card.kw.map(esc).join(" · ")}</div>`;
  if(card&&card.notes) html+=`<div class="small" style="margin-top:4px">${esc(card.notes)}</div>`;
  html+=wp7InspectorHtml(tok); /* ==== WP7: phases ==== "→ Reserves" / Attach / Detach actions */
  html+=wpMoveInspectorHtml(tok); /* ==== WP-A: structured movement ==== "Movement complete" / "↩ Undo move" */
  html+=wpFightInspectorHtml(tok); /* ==== WP-FIGHT ==== Fall Back / Pile in / Consolidate / Fire Overwatch */
  inspEl.innerHTML=html; inspEl.style.display="block";
}
function wp3Aim(wi){
  if(!wp3Ctx||!wp3Ctx.weapons[wi]) return;
  wp3Aiming={wi};
  cv.style.cursor="crosshair";
  logSys(`Targeting with ${wp3Ctx.weapons[wi].n} — click an enemy model (Esc cancels).`);
}
// Closest edge-to-edge distance between two sets of models (how range is measured).
function wp3UnitDist(aToks,bToks){
  let d=Infinity;
  aToks.forEach(a=>bToks.forEach(b=>{ const e=edgeDist(a,b); if(e<d)d=e; }));
  return Math.max(0,d);
}
function wp3PickTarget(ix,iy){
  const aim=wp3Aiming; wp3Aiming=null; setTool(tool);
  const tk=hitToken(ix,iy);
  if(!tk||!wp3Ctx||tk.owner===wp3Ctx.tok.owner){ logSys("Targeting cancelled."); return; }
  if(wp3Stage(wp3Ctx,aim.wi,tk)===false) return; /* ==== WP-FIGHT fidelity gate ==== blocked (Fell Back / Advanced) — nothing staged */
  wp15AfterStage(wp3Ctx,aim.wi,tk,false); /* ==== WP15 ==== weapon selector for the inspector ⚔ flow (single-weapon aim: no carrier multiply) */
}
/* ==== WP-FIGHT fidelity gate (P2-3) ==== a unit that Fell Back this turn may neither shoot nor
   charge/fight; a unit that Advanced this turn may not shoot (it may still fight). 11th ed — Core
   Rules Study Notes (Fall Back / Advance). Returns a reason string when the staged attack is
   illegal, else "". Owner-agnostic: only the human's own units ever carry these transient flags
   (the AI tracks its own advance/charge state separately), so this never blocks a legal AI action. */
function wpMoveActionBlock(uk,isMelee){
  const toks=state.tokens.filter(t=>t.unit===uk);
  if(!toks.length) return "";
  const nm=toks[0].name;
  if(toks.some(t=>t.fellBack)) return isMelee
    ? `${nm} Fell Back this turn — it can't charge or fight (11th ed).`
    : `${nm} Fell Back this turn — it can't shoot (11th ed).`;
  if(!isMelee&&toks.some(t=>t.advanced)) return `${nm} Advanced this turn — it can't shoot (11th ed).`;
  return "";
}
/* ==== end WP-FIGHT fidelity gate ==== */
// Pre-fill the Attack tab from a weapon + target token, then switch to it.
// Returns false if the attack is blocked by the fidelity gate (nothing staged), else undefined.
function wp3Stage(ctx0,wi,tgtTok){
  const w=ctx0.weapons[wi], ab=wp3ParseAbilities(w.ab), g=id=>document.getElementById(id);
  const atkToks=state.tokens.filter(t=>t.unit===ctx0.tok.unit);
  /* ==== WP-FIGHT fidelity gate (P2-3) ==== block a shot/charge from a Fell-Back/Advanced unit */
  const block=wpMoveActionBlock(ctx0.tok.unit,!!w.melee);
  if(block){
    wp3Label=""; wp16Staged=null; if(typeof wp16Hide==="function")wp16Hide();
    const st=g("akStage");
    if(st){ st.style.display="block";
      st.innerHTML=`<div class="card" style="padding:6px 8px;margin-bottom:0;border-left:3px solid var(--bad)"><b style="color:var(--bad)">⛔ Blocked</b> — ${esc(block)}</div>`; }
    logSys("⛔ "+block);
    showTab("attack");
    return false;
  }
  /* ==== end WP-FIGHT fidelity gate ==== */
  const tgtToks=state.tokens.filter(t=>t.unit===tgtTok.unit);
  const tgtCard=wp3CardFor(tgtTok);
  const atkName=ctx0.card?ctx0.card.name:ctx0.tok.name, tgtName=tgtCard?tgtCard.name:tgtTok.name;
  const dist=wp3UnitDist(atkToks,tgtToks);
  const inRange=w.melee?dist<=2.02:dist<=w.rng+0.02; /* 11th-ed engagement range is 2" horizontally (was 1" in 10th) */
  const notes=[];
  /* ==== WP4/WP5 wiring: LoS, cover and Plunging Fire feed the staged attack ==== */
  const los=losCheckUnits(ctx0.tok.unit,tgtTok.unit);
  if(los&&!los.vis&&!w.melee) notes.push(los.hidden?'target is Hidden and beyond 15" — not visible':"no line of sight (check with the 👁 tool)");
  if(!w.melee&&plungingFire(ctx0.tok,tgtTok)) notes.push("+1 to hit? Plunging Fire — attacker is a floor up (set Hit mod)");
  /* ==== end wiring ==== */
  // attacks: rapid fire at half range (prompted), blast +1 per 5 models in the target unit
  let A=String(w.A).toUpperCase();
  if(ab.rapid&&!w.melee&&dist<=w.rng/2+0.02){
    if(confirm(`Within half range (${dist.toFixed(1)}" of ${w.rng}") — apply Rapid Fire ${ab.rapid} (+${ab.rapid} attack${ab.rapid>1?"s":""})?`)){ A=wp3AddA(A,ab.rapid); notes.push(`Rapid Fire ${ab.rapid} applied`); }
  } else if(ab.rapid) notes.push(`Rapid Fire ${ab.rapid} only within ${w.rng/2}"`);
  if(ab.blast){ const bonus=Math.floor(tgtToks.length/5);
    if(bonus){ A=wp3AddA(A,bonus); notes.push(`Blast +${bonus} (${tgtToks.length} models)`); } else notes.push("Blast (no bonus under 5 models)"); }
  g("akA").value=A;
  const bs=String(w.BS).match(/^(\d)\+?$/);
  g("akBS").value=(ab.torrent||!bs)?"auto":bs[1]+"+";
  if(!bs&&!ab.torrent) notes.push("no BS on profile — set to auto-hit");
  g("akS").value=parseInt(w.S)||0;
  const apv=String(-Math.abs(parseInt(w.AP)||0));
  g("akAP").value=["0","-1","-2","-3","-4","-5"].includes(apv)?apv:"-5";
  g("akD").value=w.D;
  // reset everything staging doesn't set, then apply parsed abilities
  g("akHitMod").value="0"; g("akWndMod").value="0";
  g("akRrHit").value="none"; g("akRrWnd").value="none";
  g("akLethal").checked=ab.lethal; g("akTwin").checked=ab.twin; g("akDev").checked=ab.dev;
  g("akSus").value=ab.sus;
  const tKw=(tgtTok.kw&&tgtTok.kw.length?tgtTok.kw:(tgtCard&&tgtCard.kw)||[]).map(s=>String(s).toUpperCase());
  const anti=ab.anti.find(a=>tKw.includes(a.kw));
  g("akAnti").value=(anti&&anti.v>=2&&anti.v<=5)?String(anti.v):"0";
  ab.anti.filter(a=>a!==anti).forEach(a=>notes.push(`anti-${a.kw.toLowerCase()} ${a.v}+ (target is not ${a.kw})`));
  if(ab.extra.length) notes.push("apply manually: "+ab.extra.join(", "));
  // target side from the target token's WP0 stats
  if(tgtTok.T) g("tgT").value=tgtTok.T;
  const sv=String(tgtTok.Sv||"").match(/^([2-6])\+?$/);
  if(sv) g("tgSv").value=sv[1]+"+"; else if(tgtTok.Sv) g("tgSv").value="7";
  const iv=String(tgtTok.iv||"").match(/^([3-6])\+?$/);
  g("tgInv").value=iv?iv[1]:"0";
  g("tgFNP").value="0";
  g("tgCover").checked=!!(los&&los.vis&&los.cover&&!w.melee); /* WP4 wiring */
  if(los&&los.vis&&los.cover&&!w.melee) notes.push("Benefit of Cover applied (LoS check)");
  // staging banner + attack-log label
  wp3Label=`⚔ ${atkName} → ${tgtName} · ${w.n}`;
  wp16Staged={tgtUk:tgtTok.unit,atkUk:ctx0.tok.unit}; /* ==== WP16 ==== remember the staged pair for the apply-damage button ==== end WP16 ==== */
  const rHint=w.melee?`melee — closest models ${dist.toFixed(1)}" ${inRange?"(in engagement range)":"(NOT within 2\")"}`
                     :`range ${w.rng}" — closest models ${dist.toFixed(1)}" ${inRange?"(in range)":"(OUT OF RANGE)"}`;
  const stage=g("akStage");
  stage.style.display="block";
  stage.innerHTML=`<div class="card" style="padding:6px 8px;margin-bottom:0;border-left:3px solid ${inRange?"var(--good)":"var(--bad)"}">
    <b>${esc(atkName)}</b> → <b>${esc(tgtName)}</b><br>${esc(w.n)} · <span style="color:${inRange?"var(--good)":"var(--bad)"}">${esc(rHint)}</span>
    ${notes.length?`<br><span class="small">${esc(notes.join(" · "))}</span>`:""}</div>`;
  showTab("attack");
  if(typeof aiNoteStage==="function") aiNoteStage(ctx0,tgtTok); /* ==== WP10: ai ==== remember the staged pair for solo auto-casualties */
  logSys(`Attack staged: ${atkName} → ${tgtName} with ${w.n}. Check the Attack tab and roll.`);
  if(typeof wp13OnStage==="function")wp13OnStage(); else if(typeof wp12AttackPulse==="function")wp12AttackPulse(); /* ==== WP13 ==== phone: open the Attack sheet (falls back to the WP12 pulse) */
}
// Manual edits to the Attack tab clear the staged attacker→target label.
document.getElementById("tab-attack").addEventListener("change",e=>{
  if(e.target&&e.target.id==="ldTarget") return;
  if(e.target&&e.target.id==="wp15Wep") return; /* ==== WP15 ==== weapon switch is a restage, not a manual edit */
  wp3Label=""; const s=document.getElementById("akStage"); s.style.display="none";
  if(typeof wp15ManualEdit==="function") wp15ManualEdit(); /* ==== WP15 ==== manual edit: hide the weapon selector, drop the restage ctx */
  wp16Staged=null; if(typeof wp16Hide==="function")wp16Hide(); /* ==== WP16 ==== manual edits invalidate the staged apply-damage button ==== end WP16 ==== */
});
/* ==== end WP3 ==== */

/* ============ board input ============ */
function hitToken(ix,iy){
  for(let i=state.tokens.length-1;i>=0;i--){ const t=state.tokens[i];
    if(t.shape==="c"){ if(Math.hypot(ix-t.x,iy-t.y)<=mmIn(t.dmm)/2+.15) return t; }
    else { const a=-(t.rot||0)*Math.PI/180, dx=ix-t.x, dy=iy-t.y;
      const rx=dx*Math.cos(a)-dy*Math.sin(a), ry=dx*Math.sin(a)+dy*Math.cos(a);
      if(t.oval){ if((rx/(t.wIn/2+.15))**2+(ry/(t.hIn/2+.15))**2<=1) return t; } /* ==== WP21 ==== ellipse hit for oval bases (same ~.15" slack as circles) */
      else if(Math.abs(rx)<=t.wIn/2&&Math.abs(ry)<=t.hIn/2) return t; } }
  return null;
}
function hitTerrain(ix,iy){
  for(let i=state.terrain.length-1;i>=0;i--){ const t=state.terrain[i];
    if(ix>=t.x&&ix<=t.x+t.w&&iy>=t.y&&iy<=t.y+t.h) return t; }
  return null;
}
function hitObjective(ix,iy){ return state.objectives.find(o=>Math.hypot(ix-o.x,iy-o.y)<=mmIn(40)/2+.2); }
/* ==== WP3D-0: drag extraction ==== token-move core lifted verbatim out of the pointerdown/
   pointermove/pointerup handlers below (same statements, same order, same shared module-level
   state — `drag`, `sel`, `wpMoved`, `wpDone`, `wpMoveStart`) so a future 3D picking/drag path
   can reuse it. The handlers below now just call these; behaviour is unchanged (proven by the
   full existing test suite staying green — these are exactly the old inline bodies).
   Left in the handlers (NOT extracted, non-token concerns tangled with token hit/selection):
   the tk=hitToken(ix,iy) hit-test + shift-click add/remove/toggle-return in pointerdown, and
   the wp19 ruler / marquee / terrain / WP-B rotate branches everywhere — those are separate
   drag.mode values, not the "tokens" core. */
function tokDragBegin(ids,ix,iy){ // pointerdown "tokens" branch, after hit/selection resolution
  const tk=state.tokens.find(t=>t.id===ids[0]); if(!tk) return null;
  /* ==== WP-A: structured movement ==== move-once hard lock (opt-out via Setup checkbox) */
  const structOn=!!(document.getElementById("structMove")&&document.getElementById("structMove").checked);
  const unitMemberIds=state.tokens.filter(t=>t.unit===tk.unit).map(t=>t.id);
  if(wpDone.has(tk.unit)){
    logSys("This unit's movement is complete — use ↩ Undo move in its inspector to move it again.");
    draw(); return null;
  }
  if(structOn&&wpMoved.has(tk.id)&&unitMemberIds.some(id=>!wpMoved.has(id))){
    logSys("Move the rest of this unit before re-moving a model.");
    draw(); return null;
  }
  /* ==== end WP-A ==== */
  checkCoherency();
  const units=new Set(state.tokens.filter(t=>sel.has(t.id)).map(t=>t.unit));
  /* ==== WP-A ==== lazily snapshot each involved unit's pre-move position, once per Movement phase */
  units.forEach(uk=>{ if(!wpMoveStart[uk]) wpMoveStart[uk]=state.tokens.filter(t=>t.unit===uk).map(t=>({id:t.id,x:t.x,y:t.y,rot:t.rot||0})); });
  drag={mode:"tokens",lx:ix,ly:iy,moved:false,
    snap:state.tokens.filter(t=>units.has(t.unit)).map(t=>({id:t.id,x:t.x,y:t.y})),
    cohBefore:new Set([...units].filter(unitCoherent))};
  wp2DragStart(ix,iy); /* ==== WP2: move measure ==== */
  draw();
  return drag;
}
function tokDragMove(ix,iy){ // pointermove "tokens" branch
  if(!drag||drag.mode!=="tokens") return;
  const dx=ix-drag.lx, dy=iy-drag.ly; drag.lx=ix; drag.ly=iy; drag.moved=true;
  state.tokens.forEach(t=>{ if(sel.has(t.id)){ t.x+=dx; t.y+=dy; } });
  wp2DragMove(ix,iy); /* ==== WP2: move measure ==== */
  draw();
}
function tokDragCommit(){ // pointerup "tokens" branch (incl. its own WP5 early-return gate)
  if(!drag||drag.mode!=="tokens") return;
  /* ==== WP5: terrain collision — illegal drops snap back ==== */
  if(drag.moved&&wp5BlockDrop(drag)){ wp2DragEnd(); drag=null; draw(); return; }
  /* ==== end WP5 ==== */
  if(drag.moved){
    /* ==== WP2: move measure ==== */
    if(wp2DropCheck()){ wp2DragEnd(); drag=null; draw(); return; }
    /* ==== end WP2 ==== */
    checkCoherency();
    const broken=[...drag.cohBefore].filter(uk=>!unitCoherent(uk));
    if(broken.length && document.getElementById("strictCoh").checked){
      op({k:"tok~",toks:drag.snap});
      logSys("Move undone: that would break unit coherency (2\" of a squadmate, 9\" of every squadmate). Untick enforcement in Setup to allow it.");
    } else {
      op({k:"tok~",toks:state.tokens.filter(t=>sel.has(t.id)).map(t=>({id:t.id,x:t.x,y:t.y}))});
      wp2LogMove(); /* ==== WP2: move measure ==== */
      /* ==== WP-A: structured movement ==== drop committed clean — every dragged model has now used its move */
      [...sel].filter(id=>state.tokens.some(t=>t.id===id)).forEach(id=>wpMoved.add(id));
      /* ==== end WP-A ==== */
    }
  }
  /* ==== WP3: inspector ==== click without movement opens the unit inspector */
  else { wp3Inspect(); }
  /* ==== end WP3 ==== */
  wp2DragEnd(); /* ==== WP2: move measure ==== */
  drag=null; draw();
}
/* ==== end WP3D-0: drag extraction ==== */
let panning=null;
cv.addEventListener("contextmenu",e=>e.preventDefault());
cv.addEventListener("wheel",e=>{
  e.preventDefault();
  const f=e.deltaY<0?1.12:0.89, [ix,iy]=inch(e.offsetX,e.offsetY);
  view.s=Math.max(3,Math.min(60,view.s*f));
  view.x=e.offsetX-ix*view.s; view.y=e.offsetY-iy*view.s; draw();
},{passive:false});
cv.addEventListener("pointerdown",e=>{ /* WP8: was "mousedown" — handler logic unchanged */
  if(wp8PointerDown(e)) return; /* WP8: multi-touch (pinch) / gesture bookkeeping */
  wp1PreMutate(); /* WP1: capture pre-gesture state so drag moves are undoable */
  const [ix,iy]=inch(e.offsetX,e.offsetY);
  /* ==== WP13 ==== right-click ON a token = action menu; empty board / terrain keeps the pan */
  if(e.button===2&&!panning){ const mtk=hitToken(ix,iy); if(mtk){ wp13MenuOpen(mtk,e.clientX,e.clientY); return; } }
  /* ==== end WP13 ==== */
  if(e.button===2||e.button===1||(e.button===0&&e.altKey)){ panning={x:e.clientX,y:e.clientY}; return; }
  /* ==== WP3: inspector ==== */
  if(wp3Aiming&&e.button===0){ wp3PickTarget(ix,iy); return; }
  /* ==== end WP3 ==== */
  /* ==== WP11: allocation ==== damage packets pending: left-clicks allocate, nothing else (damage is owed) */
  if(typeof wp11Alloc!=="undefined"&&wp11Alloc&&e.button===0){ wp11AllocClick(ix,iy); return; }
  /* ==== end WP11 ==== */
  /* ==== WP7: phases ==== deploy-from-reserves placement mode (Shift-click overrides legality, logged) */
  if(wp7Placing&&e.button===0){ wp7PlaceClick(ix,iy,e.shiftKey); return; }
  /* ==== end WP7 ==== */
  if(tool==="ruler"){ /* ==== WP19 ==== press anchors the click-vs-drag test; a live waypoint chain keeps its pts */
    if(wp19Chain&&ruler&&ruler.pts){ wp19Cursor(ix,iy); drag={mode:"ruler",wp19x:ix,wp19y:iy}; draw(); return; }
    ruler={x0:ix,y0:iy,x1:ix,y1:iy}; drag={mode:"ruler",wp19x:ix,wp19y:iy}; draw(); return;
  } /* ==== end WP19 ==== */
  if(tool==="terrain"){ drag={mode:"terrain",x0:ix,y0:iy,id:uid()}; return; }
  if(tool==="objective"){ const ex=hitObjective(ix,iy); if(ex){op({k:"obj-",id:ex.id});} else op({k:"obj+",obj:{id:uid(),x:ix,y:iy}}); return; }
  if(tool==="los"){ losToolClick(ix,iy); return; } /* ==== WP4: 👁 tool ==== */
  if(tool==="attack"){ wp15ToolClick(ix,iy); return; } /* ==== WP15 ==== two-click attack quick-flow */
  /* ==== WP-B: vehicle rotate handle ==== exactly one shape==="r" token selected: grabbing its
     handle starts a free (or Shift-snapped) drag-to-rotate instead of a move. */
  if(e.button===0){
    const rsel=state.tokens.filter(t=>sel.has(t.id)&&t.shape==="r");
    if(rsel.length===1){
      const rt=rsel[0], [hx,hy]=wpHandlePosIn(rt); // inches — matches ix,iy (both board-space)
      if(Math.hypot(ix-hx,iy-hy)<=10/view.s){ drag={mode:"rotate",id:rt.id}; draw(); return; }
    }
  }
  /* ==== end WP-B ==== */
  // select tool
  const tk=hitToken(ix,iy);
  if(tk){
    if(!sel.has(tk.id)){ if(!e.shiftKey) sel.clear(); sel.add(tk.id); }
    else if(e.shiftKey){ sel.delete(tk.id); draw(); return; }
    tokDragBegin([tk.id],ix,iy); /* ==== WP3D-0: drag extraction ==== was the inline WP-A gate + drag bookkeeping below */
    return;
  }
  const tr=hitTerrain(ix,iy);
  if(tr){
    if(tr.locked){ logSys("That terrain is part of an official layout and is locked in place. Load another layout or Clear table to change it."); return; }
    sel.clear(); sel.add(tr.id); drag={mode:"terrainMove",id:tr.id,lx:ix,ly:iy}; wp3Hide(); /* ==== WP3: inspector ==== */ draw(); return;
  }
  sel.clear(); marquee={x0:ix,y0:iy,x1:ix,y1:iy}; drag={mode:"marquee"}; wp3Hide(); /* ==== WP3: inspector ==== */ draw();
});
window.addEventListener("pointermove",e=>{ /* WP8: was "mousemove" — handler logic unchanged */
  if(wp8PointerMove(e)) return; /* WP8: pinch-zoom in progress */
  if(panning){ view.x+=e.clientX-panning.x; view.y+=e.clientY-panning.y; panning={x:e.clientX,y:e.clientY}; draw(); return; }
  /* ==== WP19 ==== chain live, no button held: the cursor leg follows the hover (sends throttled ≤80ms) */
  if(!drag&&wp19Chain&&ruler&&ruler.pts){
    const rect19=cv.getBoundingClientRect(), [hx,hy]=inch(e.clientX-rect19.left,e.clientY-rect19.top);
    wp19Cursor(hx,hy); wp19Send(); draw(); return;
  }
  /* ==== end WP19 ==== */
  if(!drag) return;
  const rect=cv.getBoundingClientRect(), [ix,iy]=inch(e.clientX-rect.left,e.clientY-rect.top);
  if(drag.mode==="ruler"){
    /* ==== WP19 ==== press while chained: <0.3" keeps tracking the cursor leg; ≥0.3" = a fresh plain drag measure (ends the chain) */
    if(wp19Chain&&ruler&&ruler.pts){
      if(Math.hypot(ix-drag.wp19x,iy-drag.wp19y)<0.3){ wp19Cursor(ix,iy); wp19Send(); draw(); return; }
      wp19End(false); ruler={x0:drag.wp19x,y0:drag.wp19y,x1:ix,y1:iy};
    }
    /* ==== end WP19 ==== */
    ruler.x1=ix; ruler.y1=iy; send({t:"ruler",r:ruler}); draw(); }
  else if(drag.mode==="marquee"){ marquee.x1=ix; marquee.y1=iy; draw(); }
  else if(drag.mode==="tokens"){ tokDragMove(ix,iy); } /* ==== WP3D-0: drag extraction ==== */
  else if(drag.mode==="terrainMove"){
    const t=state.terrain.find(x=>x.id===drag.id); if(!t)return;
    t.x+=ix-drag.lx; t.y+=iy-drag.ly; drag.lx=ix; drag.ly=iy; draw();
  }
  else if(drag.mode==="terrain"){ drag.x1=ix; drag.y1=iy;
    marquee={x0:drag.x0,y0:drag.y0,x1:ix,y1:iy}; draw(); }
  /* ==== WP-B: vehicle rotate handle ==== free (or Shift-snapped 5°) drag-to-rotate; live, uncommitted */
  else if(drag.mode==="rotate"){
    const t=state.tokens.find(x=>x.id===drag.id); if(!t) return;
    let ang=Math.atan2(ix-t.x,-(iy-t.y))*180/Math.PI;
    ang=(ang+360)%360;
    if(e.shiftKey) ang=Math.round(ang/5)*5%360;
    t.rot=ang; draw();
  }
  /* ==== end WP-B ==== */
});
window.addEventListener("pointerup",e=>{ /* WP8: was "mouseup" — handler logic unchanged */
  if(wp8PointerUp(e)) return; /* WP8: pinch end / touch double-tap */
  if(panning){ panning=null; return; }
  if(!drag) return;
  /* ==== WP19 ==== ruler: a press that moved <0.3" is a waypoint click — chain the tape and keep it live */
  if(drag.mode==="ruler"&&ruler&&drag.wp19x!==undefined
     &&Math.hypot(ruler.x1-drag.wp19x,ruler.y1-drag.wp19y)<0.3){
    wp19Click(drag.wp19x,drag.wp19y); drag=null; draw(); return;
  }
  /* ==== end WP19 ==== */
  /* ==== WP3D-0: drag extraction ==== the whole "tokens" case (incl. its own WP5 early-return
     gate, the WP2/coherency/op-commit path, and the click-no-move wp3Inspect() path) now lives
     in tokDragCommit(), which ends with its own wp2DragEnd()/drag=null/draw() — so this branch
     returns instead of falling into the shared tail below. */
  if(drag.mode==="tokens"){ tokDragCommit(); return; }
  if(drag.mode==="marquee"){
    const x0=Math.min(marquee.x0,marquee.x1),x1=Math.max(marquee.x0,marquee.x1),y0=Math.min(marquee.y0,marquee.y1),y1=Math.max(marquee.y0,marquee.y1);
    state.tokens.forEach(t=>{ if(t.x>=x0&&t.x<=x1&&t.y>=y0&&t.y<=y1) sel.add(t.id); });
    marquee=null;
  }
  else if(drag.mode==="terrainMove"){
    const t=state.terrain.find(x=>x.id===drag.id); if(t) op({k:"ter~",ter:{id:t.id,x:t.x,y:t.y}});
  }
  else if(drag.mode==="terrain"&&drag.x1!==undefined){
    const x=Math.min(drag.x0,drag.x1),y=Math.min(drag.y0,drag.y1),w=Math.abs(drag.x1-drag.x0),h=Math.abs(drag.y1-drag.y0);
    if(w>.5&&h>.5) op({k:"ter+",ter:{id:drag.id,kind:document.getElementById("terrKind").value,x,y,w,h,rot:0}});
    marquee=null; setTool("select");
  }
  /* ==== WP-B: vehicle rotate handle ==== commit the live rot via a normal, undoable/synced op */
  else if(drag.mode==="rotate"){
    const t=state.tokens.find(x=>x.id===drag.id);
    if(t) op({k:"tok~",toks:[{id:t.id,rot:t.rot}]});
  }
  /* ==== end WP-B ==== */
  wp2DragEnd(); /* ==== WP2: move measure ==== */
  drag=null; draw();
});
cv.addEventListener("dblclick",e=>{
  /* ==== WP19 ==== ruler tool: double-click ends the waypoint chain (never a wound prompt) */
  if(tool==="ruler"){ wp19End(true); return; }
  /* ==== end WP19 ==== */
  const [ix,iy]=inch(e.offsetX,e.offsetY);
  const tk=hitToken(ix,iy); if(!tk) return;
  const v=prompt(`${tk.name} — wounds remaining (max ${tk.maxW}):`,tk.wounds);
  if(v===null) return;
  op({k:"tok~",toks:[{id:tk.id,wounds:Math.max(0,Math.min(tk.maxW,parseInt(v)||0))}]});
});
window.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&document.getElementById("builderOverlay").classList.contains("open")){ closeBuilder(); return; }
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
  if(e.key==="Delete"||e.key==="Backspace"){
    const tokIds=[...sel].filter(id=>state.tokens.some(t=>t.id===id));
    if(tokIds.length) op({k:"tok-",ids:tokIds});
    state.terrain.filter(t=>sel.has(t.id)&&!t.locked).forEach(t=>op({k:"ter-",id:t.id}));
    state.objectives.filter(o=>sel.has(o.id)).forEach(o=>op({k:"obj-",id:o.id}));
    sel.clear();
    wp3Hide(); /* ==== WP3: inspector ==== */
  }
  else if(e.key==="r"||e.key==="R"){
    state.tokens.filter(t=>sel.has(t.id)&&t.shape==="r").forEach(t=>op({k:"tok~",toks:[{id:t.id,rot:((t.rot||0)+15)%360}]}));
    state.terrain.filter(t=>sel.has(t.id)&&!t.locked).forEach(t=>op({k:"ter~",ter:{id:t.id,rot:((t.rot||0)+15)%360}}));
  }
  else if(e.key==="v"||e.key==="V") setTool("select");
  else if(e.key==="t"||e.key==="T") setTool("ruler");
  else if("1234".includes(e.key)){ const r=RING_SIZES[+e.key-1]; rings = rings===r?0:r; draw(); }
  else if(e.key==="w"||e.key==="W"){
    const toks=state.tokens.filter(t=>sel.has(t.id));
    if(toks.length){
      const v=prompt("Weapon/role tag for the selected model(s) — up to 4 characters, blank to clear:",toks[0].tag||"");
      if(v!==null) op({k:"tok~",toks:toks.map(t=>({id:t.id,tag:v.trim().slice(0,4)}))});
    }
  }
  else if(e.key==="h"||e.key==="H"){ toggleHidden(); } /* ==== WP4: Hidden toggle ==== */
  else if(e.key==="f"||e.key==="F"){ cycleFloor(); } /* ==== WP5: floor level ==== */
  else if(e.key==="Escape"){ sel.clear(); wp19End(true); /* ==== WP19 ==== end the waypoint chain + final send */ ruler=null; losSrc=null; /* WP4 */ wp3CancelAim(); wp3Hide(); /* ==== WP3: inspector ==== */ wp15Disarm(); /* ==== WP15 ==== drop the armed attacker */ wpCapMode=null; /* ==== WP-FIGHT: drop any armed pile-in/consolidate ==== */ draw(); }
});

/* ==== WP1: resilience — autosave, resume, reconnect, undo ==== */
const WP1_AUTOSAVE_KEY="wh40k_autosave", WP1_ROOM_KEY="wh40k_room", WP1_UNDO_DEPTH=30;
let wp1SaveTimer=null, wp1UndoStack=[], wp1Pending=null, wp1Batch=false, wp1SkipSnap=false, wp1ReTries=0, wp1ReTimer=null;
// Fill defaults so old saves / partial states never crash anything (back-compat, invariant §1.1.4).
function wp1Compat(st){
  st=st||{};
  st.board=st.board||{w:60,h:44};
  st.tokens=st.tokens||[]; st.terrain=st.terrain||[]; st.objectives=st.objectives||[];
  st.dz=st.dz||[]; st.sec=st.sec||[]; if(st.mission===undefined)st.mission=null;
  st.trackers=Object.assign({round:1,cp1:0,cp2:0,vp1:0,vp2:0},st.trackers||{});
  st.names=Object.assign({1:"Player 1",2:"Player 2"},st.names||{});
  st.cards=st.cards||{1:[],2:[]};
  if(typeof wp7Compat==="function") wp7Compat(st); /* ==== WP7: phases ==== reserves/phase defaults so old saves and syncs load fine (guard: WP1 block is unit-tested standalone) */
  return st;
}
/* ---- autosave (debounced; called from applyOp after every op) ---- */
function wp1Autosave(){
  wp1Pending=null; // an applied op invalidates any pre-gesture snapshot not yet consumed
  clearTimeout(wp1SaveTimer);
  wp1SaveTimer=setTimeout(()=>{
    try{ localStorage.setItem(WP1_AUTOSAVE_KEY,JSON.stringify({v:1,ts:Date.now(),side:mySide,state})); }
    catch(e){ /* storage full or blocked — autosave is best-effort */ }
  },400);
}
/* ---- room persistence + reconnect ---- */
function wp1SaveRoom(code,host){ try{ localStorage.setItem(WP1_ROOM_KEY,JSON.stringify({code,host:!!host,ts:Date.now()})); }catch(e){} }
function wp1Room(){ try{ return JSON.parse(localStorage.getItem(WP1_ROOM_KEY)||"null"); }catch(e){ return null; } }
function wp1HostCode(){ // reuse the last hosted code (≤12h old) so "Reconnect"/re-Host lands in the same room
  const r=wp1Room();
  if(r&&r.host&&r.code&&Date.now()-(r.ts||0)<12*36e5){ wp1SaveRoom(r.code,true); return r.code; }
  const code="wh40k-"+(typeof secCode==="function"?secCode(10):Math.random().toString(36).slice(2,12)); /* SEC: crypto-strength, ~50 bits — not guessable (typeof guard: WP1 block runs standalone in tests) */
  wp1SaveRoom(code,true); return code;
}
function wp1ShowReconnect(show){ const b=document.getElementById("btnReconnect"); if(b) b.style.display=show?"":"none"; }
function wp1OnConnect(){ wp1ReTries=0; clearTimeout(wp1ReTimer); wp1ShowReconnect(false); const r=wp1Room(); if(r) wp1SaveRoom(r.code,r.host); /* refresh ts */ }
function wp1OnDisconnect(){
  if(wp1Room()) wp1ShowReconnect(true);
  if(isHost) logSys("Still hosting the same room — your opponent can hit ⟳ Reconnect (or Join with the same code).");
}
function wp1PeerError(e){
  if(e&&e.type==="unavailable-id"){ try{ localStorage.removeItem(WP1_ROOM_KEY); }catch(err){} logSys("That room code is still registered elsewhere (old tab?). Click Host for a fresh code."); }
  else if(wp1Room()) wp1ShowReconnect(true);
}
function wp1Reconnect(){
  const r=wp1Room();
  if(!r||!r.code){ logSys("No previous room on record — use Host or Join."); wp1ShowReconnect(false); return; }
  if(conn&&conn.open){ wp1ShowReconnect(false); return; }
  if(r.host){
    // Host path: keep (or recreate) the Peer under the SAME code; full state re-sends on connection open (wireConn).
    if(peer&&!peer.destroyed&&!peer.disconnected){
      setConn(false,"Room "+r.code.replace("wh40k-","").toUpperCase()+" — waiting…");
      logSys("Still hosting room "+r.code.replace("wh40k-","").toUpperCase()+" — waiting for your opponent to rejoin.");
      return;
    }
    if(peer){ try{ peer.destroy(); }catch(e){} peer=null; }
    hostGame(); // wp1HostCode() reuses the saved code
  } else {
    if(peer){ try{ peer.destroy(); }catch(e){} peer=null; }
    setConn(false,"Rejoining…");
    peer=new Peer();
    peer.on("open",()=>{ conn=peer.connect(r.code,{reliable:true}); wireConn(); });
    peer.on("error",e=>{ setConn(false,"Error"); logSys("Reconnect failed: "+e.type); wp1PeerError(e); wp1GuestRetry(); });
  }
}
function wp1GuestRetry(){ // automatic retries while the host re-hosts
  if(conn&&conn.open) return;
  if(wp1ReTries>=5){ logSys("Gave up after 5 attempts — click ⟳ Reconnect to try again."); wp1ReTries=0; return; }
  wp1ReTries++;
  clearTimeout(wp1ReTimer);
  wp1ReTimer=setTimeout(()=>{ if(!(conn&&conn.open)){ logSys("Retrying reconnect… ("+wp1ReTries+"/5)"); wp1Reconnect(); } },3000);
}
/* ---- undo: ring buffer of pre-op snapshots, Ctrl/Cmd+Z, broadcast restore ---- */
function wp1PreMutate(){ wp1Pending=JSON.stringify(state); } // gesture start: state not yet mutated by the drag
function wp1Snapshot(){ // called by op() BEFORE the local apply; bursts in one tick = one undo step
  if(wp1SkipSnap||wp1Batch) return;
  wp1Batch=true; setTimeout(()=>{ wp1Batch=false; },0);
  const snap=wp1Pending!==null?wp1Pending:JSON.stringify(state);
  wp1Pending=null;
  wp1UndoStack.push(snap);
  if(wp1UndoStack.length>WP1_UNDO_DEPTH) wp1UndoStack.shift();
}
function wp1Undo(){
  if(typeof aiInterrupt==="function") aiInterrupt(); /* ==== WP10: ai ==== undo mid-AI-turn cancels the AI's action chain */
  if(!wp1UndoStack.length){ logSys("Nothing to undo."); return; }
  const snap=wp1UndoStack.pop();
  wp1SkipSnap=true;
  try{ op({k:"restore",state:JSON.parse(snap)}); } finally{ wp1SkipSnap=false; }
  wp1Pending=null;
  logShared("↶ <b>"+esc(myName)+"</b> undid the last action","sys");
}
function wp1ApplyRestore(st){ // idempotent full-state replace (undo on either peer; both converge)
  state=wp1Compat(JSON.parse(JSON.stringify(st)));
  sel.clear(); refreshTrackers(); renderCards(); // draw() runs at the end of applyOp
}
window.addEventListener("keydown",e=>{ /* WP1: Ctrl/Cmd+Z = undo (own listener; shared handler untouched) */
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&(e.key==="z"||e.key==="Z")){
    if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
    e.preventDefault(); wp1Undo();
  }
});
/* ---- resume prompt (runs once at startup, after init) ---- */
function wp1MaybeResume(){
  let auto=null; try{ auto=JSON.parse(localStorage.getItem(WP1_AUTOSAVE_KEY)||"null"); }catch(e){}
  if(!auto||!auto.state) return;
  const st=auto.state;
  if(!((st.tokens&&st.tokens.length)||(st.terrain&&st.terrain.length)||(st.sec&&st.sec.length))) return; // trivial — skip
  const mins=Math.max(0,Math.round((Date.now()-(auto.ts||0))/6e4));
  const age=mins<1?"moments":mins<60?mins+" min":Math.round(mins/60)+" h";
  const r=wp1Room();
  let msg="Resume last game? ("+(st.tokens?st.tokens.length:0)+" models on the table, saved "+age+" ago)";
  if(r) msg+="\n\nRoom "+r.code.replace("wh40k-","").toUpperCase()+" — after resuming, click ⟳ Reconnect to relink with your opponent.";
  if(confirm(msg)){
    state=wp1Compat(st);
    if(auto.side===1||auto.side===2){ mySide=auto.side; const s=document.getElementById("mySide"); if(s) s.value=String(mySide); }
    refreshTrackers(); renderCards(); fitView();
    if(r) wp1ShowReconnect(true);
    logSys("Game restored from autosave."+(r&&r.host?" Hosting again reuses room "+r.code.replace("wh40k-","").toUpperCase()+".":""));
  } else {
    try{ const cur=localStorage.getItem(WP1_AUTOSAVE_KEY); if(cur) localStorage.setItem(WP1_AUTOSAVE_KEY+"_prev",cur); }catch(e){} // one-shot backup
    try{ localStorage.removeItem(WP1_AUTOSAVE_KEY); }catch(e){}
  }
}
/* ==== end WP1 ==== */

/* ==== WP6: objectives — OC auto-scoring, battle-shock, secured markers ==== */
const WP6_P1="#d84a4a", WP6_P2="#4a8fd8";
let wp6LastRound=null, wp6PanelSig=null;
// Sum each side's OC within 3" (marker edge to base edge, horizontal). Battle-shocked (bs) units count 0.
// holder: higher OC wins; on a tie (incl. 0–0) a manually-set "secured" side (o.sec) keeps it — sticky control.
function wp6Tallies(){
  const mR=mmIn(40)/2;
  return state.objectives.map(o=>{
    let oc1=0,oc2=0;
    state.tokens.forEach(t=>{
      if(t.bs) return;
      if(Math.hypot(t.x-o.x,t.y-o.y)-mR-tokRadius(t)<=3.02){
        if(t.owner===1) oc1+=(+t.OC||0); else oc2+=(+t.OC||0); /* WP0 tokens carry OC; legacy tokens count 0 */
      }
    });
    const holder=oc1>oc2?1:oc2>oc1?2:((o.sec===1||o.sec===2)?o.sec:0);
    return {o,oc1,oc2,holder};
  });
}
function wp6Overlay(){ // called from draw(): glow + tallies over the board, then side-panel + round log
  const tallies=wp6Tallies();
  tallies.forEach(({o,oc1,oc2,holder})=>{
    const [ox,oy]=px(o.x,o.y), r=mmIn(40)/2*view.s;
    if(holder){
      const col=holder===1?WP6_P1:WP6_P2;
      ctx.beginPath(); ctx.arc(ox,oy,r+3,0,7); ctx.strokeStyle=col; ctx.lineWidth=3; ctx.stroke();
      ctx.beginPath(); ctx.arc(ox,oy,r+6.5,0,7); ctx.globalAlpha=.35; ctx.lineWidth=4; ctx.stroke(); ctx.globalAlpha=1;
    }
    if(o.sec===1||o.sec===2){ // sticky "secured" flag (manual toggle — right-click the marker)
      ctx.font="bold "+Math.max(9,view.s*.5)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="top";
      ctx.fillStyle=o.sec===1?WP6_P1:WP6_P2; ctx.fillText("⚑",ox,oy+r+2);
    }
    if(oc1||oc2||holder){ // OC tally beside the marker
      ctx.font="bold "+Math.max(10,view.s*.55)+"px sans-serif"; ctx.textBaseline="middle";
      const s1=String(oc1),s2=String(oc2),dash="–";
      const w1=ctx.measureText(s1).width,wd=ctx.measureText(dash).width,w2=ctx.measureText(s2).width;
      const total=w1+wd+w2, tx0=ox-total/2, ty=oy-r-Math.max(8,view.s*.45);
      ctx.fillStyle="rgba(16,18,22,.8)"; ctx.fillRect(tx0-3,ty-Math.max(7,view.s*.38),total+6,Math.max(14,view.s*.76));
      ctx.textAlign="left";
      ctx.fillStyle=WP6_P1; ctx.fillText(s1,tx0,ty);
      ctx.fillStyle="#9aa3ad"; ctx.fillText(dash,tx0+w1,ty);
      ctx.fillStyle=WP6_P2; ctx.fillText(s2,tx0+w1+wd,ty);
    }
  });
  // grey skull badge on battle-shocked models (drawn over tokens; screen-space, no rotation issues)
  state.tokens.forEach(t=>{
    if(!t.bs) return;
    const [tx,ty]=px(t.x,t.y), rr=tokRadius(t)*view.s, br=Math.max(6,view.s*.4);
    ctx.beginPath(); ctx.arc(tx-rr*.75,ty-rr*.75,br,0,7); ctx.fillStyle="#565d66"; ctx.fill();
    ctx.strokeStyle="#22262d"; ctx.lineWidth=1; ctx.stroke();
    ctx.font=(br*1.4)+"px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("💀",tx-rr*.75,ty-rr*.75+.5);
  });
  wp6Panel(tallies);
  wp6RoundLog(tallies);
}
function wp6Panel(tallies){ // Cards-tab list of each objective + holder; DOM touched only when something changed
  const el=document.getElementById("wp6ObjPanel"); if(!el) return;
  const sig=JSON.stringify([tallies.map(x=>[x.oc1,x.oc2,x.holder,x.o.sec||0]),state.names,state.trackers.round]);
  if(sig===wp6PanelSig) return;
  wp6PanelSig=sig;
  if(!tallies.length){ el.innerHTML=""; return; }
  const nm=s=>esc((state.names&&state.names[s])||("Player "+s));
  el.innerHTML='<div class="card" style="padding:8px;margin-top:6px"><b>Objective control</b> <span class="small">(OC within 3", battle-shocked = 0; right-click a marker to mark it Secured ⚑)</span>'+
    tallies.map((x,i)=>{
      const col=x.holder===1?"var(--p1)":x.holder===2?"var(--p2)":"var(--dim)";
      const who=x.holder?nm(x.holder):(x.oc1||x.oc2?"contested":"—");
      return `<div style="display:flex;justify-content:space-between;margin-top:3px"><span>◎ ${i+1}${(x.o.sec===1||x.o.sec===2)?' <span style="color:'+(x.o.sec===1?"var(--p1)":"var(--p2)")+'">⚑</span>':''}</span><span><b style="color:${col}">${who}</b> <span class="small">${x.oc1}–${x.oc2}</span></span></div>`;
    }).join("")+"</div>";
}
function wp6RoundLog(tallies){ // end-of-turn summary when the round tracker advances (each peer logs locally)
  const rd=(state.trackers&&state.trackers.round)||1;
  if(wp6LastRound===null){ wp6LastRound=rd; return; }
  if(rd===wp6LastRound) return;
  const prev=wp6LastRound; wp6LastRound=rd;
  if(rd<prev) return; // round corrected downwards — no summary
  const n1=tallies.filter(x=>x.holder===1).length, n2=tallies.filter(x=>x.holder===2).length;
  const nm=s=>esc((state.names&&state.names[s])||("Player "+s));
  if(tallies.length) logEntry(`⚑ End of round ${prev}: <b style="color:var(--p1)">${nm(1)}</b> holds ${n1}, <b style="color:var(--p2)">${nm(2)}</b> holds ${n2}`,"sys");
}
function wp6ToggleShock(){ // B: toggle battle-shock on every unit with a selected model (syncs via tok~)
  const units=new Set(state.tokens.filter(t=>sel.has(t.id)).map(t=>t.unit));
  if(!units.size) return;
  units.forEach(uk=>{
    const ms=state.tokens.filter(t=>t.unit===uk); if(!ms.length) return;
    const now=!ms[0].bs;
    op({k:"tok~",toks:ms.map(t=>({id:t.id,bs:now}))});
    logShared("💀 <b>"+esc(myName)+"</b>: "+esc(ms[0].name)+(now?" is <b>battle-shocked</b> (OC 0)":" rallied — battle-shock cleared"),"sys");
  });
}
window.addEventListener("keydown",e=>{ /* WP6: B = battle-shock toggle (own listener; shared handler untouched) */
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
  if(e.key==="b"||e.key==="B") wp6ToggleShock();
});
cv.addEventListener("contextmenu",e=>{ /* WP6: right-click an objective cycles Secured: none → red → blue */
  const [ix,iy]=inch(e.offsetX,e.offsetY);
  if(hitToken(ix,iy)) return; /* ==== WP13 ==== the token action menu owns right-click on models */
  const o=hitObjective(ix,iy); if(!o) return;
  wp16CycleSec(o); /* ==== WP16 ==== cycle body factored out so the touch long-press path shares it ==== end WP16 ==== */
});
(function(){ // objective-control panel lives under the primary-mission card in the Cards tab
  const mi=document.getElementById("missionInfo"); if(!mi) return;
  const d=document.createElement("div"); d.id="wp6ObjPanel";
  mi.parentNode.insertBefore(d,mi.nextSibling);
})();
/* ==== end WP6 ==== */

/* ==== WP8: hardening — touch input, side claiming, spectator safety, perf ==== */
cv.style.touchAction="none"; // stop iPad Safari from scrolling/zooming the page instead of the board
document.head.insertAdjacentHTML("beforeend",
  "<style>@media(pointer:coarse){#toolbar button{min-width:44px;min-height:44px;font-size:20px}#topbar button{min-height:34px;min-width:30px}}</style>");
/* ---- multi-touch: pinch-zoom, long-press pan, double-tap wounds ---- */
let wp8Ptrs=new Map(), wp8Pinch=null, wp8LPTimer=null, wp8LastTap=null;
function wp8PointerDown(e){ // returns true when the main pointerdown handler must skip this event
  if(e.pointerType==="mouse") return false;
  e.preventDefault(); // suppress compatibility mouse events — touch is handled purely via pointers
  wp8Ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,t0:Date.now()});
  if(wp8Ptrs.size===2){ // second finger: abandon any single-finger gesture, start pinch-zoom
    clearTimeout(wp8LPTimer);
    drag=null; marquee=null; panning=null; ruler=null;
    const p=[...wp8Ptrs.values()];
    wp8Pinch={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),cx:(p[0].x+p[1].x)/2,cy:(p[0].y+p[1].y)/2};
    draw();
    return true;
  }
  if(wp8Ptrs.size>2||wp8Pinch) return true; // ignore extra fingers
  // single touch: arm long-press → pan (only when the press would otherwise start a marquee)
  clearTimeout(wp8LPTimer);
  const pid=e.pointerId;
  wp8LPTimer=setTimeout(()=>{
    const p=wp8Ptrs.get(pid);
    if(!p||Math.hypot(p.x-p.sx,p.y-p.sy)>=8) return;
    if(drag&&drag.mode==="marquee"){
      /* ==== WP16 ==== long-press on an objective (no token under the finger) cycles Secured — the touch mirror of right-click */
      if(typeof hitObjective==="function"&&typeof wp16CycleSec==="function"){
        const rect16=cv.getBoundingClientRect(), [ox,oy]=inch(p.x-rect16.left,p.y-rect16.top);
        if(!hitToken(ox,oy)){
          const o=hitObjective(ox,oy);
          if(o){ drag=null; marquee=null; wp16CycleSec(o); draw(); return; }
        }
      }
      /* ==== end WP16 ==== */
      drag=null; marquee=null; panning={x:p.x,y:p.y}; draw(); return;
    }
    /* ==== WP13 ==== long-press ON a model = action menu (finger jitter under 8px is undone) */
    if(drag&&drag.mode==="tokens"){
      (drag.snap||[]).forEach(s=>{ const t=state.tokens.find(x=>x.id===s.id); if(t){ t.x=s.x; t.y=s.y; } });
      const rect=cv.getBoundingClientRect(), [ix,iy]=inch(p.x-rect.left,p.y-rect.top);
      const tk=hitToken(ix,iy);
      if(tk){ if(typeof wp2DragEnd==="function") wp2DragEnd(); drag=null; wp13MenuOpen(tk,p.x,p.y); draw(); }
    }
    /* ==== end WP13 ==== */
  },450);
  return false;
}
function wp8PointerMove(e){ // returns true while a pinch owns the gesture
  const p=wp8Ptrs.get(e.pointerId);
  if(p){ p.x=e.clientX; p.y=e.clientY; }
  if(!wp8Pinch) return false;
  if(wp8Ptrs.size>=2){
    const q=[...wp8Ptrs.values()];
    const d=Math.hypot(q[0].x-q[1].x,q[0].y-q[1].y), cx=(q[0].x+q[1].x)/2, cy=(q[0].y+q[1].y)/2;
    if(d>0&&wp8Pinch.d>0){
      const rect=cv.getBoundingClientRect();
      const [ix,iy]=inch(wp8Pinch.cx-rect.left,wp8Pinch.cy-rect.top); // board point under the old midpoint
      view.s=Math.max(3,Math.min(60,view.s*(d/wp8Pinch.d)));
      view.x=(cx-rect.left)-ix*view.s; view.y=(cy-rect.top)-iy*view.s;   // …lands under the new midpoint
    }
    wp8Pinch={d,cx,cy};
    draw();
  }
  return true;
}
function wp8PointerUp(e){ // returns true when the main pointerup handler must skip this event
  const p=wp8Ptrs.get(e.pointerId);
  wp8Ptrs.delete(e.pointerId);
  clearTimeout(wp8LPTimer);
  if(wp8Pinch){ if(wp8Ptrs.size<2) wp8Pinch=null; drag=null; marquee=null; return true; }
  if(p&&e.pointerType!=="mouse"){ // tap bookkeeping → double-tap = wounds prompt (dblclick may not fire for touch)
    const now=Date.now();
    if(Math.hypot(e.clientX-p.sx,e.clientY-p.sy)<10&&now-p.t0<350){
      if(wp8LastTap&&now-wp8LastTap.t<350&&Math.hypot(e.clientX-wp8LastTap.x,e.clientY-wp8LastTap.y)<24){
        wp8LastTap=null;
        const rect=cv.getBoundingClientRect(), [ix,iy]=inch(e.clientX-rect.left,e.clientY-rect.top);
        drag=null; marquee=null; wp8WoundPrompt(ix,iy); draw();
        return true;
      }
      wp8LastTap={t:now,x:e.clientX,y:e.clientY};
    } else wp8LastTap=null;
  }
  return false;
}
function wp8WoundPrompt(ix,iy){ // touch mirror of the desktop dblclick handler
  /* ==== WP19 ==== ruler tool: a double-tap ends the waypoint chain, mirroring the desktop dblclick */
  if(tool==="ruler"){ if(typeof wp19End==="function") wp19End(true); return; }
  /* ==== end WP19 ==== */
  const tk=hitToken(ix,iy); if(!tk) return;
  const v=prompt(`${tk.name} — wounds remaining (max ${tk.maxW}):`,tk.wounds);
  if(v===null) return;
  op({k:"tok~",toks:[{id:tk.id,wounds:Math.max(0,Math.min(tk.maxW,parseInt(v)||0))}]});
}
window.addEventListener("pointercancel",e=>{ // OS stole the gesture — reset everything cleanly
  wp8Ptrs.delete(e.pointerId); clearTimeout(wp8LPTimer);
  if(wp8Ptrs.size<2) wp8Pinch=null;
  drag=null; marquee=null; panning=null; draw();
});
/* ---- side claiming: no more two Reds ---- */
function wp8SideClaim(m){ // called from onMsg "hello"
  if(m.side!==mySide) return;
  if(isHost){ state.names[mySide]=myName; refreshTrackers(); } // host keeps its claim; guest will flip
  else{
    mySide=(mySide===1?2:1);
    const s=document.getElementById("mySide"); if(s) s.value=String(mySide);
    setTimeout(()=>{ op({k:"name",side:mySide,name:myName}); if(myArmy.length) broadcastCards(); /* ==== WP23 ==== flipped guest re-homes its synced cards under its new side; the contested slot is the HOST's — never cleared — and every on-table token is the host's after the full-state sync, so no re-owning here ==== end WP23 ==== */ },300); // after the host's full-state sync lands
    logSys("⚠ Both players had picked the same side — you are now "+(mySide===1?"Red (P1)":"Blue (P2)")+". Change it in Setup if needed.");
  }
}
/* ---- perf: memoized coherency (draw() ran O(n²) every frame, incl. pan/zoom) ---- */
let wp8CohSig=null;
function wp8Coherency(){
  const T=state.tokens; let h=T.length|0;
  for(let i=0;i<T.length;i++){ const t=T[i];
    h=(Math.imul(h,31)+(t.x*1000|0))|0;
    h=(Math.imul(h,31)+(t.y*1000|0))|0;
    h=(Math.imul(h,31)+((t.rot||0)*10|0))|0; /* ==== WP22 ==== edgeDist now honors rect rotation, so rotating a hull must re-run coherency (the old edgeDist was rotation-invariant, so rot was safely absent from this signature) ==== end WP22 ==== */
    const u=t.unit||""; for(let j=0;j<u.length;j++) h=(Math.imul(h,31)+u.charCodeAt(j))|0;
  }
  if(h!==wp8CohSig){ wp8CohSig=h; checkCoherency(); }
}
/* ==== end WP8 ==== */

/* ==== WP7: phases — turn/phase engine, reserves tray, attached units ==== */
const WP7_PHASES=["Command","Movement","Shooting","Charge","Fight","End"];
/* ==== WP-END: end of the game ==== 11th ed is played over five battle rounds ("Usually 5 battle
   rounds" — ../Notes/11th Edition Core Rules - Study Notes.md L28). The phase stepper still lets the
   round counter tick past 5 (headless drivers loop until round>5), but the app now (a) refuses to
   grant the automatic Command-phase +1 CP once the game is over — killing the old phantom round-6
   CP artifact — and (b) shows an explicit "Game over" cue instead of a bogus round-6 Command. */
const WP7_LAST_ROUND=5;
const wpGameOver=()=>(((state.trackers&&state.trackers.round)||1)>WP7_LAST_ROUND);
let wp7OverLogged=false;      // client-local one-shot for the end-of-game summary (mirrors wp6LastRound)
let wp7Placing=null;          // {id} of the reserves entry being placed (click the board to arrive)
let wp7TrayOpen=true, wp7UiSig=null;

/* ==== WP-RULES: CP economy / core stratagems / per-phase reminders ==== bounded rules-aid layer —
   tracker + reminders only, NEVER effect prose. Game-functional data ONLY: names, CP costs, the
   phase they're used in. Where an effect matters, it's a user-editable note (see wpRulesNotes),
   never shipped text. */
const WP_RULES_PHASE_TAGS=["command","movement","shooting","charge","fight","end"]; // index-matches WP7_PHASES
const CORE_STRATS=[ // the universal Core Stratagems — name, CP cost, phase tag only
  {name:"Command Re-roll",   cp:1, phase:"any"},
  {name:"Counter-offensive", cp:2, phase:"fight"},
  {name:"Epic Challenge",    cp:1, phase:"fight"},
  {name:"Insane Bravery",    cp:1, phase:"command"},
  {name:"Grenade",           cp:1, phase:"shooting"},
  {name:"Tank Shock",        cp:1, phase:"charge"},
  {name:"Fire Overwatch",    cp:1, phase:"movement"},
  {name:"Rapid Ingress",     cp:1, phase:"end"},
  {name:"Go to Ground",      cp:1, phase:"shooting"},
  {name:"Smokescreen",       cp:1, phase:"shooting"},
  {name:"Heroic Intervention",cp:1, phase:"charge"},
];
function wpRulesStratsForPhase(ph){
  const tag=WP_RULES_PHASE_TAGS[ph];
  if(!tag) return CORE_STRATS.slice();
  return CORE_STRATS.filter(s=>s.phase==="any"||s.phase===tag);
}
function wpRulesUseStrat(name){
  const s=CORE_STRATS.find(x=>x.name===name); if(!s) return;
  const key="cp"+mySide, have=(state.trackers&&state.trackers[key])||0;
  if(have<s.cp){ logSys(`Not enough CP for ${s.name} — need ${s.cp}, you have ${have}.`); return; }
  state.trackers[key]=have-s.cp;
  refreshTrackers();
  op({k:"track",trackers:state.trackers});
  logShared(`· <b>${esc(myName)}</b> used <b>${esc(s.name)}</b> (${s.cp}CP)`,"sys");
}
function wpRulesRenderStrats(){
  const el=document.getElementById("wpRulesStrats"); if(!el) return;
  const ph=(state.phase&&typeof state.phase.ph==="number")?state.phase.ph:-1;
  const list=wpRulesStratsForPhase(ph);
  el.innerHTML=list.length?list.map(s=>
    `<button onclick="wpRulesUseStrat(${JSON.stringify(s.name)})" title="${s.phase==="any"?"Any phase":esc(WP7_PHASES[WP_RULES_PHASE_TAGS.indexOf(s.phase)])+" phase"}">${esc(s.name)} · ${s.cp}CP</button>`
  ).join("") : `<span class="small">No Core Stratagems for this phase.</span>`;
}
// Per-phase reminder banner: dismissible, game-functional cues only (no rules prose).
const WP_RULES_REMINDERS=[
  "Gain 1 CP · Battle-shock tests for units at half strength or less",
  "Normal/Advance moves · Reserves may arrive · Fall Back available",
  "Shooting attacks · the non-active player may Fire Overwatch",
  "Charges · the non-active player may Fire Overwatch",
  "Fight — pile in, resolve attacks, then consolidate",
  "End of turn — Rapid Ingress may be used",
];
function wpRulesSideIsSM(side){ // best-effort: any card/token on this side carrying the SPACE MARINES keyword
  try{
    const cards=side===mySide?myArmy.map(migrateCard):((state.cards&&state.cards[side])||[]);
    if(cards.some(c=>(c.kw||[]).some(k=>/SPACE MARINES/i.test(String(k))))) return true;
    return state.tokens.some(t=>t.owner===side&&tokKw(t).includes("SPACE MARINES"));
  }catch(e){ return false; }
}
function wpRulesReminderText(ph,side){
  let t=WP_RULES_REMINDERS[ph]||"";
  // WP-END: most primaries score in the Command phase from battle round 2 (progressive scoring —
  // the mission deck has the exact VP). A neutral coaching nudge, no rules prose.
  if(ph===0){ const rd=(state.trackers&&state.trackers.round)||1; if(rd>=2&&rd<=WP7_LAST_ROUND) t+=" · score your primary (use the VP steppers)"; }
  if(ph===0&&wpRulesSideIsSM(side)) t+=" · Oath of Moment: pick a target (Space Marines)";
  return t;
}
function wpRulesShowReminder(){
  const el=document.getElementById("wpRulesReminder"); if(!el) return;
  const p=(state.phase&&typeof state.phase==="object")?state.phase:{ph:-1,side:1};
  if(wpGameOver()){ el.innerHTML=`<span>🏁 The game has ended — battle round ${WP7_LAST_ROUND} complete. Tally the final scores in the Cards tab.</span> <button onclick="document.getElementById('wpRulesReminder').style.display='none'">✕</button>`; el.style.display="block"; return; } /* WP-END */
  if(typeof p.ph!=="number"||p.ph<0){ el.style.display="none"; return; }
  el.innerHTML=`<span>${esc(WP7_PHASES[p.ph]||"")}: ${esc(wpRulesReminderText(p.ph,p.side))}</span> <button onclick="document.getElementById('wpRulesReminder').style.display='none'">✕</button>`;
  el.style.display="block";
}
// Per-detachment / faction notes: purely user-entered, localStorage only, never synced or shipped.
let wpRulesNotes=(typeof localStorage!=="undefined"&&localStorage.getItem("wh40k_detachment_notes"))||"";
function wpRulesSaveNotes(){
  const el=document.getElementById("wpRulesNotes"); if(!el) return;
  wpRulesNotes=el.value;
  try{ localStorage.setItem("wh40k_detachment_notes",wpRulesNotes); }catch(e){}
}
function wpRulesLoadNotes(){
  const el=document.getElementById("wpRulesNotes"); if(el) el.value=wpRulesNotes;
}
/* ==== end WP-RULES ==== */
/* ---- back-compat defaults (called from wp1Compat on every load/sync/restore) ---- */
function wp7Compat(st){
  st.reserves=st.reserves||{1:[],2:[]};
  if(!st.reserves[1]) st.reserves[1]=[];
  if(!st.reserves[2]) st.reserves[2]=[];
  if(!st.phase||typeof st.phase!=="object") st.phase={side:1,ph:-1,cpDone:{}};
  if(typeof st.phase.ph!=="number") st.phase.ph=-1;
  if(st.phase.side!==1&&st.phase.side!==2) st.phase.side=1;
  if(!st.phase.cpDone) st.phase.cpDone={};
  return st;
}
/* ---- phase engine ---- */
// The stepper is a convenience, not a cage: it only ever routes through ops, and every
// manual override (Round/CP/VP buttons, stepTracker) keeps working alongside it.
function wp7Step(dir){
  const p=(state.phase&&typeof state.phase==="object")?state.phase:{side:1,ph:-1};
  let ph=typeof p.ph==="number"?p.ph:-1, side=p.side===2?2:1, round=(state.trackers&&state.trackers.round)||1;
  if(dir>0){
    if(ph<0){ ph=0; side=1; }                                  // Deploy → first Command phase (current round)
    else if(ph>=5){ ph=0; if(side===2){ side=1; round++; } else side=2; } // End → next player's Command; new round after player 2
    else ph++;
  } else {
    if(ph<0){ logSys("Already at Deploy — nothing before the game starts."); return; }
    if(ph===0){
      if(side===2){ side=1; ph=5; }
      else if(round>1){ round--; side=2; ph=5; }
      else ph=-1;                                              // back to Deploy
    } else ph--;
  }
  op({k:"phase",ph,side,round});
  const nm=s=>esc((state.names&&state.names[s])||("Player "+s));
  // WP-END: past round 5 the game is over — wp7ApplyPhase logs the end-of-game summary instead of
  // a bogus "Round 6 · Command phase" transition line.
  if(round>WP7_LAST_ROUND){ /* game over — no phase-transition line */ }
  else if(ph>=0) logShared(`⏵ Round ${round} · <b style="color:${side===1?"var(--p1)":"var(--p2)"}">${nm(side)}</b> — <b>${WP7_PHASES[ph]} phase</b>`,"sys");
  else logShared("⏵ Back to Deploy (pre-game)","sys");
}
function wp7ApplyPhase(o){ // applyOp case "phase": runs identically on both peers; idempotent
  wp7Compat(state);
  const prevPh=state.phase.ph; /* ==== WP-A ==== */
  state.phase.ph=o.ph; state.phase.side=o.side===2?2:1;
  /* ==== WP-A: structured movement ==== entering OR leaving the Movement phase clears the
     move-once lock, done-flags and snap-back snapshots — a fresh phase, a fresh start. */
  if(((o.ph===1&&prevPh!==1)||(prevPh===1&&o.ph!==1))&&typeof wpResetMove==="function") wpResetMove();
  /* ==== end WP-A ==== */
  /* ==== WP-FIGHT: a fresh Movement phase (new turn) clears every unit's Fall Back flag — direct
     mutation, not a nested op, because this function already runs identically on both peers from
     the synced "phase" op (same pattern as the CP auto-grant a few lines down). */
  if(o.ph===1&&prevPh!==1) state.tokens.forEach(t=>{ if(t.fellBack) t.fellBack=false; if(t.advanced) t.advanced=false; /* ==== WP-FIGHT (P2-3): Advance flag shares Fall Back's fresh-Movement-phase reset ==== */ });
  // any phase change drops an armed pile-in/consolidate — client-local UI state, not synced
  if(o.ph!==prevPh) wpCapMode=null;
  /* ==== end WP-FIGHT ==== */
  if(typeof o.round==="number"&&state.trackers&&o.round!==state.trackers.round)
    state.trackers.round=Math.max(1,o.round); // WP6's end-of-round log picks this up in draw() — exactly once
  if(o.ph===0&&!wpGameOver()){
    // auto +1 CP to both on entering a Command phase — exactly once per (round, side), ever.
    // WP-END: never past round 5 — that used to grant a phantom round-6 CP to both sides.
    const key=(((state.trackers&&state.trackers.round)||1)+":"+state.phase.side);
    if(!state.phase.cpDone[key]){
      state.phase.cpDone[key]=1;
      state.trackers.cp1=(state.trackers.cp1||0)+1;
      state.trackers.cp2=(state.trackers.cp2||0)+1;
      logSys("Command phase: +1 CP to both players (auto — adjust with the CP buttons if needed).");
      wp7ShockReminder();
    }
  }
  /* ==== WP-END ==== once the game is over, announce it once (each peer logs locally, like the
     WP6 end-of-round summary); reset the one-shot if the round is stepped back into play. */
  if(wpGameOver()){
    if(!wp7OverLogged){
      wp7OverLogged=true;
      const tr=state.trackers||{}, v1=tr.vp1||0, v2=tr.vp2||0, nm=s=>esc((state.names&&state.names[s])||("Player "+s));
      const verdict=v1===v2?`a draw, ${v1}–${v2}`:(v1>v2?`${nm(1)} ${v1}–${v2}`:`${nm(2)} ${v2}–${v1}`);
      logShared(`🏁 <b>The game is over</b> — battle round ${WP7_LAST_ROUND} complete. Final VP: <b>${verdict}</b>. Tally any end-of-game secondaries, then adjust VP with the steppers if needed.`,"sys");
    }
  } else wp7OverLogged=false;
  refreshTrackers();
  if(typeof wpRulesRenderStrats==="function") wpRulesRenderStrats(); /* ==== WP-RULES ==== */
  if(typeof wpRulesShowReminder==="function") wpRulesShowReminder(); /* ==== WP-RULES ==== */
  if(typeof aiOnPhase==="function") aiOnPhase(); /* ==== WP10: ai ==== the AI plays side 2's phases in solo mode */
}
function wp7BelowHalf(owner){
  // Units at ≤ half strength: multi-model → live models vs starting strength (u0 stamped at deploy;
  // legacy tokens without u0 fall back to the live count and never flag); single model → wounds vs maxW.
  const by={};
  state.tokens.forEach(t=>{ if(t.owner===owner)(by[t.unit]=by[t.unit]||[]).push(t); });
  const out=[];
  for(const uk in by){
    const ms=by[uk];
    const start=Math.max(0,...ms.map(t=>+t.u0||0))||ms.length;
    if(start>1){ if(ms.length*2<=start) out.push(ms[0].name+" ("+ms.length+"/"+start+" models)"); }
    else if((ms[0].maxW||1)>1&&(ms[0].wounds||0)*2<=ms[0].maxW) out.push(ms[0].name+" ("+ms[0].wounds+"/"+ms[0].maxW+" W)");
  }
  return out;
}
function wp7ShockReminder(){ // logged locally on each peer, so each player sees their own list
  const list=wp7BelowHalf(mySide);
  if(list.length) logSys("⚠ Battle-shock reminder — your units at half strength or less must test: "+list.join("; "));
}
function wp7RenderPhase(){
  const el=document.getElementById("wp7PhaseLabel"); if(!el) return;
  const p=(state.phase&&typeof state.phase==="object")?state.phase:{ph:-1,side:1};
  if(wpGameOver()){ el.innerHTML='<span style="color:var(--accent)">🏁 Game over</span>'; return; } /* WP-END */
  if(typeof p.ph!=="number"||p.ph<0){ el.innerHTML='<span class="small">Deploy</span>'; return; }
  const col=p.side===1?"var(--p1)":"var(--p2)";
  el.innerHTML=`<span style="color:${col}">${esc((state.names&&state.names[p.side])||("Player "+p.side))}</span> · ${WP7_PHASES[p.ph]||"?"}`;
}
/* ---- reserves ---- */
function wp7ToReserves(unitId){
  const toks=state.tokens.filter(t=>t.unit===unitId);
  if(!toks.length) return;
  if(toks[0].owner!==mySide){ logSys("You can only move your own units into Reserves."); return; }
  const card=wp3CardFor(toks[0]);
  const ds=!!(card&&/deep\s*strike/i.test(String(card.notes||""))); // pre-tick DS when the card's notes mention it
  const entry={id:unitId, owner:mySide, name:(card&&card.name)||toks[0].name, ds, toks:JSON.parse(JSON.stringify(toks))};
  op({k:"rsv+",res:entry});
  op({k:"tok-",ids:toks.map(t=>t.id)});
  sel.clear(); wp3Hide();
  logShared(`· <b>${esc(myName)}</b> put <b>${esc(entry.name)}</b> ×${entry.toks.length} into Reserves`,"sys");
}
function wp7SetDs(id,val){
  const r=((state.reserves&&state.reserves[mySide])||[]).find(x=>x.id===id); if(!r) return;
  op({k:"rsv+",res:Object.assign(JSON.parse(JSON.stringify(r)),{ds:!!val})});
}
function wp7BeginPlace(id){
  const r=((state.reserves&&state.reserves[mySide])||[]).find(x=>x.id===id); if(!r) return;
  wp7Placing={id};
  cv.style.cursor="crosshair";
  logSys("Placing "+r.name+" from Reserves — click inside the green region (Esc cancels, Shift-click overrides the check).");
  wp7UiSig=null; draw();
}
function wp7CancelPlace(){
  if(!wp7Placing) return;
  wp7Placing=null;
  cv.style.cursor=tool==="select"?"default":"crosshair";
  wp7UiSig=null; draw();
}
function wp7PtInPoly(x,y,poly){ // ray-cast point-in-polygon; poly = [[x,y],…] board inches
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
// Arrival legality (returns a reason string, or null when legal). Uses the phase engine's round:
//  round 1: no arrivals · always: >8" (edge-to-edge) from every enemy model and on the battlefield
//  Deep Strike (ds): that's all · otherwise: within 6" of a battlefield edge (base centre), and
//  before round 3 not inside the enemy deployment zone.
function wp7ArriveIllegal(toks,ds,round,board,enemyDz,enemies){
  if(round<2) return "Reserves arrive from round 2 (step the round on, or your mission may differ)";
  for(const t of toks){
    if(t.x<0||t.y<0||t.x>board.w||t.y>board.h) return "the unit doesn't fit on the battlefield there";
    for(const e of enemies) if(edgeDist(t,e)<=8.02) return 'every model must arrive more than 8" from enemy models';
    if(!ds){
      if(Math.min(t.x,t.y,board.w-t.x,board.h-t.y)>6.02) return 'must arrive within 6" of a battlefield edge (or tick DS for Deep Strike)';
      if(round<3&&enemyDz&&enemyDz.length&&wp7PtInPoly(t.x,t.y,enemyDz)) return "can't arrive in the enemy deployment zone before round 3";
    }
  }
  return null;
}
function wp7PlaceClick(ix,iy,force){
  const entry=((state.reserves&&state.reserves[mySide])||[]).find(r=>r.id===(wp7Placing&&wp7Placing.id));
  if(!entry){ wp7CancelPlace(); return; }
  const toks=JSON.parse(JSON.stringify(entry.toks||[]));
  if(!toks.length){ op({k:"rsv-",id:entry.id}); wp7CancelPlace(); return; }
  const cx=toks.reduce((s,t)=>s+t.x,0)/toks.length, cy=toks.reduce((s,t)=>s+t.y,0)/toks.length;
  toks.forEach(t=>{ t.x+=ix-cx; t.y+=iy-cy; });
  const enemies=state.tokens.filter(t=>t.owner!==entry.owner);
  const enemyDz=(state.dz||[])[entry.owner===1?1:0];
  const round=(state.trackers&&state.trackers.round)||1;
  const bad=wp7ArriveIllegal(toks,!!entry.ds,round,state.board,enemyDz,enemies);
  if(bad&&!force){ logSys("Illegal arrival: "+bad+". Shift-click to place anyway."); return; }
  op({k:"rsv-",id:entry.id});
  op({k:"tok+",toks});
  if(bad) logShared(`⚠ <b>${esc(myName)}</b> placed <b>${esc(entry.name)}</b> from Reserves, overriding: ${esc(bad)}`,"sys");
  else logShared(`· <b>${esc(myName)}</b> deployed <b>${esc(entry.name)}</b> from Reserves${entry.ds?" (Deep Strike)":""}`,"sys");
  wp7CancelPlace();
}
/* ---- attached units (CHARACTER joins a bodyguard unit) ---- */
function wp7Attach(){
  const selToks=state.tokens.filter(t=>sel.has(t.id));
  const units=[...new Set(selToks.map(t=>t.unit))];
  if(!units.length){ logSys("Attach: select a CHARACTER and the unit to join (shift-click), then press A."); return; }
  if(units.length===1){
    if(state.tokens.some(t=>t.unit===units[0]&&t.attachedFrom)){ wp7Detach(units[0]); return; }
    logSys("Attach: select the CHARACTER unit AND the unit it joins (shift-click both), then press A.");
    return;
  }
  if(units.length!==2){ logSys("Attach works on exactly two of your units — a CHARACTER and the unit it joins."); return; }
  const g=units.map(uk=>state.tokens.filter(t=>t.unit===uk));
  if(g.some(x=>x[0].owner!==mySide)){ logSys("Attach: both units must be yours."); return; }
  const isChar=x=>x.every(t=>tokKw(t).includes("CHARACTER"));
  const ci= isChar(g[0])&&!isChar(g[1])?0 : isChar(g[1])&&!isChar(g[0])?1 : (isChar(g[0])&&isChar(g[1])?(g[0].length<=g[1].length?0:1):-1);
  if(ci<0){ logSys("Attach: neither selected unit has the CHARACTER keyword."); return; }
  const chr=g[ci], body=g[1-ci];
  op({k:"tok~",toks:chr.map(t=>({id:t.id,attachedFrom:t.unit,unit:body[0].unit}))});
  logShared(`· <b>${esc(myName)}</b> attached <b>${esc(chr[0].name)}</b> to <b>${esc(body[0].name)}</b> — they move, check coherency and count OC as one unit (A or Detach splits them)`,"sys");
  wp3Hide();
}
function wp7Detach(unitId){
  const toks=state.tokens.filter(t=>t.unit===unitId&&t.attachedFrom);
  if(!toks.length){ logSys("Nothing is attached in that unit."); return; }
  op({k:"tok~",toks:toks.map(t=>({id:t.id,unit:t.attachedFrom,attachedFrom:null}))});
  logShared(`· <b>${esc(myName)}</b> detached <b>${esc(toks[0].name)}</b> back to its own unit`,"sys");
  sel.clear(); wp3Hide();
}
/* ---- inspector actions (appended by wp3Inspect) ---- */
function wp7InspectorHtml(tok){
  if(tok.owner!==mySide) return "";
  const attached=state.tokens.some(t=>t.unit===tok.unit&&t.attachedFrom);
  const selUnits=[...new Set(state.tokens.filter(t=>sel.has(t.id)).map(t=>t.unit))];
  let b=`<div class="row" style="margin-top:6px;margin-bottom:0"><button onclick="wp7ToReserves('${tok.unit}')" title="Lift this unit off the table into the Reserves tray">→ Reserves</button>`;
  if(attached) b+=` <button onclick="wp7Detach('${tok.unit}')" title="Split the attached CHARACTER back out (A)">Detach</button>`;
  else if(selUnits.length===2) b+=` <button onclick="wp7Attach()" title="Attach the selected CHARACTER to the other selected unit (A)">Attach</button>`;
  return b+`</div>`;
}
/* ==== WP-A: structured movement ==== per-unit "Movement complete" / "↩ Undo move" inspector controls */
function wpMoveInspectorHtml(tok){
  if(tok.owner!==mySide) return "";
  const uk=tok.unit, done=wpDone.has(uk), hasSnap=!!wpMoveStart[uk];
  /* ==== WP-FIGHT (P2-3): surface the Advance/Fall Back lock so the shooting/charge block isn't a surprise */
  const mates=state.tokens.filter(t=>t.unit===uk);
  const lock=mates.some(t=>t.fellBack)?`⛔ Fell Back — no shooting or charging this turn`
           :mates.some(t=>t.advanced)?`⛔ Advanced — no shooting or charging this turn`:"";
  const lockHtml=lock?`<div class="small" style="color:var(--bad);margin-top:4px">${lock}</div>`:"";
  return lockHtml+`<div class="row" style="margin-top:4px;margin-bottom:0">`+
    `<button onclick="wpMarkDone('${uk}')" title="Lock every model in this unit — no more moves this phase"${done?" disabled":""}>${done?"✓ Movement complete":"Movement complete"}</button> `+
    `<button onclick="wpUndoMove('${uk}')" title="Snap this unit back to where it was when the Movement phase began"${hasSnap?"":" disabled"}>↩ Undo move</button>`+
    `</div>`;
}
function wpMarkDone(unitId){
  const toks=state.tokens.filter(t=>t.unit===unitId);
  if(!toks.length) return;
  toks.forEach(t=>wpMoved.add(t.id));
  wpDone.add(unitId);
  logSys(toks[0].name+": movement complete — locked for the rest of this phase.");
  wp3Inspect(); draw();
}
function wpUndoMove(unitId){
  const snap=wpMoveStart[unitId];
  if(!snap||!snap.length){ logSys("No movement to undo for this unit yet this phase."); return; }
  op({k:"tok~",toks:snap.map(s=>({id:s.id,x:s.x,y:s.y,rot:s.rot,advanced:false}))}); /* ==== WP-FIGHT: undo also clears the Advance flag ==== */
  snap.forEach(s=>wpMoved.delete(s.id));
  wpDone.delete(unitId);
  logSys("Move undone — unit snapped back to the start of the Movement phase.");
  wp3Inspect(); draw();
}
/* ==== end WP-A ==== */

/* ==== WP-FIGHT: Fire Overwatch / Pile in / Consolidate / Fall Back ====
   Every action here is a MEASURED, ASSISTED action — this app assists, it doesn't fully
   adjudicate. Nothing below encodes rules effect text; only names/phases/costs and geometry. */
function wpFightInspectorHtml(tok){
  if(tok.owner!==mySide) return "";
  const ph=(state.phase&&typeof state.phase.ph==="number")?state.phase.ph:-1;
  let h="";
  if(ph===1){ // Movement phase: Fall Back
    h+=`<div class="row" style="margin-top:4px;margin-bottom:0">`+
      `<button onclick="wpFallBack('${tok.unit}')" title="Mark this unit as having fallen back this turn — a reminder it can't shoot or charge"${tok.fellBack?" disabled":""}>${tok.fellBack?"⚑ Fell back":"⚑ Fall Back"}</button></div>`;
  }
  if(ph===4){ // Fight phase: Pile in / Consolidate
    const armed=wpCapMode&&wpCapMode.unit===tok.unit;
    h+=`<div class="row" style="margin-top:4px;margin-bottom:0">`+
      `<button onclick="wpFightMove('pile')" title="Arm Pile in — each model in this unit may then be dragged up to 3&quot; toward the nearest enemy model">${armed&&wpCapMode.mode==="pile"?"● Pile in armed":'Pile in (3")'}</button> `+
      `<button onclick="wpFightMove('consolidate')" title="Arm Consolidate — offer this after the fight is resolved; each model may then be dragged up to 3&quot; toward the nearest enemy model">${armed&&wpCapMode.mode==="consolidate"?"● Consolidate armed":'Consolidate (3")'}</button></div>`;
  }
  const selUnits=[...new Set(state.tokens.filter(t=>sel.has(t.id)).map(t=>t.unit))];
  if((ph===1||ph===3)&&mySide!==state.phase.side&&selUnits.length===2){ // reactive player, their opponent's Movement/Charge phase
    h+=`<div class="row" style="margin-top:4px;margin-bottom:0">`+
      `<button onclick="wpFightOverwatch()" title="Fire Overwatch: shoot the selected enemy unit with your selected unit, routed through the normal attack roller">🔥 Fire Overwatch</button></div>`;
  }
  return h;
}
// Fall Back — Movement phase only. Stamps t.fellBack on every model in the unit (synced via tok~);
// cleared automatically the next time a fresh Movement phase begins (see wp7ApplyPhase).
function wpFallBack(unitId){
  if((state.phase&&state.phase.ph)!==1){ logSys("Fall Back is a Movement-phase action."); return; }
  const toks=state.tokens.filter(t=>t.unit===unitId);
  if(!toks.length||toks[0].owner!==mySide) return;
  op({k:"tok~",toks:toks.map(t=>({id:t.id,fellBack:true}))});
  logShared(`· <b>${esc(myName)}</b>'s <b>${esc(toks[0].name)}</b> falls back — no shooting or charging this turn`,"sys");
  wp3Inspect(); draw();
}
// Pile in / Consolidate — Fight phase. Arms a hard 3" cap (see wp2Cap/wp2DropCheck/wp2LogMove)
// on the selected unit; drag each model toward the nearest enemy model, measured with edgeDist —
// a drop beyond 3" snaps the whole move back, same UX as every other capped drag in this app.
function wpFightMove(mode){
  const toks=state.tokens.filter(t=>sel.has(t.id));
  if(!toks.length||toks[0].owner!==mySide){ logSys("Select your unit first, then Pile in / Consolidate."); return; }
  const unit=toks[0].unit, mine=state.tokens.filter(t=>t.unit===unit);
  const enemies=state.tokens.filter(t=>t.owner!==mySide);
  let hint="", best=Infinity;
  mine.forEach(m=>enemies.forEach(e=>{ const d=edgeDist(m,e); if(d<best) best=d; }));
  if(isFinite(best)) hint=` — nearest enemy model is ${Math.max(0,best).toFixed(1)}" away`;
  wpCapMode={mode,unit,cap:3};
  logSys(`${mode==="consolidate"?"Consolidate (3\")":"Pile in (3\")"} armed for ${mine[0].name}${hint}. Drag each model toward the nearest enemy model — drops beyond 3" snap back.`);
  wp3Inspect(); draw();
}
// Fire Overwatch — reactive shoot, Movement/Charge phase, non-active player only. Select your unit
// + the enemy unit (shift-click both), then use this action: it routes the pair through the SAME
// two-click attack machinery as the ⚔ tool (wp15Go → wp3Stage/akResult), then nudges "Hit on" to
// 6+ (the Overwatch convention — a mechanical value, not rules prose) and logs it as Overwatch.
function wpFightOverwatch(){
  const ph=state.phase&&state.phase.ph;
  if(ph!==1&&ph!==3){ logSys("Fire Overwatch is only available in the Movement or Charge phase."); return; }
  if(mySide===state.phase.side){ logSys("Fire Overwatch is for the player who is NOT taking their turn."); return; }
  const selToks=state.tokens.filter(t=>sel.has(t.id));
  const units=[...new Set(selToks.map(t=>t.unit))];
  if(units.length!==2){ logSys("Fire Overwatch: shift-click your shooting unit AND the enemy unit that's moving/charging, then use this action."); return; }
  const groups=units.map(uk=>state.tokens.filter(t=>t.unit===uk));
  const mineIdx=groups[0][0].owner===mySide&&groups[1][0].owner!==mySide?0
               :groups[1][0].owner===mySide&&groups[0][0].owner!==mySide?1:-1;
  if(mineIdx<0){ logSys("Fire Overwatch: select one of your units and one enemy unit."); return; }
  const shooter=groups[mineIdx][0], target=groups[1-mineIdx][0];
  wp3Label="";
  wp15Atk={unit:shooter.unit,owner:shooter.owner};
  wp15Go(target,true); // P2-4: Overwatch is a ranged attack — never auto-stage a melee weapon (blocks melee-only shooters)
  if(!wp3Label) return; // wp15Go bailed (no card/weapons, or a melee-only shooter) — nothing staged, nothing to log
  const bsEl=document.getElementById("akBS"); if(bsEl) bsEl.value="6+"; // Overwatch: hits only on an unmodified 6
  logShared(`🔥 <b>${esc(myName)}</b> fires Overwatch: <b>${esc(shooter.name)}</b> → <b>${esc(target.name)}</b>`,"sys");
}
/* ==== end WP-FIGHT ==== */
/* ---- board overlay + UI refresh (called from draw()) ---- */
function wp7SyncUi(){ // phase label + tray, memoized so draw() stays cheap
  const R=state.reserves||{1:[],2:[]}, p=state.phase||{ph:-1,side:1};
  const sig=[p.ph,p.side,(state.trackers&&state.trackers.round)||1,
    (R[1]||[]).map(r=>r.id+":"+(r.ds?1:0)+":"+(r.toks||[]).length).join(","),
    (R[2]||[]).map(r=>r.id+":"+(r.ds?1:0)+":"+(r.toks||[]).length).join(","),
    wp7Placing&&wp7Placing.id, wp7TrayOpen,
    (state.names&&state.names[1])||"", (state.names&&state.names[2])||""].join("|");
  if(sig===wp7UiSig) return;
  wp7UiSig=sig;
  wp7RenderPhase(); wp7RenderTray();
}
function wp7ToggleTray(){ wp7TrayOpen=!wp7TrayOpen; wp7UiSig=null; draw(); }
function wp7RenderTray(){
  const el=document.getElementById("wp7Tray"); if(!el) return;
  const R=state.reserves||{1:[],2:[]};
  const n=((R[1]||[]).length+(R[2]||[]).length);
  if(!n){ el.style.display="none"; return; }
  el.style.display="block";
  const opp=mySide===1?2:1;
  let html=`<div class="title" style="cursor:pointer" onclick="wp7ToggleTray()"><span>Reserves (${n})</span><span class="small">${wp7TrayOpen?"▾":"▸"}</span></div>`;
  if(wp7TrayOpen){
    [mySide,opp].forEach(side=>{
      const L=R[side]||[]; if(!L.length) return;
      const col=side===1?"var(--p1)":"var(--p2)";
      html+=`<div class="small" style="color:${col};margin-top:5px"><b>${esc((state.names&&state.names[side])||("Player "+side))}</b>${side===mySide?"":" <span style='color:var(--dim)'>(opponent)</span>"}</div>`;
      L.forEach(r=>{
        html+=`<div style="display:flex;justify-content:space-between;align-items:center;gap:4px;padding:3px 0;border-top:1px solid var(--edge)"><span>${esc(r.name)} <span class="small">×${(r.toks||[]).length}</span></span>`;
        if(side===mySide)
          html+=`<span style="white-space:nowrap"><label class="small" title="Deep Strike: may arrive anywhere more than 8&quot; from enemy models"><input type="checkbox" onchange="wp7SetDs('${r.id}',this.checked)"${r.ds?" checked":""}> DS</label> <button onclick="wp7BeginPlace('${r.id}')" title="Place on the battlefield (legal region shades green)">Deploy</button></span>`;
        html+=`</div>`;
      });
    });
  }
  el.innerHTML=html;
}
function wp7Overlay(){ // draw() hook: keep the phase/tray UI fresh, shade the legal arrival region while placing
  wp7SyncUi();
  if(!wp7Placing) return;
  const entry=((state.reserves&&state.reserves[mySide])||[]).find(r=>r.id===wp7Placing.id);
  if(!entry){ wp7Placing=null; return; }
  const round=(state.trackers&&state.trackers.round)||1;
  const [bx,by]=px(0,0), bw=state.board.w*view.s, bh=state.board.h*view.s;
  ctx.save();
  ctx.beginPath(); ctx.rect(bx,by,bw,bh); ctx.clip();
  if(round<2){ ctx.fillStyle="rgba(216,74,74,.10)"; ctx.fillRect(bx,by,bw,bh); }
  else{
    ctx.fillStyle="rgba(95,191,111,.13)";
    if(entry.ds) ctx.fillRect(bx,by,bw,bh);
    else{
      const s6=6*view.s;
      ctx.fillRect(bx,by,bw,s6); ctx.fillRect(bx,by+bh-s6,bw,s6);
      ctx.fillRect(bx,by+s6,s6,bh-2*s6); ctx.fillRect(bx+bw-s6,by+s6,s6,bh-2*s6);
    }
    if(!entry.ds&&round<3){ // enemy DZ off-limits before round 3
      const poly=(state.dz||[])[entry.owner===1?1:0];
      if(poly&&poly.length){
        ctx.beginPath(); poly.forEach((pt,i)=>{ const q=px(pt[0],pt[1]); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]); });
        ctx.closePath(); ctx.fillStyle="rgba(216,74,74,.18)"; ctx.fill();
      }
    }
    ctx.fillStyle="rgba(216,74,74,.22)"; // 8" exclusion around every enemy model
    state.tokens.forEach(t=>{
      if(t.owner===entry.owner) return;
      const [tx,ty]=px(t.x,t.y);
      ctx.beginPath(); ctx.arc(tx,ty,(8+tokRadius(t))*view.s,0,7); ctx.fill();
    });
  }
  ctx.restore();
  ctx.font="bold 12px sans-serif";
  const msg=round<2?"Reserves arrive from round 2 — step the round on (Shift-click overrides)"
    :"Placing "+entry.name+" — click the green region"+(entry.ds?' (Deep Strike: anywhere >8" from enemies)':"");
  const w=ctx.measureText(msg).width;
  ctx.fillStyle="rgba(16,18,22,.85)"; ctx.fillRect(bx+bw/2-w/2-8,by+6,w+16,22);
  ctx.fillStyle=round<2?"#ff7060":"#5fbf6f"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(msg,bx+bw/2,by+17);
}
window.addEventListener("keydown",e=>{ /* WP7: A = attach/detach, Esc cancels reserve placement (own listener; shared handler untouched) */
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
  if(typeof wp11Alloc!=="undefined"&&wp11Alloc&&(e.key==="a"||e.key==="A")) return; /* ==== WP11: A = auto-assign pending casualties, not attach ==== */
  if(e.key==="a"||e.key==="A") wp7Attach();
  else if(e.key==="Escape") wp7CancelPlace();
});
/* ==== end WP7 ==== */

/* ==== WP10: ai ==== solo mode — a local AI opponent that plays side 2.
   The AI is a LOCAL actor: it mutates state ONLY via op()/applyOp (send() is a no-op
   offline), so autosave, undo, save/load and every overlay keep working. It reads only
   what a player could see: the board and both sides' synced cards (cards are public in
   this app). Every approximation is documented in ? → Solo mode. */

/* ---- tuning: every tactical weight in one place ---- */
const AI_TUNE={
  objBase:10,        // taking/holding an objective
  objContest:6,      // extra for flipping one the player holds
  objKeep:0.55,      // fraction of objBase for staying on one we already hold
  objApproach:0.7,   // per-inch reward for closing on an objective the AI doesn't hold
  rangeApproach:0.3, // per-inch reward for shooters closing to weapons range when nothing is in LoS
  shootW:1.6,        // weight of expected shooting damage from a destination
  coverW:2.5,        // ending inside a terrain area (INFANTRY)
  threatW:0.9,       // expected incoming melee threat at a destination
  holdThreat:0.55,   // reduced threat multiplier when the destination TAKES/HOLDS an objective for the AI (a point worth taking fire for)
  advancePen:4,      // advancing forfeits shooting
  closeW:0.4,        // pure-melee units: reward per inch of closed distance (capped)
  chargeGain:1.4,    // expected melee damage multiplier needed to attempt a charge
  tgtWound:1.2,      // target priority: damage vs points-per-remaining-wound
  tgtOnObj:1.5,      // target priority: unit parked on an objective the AI doesn't hold
  minShootExp:0.25,  // don't fire below this expected damage
  reserveMax:1,      // units held in Strategic Reserves
  // ---- list-build quality knobs (Gen-6: stop padding elite/gunline armies into fill-hordes) ----
  chaffPpm:13,       // a unit costing ≤ this many points-per-model is "cheap chaff" (a body, not a threat)
  chaffShare:0.35,   // cap: at most this fraction of the list's points may be spent on cheap chaff
  elitePpm:18,       // a non-character costing ≥ this points-per-model counts as a quality/"hammer" pick
  maxUnitShare:0.33, // skip any single datasheet costing > this fraction of the list (no Lord-of-War hogging)
};

/* ---- solo flag + seedable RNG (mulberry32; aiSeed(n) reproduces a whole game) ---- */
let solo=false;                       // module-level, NOT in state (never syncs, never saves)
let aiGen=0, aiTimer=null, aiPaused=false, aiQueue=[], aiDelay=600;
let aiActing=false, aiCurTgt=null, aiCurAtk=null;   // set while the AI itself is rolling an attack
let aiStagedTgt=null, aiStagedAtk=null;             // last player-staged attacker→target (wp3Stage hook)
let aiShotLog=[];                     // {atk,tgt,dist,rng,vis,weapon} — every AI attack (tests assert legality)
let aiFocus={};                       // enemy unitKey -> expected damage the army has COMMITTED this shooting phase (army-level focus fire)
let aiMoved={};                       // unitId -> {advanced,charged} for the current AI turn
let aiPhaseKey="";                    // "round:side:ph" last planned — guards double-planning
function aiMulberry(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
let aiRand=aiMulberry((Date.now()&0xffffffff)>>>0);
function aiSeed(n){ aiRand=aiMulberry(n>>>0); }
function aiRng(){ return aiRand(); }
const aiD6=()=>1+Math.floor(aiRng()*6);

/* ---- solo / netplay mutual exclusion + entry UI ---- */
function aiSoloBlocksNet(){ // hooked at the top of hostGame/joinPrompt
  if(!solo) return false;
  logSys("Solo mode is on — click ⚔ Solo to exit it before hosting or joining a network game.");
  return true;
}
function aiSoloToggle(){
  if(solo){ if(confirm("Exit solo mode? The AI stops playing; its models stay on the table.")) aiStop(); return; }
  if(conn&&conn.open){ logSys("You're connected to an opponent — solo mode is only available offline."); return; }
  const sel=document.getElementById("aiFactionSel");
  sel.innerHTML=DB.factions.map(([id,n])=>`<option value="${id}">${esc(n)}</option>`).join("");
  if(typeof wp11PopulateMeta==="function") wp11PopulateMeta(); /* ==== WP11: meta-opponent picker ==== */
  // Default the AI's points to a standard 2000 (Strike Force), or match the player's loaded army to
  // the nearest bracket — a 1000pt default gave a new solo player a lopsided half-strength opponent.
  const ptsSel=document.getElementById("aiPtsSel");
  if(ptsSel){
    const mine=((state.cards&&state.cards[1])||[]).reduce((s,c)=>s+(parseInt(c.pts)||0),0)
             ||(myArmy||[]).reduce((s,c)=>s+(parseInt(c.pts)||0),0);
    const brackets=[...ptsSel.options].map(o=>parseInt(o.value)).sort((a,b)=>a-b);
    ptsSel.value=String(mine>0?(brackets.filter(b=>b>=mine)[0]||brackets[brackets.length-1]):2000);
  }
  document.getElementById("aiDlg").showModal();
}
function aiStartFromDlg(){
  /* ==== WP11: meta opponents ==== a picked meta list musters via importArmyList instead of auto-build */
  const metaSel=document.getElementById("aiMetaSel");
  if(metaSel&&metaSel.value!==""&&typeof wp11StartMeta==="function"){ document.getElementById("aiDlg").close(); wp11StartMeta(parseInt(metaSel.value)); return; }
  /* ==== end WP11 ==== */
  const fid=document.getElementById("aiFactionSel").value||((DB.factions[0]||[])[0]);
  const pts=parseInt(document.getElementById("aiPtsSel").value)||1000;
  document.getElementById("aiDlg").close();
  if(state.tokens.some(t=>t.owner===2)){ // e.g. a resumed autosave of a solo game
    if(confirm("Side 2 already has models on the table.\n\nOK — the AI takes over that army as-is (resuming a solo game).\nCancel — abort (Clear table first for a fresh solo game)."))
      aiTakeOver();
    return;
  }
  if(!state.objectives.length&&!confirm("No layout loaded — the AI plays much better with objectives and deployment zones (Setup tab). Start anyway?")) return;
  aiStart(fid,pts);
}
function aiReset(){
  solo=true; aiGen++; aiQueue=[]; if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} aiPaused=false;
  aiShotLog=[]; aiFocus={}; aiMoved={}; aiPhaseKey="";
  if(mySide!==1){ mySide=1; const s=document.getElementById("mySide"); if(s) s.value="1"; op({k:"name",side:1,name:myName}); }
}
function aiTakeOver(){ // resume solo against whatever side 2 already has (cards persist in state)
  if(conn&&conn.open){ logSys("Disconnect first — solo mode is offline only."); return; }
  aiReset();
  aiUi();
  logShared("🤖 <b>Solo mode</b>: the AI takes over the side-2 army on the table. Step the phase (›) to continue.","sys");
  if(typeof wp11SetPlan==="function") wp11SetPlan("hold","resumed game"); /* ==== WP11 ==== */
}
function aiStart(fid,pts){
  if(conn&&conn.open){ logSys("Disconnect first — solo mode is offline only."); return; }
  aiReset();
  const fname=(DB.factions.find(f=>f[0]===fid)||["","AI"])[1];
  op({k:"name",side:2,name:"AI ("+fname+")"});
  const list=aiBuildList(fid,pts);
  aiMuster(fid,list);
  aiUi();
  logShared(`🤖 <b>Solo mode</b>: the AI musters ${list.length} unit${list.length!==1?"s":""} of ${esc(fname)} (~${list.reduce((s,u)=>s+u.pts,0)} pts) on side 2 (Blue). Play your whole turn as usual, then step the phase (›) past your End phase — the AI plays its own turn and hands back.`,"sys");
  if(typeof wp11SetPlan==="function") wp11SetPlan("hold","auto-built list"); /* ==== WP11: auto-built lists play Take and Hold ==== */
}
function aiStop(){
  if(typeof wp11AllocDiscard==="function") wp11AllocDiscard(); /* ==== WP11 ==== */
  solo=false; aiGen++; aiQueue=[]; if(aiTimer){clearTimeout(aiTimer);aiTimer=null;} aiPaused=false;
  aiUi();
  logSys("Solo mode off.");
}
function aiUi(){
  const b=document.getElementById("btnSolo");
  if(b) b.textContent=solo?"⚔ Solo ✓":"⚔ Solo";
  ["btnAiPause","btnAiSkip"].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.display=solo?"":"none"; });
  const p=document.getElementById("btnAiPause"); if(p) p.textContent=aiPaused?"▶":"⏸";
}
function aiPauseToggle(){ aiPaused=!aiPaused; aiUi(); logSys(aiPaused?"🤖 AI paused — ▶ resumes, ⏭ finishes the turn.":"🤖 AI resumed."); if(!aiPaused) aiPump(); }

/* ---- pacing: a single timer + generation counter; cancel-safe by construction ---- */
function aiEnqueue(fn){ aiQueue.push(fn); aiPump(); }
function aiPump(){
  if(typeof wp11Pending==="function"&&wp11Pending()) return; /* ==== WP11: hold the queue while damage packets await allocation ==== */
  if(aiTimer||aiPaused||!aiQueue.length||!solo) return;
  const gen=aiGen;
  aiTimer=setTimeout(()=>{
    aiTimer=null;
    if(gen!==aiGen||!solo||aiPaused) return;
    const fn=aiQueue.shift();
    if(fn){ try{ fn(); }catch(e){ console.error(e); logSys("🤖 AI error: "+(e&&e.message)); } }
    aiPump();
  },aiDelay);
}
function aiFinishTurn(){ // ⏭ — run the rest of the AI's turn instantly (also the tests' sync driver)
  if(!solo) return;
  const gen=aiGen;
  if(aiTimer){ clearTimeout(aiTimer); aiTimer=null; }
  aiPaused=false;
  if(!aiQueue.length&&state.phase&&state.phase.side===2&&state.phase.ph>=0){ aiPhaseKey=""; aiOnPhase(); }
  let guard=0;
  while(aiQueue.length&&gen===aiGen&&solo&&guard++<3000){
    if(typeof wp11Pending==="function"&&wp11Pending()) break; /* ==== WP11: ⏭ also waits for the player to allocate ==== */
    if(aiTimer){ clearTimeout(aiTimer); aiTimer=null; }
    const fn=aiQueue.shift();
    try{ fn(); }catch(e){ console.error(e); logSys("🤖 AI error: "+(e&&e.message)); }
  }
  if(aiTimer){ clearTimeout(aiTimer); aiTimer=null; }
  aiUi();
}
function aiInterrupt(){ // hooked in clearTable/loadGame/wp1Undo — no zombie timers, ever
  if(typeof wp11AllocDiscard==="function") wp11AllocDiscard(); /* ==== WP11: clear/load/undo discard pending damage packets ==== */
  if(!solo&&!aiQueue.length&&!aiTimer) return;
  aiGen++; aiQueue=[]; if(aiTimer){ clearTimeout(aiTimer); aiTimer=null; }
  aiPhaseKey="";
  if(solo&&state.phase&&state.phase.side===2&&state.phase.ph>=0)
    logSys("🤖 AI actions cancelled — press ⏭ to let it finish its turn, or step the phase (›) yourself.");
}

/* ---- turn loop (hooked at the end of wp7ApplyPhase) ---- */
function aiOnPhase(){
  if(!solo) return;
  const p=state.phase||{};
  if(p.side!==2||typeof p.ph!=="number"||p.ph<0){ aiUi(); return; }
  const key=(((state.trackers&&state.trackers.round)||1)+":"+p.side+":"+p.ph);
  if(key===aiPhaseKey) return;
  aiPhaseKey=key;
  if(p.ph===0) aiMoved={};   // fresh AI turn
  aiEnqueue(()=>aiPlanPhase(p.ph));
  aiUi();
}
function aiPlanPhase(ph){
  if(!solo||!state.phase||state.phase.side!==2||state.phase.ph!==ph) return;
  const round=(state.trackers&&state.trackers.round)||1;
  switch(ph){
    case 0: if(typeof wp11TurnStart==="function") wp11TurnStart(round); /* ==== WP11: plan weights + once-per-round brief ==== */ aiCommand(); break;
    case 1: aiMovement(round); break;
    case 2: aiShooting(); break;
    case 3: if(typeof wp11HiddenSweep==="function") wp11HiddenSweep(); /* ==== WP11: quiet dense-terrain infantry go Hidden after shooting ==== */ aiCharges(); break;
    case 4: aiFights(); break;
    case 5: aiEndTurn(); break;
  }
  aiEnqueue(()=>{ if(solo&&state.phase.side===2&&state.phase.ph===ph) wp7Step(1); });
}

/* ---- shared helpers ---- */
function aiUnits(owner){
  const by={};
  state.tokens.forEach(t=>{ if(t.owner===owner)(by[t.unit]=by[t.unit]||[]).push(t); });
  return Object.keys(by).map(uk=>({uk,toks:by[uk]}));
}
function aiCardFor(t){ // like wp3CardFor but side-agnostic: cards for BOTH sides live in state.cards
  const src=(state.cards&&state.cards[t.owner])||[];
  const nn=norm(t.name||"");
  return src.find(c=>(c.profiles||[]).some(p=>norm(p.n||"")===nn))
      || src.find(c=>norm(c.name||"")===nn)
      || src.find(c=>(c.profiles||[]).some(p=>{const q=norm(p.n||"");return q&&(q.includes(nn)||nn.includes(q));}))
      || null;
}
function aiWeapons(ms){ // union of the unit's (and any attached leader's) parsed weapon lines
  const seen=new Set(), ws=[]; let card=null;
  ms.forEach(t=>{
    const c=aiCardFor(t); if(!c||seen.has("c:"+c.name)) return;
    seen.add("c:"+c.name); card=card||c;
    String(c.weapons||"").split("\n").map(wp3ParseWeapon).filter(Boolean).forEach(w=>{
      if(!seen.has("w:"+w.n)){ seen.add("w:"+w.n); ws.push(w); }
    });
  });
  return {card,ranged:ws.filter(w=>!w.melee),melee:ws.filter(w=>w.melee)};
}
function aiAvgDice(s){
  s=String(s).trim().toUpperCase();
  const m=s.match(/^(\d*)D(3|6)([+-]\d+)?$/);
  if(m) return (+(m[1]||1))*((+m[2]+1)/2)+(+(m[3]||0));
  return Math.max(0,parseInt(s)||0);
}
// Analytic expected damage of weapon w fired by `shooters` models at unit tgtMs —
// the same ability semantics the staged Attack tab applies, in probability form.
function aiExpDamage(w,shooters,tgtMs,dist,cover){
  if(!tgtMs.length) return 0;
  const ab=wp3ParseAbilities(w.ab), t0=tgtMs[0];
  const T=+t0.T||4, W=+t0.maxW||1, kw=tokKw(t0);
  let A=aiAvgDice(w.A);
  if(ab.rapid&&!w.melee&&dist<=w.rng/2+0.02) A+=ab.rapid;
  if(ab.blast) A+=Math.floor(tgtMs.length/5);
  A*=Math.max(1,shooters|0);
  const bsm=String(w.BS).match(/^(\d)\+?$/);
  let pHit,pCrit=1/6;
  if(ab.torrent||!bsm){ pHit=1; pCrit=0; }
  else{ let need=+bsm[1]+((cover&&!w.melee)?1:0); need=Math.max(2,Math.min(6,need)); pHit=(7-need)/6; }
  let hits=A*pHit+A*pCrit*(ab.sus||0);
  const S=parseInt(w.S)||4;
  const needW=S>=2*T?2:S>T?3:S===T?4:2*S<=T?6:5;
  const anti=ab.anti.find(a=>kw.includes(a.kw));
  const critOn=anti?Math.min(6,Math.max(2,anti.v)):6;
  let pW=Math.max((7-needW)/6,(7-critOn)/6);
  let pCritW=(7-critOn)/6;
  if(ab.twin){ pW=1-(1-pW)*(1-pW); pCritW=1-(1-pCritW)*(1-pCritW); }
  let wounds=hits*pW;
  if(ab.lethal) wounds+=A*pCrit*(1-pW);          // crit hits that would otherwise fail now auto-wound
  const sv=parseInt(t0.Sv)||7, inv=parseInt(t0.iv)||0;
  const svNeed=Math.min(7,sv+Math.abs(parseInt(w.AP)||0));
  const useSv=inv&&inv<svNeed?inv:svNeed;
  const pFail=useSv>=7?1:(useSv-1)/6;
  const dmgPer=Math.min(aiAvgDice(w.D),W);       // spill beyond one model is lost
  let unsavable=0;
  if(ab.dev&&pW>0){ const frac=Math.min(1,pCritW/pW); unsavable=wounds*frac; wounds-=unsavable; }
  return (wounds*pFail+unsavable)*dmgPer;
}
function aiMeleeThreat(enemyToks,myToks){ // what that unit's melee could do to mine
  const em=aiWeapons(enemyToks).melee;
  if(!em.length) return enemyToks.length*0.3;
  return Math.max(...em.map(w=>aiExpDamage(w,enemyToks.length,myToks,0,false)));
}
function aiTargetScore(tgt,exp){
  const t0=tgt.toks[0], card=aiCardFor(t0);
  const pts=(card&&parseInt(card.pts))||tgt.toks.length*10;
  const totW=tgt.toks.reduce((s,t)=>s+(t.wounds||1),0);
  let s=exp*(1+AI_TUNE.tgtWound*Math.min(2,pts/Math.max(1,totW*12)));
  const mR=mmIn(40)/2;
  if(wp6Tallies().some(x=>x.holder!==2&&tgt.toks.some(t=>Math.hypot(t.x-x.o.x,t.y-x.o.y)-mR-tokRadius(t)<=3.02)))
    s*=AI_TUNE.tgtOnObj;
  if(typeof wp11TargetAdjust==="function") s=wp11TargetAdjust(s,tgt,exp); /* ==== WP11: focus fire, finish shocked-prone units ==== */
  return s;
}

/* ---- list building (greedy, from the embedded DB; respects p size/cost lines) ---- */
function aiPickSize(u,budget,preferBig){
  const opts=(u.p&&u.p.length?u.p:[["1 model","0"]])
    .map(o=>{const m=o[0].match(/(\d+)/);return {models:m?+m[1]:1,pts:+o[1]||0};})
    .filter(o=>o.pts>0&&o.pts<=budget)
    .sort((a,b)=>preferBig?b.pts-a.pts:a.pts-b.pts);
  return opts[0]||null;
}
function aiBuildList(fid,pts){
  // Gen-6 quality lists: a strong player builds to faction strength (T'au fields battlesuits, not a
  // Fire-Warrior swarm) and wins attrition on firepower/durability EFFICIENCY, not raw model count.
  // So we cap the share of points spent on cheap chaff, bias fill toward points-dense quality picks,
  // and only pad with chaff up to its cap — keeping the Rule-of-Three cap and the ~2000-pt fill
  // target (with a floor so we never regress the earlier under-spend fix).
  const units=DB.units[fid]||[], picked=[]; let left=pts;
  const kOf=u=>(u.k||[]).map(s=>String(s).toUpperCase());
  const cost0=u=>(u.p&&u.p[0]&&+u.p[0][1])||0;
  const models0=u=>{ const m=u.p&&u.p[0]&&String(u.p[0][0]).match(/(\d+)/); return m?+m[1]:1; };
  const ppm0=u=>cost0(u)/Math.max(1,models0(u));    // base points-per-model — the cheapness signal
  const shuffle=a=>{ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(aiRng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  const legalU=u=>cost0(u)>0&&!kOf(u).includes("FORTIFICATION")&&!kOf(u).includes("AIRCRAFT")
    &&u.r!=="Fortifications"&&cost0(u)<=AI_TUNE.maxUnitShare*pts;   // no single datasheet hogs the list
  const pool=f=>units.map((u,i)=>[u,i]).filter(([u])=>f(u)&&legalU(u)).map(([,i])=>i);
  const chaffCap=AI_TUNE.chaffShare*pts;             // cap on points spent on cheap bodies
  const isChaff=u=>ppm0(u)<=AI_TUNE.chaffPpm;
  let chaffPts=0;                                    // running points spent on cheap chaff
  const copies=i=>picked.filter(p=>p.idx===i).length;
  // add one pick honoring the Rule-of-Three copy cap AND the chaff-points cap; returns pts spent.
  // Pass capChaff=false only in the last-resort floor pass, so a chaff-poor faction can still fill.
  const add=(i,preferBig,maxCopies,capChaff)=>{
    if(copies(i)>=(maxCopies||3)) return 0;
    const u=units[i];
    let budget=left;
    if(isChaff(u)&&capChaff!==false) budget=Math.min(budget,chaffCap-chaffPts); // cheap bodies can't blow their share
    const o=aiPickSize(u,budget,preferBig);
    if(!o) return 0;
    picked.push({idx:i,size:o.models,pts:o.pts,name:u.n});
    left-=o.pts; if(isChaff(u)) chaffPts+=o.pts;
    return o.pts;
  };
  const take=(idxs,n,preferBig,maxCopies)=>{ let got=0;
    for(const i of shuffle(idxs)){ if(got>=n) break; if(add(i,preferBig,maxCopies||2)>0) got++; }
    return got; };
  const chars=pool(u=>kOf(u).includes("CHARACTER")&&!kOf(u).includes("EPIC HERO"));
  const battle=pool(u=>kOf(u).includes("BATTLELINE"));
  const heavy=pool(u=>(kOf(u).includes("VEHICLE")||kOf(u).includes("MONSTER"))
    &&!kOf(u).includes("CHARACTER")&&!kOf(u).includes("DEDICATED TRANSPORT")&&cost0(u)>=100);
  const inf=pool(u=>kOf(u).includes("INFANTRY")&&!kOf(u).includes("CHARACTER"));
  // quality bodies: points-dense non-characters + every vehicle/monster (battlesuits, tanks, hammers)
  const elite=pool(u=>!kOf(u).includes("CHARACTER")
    &&(ppm0(u)>=AI_TUNE.elitePpm||kOf(u).includes("VEHICLE")||kOf(u).includes("MONSTER")));
  const quality=[...new Set([...heavy,...elite])];
  const chaffPool=(inf.length?inf:battle).filter(i=>isChaff(units[i]));
  const nonChaffInf=inf.filter(i=>!isChaff(units[i]));
  // --- spine: leaders, a battleline core, anti-tank/durable heavies, and an elite hammer ---
  take(chars,pts>=1000?2:1,false);
  take(battle,pts>=1500?3:2,pts>=1000);
  take(heavy,pts>=1000?2:1,false);
  take(elite,pts>=1500?3:2,false);
  // --- upsize pass: grow already-picked NON-chaff units to their largest affordable profile (a
  //     denser quality squad, not more cheap bodies). Chaff is deliberately left small. ---
  for(const p of picked){
    if(isChaff(units[p.idx])) continue;
    const o=aiPickSize(units[p.idx],left+p.pts,true);   // biggest size that fits if this unit's cost is refunded
    if(o&&o.pts>p.pts){ left-=(o.pts-p.pts); p.pts=o.pts; p.size=o.models; }
  }
  // Buy from the first of `pools` that yields an affordable pick this round (prefer big), RoT=3.
  const fillRound=(pools,capChaff)=>{
    for(const P of pools){ for(const i of shuffle(P)){ if(add(i,true,3,capChaff)>0) return true; } }
    return false;
  };
  // --- quality fill: spend leftover points on points-dense units (and quality infantry) FIRST —
  //     this is what stops elite/gunline armies becoming Fire-Warrior swarms. ---
  let g1=0; while(left>=50&&g1++<80&&fillRound([quality,nonChaffInf])){}
  // --- chaff fill: only now top up with cheap bodies, and only up to the chaff-share cap. ---
  let g2=0; while(left>=50&&g2++<80&&fillRound([chaffPool.length?chaffPool:battle])){}
  // --- floor safety net: if still short of the ~1950 floor (chaff-poor faction, cap reached),
  //     drop the chaff cap and buy anything affordable (RoT=3) so we always spend ≥~1950. ---
  if(left>=50){ const anyPool=[...quality,...inf,...battle,...chars]; let g3=0;
    while(left>=50&&g3++<80&&fillRound([anyPool],false)){}
  }
  return picked;
}

/* ---- muster + deployment (normal card path: addFromDb → deployCard with mySide=2) ---- */
function aiMuster(fid,list){
  const prevArmy=myArmy, prevSide=mySide, prevName=myName;
  myArmy=[]; mySide=2; myName=state.names[2]||"AI";
  const cards=[], unitsToks=[];
  try{
    list.forEach(it=>{
      const before=state.tokens.length;
      const card=addFromDb(fid,it.idx,it.size,true);
      if(!card) return;
      card.pts=String(it.pts);
      deployCard(card);
      cards.push(migrateCard(card));
      unitsToks.push(state.tokens.slice(before));
    });
  } finally {
    myArmy=prevArmy; mySide=prevSide; myName=prevName;
    try{ localStorage.setItem("wh40k_army",JSON.stringify(myArmy)); }catch(e){}
    renderArmy();
  }
  op({k:"cards",owner:2,cards:JSON.parse(JSON.stringify(cards))}); // inspector works on AI units
  aiDeployAll(unitsToks);
  aiAttachCharacters();
  aiHoldReserves(unitsToks);
}
function aiUnitSpots(n,cx,cy,gap){ // formation grid centred on (cx,cy)
  const per=Math.ceil(Math.sqrt(n)), rows=Math.ceil(n/per), out=[];
  for(let k=0;k<n;k++){ const col=k%per,row=Math.floor(k/per);
    out.push([cx+(col-(per-1)/2)*gap, cy+(row-(rows-1)/2)*gap]); }
  return out;
}
function aiSpotOk(tok,x,y,placed){
  const c=Object.assign({},tok,{x,y}), r=tokRadius(tok)+0.2;
  if(x<r||y<r||x>state.board.w-r||y>state.board.h-r) return false;
  if(wp5Illegal(c)) return false;
  for(const p of placed) if(edgeDist(c,p)<0.12) return false;
  return true;
}
function aiPlaceUnit(toks,poly,placed){
  if(!toks.length) return false;
  const xs=poly.map(p=>p[0]), ys=poly.map(p=>p[1]);
  const x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs), y0=Math.min.apply(null,ys), y1=Math.max.apply(null,ys);
  const gap=Math.max(1.3,2*Math.max.apply(null,toks.map(tokRadius))+0.25); // size the grid from the unit's LARGEST base, not toks[0] — mixed/large-base units stay non-overlapping & in coherency
  const cands=[];
  for(let y=y0+1;y<=y1-1;y+=1.5) for(let x=x0+1;x<=x1-1;x+=1.5) if(wp7PtInPoly(x,y,poly)) cands.push([x,y]);
  for(let i=cands.length-1;i>0;i--){ const j=Math.floor(aiRng()*(i+1)); const t=cands[i]; cands[i]=cands[j]; cands[j]=t; }
  for(let pass=0;pass<2;pass++){ // pass 1 keeps clear of other units; pass 2 only avoids terrain/board edges
    for(const [cx,cy] of cands){
      const spots=aiUnitSpots(toks.length,cx,cy,gap);
      if(spots.every(([x,y],i)=>wp7PtInPoly(x,y,poly)&&aiSpotOk(toks[i],x,y,pass?[]:placed))){
        op({k:"tok~",toks:toks.map((t,i)=>({id:t.id,x:spots[i][0],y:spots[i][1]}))});
        placed.push.apply(placed,toks);
        return true;
      }
    }
  }
  return false;
}
function aiDeployAll(unitsToks){
  const poly=(state.dz&&state.dz[1])||null;
  if(!poly||poly.length<3){ logSys("🤖 No side-2 deployment zone found — load a layout in Setup for legal AI deployment."); return; }
  const placed=state.tokens.filter(t=>t.owner===1).slice();
  unitsToks.slice().sort((a,b)=>b.length-a.length).forEach(toks=>{ // biggest units grab space first
    if(!aiPlaceUnit(toks,poly,placed))
      logSys("🤖 Couldn't fit "+((toks[0]&&toks[0].name)||"a unit")+" in the DZ — left where it dropped; drag it if needed.");
  });
  /* ---- deploy-time coherency repair (11th-ed: every unit is SET UP in coherency) ----
     Runs AFTER grid placement and consumes NO aiRng, so it is a strict no-op — and can
     never perturb the shared aiRng game stream — unless a model is genuinely out of
     coherency (edge > 2.02" from EVERY squadmate, matching checkCoherency's 1-neighbour
     rule). Two latent sources of incoherence are healed:
       (a) A solo/2-model INFANTRY character that aiAttachCharacters will merge into a
           squad: its 8-offset "snuggle" can fail against a tightly-packed squad and leave
           the character 2"+ from every squadmate. We pre-seat the character adjacent to
           the squad it WILL join (mirroring that pairing) so a later snuggle failing is
           harmless. This is the real cross-faction repro (Hospitaller/Cadre Fireblade/
           Death Jester at 2.1"-4.1").
       (b) Any multi-model unit with a stray model (e.g. a mixed/large-base squad, or a
           unit left on its base-unaware fallback drop grid): nudge it back toward its
           nearest squadmate. */
  const findAdj=(chr,hostToks)=>{ // deterministic legal spot within coherency of a host model — no aiRng
    const others=state.tokens.filter(t=>t.id!==chr.id);
    const hs=hostToks.slice().sort((a,b)=>edgeDist(chr,a)-edgeDist(chr,b));
    for(const h of hs){ const need=tokRadius(chr)+tokRadius(h);
      for(let g=0.3;g<=1.6;g+=0.3){ const d=need+g;
        for(let a=0;a<16;a++){ const ang=a*Math.PI/8, x=h.x+Math.cos(ang)*d, y=h.y+Math.sin(ang)*d;
          if(!wp7PtInPoly(x,y,poly)) continue;
          if(!aiSpotOk(chr,x,y,others)) continue;
          return [x,y]; } } }
    return null;
  };
  const units=aiUnits(2);
  const squads=units.filter(u=>u.toks.length>=3&&unitHasKw(u.toks,["INFANTRY"])&&!u.toks.some(t=>tokKw(t).includes("CHARACTER")));
  const used=new Set();
  units.forEach(u=>{ // (a) pre-seat attaching characters next to their host squad (mirrors aiAttachCharacters pairing)
    if(!u.toks.every(t=>tokKw(t).includes("CHARACTER"))||u.toks.length>2) return;
    if(!unitHasKw(u.toks,["INFANTRY"])) return;
    const host=squads.filter(s=>!used.has(s.uk)).sort((a,b)=>edgeDist(u.toks[0],a.toks[0])-edgeDist(u.toks[0],b.toks[0]))[0];
    if(!host) return;
    used.add(host.uk);
    u.toks.forEach(chr=>{
      if(host.toks.some(m=>edgeDist(chr,m)<=2.02)) return; // already in coherency with host — leave EXACTLY as placed
      const spot=findAdj(chr,host.toks);
      if(spot) op({k:"tok~",toks:[{id:chr.id,x:spot[0],y:spot[1]}]});
    });
  });
  aiUnits(2).forEach(u=>{ const ms=u.toks; if(ms.length<2) return; // (b) nudge any stray model back into coherency
    ms.forEach(m=>{
      let nn=Infinity,near=null; ms.forEach(o=>{ if(o!==m){ const d=edgeDist(m,o); if(d<nn){nn=d;near=o;} } });
      if(!near||nn<=2.02) return; // in coherency — untouched
      const spot=findAdj(m,[near]);
      if(spot) op({k:"tok~",toks:[{id:m.id,x:spot[0],y:spot[1]}]});
    });
  });
}
function aiSeatAdjacent(chr,hx,hy,hostToks){
  // Seat `chr` adjacent to its host squad with a POSITIVE base gap and within coherency
  // (edge ≤ 2.02"). Deterministic — consumes NO aiRng.
  const others=state.tokens.filter(t=>t.id!==chr.id);
  const h0=hostToks[0];
  // PRIMARY: the historical 8-offset snuggle (unchanged order). aiSpotOk already enforces a
  // ≥0.12" clearance from every base, so a committed offset never overlaps. Kept identical so an
  // intact deployment is byte-for-byte what it was — protects the Control-C win-record guardrail.
  const need=tokRadius(chr)+tokRadius(h0)+0.15;
  const offs=[[need,0],[-need,0],[0,need],[0,-need],[need,need],[-need,need],[need,-need],[-need,-need]];
  for(const [ox,oy] of offs){
    if(aiSpotOk(chr,hx+ox,hy+oy,others)){ op({k:"tok~",toks:[{id:chr.id,x:hx+ox,y:hy+oy}]}); return true; }
  }
  // FALLBACK (Gen 7, new): a tightly-packed squad blocked all 8 offsets — the old code then left the
  // character STRANDED at its deploy spot (the overlap/coherency hazard in the §8 log). Ring-scan every
  // host model so it still seats adjacent (edge ≤ 2.02", coherent) with a guaranteed positive gap.
  const hosts=hostToks.slice().sort((a,b)=>Math.hypot(a.x-hx,a.y-hy)-Math.hypot(b.x-hx,b.y-hy));
  for(let gap=0.15;gap<=1.95;gap+=0.2){
    for(const h of hosts){ const d=tokRadius(chr)+tokRadius(h)+gap;
      for(let a=0;a<16;a++){ const ang=a*Math.PI/8, x=h.x+Math.cos(ang)*d, y=h.y+Math.sin(ang)*d;
        if(aiSpotOk(chr,x,y,others)){ op({k:"tok~",toks:[{id:chr.id,x,y}]}); return true; } }
    }
  }
  return false; // squad fully boxed in — leave the character at its (already legal) deploy spot
}
function aiAttachCharacters(){ // leaders join squads at deployment (as the rules have it)
  const squads=aiUnits(2).filter(u=>u.toks.length>=3&&unitHasKw(u.toks,["INFANTRY"])
    &&!u.toks.some(t=>tokKw(t).includes("CHARACTER")));
  const used=new Set();
  aiUnits(2).forEach(u=>{
    if(!u.toks.every(t=>tokKw(t).includes("CHARACTER"))||u.toks.length>2) return;
    if(!unitHasKw(u.toks,["INFANTRY"])) return;              // mounted/vehicle characters stay solo
    const chr=u.toks;
    const host=squads.filter(s=>!used.has(s.uk))
      .sort((a,b)=>edgeDist(chr[0],a.toks[0])-edgeDist(chr[0],b.toks[0]))[0];
    if(!host) return;
    used.add(host.uk);
    op({k:"tok~",toks:chr.map(t=>({id:t.id,attachedFrom:t.unit,unit:host.uk}))});
    // Seat the character adjacent to the squad WITHOUT base overlap (FIDELITY, Gen 7).
    // The old snuggle tried 8 fixed offsets sized off tokRadius; if a tight squad blocked all
    // eight it left the character un-seated (a latent coherency/overlap hazard). aiSeatAdjacent
    // does a deterministic (no-aiRng) ring scan gated by aiSpotOk, so every committed spot has a
    // strictly positive edge gap to every base and sits within coherency (edge ≤ 2.02") of the host.
    const h0=host.toks[0];
    aiSeatAdjacent(chr[0],h0.x,h0.y,host.toks);
    logShared(`🤖 AI attaches <b>${esc(chr[0].name)}</b> to <b>${esc(h0.name)}</b>`,"sys");
  });
}
function aiHoldReserves(unitsToks){ // no Deep Strike data in the DB → Strategic Reserves (see help)
  if(AI_TUNE.reserveMax<1||unitsToks.length<4) return;
  const cand=aiUnits(2).filter(u=>{
    const ms=u.toks;
    return ms.length>=3&&ms.length<=10&&ms.every(t=>tokKw(t).includes("INFANTRY"))
      &&!ms.some(t=>tokKw(t).includes("CHARACTER")||t.attachedFrom);
  }).sort((a,b)=>a.toks.length-b.toks.length);
  if(!cand.length) return;
  const toks=cand[0].toks;
  const entry={id:cand[0].uk,owner:2,name:toks[0].name,ds:false,toks:JSON.parse(JSON.stringify(toks))};
  op({k:"rsv+",res:entry});
  op({k:"tok-",ids:toks.map(t=>t.id)});
  logShared(`🤖 AI holds <b>${esc(entry.name)}</b> ×${entry.toks.length} in Strategic Reserves`,"sys");
}

/* ---- Command phase: battle-shock tests (real 2D6 vs Ld) for below-half AI units ---- */
function aiBelowHalf(ms){
  const start=Math.max(0,...ms.map(t=>+t.u0||0))||ms.length;
  if(start>1) return ms.length*2<=start;
  return (ms[0].maxW||1)>1&&(ms[0].wounds||0)*2<=ms[0].maxW;
}
function aiLd(ms){
  const card=aiCardFor(ms[0]);
  const p=(card&&(card.profiles||[]).find(x=>norm(x.n||"")===norm(ms[0].name||"")))||(card&&card.profiles&&card.profiles[0]);
  return parseInt(p&&p.Ld)||7;
}
function aiCommand(){
  aiUnits(2).forEach(u=>{
    if(!aiBelowHalf(u.toks)){
      if(u.toks.some(t=>t.bs)) op({k:"tok~",toks:u.toks.map(t=>({id:t.id,bs:false}))}); // rallied
      return;
    }
    aiEnqueue(()=>{
      const ms=state.tokens.filter(t=>t.unit===u.uk); if(!ms.length) return;
      const ld=aiLd(ms), a=aiD6(), b=aiD6(), ok=a+b>=ld;
      op({k:"tok~",toks:ms.map(t=>({id:t.id,bs:!ok}))});
      logShared(`🎲 🤖 <b>${esc(ms[0].name)}</b> Battle-shock (Ld ${ld}+): ${a}+${b} = ${a+b} — <b>${ok?"PASSED":"FAILED — battle-shocked!"}</b>`,"dice");
    });
  });
}

/* ---- Movement phase: score candidate destinations, execute formation moves ---- */
function aiBestShoot(x,y,ms,ranged,enemies,prep){ // best expected damage from a spot (sampled LoS)
  if(!ranged.length) return 0;
  let best=0;
  const src={x,y,r:0,lvl:0};
  enemies.forEach(e=>{
    let cd=Infinity,cm=null;
    e.toks.forEach(t=>{ const d=Math.hypot(t.x-x,t.y-y)-tokRadius(t); if(d<cd){cd=d;cm=t;} });
    if(!cm) return;
    ranged.forEach(w=>{
      if(cd>w.rng+0.02) return;
      const p=losPair(src,{x:cm.x,y:cm.y,r:tokRadius(cm),lvl:cm.lvl||0},prep,false);
      if(!p.vis) return;
      const exp=aiExpDamage(w,ms.length,e.toks,cd,p.part);
      if(exp>best) best=exp;
    });
  });
  return best;
}
function aiTryTranslate(ms,tx,ty,enemyToks,allowEngage){
  const scales=[1,0.85,0.7,0.5], offs=[[0,0],[0.8,0],[-0.8,0],[0,0.8],[0,-0.8],[1.4,1.4],[-1.4,1.4],[1.4,-1.4],[-1.4,-1.4]];
  const cap=Math.hypot(tx,ty)+1e-6;   // FIDELITY: (tx,ty) is the caller's move-capped vector; a rigid translation moves every model by |(vx,vy)|, which may never exceed the unit's allowance (M, or M+D6 on an advance). Obstacle-dodging offsets must stay under this cap.
  for(const sc of scales) for(const [ox,oy] of offs){
    const vx=tx*sc+ox, vy=ty*sc+oy;
    if(Math.hypot(vx,vy)>cap) continue;   // this nudge would over-move the unit — skip it
    const good=ms.every(t=>{
      const c=Object.assign({},t,{x:t.x+vx,y:t.y+vy});
      const r=tokRadius(c)+0.1;
      if(c.x<r||c.y<r||c.x>state.board.w-r||c.y>state.board.h-r) return false;
      if(wp5Illegal(c)) return false;
      for(const e of enemyToks){
        if(!allowEngage&&edgeDist(c,e)<=2.05) return false;   // 11th-ed: may not end within 2" engagement range unless charging
        if(allowEngage&&edgeDist(c,e)<-0.05) return false;    // …but never overlapping bases
      }
      for(const o of state.tokens) if(o.owner===c.owner&&o.unit!==c.unit&&edgeDist(c,o)<0.02) return false;
      return true;
    });
    if(good){ op({k:"tok~",toks:ms.map(t=>({id:t.id,x:t.x+vx,y:t.y+vy}))}); return true; }
  }
  return false;
}
/* ---- FIDELITY (Gen 7): re-form unit coherency after a move ----
   11th-ed: at the END of its Movement phase every model must be in unit coherency (this
   engine's checkCoherency: a squadmate within 2.02" edge, and none beyond 9.02"). aiMoveUnit
   RIGID-translates a unit, so a unit that lost models to casualties keeps its (now-broken)
   spread and can end Movement incoherent (e.g. SM Execrator, game 61 R4–5). This pass pulls
   any straggler survivor back onto the unit's blob AFTER the translate. It:
     • runs only when a model is genuinely out of coherency (no-op for intact units — so it
       never perturbs the healthy-move behaviour the matrix measures),
     • consumes NO aiRng (deterministic ring scan — mirrors the deploy-coherency repair),
     • honours the per-model move cap (final pos ≤ `allow`" from that model's PRE-move spot —
       the Gen-0 M / M+D6 allowance),
     • never ends a model within 2.05" of an enemy (non-charge movement) or overlapping any base. */
function aiReformUnit(uk,orig,allow,enemyToks){
  const ms=state.tokens.filter(t=>t.unit===uk);
  if(ms.length<2) return;
  const coh=m=>{ // mirror checkCoherency's per-model rule exactly (near neighbour AND no far squadmate)
    const near=ms.some(o=>o!==m&&edgeDist(m,o)<=2.02);
    const far=ms.some(o=>o!==m&&edgeDist(m,o)>9.02);
    return near&&!far;
  };
  const legal=(m,x,y)=>{
    const c=Object.assign({},m,{x,y}), r=tokRadius(c)+0.1;
    if(x<r||y<r||x>state.board.w-r||y>state.board.h-r) return false;
    if(wp5Illegal(c)) return false;
    const o0=orig[m.id]; if(o0&&Math.hypot(x-o0.x,y-o0.y)>allow+0.02) return false; // move cap from pre-move spot
    for(const e of enemyToks) if(edgeDist(c,e)<=2.05) return false;                  // non-charge: stay out of engagement range
    for(const t of state.tokens){ if(t.id===m.id) continue; if(edgeDist(c,t)<0.05) return false; } // no base overlap
    return true;
  };
  for(let pass=0;pass<8;pass++){
    const stray=ms.filter(m=>!coh(m));
    if(!stray.length) break;
    let progress=false;
    for(const m of stray){
      const mates=ms.filter(o=>o!==m);
      const cohMates=mates.filter(coh);
      const anchors=cohMates.length?cohMates:mates;   // chain onto the already-coherent blob when one exists
      // Pull m the SHORTEST distance that restores coherency (edge gap ∈ (0,2.02]): this preserves the
      // AI's chosen formation/board coverage as much as legality allows, so the fix barely costs strength.
      let bestX=null,bestY=null,bestD=Infinity;
      for(const h of anchors){ const base=tokRadius(m)+tokRadius(h);
        for(let gap=1.9;gap>=0.25;gap-=0.2){ const d=base+gap;
          for(let a=0;a<16;a++){ const ang=a*Math.PI/8, x=h.x+Math.cos(ang)*d, y=h.y+Math.sin(ang)*d;
            if(!legal(m,x,y)) continue;
            const disp=Math.hypot(x-m.x,y-m.y);
            if(disp<bestD-1e-9){ bestD=disp; bestX=x; bestY=y; }
          } }
      }
      if(bestX!==null){ op({k:"tok~",toks:[{id:m.id,x:bestX,y:bestY}]}); progress=true; }
    }
    if(!progress) break;
  }
}
function aiMoveUnit(uk){
  const ms=state.tokens.filter(t=>t.unit===uk); if(!ms.length) return;
  const orig={}; ms.forEach(t=>{ orig[t.id]={x:t.x,y:t.y}; }); // pre-move snapshot for the coherency-reform move cap
  const M=Math.min(...ms.map(t=>(typeof t.Mv==="number"&&t.Mv>0)?t.Mv:6));
  const cx=ms.reduce((s,t)=>s+t.x,0)/ms.length, cy=ms.reduce((s,t)=>s+t.y,0)/ms.length;
  const W=aiWeapons(ms), ranged=W.ranged, melee=W.melee;
  const enemies=aiUnits(1).filter(e=>e.toks.length);
  const tal=wp6Tallies(), prep=losPrep(state.terrain);
  const infantry=unitHasKw(ms,KW_COVER);
  const unitOC=ms.reduce((s,t)=>s+(t.bs?0:(+t.OC||0)),0);
  // --- candidates: hold, objective approaches (normal + advance reach), stand-off, cover ---
  const cands=[{x:cx,y:cy,why:"holds position"}];
  tal.forEach((o,i)=>{
    const dx=o.o.x-cx, dy=o.o.y-cy, d=Math.hypot(dx,dy)||0.001;
    [Math.min(Math.max(0,d-1.2),M), Math.min(Math.max(0,d-1.2),M+3.5)].forEach(step=>{
      if(step>0.2) cands.push({x:cx+dx/d*step, y:cy+dy/d*step, obj:i, why:"→ Obj "+(i+1)});
    });
  });
  if(enemies.length){ // straight at the nearest enemy (shooters close to range, melee closes to charge)
    let near=null,nd=Infinity;
    enemies.forEach(e=>{ const d=wp3UnitDist(ms,e.toks); if(d<nd){nd=d;near=e;} });
    if(near&&nd>1.5){
      const ex=near.toks.reduce((s,t)=>s+t.x,0)/near.toks.length, ey=near.toks.reduce((s,t)=>s+t.y,0)/near.toks.length;
      const d=Math.hypot(ex-cx,ey-cy)||0.001, step=Math.min(M,Math.max(0,d-2.2));
      if(step>0.5) cands.push({x:cx+(ex-cx)/d*step,y:cy+(ey-cy)/d*step,why:"pushes toward "+near.toks[0].name});
    }
  }
  if(ranged.length&&enemies.length){ // shooters back away from the nearest melee threat
    let near=null,nd=Infinity;
    enemies.forEach(e=>{ const d=wp3UnitDist(ms,e.toks); if(d<nd){nd=d;near=e;} });
    if(near&&nd<10){
      const ex=near.toks.reduce((s,t)=>s+t.x,0)/near.toks.length, ey=near.toks.reduce((s,t)=>s+t.y,0)/near.toks.length;
      const d=Math.hypot(cx-ex,cy-ey)||0.001, step=Math.min(M,Math.max(0,12-nd));
      if(step>0.5) cands.push({x:cx+(cx-ex)/d*step,y:cy+(cy-ey)/d*step,why:"backs away from "+near.toks[0].name});
    }
  }
  if(infantry) state.terrain.forEach(ter=>{ // cover spots within normal move
    if(!LOS_DENSE[ter.kind]) return;
    const tx2=ter.x+ter.w/2, ty2=ter.y+ter.h/2, d=Math.hypot(tx2-cx,ty2-cy);
    if(d>0.3&&d<=M) cands.push({x:tx2,y:ty2,why:"takes cover"});
  });
  if(typeof wp11ExtraCands==="function") wp11ExtraCands(cands,{uk,ms,cx,cy,M,ranged,melee,infantry,enemies,tal,prep}); /* ==== WP11: doctrine candidates (screens) ==== */
  cands.forEach(c=>{ c.x=Math.min(state.board.w-1,Math.max(1,c.x)); c.y=Math.min(state.board.h-1,Math.max(1,c.y)); });
  // --- score every candidate ---
  cands.forEach(c=>{
    const d=Math.hypot(c.x-cx,c.y-cy), adv=d>M+0.05;
    let s=0, why2=null, holdsObj=false;
    tal.forEach((o,i)=>{ // objective swing if the unit ends on the marker, gradient toward it otherwise
      const dd=Math.hypot(o.o.x-c.x,o.o.y-c.y), wasOn=Math.hypot(o.o.x-cx,o.o.y-cy)<=2.8, onIt=dd<=2.2;
      if(!onIt){
        const dNow=Math.hypot(o.o.x-cx,o.o.y-cy), gain=dNow-dd;
        if(gain>0.1) s+=gain*AI_TUNE.objApproach*(o.holder!==2?1:0.12)/Math.max(1,Math.sqrt(dNow/14));
        return;
      }
      const ocWithout=o.oc2-(wasOn?unitOC:0), oc2=ocWithout+unitOC;
      const holderAfter=o.oc1>oc2?1:oc2>o.oc1?2:(o.o.sec||0);
      if(holderAfter===2&&o.holder!==2){ s+=AI_TUNE.objBase+(o.holder===1?AI_TUNE.objContest:0); why2=`→ Obj ${i+1} (OC ${oc2} v ${o.oc1})`; holdsObj=true; }
      else if(holderAfter===2){
        if(ocWithout>o.oc1){ s+=1.2; why2=`screens Obj ${i+1}`; }              // already held without this unit — don't pile on
        else { s+=AI_TUNE.objBase*AI_TUNE.objKeep; why2=`holds Obj ${i+1}`; holdsObj=true; }
      }
      else { s+=AI_TUNE.objContest*0.5; why2=`contests Obj ${i+1} (OC ${oc2} v ${o.oc1})`; }
    });
    const sh=adv?0:aiBestShoot(c.x,c.y,ms,ranged,enemies,prep);
    s+=sh*AI_TUNE.shootW;
    if(!adv&&ranged.length&&enemies.length&&sh===0){ // nothing in LoS/range: close toward the fight
      const ndTo=p2=>Math.min(...enemies.map(e=>Math.min(...e.toks.map(t=>Math.hypot(t.x-p2[0],t.y-p2[1])))));
      const gain=ndTo([cx,cy])-ndTo([c.x,c.y]);
      if(gain>0.1) s+=gain*AI_TUNE.rangeApproach;
    }
    if(adv) s-=AI_TUNE.advancePen*(ranged.length?1:0.3);
    if(infantry&&state.terrain.some(t2=>LOS_DENSE[t2.kind]&&geomPointInRect(c.x,c.y,t2))) s+=AI_TUNE.coverW;
    const threatW=holdsObj?AI_TUNE.holdThreat:AI_TUNE.threatW; // a point we can take/hold is worth taking fire for
    enemies.forEach(e=>{ // incoming melee threat at the destination
      const eM=Math.max(...e.toks.map(t=>(typeof t.Mv==="number")?t.Mv:6));
      const exd=Math.min(...e.toks.map(t=>Math.hypot(t.x-c.x,t.y-c.y)));
      if(exd<=eM+8) s-=aiMeleeThreat(e.toks,ms)*threatW*((ranged.length&&!melee.length)?1.4:0.7);
    });
    if(melee.length&&!ranged.length&&enemies.length){ // pure melee closes distance
      const nd=Math.min(...enemies.map(e=>Math.min(...e.toks.map(t=>Math.hypot(t.x-c.x,t.y-c.y)))));
      s+=Math.max(0,20-nd)*AI_TUNE.closeW;
    }
    if(typeof wp11ScoreAdjust==="function") s+=wp11ScoreAdjust(c,{uk,ms,cx,cy,M,ranged,melee,infantry,enemies,tal,prep,adv,sh}); /* ==== WP11: doctrine scoring (hidden/staging/trade/no-chase) ==== */
    c.s=s; if(why2) c.why=why2;
  });
  cands.sort((a,b)=>b.s-a.s);
  const enemyToks=state.tokens.filter(t=>t.owner===1);
  for(const c of cands){
    const dx=c.x-cx, dy=c.y-cy, dist=Math.hypot(dx,dy);
    if(dist<0.3){ aiMoved[uk]={advanced:false}; logShared(`🤖 AI: <b>${esc(ms[0].name)}</b> ${esc(c.why)}`,"sys"); aiReformUnit(uk,orig,M,enemyToks); return; }
    let advanced=false, allow=M;
    if(dist>M+0.05){ allow=M+aiD6(); advanced=true; }        // real advance roll (AI dice)
    const f=Math.min(1,allow/dist);
    if(aiTryTranslate(ms,dx*f,dy*f,enemyToks,false)){
      aiMoved[uk]={advanced};
      logShared(`🤖 AI: <b>${esc(ms[0].name)}</b> ${esc(c.why)}${advanced?` — <b>advances</b> ${(dist*f).toFixed(1)}" (M ${M}"+D6, no shooting)`:` (${(dist*f).toFixed(1)}")`}`,"sys");
      aiReformUnit(uk,orig,allow,enemyToks);   // re-cohere survivors within this move's allowance
      return;
    }
  }
  aiMoved[uk]={advanced:false};
  aiReformUnit(uk,orig,M,enemyToks);           // no legal translate found — still heal coherency in place
}
function aiResSpotScore(x,y,tal){
  if(!tal.length) return 0;
  return -Math.min(...tal.filter(o=>o.holder!==2).concat(tal).map(o=>Math.hypot(o.o.x-x,o.o.y-y)));
}
function aiArriveReserves(round){
  if(round<2) return;
  ((state.reserves&&state.reserves[2])||[]).slice().forEach(entry=>{
    aiEnqueue(()=>{
      const e=((state.reserves&&state.reserves[2])||[]).find(r=>r.id===entry.id); if(!e) return;
      const toks=JSON.parse(JSON.stringify(e.toks||[])); if(!toks.length){ op({k:"rsv-",id:e.id}); return; }
      const enemies=state.tokens.filter(t=>t.owner!==2), enemyDz=(state.dz||[])[0];
      const tal=wp6Tallies(), spots=[];
      for(let x=3;x<state.board.w-2;x+=3){ spots.push([x,3],[x,state.board.h-3]); }
      for(let y=3;y<state.board.h-2;y+=3){ spots.push([3,y],[state.board.w-3,y]); }
      spots.sort((a,b)=>aiResSpotScore(b[0],b[1],tal)-aiResSpotScore(a[0],a[1],tal));
      const cx=toks.reduce((s,t)=>s+t.x,0)/toks.length, cy=toks.reduce((s,t)=>s+t.y,0)/toks.length;
      for(const [sx,sy] of spots){
        const moved=toks.map(t=>Object.assign({},t,{x:t.x+sx-cx,y:t.y+sy-cy}));
        if(wp7ArriveIllegal(moved,!!e.ds,round,state.board,enemyDz,enemies)) continue;
        if(!moved.every(t=>!wp5Illegal(t)&&t.x>tokRadius(t)&&t.y>tokRadius(t)
          &&t.x<state.board.w-tokRadius(t)&&t.y<state.board.h-tokRadius(t)
          &&state.tokens.every(o=>edgeDist(t,o)>0.02))) continue;
        op({k:"rsv-",id:e.id});
        op({k:"tok+",toks:moved});
        logShared(`🤖 AI brings <b>${esc(e.name)}</b> in from Strategic Reserves`,"sys");
        return;
      }
      logSys("🤖 No legal arrival spot for "+e.name+" this turn — it waits in Reserves.");
    });
  });
}
function aiMovement(round){
  aiArriveReserves(round);
  aiUnits(2).forEach(u=>aiEnqueue(()=>aiMoveUnit(u.uk)));
}

/* ---- Shooting phase: real Attack-tab dice, staged programmatically ---- */
function aiMainWeapon(ranged){
  // Approximation (see help): the unit's standard armament — the volume-of-fire profile
  // (highest attacks, then lowest damage, i.e. the basic gun, not the one-per-squad special)
  // fires once per model; every other profile fires once per unit.
  const basic=ranged.filter(w=>!/pistol|grenade/i.test(w.n+" "+w.ab));
  const pool=basic.length?basic:ranged;
  return pool.reduce((a,b)=>{
    const aa=aiAvgDice(a.A), bb=aiAvgDice(b.A);
    if(bb!==aa) return bb>aa?b:a;
    return aiAvgDice(b.D)<aiAvgDice(a.D)?b:a;
  });
}
function aiMulA(spec,n){ // per-model attacks × model count: "2"×5→"10", "D6"×5→"5D6", "2D6+1"×3→"6D6+3"
  spec=String(spec).trim().toUpperCase();
  if(n<=1) return spec;
  const m=spec.match(/^(\d*)D(3|6)([+-]\d+)?$/);
  if(m){ const add=(+(m[3]||0))*n; return ((+(m[1]||1))*n)+"D"+m[2]+(add>0?"+"+add:add<0?String(add):""); }
  const v=parseInt(spec); return isNaN(v)?spec:String(v*n);
}
function aiFireWeapon(atkUk,atkMs,w,shooters,tgt,los){
  const g=id=>document.getElementById(id);
  const vals=["akA","akBS","akS","akAP","akD","akHitMod","akWndMod","akRrHit","akRrWnd","akSus","akAnti","tgT","tgSv","tgInv","tgFNP"];
  const chks=["akLethal","akTwin","akDev","tgCover"];
  const saved={},savedC={},savedLabel=wp3Label;
  vals.forEach(i=>saved[i]=g(i).value); chks.forEach(i=>savedC[i]=g(i).checked);
  const ab=wp3ParseAbilities(w.ab), t0=tgt.toks[0];
  let A=String(w.A).toUpperCase();
  if(ab.rapid&&!w.melee&&los.dist<=w.rng/2+0.02) A=wp3AddA(A,ab.rapid);
  if(ab.blast){ const b=Math.floor(tgt.toks.length/5); if(b) A=wp3AddA(A,b); }
  A=aiMulA(A,shooters);
  g("akA").value=A;
  const bs=String(w.BS).match(/^(\d)\+?$/);
  g("akBS").value=(ab.torrent||!bs)?"auto":bs[1]+"+";
  g("akS").value=parseInt(w.S)||0;
  const apv=String(-Math.abs(parseInt(w.AP)||0));
  g("akAP").value=["0","-1","-2","-3","-4","-5"].includes(apv)?apv:"-5";
  g("akD").value=w.D;
  g("akHitMod").value="0"; g("akWndMod").value="0";
  g("akRrHit").value="none"; g("akRrWnd").value="none";
  g("akLethal").checked=ab.lethal; g("akTwin").checked=ab.twin; g("akDev").checked=ab.dev;
  g("akSus").value=ab.sus;
  const anti=ab.anti.find(a=>tokKw(t0).includes(a.kw));
  g("akAnti").value=(anti&&anti.v>=2&&anti.v<=5)?String(anti.v):"0";
  if(t0.T) g("tgT").value=t0.T;
  const sv=String(t0.Sv||"").match(/^([2-6])\+?$/);
  g("tgSv").value=sv?sv[1]+"+":"7";
  const iv=String(t0.iv||"").match(/^([3-6])\+?$/);
  g("tgInv").value=iv?iv[1]:"0";
  g("tgFNP").value="0";
  g("tgCover").checked=!!(los&&los.cover&&!w.melee);
  const atkCard=aiCardFor(atkMs[0]), tgtCard=aiCardFor(t0);
  const atkName=(atkCard&&atkCard.name)||atkMs[0].name, tgtName=(tgtCard&&tgtCard.name)||t0.name;
  logShared(`🤖 AI: <b>${esc(atkName)}</b> ${w.melee?"fights":"shoots"} <b>${esc(tgtName)}</b> with ${esc(w.n)}${shooters>1?" ×"+shooters:""} (${w.melee?"engaged":los.dist.toFixed(1)+'"'}${los.cover&&!w.melee?", target in cover":""})`,"sys");
  wp3Label=`⚔ AI: ${atkName} → ${tgtName} · ${w.n}${shooters>1?" ×"+shooters:""}`;
  aiActing=true; aiCurTgt=tgt.uk; aiCurAtk=atkUk;
  const prevName=myName; myName=state.names[2]||"AI";
  try{ rollAttack(); }
  finally{
    myName=prevName;
    aiActing=false; aiCurTgt=null; aiCurAtk=null;
    wp3Label=savedLabel;                                    // no leftover staged state
    vals.forEach(i=>g(i).value=saved[i]); chks.forEach(i=>g(i).checked=savedC[i]);
    const st=g("akStage"); if(st) st.style.display="none";
  }
}
function aiShootUnit(uk){
  const ms=state.tokens.filter(t=>t.unit===uk); if(!ms.length) return;
  if(aiMoved[uk]&&aiMoved[uk].advanced) return;              // advanced — no shooting
  const W=aiWeapons(ms); if(!W.ranged.length) return;
  const main=aiMainWeapon(W.ranged);
  W.ranged.forEach(w=>{
    aiEnqueue(()=>{
      const ms2=state.tokens.filter(t=>t.unit===uk); if(!ms2.length) return;
      const shooters=(w===main)?ms2.length:1;
      let best=null;
      aiUnits(1).forEach(e=>{
        if(!e.toks.length) return;
        const los=losCheckUnits(uk,e.uk);
        if(!los||!los.vis||los.dist>w.rng+0.02) return;
        const exp=aiExpDamage(w,shooters,e.toks,los.dist,!!los.cover);
        if(exp<AI_TUNE.minShootExp) return;
        let sc=aiTargetScore(e,exp);
        // --- army-level focus fire: once the army commits damage to a unit this phase, pull the
        //     rest of the guns onto it until it's REMOVED, rather than re-picking the raw-juiciest
        //     fresh target every volley (which leaves half-dead units all over the board). ---
        const curW=e.toks.reduce((a,t)=>a+(t.wounds||1),0), committed=aiFocus[e.uk]||0;
        if(curW>0&&committed>0){
          // Gentle nudge (not an override): among targets of comparable value, prefer FINISHING one
          // the army has already committed to, so guns don't scatter and leave half-dead units. Kept
          // small on purpose — base value (pts/wound, on-objective) still leads target choice; an
          // over-aggressive "finish it" bonus dumped good guns into cheap chaff (measured net-negative).
          if(committed+exp>=curW) sc*=1.4;                                    // in-progress kill this volley completes
          else sc*=1+0.3*Math.min(1,(committed+exp)/curW);                   // in-progress kill, pile a bit more on
        }
        if(!best||sc>best.sc) best={e,los,sc,exp};
      });
      if(!best) return;
      aiFocus[best.e.uk]=(aiFocus[best.e.uk]||0)+best.exp;   // credit committed damage so later shooters finish this unit
      aiShotLog.push({atk:uk,tgt:best.e.uk,dist:best.los.dist,rng:w.rng,vis:best.los.vis,weapon:w.n});
      aiFireWeapon(uk,ms2,w,shooters,best.e,best.los);
    });
  });
}
function aiShooting(){ aiFocus={}; aiUnits(2).forEach(u=>aiEnqueue(()=>aiShootUnit(u.uk))); }

/* ---- Charge + Fight phases ---- */
function aiClosestPair(aToks,bToks){
  let best=[aToks[0],bToks[0]], d=Infinity;
  aToks.forEach(a=>bToks.forEach(b=>{ const e=edgeDist(a,b); if(e<d){d=e;best=[a,b];} }));
  return best;
}
function aiChargeUnit(uk){
  const ms=state.tokens.filter(t=>t.unit===uk); if(!ms.length) return;
  if(aiMoved[uk]&&aiMoved[uk].advanced) return;              // advanced units can't charge
  if(ms.every(t=>t.bs)) return;                              // battle-shocked units play safe
  const W=aiWeapons(ms); if(!W.melee.length) return;
  let best=null;
  aiUnits(1).forEach(e=>{
    if(!e.toks.length) return;
    const d=wp3UnitDist(ms,e.toks);
    if(d>12.02||d<=2.02) return;   // 11th-ed: skip enemies already within 2" engagement range
    const los=losCheckUnits(uk,e.uk);
    if(!los||!los.vis) return;
    const exp=Math.max(...W.melee.map(w=>aiExpDamage(w,ms.length,e.toks,0,false)));
    const profit=exp*AI_TUNE.chargeGain-aiMeleeThreat(e.toks,ms);
    if(profit>0&&(!best||profit>best.profit)) best={e,d,profit};
  });
  if(!best) return;
  const a=aiD6(),b=aiD6(),roll=a+b;                          // real charge roll (AI dice)
  if(roll+2.02<best.d){                                       // 11th-ed: charge succeeds if it can END within 2" engagement range
    logShared(`🎲 🤖 AI charge: <b>${esc(ms[0].name)}</b> → <b>${esc(best.e.toks[0].name)}</b> needs ${best.d.toFixed(1)}", rolled ${a}+${b}=${roll} — <b>failed</b>`,"dice");
    return;
  }
  const [am,bm]=aiClosestPair(ms,best.e.toks);
  // move toward contact, but never further than the charge roll (each model moves up to `roll`")
  const need=Math.min(roll,Math.max(0,edgeDist(am,bm)-0.15)), dd=Math.hypot(bm.x-am.x,bm.y-am.y)||1;
  if(aiTryTranslate(ms,(bm.x-am.x)/dd*need,(bm.y-am.y)/dd*need,state.tokens.filter(t=>t.owner===1),true)){
    aiMoved[uk]=Object.assign(aiMoved[uk]||{},{charged:true});
    logShared(`🎲 🤖 AI charge: <b>${esc(ms[0].name)}</b> → <b>${esc(best.e.toks[0].name)}</b> rolled ${a}+${b}=${roll} vs ${best.d.toFixed(1)}" — <b>made it</b> (base contact approximation)`,"dice");
  } else {
    logShared(`🎲 🤖 AI charge: <b>${esc(ms[0].name)}</b> rolled ${a}+${b}=${roll} but can't fit into contact — stays put`,"dice");
  }
}
function aiCharges(){ aiUnits(2).forEach(u=>aiEnqueue(()=>aiChargeUnit(u.uk))); }
function aiFightUnit(uk){
  const ms=state.tokens.filter(t=>t.unit===uk); if(!ms.length) return;
  const W=aiWeapons(ms); if(!W.melee.length) return;
  let best=null;
  aiUnits(1).forEach(e=>{
    if(!e.toks.length||wp3UnitDist(ms,e.toks)>2.02) return;   // 11th-ed: can fight anything within 2" engagement range
    const w=W.melee.reduce((a2,b2)=>aiExpDamage(b2,ms.length,e.toks,0,false)>aiExpDamage(a2,ms.length,e.toks,0,false)?b2:a2);
    const sc=aiTargetScore(e,aiExpDamage(w,ms.length,e.toks,0,false));
    if(!best||sc>best.sc) best={e,w,sc};
  });
  if(!best) return;
  const engaged=Math.max(1,ms.filter(t=>best.e.toks.some(b2=>edgeDist(t,b2)<=2.02)).length); // within 1", or 1" of those (approx 2")
  aiShotLog.push({atk:uk,tgt:best.e.uk,dist:0,rng:1,vis:true,weapon:best.w.n,melee:true});
  aiFireWeapon(uk,ms,best.w,engaged,best.e,{dist:0,vis:true,cover:false});
  logSys("Your engaged units can strike back — fights alternate; roll yours from the inspector (⚔ on a melee weapon).");
}
function aiFights(){ aiUnits(2).forEach(u=>aiEnqueue(()=>aiFightUnit(u.uk))); }
function aiEndTurn(){
  const tal=wp6Tallies();
  const n1=tal.filter(x=>x.holder===1).length, n2=tal.filter(x=>x.holder===2).length;
  logShared(`🤖 <b>End of AI turn</b> — objectives: <b style="color:var(--p1)">${esc(state.names[1]||"P1")}</b> ${n1}, <b style="color:var(--p2)">${esc(state.names[2]||"AI")}</b> ${n2} · score VP per your mission (buttons above)`,"sys");
}

/* ---- solo auto-casualties (both sides' attacks; hooked at the end of rollAttack) ---- */
function aiNoteStage(ctx0,tgtTok){ // wp3Stage hook: remember the player's staged attacker→target
  aiStagedAtk=(ctx0&&ctx0.tok&&ctx0.tok.unit)||null;
  aiStagedTgt=(tgtTok&&tgtTok.unit)||null;
}
function aiApplyCasualties(tgtUk,packets,budget,atkUk){
  // Allocation: already-wounded model first, then closest to the attacker, sgt/CHARACTER
  // last. One packet = one failed save's damage (or one mortal wound): excess is lost.
  const atkMs=state.tokens.filter(t=>t.unit===atkUk);
  const ax=atkMs.length?atkMs.reduce((s,t)=>s+t.x,0)/atkMs.length:0;
  const ay=atkMs.length?atkMs.reduce((s,t)=>s+t.y,0)/atkMs.length:0;
  const live=state.tokens.filter(t=>t.unit===tgtUk).map(t=>({t,w:t.wounds||1}));
  if(!live.length) return;
  const name=live[0].t.name;
  const cmp=(a,b)=>{
    const la=(a.t.sgt||tokKw(a.t).includes("CHARACTER"))?1:0, lb=(b.t.sgt||tokKw(b.t).includes("CHARACTER"))?1:0;
    if(la!==lb) return la-lb;
    const wa=a.w<(a.t.maxW||1)?0:1, wb=b.w<(b.t.maxW||1)?0:1;
    if(wa!==wb) return wa-wb;
    if(!atkMs.length) return 0;
    return Math.hypot(a.t.x-ax,a.t.y-ay)-Math.hypot(b.t.x-ax,b.t.y-ay);
  };
  let applied=0;
  for(const pkt of packets){
    if(applied>=budget) break;
    const alive=live.filter(x=>x.w>0);
    if(!alive.length) break;
    alive.sort(cmp);
    const cur=alive[0];
    const use=Math.min(pkt,cur.w,budget-applied);            // in-packet excess is lost
    cur.w-=use; applied+=use;
  }
  const updates=[],removals=[];
  live.forEach(x=>{ if(x.w<=0) removals.push(x.t.id); else if(x.w!==(x.t.wounds||1)) updates.push({id:x.t.id,wounds:x.w}); });
  if(updates.length) op({k:"tok~",toks:updates});
  if(removals.length) op({k:"tok-",ids:removals});
  const gone=!state.tokens.some(t=>t.unit===tgtUk);
  /* ==== WP16 ==== the apply-damage button reuses this allocator outside solo; wp16LogAs labels the shared log line by player */
  const who=(typeof wp16LogAs==="string"&&wp16LogAs)||"Solo";
  logShared(`💥 ${who}: ${applied} damage applied to <b>${esc(name)}</b>${removals.length?` — ${removals.length} model${removals.length!==1?"s":""} slain`:""}${gone?" — <b>unit destroyed</b>":""}`,"sys");
  /* ==== end WP16 ==== */
}
function wp10AttackDone(final,failed,mortals,dmgRolls){ // rollAttack hook (solo only)
  if(!solo) return;
  let tgtUk=null, atkUk=null, auto=false;
  if(aiActing){ tgtUk=aiCurTgt; atkUk=aiCurAtk; auto=true; }
  else if(wp3Label&&aiStagedTgt){ tgtUk=aiStagedTgt; atkUk=aiStagedAtk; }  // player's staged attack
  if(!tgtUk||final<=0||!state.tokens.some(t=>t.unit===tgtUk)) return;
  if(typeof wp11MaybeAlloc==="function"&&wp11MaybeAlloc(tgtUk,atkUk,final,failed,mortals,dmgRolls)) return; /* ==== WP11: the defender allocates their own casualties ==== */
  const tname=(state.tokens.find(t=>t.unit===tgtUk)||{}).name||"the target";
  if(!auto&&!confirm(`Solo mode: apply ${final} damage to ${tname} automatically?\n(Already-wounded model first, closest to the attacker next, leaders last.)`)) return;
  let packets=[];
  if(dmgRolls&&dmgRolls.length===failed&&failed>0) packets=dmgRolls.slice(); // real per-save D rolls
  else{ const flat=Math.max(1,parseInt(String(document.getElementById("akD").value).trim())||1);
    packets=new Array(Math.max(0,failed)).fill(flat); }
  for(let i=0;i<mortals;i++) packets.push(1);                // mortal wounds apply one at a time
  aiApplyCasualties(tgtUk,packets,final,atkUk);
}
/* ==== end WP10 ==== */

/* ==== WP11: allocation + doctrine ==== solo polish in two halves.
   A. The DEFENDER allocates casualties (the actual 40k rule): when an AI attack damages
      the player's unit, the AI queue pauses and the player clicks models to assign each
      damage packet; an already-wounded model must take them first. All results go through
      op(); the pending queue itself is module-side (transient — never synced, never saved).
   B. Meta doctrine: five embedded GT-winning lists (unit names/sizes/points only), plan
      profiles read from the list's Force Disposition, and doctrine behaviours layered onto
      WP10's scoring via the wp11* hooks. Sources: ~/WH40k/Notes/"11th Edition Tournament
      Meta - Living Notes.md" and ~/WH40k/Army Guides/"Space Marines - Iron Hands 2000pt
      Tournament Guide.md" (cited per behaviour below, own words only). */

/* ---- Part A: defender casualty allocation ---- */
let wp11Alloc=null; // {tgtUk,atkUk,packets:[],applied,budget,label} — transient, module-side by design
/* ==== WP-MODELFIX: wp11LooseCount (formerly: "trust every Nx line as a model line during meta
   muster") is RETIRED — it's what caused the AI solo-muster to count wargear lines as models on
   full BCP exports (~238 tokens for a ~80-model Sororitas list). importArmyList()/wp11ParseList()
   now count models the same correct way on both paths (see wp11CountUnitModels above), so no
   "trust everything" escape hatch is needed for the meta-muster path any more. ==== */
function wp11Pending(){ return !!wp11Alloc; }
function wp11AutoOn(){ const c=document.getElementById("wp11AutoCas"); return !!(c&&c.checked); }
function wp11MaybeAlloc(tgtUk,atkUk,final,failed,mortals,dmgRolls){
  // Called from wp10AttackDone. True = WP11 takes over (player-owned defender, toggle off).
  if(!solo) return false;
  const t0=state.tokens.find(t=>t.unit===tgtUk);
  if(!t0||t0.owner!==1) return false;     // AI-owned casualties stay automatic — the AI is the defender there and allocates by the same rule
  if(wp11AutoOn()) return false;          // Setup toggle: restore the hands-off behaviour
  // Packets exactly as the auto path builds them: one failed save's damage each, mortals one at a time
  let packets=[];
  if(dmgRolls&&dmgRolls.length===failed&&failed>0) packets=dmgRolls.slice();
  else{ const flat=Math.max(1,parseInt(String(document.getElementById("akD").value).trim())||1);
    packets=new Array(Math.max(0,failed)).fill(flat); }
  for(let i=0;i<mortals;i++) packets.push(1);
  if(!packets.length) return false;
  wp11Alloc={tgtUk,atkUk,packets,applied:0,budget:final,label:String(wp3Label||"Incoming attack").replace(/^⚔\s*/,"")};
  wp11Banner();
  if(typeof wp13BoardFocus==="function") wp13BoardFocus(); /* ==== WP13 ==== phone: board must be visible to click-allocate */
  logSys("Casualty allocation: "+packets.length+" damage packet"+(packets.length!==1?"s":"")+" pending against "+t0.name+" — click models in that unit (a wounded model must take them first), or press A to auto-assign the rest.");
  return true;
}
function wp11Banner(){
  const el=document.getElementById("wp11Banner"); if(!el) return;
  const a=wp11Alloc;
  if(!a){ el.style.display="none"; el.innerHTML=""; return; }
  const left=a.packets.length, next=a.packets[0];
  const tname=(state.tokens.find(t=>t.unit===a.tgtUk)||{}).name||"target unit";
  const rem=Math.min(a.packets.reduce((s,p)=>s+p,0),a.budget-a.applied);
  el.style.display="block";
  /* ==== WP18 ==== one-line suggestion (the full order is ringed/badged on the board) */
  let sugg="";
  if(typeof wp18SuggOrder==="function"){ const o=wp18SuggOrder(a); if(o.length) sugg=`<br><span class="small">💡 Suggested next: ${esc(o[0].name)} (wounded first / closest)</span>`; }
  /* ==== end WP18 ==== */
  el.innerHTML=`💥 <b>${esc(a.label)}</b> — <b>${left}</b> packet${left!==1?"s":""} (${rem} dmg) to allocate to <b>${esc(tname)}</b>`
    +`<br><span class="small">Click your models in the unit — next packet: ${next} dmg · wounded model first (the rule) · <kbd>A</kbd> = auto-assign rest</span>`
    +sugg /* ==== WP18 ==== */
    +`<button onclick="wp11AllocAuto()">A · Auto-assign</button>`;
}
function wp11AllocClick(ix,iy){
  const a=wp11Alloc; if(!a) return;
  const tk=hitToken(ix,iy);
  const tname=(state.tokens.find(t=>t.unit===a.tgtUk)||{}).name||"the target unit";
  if(!tk||tk.unit!==a.tgtUk){ logSys("Allocate the pending damage first — click a model in "+tname+", or press A to auto-assign."); return; }
  // Core allocation law: while a model in the unit has already lost wounds, it must take the packets
  let tgt=tk;
  const wounded=state.tokens.find(t=>t.unit===a.tgtUk&&(t.wounds||1)<(t.maxW||1));
  if(wounded&&wounded.id!==tk.id){ tgt=wounded; logSys("Damage redirected to "+tgt.name+" — the unit's already-wounded model must be allocated first."); }
  wp11ApplyPacket(tgt);
}
function wp11ApplyPacket(tok){
  const a=wp11Alloc; if(!a||!a.packets.length) return;
  const pkt=a.packets.shift();
  const use=Math.min(pkt,tok.wounds||1,a.budget-a.applied);   // in-packet excess is lost; total capped at the rolled result
  a.applied+=use;
  const w=(tok.wounds||1)-use;
  if(w<=0) op({k:"tok-",ids:[tok.id]});
  else op({k:"tok~",toks:[{id:tok.id,wounds:w}]});
  logShared(`💥 <b>${esc(state.names[mySide]||("P"+mySide))}</b> allocates ${use} dmg → <b>${esc(tok.name)}</b>${w<=0?" — <b>slain</b>":` (${w}/${tok.maxW||1} W)`}`,"sys"); /* ==== WP18 ==== was names[1]: in a P2P game the defender can be side 2 (solo forces mySide=1, so solo output is unchanged) */
  wp11AllocDone(false);
}
function wp11AllocAuto(){ // A key / banner button: identical result to WP10's automatic allocation
  const a=wp11Alloc; if(!a) return;
  const packets=a.packets.slice(); a.packets=[];
  if(packets.length) aiApplyCasualties(a.tgtUk,packets,a.budget-a.applied,a.atkUk); // wounded first, closest next, sgt/CHARACTER last
  a.applied=a.budget;
  wp11AllocDone(true);
}
function wp11AllocDone(auto){
  const a=wp11Alloc; if(!a) return;
  const alive=state.tokens.some(t=>t.unit===a.tgtUk);
  if(a.packets.length&&a.applied<a.budget&&alive){ wp11Banner(); draw(); return; }  // still owed
  if(!auto) logShared(`💥 Allocation complete — ${a.applied} damage applied${alive?"":" — <b>unit destroyed</b>"}`,"sys");
  wp11Alloc=null; wp11Banner(); draw();
  aiPump();                                                    // resume the paused AI action queue
}
function wp11AllocDiscard(){ // clear / load / undo / solo-off: pending damage is dropped, never half-applied
  if(!wp11Alloc) return;
  wp11Alloc=null; wp11Banner();
  logSys("Pending casualty allocation discarded.");
}
window.addEventListener("keydown",e=>{ /* ==== WP11: A auto-assigns pending packets (own listener; shared handler untouched) ==== */
  if(!wp11Alloc||e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
  if(e.key==="a"||e.key==="A"){ e.preventDefault(); wp11AllocAuto(); }
});

/* ---- Part B: the AI reads the meta ---- */
/* Five real GT-winning lists from 11th edition's first two weekends, embedded at build time
   (game-functional data only: unit names, model counts, points, detachment/disposition names). */
const AI_META_LISTS=[
  {name:"Adepta Sororitas — Hallowed Martyrs (Ketcham, GT winner)",fid:"AS",disposition:"Priority Assets",
   blurb:"Paragon Warsuit + elite melee deathball — punishes armies without focused anti-elite firepower.",
   text:"HM PA (2000 points)\nAdepta Sororitas\nStrike Force (2000 points)\nHallowed Martyrs (3 Detachment Points)\nForce Dispositions: Priority Assets\n\nAttached Units\n\nAttached Unit 1\nMorvenn Vahl (185 points)\n• Attached as: Leader (Character)\n• Warlord\n• 1x Fidelis\n• 1x Lance of Illumination\n• 1x Paragon missile launcher\nParagon Warsuits (210 points)\n• Attached as: Bodyguard\n• 1x Paragon Superior\n  • 1x Bolt pistol\n  • 1x Multi-melta\n  • 1x Paragon grenade launchers\n  • 1x Paragon war mace\n• 2x Paragon\n  • 2x Bolt pistol\n  • 2x Multi-melta\n  • 2x Paragon grenade launchers\n  • 2x Paragon war mace\n\nAttached Unit 2\nMinistorum Priest (50 points)\n• Attached as: Leader (Character)\n• 1x Zealot's vindictor\nCelestian Insidiants (120 points)\n• Attached as: Bodyguard\n• 1x Celestian Insidiant Superior\n  • 1x Inferno pistol\n  • 1x Null mace\n• 9x Celestian Insidiant\n  • 2x Blessed sword\n  • 3x Condemnor bolt pistol\n  • 1x Denuncia oratory\n  • 2x Ministorum hand flamer\n  • 6x Null mace\n  • 1x Simulacrum Imperialis\n  • 1x Virge of admonition\n\nAttached Unit 3\nPalatine (75 points)\n• Attached as: Leader (Character)\n• 1x Palatine blade\n• 1x Plasma pistol\n• Enhancement: Through Suffering, Strength\nCelestian Sacresants (150 points)\n• Attached as: Bodyguard\n• 1x Sacresant Superior\n  • 1x Anointed halberd\n  • 1x Inferno pistol\n• 9x Celestian Sacresant\n  • 9x Anointed halberd\n  • 9x Bolt pistol\n\nCHARACTERS\nCanoness (70 points)\n• 1x Condemnor boltgun\n• 1x Hallowed chainsword\n• 1x Null Rod\n• Enhancement: Saintly Example\nDaemonifuge (85 points)\n• 1x Ephrael Stern\n  • 1x Bolt pistol\n  • 1x Sanctity\n• 1x Kyganil of the Bloody Tears\n  • 1x The Outcast's Weapons\nTriumph of Saint Katherine (245 points)\n• 1x Bolt pistols\n• 1x Relic weapons\n\nBATTLELINE\nBattle Sisters Squad (100 points)\n• 1x Sister Superior\n  • 1x Bolt pistol\n  • 1x Close combat weapon\n  • 1x Ministorum hand flamer\n  • 1x Power weapon\n• 9x Battle Sister\n  • 9x Bolt pistol\n  • 7x Boltgun\n  • 9x Close combat weapon\n  • 1x Ministorum flamer\n  • 1x Ministorum heavy flamer\n  • 1x Simulacrum Imperialis\n\nDEDICATED TRANSPORTS\nImmolator (110 points)\n• 1x Armoured tracks\n• 1x Heavy bolter\n• 1x Hunter-killer missile\n• 1x Immolation flamers\nSororitas Rhino (75 points)\n• 1x Armoured tracks\n• 1x Hunter-killer missile\n• 1x Storm bolter\nSororitas Rhino (75 points)\n• 1x Armoured tracks\n• 1x Hunter-killer missile\n• 1x Storm bolter\n\nOTHER DATASHEETS\nArco-flagellants (50 points)\n• 3x Arco-flagellant\n• 3x Arco-flails\nArco-flagellants (50 points)\n• 3x Arco-flagellant\n• 3x Arco-flails\nCelestian Insidiants (120 points)\n• 1x Celestian Insidiant Superior\n  • 1x Inferno pistol\n  • 1x Null mace\n• 9x Celestian Insidiant\n  • 2x Blessed sword\n  • 3x Condemnor bolt pistol\n  • 1x Denuncia oratory\n  • 2x Ministorum hand flamer\n  • 6x Null mace\n  • 1x Simulacrum Imperialis\n  • 1x Virge of admonition\nCelestian Insidiants (120 points)\n• 1x Celestian Insidiant Superior\n  • 1x Inferno pistol\n  • 1x Null mace\n• 9x Celestian Insidiant\n  • 2x Blessed sword\n  • 3x Condemnor bolt pistol\n  • 1x Denuncia oratory\n  • 2x Ministorum hand flamer\n  • 6x Null mace\n  • 1x Simulacrum Imperialis\n  • 1x Virge of admonition\nSanctifiers (110 points)\n• 1x Miraculist\n  • 1x Burning hands\n  • 1x Holy fire\n• 1x Salvationist\n  • 1x Close combat weapon\n  • 1x Salvationist Medikit\n• 1x Death Cult Assassin\n  • 1x Death Cult blades\n• 2x Missionary\n  • 1x Holy fire\n  • 1x Ministorum flamer\n  • 1x Plasma gun\n  • 2x Sanctifier melee weapon\n• 4x Sanctifier\n  • 2x Close combat weapon\n  • 5x Ministorum hand flamer\n  • 2x Sanctifier melee weapon\n  • 1x Simulacrum Imperialis"},
  {name:"T'au Empire — Advanced Acquisition Cadre / Kauyon (Martin, GT winner)",fid:"TAU",disposition:"Priority Assets",
   blurb:"Triple-Riptide firebase behind Kauyon markerlights — punishes exposed high-value targets turns 1–2.",
   text:"Kauyon (1995 points)\nT'au Empire\nStrike Force (2000 points)\nAdvanced Acquisition Cadre and Kauyon (3 Detachment Points)\nForce Disposition: Priority Assets\n\nCHARACTERS\nCommander in Coldstar Battlesuit (115 points)\n• 1x Battlesuit fists\n• 4x Missile pod\n• 2x Shield Drone\n• Enhancement: Exemplar of the Kauyon\nEthereal (50 points)\n• Warlord\n• 1x Honour stave\n• 1x Hover Drone\n• 2x Shield Drone\nEthereal (50 points)\n• 1x Honour stave\n• 1x Hover Drone\n• 2x Shield Drone\nThe Twin Lance (205 points)\n• 1x Ri'Lantar\n  • 1x Fusion eliminator\n  • 1x MV15 Gun Drone\n  • 1x Shardstorm burst system\n  • 1x XV pulse pistol\n• 1x Ri'Locai\n  • 1x Ion scattercannon\n  • 1x MV15 Gun Drone\n  • 1x Shardstorm burst system\n  • 1x XV pulse pistol\n\nOTHER DATASHEETS\nCrisis Fireknife Battlesuits (130 points)\n• 1x Crisis Fireknife Shas'vre\n  • 1x Battlesuit fists\n  • 1x Gun Drone\n  • 2x Missile pod\n  • 1x Shield Drone\n• 2x Crisis Fireknife Shas'ui\n  • 2x Battlesuit fists\n  • 2x Gun Drone\n  • 4x Missile pod\n  • 2x Shield Drone\nGhostkeel Battlesuit (175 points)\n• 1x Battlesuit Support System\n• 1x Cyclic ion raker\n• 1x Ghostkeel fists\n• 1x Twin T'au flamer\n• Enhancement: Unmasking Suite (Upgrade)\nPathfinder Team (80 points)\n• 1x Pathfinder Shas'ui\n  • 1x Close combat weapon\n  • 1x Grav-inhibitor Drone\n  • 1x Pulse carbine\n  • 1x Pulse pistol\n  • 1x Semi-automatic grenade launcher\n  • 2x Shield Drone\n• 9x Pathfinder\n  • 9x Close combat weapon\n  • 6x Pulse carbine\n  • 9x Pulse pistol\n  • 3x Rail rifle\nPathfinder Team (80 points)\n• 1x Pathfinder Shas'ui\n  • 1x Close combat weapon\n  • 1x Grav-inhibitor Drone\n  • 1x Pulse carbine\n  • 1x Pulse pistol\n  • 1x Semi-automatic grenade launcher\n  • 2x Shield Drone\n• 9x Pathfinder\n  • 9x Close combat weapon\n  • 6x Pulse carbine\n  • 9x Pulse pistol\n  • 3x Rail rifle\nRiptide Battlesuit (200 points)\n• 1x Ion accelerator\n• 2x Missile Drone\n• 1x Riptide fists\n• 1x Twin smart missile system\nRiptide Battlesuit (200 points)\n• 1x Ion accelerator\n• 2x Missile Drone\n• 1x Riptide fists\n• 1x Twin smart missile system\nRiptide Battlesuit (230 points)\n• 1x Ion accelerator\n• 2x Missile Drone\n• 1x Riptide fists\n• 1x Twin smart missile system\nSky Ray Gunship (140 points)\n• 2x Accelerator burst cannon\n• 1x Armoured hull\n• 1x Seeker missile rack\nSky Ray Gunship (140 points)\n• 2x Accelerator burst cannon\n• 1x Armoured hull\n• 1x Seeker missile rack\nStealth Battlesuits (100 points)\n• 1x Stealth Shas'vre\n  • 1x Battlesuit fists\n  • 1x Fusion blaster\n  • 1x Gun Drone\n  • 1x Marker Drone\n  • 1x Pulse pistol\n• 4x Stealth Shas'ui\n  • 4x Battlesuit fists\n  • 3x Burst cannon\n  • 1x Fusion blaster\n  • 1x Homing Beacon\nStealth Battlesuits (100 points)\n• 1x Stealth Shas'vre\n  • 1x Battlesuit fists\n  • 1x Fusion blaster\n  • 1x Gun Drone\n  • 1x Marker Drone\n  • 1x Pulse pistol\n• 4x Stealth Shas'ui\n  • 4x Battlesuit fists\n  • 3x Burst cannon\n  • 1x Fusion blaster\n  • 1x Homing Beacon"},
  {name:"Dark Angels — Dark Age Arsenal / Company of Hunters (Chesnick)",fid:"SM",disposition:"Disruption",
   blurb:"Ravenwing bike swarm + drop-pod plasma — punishes slow armies that cannot answer fast multi-axis threats.",
   text:"Motorized Scooters (1,985 Points)\nSpace Marines\nDark Angels\nCompany of Hunters and Dark Age Arsenal (3 Detachment Points)\nForce Dispositions: Disruption, Priority Assets\nStrike Force (2,000 Points)\n\nATTACHED UNITS\n\nAttached unit 1\nAzrael (140 Points)\n• Attached as: Leader (Character)\n• Warlord\n• 1x Lion's Wrath\n• 1x The Lion Helm\n• 1x The Sword of Secrets\nLieutenant (45 Points)\n• Attached as: Support (Character)\n• 1x Heavy bolt pistol\n• 1x Plasma pistol\n• 1x Power fist\nHellblaster Squad (235 Points)\n• Attached as: Bodyguard\n• 1x Hellblaster Sergeant\n  • 1x Close combat weapon\n  • 1x Plasma incinerator\n  • 1x Plasma pistol\n• 9x Hellblaster\n  • 9x Bolt pistol\n  • 9x Close combat weapon\n  • 9x Plasma incinerator\n\nAttached unit 2\nRavenwing Command Squad (135 Points)\n• Attached as: Leader (Character)\n• 1x Ravenwing Champion\n  • 1x Bolt pistol\n  • 1x Master-crafted power weapon\n  • 1x Plasma talon\n  • Enhancements: Recon Hunter\n• 1x Ravenwing Apothecary\n  • 1x Black Knight combat weapon\n  • 1x Bolt pistol\n  • 1x Plasma talon\n• 1x Ravenwing Ancient\n  • 1x Black Knight combat weapon\n  • 1x Bolt pistol\n  • 1x Plasma talon\nOutrider Squad (70 Points)\n• Attached as: Bodyguard\n• 1x Outrider Sergeant\n  • 1x Astartes chainsword\n  • 1x Heavy bolt pistol\n  • 1x Twin bolt rifle\n• 2x Outrider\n  • 2x Astartes chainsword\n  • 2x Heavy bolt pistol\n  • 2x Twin bolt rifle\n\nAttached unit 3\nSammael (105 Points)\n• Attached as: Leader (Character)\n• 1x Bolt Pistol\n• 1x Master-crafted plasma cannon\n• 1x The Raven Sword\n• 1x Twin storm bolter\nRavenwing Black Knights (165 Points)\n• Attached as: Bodyguard\n• 1x Ravenwing Huntmaster\n  • 1x Black Knight combat weapon\n  • 1x Bolt pistol\n  • 1x Plasma talon\n• 5x Ravenwing Black Knight\n  • 5x Black Knight combat weapon\n  • 5x Bolt pistol\n  • 5x Plasma talon\n\nAttached unit 4\nRavenwing Command Squad (130 Points)\n• Attached as: Leader (Character)\n• 1x Ravenwing Champion\n  • 1x Bolt pistol\n  • 1x Master-crafted power weapon\n  • 1x Plasma talon\n  • Enhancements: Master of Manoeuvre\n• 1x Ravenwing Apothecary\n  • 1x Black Knight combat weapon\n  • 1x Bolt pistol\n  • 1x Plasma talon\n• 1x Ravenwing Ancient\n  • 1x Black Knight combat weapon\n  • 1x Bolt pistol\n  • 1x Plasma talon\nRavenwing Black Knights (150 Points)\n• Attached as: Bodyguard\n• 1x Ravenwing Huntmaster\n  • 1x Black Knight combat weapon\n  • 1x Bolt pistol\n  • 1x Plasma talon\n• 5x Ravenwing Black Knight\n  • 5x Black Knight combat weapon\n  • 5x Bolt pistol\n  • 5x Plasma talon\n\nBATTLELINE\nOutrider Squad (70 Points)\n• 1x Outrider Sergeant\n  • 1x Astartes chainsword\n  • 1x Heavy bolt pistol\n  • 1x Twin bolt rifle\n• 2x Outrider\n  • 2x Astartes chainsword\n  • 2x Heavy bolt pistol\n  • 2x Twin bolt rifle\nOutrider Squad (70 Points)\n• 1x Outrider Sergeant\n  • 1x Astartes chainsword\n  • 1x Heavy bolt pistol\n  • 1x Twin bolt rifle\n• 2x Outrider\n  • 2x Astartes chainsword\n  • 2x Heavy bolt pistol\n  • 2x Twin bolt rifle\n\nDEDICATED TRANSPORTS\nDrop Pod (70 Points)\n\nOTHER DATASHEETS\nLand Speeder (95 Points)\n• 1x Close-combat weapon\n• 1x Heavy flamer\n• 1x Multi-melta\n• 1x Stormfury missile launcher\nLand Speeder Vengeance (120 Points)\n• 1x Close combat weapon\n• 1x Heavy bolter\n• 1x Plasma storm battery\nLand Speeder Vengeance (120 Points)\n• 1x Close combat weapon\n• 1x Heavy bolter\n• 1x Plasma storm battery\nStorm Speeder Hammerstrike (130 Points)\n• 1x Close combat weapon\n• 1x Hammerstrike missile launcher\n• 2x Krakstorm grenade launcher\n• 1x Melta destroyer\nStorm Speeder Thunderstrike (135 Points)\n• 1x Close combat weapon\n• 1x Stormfury missiles\n• 1x Thunderstrike las-talon\n• 1x Twin Icarus rocket pod"},
  {name:"Space Marines (Iron Hands) — Hammer of Avernii / Librarius Conclave (Cardamone, GT winner)",fid:"SM",disposition:"Priority Assets",
   blurb:"Double Terminator deathball with Librarian support — punishes thin anti-tank and soft melee defence.",
   text:"Iron Wolves (2000 points)\nSpace Marines\nIron Hands\nStrike Force (2000 points)\nHammer of Avernii and Librarius Conclave (3 Detachment Points)\nForce Dispositions: Priority Assets\n\nAttached Units\n\nAttached Unit 1\nCaanok Var (90 points)\n• Attached as: Leader (Character)\n• Warlord\n• 1x Axiom\n• 1x Storm bolter\nTerminator Assault Squad (360 points)\n• Attached as: Bodyguard\n• 1x Assault Terminator Sergeant\n  • 1x Storm Shield\n  • 1x Thunder hammer\n• 9x Assault Terminator\n  • 9x Storm Shield\n  • 9x Thunder hammer\n\nAttached Unit 2\nLibrarian (80 points)\n• Attached as: Leader (Character)\n• 1x Bolt pistol\n• 1x Force weapon\n• 1x Smite\n• Enhancement: Fusillade\nSternguard Veteran Squad (190 points)\n• Attached as: Bodyguard\n• 1x Sternguard Veteran Sergeant\n  • 1x Close combat weapon\n  • 1x Power fist\n  • 1x Sternguard bolt pistol\n  • 1x Sternguard bolt rifle\n• 9x Sternguard Veteran\n  • 9x Close combat weapon\n  • 9x Sternguard bolt pistol\n  • 7x Sternguard bolt rifle\n  • 2x Sternguard heavy bolter\n\nAttached Unit 3\nLibrarian in Terminator Armour (90 points)\n• Attached as: Leader (Character)\n• 1x Force weapon\n• 1x Smite\n• Enhancement: Steel Font\nTerminator Assault Squad (360 points)\n• Attached as: Bodyguard\n• 1x Assault Terminator Sergeant\n  • 1x Storm Shield\n  • 1x Thunder hammer\n• 9x Assault Terminator\n  • 9x Storm Shield\n  • 9x Thunder hammer\n\nCHARACTERS\nLieutenant with Combi-weapon (85 points)\n• 1x Combi-weapon\n• 1x Paired combat blades\n\nBATTLELINE\nIntercessor Squad (80 points)\n• 1x Intercessor Sergeant\n  • 1x Astartes grenade launcher\n  • 1x Bolt pistol\n  • 1x Bolt rifle\n  • 1x Power fist\n• 4x Intercessor\n  • 4x Bolt pistol\n  • 4x Bolt rifle\n  • 4x Close combat weapon\n\nOTHER DATASHEETS\nIncursor Squad (85 points)\n• 1x Incursor Sergeant\n  • 1x Bolt pistol\n  • 1x Occulus bolt carbine\n  • 1x Paired combat blades\n• 4x Incursor\n  • 4x Bolt pistol\n  • 1x Haywire Mine\n  • 4x Occulus bolt carbine\n  • 4x Paired combat blades\nInfiltrator Squad (110 points)\n• 1x Infiltrator Sergeant\n  • 1x Bolt pistol\n  • 1x Close combat weapon\n  • 1x Marksman bolt carbine\n• 4x Infiltrator\n  • 4x Bolt pistol\n  • 4x Close combat weapon\n  • 1x Helix Gauntlet\n  • 1x Infiltrator Comms Array\n  • 4x Marksman bolt carbine\nLand Speeder (95 points)\n• 1x Close-combat weapon\n• 1x Multi-melta\n• 1x Onslaught gatling cannon\n• 1x Stormfury missile launcher\nLand Speeder (95 points)\n• 1x Close-combat weapon\n• 1x Multi-melta\n• 1x Onslaught gatling cannon\n• 1x Stormfury missile launcher\nPredator Destructor (140 points)\n• 1x Armoured tracks\n• 1x Hunter-killer missile\n• 2x Lascannon\n• 1x Predator autocannon\n• 1x Storm bolter\nPredator Destructor (140 points)\n• 1x Armoured tracks\n• 1x Hunter-killer missile\n• 2x Lascannon\n• 1x Predator autocannon\n• 1x Storm bolter"},
  {name:"Drukhari — Exhibition of Slaughter / Skysplinter Assault (Garrett)",fid:"DRU",disposition:"Reconnaissance",
   blurb:"Fast Raiders/Venoms feeding Incubi strike squads — punishes armies that cannot contest the whole board.",
   text:"Boats and……..dudes? (1,975 Points)\nDrukhari\nExhibition of Slaughter and Skysplinter Assault (3 Detachment Points)\nForce Dispositions: playing reconnaissance\nStrike Force (2,000 Points)\n\nATTACHED UNITS\n\nAttached unit 1\nLady Malys (100 Points)\n• Attached as: Leader (Character)\n• Warlord\n• 1x Lady's Blade\n• 1x Razor fan\nIncubi (90 Points)\n• Attached as: Bodyguard\n• 1x Klaivex\n  • 1x Klaive\n• 4x Incubi\n  • 4x Klaive\n\nAttached unit 2\nArchon (100 Points)\n• Attached as: Leader (Character)\n• 1x Blast pistol\n• 1x Master‑crafted power weapon\n• 1x Shadowfield\n• Enhancements: Nightmare Shroud\nIncubi (180 Points)\n• Attached as: Bodyguard\n• 1x Klaivex\n  • 1x Klaive\n• 9x Incubi\n  • 9x Klaive\n\nBATTLELINE\nKabalite Warriors (110 Points)\n• 1x Sybarite\n  • 1x Close combat weapon\n  • 1x Phantasm Grenade Launcher\n  • 1x Splinter rifle\n• 9x Kabalite Warrior\n  • 1x Blaster\n  • 9x Close combat weapon\n  • 1x Dark lance\n  • 1x Shredder\n  • 1x Splinter cannon\n  • 5x Splinter rifle\nKabalite Warriors (110 Points)\n• 1x Sybarite\n  • 1x Close combat weapon\n  • 1x Phantasm Grenade Launcher\n  • 1x Splinter rifle\n• 9x Kabalite Warrior\n  • 1x Blaster\n  • 9x Close combat weapon\n  • 1x Dark lance\n  • 1x Shredder\n  • 1x Splinter cannon\n  • 5x Splinter rifle\n\nDEDICATED TRANSPORTS\nRaider (85 Points)\n• 1x Bladevanes and chainsnares\n• 1x Dark lance\nVenom (70 Points)\n• 1x Bladevanes\n• 1x Splinter cannon\n• 1x Splinter cannon\nVenom (70 Points)\n• 1x Bladevanes\n• 1x Splinter cannon\n• 1x Splinter cannon\nVenom (70 Points)\n• 1x Bladevanes\n• 1x Splinter cannon\n• 1x Splinter cannon\n\nOTHER DATASHEETS\nHellions (180 Points)\n• 1x Helliarch\n  • 1x Hellglaive\n  • 1x Phantasm Grenade Launcher\n  • 1x Splinter pods\n• 9x Hellion\n  • 9x Hellglaive\n  • 9x Splinter pods\nHellions (90 Points)\n• 1x Helliarch\n  • 1x Hellglaive\n  • 1x Phantasm Grenade Launcher\n  • 1x Splinter pods\n• 4x Hellion\n  • 4x Hellglaive\n  • 4x Splinter pods\nMandrakes (80 Points)\n• 1x Nightfiend\n  • 1x Baleblast\n  • 1x Glimmersteel blade\n• 4x Mandrake\n  • 4x Baleblast\n  • 4x Glimmersteel blade\nMandrakes (80 Points)\n• 1x Nightfiend\n  • 1x Baleblast\n  • 1x Glimmersteel blade\n• 4x Mandrake\n  • 4x Baleblast\n  • 4x Glimmersteel blade\nReavers (75 Points)\n• 1x Arena Champion\n  • 1x Bladevanes\n  • 1x Cluster caltrops\n  • 1x Heat lance\n  • 1x Splinter pistol\n• 2x Reaver\n  • 2x Bladevanes\n  • 2x Splinter pistol\n  • 2x Splinter rifle\nReavers (75 Points)\n• 1x Arena Champion\n  • 1x Bladevanes\n  • 1x Cluster caltrops\n  • 1x Heat lance\n  • 1x Splinter pistol\n• 2x Reaver\n  • 2x Bladevanes\n  • 2x Splinter pistol\n  • 2x Splinter rifle\nScourges with Heavy Weapons (130 Points)\n• 1x Solarite\n  • 1x Close combat weapon\n  • 1x Shardcarbine\n• 4x Scourge\n  • 4x Close combat weapon\n  • 4x Dark lance\nScourges with Heavy Weapons (130 Points)\n• 1x Solarite\n  • 1x Close combat weapon\n  • 1x Shardcarbine\n• 4x Scourge\n  • 4x Close combat weapon\n  • 4x Dark lance\nTalos (150 Points)\n• 2x Talos\n  • 2x Macro-scalpel\n  • 2x Twin heat lance\n  • 2x Twin liquifier gun"},
];
/* Plan profiles over the WP10 scoring weights, chosen from the Force Disposition header.
   Meta notes: dispositions define the scoring plan — build (and play) the list FOR it. */
let aiPlan="hold", aiPlanSrc="";
const AI_PLANS={
  purge:{label:"Purge the Foe",brief:"aggressive trades — hunt kills, contest the middle, make every exchange favourable",
    tune:{shootW:2.1,tgtWound:1.6,objBase:8,objKeep:0.45,chargeGain:1.2,advancePen:3,threatW:0.75}},
  hold:{label:"Take and Hold / Priority Assets",brief:"objective-first — park durable OC on the deciding objectives from round 2 and out-attrit",
    tune:{objBase:13,objContest:7,objKeep:0.75,shootW:1.5,threatW:1.0,chargeGain:1.6}},
  recon:{label:"Reconnaissance",brief:"spread wide — board presence, mobility, a toe on every quarter",
    tune:{objApproach:1.0,objBase:11,objKeep:0.5,rangeApproach:0.45}},
};
Object.assign(AI_TUNE,{ // ==== WP11 doctrine knobs (every new tunable lives here) ====
  hidW:3.5,           // fragile shooters prefer Hidden-capable (dense) destinations
  hidExpThresh:1.0,   // expected shooting below this → stay quiet and go Hidden
  screenW:9,          // picket candidate bonus for cheap units
  screenCheapPts:110, // "cheap" ceiling for a screening unit
  screenProtectPts:150,// units worth screening for
  stageW:5,           // round 1–2 stay-out-of-LoS pressure while outgunned
  outgunnedRatio:1.25,// enemy guns vs ours ratio that counts as "outgunned" in round 2
  focusW:6,           // concentrate fire to REMOVE units
  overkill:1.3,       // allow ~30% overkill, taper beyond
  behindObjMult:1.6,  // behind on primary → objective squatters over damage-value targets
  shockFinishW:4,     // finish below-half units sitting on objectives
  tradeW:0.6,         // don't feed: exposure only if swing + damage beats expected loss
  noChaseW:1.2,       // slow melee refuses to chase faster shooters
  holdHomeW:3,        // ...and holds the objective instead
  primaryPeak:1.15,   // objective weights peak rounds 1–3 (primary is front-loaded in 11th)
  primaryRelax:0.7,   // relax late when ahead
  reconSpreadW:0.35,  // recon plan: reward spreading out
});
const AI_TUNE_BASE=Object.assign({},AI_TUNE); // pristine copy — plans/round curves apply onto this
function wp11PlanFromDisposition(d){
  d=String(d||"").toLowerCase();
  if(d.includes("take and hold")||d.includes("priority assets")) return "hold";
  if(d.includes("purge")) return "purge";
  if(d.includes("recon")||d.includes("disruption")) return "recon"; // Disruption = speed+pressure; the recon profile is the closest fit
  return "hold";
}
function wp11SetPlan(p,src){
  aiPlan=AI_PLANS[p]?p:"hold"; aiPlanSrc=src||""; wp11BriefRound=0;
  Object.assign(AI_TUNE,AI_TUNE_BASE,(AI_PLANS[aiPlan].tune)||{});
  logShared(`🤖 <b>Game plan — ${esc(AI_PLANS[aiPlan].label)}</b>: ${esc(AI_PLANS[aiPlan].brief)}${src?` <span class="small">(${esc(src)})</span>`:""}`,"sys");
}
/* ---- meta muster: the verified importArmyList path, run as side 2 ---- */
function wp11ParseList(text){ // header parsing the way importArmyList does it
  /* ==== WP-MODELFIX: preserve indent (see importArmyList) so model-vs-wargear counting agrees
     with the import path exactly — same wp11CountUnitModels(), same DB (u.m/u.c) disambiguation. ==== */
  const lines=String(text).split("\n").map(raw=>({indent:(raw.match(/^\s*/)||[""])[0].length,text:raw.replace(/[•●▪]/g,"").trim()}));
  let fid=null,disp="",det="",total=0;
  for(const {text:l} of lines.slice(0,8)){ const f=DB.factions.find(([id,n])=>norm(n)===norm(l)); if(f){ fid=f[0]; break; } }
  for(const {text:l} of lines.slice(0,8)){ const m=l.match(/^force dispositions?:\s*(.+)$/i); if(m){ disp=m[1].trim(); break; } }
  /* ==== WP-IMPORTFIX: detachment line, e.g. "Hammer of Avernii and Librarius Conclave (3 Detachment Points)" ==== */
  for(const {text:l} of lines.slice(0,8)){ const m=l.match(/^(.+?)\s*\(\d+\s*detachment points?\)$/i); if(m){ det=m[1].trim(); break; } }
  const m0=((lines[0]||{}).text||"").match(/\((\d+)\s*points?\)/i); if(m0) total=+m0[1];
  const unitsDb=fid?(DB.units[fid]||[]):[];
  const units=[]; let cur=null;
  const sizeRx=/^(incursion|strike force|onslaught|combat patrol)\s*[\(\[]/i; /* ==== WP-IMPORT-PTS: keep in lockstep with importArmyList ==== */
  const flush=()=>{ if(!cur) return;
    const idx=matchUnit(unitsDb,cur.name);
    if(idx>=0){ cur.models=wp11CountUnitModels(unitsDb[idx],cur.lines); }
    else{ // fid/unit unresolved (shouldn't happen for the embedded lists) — indent-only fallback
      let n=0; cur.lines.forEach(x=>{ if(x.indent<2){ const bm=x.text.match(/^(\d+)x\s+/i); if(bm) n+=+bm[1]; } });
      cur.models=n||1;
    }
    delete cur.lines; };
  lines.forEach(({indent,text:l},li)=>{
    if(!l) return;
    const um=l.match(WPIMP_HEADER); /* ==== WP-IMPORT-PTS: same header regex as importArmyList ==== */
    if(um&&!sizeRx.test(l)&&li>0){ flush(); cur={name:um[1],pts:+um[2],lines:[]}; units.push(cur); return; }
    if(cur) cur.lines.push({indent,text:l});
  });
  flush();
  return {fid,disp,det,total,units};
}
function wp11PopulateMeta(){
  const sel=document.getElementById("aiMetaSel"); if(!sel) return;
  sel.innerHTML='<option value="">Auto-build (faction + points below)</option>'
    +AI_META_LISTS.map((m,i)=>`<option value="${i}">${esc(m.name)}</option>`).join("");
  wp11MetaBlurb();
}
function wp11MetaBlurb(){
  const sel=document.getElementById("aiMetaSel"), el=document.getElementById("aiMetaBlurbEl");
  if(!sel||!el) return;
  const m=AI_META_LISTS[parseInt(sel.value)];
  el.textContent=m?(m.blurb+" · Force Disposition: "+m.disposition):"";
}
function wp11StartMeta(i){
  const m=AI_META_LISTS[i]; if(!m) return;
  if(conn&&conn.open){ logSys("Disconnect first — solo mode is offline only."); return; }
  if(state.tokens.some(t=>t.owner===2)){ logSys("Side 2 already has models on the table — Clear table first, then start the meta opponent."); return; }
  if(!state.objectives.length&&!confirm("No layout loaded — the AI plays much better with objectives and deployment zones (Setup tab). Start anyway?")) return;
  aiReset();
  const parsed=wp11ParseList(m.text);
  const fid=parsed.fid||m.fid;
  const fname=(DB.factions.find(f=>f[0]===fid)||["",m.fid])[1];
  op({k:"name",side:2,name:"AI — "+m.name});
  const got=wp11MusterList(m,parsed,fid);
  aiUi();
  logShared(`🤖 <b>Solo mode</b>: the AI fields <b>${esc(m.name)}</b> — ${esc(fname)}, ${got.pts} pts, ${got.units} units. ${esc(m.blurb)}`,"sys");
  const disp=parsed.disp||m.disposition;
  wp11SetPlan(wp11PlanFromDisposition(disp),"Force Disposition: "+disp);
}
function wp11MusterList(m,parsed,fid){
  const prevArmy=myArmy, prevSide=mySide, prevName=myName;
  const g=id=>document.getElementById(id);
  const prevText=g("listText").value, prevFac=g("listFaction").value, prevDep=g("listDeploy").checked;
  /* ==== WP-IMPORTFIX: importArmyList() now syncs myList.faction/det (see there) so the Army-tab
     summary reflects whichever army it just imported — but this function musters the AI's list
     (side 2) through that same import pipeline while borrowing myArmy/mySide. Without saving and
     restoring myList too, the AI's faction/detachment would stick and mislabel the HUMAN's own
     Army-tab summary once this finally block hands mySide/myArmy back. ==== */
  const prevListFaction=myList.faction, prevListDet=myList.det, prevListNote=myList.importedNote;
  mySide=2; myName=state.names[2]||"AI";
  const before=state.tokens.length;
  let count=0, pts=0;
  try{
    g("listText").value=m.text; g("listFaction").value=fid; g("listDeploy").checked=true;
    importArmyList();                                          // the verified import path (WP-MODELFIX: correct model counts, no loose-count hook needed)
    // Allied units the single-faction search misses (e.g. an Agents unit in a Custodes list): search the whole DB
    parsed.units.forEach(u=>{
      if(myArmy.some(c=>matchUnit([{n:c.name}],u.name)===0)) return;
      for(const [ofid] of DB.factions){
        if(ofid===fid) continue;
        const idx=matchUnit(DB.units[ofid]||[],u.name);
        if(idx>=0){ const c=addFromDb(ofid,idx,u.models||undefined,true); if(c){ deployCard(c); logSys("🤖 "+u.name+" mustered as an allied unit ("+ofid+")."); } return; }
      }
      logSys("🤖 Couldn't find "+u.name+" in the database — skipped.");
    });
    // Stamp the source list's printed points onto the cards (the list is authoritative for its own totals)
    const used=new Set();
    parsed.units.forEach(u=>{
      let ci=myArmy.findIndex((c,j)=>!used.has(j)&&norm(c.name)===norm(u.name));
      if(ci<0) ci=myArmy.findIndex((c,j)=>!used.has(j)&&matchUnit([{n:c.name}],u.name)===0);
      if(ci>=0){ used.add(ci); myArmy[ci].pts=String(u.pts); }
    });
    count=myArmy.length; pts=myArmy.reduce((s,c)=>s+(parseInt(c.pts)||0),0);
    op({k:"cards",owner:2,cards:JSON.parse(JSON.stringify(myArmy.map(migrateCard)))});
    // Same deployment pipeline as auto-build: formation-place into the side-2 DZ, attach leaders, hold a reserve
    const byUnit={};
    state.tokens.slice(before).forEach(t=>{ if(t.owner===2)(byUnit[t.unit]=byUnit[t.unit]||[]).push(t); });
    const unitsToks=Object.values(byUnit);
    aiDeployAll(unitsToks);
    aiAttachCharacters();
    aiHoldReserves(unitsToks);
  } finally {
    myArmy=prevArmy; mySide=prevSide; myName=prevName;
    myList.faction=prevListFaction; myList.det=prevListDet; myList.importedNote=prevListNote; bSave(); /* ==== WP-IMPORTFIX: undo the AI-muster's myList sync ==== */
    g("listText").value=prevText; g("listFaction").value=prevFac; g("listDeploy").checked=prevDep;
    try{ localStorage.setItem("wh40k_army",JSON.stringify(myArmy)); }catch(e){}
    renderArmy();
  }
  return {units:count,pts};
}
/* ==== WP-C: auto-import registry ==== embedded top-5 lists + optional web-fetched lists, feeding the
   existing importArmyList() pipeline (same parser wp11ParseList/importArmyList already use — no
   reimplementation). Web lists are cached in localStorage["wh40k_web_lists"] as [{name,faction,text}].
   De-dupe by name: embedded always wins on collision. ==== */
function wpImportRegistry(){
  const reg=AI_META_LISTS.map(m=>({name:m.name,text:m.text,blurb:m.blurb||"",fid:m.fid||null}));
  const seen=new Set(reg.map(r=>r.name));
  let web=[];
  try{ web=JSON.parse(localStorage.getItem("wh40k_web_lists")||"[]"); }catch(e){ web=[]; }
  if(!Array.isArray(web)) web=[];
  web.forEach(w=>{
    if(!w||typeof w!=="object") return;                 // skip malformed entries
    const name=String(w.name||"").trim();
    const text=String(w.text||"");
    if(!name||!text) return;
    if(seen.has(name)) return;                           // embedded wins on name collision
    seen.add(name);
    reg.push({name,text,blurb:"",fid:w.faction?String(w.faction):null});
  });
  return reg;
}
function wpImportPopulate(){
  const sel=document.getElementById("metaListPick"); if(!sel) return;
  sel.innerHTML=wpImportRegistry().map((m,i)=>`<option value="${i}">${esc(m.name)}</option>`).join("");
  wpImportBlurb();
}
function wpImportBlurb(){
  const sel=document.getElementById("metaListPick"), el=document.getElementById("wpImportBlurbEl");
  if(!sel||!el) return;
  const m=wpImportRegistry()[parseInt(sel.value)];
  el.textContent=(m&&m.blurb)||"";
}
function wpImportSelected(){
  const sel=document.getElementById("metaListPick"); if(!sel) return;
  const m=wpImportRegistry()[parseInt(sel.value)];
  if(!m){ logSys("Pick a list from Auto-import first."); return; }
  const g=id=>document.getElementById(id);
  g("listText").value=m.text;                            // feed the EXISTING paste-box pipeline
  let fid=m.fid; if(!fid){ try{ fid=wp11ParseList(m.text).fid; }catch(e){ fid=null; } }
  if(fid) g("listFaction").value=fid;
  importArmyList();                                       // dropdown path == paste path
}
function wpImportFetchWeb(){
  try{
    fetch("https://flextap3.github.io/wh40k-tabletop/lists.json").then(r=>r.json()).then(data=>{
      if(!Array.isArray(data)) throw new Error("lists.json: not an array");
      const clean=data.filter(x=>x&&typeof x==="object"&&x.name&&x.text).map(x=>(
        {name:String(x.name),faction:x.faction?String(x.faction):"",text:String(x.text)}));
      localStorage.setItem("wh40k_web_lists",JSON.stringify(clean));
      wpImportPopulate();
      logSys("Fetched "+clean.length+" web lists.");
    }).catch(()=>{ logSys("Couldn't fetch web lists — using built-in lists."); });
  }catch(e){ logSys("Couldn't fetch web lists — using built-in lists."); }
}
/* ==== end WP-C ==== */
/* ==== WP-DEEPLINK-APP: auto-import from a URL query param, so the meta dashboard's
   "▶ Practice vs <name>" links land here already loaded. Two forms, ?list wins if both
   are present:
     ?list=<url-encoded name>   — matched (case/punct/whitespace-insensitive via norm())
                                  against wpImportRegistry() entries by name, then fed
                                  through the SAME dropdown import path as wpImportSelected().
     ?import=<url-encoded text> — raw list text, decoded straight into #listText and
                                  imported as-is.
   Must run AFTER init has populated DB/registry (populateFactions/wpImportPopulate/etc.)
   — called from the bottom of the init block. Wrapped so a malformed/missing query
   string can never break page load. */
function wpDeepLinkInit(){
  try{
    if(typeof window==="undefined"||!window.location||typeof URLSearchParams==="undefined") return;
    const qs=new URLSearchParams(window.location.search||"");
    if(qs.has("list")){
      const raw=qs.get("list")||"";
      const want=norm(raw);
      const m=wpImportRegistry().find(r=>norm(r.name)===want);
      if(!m){ logSys(`Deep-link: no list found matching "${raw}".`); return; }
      const g=id=>document.getElementById(id);
      g("listText").value=m.text;                              // same pipeline as wpImportSelected()
      let fid=m.fid; if(!fid){ try{ fid=wp11ParseList(m.text).fid; }catch(e){ fid=null; } }
      if(fid) g("listFaction").value=fid;
      importArmyList();
      logSys(`Deep-link loaded list: ${m.name}`);
      return;
    }
    if(qs.has("import")){
      const text=qs.get("import")||"";                         // URLSearchParams already decodes
      if(!text.trim()) return;
      document.getElementById("listText").value=text;
      importArmyList();
      logSys("Deep-link imported a pasted list from the URL.");
    }
  }catch(e){ try{ logSys("Deep-link: couldn't load the list from the URL — malformed link."); }catch(e2){} }
}
/* ==== end WP-DEEPLINK-APP ==== */
/* ---- plan application + once-per-round strategic brief ---- */
let wp11ShotMark=0, wp11BriefRound=0, wp11MoveCache={key:""};
function wp11TurnStart(round){ // aiPlanPhase case 0 hook — start of every AI turn
  wp11ShotMark=aiShotLog.length;   // marks "who has shot this turn" for the Hidden sweep
  wp11MoveCache={key:""};
  wp11ApplyPlanTune(round);
  if(round!==wp11BriefRound){ wp11BriefRound=round; aiEnqueue(()=>wp11RoundBrief(round)); }
}
function wp11ApplyPlanTune(round){
  Object.assign(AI_TUNE,AI_TUNE_BASE,(AI_PLANS[aiPlan]||AI_PLANS.hold).tune||{});
  // Meta notes: "Primary scoring is front-loaded in 11th" — press objectives hard rounds 1–3, relax late when ahead
  const tal=wp6Tallies();
  const ahead=tal.filter(x=>x.holder===2).length>tal.filter(x=>x.holder===1).length;
  const pw=round<=3?AI_TUNE.primaryPeak:(ahead?AI_TUNE.primaryRelax:1);
  AI_TUNE.objBase*=pw; AI_TUNE.objContest*=pw;
}
function wp11RoundBrief(round){
  if(!solo) return;
  const plan=AI_PLANS[aiPlan]||AI_PLANS.hold;
  const tal=wp6Tallies(), bits=[];
  const my=state.tokens.filter(t=>t.owner===2);
  const cx=my.length?my.reduce((s,t)=>s+t.x,0)/my.length:state.board.w/2;
  const cy=my.length?my.reduce((s,t)=>s+t.y,0)/my.length:2;
  const holds=tal.map((o,i)=>({i:i+1,h:o.holder})).filter(o=>o.h===2).map(o=>"Obj "+o.i);
  if(holds.length) bits.push("parked on "+holds.join("/"));
  const want=tal.map((o,i)=>({o:o.o,h:o.holder,i:i+1})).filter(x=>x.h!==2)
    .sort((a,b)=>Math.hypot(a.o.x-cx,a.o.y-cy)-Math.hypot(b.o.x-cx,b.o.y-cy)).slice(0,2).map(x=>"Obj "+x.i);
  if(want.length) bits.push((aiPlan==="purge"?"pressing":"taking")+" "+want.join("/"));
  const th=wp11ScreenThreats();
  if(th.res) bits.push("screening the drop zone");
  else if(th.fast.length) bits.push("screening against "+th.fast[0].toks[0].name);
  if(aiPlan==="purge") bits.push("hunting trades");
  if(aiPlan==="recon") bits.push("spreading for board presence");
  logShared(`🤖 <b>Round ${round} — ${esc(plan.label)}</b>: ${esc(bits.join(", ")||"advancing on the centre")}`,"sys");
}
/* ---- doctrine 1: Hidden is premium ----
   Meta notes: "Hidden: infantry wholly in dense terrain that hasn't shot is untargetable
   beyond 15"" — and armies with nothing that can Hide pay for every step. */
function wp11HiddenSweep(){ // aiPlanPhase case 3 hook — runs after the AI's shooting has resolved
  if(!solo) return;
  aiEnqueue(()=>{
    const shot=new Set(aiShotLog.slice(wp11ShotMark).map(s=>s.atk));
    aiUnits(2).forEach(u=>{
      const ms=u.toks; if(!ms.length) return;
      const isHid=ms.every(t=>t.hid);
      if(isHid&&(shot.has(u.uk)||!unitHiddenEligible(ms))){ // opened fire or moved out — Hidden is gone
        op({k:"tok~",toks:ms.map(t=>({id:t.id,hid:false}))});
        logShared(`🤖 AI: <b>${esc(ms[0].name)}</b> ${shot.has(u.uk)?"opened fire":"left cover"} — no longer Hidden`,"sys");
        return;
      }
      if(isHid||shot.has(u.uk)) return;
      if(!unitHiddenEligible(ms)) return;
      const W=aiWeapons(ms);
      // about to charge? staying visible is fine — the hammers are coming out anyway
      if(W.melee.length&&aiUnits(1).some(e=>e.toks.length&&wp3UnitDist(ms,e.toks)<=12.02)) return;
      const enemies=aiUnits(1).filter(e=>e.toks.length);
      const cx=ms.reduce((s,t)=>s+t.x,0)/ms.length, cy=ms.reduce((s,t)=>s+t.y,0)/ms.length;
      const exp=W.ranged.length?aiBestShoot(cx,cy,ms,W.ranged,enemies,losPrep(state.terrain)):0;
      if(exp<AI_TUNE.hidExpThresh){
        op({k:"tok~",toks:ms.map(t=>({id:t.id,hid:true}))});
        logShared(`🤖 AI: <b>${esc(ms[0].name)}</b> stays quiet in dense terrain — <b>Hidden</b> (untargetable beyond 15")`,"sys");
      }
    });
  });
}
/* ---- doctrine 2: screening ----
   Meta notes: Deep Strike at 6–8" is brutal; IH guide: "screen 6–8" deep strike with the
   Infiltrators — losing a Predator to a fusion drop is the main way this goes wrong". */
function wp11ScreenThreats(){
  const res=((state.reserves&&state.reserves[1])||[]).length>0;
  const fast=aiUnits(1).filter(e=>{
    if(!e.toks.length) return false;
    const M=Math.max(...e.toks.map(t=>(typeof t.Mv==="number")?t.Mv:6));
    return M>=8&&aiWeapons(e.toks).melee.length>0;
  });
  return {res,fast};
}
function wp11UnitValue(ms){ const c=aiCardFor(ms[0]); return (c&&parseInt(c.pts))||ms.length*15; }
function wp11IsCheap(ms){ return wp11UnitValue(ms)<=AI_TUNE.screenCheapPts&&!ms.some(t=>tokKw(t).includes("CHARACTER")); }
function wp11ExtraCands(cands,ctx){ // aiMoveUnit hook: extra destination candidates
  const th=wp11ScreenThreats();
  if(!(th.res||th.fast.length)||!wp11IsCheap(ctx.ms)) return;
  const prot=[];
  const others=aiUnits(2).filter(u=>u.uk!==ctx.uk&&u.toks.length&&wp11UnitValue(u.toks)>=AI_TUNE.screenProtectPts)
    .sort((a,b)=>wp11UnitValue(b.toks)-wp11UnitValue(a.toks));
  if(others.length){ const hv=others[0].toks;
    prot.push([hv.reduce((s,t)=>s+t.x,0)/hv.length,hv.reduce((s,t)=>s+t.y,0)/hv.length]); }
  const dz=(state.dz||[])[1];
  if(dz&&dz.length>2&&state.objectives.length){ // backfield objective = the one nearest the AI DZ centroid
    const dx=dz.reduce((s,p)=>s+p[0],0)/dz.length, dy=dz.reduce((s,p)=>s+p[1],0)/dz.length;
    const home=state.objectives.slice().sort((a,b)=>Math.hypot(a.x-dx,a.y-dy)-Math.hypot(b.x-dx,b.y-dy))[0];
    if(home) prot.push([home.x,home.y]);
  }
  let tx=state.board.w/2, ty=state.board.h/2; // reserve drops can come anywhere — face the middle
  if(th.fast.length){ const ft=th.fast[0].toks;
    tx=ft.reduce((s,t)=>s+t.x,0)/ft.length; ty=ft.reduce((s,t)=>s+t.y,0)/ft.length; }
  prot.forEach(([px2,py2])=>{
    const d=Math.hypot(tx-px2,ty-py2)||1;
    const g=7; // middle of the 6–8" picket band: denies 9"-away deep strike and blunts charge lanes
    cands.push({x:px2+(tx-px2)/d*g,y:py2+(ty-py2)/d*g,screen:true,why:"screens ahead of the backfield"});
  });
}
/* ---- helpers for doctrines 3/5/6: enemy gun threat + own output, cached per unit-activation ---- */
function wp11GunThreat(enemies,ms){
  let worst=0,total=0;
  enemies.forEach(e=>{
    if(!e.toks.length) return;
    const ws=aiWeapons(e.toks).ranged; if(!ws.length) return;
    const exp=Math.max(0,...ws.map(w=>aiExpDamage(w,e.toks.length,ms,Math.max(1,w.rng/2),false)));
    total+=exp; if(exp>worst) worst=exp;
  });
  return {worst,total};
}
function wp11MoveInfo(ctx){
  const key=ctx.uk+"|"+aiPhaseKey;
  if(wp11MoveCache.key===key) return wp11MoveCache;
  const info={key,gt:wp11GunThreat(ctx.enemies,ctx.ms),own:0,kiters:new Set()};
  if(ctx.ranged.length&&ctx.enemies.length){
    let near=null,ndd=1e9;
    ctx.enemies.forEach(e=>{ if(!e.toks.length)return; const dd=wp3UnitDist(ctx.ms,e.toks); if(dd<ndd){ndd=dd;near=e;} });
    if(near) info.own=Math.max(0,...ctx.ranged.map(w=>aiExpDamage(w,ctx.ms.length,near.toks,Math.max(1,Math.min(ndd,w.rng/2)),false)));
  }
  if(ctx.melee.length&&!ctx.ranged.length){
    // doctrine 6 (IH guide, Custodes matchup: "they kill-and-retreat off ruins. Don't chase —
    // hold objectives and force them onto you"): kiter = faster than us AND has real guns
    ctx.enemies.forEach(e=>{
      if(!e.toks.length) return;
      const eM=Math.max(...e.toks.map(t=>(typeof t.Mv==="number")?t.Mv:6));
      if(eM>ctx.M&&aiWeapons(e.toks).ranged.length) info.kiters.add(e.uk);
    });
  }
  wp11MoveCache=info; return info;
}
function wp11ScoreAdjust(c,ctx){ // aiMoveUnit hook: doctrine scoring terms, returns a delta
  let d=0;
  const info=wp11MoveInfo(ctx);
  const round=(state.trackers&&state.trackers.round)||1;
  const inDense=state.terrain.some(t2=>LOS_DENSE[t2.kind]&&geomPointInRect(c.x,c.y,t2));
  const objC=(c.obj!==undefined)||/Obj /.test(c.why||"");
  // 2: screening candidates carry their own weight
  if(c.screen) d+=AI_TUNE.screenW;
  // 1: Hidden is premium — fragile shooters prefer destinations that keep the Hidden option open
  //    (Meta notes: "infantry wholly in dense terrain that hasn't shot is untargetable beyond 15"")
  if(ctx.infantry&&ctx.ranged.length&&inDense&&info.gt.worst>info.own) d+=AI_TUNE.hidW;
  // 3: stage before committing — round 1 (and 2 if outgunned) shooters prefer out-of-LoS spots
  //    over open lanes when expected return fire exceeds their own output
  if(ctx.ranged.length&&!ctx.adv&&info.gt.total>info.own
     &&(round===1||(round===2&&info.gt.total>info.own*AI_TUNE.outgunnedRatio))){
    // Don't hide a gunline that can actually shoot: only penalize an open lane when the shot from
    // here is too weak to earn the exposure (return fire outweighs it). A worthwhile shot cancels
    // the stage-back pressure — idle guns are pure lost output.
    const shootVal=(ctx.sh||0)*AI_TUNE.shootW;
    if(ctx.sh>0&&!inDense&&shootVal<info.gt.worst*AI_TUNE.tradeW) d-=AI_TUNE.stageW;
    if(inDense) d+=AI_TUNE.stageW*0.6;
  }
  // 5: trade math — a move into the open must earn its exposure (objective swing + damage dealt
  //    vs expected loss; don't feed). Meta notes: alpha-pressure punishes free targets.
  if(!inDense&&info.gt.worst>0){
    const gain=(ctx.sh||0)*AI_TUNE.shootW+(objC?AI_TUNE.objBase*0.5:0);
    const loss=info.gt.worst*AI_TUNE.tradeW;
    if(loss>gain) d-=(loss-gain);
  }
  // 6: don't chase kiters — cancel the closing reward against faster shooters, hold objectives instead
  if(info.kiters.size&&ctx.enemies.length){
    let near=null,nd=1e9;
    ctx.enemies.forEach(e=>{ if(!e.toks.length)return; const dd=Math.min(...e.toks.map(t=>Math.hypot(t.x-c.x,t.y-c.y))); if(dd<nd){nd=dd;near=e;} });
    if(near&&info.kiters.has(near.uk)){
      d-=Math.max(0,20-nd)*AI_TUNE.closeW;                      // undo WP10's pure-melee closing reward
      const ndNow=Math.min(...ctx.enemies.filter(e=>e.toks.length).map(e=>Math.min(...e.toks.map(t=>Math.hypot(t.x-ctx.cx,t.y-ctx.cy)))));
      const closure=ndNow-nd;
      if(closure>0.5) d-=closure*AI_TUNE.noChaseW;               // actively refuse the chase
      if(objC) d+=AI_TUNE.holdHomeW;                             // ...park on the objective and make them come
    }
  }
  // recon plan: reward spreading away from the rest of the army (board presence)
  if(aiPlan==="recon"){
    const others=state.tokens.filter(t=>t.owner===2&&t.unit!==ctx.uk);
    if(others.length){
      const near=Math.min(...others.map(t=>Math.hypot(t.x-c.x,t.y-c.y)));
      d+=Math.min(12,near)*AI_TUNE.reconSpreadW;
    }
  }
  return d;
}
/* ---- doctrines 4 + 7: focus fire / finish shocked-prone units (aiTargetScore hook) ----
   Meta notes: battle-shock pressure is real tech in 11th; kills that REMOVE units take their
   OC and actions off the table — spread damage does neither. */
function wp11TargetAdjust(s,tgt,exp){
  const totW=tgt.toks.reduce((t2,x)=>t2+(x.wounds||1),0)||1;
  const start=Math.max(0,...tgt.toks.map(t=>+t.u0||0))||tgt.toks.length;
  const hurt=tgt.toks.length<start||tgt.toks.some(t=>(t.wounds||1)<(t.maxW||1));
  if(hurt){
    const kill=Math.min(1,exp/totW);                 // how close this volley gets to REMOVING the unit
    s*=1+(AI_TUNE.focusW/3)*kill;
  }
  if(exp>AI_TUNE.overkill*totW) s*=0.8;              // ~30% overkill is fine; dumping far past it is waste
  const tal=wp6Tallies(), mR=mmIn(40)/2;
  const onObj=tal.some(x=>tgt.toks.some(t=>Math.hypot(t.x-x.o.x,t.y-x.o.y)-mR-tokRadius(t)<=3.02));
  if(onObj&&aiBelowHalf(tgt.toks)) s*=1+AI_TUNE.shockFinishW/4;  // 7: finish shocked-prone squatters
  const behind=tal.filter(x=>x.holder===2).length<tal.filter(x=>x.holder===1).length;
  if(behind&&onObj) s*=AI_TUNE.behindObjMult;        // 4b: behind on primary → objective squatters first
  return s;
}
/* ==== end WP11 ==== */

/* ==== WP12: phone ==== board-first command deck.
   Desktop DOM/render untouched: everything is gated on the html.phone class, all
   injected elements (#phoneNav, #wp12Peek, #wp12SheetHead, #wp12RosterBtn) are
   created once at init and display:none off-phone. No game logic here — pure
   layout plumbing. Detection: (min screen dimension ≤ 820 AND coarse pointer)
   OR a phone UA OR a narrow VIEWPORT (innerWidth ≤ 820 — ==== WP-MOBILE: catches a
   narrow browser window/split-view on an otherwise-desktop UA+pointer, which used
   to fall through to the cramped desktop layout); iPads (incl. iPadOS's
   "Macintosh" UA with touch) deliberately stay desktop regardless of width —
   WP8's touch pass covers them. Node-harness safe: every entry point no-ops to
   desktop when window / matchMedia / screen / document.body are absent. */
let wp12Mode="desktop", wp12Ready=false, wp12Built=false, wp12Els=null, wp12SheetOpen=null, wp12PulseT=null;
const WP12_TABS={army:"Army",cards:"Cards",attack:"Attack",setup:"Setup",log:"Battle log"};
function wp12Detect(){ // auto-detection only — the Setup override is applied in wp12Resolve()
  try{
    if(typeof window==="undefined") return "desktop";
    const ua=(typeof navigator!=="undefined"&&navigator.userAgent)||"";
    const mtp=(typeof navigator!=="undefined"&&navigator.maxTouchPoints)||0;
    if(/iPad/i.test(ua)||(/Macintosh/.test(ua)&&mtp>1)) return "desktop";   // iPads stay desktop regardless of width
    if(/iPhone|iPod/.test(ua)||(/Android/i.test(ua)&&/Mobile/i.test(ua))) return "phone";
    /* ==== WP-MOBILE: narrow viewport also gets the phone command deck, independent of pointer/UA ==== */
    const iw=(typeof window.innerWidth==="number")?window.innerWidth:0;
    if(iw>0&&iw<=820) return "phone";
    /* ==== end WP-MOBILE ==== */
    if(typeof screen==="undefined"||!screen) return "desktop";
    if(typeof window.matchMedia!=="function") return "desktop";
    const coarse=!!window.matchMedia("(pointer:coarse)").matches;
    const dim=Math.min(screen.width||1e5,screen.height||1e5);                // min of the DEVICE, not the viewport — a rotated phone is still a phone
    return (dim<=820&&coarse)?"phone":"desktop";
  }catch(e){ return "desktop"; }
}
function wp12Pref(){ try{ const v=typeof localStorage!=="undefined"&&localStorage.getItem("wh40k_layout"); return (v==="phone"||v==="desktop")?v:"auto"; }catch(e){ return "auto"; } }
function wp12Resolve(){ const p=wp12Pref(); return p==="auto"?wp12Detect():p; }
function wp12SetPref(v){
  try{ if(typeof localStorage!=="undefined"){ if(v==="phone"||v==="desktop") localStorage.setItem("wh40k_layout",v); else localStorage.removeItem("wh40k_layout"); } }catch(e){}
  wp12Apply(wp12Resolve());
}
function wp12Apply(mode){
  mode=mode==="phone"?"phone":"desktop";
  const changed=mode!==wp12Mode;
  wp12Mode=mode;
  const de=typeof document!=="undefined"&&document.documentElement;
  if(de&&de.classList&&de.classList.toggle) de.classList.toggle("phone",mode==="phone");
  if(mode!=="phone") wp12SheetSet(null);            // never leave sheet classes behind on desktop
  if(changed&&wp12Ready&&typeof resize==="function"){ resize(); if(typeof fitView==="function") fitView(); }
}
function wp12Build(){ // injected chrome — created ONCE; visibility is pure CSS (html.phone)
  if(wp12Built) return;
  if(typeof document==="undefined"||!document.body||!document.createElement) return;
  const mk=(tag,id,txt)=>{ const e=document.createElement(tag); if(id)e.id=id; if(txt!=null)e.textContent=txt; return e; };
  const nav=mk("div","phoneNav");
  wp12Els={nav,btns:{}};
  /* ==== WP13 ==== nav order: Attack promoted (mid-game reach), Setup demoted to a trailing ⚙ icon */
  [["army","Army"],["attack","Attack"],["cards","Cards"],["log","Log"],["builder","Builder"],["setup","⚙"]].forEach(([k,label])=>{
    const b=mk("button","wp12nav-"+k,label); b.onclick=()=>wp12Nav(k); nav.appendChild(b); wp12Els.btns[k]=b;
  });
  const peek=mk("div","wp12Peek"); peek.onclick=()=>wp12Nav("log"); wp12Els.peek=peek;
  const head=mk("div","wp12SheetHead"); head.onclick=()=>wp12SheetSet(null);
  head.appendChild(mk("div","wp12Grab"));
  wp12Els.title=mk("span","wp12SheetTitle"); head.appendChild(wp12Els.title);
  head.appendChild(mk("button","wp12SheetClose","✕"));
  document.body.appendChild(nav); document.body.appendChild(peek); document.body.appendChild(head);
  const bh=document.getElementById("bHead");
  const rb=mk("button","wp12RosterBtn","Roster"); rb.onclick=wp12RosterToggle; wp12Els.roster=rb;
  if(bh&&bh.appendChild) bh.appendChild(rb);
  if(typeof renderRoster==="function"){ const rr=renderRoster; renderRoster=function(){ const r=rr.apply(this,arguments); wp12RosterLabel(); return r; }; } // own-block patch: keeps the roster button label live
  wp12Built=true;
}
function wp12Nav(k){
  if(k==="builder"){
    wp12SheetSet(null);
    const bo=typeof document!=="undefined"&&document.getElementById&&document.getElementById("builderOverlay");
    if(bo&&bo.classList&&bo.classList.remove) bo.classList.remove("wp12-roster-open");
    if(typeof openBuilder==="function") openBuilder();
    wp12RosterLabel();
    return;
  }
  if(wp12SheetOpen===k){ wp12SheetSet(null); return; }   // tapping the active tab closes the sheet (back to the board)
  if(k!=="log"&&typeof showTab==="function") showTab(k);
  wp12SheetSet(k);
}
function wp12SheetSet(k){ // k = army|cards|attack|setup (side sheet), log (log sheet), null (closed)
  wp12SheetOpen=k||null;
  const de=typeof document!=="undefined"&&document.documentElement;
  if(de&&de.classList&&de.classList.toggle){
    de.classList.toggle("wp12-open-side",!!k&&k!=="log");
    de.classList.toggle("wp12-open-log",k==="log");
  }
  if(wp12Els){
    if(wp12Els.title) wp12Els.title.textContent=k?WP12_TABS[k]||"":"";
    for(const key in wp12Els.btns){ const b=wp12Els.btns[key]; if(b.classList&&b.classList.toggle) b.classList.toggle("active",key===k); }
    const ab=wp12Els.btns.attack;
    if(k==="attack"&&ab&&ab.classList&&ab.classList.remove) ab.classList.remove("wp12pulse");
  }
  if(k==="log"&&typeof logEl!=="undefined"&&logEl) logEl.scrollTop=logEl.scrollHeight;
}
function wp12PeekUpdate(){ // called from logEntry (marked hook): mirror the latest log line
  if(!wp12Els||!wp12Els.peek) return;
  const le=typeof logEl!=="undefined"&&logEl, kids=le&&le.children;
  const last=kids&&kids.length?kids[kids.length-1]:null;
  wp12Els.peek.textContent=last?(last.textContent||String(last.innerHTML||"").replace(/<[^>]*>/g,"")):"";
}
function wp12AttackPulse(){ // called from wp3Stage (marked hook)
  if(wp12Mode!=="phone"||!wp12Els||!wp12Els.btns.attack||wp12SheetOpen==="attack") return;
  const b=wp12Els.btns.attack;
  if(b.classList&&b.classList.add){ b.classList.remove("wp12pulse"); void b.offsetWidth; b.classList.add("wp12pulse"); }
  if(typeof setTimeout==="function"){ clearTimeout(wp12PulseT); wp12PulseT=setTimeout(()=>{ if(b.classList&&b.classList.remove) b.classList.remove("wp12pulse"); },5200); }
}
function wp12RosterToggle(){
  const bo=typeof document!=="undefined"&&document.getElementById&&document.getElementById("builderOverlay");
  if(bo&&bo.classList&&bo.classList.toggle) bo.classList.toggle("wp12-roster-open");
  wp12RosterLabel();
}
function wp12RosterLabel(){
  if(!wp12Els||!wp12Els.roster) return;
  try{ wp12Els.roster.textContent="Roster ("+myList.items.length+") · "+bTotalPts()+"pts"; }catch(e){}
}
function wp12Init(){
  wp12Build();
  try{ const sel=document.getElementById("wp12LayoutSel"); if(sel) sel.value=wp12Pref(); }catch(e){}
  wp12Apply(wp12Resolve());
  if(typeof window!=="undefined"&&window.addEventListener){
    window.addEventListener("orientationchange",()=>wp12Apply(wp12Resolve()));
    window.addEventListener("resize",()=>{ if(wp12Pref()==="auto"){ const m=wp12Detect(); if(m!==wp12Mode) wp12Apply(m); } });
  }
  wp12Ready=true;
}
/* ==== end WP12 ==== */

/* ==== WP13: nav & token action menu ==== one-tap context surfacing + a touch path
   for every keyboard-only token action. Desktop changes are limited to: right-click
   ON a token opens the menu (empty board still pans), and the inspector ⋯ button.
   Node-harness safe: every entry point no-ops without a DOM. */
function wp13OnStage(){ // wp3Stage hook: phone jumps straight to the Attack sheet
  if(wp12Mode==="phone"&&typeof wp12SheetSet==="function"){
    if(typeof showTab==="function") showTab("attack"); // wp3Stage already did this — belt & braces
    wp12SheetSet("attack");
  } else if(typeof wp12AttackPulse==="function") wp12AttackPulse();
}
function wp13AfterRoll(){ // rollAttack hook: player's staged roll → close the sheet, board shows the result
  if(wp12Mode!=="phone") return;
  if(!wp3Label||/^⚔ AI/.test(wp3Label)) return;     // manual dice / AI rolls leave the sheet alone
  if(typeof wp12SheetSet==="function") wp12SheetSet(null);
}
function wp13BoardFocus(){ // wp11 allocation banner: make sure the board (and banner) are visible
  if(wp12Mode==="phone"&&wp12SheetOpen&&typeof wp12SheetSet==="function") wp12SheetSet(null);
}
/* ---- token action menu: every keyboard-only action gets a click/touch path ----
   Open: long-press a model (phone), right-click a model (desktop), inspector ⋯.
   All rows route through the same functions/ops as the keyboard shortcuts.
   wp13Tok!==null is the "open" flag (classList is display only, node-stub safe). */
let wp13Tok=null, wp13El=null, wp13DelArm=false, wp13Sub=null;
function wp13El_(){
  if(wp13El) return wp13El;
  if(typeof document==="undefined"||!document.body||!document.createElement) return null;
  wp13El=document.createElement("div"); wp13El.id="wp13Menu";
  document.body.appendChild(wp13El);
  return wp13El;
}
function wp13MenuOpen(tok,cx,cy){
  const el=wp13El_(); if(!el||!tok) return;
  if(!sel.has(tok.id)){ sel.clear(); sel.add(tok.id); }
  wp13Tok=tok; wp13DelArm=false; wp13Sub=null;
  wp13MenuRender();
  if(el.classList&&el.classList.add) el.classList.add("open");
  wp13Place(cx||0,cy||0);
  draw();
}
function wp13Place(cx,cy){
  const el=wp13El; if(!el||!el.style) return;
  el.style.left="0px"; el.style.top="0px";
  const r=el.getBoundingClientRect?el.getBoundingClientRect():{width:220,height:260};
  const W=(typeof window!=="undefined"&&window.innerWidth)||1000, H=(typeof window!=="undefined"&&window.innerHeight)||800;
  el.style.left=Math.max(4,Math.min(cx,W-(r.width||220)-4))+"px";
  el.style.top =Math.max(4,Math.min(cy,H-(r.height||260)-8))+"px";
}
function wp13Close(){
  if(wp13El&&wp13El.classList&&wp13El.classList.remove) wp13El.classList.remove("open");
  wp13Tok=null; wp13DelArm=false; wp13Sub=null;
}
function wp13MenuRender(){
  const el=wp13El, t=wp13Tok; if(!el||!t) return;
  const mine=t.owner===mySide;
  const selToks=state.tokens.filter(x=>sel.has(x.id));
  const selUnits=[...new Set(selToks.map(x=>x.unit))];
  const attached=state.tokens.some(x=>x.unit===t.unit&&x.attachedFrom);
  const anyRect=selToks.some(x=>x.shape==="r");
  const row=(fn,ic,label,cls)=>`<button class="w13r ${cls||""}" onclick="${fn}"><span class="w13ic">${ic}</span>${label}</button>`;
  let h=`<div class="w13h">${esc(t.name)} · ${t.wounds}/${t.maxW} W${t.sgt?" · leader":""}</div>`;
  if(wp13Sub==="role"){ h+=wp13RoleRows(t); el.innerHTML=h; return; }
  if(t.maxW>1||t.wounds<t.maxW)
    h+=`<div class="w13row"><span class="w13ic">♥</span><button onclick="wp13Wound(-1)">−</button><b style="min-width:30px;text-align:center">${t.wounds}</b><button onclick="wp13Wound(1)">+</button><span style="color:var(--dim)">wounds</span></div>`;
  if(mine) h+=row("wp15FromMenu()","⚔","Attack with this unit"); /* ==== WP15 ==== two-click quick-flow entry */
  h+=row("wp13SubRole()","◉","Role / weapon tag…");
  h+=row("wp13Hidden()","🙈",(t.hid?"Unmark":"Mark")+" Hidden");
  h+=row("wp13Floor()","▲","Floor level: "+(t.lvl||0)+" (cycle)");
  h+=row("wp13Shock()","💀",(t.bs?"Rally":"Battle-shock")+" unit");
  if(anyRect){
    h+=row("wp13Rotate()","↻","Rotate 15°");
    /* ==== WP-B: fine rotate ==== ±5° nudge, same selected-rect-tokens contract as wp13Rotate */
    h+=`<div class="w13row"><span class="w13ic">↻</span><button onclick="wp13RotateBy(-5)" title="Rotate -5°">−5°</button><button onclick="wp13RotateBy(5)" title="Rotate +5°">+5°</button><span style="color:var(--dim)">fine rotate</span></div>`;
    /* ==== end WP-B ==== */
  }
  if(mine&&attached) h+=row("wp13Detach()","⇤","Detach character");
  else if(mine&&selUnits.length===2) h+=row("wp13Attach()","⇥","Attach to unit");
  if(mine) h+=row("wp13Reserves()","🛸","Into Reserves");
  /* ==== WP-FIGHT: token-menu entries, phase-gated ==== */
  const ph=(state.phase&&typeof state.phase.ph==="number")?state.phase.ph:-1;
  if(mine&&ph===1) h+=row(`wpFallBack('${t.unit}')`,"⚑",t.fellBack?"Fell back":"Fall Back");
  if(mine&&ph===4){ h+=row("wpFightMove('pile')","👣",'Pile in (3")'); h+=row("wpFightMove('consolidate')","👣",'Consolidate (3")'); }
  if(mine&&(ph===1||ph===3)&&mySide!==state.phase.side&&selUnits.length===2) h+=row("wpFightOverwatch()","🔥","Fire Overwatch");
  /* ==== end WP-FIGHT ==== */
  h+=row("wp13Delete()","✖",wp13DelArm?("Really delete "+selToks.length+" model"+(selToks.length!==1?"s":"")+"?"):"Delete model(s)","w13del");
  el.innerHTML=h;
}
function wp13Wound(d){
  const t=wp13Tok; if(!t) return;
  op({k:"tok~",toks:[{id:t.id,wounds:Math.max(0,Math.min(t.maxW,(t.wounds||0)+d))}]});
  wp13MenuRender(); draw();
}
function wp13Hidden(){ if(!wp13Tok) return; toggleHidden(); wp13Close(); draw(); }
function wp13Floor(){ if(!wp13Tok) return; cycleFloor(); wp13MenuRender(); draw(); }
function wp13Shock(){ if(!wp13Tok) return; wp6ToggleShock(); wp13Close(); draw(); }
function wp13Rotate(){
  state.tokens.filter(x=>sel.has(x.id)&&x.shape==="r").forEach(x=>op({k:"tok~",toks:[{id:x.id,rot:((x.rot||0)+15)%360}]}));
  draw();
}
/* ==== WP-B: fine rotate ==== ±5° nudge buttons next to the 15° menu rotate */
function wp13RotateBy(delta){
  state.tokens.filter(x=>sel.has(x.id)&&x.shape==="r").forEach(x=>op({k:"tok~",toks:[{id:x.id,rot:((x.rot||0)+delta+360)%360}]}));
  wp13MenuRender(); draw();
}
/* ==== end WP-B ==== */
function wp13Attach(){ if(!wp13Tok) return; wp7Attach(); wp13Close(); draw(); }
function wp13Detach(){ const t=wp13Tok; if(!t) return; wp7Detach(t.unit); wp13Close(); draw(); }
function wp13Reserves(){ const t=wp13Tok; if(!t) return; wp7ToReserves(t.unit); wp13Close(); draw(); }
function wp13Delete(){
  if(!wp13Tok) return;
  if(!wp13DelArm){ wp13DelArm=true; wp13MenuRender(); return; }
  const ids=[...sel].filter(id=>state.tokens.some(x=>x.id===id));
  if(ids.length) op({k:"tok-",ids});
  sel.clear(); wp3Hide(); wp13Close(); draw();
}
function wp13SubRole(){ wp13Sub="role"; wp13MenuRender(); }
function wp13MenuFromInspector(ev){
  if(typeof wp3Ctx!=="undefined"&&wp3Ctx&&wp3Ctx.tok) wp13MenuOpen(wp3Ctx.tok,(ev&&ev.clientX)||120,(ev&&ev.clientY)||120);
}
// close on any press outside the menu (capture phase → runs before board handlers), and on Esc
if(typeof document!=="undefined"&&document.addEventListener)
  document.addEventListener("pointerdown",e=>{ if(wp13Tok&&wp13El&&!(wp13El.contains&&wp13El.contains(e.target))) wp13Close(); },true);
if(typeof window!=="undefined"&&window.addEventListener)
  window.addEventListener("keydown",e=>{ if(e.key==="Escape"&&wp13Tok) wp13Close(); });
/* ==== end WP13 ==== */

/* ==== WP14: model roles ==== per-model role codes (t.role) → colour pips on the base.
   SGT is stamped at deploy (existing minority-profile heuristic); weapon roles are
   best-effort parsed from the builder's free-text loadout (card.wg) and always
   editable in two taps via the WP13 menu. Colours are Okabe-Ito (colour-blind safe)
   and every pip also carries the letter, so colour is never the only channel.
   Syncs via the existing tok+/tok~ ops; absent field = nothing drawn (back-compat). */
const WP14_ROLES={ // c = pip colour (Okabe-Ito), tc = letter colour on that pip, l = legend label
  SGT:{c:"#e8b23a",tc:"#0e0c0f",l:"Sergeant / leader"},
  PLA:{c:"#56b4e9",tc:"#0e0c0f",l:"Plasma"},
  MLT:{c:"#d55e00",tc:"#ffffff",l:"Melta / fusion"},
  FLM:{c:"#e69f00",tc:"#0e0c0f",l:"Flame / torrent"},
  HVY:{c:"#009e73",tc:"#ffffff",l:"Heavy weapon"},
  SNP:{c:"#cc79a7",tc:"#0e0c0f",l:"Sniper"},
  GRN:{c:"#f0e442",tc:"#0e0c0f",l:"Grenade launcher"},
  BAN:{c:"#0072b2",tc:"#ffffff",l:"Banner / icon"},
  SPC:{c:"#999999",tc:"#0e0c0f",l:"Special (other)"},
};
function wp14RoleFor(name){
  const n=String(name||"").toLowerCase();
  if(/plasma/.test(n)) return "PLA";
  if(/melta|fusion/.test(n)) return "MLT";
  if(/flame|burna|incinerat|torrent/.test(n)) return "FLM";
  if(/sniper|stalker/.test(n)) return "SNP";
  if(/grenade launcher|grenade-launcher/.test(n)) return "GRN";
  if(/banner|standard|icon of|relic icon/.test(n)) return "BAN";
  if(/lascannon|cannon|missile|mortar|rocket|rail|lance|heavy bolter|heavy stubber|heavy .*(gun|rifle|blaster)|gatling|launcher/.test(n)) return "HVY";
  return "SPC";
}
function wp14WeaponNames(card){
  try{
    return [...new Set(String((card&&card.weapons)||"").split("\n")
      .map(l=>{ const w=wp3ParseWeapon(l); return w&&w.n; }).filter(Boolean))];
  }catch(e){ return []; }
}
function wp14ParseLoadout(wg,names){
  const out=[];
  try{
    String(wg||"").split(/[,;\n·•+]+/).forEach(part=>{
      part=part.trim(); if(!part) return;
      const m=part.match(/^(\d+)\s*[x×]?\s+(.+)$/)||part.match(/^(\d+)[x×]\s*(.+)$/);
      let count=1, frag=part;
      if(m){ count=Math.max(1,Math.min(30,+m[1]||1)); frag=m[2]; }
      const nf=norm(frag); if(!nf) return;
      const hit=(names||[]).find(nm=>{ const nn=norm(nm); return nn.includes(nf)||nf.includes(nn); });
      const role=wp14RoleFor(hit||frag);
      if(role!=="SPC"||hit) out.push({name:hit||frag,role,count});
    });
  }catch(e){}
  return out;
}
function wp14AutoRoles(u,toks){ // mutates toks in place BEFORE the tok+ op — never throws, never blocks deploy
  try{
    if(!u||!u.wg) return;
    const parsed=wp14ParseLoadout(u.wg,wp14WeaponNames(u)).filter(p=>p.role!=="SPC"); // auto-pip only the loud stuff; SPC stays manual
    const pool=toks.filter(t=>!t.sgt&&!t.role);
    parsed.forEach(p=>{ for(let i=0;i<p.count;i++){ const t=pool.find(x=>!x.role); if(!t) return; t.role=p.role; } });
  }catch(e){}
}
function wp14SetRole(code){ // WP13 menu: apply to every selected model in one op
  const toks=state.tokens.filter(x=>sel.has(x.id));
  if(toks.length) op({k:"tok~",toks:toks.map(x=>({id:x.id,role:code||null}))});
  wp13Close(); draw();
}
function wp13TagSet(){ // free-text ≤4-char tag chip (same field the W key writes)
  const t=wp13Tok; if(!t) return;
  const inEl=typeof document!=="undefined"&&document.getElementById&&document.getElementById("wp13TagIn");
  const v=inEl?String(inEl.value||"").trim().slice(0,4):"";
  const toks=state.tokens.filter(x=>sel.has(x.id));
  if(toks.length) op({k:"tok~",toks:toks.map(x=>({id:x.id,tag:v}))});
  wp13Close(); draw();
}
function wp14Pip(code){
  const R=WP14_ROLES[code]||WP14_ROLES.SPC;
  return `<span class="w13pip" style="background:${R.c};color:${R.tc}">${esc(code[0]||"?")}</span>`;
}
(function wp14Legend(){ // fill the help-dialog legend from the live map — no drift
  try{
    const el=typeof document!=="undefined"&&document.getElementById&&document.getElementById("wp14Legend");
    if(!el) return;
    el.innerHTML=Object.keys(WP14_ROLES).map(c=>`${wp14Pip(c)} ${esc(WP14_ROLES[c].l)}`).join(" · ");
  }catch(e){}
})();
function wp13RoleRows(t){ // the Role submenu of the WP13 token menu
  const card=typeof wp3CardFor==="function"?wp3CardFor(t):null;
  const names=wp14WeaponNames(card);
  let h=`<button class="w13r w13back" onclick="wp13Sub=null;wp13MenuRender()"><span class="w13ic">‹</span>Back</button>`;
  if(names.length){
    h+=`<div class="w13h">This unit's weapons</div>`;
    names.slice(0,12).forEach(nm=>{ const r=wp14RoleFor(nm); h+=`<button class="w13r" onclick="wp14SetRole('${r}')">${wp14Pip(r)}${esc(nm)}</button>`; });
  }
  h+=`<div class="w13h">Mark as</div>`;
  for(const c in WP14_ROLES) h+=`<button class="w13r" onclick="wp14SetRole('${c}')">${wp14Pip(c)}${esc(WP14_ROLES[c].l)}</button>`;
  h+=`<button class="w13r" onclick="wp14SetRole('')"><span class="w13ic">∅</span>Clear role</button>`;
  h+=`<div class="w13row">Tag <input id="wp13TagIn" maxlength="4" value="${esc(t.tag||"")}"><button onclick="wp13TagSet()">Set</button></div>`;
  return h;
}
/* ==== end WP14 ==== */

/* ==== WP15: two-click attack quick-flow ==== ⚔ toolbar tool: click your unit, then
   the enemy unit — the Attack tab pre-fills BOTH sides via the existing wp3Stage,
   with a sensible default weapon, attacks auto-multiplied by how many models carry
   that weapon (WP14 role pips), and a Weapon selector to switch profiles without
   re-clicking. Pure local UI: reuses wp3Stage + wp3CardFor + aiMulA, adds no op
   kinds and no synced state. Everything staged stays fully editable. */
let wp15Atk=null;   // {unit,owner} armed attacker (first click of the two)
let wp15Ctx=null;   // {ctx0,tgtTok} last staged pair, kept for weapon-switch restaging

function wp15Disarm(){ wp15Atk=null; }
function wp15Arm(tk){
  wp15Atk={unit:tk.unit,owner:tk.owner};
  sel.clear(); state.tokens.forEach(t=>{ if(t.unit===tk.unit) sel.add(t.id); });
  logSys(`Attack: ${tk.name} armed — now click an enemy model (Esc cancels).`);
  draw();
}
// ⚔ tool click dispatch: own model arms (or re-arms), enemy model fires, empty ground ignored.
function wp15ToolClick(ix,iy){
  const tk=hitToken(ix,iy);
  if(!tk) return;
  if(tk.owner===mySide){ wp15Arm(tk); return; }
  if(wp15Atk) wp15Go(tk);
  else logSys("Attack tool: click one of YOUR models first, then the enemy.");
}
// How many models in the unit carry this weapon. Weapon-role pips are every WP14
// code except SGT; basic weapons (family SPC) belong to the un-pipped bodies.
function wp15CarrierCount(atkToks,w){
  const fam=wp14RoleFor(w.n);
  return fam!=="SPC" ? atkToks.filter(t=>t.role===fam).length
                     : atkToks.filter(t=>!t.role||t.role==="SGT").length;
}
// Deterministic default weapon: melee when engaged; otherwise the in-range gun with
// the biggest carriers×average-attacks output (ties → first); otherwise the ranged
// weapon with the smallest range shortfall (i.e. the longest gun).
function wp15DefaultWi(weapons,dist,atkToks,rangedOnly){
  if(!rangedOnly&&dist<=2.02){ const mi=weapons.findIndex(w=>w.melee); if(mi>=0) return mi; } /* 11th-ed engagement range 2" */
  const ranged=weapons.map((w,i)=>({w,i})).filter(x=>!x.w.melee);
  if(!ranged.length) return rangedOnly?-1:weapons.findIndex(w=>w.melee); // rangedOnly (e.g. Overwatch): a melee-only unit can't; else stage melee anyway
  const inR=ranged.filter(x=>dist<=x.w.rng+0.02);
  if(inR.length){
    let best=inR[0],bestV=-1;
    inR.forEach(x=>{ const v=Math.max(1,wp15CarrierCount(atkToks,x.w))*aiAvgDice(x.w.A); if(v>bestV){ bestV=v; best=x; } });
    return best.i;
  }
  let best=ranged[0];
  ranged.forEach(x=>{ if(x.w.rng>best.w.rng) best=x; });
  return best.i;
}
// Second click: build ctx0 from the armed unit and stage the default weapon.
function wp15Go(tgtTok,rangedOnly){
  const armed=wp15Atk; wp15Disarm(); // the next two clicks are a fresh attack; tool stays active
  if(!armed) return;
  const atkToks=state.tokens.filter(t=>t.unit===armed.unit);
  const tgtToks=state.tokens.filter(t=>t.unit===tgtTok.unit);
  if(!atkToks.length||!tgtToks.length) return;
  let atk=atkToks[0],ad=Infinity; // attacker model closest to the target: wp3Stage uses it for LoS / Plunging Fire
  atkToks.forEach(a=>tgtToks.forEach(b=>{ const e=edgeDist(a,b); if(e<ad){ ad=e; atk=a; } }));
  const card=wp3CardFor(atk);
  const weapons=card?String(card.weapons||"").split("\n").map(wp3ParseWeapon).filter(Boolean):[];
  if(!card||!weapons.length){
    logSys(`No weapon profiles for ${atk.name} — add or import the unit card (Army tab) to quick-stage attacks.`);
    return;
  }
  const wi=wp15DefaultWi(weapons,wp3UnitDist(atkToks,tgtToks),atkToks,rangedOnly);
  if(wi<0){ if(rangedOnly) logSys(`${atk.name} has no ranged weapon — Fire Overwatch is a ranged snap-shot, so a melee-only unit can't make it.`); return; }
  const ctx0={tok:atk,card,weapons};
  if(wp3Stage(ctx0,wi,tgtTok)===false) return; /* ==== WP-FIGHT fidelity gate ==== blocked — don't show the weapon selector */
  wp15AfterStage(ctx0,wi,tgtTok);
}
// After wp3Stage (both the ⚔ tool AND the inspector flow): remember the pair for
// restaging, fill + show the Weapon selector, multiply attacks by carrier count.
// mul=false (inspector's single-weapon ⚔ aim) keeps wp3Stage's per-model attacks.
function wp15AfterStage(ctx0,wi,tgtTok,mul){
  mul=mul!==false;
  wp15Ctx={ctx0:{tok:ctx0.tok,card:ctx0.card,weapons:ctx0.weapons},tgtTok,mul};
  const selEl=document.getElementById("wp15Wep"),row=document.getElementById("wp15WepRow");
  selEl.innerHTML=ctx0.weapons.map((w,i)=>`<option value="${i}"${i===wi?" selected":""}>${esc(w.n)} — ${esc(w.A)}/${esc(w.BS)}/${esc(w.S)}/${esc(w.AP)}/${esc(w.D)}</option>`).join("");
  selEl.value=String(wi);
  row.style.display="";
  if(mul) wp15Multiply(ctx0,wi);
}
// Weapon selector onchange: restage the SAME attacker→target with the new weapon.
function wp15WepChange(v){
  if(!wp15Ctx) return;
  const c=wp15Ctx, wi=Math.max(0,parseInt(v)||0);
  if(!c.ctx0.weapons[wi]) return;
  if(wp3Stage(c.ctx0,wi,c.tgtTok)===false) return; /* ==== WP-FIGHT fidelity gate ==== blocked — keep prior selector state */
  wp15AfterStage(c.ctx0,wi,c.tgtTok,c.mul);
}
// Manual edit anywhere in the Attack tab: staging is the player's now — hide the selector.
function wp15ManualEdit(){
  wp15Ctx=null;
  const row=document.getElementById("wp15WepRow"); if(row&&row.style) row.style.display="none";
}
// Prefill ×carriers AFTER wp3Stage set the per-model attacks. akA stays editable.
function wp15Multiply(ctx0,wi){
  const w=ctx0.weapons[wi]; if(!w) return;
  const atkToks=state.tokens.filter(t=>t.unit===ctx0.tok.unit);
  const n=wp15CarrierCount(atkToks,w);
  const stage=document.getElementById("akStage");
  if(n===0){ stage.innerHTML+=`<div class="small">1 carrier assumed — mark carriers with role pips (long-press a model) for auto-counts</div>`; return; }
  if(n>1){
    const a=document.getElementById("akA");
    a.value=aiMulA(a.value,n);
    stage.innerHTML+=`<div class="small">×${n} models carry ${esc(w.n)} — attacks multiplied (editable)</div>`;
  }
}
// WP13 token-menu row: arm this unit via the ⚔ tool and go pick a target.
function wp15FromMenu(){
  const t=wp13Tok; if(!t) return;
  wp13Close();
  setTool("attack");
  wp15Arm(t);
}
/* ==== end WP15 ==== */

/* ==== WP16 ==== quality of life: (A) one-tap apply-damage button for network/hotseat
   staged attacks — reuses aiApplyCasualties (wounded model first, closest to the
   attacker next, leaders/CHARACTER last) through the existing tok~/tok- ops, and
   (B) wp16CycleSec, the shared Secured-cycle body for right-click AND touch long-press.
   Honor system: either client may tap Apply — the button is one-shot (wp16Pending is
   consumed before applying), so a double-tap cannot apply twice. All state here is
   transient module-side bookkeeping — never synced, never saved. */
let wp16Staged=null;   // {tgtUk,atkUk} recorded by wp3Stage — which unit the staged attack targets
let wp16Pending=null;  // {final,failed,mortals,dmgRolls,tgtUk,atkUk} — last rolled, not-yet-applied staged attack
let wp16LogAs="";      // aiApplyCasualties log-line label while the button applies (falls back to "Solo")
function wp16CycleSec(o){ // Secured cycle: none → P1 → P2 → none (same op + wording as the old WP6 body)
  const next=((o.sec||0)+1)%3;
  op({k:"obj~",obj:{id:o.id,sec:next}});
  logShared("◎ <b>"+esc(myName)+"</b> marked an objective "+(next?("<b>Secured</b> by "+esc(state.names[next]||("Player "+next))):"no longer Secured"),"sys");
}
function wp16Btn(){ // create-once: a button element injected right after #akResult (akResult itself is never rebuilt)
  let b=document.getElementById("wp16Apply");
  if(!b){
    b=document.createElement("button");
    b.id="wp16Apply"; b.style.display="none"; b.style.width="100%"; b.style.marginTop="6px";
    b.addEventListener("click",wp16ApplyClick);
    const r=document.getElementById("akResult");
    r.parentNode.insertBefore(b,r.nextSibling);
  }
  return b;
}
function wp16Hide(){ wp16Pending=null; const b=document.getElementById("wp16Apply"); if(b) b.style.display="none"; }
function wp16AfterRoll(final,failed,mortals,dmgRolls){ // rollAttack hook — stands down whenever wp10AttackDone owns the roll
  wp16Hide();                                          // any new roll replaces/hides a stale button first
  if(typeof solo!=="undefined"&&solo) return;          // solo: wp10/wp11 consume staged rolls (same gate wp10 opens with)
  if(!wp3Label||!wp16Staged) return;                   // manual dice — no staged target to apply to
  if(!(final>0)||!state.tokens.some(t=>t.unit===wp16Staged.tgtUk)) return;
  wp16Pending={final,failed,mortals,dmgRolls:(dmgRolls||[]).slice(),tgtUk:wp16Staged.tgtUk,atkUk:wp16Staged.atkUk};
  const b=wp16Btn(), tname=(state.tokens.find(t=>t.unit===wp16Pending.tgtUk)||{}).name||"the target";
  b.textContent=conn?`Send ${final} damage to ${tname} — they allocate`:`Apply ${final} damage to ${tname} (wounded first)`; /* ==== WP18 ==== live network game: the defender allocates */
  b.style.display="block";
}
function wp16ApplyClick(){ // one-shot: wp16Pending is consumed up front, so a second click is a no-op
  const p=wp16Pending; if(!p) return;
  wp16Hide(); wp16Staged=null;
  if(!state.tokens.some(t=>t.unit===p.tgtUk)) return;
  // damage packets exactly as wp10AttackDone builds them: one per failed save (real per-save D rolls when present), mortals as 1s
  let packets=[];
  if(p.dmgRolls&&p.dmgRolls.length===p.failed&&p.failed>0) packets=p.dmgRolls.slice();
  else{ const flat=Math.max(1,parseInt(String(document.getElementById("akD").value).trim())||1);
    packets=new Array(Math.max(0,p.failed)).fill(flat); }
  for(let i=0;i<p.mortals;i++) packets.push(1);
  if(!packets.length) return;
  if(conn&&typeof wp18SendDmg==="function"){ wp18SendDmg(p,packets); return; } /* ==== WP18 ==== live network game: hand the packets to the DEFENDER instead of applying (offline/hotseat path below unchanged) */
  wp16LogAs="<b>"+esc(myName)+"</b>";
  try{ aiApplyCasualties(p.tgtUk,packets,p.final,p.atkUk); } // logs the shared "💥 <name>: N damage applied…" line for both players
  finally{ wp16LogAs=""; }
}
/* ==== end WP16 ==== */

/* ==== WP17 ==== player auto-deploy: place the player's units legally inside their own
   deployment zone, exactly like the AI does for itself (reuses aiPlaceUnit unchanged:
   seeded-shuffled candidate scan, two passes, aiUnitSpots/aiSpotOk legality, one tok~
   per unit). Runs automatically after Muster (pre-battle only) and on demand from the
   Army tab's ⚡ Auto-deploy button. No DZ loaded → deterministic tidy rows along the
   deployer's board edge instead. No new op kinds, no new synced state — tok~ moves only. */

// Pre-battle = round 1 AND the phase engine still at Deploy: state.phase.ph is -1
// before the first "Start battle / next phase" step (wp7RenderPhase shows "Deploy"
// exactly when ph<0 or phase is missing/malformed — same check here).
function wp17PreBattle(){
  if((((state.trackers&&state.trackers.round)||1))!==1) return false;
  const p=state.phase;
  return !p||typeof p!=="object"||typeof p.ph!=="number"||p.ph<0;
}
// Auto-deploy `side`'s units: scope = unit ids in unitIds if given, else every unit
// that side owns on the table. Everything NOT being (re)placed — the opponent plus
// own out-of-scope units — counts as an obstacle for aiPlaceUnit's first pass.
function wp17DeploySide(side,unitIds){
  const ids=unitIds?new Set(unitIds):null;
  const by={};
  state.tokens.forEach(t=>{ if(t.owner===side&&(!ids||ids.has(t.unit)))(by[t.unit]=by[t.unit]||[]).push(t); });
  const units=Object.keys(by).map(k=>by[k]).sort((a,b)=>b.length-a.length); // biggest units grab space first (as aiDeployAll)
  if(!units.length) return;
  const placed=state.tokens.filter(t=>!by[t.unit]);
  const poly=(state.dz&&state.dz[side-1])||null;
  if(!poly||poly.length<3){ wp17EdgeRows(side,units,placed); return; }
  units.forEach(toks=>{
    if(!aiPlaceUnit(toks,poly,placed))
      logSys("Couldn't fit "+((toks[0]&&toks[0].name)||"a unit")+" in the DZ — left where it dropped; drag it if needed.");
  });
}
// No-DZ fallback: pack units into neat formation rows along the deployer's board edge
// (side 1 = bottom, side 2 = top), left-to-right shelves, spacing from each unit's own
// token diameter, ≥1" board margin, no overlap between fallback units. Deterministic —
// no RNG — so both peers and repeated runs produce the identical formation.
function wp17EdgeRows(side,units,placed){
  const m=1, pad=0.5, W=state.board.w, H=state.board.h;
  let cx0=m, off=0, shelfH=0;
  units.forEach(toks=>{
    const gap=Math.max(1.3,2*tokRadius(toks[0])+0.25);
    const per=Math.ceil(Math.sqrt(toks.length)), rows=Math.ceil(toks.length/per);
    const bw=per*gap, bh=rows*gap;
    if(cx0+bw>W-m&&cx0>m){ off+=shelfH+pad; cx0=m; shelfH=0; } // row full → next shelf, one shelf further from the edge
    const cx=Math.min(cx0+bw/2,W-m-bw/2);
    const cy=side===1 ? H-m-off-bh/2 : m+off+bh/2;
    const spots=aiUnitSpots(toks.length,cx,cy,gap);
    op({k:"tok~",toks:toks.map((t,i)=>({id:t.id,x:spots[i][0],y:spots[i][1]}))});
    placed.push.apply(placed,toks);
    cx0+=bw+pad; if(bh>shelfH) shelfH=bh;
  });
}
// "⚡ Auto-deploy" button (Army tab): re-run over ALL own units — setup only.
function wp17AutoDeploy(){
  if(!wp17PreBattle()){ logSys("Auto-deploy is for setup only — the battle is already under way. Drag units (or use Reserves) instead."); return; }
  if(!state.tokens.some(t=>t.owner===mySide)){ logSys("No units on the table yet — Muster your army from the Builder first."); return; }
  wp17DeploySide(mySide);
  logShared(`· <b>${esc(myName)}</b> auto-deployed their army — drag anything you want to adjust`,"sys");
}
/* ==== end WP17 ==== */

/* ==== WP20: dice stats + game summary ==== (A) wp20Note tallies every d6() result
   rolled ON THIS SCREEN (yours, and the AI's in solo) — pure local bookkeeping:
   nothing synced, nothing saved, Reset just zeroes it. 📊 in the top bar toggles a
   create-once fixed popover (same pattern as the WP13 menu; node-harness safe).
   (B) wp20Summary() builds a plain-text game record — players, mission, trackers,
   surviving-unit tally from state.tokens, full battle log text — downloaded via the
   existing dl() helper. All user-generated game record: no GW rules prose. */
let wp20Stats={n:0,counts:[0,0,0,0,0,0],hot:0,cold:0,curHot:0,curCold:0};
let wp20El=null, wp20Open=false;
function wp20Note(r){ // called by d6() for every die; streaks: hot = run of ≥5s, cold = run of ≤2s
  if(!(r>=1&&r<=6)) return;
  const s=wp20Stats;
  s.n++; s.counts[r-1]++;
  s.curHot = r>=5 ? s.curHot+1 : 0;
  s.curCold= r<=2 ? s.curCold+1 : 0;
  if(s.curHot>s.hot) s.hot=s.curHot;
  if(s.curCold>s.cold) s.cold=s.curCold;
  if(wp20Open) wp20Render();
}
function wp20Reset(){ wp20Stats={n:0,counts:[0,0,0,0,0,0],hot:0,cold:0,curHot:0,curCold:0}; if(wp20Open) wp20Render(); }
function wp20El_(){ // create-once, injected into <body> (never into #side) — WP13 pattern
  if(wp20El) return wp20El;
  if(typeof document==="undefined"||!document.body||!document.createElement) return null;
  wp20El=document.createElement("div"); wp20El.id="wp20Pop";
  document.body.appendChild(wp20El);
  return wp20El;
}
function wp20Toggle(){
  const el=wp20El_(); if(!el) return;
  if(wp20Open){ wp20Close(); return; }
  wp20Open=true; wp20Render();
  if(el.classList&&el.classList.add) el.classList.add("open");
}
function wp20Close(){
  wp20Open=false;
  if(wp20El&&wp20El.classList&&wp20El.classList.remove) wp20El.classList.remove("open");
}
function wp20Render(){
  const el=wp20El||wp20El_(); if(!el) return;
  const s=wp20Stats, n=s.n, exp=n/6, max=Math.max(1,...s.counts);
  let h=`<div class="w20h">🎲 Dice rolled on this screen</div>`;
  h+=`<div class="w20tot"><b>${n}</b> dice · yours + the AI's · local only (never saved or synced)</div>`;
  for(let f=1;f<=6;f++){
    const c=s.counts[f-1], d=n?Math.round((c-exp)/exp*100):0;
    h+=`<div class="w20row"><span class="w20f">${f}</span><span class="w20bar"><span class="w20fill" style="width:${n?Math.round(c/max*100):0}%"></span>${n?`<span class="w20exp" style="left:${Math.round(exp/max*100)}%" title="exp ${exp.toFixed(1)}"></span>`:""}</span><span class="w20c">${c}</span><span class="w20d">${n?(d>0?"+":"")+d+"%":"–"}</span></div>`;
  }
  h+=`<div class="w20tot">│ = exp (n/6${n?" ≈ "+exp.toFixed(1):""} per face) · % = above/below exp</div>`;
  h+=`<div class="w20tot">Longest streaks — hot (5–6): <b>${s.hot}</b> · cold (1–2): <b>${s.cold}</b></div>`;
  h+=`<div class="row" style="margin-top:6px"><button onclick="wp20Reset()">Reset</button></div>`;
  el.innerHTML=h;
}
// close on outside press (capture, ignoring the 📊 toggle itself) and on Esc — WP13 pattern
if(typeof document!=="undefined"&&document.addEventListener)
  document.addEventListener("pointerdown",e=>{ if(wp20Open&&wp20El&&!(wp20El.contains&&wp20El.contains(e.target))&&!(e.target&&e.target.id==="wp20Btn")) wp20Close(); },true);
if(typeof window!=="undefined"&&window.addEventListener)
  window.addEventListener("keydown",e=>{ if(e.key==="Escape"&&wp20Open) wp20Close(); });
function wp20Summary(){ // plain-text game record; must never throw, even on a blank table
  const s=state||{}, tr=s.trackers||{}, nm=s.names||{};
  const p1=nm[1]||"Player 1", p2=nm[2]||"Player 2";
  const L=["WH40K BATTLE SUMMARY", new Date().toLocaleString(), ""];
  L.push("Players: "+p1+" (Red, side 1) vs "+p2+" (Blue, side 2)");
  L.push("Mission: "+(s.mission&&s.mission.name?s.mission.name+(s.mission.m?" — "+s.mission.m:""):"(no layout loaded)"));
  L.push("Battle round: "+(tr.round!=null?tr.round:1));
  L.push("VP: "+p1+" "+(tr.vp1||0)+" — "+(tr.vp2||0)+" "+p2);
  L.push("CP: "+p1+" "+(tr.cp1||0)+" — "+(tr.cp2||0)+" "+p2);
  for(const side of [1,2]){
    L.push(""); L.push("Surviving units — "+(side===1?p1:p2)+" (destroyed units no longer appear):");
    const by={};
    for(const t of (s.tokens||[])) if(t.owner===side) (by[t.unit]=by[t.unit]||[]).push(t);
    const ks=Object.keys(by);
    if(!ks.length) L.push("  (none on the table)");
    for(const k of ks){
      const ms=by[k], alive=ms.length;
      const start=Math.max(alive,...ms.map(t=>+t.u0||0)); // u0 = starting strength stamped at deploy (WP7); legacy tokens fall back to the live count
      L.push("  "+(ms[0].name||k)+" ×"+alive+"/"+start);
    }
  }
  L.push(""); L.push("Battle log:");
  const kids=(typeof logEl!=="undefined"&&logEl&&logEl.children)?logEl.children:[];
  for(const c of kids){
    let txt=(c.textContent&&String(c.textContent).trim())?c.textContent:String(c.innerHTML||"").replace(/<[^>]*>/g," "); // node-stub divs never fill textContent
    txt=String(txt).replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();
    if(txt) L.push(txt);
  }
  return L.join("\n");
}
function wp20Export(){ dl("wh40k-battle-summary.txt", wp20Summary()); } // local action — deliberately no logShared
/* ==== end WP20 ==== */

/* ==== WP19 ==== waypoint ruler: single clicks with the 📏 tool chain waypoints around terrain;
   a plain drag is still the classic straight measure. ruler.pts = [wp0,…,wpN,cursor] while a chain
   is live; x0..y1 ALWAYS mirror the last leg so an older peer's drawRuler still shows that leg. */
let wp19Chain=false, wp19LastSend=0;
function wp19Click(ix,iy){ // pointerup that moved <0.3": commit a waypoint and keep the tape live
  if(!ruler) return;
  if(!wp19Chain){ wp19Chain=true; ruler.pts=[[ruler.x0,ruler.y0],[ix,iy]]; } // first click: anchor + cursor leg
  else{ ruler.pts[ruler.pts.length-1]=[ix,iy]; ruler.pts.push([ix,iy]); }    // commit the cursor point, start a new leg
  wp19Cursor(ix,iy);
  wp19LastSend=Date.now(); send({t:"ruler",r:ruler});
}
function wp19Cursor(ix,iy){ // move the trailing cursor point; keep x0..y1 mirroring the LAST leg (old-peer compat)
  const p=ruler.pts; p[p.length-1]=[ix,iy];
  ruler.x0=p[p.length-2][0]; ruler.y0=p[p.length-2][1]; ruler.x1=ix; ruler.y1=iy;
}
function wp19Send(){ // live-share the chain, throttled to ≤ one message per 80ms
  const now=Date.now(); if(now-wp19LastSend<80) return;
  wp19LastSend=now; send({t:"ruler",r:ruler});
}
function wp19End(clear){ // Esc / dblclick / tool switch → clear+final send; clear===false = silent handoff to a plain drag
  const had=wp19Chain||(ruler&&ruler.pts);
  wp19Chain=false;
  if(!had) return;
  if(clear!==false){ ruler=null; send({t:"ruler",r:null}); draw(); } // final send: opponent's copy blanks/expires normally
}
function wp19Total(r){ // cumulative chain length in inches (all legs incl. the cursor leg)
  let d=0; for(let i=1;i<r.pts.length;i++) d+=Math.hypot(r.pts[i][0]-r.pts[i-1][0],r.pts[i][1]-r.pts[i-1][1]);
  return d;
}
function wp19DrawChain(r,color){ // polyline + waypoint dots + ONE cumulative label chip near the cursor end
  const p=r.pts;
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.beginPath();
  p.forEach((pt,i)=>{ const q=px(pt[0],pt[1]); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]); });
  ctx.stroke();
  ctx.fillStyle=color;
  p.forEach(pt=>{ const q=px(pt[0],pt[1]); ctx.beginPath(); ctx.arc(q[0],q[1],3,0,7); ctx.fill(); });
  const legs=[]; for(let i=1;i<p.length;i++) legs.push(Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
  let label=wp19Total(r).toFixed(1)+'"';
  if(legs.length>1) label+=" ("+legs.map(d=>d.toFixed(1)).join(" + ")+")";
  const end=px(p[p.length-1][0],p[p.length-1][1]);
  ctx.font="bold 13px sans-serif";
  const w=ctx.measureText(label).width;
  ctx.fillStyle="rgba(16,18,22,.9)"; ctx.fillRect(end[0]+12,end[1]-24,w+10,18);
  ctx.fillStyle=color; ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText(label,end[0]+17,end[1]-15);
}
/* ==== end WP19 ==== */

/* ==== WP18 ==== wound-allocation v2: suggestions + P2P defender allocation.
   (A) While WP11's banner pends and the allocation is mine, the board shows the
       order the auto-assigner (aiApplyCasualties) would consume models: a pulsing
       gold dashed ring on the next suggestion plus numbered badges (1,2,3) on the
       first three. Suggestions only — the player clicks whatever legal model they
       want; wp11AllocClick's rules and the A auto-assign are untouched.
   (B) In a live P2P game the attacker's WP16 button SENDS the rolled damage to the
       defender as a transient {t:"dmg"} direct message (like "ruler": never in
       state, lost on reconnect — re-send if that happens). The defender allocates
       through the same WP11 banner/click flow and the resulting tok~/tok- ops sync
       back to the attacker automatically. No new applyOp kinds. */
let wp18Timer=null; // pulse redraw while the suggestion ring is on screen (self-limiting: stops when wp11Alloc clears)
function wp18Order(tgtUk,atkUk){
  // Faithful mirror of aiApplyCasualties' comparator (kept byte-identical there): the
  // order it would consume models in — already-wounded first, then closest to the
  // attacker unit's centroid, squad leaders (sgt) and CHARACTER models last.
  const atkMs=state.tokens.filter(t=>t.unit===atkUk);
  const ax=atkMs.length?atkMs.reduce((s,t)=>s+t.x,0)/atkMs.length:0;
  const ay=atkMs.length?atkMs.reduce((s,t)=>s+t.y,0)/atkMs.length:0;
  return state.tokens.filter(t=>t.unit===tgtUk).slice().sort((a,b)=>{
    const la=(a.sgt||tokKw(a).includes("CHARACTER"))?1:0, lb=(b.sgt||tokKw(b).includes("CHARACTER"))?1:0;
    if(la!==lb) return la-lb;
    const wa=(a.wounds||1)<(a.maxW||1)?0:1, wb=(b.wounds||1)<(b.maxW||1)?0:1;
    if(wa!==wb) return wa-wb;
    if(!atkMs.length) return 0;
    return Math.hypot(a.x-ax,a.y-ay)-Math.hypot(b.x-ax,b.y-ay);
  });
}
function wp18SuggOrder(a){
  // Click-facing order: wp18Order, but the model wp11AllocClick would REDIRECT the next
  // click to (the unit's first already-wounded model, even a leader) is hoisted to #1.
  const ord=wp18Order(a.tgtUk,a.atkUk);
  const wounded=state.tokens.find(t=>t.unit===a.tgtUk&&(t.wounds||1)<(t.maxW||1));
  if(wounded){ const i=ord.findIndex(t=>t.id===wounded.id); if(i>0){ ord.splice(i,1); ord.unshift(wounded); } }
  return ord;
}
function wp18Overlay(){ // called from draw() right after wp6Overlay()
  if(typeof wp11Alloc==="undefined"||!wp11Alloc) return;
  const a=wp11Alloc, t0=state.tokens.find(t=>t.unit===a.tgtUk);
  if(!t0||t0.owner!==mySide) return;               // suggestions are for the allocating defender only
  const ord=wp18SuggOrder(a); if(!ord.length) return;
  const phase=Math.floor(Date.now()/300)%2;        // two-radius pulse (no rAF loop elsewhere to hook into)
  ord.slice(0,3).forEach((t,i)=>{
    const [cx,cy]=px(t.x,t.y);
    const r=(t.shape==="c"?mmIn(t.dmm)/2:Math.hypot(t.wIn,t.hIn)/2)*view.s;
    if(i===0){                                     // pulsing gold dashed ring on the next suggested model
      ctx.beginPath(); ctx.arc(cx,cy,r+(phase?6:3),0,7);
      ctx.strokeStyle="#e8b23a"; ctx.lineWidth=2; ctx.setLineDash([5,4]); ctx.stroke(); ctx.setLineDash([]);
    }
    const br=Math.max(7,view.s*.35);               // numbered badge: 1 = suggested next, 2/3 = then these
    ctx.beginPath(); ctx.arc(cx-r*.75,cy-r*.75,br,0,7);
    ctx.fillStyle=i===0?"#e8b23a":"rgba(232,178,58,.55)"; ctx.fill();
    ctx.fillStyle="#101216"; ctx.font="bold "+Math.max(9,view.s*.45)+"px sans-serif";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(String(i+1),cx-r*.75,cy-r*.75+.5);
  });
  if(!wp18Timer) wp18Timer=setTimeout(()=>{ wp18Timer=null; if(typeof wp11Alloc!=="undefined"&&wp11Alloc) draw(); },300);
}
function wp18SendDmg(p,packets){ // attacker side (called from wp16ApplyClick when conn is live): hand the roll to the defender
  const tname=(state.tokens.find(t=>t.unit===p.tgtUk)||{}).name||"the target";
  const label=String(wp3Label||("Attack on "+tname)).replace(/^⚔\s*/,"");
  send({t:"dmg",tgtUk:p.tgtUk,atkUk:p.atkUk,packets,final:p.final,label});
  logShared(`💥 <b>${esc(myName)}</b> sent ${p.final} damage to <b>${esc(tname)}</b> — defender allocates`,"sys");
}
function wp18OnDmg(m){ /* SEC: hostile payloads must be a silent no-op — every field coerced/capped before use */
  const tgtUk=secStr(m.tgtUk,40), atkUk=secStr(m.atkUk,40), label=secStr(m.label,120)||"Incoming attack";
  const final=Math.max(0,Math.min(999,Math.floor(+m.final)||0));                 // int 0..999
  const packets=(Array.isArray(m.packets)?m.packets:[]).slice(0,60)             // length capped at 60
    .map(p=>Math.floor(+p)).filter(p=>p>=1&&p<=24);                              // each an int 1..24 or dropped
  if(!tgtUk||!final||!packets.length) return;
  const t0=state.tokens.find(t=>t.unit===tgtUk);
  if(!t0||t0.owner!==mySide) return;             // only the owner of the target unit may be handed the allocation
  wp11Alloc={tgtUk,atkUk,packets,applied:0,budget:final,label};                  // existing WP11 click/A flow takes over
  wp11Banner();
  if(typeof wp13BoardFocus==="function") wp13BoardFocus();
  draw();
  logSys("Incoming: "+packets.length+" damage packet"+(packets.length!==1?"s":"")+" against "+t0.name+" — click models in that unit to allocate (wounded model first), or press A to auto-assign.");
}
/* ==== end WP18 ==== */

/* ==== WP23 ==== side switching after muster: setSide used to just flip `mySide` and
   re-send the name op, so a player who mustered and THEN changed side left their
   synced cards under state.cards[oldSide] and their tokens owned by the old side
   until a re-muster — the opponent kept seeing the army filed under the wrong player.
   Fix, scoped to a live NETWORK game (conn truthy — offline keeps the legacy flip
   untouched, because hot-seat players toggle the selector to act as each side, and
   pre-battle that flip is how a second army gets mustered from one screen):
   - pre-battle (wp17PreBattle, the WP17 gate — synced round + phase, so both clients
     agree): the switch re-owns my on-table tokens (one tok~), re-broadcasts my cards
     under the new side and vacates the old slot — existing op kinds only ("tok~",
     "cards"), no new synced state;
   - battle under way: the switch is refused with a log line and the selector snaps
     back (reserves trays, CP/VP, state.cards and the phase engine all key on side —
     a live switch cannot converge).
   wp8SideClaim's forced guest flip re-broadcasts cards too (hunk there), but never
   clears the contested slot (the host keeps it) and never re-owns tokens (after the
   host's full-state sync every token on the table is the host's version). */
function wp23SetSide(v){
  const nv=+v; if(nv!==1&&nv!==2) return;
  if(nv===mySide){ op({k:"name",side:mySide,name:myName}); return; }          // no change — legacy name (re)send
  if(!conn){ mySide=nv; op({k:"name",side:mySide,name:myName}); return; }     // offline / hot-seat: legacy flip, no re-homing
  if(!wp17PreBattle()){
    const s=document.getElementById("mySide"); if(s) s.value=String(mySide);  // snap the selector back
    logSys("Side switching is for setup only — the battle is already under way. Finish the game (or Clear the table) first.");
    return;
  }
  const old=mySide; mySide=nv;
  op({k:"name",side:mySide,name:myName});
  const mine=state.tokens.filter(t=>t.owner===old);
  if(mine.length) op({k:"tok~",toks:mine.map(t=>({id:t.id,owner:nv}))});      // my models change hands with me
  if(myArmy.length){ broadcastCards(); op({k:"cards",owner:old,cards:[]}); }  // my synced cards follow; the old slot is vacated (it held mine — I was that side)
  logSys("You are now "+(nv===1?"Red (P1)":"Blue (P2)")+(mine.length||myArmy.length?" — your models and cards moved with you.":"."));
}
/* ==== end WP23 ==== */

/* ==== WP21 ==== base-size & shape correctness.
   Three fixes: (1) "A x Bmm" GW bases render as OVALS (flag added in baseFrom, drawn
   in draw(), hit-tested in hitToken); (2) "Use model" hull vehicles get real footprints
   from the curated WP21_HULLS table below instead of a crude wounds guess; (3) "NNmm
   flying base" strings keep their stand circle ON PURPOSE — a true-scale AIRCRAFT hull
   (a 9" Vampire Hunter…) would be unusable on a 2D table. Ground-skimmer transports/
   gunships that DO want hull footprints (Hammerhead, Raider, Wave Serpent…) are simply
   listed in the hull table, which takes priority over the base string.
   Geometry elsewhere (wp5 collision, coherency, edgeDist/tokRadius) is untouched:
   ovals inherit the same circle/rect approximations rects always used. */
// APPROXIMATE physical kit footprints in INCHES (measured hulls, not GW rules data).
// Ordered — matched against norm(unit/profile name), FIRST hit wins, so specific
// entries (triarch stalker) sit above generic ones (^stalker$). Tunable.
const WP21_HULLS=[
  [/triarch stalker/,             {wIn:4.0,hIn:3.0}],
  [/rhino|razorback|immolator|repressor/, {wIn:4.6,hIn:3.0}],
  // ^hunter$/^stalker$ anchored: "Warp Hunter"/"Crimson Hunter"/"Vampire Hunter"/
  // "War Dog Stalker"/"Canoptek Tomb Stalker" etc. must NOT be dragged onto this chassis.
  [/predator|vindicator|whirlwind|castigator|exorcist|^hunter$|^stalker$/, {wIn:4.6,hIn:3.4}],
  [/land raider/,                 {wIn:6.0,hIn:4.4}],
  [/leman russ/,                  {wIn:5.7,hIn:4.0}],
  [/rogal dorn/,                  {wIn:6.5,hIn:4.3}],
  [/taurox/,                      {wIn:4.6,hIn:3.3}],
  // (?! platform): Manticore/Hydra PLATFORMS are static emplacements — they fall
  // through to the wounds tiers, only the tanks take the chimera chassis.
  [/\bchimera\b|hellhound|basilisk|\bmanticore\b(?! platform)|\bhydra\b(?! platform)|wyvern|colossus|griffon|salamander|trojan|atlas recovery|centaur/, {wIn:5.3,hIn:3.7}],
  [/baneblade|banehammer|banesword|doomhammer|hellhammer|shadowsword|stormblade|stormlord|stormsword|fellblade|falchion|stormhammer/, {wIn:9.3,hIn:5.5}],
  [/macharius/,                   {wIn:7.5,hIn:4.8}],
  [/malcador|valdor|minotaur/,    {wIn:7.0,hIn:4.6}],
  [/sicaran/,                     {wIn:5.5,hIn:3.6}],
  [/kratos/,                      {wIn:6.5,hIn:4.3}],
  // \bpraetor\b: whole word only — "Vertus Praetors" (jetbikes) and "Triarch
  // Praetorians" (infantry) must not become super-heavy hulls.
  [/cerberus|typhon|spartan|\bpraetor\b/, {wIn:7.0,hIn:4.6}],
  [/crassus|gorgon heavy/,        {wIn:7.5,hIn:5.0}],
  [/\btrukk\b/,                   {wIn:5.5,hIn:3.2}],
  [/battlewagon|kannonwagon|deff rolla/, {wIn:7.0,hIn:4.7}],
  [/big trakk/,                   {wIn:6.0,hIn:3.6}],
  [/goliath (rockgrinder|truck)/, {wIn:5.5,hIn:3.5}],
  [/drop pod/,                    {dmm:140}],
  [/attack bike|\bbike\b|outrider/, {wIn:3.55,hIn:2.05,oval:true}], // 90×52mm oval
  // sky ray + longstrike ride the devilfish chassis; audit 2026-07-12 found them
  // (and the added entries below through carnodon) minting W-tier circles.
  [/devilfish|hammerhead|sky ?ray|longstrike/, {wIn:7.0,hIn:4.5}],
  [/piranha|tetra/,               {wIn:4.7,hIn:2.6}],
  [/land speeder|javelin attack speeder|darkshroud/, {wIn:3.7,hIn:2.5}],
  [/wave serpent|\bfalcon\b|fire prism|night spinner|warp hunter|firestorm(?! redoubt)/, {wIn:6.3,hIn:4.0}],
  // ^cobra$/^scorpion$ anchored: "Greater Brass Scorpion" (walker) must not match.
  [/^cobra$|^scorpion$/,          {wIn:9.0,hIn:4.5}],
  [/^lynx$/,                      {wIn:6.0,hIn:3.2}],
  [/^raider$|ynnari raider|tantalus|ravager/, {wIn:7.3,hIn:3.2}],
  [/^reaper$/,                    {wIn:5.5,hIn:2.8}],
  [/plagueburst crawler/,         {wIn:5.5,hIn:3.6}],
  [/terrax/,                      {wIn:4.5,hIn:3.0}],
  [/lord of skulls/,              {wIn:7.0,hIn:5.0}],
  [/coronus/,                     {wIn:6.5,hIn:3.5}],
  [/carnodon/,                    {wIn:5.0,hIn:3.5}],
  [/^venom$|starweaver|voidweaver/, {wIn:4.7,hIn:2.4}],
  [/ghost ark|doomsday ark/,      {wIn:6.7,hIn:3.5}],
  [/annihilation barge|command barge/, {wIn:5.3,hIn:3.2}],
  [/skorpius/,                    {wIn:5.5,hIn:3.3}],
  [/hekaton land fortress/,       {wIn:7.0,hIn:4.6}],
  [/sagitaur/,                    {wIn:4.7,hIn:3.0}],
];
// The single base-dims oracle for token minting: curated hull table by NAME first
// (it beats even a parseable base string — that's how flying-stand skimmers get
// hulls), then baseFrom(base string, wounds) exactly as before.
function wp21BaseFor(name,baseStr,W){
  const n=norm(name||"");
  if(n) for(const [re,d] of WP21_HULLS)
    if(re.test(n)) return d.dmm?{shape:"c",dmm:d.dmm}:(d.oval?{shape:"r",wIn:d.wIn,hIn:d.hIn,oval:true}:{shape:"r",wIn:d.wIn,hIn:d.hIn});
  return baseFrom(baseStr,W);
}
// "♻ Fix base sizes" (Setup tab): recompute every OWN token's dims from its army
// card via wp21BaseFor and sync the ones that changed. Old saves stay untouched
// until the user clicks this.
function wp21Refit(){
  const ups=[];
  state.tokens.forEach(t=>{
    if(t.owner!==mySide) return;
    const card=wp3CardFor(t); if(!card||!(card.profiles||[]).length) return;
    // Same name-matching the deploy path uses to label tokens (token.name = p.n || card.name)
    const nn=norm(t.name||"");
    const p=card.profiles.find(q=>norm(q.n||card.name||"")===nn)
         || card.profiles.find(q=>{const m=norm(q.n||"");return m&&(m.includes(nn)||nn.includes(m));})
         || (card.profiles.length===1?card.profiles[0]:null);
    if(!p) return;
    const b=wp21BaseFor(p.n||card.name,p.base,p.W);
    const same = t.shape===b.shape && (b.shape==="c"
      ? +t.dmm===+b.dmm
      : Math.abs((+t.wIn||0)-b.wIn)<.01 && Math.abs((+t.hIn||0)-b.hIn)<.01 && !!t.oval===!!b.oval);
    if(same) return;
    // tok~ is Object.assign: explicitly null the fields the new shape doesn't use,
    // and give c→r converts a rotation so the rect renderer never sees undefined.
    ups.push({id:t.id, shape:b.shape,
      dmm:b.shape==="c"?b.dmm:null,
      wIn:b.shape==="r"?b.wIn:null, hIn:b.shape==="r"?b.hIn:null,
      oval:(b.shape==="r"&&b.oval)?true:null,
      rot:b.shape==="r"?(t.rot||0):0});
  });
  if(!ups.length){ logSys("♻ Base sizes already correct — nothing to fix."); return; }
  op({k:"tok~",toks:ups});
  logShared("· <b>"+esc(myName)+"</b> ♻ fixed "+ups.length+" model bases","sys");
}
/* ==== end WP21 ==== */

/* ==== WP22: exact edge-to-edge geometry helpers ==== */
// Supports the replaced edgeDist (see the WP22 hunk next to tokRadius). All coordinates
// are inches; rect tokens have x,y = center, wIn×hIn extents, rot in degrees about the
// center. The world→local transform matches hitToken/draw(): lx=dx·cos+dy·sin,
// ly=−dx·sin+dy·cos. Function declarations hoist, so edgeDist (defined earlier) can
// call these safely.

// 4 world-space corners of a rect token, in perimeter order (consecutive = an edge).
function wp22RectPts(t){
  const r=(t.rot||0)*Math.PI/180, cs=Math.cos(r), sn=Math.sin(r);
  const hw=t.wIn/2, hh=t.hIn/2;
  return [
    [t.x+cs*hw-sn*hh, t.y+sn*hw+cs*hh],
    [t.x-cs*hw-sn*hh, t.y-sn*hw+cs*hh],
    [t.x-cs*hw+sn*hh, t.y-sn*hw-cs*hh],
    [t.x+cs*hw+sn*hh, t.y+sn*hw-cs*hh],
  ];
}
// Signed distance from a world point to a rect token's footprint: positive outside
// (distance to the nearest edge/corner), negative inside (depth to the nearest edge).
// Circle↔rect distance is exactly this minus the circle's radius.
function wp22PtRectSd(x,y,rt){
  const r=(rt.rot||0)*Math.PI/180, cs=Math.cos(r), sn=Math.sin(r);
  const dx=x-rt.x, dy=y-rt.y;
  const lx=dx*cs+dy*sn, ly=-dx*sn+dy*cs;             // rotate into the rect's local frame
  const qx=Math.abs(lx)-rt.wIn/2, qy=Math.abs(ly)-rt.hIn/2;
  if(qx<=0&&qy<=0) return Math.max(qx,qy);           // inside: negative depth
  return Math.hypot(Math.max(qx,0),Math.max(qy,0));  // outside: clamp then hypot
}
// Minimum distance between two segments p1→q1 and p2→q2 (0 when they cross).
// Standard closed form (clamp the closest points of the infinite lines to [0,1]).
function wp22SegSegDist(p1x,p1y,q1x,q1y,p2x,p2y,q2x,q2y){
  const d1x=q1x-p1x, d1y=q1y-p1y, d2x=q2x-p2x, d2y=q2y-p2y;
  const rx=p1x-p2x, ry=p1y-p2y;
  const a=d1x*d1x+d1y*d1y, e=d2x*d2x+d2y*d2y, f=d2x*rx+d2y*ry;
  let s,t;
  if(a<=1e-12&&e<=1e-12){ s=0; t=0; }                        // both degenerate: point-point
  else if(a<=1e-12){ s=0; t=Math.min(Math.max(f/e,0),1); }   // first degenerate
  else{
    const c=d1x*rx+d1y*ry;
    if(e<=1e-12){ t=0; s=Math.min(Math.max(-c/a,0),1); }     // second degenerate
    else{
      const b=d1x*d2x+d1y*d2y, den=a*e-b*b;
      s=den>1e-12?Math.min(Math.max((b*f-c*e)/den,0),1):0;   // parallel → any s; pick 0
      t=(b*s+f)/e;
      if(t<0){ t=0; s=Math.min(Math.max(-c/a,0),1); }
      else if(t>1){ t=1; s=Math.min(Math.max((b-c)/a,0),1); }
    }
  }
  const cx=p1x+d1x*s-(p2x+d2x*t), cy=p1y+d1y*s-(p2y+d2y*t);
  return Math.hypot(cx,cy);
}
// Exact separation between two rotated rect footprints. Overlap convention (documented
// at edgeDist): corner of one inside the other → deepest (most negative) containment
// depth; perimeters merely crossing/touching → 0; otherwise the minimum of the 16
// edge-pair distances (both hulls convex, so corners-vs-edges covers the true minimum).
function wp22RectRect(A,B){
  const pa=wp22RectPts(A), pb=wp22RectPts(B);
  let pen=0;
  for(let i=0;i<4;i++){
    const da=wp22PtRectSd(pa[i][0],pa[i][1],B); if(da<pen)pen=da;
    const db=wp22PtRectSd(pb[i][0],pb[i][1],A); if(db<pen)pen=db;
  }
  if(pen<0) return pen;
  let min=Infinity;
  for(let i=0;i<4;i++){
    const a1=pa[i], a2=pa[(i+1)&3];
    for(let j=0;j<4;j++){
      const b1=pb[j], b2=pb[(j+1)&3];
      const d=wp22SegSegDist(a1[0],a1[1],a2[0],a2[1],b1[0],b1[1],b2[0],b2[1]);
      if(d<min)min=d;
    }
  }
  return min;
}
/* ==== end WP22 ==== */

/* ============ init ============ */
populateFactions(); populateLayouts(); bInit(); renderArmy(); renderCards(); refreshTrackers(); wp12Init(); /* ==== WP12: phone ==== apply layout before the first draw */ resize(); fitView();
wpRulesLoadNotes(); wpRulesRenderStrats(); /* ==== WP-RULES ==== */
wpImportPopulate(); /* ==== WP-C: auto-import dropdown ==== populate on load; wpImportFetchWeb() re-populates after a web fetch */
logSys("Welcome, commander. Click ? for how to play online. Pick your faction in the Army tab, import your army list, load a terrain layout, and may your dice roll hot.");
wp1MaybeResume(); /* ==== WP1: resilience ==== offer to restore the autosaved game */
wpDeepLinkInit(); /* ==== WP-DEEPLINK-APP ==== ?list=<name> or ?import=<text> auto-import — runs last, after DB/registry are populated */
