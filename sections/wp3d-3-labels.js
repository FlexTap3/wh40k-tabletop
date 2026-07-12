/* ==== WP3D-3: HUD/projected label layer ====
 * Exports: createLabelLayer(containerDiv, bridge, doc?) -> { tick(rig, state, extras), dispose() }
 *
 * Renders a pooled set of absolutely-positioned HTML divs over the 3D canvas (containerDiv is
 * expected to already be position:absolute/pointer-events:none, sized to the canvas):
 *   (a) wound-fraction pill "3/5" for damaged tokens (wounds<maxW), red-tinted
 *   (b) a status-icon pill (sgt/hid/fellBack/advanced) per flagged token
 *   (c) a move-cap readout pill (extras.moveReadout, displayed verbatim)
 *   (d) a ruler distance pill + a thin rotated-div ruler LINE (extras.ruler)
 *   (e) a hovered-unit name pill (extras.hoveredId)
 * Never creates/destroys DOM nodes per tick — the div pool only grows on demand; unused slots
 * are set display:none and reused next tick.
 *
 * ---- Required/optional `extras` fields (3rd arg to tick), beyond the frozen contract skeleton
 * `{moveReadout?, ruler?{x0,y0,x1,y1,dist}, hoveredId?}` ----
 *   - extras.heightFor?(token) -> number
 *       World-space Y anchor (elevation lift + model top) for a token. The contract's
 *       positioning note ("elevation+modelTop~1.6 for infantry / use a passed-in height fn ...
 *       else constant 2") does not say who resolves "infantry" or elevation — this layer never
 *       inspects terrain/kw, so it treats heightFor as the FULLY-RESOLVED anchor height and
 *       falls back to a flat constant (2) when absent. Integrator should wire this to
 *       `tok => sceneSync.elevationFor(tok) + (isInfantry(tok) ? 1.6 : someHullTop)`.
 *   - extras.labelEvery?: integer >= 1 (from wp3dPerfTier)
 *       Perf-tier throttle. Only every Nth tick calls rig.project() per label key; skipped ticks
 *       reuse the last computed screen position for that key. A label whose key first appears on
 *       a skipped tick is still projected immediately (no cached position exists yet) — so
 *       throttling only saves work in steady state, never delays a label's first appearance.
 *   - Move-cap readout anchor: the frozen contract gives extras.moveReadout no world position.
 *       This layer anchors it at the first id in `bridge.sel` (live Set, shared by reference)
 *       that resolves to a token in `state.tokens`; if the selection is empty (or resolves to no
 *       token) the readout is simply not drawn that tick. FLAGGED for the integrator: a
 *       dedicated `extras.moveReadoutAt{x,y}` (board inches) would be cleaner if WP3D-4's drag
 *       code ever wants to anchor the readout somewhere other than the selected token (e.g. the
 *       pointer/drag ghost).
 *   - Ruler line: drawn as ONE rotated 2px-tall div spanning the two projected endpoints
 *       (transform-origin 0 50%, width = pixel distance, rotate(atan2 degrees)) rather than a
 *       polyline/SVG element — cheapest thing that composites correctly over an absolutely
 *       positioned overlay. Hidden whenever either endpoint is invisible/offscreen.
 *
 * ---- Text/format delegation ----
 * extras.moveReadout is shown byte-for-byte verbatim (it's a game-rule string — Move
 * characteristic, Advance roll, caps — owned by WP2/bridge code; this layer never computes it).
 * Everything else rendered here — the wound "wounds/maxW" fraction, the ruler distance
 * (`dist.toFixed(1)+'"'`, matching wh40k-tabletop.html's own inline drawRuler() formatting
 * verbatim), the fixed status glyphs, and the hovered token's `name` field — is a direct,
 * non-game-logic display of data already sitting on the token/extras object; no rules math is
 * performed in this file.
 */
import * as THREE from '../vendor/three.module.min.js';

const ICONS = [
  ['sgt', '★'],        // ★
  ['hid', '👁'],  // 👁
  ['fellBack', '↩'],   // ↩
  ['advanced', '»'],   // »
];

const PILL_CSS = 'position:absolute;pointer-events:none;white-space:nowrap;' +
  'font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
  'background:rgba(10,12,16,.82);border:1px solid rgba(255,255,255,.18);' +
  'border-radius:4px;padding:1px 5px;color:#e8e8ec;transform:translate(-50%,-50%);';
const WOUND_CSS = 'border-color:#c03d3d;color:#ff9a9a;';
const NAME_CSS = 'border-color:rgba(255,255,255,.32);font-weight:600;';
const STATUS_CSS = 'letter-spacing:1px;';
const LINE_CSS = 'position:absolute;pointer-events:none;height:2px;background:#e8c34a;transform-origin:0 50%;';

function iconsFor(tok) {
  let s = '';
  for (let i = 0; i < ICONS.length; i++) {
    const flag = ICONS[i][0], glyph = ICONS[i][1];
    if (tok[flag]) s += (s ? ' ' : '') + glyph;
  }
  return s || null;
}

export function createLabelLayer(containerDiv, bridge, doc) {
  doc = doc || (typeof document !== 'undefined' ? document : undefined);
  const pool = [];             // [{el}]
  const posCache = new Map();  // key -> {x,y,visible} last-projected CSS px

  let tickCount = 0;

  function containerSize() {
    if (containerDiv.clientWidth || containerDiv.clientHeight) {
      return { w: containerDiv.clientWidth, h: containerDiv.clientHeight };
    }
    if (containerDiv.getBoundingClientRect) {
      const r = containerDiv.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }
    return { w: 0, h: 0 };
  }

  function ensurePoolSize(n) {
    while (pool.length < n) {
      const el = doc.createElement('div');
      el.style.display = 'none';
      containerDiv.appendChild(el);
      pool.push({ el });
    }
  }

  function ndcToPx(ndc, size) {
    return {
      x: (ndc.x * 0.5 + 0.5) * size.w,
      y: (1 - (ndc.y * 0.5 + 0.5)) * size.h,
    };
  }

  function offscreen(px, size) {
    return px.x < 0 || px.x > size.w || px.y < 0 || px.y > size.h;
  }

  // Projects (or reuses the cached projection for) one label anchor. Only calls rig.project()
  // when doProject is true or this key has never been projected before.
  function resolvePos(rig, key, world, size, doProject) {
    if (doProject || !posCache.has(key)) {
      const p = rig.project(world);
      const visible = p.visible !== false;
      let rec;
      if (visible) {
        const screen = ndcToPx(p, size);
        rec = { visible: !offscreen(screen, size), x: screen.x, y: screen.y };
      } else {
        rec = { visible: false, x: 0, y: 0 };
      }
      posCache.set(key, rec);
      return rec;
    }
    return posCache.get(key);
  }

  function heightFor(tok, extras) {
    return extras.heightFor ? extras.heightFor(tok) : 2;
  }

  function place(slot, x, y, text, extraCss) {
    slot.el.style.cssText = PILL_CSS + (extraCss || '') +
      'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;';
    slot.el.textContent = text;
    slot.el.style.display = '';
  }

  function tick(rig, state, extras) {
    extras = extras || {};
    tickCount++;
    const every = Math.max(1, extras.labelEvery || 1);
    const doProject = ((tickCount - 1) % every) === 0;
    const size = containerSize();
    const tokens = (state && state.tokens) || [];

    // Build the list of labels needed THIS tick (pill entries only; ruler line handled after).
    const needed = [];

    for (let ti = 0; ti < tokens.length; ti++) {
      const tok = tokens[ti];
      const y = heightFor(tok, extras);
      if (typeof tok.wounds === 'number' && typeof tok.maxW === 'number' && tok.wounds < tok.maxW) {
        needed.push({
          key: 'w:' + tok.id, world: new THREE.Vector3(tok.x, y, tok.y),
          text: tok.wounds + '/' + tok.maxW, css: WOUND_CSS, dy: 0,
        });
      }
      const icons = iconsFor(tok);
      if (icons) {
        needed.push({
          key: 's:' + tok.id, world: new THREE.Vector3(tok.x, y, tok.y),
          text: icons, css: STATUS_CSS, dy: -16,
        });
      }
    }

    if (extras.hoveredId) {
      const tok = tokens.find(t => t.id === extras.hoveredId);
      if (tok) {
        const y = heightFor(tok, extras);
        needed.push({
          key: 'name:' + tok.id, world: new THREE.Vector3(tok.x, y, tok.y),
          text: tok.name, css: NAME_CSS, dy: 16,
        });
      }
    }

    if (extras.moveReadout) {
      let anchorTok = null;
      if (bridge && bridge.sel && bridge.sel.size) {
        for (const id of bridge.sel) {
          anchorTok = tokens.find(t => t.id === id);
          if (anchorTok) break;
        }
      }
      if (anchorTok) {
        const y = heightFor(anchorTok, extras);
        needed.push({
          key: 'movecap', world: new THREE.Vector3(anchorTok.x, y, anchorTok.y),
          text: extras.moveReadout, css: '', dy: -32,
        });
      }
    }

    let ruler = null;
    if (extras.ruler) {
      ruler = extras.ruler;
      const mx = (ruler.x0 + ruler.x1) / 2, mz = (ruler.y0 + ruler.y1) / 2;
      needed.push({
        key: 'ruler-mid', world: new THREE.Vector3(mx, 0.3, mz),
        text: ruler.dist.toFixed(1) + '"', css: '', dy: -12,
      });
    }

    ensurePoolSize(needed.length + (ruler ? 1 : 0));

    let i = 0;
    for (; i < needed.length; i++) {
      const n = needed[i];
      const rec = resolvePos(rig, n.key, n.world, size, doProject);
      const slot = pool[i];
      if (!rec.visible) { slot.el.style.display = 'none'; continue; }
      place(slot, rec.x, rec.y + n.dy, n.text, n.css);
    }

    if (ruler) {
      const slot = pool[i++];
      const recA = resolvePos(rig, 'ruler-a', new THREE.Vector3(ruler.x0, 0.3, ruler.y0), size, doProject);
      const recB = resolvePos(rig, 'ruler-b', new THREE.Vector3(ruler.x1, 0.3, ruler.y1), size, doProject);
      if (!recA.visible || !recB.visible) {
        slot.el.style.display = 'none';
      } else {
        const dx = recB.x - recA.x, dz = recB.y - recA.y;
        const len = Math.hypot(dx, dz);
        const ang = Math.atan2(dz, dx) * 180 / Math.PI;
        slot.el.style.cssText = LINE_CSS +
          'left:' + recA.x.toFixed(1) + 'px;top:' + recA.y.toFixed(1) + 'px;' +
          'width:' + len.toFixed(1) + 'px;transform:rotate(' + ang.toFixed(3) + 'deg);';
        slot.el.textContent = '';
        slot.el.style.display = '';
      }
    }

    for (let j = i; j < pool.length; j++) {
      if (pool[j].el.style.display !== 'none') pool[j].el.style.display = 'none';
    }
  }

  function dispose() {
    for (let i = 0; i < pool.length; i++) {
      const el = pool[i].el;
      if (containerDiv.removeChild) { try { containerDiv.removeChild(el); } catch (e) { /* not attached */ } }
    }
    pool.length = 0;
    posCache.clear();
  }

  return { tick, dispose };
}
