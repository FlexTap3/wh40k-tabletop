import {kitFor,placementFor,featurePose} from './battlezone-layout.js';
import {areaCanvas} from './battlezone-area.js';
import {footprintPoints} from './battlezone-layout.js';
import {SHAPES} from './battlezone-shapes.js';
// Pre-rendered overhead views of buildKit(): the 2D view uses the same geometry,
// orientation and physical scale as the 3D view without allocating a second WebGL scene.
export async function createTerrainSprites(){
 const images={};await Promise.all(Object.keys(SHAPES).map(id=>new Promise(resolve=>{const im=new Image();im.onload=()=>{images[id]=im;resolve();};im.onerror=resolve;im.src=new URL('../terrain/'+id+'.png',import.meta.url).href;})));
 const memo=new Map();
 const draw=(ctx,piece,all,pixelsPerInch)=>{
  ctx.save();ctx.beginPath();footprintPoints(piece,piece.w,piece.h).forEach(([x,z],i)=>i?ctx.lineTo(x*pixelsPerInch,z*pixelsPerInch):ctx.moveTo(x*pixelsPerInch,z*pixelsPerInch));ctx.closePath();ctx.clip();ctx.drawImage(areaCanvas(piece.w,piece.h),-piece.w*pixelsPerInch/2,-piece.h*pixelsPerInch/2,piece.w*pixelsPerInch,piece.h*pixelsPerInch);ctx.restore();
  const features=piece.features||[{kitId:kitFor(piece,all)}];
  for(const feature of features){
    const id=feature.kitId,s=SHAPES[id],im=images[id];if(!s||!im)continue;
    const key=JSON.stringify([feature,piece.w,piece.h,piece.shape,piece.tc,piece.fp]);let p=memo.get(key);
    if(!p){p=piece.features?featurePose(feature,s):placementFor(s.outline,s.size,piece,piece.w,piece.h);memo.set(key,p);}
    ctx.save();ctx.translate(p.x*pixelsPerInch,p.z*pixelsPerInch);ctx.rotate(-p.angle);if(p.mirror)ctx.scale(1,-1);const sc=p.scale*pixelsPerInch;
    ctx.drawImage(im,(s.center.x-s.imageWidth/2)*sc,(s.center.z-s.imageHeight/2)*sc,s.imageWidth*sc,s.imageHeight*sc);ctx.restore();
  }
 };
 draw.loadedCount=Object.keys(images).length;return draw;
}
