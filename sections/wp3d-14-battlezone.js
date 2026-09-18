/* Battlezone reference reconstruction, September 2026.
 * Source: Paul's painted-product and sprue photographs (private ref manifest).
 * All construction coordinates are MILLIMETRES, Y up. These are photo-derived models,
 * not official GW CAD. Do not use the render mesh as a print-ready boolean solid.
 * The old eyeballed STL meshes are intentionally not inputs to this file.
 */
import * as T from '../vendor/three.module.min.js';
import { areaCanvas } from './battlezone-area.js';
import { kitFor, placementFor, featurePose } from './battlezone-layout.js';
export {kitFor,footprintPoints} from './battlezone-layout.js';
import { registerTerrainBuilder } from './wp3d-1-geometry.js';

export const KIT = Object.freeze([
  {id:'ruin-door',name:'Manufactorum · door corner',qty:1,reference:5},
  {id:'ruin-pipes',name:'Manufactorum · pipe wall',qty:1,reference:5},
  {id:'ruin-high',name:'Manufactorum · tall corner',qty:1,reference:5},
  {id:'ruin-broken',name:'Manufactorum · broken corner',qty:1,reference:5},
  {id:'wall-relic',name:'Small ruin · relic',qty:1,reference:5},
  {id:'wall-pipes',name:'Small ruin · pipes',qty:1,reference:5},
  {id:'wall-corner',name:'Small ruin · corner',qty:1,reference:5},
  {id:'wall-door',name:'Small ruin · broken panel',qty:1,reference:5},
  {id:'pylon-a',name:'Galvanic pylon A',qty:1,reference:1},
  {id:'pylon-b',name:'Galvanic pylon B',qty:1,reference:1},
  {id:'shrine',name:'Generator shrine',qty:1,reference:1},
  {id:'barricade',name:'Rockcrete barricade',qty:2,reference:1},
  {id:'capacitor',name:'Capacitor stack',qty:1,reference:3},
  {id:'shock',name:'Shock array',qty:1,reference:3},
]);
const C={steel:0x36444a,edge:0x657272,dark:0x242b2e,bronze:0x887363,rust:0x7e4a35,
  stone:0x9c8b67,bone:0xc6b68d,gold:0xb5a478,red:0x683938,teal:0x54c4c0,
  screen:0x376344,black:0x161e20,skin:0xb08e78,paper:0xcaba94};
const V=p=>new T.Vector3(...p);

// Parts remain tagged with a semantic name for later solid-mesh export and diagnostics.
let patinaMap;
function patina(){
  if(patinaMap||typeof document==='undefined')return patinaMap||null;
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');
  let seed=1977;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  ctx.fillStyle='#dfdfdf';ctx.fillRect(0,0,256,256);
  for(let i=0;i<12500;i++){const v=100+Math.floor(rnd()*150);ctx.fillStyle=`rgba(${v},${v},${v},${.1+rnd()*.5})`;ctx.fillRect(rnd()*256,rnd()*256,.4+rnd()*2,.4+rnd()*2);}
  for(let i=0;i<130;i++){ctx.fillStyle='rgba(35,28,24,.35)';ctx.fillRect(rnd()*256,rnd()*256,.4+rnd()*1.4,2+rnd()*14);}
  for(let i=0;i<80;i++){ctx.fillStyle='rgba(255,255,245,.7)';ctx.fillRect(rnd()*256,rnd()*256,1+rnd()*5,.5);}
  patinaMap=new T.CanvasTexture(c);patinaMap.colorSpace=T.SRGBColorSpace;patinaMap.wrapS=patinaMap.wrapT=T.RepeatWrapping;return patinaMap;
}
class Parts {
  constructor(){this.parts=[];this.matrix=new T.Matrix4();}
  add(g,c=C.steel,name='structure') {
    g.applyMatrix4(this.matrix);
    if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));
    this.parts.push({g,c,name}); return g;
  }
  at(x,y,z,ry,fn){const old=this.matrix;this.matrix=old.clone().multiply(new T.Matrix4().makeTranslation(x,y,z)).multiply(new T.Matrix4().makeRotationY(ry));fn();this.matrix=old;}
  box(x,y,z,w,h,d,c=C.steel,name){const g=new T.BoxGeometry(w,h,d);g.translate(x,y,z);return this.add(g,c,name);}
  sphere(x,y,z,r,c=C.bronze){const g=new T.SphereGeometry(r,10,6);g.translate(x,y,z);return this.add(g,c,'relief');}
  rod(a,b,r,c=C.steel,r2=r,n=10){const v=V(b).sub(V(a));const g=new T.CylinderGeometry(r2,r,v.length(),n);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.clone().normalize()));g.translate(...V(a).add(V(b)).multiplyScalar(.5).toArray());return this.add(g,c,'rod');}
  ring(x,y,z,r,t,c=C.bronze,arc=Math.PI*2,rz=0){const g=new T.TorusGeometry(r,t,6,Math.max(12,Math.round(32*arc/(Math.PI*2))),arc);g.rotateZ(rz);g.translate(x,y,z);return this.add(g,c,'ring');}
  cable(points,r,c=C.steel){const path=new T.CatmullRomCurve3(points.map(V));return this.add(new T.TubeGeometry(path,Math.max(8,points.length*4),r,5,false),c,'cable');}
  plate(points,depth,z=0,c=C.steel,holes=[]){const s=new T.Shape(points.map(p=>new T.Vector2(...p)));for(const hole of holes){const h=new T.Path();if(hole.r)h.absarc(hole.x,hole.y,hole.r,0,Math.PI*2,true);else {h.moveTo(...hole[0]);hole.slice(1).forEach(p=>h.lineTo(...p));h.closePath();}s.holes.push(h);}const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:12});g.translate(0,0,z-depth/2);return this.add(g,c,'pierced-panel');}
  finish(id){
    // One draw call per kit, with color and normal attributes preserved.
    const pos=[],nor=[],col=[],uv=[],idx=[];let offset=0;
    const tags=[];
    for(const {g,c,name} of this.parts){const color=new T.Color(c);const p=g.attributes.position,n=g.attributes.normal;
      for(let i=0;i<p.count;i++){pos.push(p.getX(i)/25.4,p.getY(i)/25.4,p.getZ(i)/25.4);nor.push(n.getX(i),n.getY(i),n.getZ(i));col.push(color.r,color.g,color.b);uv.push(g.attributes.uv?.getX(i)||0,g.attributes.uv?.getY(i)||0);}
      for(const v of g.index.array)idx.push(offset+v);tags.push({name,firstTriangle:(idx.length-g.index.count)/3,triangles:g.index.count/3});offset+=p.count;g.dispose();}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('normal',new T.Float32BufferAttribute(nor,3));g.setAttribute('color',new T.Float32BufferAttribute(col,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeBoundingBox();
    const mesh=new T.Mesh(g,new T.MeshStandardMaterial({vertexColors:true,map:patina(),roughness:.76,metalness:.32}));mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.userData={kitId:id,parts:tags,units:'inch',sourceUnits:'mm',photoDerived:true,printReady:false};
    const out=new T.Group();out.add(mesh);out.userData={kitId:id,builtBy:'battlezone-reference-20260918',terrainHeight:g.boundingBox.max.y,photoDerived:true};return out;
  }
}
function skull(p,x,y,z,s=1){p.sphere(x,y,z,1.6*s,C.bone);p.box(x,y-1.5*s,z+.1*s,1.8*s,1.7*s,1.6*s,C.bone);for(const k of [-1,1])p.sphere(x+k*.65*s,y+.1*s,z+1.35*s,.55*s,C.dark);p.box(x,y-.8*s,z+1.4*s,.6*s,.8*s,.5*s,C.dark);}
function aquila(p,x,y,z,w){const s=w/40;p.at(x,y,z,0,()=>{for(const side of [-1,1]){
  p.plate([[side*1,0],[side*5,7*s],[side*20*s,10*s],[side*14*s,0],[side*4*s,-5*s]],1.1*s,0,C.gold);
  for(let i=0;i<7;i++){const a=3*s+i*2.4*s;p.rod([side*a,6.5*s+i*.32*s,.8*s],[side*(a-1.8*s),-3*s+i*.48*s,.8*s],.55*s,C.bone);}
  p.sphere(side*1.5*s,4*s,1*s,1.35*s,C.bone);p.rod([side*2*s,4*s,1*s],[side*4*s,4.5*s,1*s],.65*s,C.bone);
}p.box(0,0,.8*s,3*s,8*s,1*s,C.bone);});}
function bolts(p,x0,y0,w,h,z,step=12){for(let y=y0;y<=y0+h+.01;y+=step)for(const x of [x0,x0+w])p.sphere(x,y,z,.7,C.bronze);}
function cog(p,x,y,z,r,c=C.bronze){p.ring(x,y,z,r,1.3,c);for(let i=0;i<12;i++){const a=i*Math.PI/6;p.rod([x+Math.cos(a)*(r-2),y+Math.sin(a)*(r-2),z],[x+Math.cos(a)*(r+2),y+Math.sin(a)*(r+2),z],1.1,c);}p.ring(x,y,z,r*.56,.85,C.edge);}
function ribbed(p,a,b,r,n=8){p.rod(a,b,r*.78,C.dark);for(let i=0;i<n;i++){const t=i/(n-1),c=V(a).lerp(V(b),t),d=V(b).sub(V(a)).normalize().multiplyScalar(.7);p.rod(c.clone().sub(d).toArray(),c.clone().add(d).toArray(),r,C.bronze);}}
function lightning(p,points){for(let i=1;i<points.length;i++)p.rod(points[i-1],points[i],.55,C.teal,undefined,6);}
function footFrame(p,width,height,z,top=10){
  // Flared A-frame silhouette with circular THROUGH-holes, traced from sprue 02.
  const half=width/2;
  p.plate([[-half,2],[-half+3,height*.4],[-top,height],[-3,height],[0,height-12],[3,height],[top,height],[half-3,height*.4],[half,2],[half-10,2],[4,height*.45],[0,height*.53],[-4,height*.45],[-half+10,2]],2.6,z,C.steel,
    [-1,1].flatMap(s=>[.15,.3,.46].map((f,i)=>({x:s*(half-5-f*18),y:height*f,r:2.5-i*.3}))));
  for(const s of [-1,1]){p.box(s*(half-5),1.6,z,13,3.2,14,C.edge);p.rod([s*(half-1),3,z+1.7],[s*(top-1),height-1,z+1.7],1,C.bronze);}
}
function pylon(p,mirror){p.at(0,0,0,mirror?Math.PI:0,()=>{
  for(const z of [-23,23])footFrame(p,48,72,z,11);
  p.rod([0,77,-39],[0,77,39],8,C.steel,8,20);
  for(const z of [-28,-14,14,28]){p.at(0,77,z,0,()=>{p.ring(0,0,0,10,1.5,C.edge);});}
  for(const z of [-43,43]){p.rod([0,77,z-4],[0,77,z+4],8,C.bronze,8,20);for(let i=-3;i<=3;i+=2)p.ring(0,77,z+i,8.6,.65,C.bronze);}
  p.sphere(0,77,50,5,C.teal);
  for(let i=0;i<7;i++){const side=i%2?-1:1,k=Math.floor(i/2);p.cable([[side*6,81,-30],[side*(13+k),80,-15],[side*(15+k),72,12],[side*(12+k),72,30]],1.05,[C.teal,C.red,C.bronze,C.steel][i%4]);}
  for(let i=0;i<5;i++){const x=(i-2)*3;p.cable([[x,78,-31],[x+8,67,-37],[x+11,48,-38],[x+7,30+i*3,-38]],1.2,i%2?C.bronze:C.steel);p.rod([x+7,28+i*3,-38],[x+7,33+i*3,-38],1.7,C.bronze);}
  for(const z of [-24,24]){p.box(0,89,z,8,5,7,C.steel);p.box(0,91,z,12,2,5,C.edge);p.box(0,52,z,11,11,5,C.dark);cog(p,0,52,z+3,4);}
  p.cable([[-9,68,-22],[-15,59,0],[-9,68,22]],1,C.dark);
});}
function shrine(p){
  for(const z of [-13,13])footFrame(p,50,63,z,12);
  p.rod([0,78,-11],[0,78,11],21,C.steel,21,40);
  for(const z of [-12,12]){p.ring(0,78,z,21,2,C.edge);p.box(0,77,z,5,40,3,C.bronze);for(const x of [-9,9])for(const y of [68,81,92]){cog(p,x,y,z+(z>0?2:-2),4.2,C.bronze);if(z>0)skull(p,x,y,z+3,.7);}}
  for(const s of [-1,1])for(const y of [66,88]){
    p.ring(0,77,0,27,2.2,C.steel,.66,s>0?-.45+(y>77?.55:-.55):Math.PI-.45+(y>77?.55:-.55));
    for(let i=0;i<9;i++){const a=(s>0?0:Math.PI)+(y>77?.4:-.4)+(i-4)*.055;p.rod([Math.cos(a)*25,77+Math.sin(a)*25,-3],[Math.cos(a)*25,77+Math.sin(a)*25,3],.8,i%3?C.bronze:C.teal);}
  }
  for(const z of [-8,8]){p.box(0,102,z,5,13,4,C.steel);aquila(p,0,108,z,46);}
  for(const x of [-25,25]){ribbed(p,[x,4,0],[x,21,0],3,7);p.box(x,2,0,8,4,9,C.bronze);}
  p.cable([[0,58,15],[-6,39,17],[-5,13,17]],1.2,C.red);
}
function barricade(p){
  for(const x of [-42,0,42]){p.box(x,28,0,4,56,5,C.steel);p.box(x,2,0,7,4,20,C.edge);p.rod([x,2,-9],[x,22,-1],1.5,C.steel);for(const y of [12,35,52])p.sphere(x,y,3,1.3,C.bronze);}
  for(const x of [-21,21]){
    p.plate([[x-19,3],[x+19,3],[x+19,26],[x+12,26],[x+8,21],[x-7,21],[x-11,27],[x-19,27]],2.5,0,C.stone);
    p.box(x,12,1.7,32,17,1,C.steel);aquila(p,x,15,2.5,23);
    for(const y of [33,45,55])p.rod([x-19,y,0],[x+19,y,0],1.5,C.edge);
    // True clipped diamond lattice: open holes remain visible against the background.
    for(let k=-46;k<46;k+=4)for(const sign of [-1,1]){
      let y0=Math.max(46,46+(-18-k)*sign),y1=Math.min(54,46+(18-k)*sign);
      if(sign<0){y0=Math.max(46,46+(18-k)*sign);y1=Math.min(54,46+(-18-k)*sign);}
      if(y1>y0)p.rod([x+k+sign*(y0-46),y0,0],[x+k+sign*(y1-46),y1,0],.42,C.bronze,undefined,5);
    }
  }
}
function capacitor(p){
  for(const x of [-25,25]){
    p.rod([x,5,0],[x,78,0],12.6,C.dark,12.6,28);
    for(let i=0;i<6;i++){const y=10+i*12;p.rod([x,y,0],[x,y+4,0],17,C.bronze,17,28);p.rod([x,y+5,0],[x,y+9,0],14.5,C.teal,14.5,28);
      for(let k=0;k<32;k++){const a=k*Math.PI/16;p.rod([x+Math.cos(a)*14.8,y+5,Math.sin(a)*14.8],[x+Math.cos(a)*14.8,y+9,Math.sin(a)*14.8],.35,C.edge,undefined,5);}}
    p.rod([x,80,0],[x,83,0],13,C.bronze,13,28);
    p.rod([x,83,0],[x,84,0],10,C.dark,10,28);p.rod([x,83.5,0],[x,84.5,0],8.5,C.bronze,8.5,28);
    for(let a=0;a<Math.PI*2;a+=Math.PI/2){const xx=x+Math.cos(a)*16,z=Math.sin(a)*16;p.box(xx,43,z,2,72,2,C.bronze);for(let y=10;y<80;y+=12)p.sphere(xx,y,z,1,C.edge);}
  }
  p.box(0,39,0,22,77,23,C.steel);
  for(const x of [-10,10]){p.box(x,40,14,3,78,3,C.bronze);p.rod([x,79,2],[x,108,2],1.6,C.bronze);p.rod([x+3,80,2],[x+3,105,2],.8,C.teal);ribbed(p,[x,91,2],[x,96,2],3.2,5);p.ring(x,105,2,3,1,C.bronze);}
  lightning(p,[[-9,105,2],[-4,101,3],[-6,98,3],[3,99,3],[0,94,3],[10,92,2]]);
  p.plate([[-13,72],[0,84],[13,72]],2,14,C.edge);aquila(p,0,73,17,30);
  cog(p,0,52,17,11,C.bronze);p.rod([-6,48,18],[-4,61,18],1.2,C.edge);p.rod([6,48,18],[4,61,18],1.2,C.edge);
  // Servitor relief: head, shoulders, seated torso, bent limbs and umbilical cables.
  p.sphere(0,61,20,2.3,C.skin);p.box(0,54,20,6,9,4,C.skin);
  for(const s of [-1,1]){p.rod([s*3,57,20],[s*6,53,21],1.2,C.skin);p.rod([s*6,53,21],[s*3,51,23],1,C.skin);p.rod([s*2,49,21],[s*5,47,23],1.7,C.dark);p.rod([s*5,47,23],[s*5,41,22],1.4,C.skin);}
  for(const [x,y] of [[-14,42],[13,58],[13,34]]){p.box(x,y,19,12,8,3,C.bronze);p.box(x,y,21,10,6,1,C.screen);for(let i=0;i<3;i++)p.box(x-2,y-1+i*1.5,21.6,5-i, .35,.25,C.teal);}
  p.box(0,31,18,16,7,4,C.dark);for(let i=0;i<5;i++)for(let j=0;j<2;j++)p.box(-6+i*3,29+j*3,20.5,1.6,1.5,1,C.bone);
  for(const x of [-5,5]){p.box(x,14,18,7,22,1,C.paper);for(let i=0;i<10;i++)p.box(x,6+i*1.8,18.6,4-(i%3)*.5,.35,.3,C.bronze);}
  p.cable([[-7,38,20],[-15,29,20],[-15,9,20]],1.2,C.red);skull(p,0,25,21,1);
}
function shockArray(p){
  for(const x of [-37,0,37])p.at(x,0,0,0,()=>{
    footFrame(p,34,22,0,6);p.box(0,3,0,13,6,19,C.steel);ribbed(p,[0,13,0],[0,30,0],6.2,8);
    p.rod([0,22,0],[0,60,0],4,C.steel);cog(p,0,44,3,8.5);p.rod([0,44,0],[0,44,6],4,C.bronze);p.rod([0,44,6],[0,44,7],1.8,C.dark,1.8,8);
    cog(p,0,66,0,10.5,C.edge);skull(p,0,66,2,1.3);
    for(const y of [37,47,57])for(const s of [-1,1]){p.rod([s*3,y,0],[s*15,y,0],1.2,C.bronze);p.sphere(s*15,y,0,2,C.teal);}
    for(let i=0;i<8;i++){const a=i*Math.PI/4;p.rod([Math.cos(a)*11,66+Math.sin(a)*11,0],[Math.cos(a)*15,66+Math.sin(a)*15,0],1,C.bronze);p.sphere(Math.cos(a)*15,66+Math.sin(a)*15,0,1.8,C.teal);}
  });
  for(const side of [-1,1])lightning(p,[[side*48,74,0],[side*54,78,0],[side*53,84,0],[side*59,83,0],[side*61,91,0]]);
  for(const x of [-37,0,37])lightning(p,[[x-8,78,0],[x-12,84,0],[x-7,86,0],[x-10,93,0],[x-15,93,0]]);
  for(const x of [-37,0]){p.cable([[x+5,23,0],[x+18,20,0],[x+31,23,0]],1.8,C.red);lightning(p,[[x+10,77,0],[x+18,81,0],[x+16,71,0],[x+24,72,0],[x+27,80,0]]);lightning(p,[[x+15,57,0],[x+22,60,0],[x+19,65,0],[x+27,68,0]]);}
}

// Ruin panels: through-window openings, sprue-specific broken outlines, structural ribs,
// door relief and machinery exist on both faces; no dark rectangles posing as windows.
function panel(p,x,width,height,mode='relic',broken=false){
  const h=height,w=width;
  const outline=broken?[[x,0],[x+w,0],[x+w,h*.48],[x+w-5,h*.53],[x+w-4,h*.73],[x+w-10,h*.68],[x+w-13,h*.94],[x+w-19,h*.89],[x+w-21,h],[x,h]]:[[x,0],[x+w,0],[x+w,h],[x,h]];
  p.plate(outline,3,0,C.stone);
  for(const z of [-2,2]){
    p.box(x+2,h/2,z,3,h,2,C.steel);p.box(x+w-2,h*.24,z,3,h*.48,2,C.steel);p.box(x+w/2,4,z,w,5,2,C.steel);
    for(let i=0;i<3;i++)p.box(x+w/2,8+i*2,z+(z>0?.8:-.8),w-7,.7,.8,C.bronze);
    bolts(p,x+2,8,w-4,h-12,z+(z>0?1.4:-1.4),11);
    if(h>=69){
      p.box(x+w/2,64,z,w-5,10,2,C.steel);
      for(let i=0;i<8;i++)p.box(x+6+i*(w-12)/7,64,z+(z>0?1.4:-1.4),.8,6,1,C.bronze);
      for(const yy of [58,70])p.box(x+w/2,yy,z,w-4,2,3,C.edge);
    }
    const f=z>0?1:-1;
    if(mode==='door'){
      p.box(x+w/2,30,z+f,Math.max(5,w-9),49,1.5,C.red);
      for(const dx of [-1,1]){p.box(x+w/2+dx*(w-10)/4,30,z+2*f,1.3,47,1,C.bronze);for(const yy of [12,29,45])p.plate([[x+w/2+dx*3,yy],[x+w/2+dx*9,yy+7],[x+w/2+dx*9,yy-7]],.8,z+2.3*f,C.bronze);}
      p.box(x+w/2,55,z+2*f,w-8,5,2,C.edge);aquila(p,x+w/2,59,z+3*f,Math.min(22,w-5));
    }else if(mode==='pipes'){
      for(let i=0;i<4;i++){const xx=x+6+i*(w-12)/3,hh=Math.min(h-8,42+i%2*12);p.cable([[xx,8,z+2*f],[xx,hh-6,z+2*f],[xx+3,hh,z+2*f]],1.5,i%2?C.bronze:C.steel);for(const yy of [16,29,40])if(yy<hh)p.box(xx,yy,z+2*f,5,2,3,C.edge);}
      p.box(x+w/2,20,z+4*f,8,10,3,C.steel);cog(p,x+w/2,22,z+6*f,3.5);
    }else{
      for(let i=0;i<2;i++){const xx=x+w*(.3+i*.4),hh=Math.min(h*.65,37);p.plate([[xx-4,15],[xx+4,15],[xx+4,hh],[xx,hh+5],[xx-4,hh]],1,z+f,C.dark);p.box(xx,hh-8,z+2*f,3,10,1.2,C.bone);skull(p,xx,hh-1,z+2*f,.8);p.box(xx,14,z+2*f,10,3,2,C.bronze);}
    }
  }
}
// Upper storeys use the large structural bays visible on sprues 06–08: solid
// X-braced panels, one arched end window and broken open return frames.
function upper(p,x,w,h,style='braced'){
  const y=77, bay=38, end=x+w;
  for(let left=x;left<end-4;left+=bay){
    const right=Math.min(left+bay,end),bw=right-left,last=right===end;
    const window=style==='window'&&last, open=style==='open'||(style==='broken'&&last);
    const top=y+h-(last&&style==='broken'?12:0);
    if(!open){
      const outline=[[left,y],[right,y],[right,top-4],[right-4,top-4],[right-4,top],[left,top]];
      const cx=(left+right)/2, wy=top-12,r=Math.min(10,bw/2-5);
      const hole=[[cx-r,y+7],[cx+r,y+7],[cx+r,wy],...Array.from({length:13},(_,i)=>[cx+Math.cos(i*Math.PI/12)*r,wy+Math.sin(i*Math.PI/12)*r])];
      p.plate(outline,2.6,0,C.steel,window?[hole]:[]);
      if(window){
        for(let xx=cx-r+4;xx<cx+r;xx+=4)p.box(xx,(y+7+wy)/2,0,.8,wy-y-7,1,C.bronze);
        for(let yy=y+12;yy<wy;yy+=6)p.box(cx,yy,0,r*2,.8,1,C.bronze);
      }
    }
    for(const xx of [left,right]){
      p.box(xx,(y+top)/2,0,3,top-y,5,C.edge);
      for(let yy=y+5;yy<top-2;yy+=9)p.sphere(xx,yy,3,.65,C.bronze);
    }
    p.box((left+right)/2,y+1,0,bw,3,5,C.edge);
    if(!open)p.box((left+right)/2,top-1,0,bw,2.5,5,C.edge);
    if(!window){
      const mid=style==='braced'?(y+top)/2:top;
      const levels=style==='braced'?[[y+3,mid-2],[mid+2,top-3]]:[[y+3,top-3]];
      if(style==='braced')p.box((left+right)/2,mid,0,bw,2.5,5,C.edge);
      for(const [lo,hi] of levels)for(const z of [-2,2]){
        p.rod([left+3,lo,z],[right-3,hi,z],1.1,C.edge);
        if(!open)p.rod([right-3,lo,z],[left+3,hi,z],1.1,C.edge);
      }
    }
  }
}
function wallRun(p,panels,upperW,upperH){let x=0;for(const [w,h,mode,broken] of panels){panel(p,x,w,h,mode,broken);x+=w;}
  for(let xx=0;xx<=x-5;xx+=38){p.box(xx,38,0,5,76,8,C.steel);p.box(xx,4,0,9,8,11,C.bronze);bolts(p,xx-1.7,10,3.4,60,4.3,10);}
  p.box(Math.min(x,upperW)/2,74,0,Math.min(x,upperW)+3,7,7,C.steel);
  // Upper sections are assembled separately per sprue, below.
  return x;
}
// Distinct panel-floor silhouettes traced from the four assembled ruins and sprues.
// Exposed fracture edges, large inset floor panels and underside joists replace the
// old generic slab with little raised gratings. All walking surfaces remain at 3 inches.
export const DECKS={
 'ruin-door':[[0,0],[114,0],[114,34],[104,38],[105,44],[80,43],[76,51],[75,76],[43,76],[39,70],[0,76]],
 'ruin-pipes':[[0,0],[114,0],[114,49],[105,46],[107,56],[87,53],[79,64],[62,59],[57,76],[38,72],[34,76],[0,76]],
 'ruin-high':[[0,0],[76,0],[76,37],[68,38],[70,47],[57,46],[52,58],[40,54],[38,76],[0,76]],
 'ruin-broken':[[0,0],[76,0],[76,28],[69,27],[66,38],[43,35],[38,49],[28,44],[26,58],[0,58]],
};
function inDeck(x,z,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
 const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
function deck(p,w,d,variant){
  const poly=DECKS[variant],m=p.matrix;
  p.matrix=m.clone().multiply(new T.Matrix4().makeTranslation(0,74.7,0)).multiply(new T.Matrix4().makeRotationX(Math.PI/2));p.plate(poly,3,0,C.bronze);p.matrix=m;
  // Large square modular floor tiles; clip every surface detail to the broken outline.
  const W=Math.max(...poly.map(v=>v[0])),D=Math.max(...poly.map(v=>v[1]));
  for(let x=3;x<W-2;x+=3)for(let z=3;z<D-2;z+=3){
    if(![[x-1,z-1],[x+1,z-1],[x+1,z+1],[x-1,z+1]].every(q=>inDeck(...q,poly)))continue;
    const edge=x%38<3||z%38<3||x%38>35||z%38>35;
    if(edge)p.box(x,76.3,z,2.8,.35,2.8,C.edge,'floor-frame');
    else p.box(x,76.25,z,1.5,.15,.5,(x+z)%2?C.edge:C.steel,'floor-tread');
  }
  // Each joist stops at the fracture, so no beams float across missing floor tiles.
  for(let x=1;x<W;x+=38)for(let z=2;z<D;z+=2)if(inDeck(x,z,poly))p.box(x,72.5,z,2.5,3.5,2,C.steel,'floor-joist');
  for(let z=1;z<D;z+=38)for(let x=2;x<W;x+=2)if(inDeck(x,z,poly))p.box(x,72.5,z,2,3.5,2.5,C.steel,'floor-joist');
  for(let i=2;i<poly.length-1;i+=2){const [x,z]=poly[i];p.rod([x-2,74,z-2],[x+3,73,z+3],.65,C.edge);}
  p.rod([2,56,2],[2,72,28],2,C.steel);p.rod([28,72,2],[2,55,2],2,C.steel);
}
const RUINS={
 'ruin-door':{a:[[38,76,'relic'],[48,76,'door'],[38,76,'relic'],[38,61,'pipes',true]],b:[[38,76,'pipes'],[38,53,'relic',true]],uw:74,uh:45,d:61},
 'ruin-pipes':{a:[[38,76,'pipes'],[38,76,'relic'],[38,70,'pipes'],[38,53,'relic',true]],b:[[38,76,'relic'],[38,62,'pipes',true]],uw:40,uh:45,d:67},
 'ruin-high':{a:[[38,76,'relic'],[48,76,'door'],[38,58,'pipes',true]],b:[[38,76,'pipes'],[38,76,'relic'],[38,45,'pipes',true]],uw:74,uh:46,d:76},
 'ruin-broken':{a:[[38,76,'relic'],[38,69,'pipes'],[38,40,'relic',true]],b:[[38,76,'pipes'],[38,53,'relic',true]],uw:39,uh:46,d:58},
};
function ruin(p,id){const s=RUINS[id],w=s.a.reduce((n,a)=>n+a[0],0),d=s.b.reduce((n,a)=>n+a[0],0);p.at(-w/2,0,-d/2,0,()=>{
  wallRun(p,s.a,s.uw,s.uh);
  p.at(0,0,0,-Math.PI/2,()=>wallRun(p,s.b,id==='ruin-high'?38:0,42));
  deck(p,Math.min(w-12,105),s.d,id);
  if(id==='ruin-door'){
    upper(p,0,38,45,'braced');upper(p,38,36,45,'window');
    p.at(0,0,0,-Math.PI/2,()=>upper(p,0,38,43,'open'));
  }else if(id==='ruin-high'){
    upper(p,0,38,46,'window');upper(p,38,36,44,'open');
    p.at(0,0,0,-Math.PI/2,()=>upper(p,0,38,43,'braced'));
  }else if(id==='ruin-pipes'){
    upper(p,0,38,45,'braced');p.at(0,0,0,-Math.PI/2,()=>upper(p,0,38,40,'open'));
  }else{
    upper(p,0,38,46,'broken');p.at(0,0,0,-Math.PI/2,()=>upper(p,0,38,37,'open'));
  }
  for(const [x,z] of [[3,3],[w-12,0],[0,d-12]])for(let i=0;i<7;i++){const g=new T.DodecahedronGeometry(1.7+i%3*.3,0);g.translate(x+(i%3-1)*3,1.2,z+Math.floor(i/3)*2);p.add(g,C.rust,'base-rubble');}
});}
function small(p,id){const cfg={ 'wall-relic':[49,43,'relic'], 'wall-pipes':[55,40,'pipes'], 'wall-corner':[33,36,'relic'], 'wall-door':[63,43,'relic']}[id];p.at(-cfg[0]/2,0,-6,0,()=>{panel(p,0,...cfg,true);if(id==='wall-corner')p.at(0,0,0,-Math.PI/2,()=>panel(p,0,24,30,'pipes',true));});}
export function buildKit(id){const p=new Parts();if(RUINS[id])ruin(p,id);else if(id.startsWith('wall-'))small(p,id);else if(id==='pylon-a'||id==='pylon-b')pylon(p,id==='pylon-b');else if(id==='shrine')shrine(p);else if(id==='barricade')barricade(p);else if(id==='capacitor')capacitor(p);else if(id==='shock')shockArray(p);else throw Error('Unknown Battlezone kit: '+id);const out=p.finish(id);if(RUINS[id]){const q=RUINS[id],w=q.a.reduce((n,a)=>n+a[0],0),d=q.b.reduce((n,a)=>n+a[0],0);out.userData.deck=DECKS[id].map(([x,z])=>[(x-w/2)/25.4,(z-d/2)/25.4]);}return out;}

// Kit assignment is based on stable layout ORDER, never on random object IDs. This keeps
// saved boards and remote peers visually consistent. Large tournament boards may repeat
// kit pieces; the product-photo display separately shows exactly one box's inventory.
function footprint(piece,w,h){
  const shape=new T.Shape();
  let pts=piece.fp;
  if(!pts&&piece.shape==='tri'){
    const corners=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
    const c=Number(piece.tc)||0;pts=[corners[c%4],corners[(c+1)%4],corners[(c+3)%4]];
  }
  if(!pts)pts=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
  shape.moveTo(...pts[0]);pts.slice(1).forEach(p=>shape.lineTo(...p));shape.closePath();
  const g=new T.ShapeGeometry(shape);g.rotateX(Math.PI/2);g.translate(0,.018,0);
  const art=areaCanvas(w,h),map=art?new T.CanvasTexture(art):null;
  if(map)map.colorSpace=T.SRGBColorSpace;
  const uv=[];for(let i=0;i<g.attributes.position.count;i++)uv.push(g.attributes.position.getX(i)/w+.5,.5-g.attributes.position.getZ(i)/h);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  const mesh=new T.Mesh(g,new T.MeshStandardMaterial({color:map?0xffffff:0x817054,map,roughness:1,side:T.DoubleSide}));mesh.receiveShadow=true;mesh.userData.terrainFootprint=true;
  return mesh;
}
function hull(points){
  const pts=[...new Map(points.map(p=>[p.map(v=>v.toFixed(3)).join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const lower=[],upper=[];for(const p of pts){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}for(const p of pts.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}return lower.slice(0,-1).concat(upper.slice(0,-1));
}
export function kitOutline(model){const positions=model.children[0].geometry.attributes.position;return hull(Array.from({length:positions.count},(_,i)=>[positions.getX(i),positions.getZ(i)]));}
export function placeKit(model,piece,w,h){
 const size=new T.Box3().setFromObject(model).getSize(new T.Vector3());const p=placementFor(kitOutline(model),size,piece,w,h);
 model.rotation.y=p.angle;model.scale.setScalar(p.scale);model.position.set(p.x,0,p.z);return p;
}

function terrain(ctx,kind,w,h,id){
  const piece=ctx.piece||{kind,w,h,id},kitId=kitFor(piece,ctx.all||[piece]);if(!kitId)return null;
  const root=new T.Group();root.add(footprint(piece,w,h));
  const features=piece.features||[{kitId}];let height=0,upperFloors=0;
  for(const f of features){
    const model=buildKit(f.kitId),box=new T.Box3().setFromObject(model),sz=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
    const pose=piece.features?featurePose(f,{center:{x:center.x,z:center.z},size:sz}):placementFor(kitOutline(model),sz,piece,w,h);
    model.rotation.y=pose.angle;model.scale.set(pose.scaleX||pose.scale,pose.scale,(pose.scaleZ||pose.scale)*(pose.mirror?-1:1));model.position.set(pose.x,0,pose.z);model.userData.cover=f.cover;
    root.add(model);height=Math.max(height,model.userData.terrainHeight*pose.scale);if(RUINS[f.kitId])upperFloors=1;
  }
  root.userData={builtBy:'battlezone-reference-20260918',kitId:features[0]?.kitId||kitId,featureCount:features.length,kitScale:1,terrainHeight:height,upperFloors,floorHeight:upperFloors?3:0};return root;
}
export function register(){for(const kind of ['ruin','wall','crate'])registerTerrainBuilder(kind,terrain);}
