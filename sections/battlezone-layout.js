import {SHAPES} from './battlezone-shapes.js';
// Shared deterministic placement for 2D sprites and 3D meshes. Units: inches.
export const KIT_IDS=["ruin-door", "ruin-pipes", "ruin-high", "ruin-broken", "wall-relic", "wall-pipes", "wall-corner", "wall-door", "pylon-a", "pylon-b", "shrine", "barricade", "capacitor", "shock"];
export function kitFor(piece,all=[]){
  if(piece.kitId&&KIT_IDS.includes(piece.kitId))return piece.kitId;
  const large=t=>t.kind==='ruin'&&Math.max(t.w,t.h)>=6.5;
  const smallArea=t=>t.kind==='ruin'&&!large(t);
  const index=pred=>Math.max(0,all.filter(pred).findIndex(t=>t.id===piece.id));
  if(large(piece))return ['ruin-door','ruin-pipes','ruin-high','ruin-broken'][index(large)%4];
  if(smallArea(piece))return ['capacitor','pylon-a','shrine','pylon-b'][index(smallArea)%4];
  if(piece.kind==='wall')return ['wall-relic','wall-pipes','barricade','shock','wall-corner','wall-door','barricade'][index(t=>t.kind==='wall')%7];
  if(piece.kind==='crate')return 'capacitor';
  return null;
}
export function footprintPoints(piece,w,h){
  if(piece.fp?.length>=3)return piece.fp;
  const corners=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
  if(piece.shape==='tri'){const c=Number(piece.tc)||0;return [corners[c%4],corners[(c+1)%4],corners[(c+3)%4]];}
  return corners;
}
function inside(x,z,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;
}return yes;}
export function placementFor(outline,size,piece,w,h){
  const poly=footprintPoints(piece,w,h);
  // Include edge midpoints so a model cannot straddle a concave card boundary unnoticed.
  const samples=outline.flatMap((a,i)=>{const b=outline[(i+1)%outline.length];return [a,[(a[0]+b[0])/2,(a[1]+b[1])/2]];});
  const preferred=((w<h)!==(size.x<size.z))?Math.PI/2:0;
  const centroid=poly.reduce((a,p)=>[a[0]+p[0]/poly.length,a[1]+p[1]/poly.length],[0,0]);
  const offsets=[[0,0],centroid];for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)offsets.push([x*w/12,z*h/12]);
  for(let scale=1;scale>=.15;scale-=.05)for(const angle of [preferred,preferred+Math.PI,preferred+Math.PI/2,preferred-Math.PI/2]){
    const c=Math.cos(angle),s=Math.sin(angle),rot=samples.map(([x,z])=>[(x*c+z*s)*scale,(-x*s+z*c)*scale]);
    for(const [x,z] of offsets)if(rot.every(p=>inside(p[0]+x,p[1]+z,poly))){return {scale,angle,x,z};}
  }
  // Very small manual cards: a uniformly reduced display model, never stretched axes.
  const scale=Math.max(.02,Math.min(w/Math.max(size.x,.01),h/Math.max(size.z,.01))*.3);return {scale,angle:0,x:0,z:0};
}
// Official layouts carry every measured feature pose from the current PDF. Centers
// are fixed, in footprint-local inches; no packing search, arbitrary rotation or scaling.
// Gallery geometry has an independent origin, so compensate for its actual bbox center.
export function featurePose(feature,shape){
  const swap=['pylon-a','pylon-b','ruin-broken'].includes(feature.kitId);
  const angle=feature.angle-(swap?Math.PI/2:0),mirror=!!feature.mirror!==swap;
  const c=Math.cos(angle),s=Math.sin(angle),mz=mirror?-1:1;
  const x=shape.center.x,z=shape.center.z*mz;
  return {scale:1,angle,mirror,x:feature.x-(x*c+z*s),z:feature.z-(-x*s+z*c)};
}

// Full base support on a real deck, in board coordinates. Empty areas of a footprint
// are not floors. Shared by the rules action and the 3D token elevation path.
export function floorContains(piece,x,z,radius=0){
  if(!piece.features)return null; // legacy/manual board retains its existing rules
  const a=(piece.rot||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const dx=x-piece.x-piece.w/2,dz=z-piece.y-piece.h/2,lx=dx*c+dz*s,lz=-dx*s+dz*c;
  return piece.features.some(f=>{
    const shape=SHAPES[f.kitId];if(!shape?.deck)return false;
    const p=featurePose(f,shape),cc=Math.cos(p.angle),ss=Math.sin(p.angle);
    const xx=lx-p.x,zz=lz-p.z,kx=xx*cc-zz*ss,kz=(xx*ss+zz*cc)*(p.mirror?-1:1);
    if(!inside(kx,kz,shape.deck))return false;
    for(let i=0;i<16;i++){const t=i*Math.PI/8;if(!inside(kx+Math.cos(t)*radius,kz+Math.sin(t)*radius,shape.deck))return false;}
    return true;
  });
}
