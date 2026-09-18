// Flat printed-card artwork, shared by 2D and 3D. This is drawn ink, never raised rubble.
// Reconstructed graphic treatment, not a scan of the GW card artwork.
const cache=new Map();
export function areaCanvas(w,h){
 if(typeof document==='undefined')return null;const key=w.toFixed(3)+'x'+h.toFixed(3);if(cache.has(key))return cache.get(key);
 const c=document.createElement('canvas');const s=50;c.width=Math.max(16,Math.ceil(w*s));c.height=Math.max(16,Math.ceil(h*s));const g=c.getContext('2d');
 let seed=Math.round(w*31+h*19)*777;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 g.fillStyle='#786448';g.fillRect(0,0,c.width,c.height);
 // Steel-edged rectangular deck panels and rivets under the printed rubble.
 g.strokeStyle='#494b43';g.lineWidth=3;for(let x=4;x<c.width;x+=80)for(let y=4;y<c.height;y+=100){g.strokeRect(x,y,75,95);g.fillStyle='#aa956c';for(let yy=y+5;yy<y+90;yy+=16){g.fillRect(x+3,yy,2,2);g.fillRect(x+68,yy,2,2);}}
 for(let i=0;i<90;i++){const x=rnd()*c.width,y=rnd()*c.height;g.fillStyle='rgba(27,24,21,.12)';g.fillRect(x,y,2+rnd()*50,1);}
 for(let i=0;i<Math.round(w*h*14);i++){
  const edge=Math.floor(rnd()*4),depth=rnd()*rnd()*Math.min(c.width,c.height)*.36;
  const x=edge===0?depth:edge===1?c.width-depth:rnd()*c.width,y=edge===2?depth:edge===3?c.height-depth:rnd()*c.height,r=1+rnd()*7;
  g.beginPath();for(let k=0;k<5;k++){const a=k*Math.PI*.4,rr=r*(.6+rnd()*.4);const px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;k?g.lineTo(px,py):g.moveTo(px,py);}g.closePath();g.fillStyle=['#b0a382','#c9bc99','#8c8068','#665a46'][Math.floor(rnd()*4)];g.fill();
 }
 for(let i=0;i<4;i++){g.save();g.translate(rnd()*c.width,rnd()*c.height);g.rotate(rnd()*Math.PI);g.fillStyle='#474d49';g.fillRect(-25,-2,50,4);g.fillStyle='#92917a';g.fillRect(-25,-2,50,1);g.restore();}
 // Dark vent grille, printed flush onto the card.
 g.fillStyle='#343b37';g.fillRect(c.width*.52,c.height*.35,35,22);g.strokeStyle='#8c876e';g.lineWidth=1;for(let x=0;x<35;x+=4){g.beginPath();g.moveTo(c.width*.52+x,c.height*.35);g.lineTo(c.width*.52+x,c.height*.35+22);g.stroke();}
 cache.set(key,c);return c;
}
