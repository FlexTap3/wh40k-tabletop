/* Painted miniature library. Local mesh/texture assets, shared materials and instancing.
 * Art is independent from token footprints, picking, movement and terrain rules.
 * Source and adaptation details live in assets/miniatures/sources.json. */
import * as THREE from '../vendor/three.module.min.js';
import { registerMiniKit, wp3dHash } from './wp3d-1-geometry.js';
import { MINIS } from '../assets/miniatures/catalog.js';
export { MINIS };

const entries = new Map(MINIS.map(m => [m.id, m]));
const loaded = new Map();
const baseMaterial = new THREE.MeshLambertMaterial({color:0x17191a});
let pending = null, registered = false;
const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const pick = (...ids) => ids.map(id => entries.get(id)).find(Boolean) || null;
const choices = (t, ids) => {
  const available = ids.filter(id => entries.has(id));
  return available.length ? entries.get(available[wp3dHash(t.id || t.name || '') % available.length]) : null;
};

/** Exact family routing takes precedence over broad faction/keyword defaults.
 * Unknown vehicles are deliberately left to their existing chassis kits. */
export function resolveMiniature(token, fid) {
  const t = token || {}, n = norm(t.name), kw = (t.kw || []).map(x => String(x).toUpperCase());
  const weapon = norm(typeof t.weaponName === 'string' ? t.weaponName : typeof t.loadout === 'string' ? t.loadout : '');
  if (fid === 'ORK') {
    // A vehicle containing an infantry word (Grot Tanks, Burna-bommer) is still a
    // vehicle. Never put a small infantry sculpt on its large hull footprint.
    if (kw.includes('VEHICLE')) {
      if (/battlewagon|kannonwagon/.test(n)) return pick('ork-battlewagon');
      if (/\btrukk\b/.test(n)) return pick('ork-trukk');
      if (/deff dread/.test(n)) return pick('ork-deff-dread');
      if (/killa kan/.test(n)) return pick('ork-killa-kan');
      if (/gorkanaut/.test(n)) return pick('ork-gorkanaut');
      if (/morkanaut/.test(n)) return pick('ork-morkanaut');
      return null;
    }
    if (kw.includes('MOUNTED') && !/squig/.test(n)) return null;
    if (/ghazghkull/.test(n)) return pick('ork-ghazghkull');
    if (/squighog|smasha squig|squigosaur/.test(n)) return pick('ork-squighog');
    if (/mega.*warboss|warboss.*mega/.test(n)) return pick('ork-mega-warboss');
    if (/meganob/.test(n)) return pick('ork-meganob');
    if (/beastboss/.test(n)) return pick('ork-beastboss');
    if (/warboss|boss snikrot|zagstruk/.test(n)) return pick('ork-warboss');
    if (/gretchin|\bgrot\b|\bgrots\b|makari/.test(n)) return pick('ork-gretchin');
    if (/runtherd/.test(n)) return pick('ork-runtherd');
    if (/stormboy/.test(n)) return choices(t, ['ork-stormboy', 'ork-stormboy-2']);
    if (/kommando/.test(n)) return pick('ork-kommando');
    if (/flash git/.test(n)) return pick('ork-flash-git');
    if (/loota/.test(n)) return pick('ork-loota');
    if (/burna/.test(n) && !kw.includes('VEHICLE')) return pick('ork-burna');
    if (/weirdboy|wurrboy/.test(n)) return pick('ork-weirdboy');
    if (/painboy|painboss/.test(n)) return pick('ork-painboy');
    if (/snagga/.test(n) && !kw.includes('VEHICLE')) return pick('ork-snagga');
    if (/\bnob/.test(n) && !kw.includes('MOUNTED')) return pick('ork-nob');
    if (/battlewagon|kannonwagon/.test(n)) return pick('ork-battlewagon');
    if (/\btrukk\b/.test(n)) return pick('ork-trukk');
    if (/deff dread/.test(n)) return pick('ork-deff-dread');
    if (/killa kan/.test(n)) return pick('ork-killa-kan');
    if (/gorkanaut/.test(n)) return pick('ork-gorkanaut');
    if (/morkanaut/.test(n)) return pick('ork-morkanaut');
    if (kw.includes('VEHICLE') || kw.includes('MOUNTED')) return null;
    if (/\bboy|\bboyz|\bork/.test(n) || kw.includes('INFANTRY')) {
      if (/rokkit/.test(n+' '+weapon)) return pick('ork-boy-rokkit');
      if (/shoota/.test(n+' '+weapon)) return pick('ork-boy-shoota');
      return pick('ork-boy');
    }
  }
  if (fid === 'SM') {
    if (/redemptor|brutalis|ballistus/.test(n)) return pick('sm-redemptor');
    if (/rhino/.test(n)) return pick('sm-rhino');
    if (/land raider/.test(n)) return pick('sm-land-raider');
    if (/repulsor/.test(n)) return pick('sm-repulsor');
    if (/impulsor/.test(n)) return pick('sm-impulsor');
    if (kw.includes('VEHICLE') || kw.includes('MOUNTED')) return null;
    if (/assault.*terminator|terminator.*assault/.test(n)) return pick('sm-assault-terminator-modern','sm-terminator-sgt');
    if (/terminator/.test(n) || kw.includes('TERMINATOR')) return pick('sm-terminator','sm-terminator-sgt');
    if (/aggressor/.test(n)) return pick('sm-aggressor','sm-aggressor-dw');
    if (/gravis/.test(n) && /captain/.test(n)) return pick('sm-gravis-captain');
    if (/heavy intercessor|eradicator/.test(n) || kw.includes('GRAVIS')) return pick('sm-heavy-intercessor');
    if (/scout/.test(n)) return pick('sm-scout-modern-rifle','sm-scout-modern-body','sm-scout-wolf');
    if (/phobos/.test(n) && /lieutenant|captain/.test(n)) return pick('sm-phobos-lieutenant');
    if (/reiver/.test(n)) return choices(t, ['sm-reiver','sm-reiver-2']);
    if (/incursor/.test(n)) return pick('sm-incursor-modern');
    if (/infiltrator|eliminator|phobos/.test(n)) return pick('sm-infiltrator-veteran','sm-infiltrator-modern','sm-phobos-lieutenant');
    if (/chaplain/.test(n)) return pick('sm-chaplain');
    if (/librarian/.test(n)) return pick('sm-librarian');
    if (/captain|lieutenant|chapter master|ancient|judiciar|apothecary|calgar|guilliman/.test(n)) return pick('sm-captain');
    if (/assault|bladeguard|vanguard/.test(n)) return choices(t, ['sm-assault-intercessor-modern','sm-assault-intercessor-modern-2']);
    if (/intercessor|tactical|sternguard|devastator|hellblaster|infernus/.test(n) || kw.includes('INFANTRY')) {
      return choices(t, ['sm-intercessor-modern', 'sm-intercessor-modern-2']);
    }
  }
  return null;
}

export function decodeMiniature(buffer) {
  const head = new DataView(buffer);
  if (buffer.byteLength < 12 || head.getUint32(0,true) !== 0x4d494e49) throw new Error('Invalid miniature mesh');
  const count = head.getUint32(4,true), indices = head.getUint32(8,true);
  if (!count || !indices || indices % 3 || buffer.byteLength !== 12 + count*32 + indices*4) throw new Error('Incomplete miniature mesh');
  const g = new THREE.BufferGeometry();
  const interleaved = new THREE.InterleavedBuffer(new Float32Array(buffer,12,count*8),8);
  g.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0));
  g.setAttribute('normal',new THREE.InterleavedBufferAttribute(interleaved,3,3));
  g.setAttribute('uv',new THREE.InterleavedBufferAttribute(interleaved,2,6));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,12+count*32,indices),1));
  g.computeBoundingBox();g.computeBoundingSphere();
  return g;
}

export async function loadMiniatures() {
  if (pending) return pending;
  pending = (async () => {
    const failures = [], queue = MINIS.slice();
    async function worker() {
      while (queue.length) {
        const entry = queue.shift();
        try {
          const base = new URL('../assets/miniatures/',import.meta.url);
          const [response, texture] = await Promise.all([
            fetch(new URL(entry.mesh,base)),
            new THREE.TextureLoader().loadAsync(new URL(entry.texture,base).href),
          ]);
          if (!response.ok) { texture.dispose(); throw new Error('Mesh HTTP '+response.status); }
          const geometry = decodeMiniature(await response.arrayBuffer());
          // These KT3 sculpts were authored facing -Z; the app's infantry front is +Z.
          if (['sm-intercessor-modern','sm-intercessor-modern-2','sm-assault-intercessor-modern','sm-assault-intercessor-modern-2','sm-incursor-modern','sm-infiltrator-veteran'].includes(entry.id)) {
            geometry.rotateY(Math.PI);geometry.computeBoundingBox();geometry.computeBoundingSphere();
          }
          // Oval rules bases use local X as their long axis. Some TTS mounted
          // sculpts were authored along Z; align art and base without stretching.
          if (Array.isArray(entry.baseMm) && entry.baseMm[0] > entry.baseMm[1] && entry.depthIn > entry.widthIn) {
            geometry.rotateY(Math.PI/2);geometry.computeBoundingBox();geometry.computeBoundingSphere();
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          const material = new THREE.MeshLambertMaterial({map:texture, color:0xffffff});
          loaded.set(entry.id,{geometry,material});
        } catch(error) { failures.push({id:entry.id,error:String(error.message || error)}); }
      }
    }
    await Promise.all(Array.from({length:6},worker));
    const status = {loaded:loaded.size,total:MINIS.length,failures};
    if (typeof window !== 'undefined') {
      window.wpMiniatureStatus = status;
      window.dispatchEvent(new CustomEvent('miniatures-ready',{detail:status}));
      if (window.wp3dOnDraw) window.wp3dOnDraw();
    }
    return status;
  })();
  return pending;
}

function baseGeometry(entry, footprint) {
  if (!entry.baseMm) return null;
  const dimensions = Array.isArray(entry.baseMm) ? entry.baseMm : [entry.baseMm,entry.baseMm];
  const w = footprint?.shape === 'c' ? footprint.dmm/25.4 : footprint?.wIn || dimensions[0]/25.4;
  const d = footprint?.shape === 'c' ? footprint.dmm/25.4 : footprint?.hIn || dimensions[1]/25.4;
  const base = new THREE.CylinderGeometry(.5,.5,.04,40);
  base.scale(w,1,d);base.translate(0,.02,0);return base;
}

function combineBodyAndBase(body, base) {
  if (!base) return body;
  const geometry = new THREE.BufferGeometry();
  const a = body.getAttribute('position').count, b = base.getAttribute('position').count;
  for (const [name,size] of [['position',3],['normal',3],['uv',2]]) {
    const buffer = new Float32Array((a+b)*size);
    for (const [part,start] of [[body,0],[base,a]]) {
      const attr = part.getAttribute(name);
      for(let i=0;i<attr.count;i++) {
        buffer[(start+i)*size]=attr.getX(i);buffer[(start+i)*size+1]=attr.getY(i);
        if(size===3)buffer[(start+i)*size+2]=attr.getZ(i);
      }
    }
    geometry.setAttribute(name,new THREE.BufferAttribute(buffer,size));
  }
  const ai=body.index?.array || Array.from({length:a},(_,i)=>i), bi=base.index.array;
  const indices=new Uint32Array(ai.length+bi.length);indices.set(ai);
  for(let i=0;i<bi.length;i++)indices[ai.length+i]=bi[i]+a;
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.addGroup(0,ai.length,0);geometry.addGroup(ai.length,bi.length,1);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  body.dispose();base.dispose();return geometry;
}

function geometryFor(entry, footprint) {
  const asset = loaded.get(entry.id);
  if (!asset) throw new Error('Miniature is not loaded: '+entry.id);
  const geometry = asset.geometry.clone();
  // Rebasing changes the disc, not the height/anatomy of the sculpt. Older source
  // models on 32mm bases must not grow 25% when a datasheet uses a 40mm base.
  let scale = 1;
  if (footprint && footprint.shape === 'r' && !entry.baseMm && footprint.wIn && footprint.hIn) {
    // Hull assets use a uniform fit within the existing rules footprint.
    scale = Math.min(footprint.wIn/entry.widthIn,footprint.hIn/entry.depthIn);
  }
  if (Number.isFinite(scale) && scale > 0 && scale !== 1) geometry.scale(scale,scale,scale);
  return combineBodyAndBase(geometry,baseGeometry(entry,footprint));
}

export function buildMiniature(id, variant = 0) {
  const entry = entries.get(id), asset = loaded.get(id);
  if (!entry || !asset) throw new Error('Miniature unavailable: '+id);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(asset.geometry,asset.material);
  mesh.castShadow = true;
  group.add(mesh);
  const base = baseGeometry(entry);
  if(base) { const disc = new THREE.Mesh(base,baseMaterial);disc.receiveShadow=true;group.add(disc); }
  group.userData.miniature = entry.id;
  group.userData.source = entry.source;
  return group;
}

export function register() {
  if (registered) return;
  registered = true;
  for (const fid of ['ORK','SM']) registerMiniKit({
    id:'painted-'+fid.toLowerCase(), priority:100,
    match:(t,b) => {
      if (!b || !b.wpvSideFid || b.wpvSideFid(t.owner) !== fid) return false;
      const e = resolveMiniature(t,fid);return !!e && loaded.has(e.id);
    },
    key:t => resolveMiniature(t,fid)?.id || 'missing',
    build:(ctx,t,fp) => geometryFor(resolveMiniature(t,fid),fp),
    material:(ctx,t) => {
      const entry = resolveMiniature(t,fid);
      return entry.baseMm ? [loaded.get(entry.id).material,baseMaterial] : loaded.get(entry.id).material;
    },
  });
}

export function miniatureStatus() { return {loaded:loaded.size,total:MINIS.length}; }
