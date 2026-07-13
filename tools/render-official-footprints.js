#!/usr/bin/env node
/* render-official-footprints.js — draw the ACTUAL official 11th-ed footprint outlines (the real
 * jagged `points` polygons from the Event-Companion data) to standalone SVG, so we can see the
 * true official shapes before baking them into the app. No browser/deps. Rules footprint is the
 * bounding rect; these are the visual silhouettes.
 * USAGE: node tools/render-official-footprints.js <SRC> <layoutIndex> > out.svg  (also NAME= to label)
 */
'use strict';
const fs = require('fs');
const SRC = process.env.SRC || '/private/tmp/claude-501/-Users-paulstadick-dev-PNT-WH40k/6f994c13-4867-4c66-a28e-ee798705d526/scratchpad/ref/ri-terrain-data-11e.js';
const IDX = parseInt(process.argv[2] || '0', 10);
function load(src){ let s=fs.readFileSync(src,'utf8').replace(/^[\s\S]*?const ELEVEN_E_LAYOUTS\s*=\s*/,'return ').replace(/;\s*(module\.exports[\s\S]*)?$/,';'); return (new Function(s))(); }
const L = load(SRC)[IDX];
const S = 18, W = 60, H = 44, PAD = 10;                 // px scale; board 60x44 units
const fx = x => (PAD + x * S).toFixed(1);
const fy = y => (PAD + (H - y) * S).toFixed(1);          // flip Y so it reads top-down like a table
const poly = pts => pts.map(p => fx(p.x) + ',' + fy(p.y)).join(' ');
const KIND = { large_rect_7x115: '', };
// colour by piece role
function fill(t){
  if (t.pieceType === 'long_line_10x2.5' || t.pieceType === 'short_line_6x2') return '#7d6a4a'; // defence line
  return '#6f5a37'; // rockcrete deck
}
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W*S+2*PAD}" height="${H*S+2*PAD}" viewBox="0 0 ${W*S+2*PAD} ${H*S+2*PAD}">`;
svg += `<rect width="100%" height="100%" fill="#24261f"/>`;
// deployment zones
(L.deploymentZones||[]).forEach((z,i)=>{ svg += `<polygon points="${poly(z.points)}" fill="${i? 'rgba(90,140,200,0.10)':'rgba(200,80,80,0.10)'}" stroke="${i?'#5a8cc8':'#c85050'}" stroke-width="1.2" stroke-dasharray="6 5"/>`; });
// base footprints — the REAL official outlines
L.terrain.filter(t=>t.base).forEach(t=>{
  svg += `<polygon points="${poly(t.points)}" fill="${fill(t)}" stroke="#141109" stroke-width="1.6"/>`;
  if (t.objective){ const xs=t.points.map(p=>p.x),ys=t.points.map(p=>p.y); const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2; svg += `<circle cx="${fx({x:cx}.x)}" cy="${fy({y:cy}.y)}" r="7" fill="none" stroke="#e8b23a" stroke-width="3"/>`; }
});
svg += `<text x="${PAD+4}" y="${PAD+16}" fill="#c9c3b4" font-family="sans-serif" font-size="15">${(process.env.NAME||L.id)} — official footprints</text>`;
svg += `</svg>`;
process.stdout.write(svg);
