// challenger.js — the side-1 opponent policy. The built-in AI is hard-bound to side 2
// (it gates on state.phase.side===2 / t.owner===2), so a non-built-in player must drive
// side 1. This is Tier N: neutral, deterministic, doctrine-light. It plays only LEGAL moves
// by reusing the app's own tested mutation helpers:
//   - aiTryTranslate(ms,dx,dy,enemyToks,allowEngage) : rigid formation move, terrain/edge/
//     engagement/overlap-legal by construction (so coherency + impassable stay clean).
//   - aiFireWeapon(atkUk,atkMs,w,shooters,tgt,los)   : the real Attack-tab roller path; the
//     rollAttack hook (wp10AttackDone, aiActing branch) auto-applies casualties to the target.
//   - wp6Tallies / aiWeapons / aiMainWeapon / aiExpDamage / losCheckUnits / wp3UnitDist / aiD6.
//
// TIER-S HOOK (documented, unused at Tier N): set global.CHALLENGER_POLICY to a function
//   (snapshot, phase, round) => [actions] to let an agent-in-the-loop take the wheel per turn.
//   `snapshot` is what a player can legally see (challengerSnapshot()); returning a non-null
//   array of {type,...} short-circuits the built-in Tier-N behaviour for that phase. Left null
//   here so headless games run unattended; a future Tier-S agent plugs in without touching the
//   built-in AI or the single-file app.

// units this challenger owns (side 1), grouped like aiUnits(2)
function chUnits() { return aiUnits(1); }
function chEnemyToks() { return state.tokens.filter(t => t.owner === 2); }

// ---- difficulty tier (N neutral / S skilled). Read from the runner config (SIM.config.tier),
//      so `--tier S` flows gamerunner → SIM.config → here without touching the single-file app. ----
function chTierS() { return String((typeof SIM !== "undefined" && SIM.config && SIM.config.tier) || "N").toUpperCase() === "S"; }

// Tier-S doctrine knobs (side-1 mirror of AI_TUNE / AI_PLANS "hold"; objective-first, focus-fire,
// screen the backfield, don't overextend). Deterministic — same seed ⇒ identical game.
const CH_S = {
  objBase: 18, objContest: 10, objKeep: 0.6, objApproach: 1.0,  // objective valuation (Take & Hold; primary is the win condition)
  shootW: 1.3, rangeApproach: 0.3, coverW: 2.5,                 // firepower + positioning
  threatW: 0.95, holdThreat: 0.35, closeW: 0.45,               // melee caution — but a point we can hold is worth taking fire for
  screenW: 8, screenCheap: 110, screenProtect: 150,            // picket cheap units in front of valuables
  overkill: 1.1,                                               // stop piling fire past ~10% over a unit's wounds
  tagGun: 2.0, onObjCharge: 2.0,                              // charge bonuses: tie up gunlines / shift squatters
};
function chUnitValue(ms) { const c = aiCardFor(ms[0]); return (c && parseInt(c.pts)) || ms.length * 15; }
function chUnitOC(ms) { return ms.reduce((s, t) => s + (t.bs ? 0 : (+t.OC || 0)), 0); }
function chCentroid(toks) { return [toks.reduce((s, t) => s + t.x, 0) / toks.length, toks.reduce((s, t) => s + t.y, 0) / toks.length]; }
// incoming melee threat if a fast enemy could reach (x,y) this/next turn — used to refuse overextension
function chThreatAt(x, y, ms, enemies) {
  let threat = 0;
  enemies.forEach(e => {
    if (!e.toks.length) return;
    const eM = Math.max(...e.toks.map(t => (typeof t.Mv === "number") ? t.Mv : 6));
    const exd = Math.min(...e.toks.map(t => Math.hypot(t.x - x, t.y - y)));
    if (exd <= eM + 8) threat += aiMeleeThreat(e.toks, ms);
  });
  return threat;
}
// side-1 target valuation: expected damage × points-density, boosted for units on an objective we
// DON'T hold and for characters. (aiTargetScore is owner-2-centric, so Tier-S uses its own scorer.)
function chTargetPriority(e, exp) {
  const t0 = e.toks[0], card = aiCardFor(t0);
  const pts = (card && parseInt(card.pts)) || e.toks.length * 10;
  const totW = e.toks.reduce((s, t) => s + (t.wounds || 1), 0);
  let s = exp * (1 + 1.2 * Math.min(2, pts / Math.max(1, totW * 12)));
  const mR = mmIn(40) / 2;
  if (wp6Tallies().some(x => x.holder !== 1 && e.toks.some(t => Math.hypot(t.x - x.o.x, t.y - x.o.y) - mR - tokRadius(t) <= 3.02))) s *= 1.5;
  if (e.toks.some(t => tokKw(t).includes("CHARACTER"))) s *= 1.15;
  return s;
}

// Strict rigid translate toward (dx,dy), capped at `cap` inches (every model moves the same
// vector, so |vector| <= cap keeps the per-model move cap exactly — unlike aiTryTranslate,
// whose perpendicular offsets can push a move ~2" past M). Same legality checks as the app's
// mover: board edges, impassable (wp5Illegal), engagement range, no friendly base overlap.
// Returns the distance actually moved (0 if fully blocked). Coherency is preserved (rigid).
function challengerTranslate(ms, dx, dy, cap, enemyToks, allowEngage) {
  const mag = Math.hypot(dx, dy) || 0.0001;
  let bx = dx, by = dy;
  if (mag > cap) { bx = dx / mag * cap; by = dy / mag * cap; }   // never exceed the cap
  const scales = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1];
  for (const sc of scales) {
    const vx = bx * sc, vy = by * sc;
    const good = ms.every(t => {
      const c = Object.assign({}, t, { x: t.x + vx, y: t.y + vy });
      const r = tokRadius(c) + 0.1;
      if (c.x < r || c.y < r || c.x > state.board.w - r || c.y > state.board.h - r) return false;
      if (wp5Illegal(c)) return false;
      for (const e of enemyToks) {
        if (!allowEngage && edgeDist(c, e) <= 1.05) return false;  // don't end within 1" unless charging
        if (allowEngage && edgeDist(c, e) < -0.05) return false;   // never overlap bases
      }
      for (const o of state.tokens) if (o.owner === c.owner && o.unit !== c.unit && edgeDist(c, o) < 0.02) return false;
      return true;
    });
    if (good) { op({ k: "tok~", toks: ms.map(t => ({ id: t.id, x: t.x + vx, y: t.y + vy })) }); return Math.hypot(vx, vy); }
  }
  return 0;
}

// A player-legal view of the board for a future agent policy (no hidden reserves/secondaries).
function challengerSnapshot() {
  return {
    round: state.trackers.round, phase: state.phase.ph, side: state.phase.side,
    cp1: state.trackers.cp1, cp2: state.trackers.cp2, vp1: state.trackers.vp1, vp2: state.trackers.vp2,
    objectives: wp6Tallies().map((x, i) => ({ i, x: x.o.x, y: x.o.y, oc1: x.oc1, oc2: x.oc2, holder: x.holder })),
    myUnits: chUnits().map(u => ({ uk: u.uk, name: u.toks[0].name, n: u.toks.length,
      cx: u.toks.reduce((s, t) => s + t.x, 0) / u.toks.length, cy: u.toks.reduce((s, t) => s + t.y, 0) / u.toks.length })),
    enemyUnits: aiUnits(2).map(u => ({ uk: u.uk, name: u.toks[0].name, n: u.toks.length,
      cx: u.toks.reduce((s, t) => s + t.x, 0) / u.toks.length, cy: u.toks.reduce((s, t) => s + t.y, 0) / u.toks.length })),
  };
}
if (typeof global !== "undefined" && global.CHALLENGER_POLICY === undefined) global.CHALLENGER_POLICY = null;

// ---- muster ~pts of side-1 army and deploy inside dz[0] (mirrors aiMuster, owner 1) ----
function challengerMuster(fid, pts) {
  const prevSide = mySide, prevName = myName;
  mySide = 1; myName = state.names[1] || "Challenger"; myArmy = [];
  const list = aiBuildList(fid, pts);
  const built = [];
  list.forEach(it => {
    const card = addFromDb(fid, it.idx, it.size, true);
    if (!card) return;
    card.pts = String(it.pts);
    deployCard(card);
    built.push(card);
  });
  broadcastCards();                       // populate state.cards[1] so aiCardFor() finds side-1 weapons
  // place each unit legally inside the red (side-1) DZ, biggest first
  const poly = (state.dz && state.dz[0]) || null;
  if (poly && poly.length >= 3) {
    const placed = state.tokens.filter(t => t.owner === 2).slice();
    chUnits().sort((a, b) => b.toks.length - a.toks.length).forEach(u => {
      const toks = state.tokens.filter(t => t.unit === u.uk);
      if (!aiPlaceUnit(toks, poly, placed)) {
        // fall back: leave where deployCard dropped it (still logged by auditor if illegal)
      }
    });
  }
  if (chTierS()) challengerHoldReservesS();   // Tier S: time a unit into Strategic Reserves
  mySide = prevSide; myName = prevName;
  return { list, pts: list.reduce((s, u) => s + u.pts, 0), units: chUnits().length };
}

// Tier S: hold one cheap infantry unit in Strategic Reserves (mirrors aiHoldReserves for owner 1).
function challengerHoldReservesS() {
  const units = chUnits();
  if (units.length < 4) return;
  const cand = units.filter(u => {
    const ms = u.toks;
    return ms.length >= 3 && ms.length <= 10 && ms.every(t => tokKw(t).includes("INFANTRY"))
      && !ms.some(t => tokKw(t).includes("CHARACTER") || t.attachedFrom);
  }).sort((a, b) => a.toks.length - b.toks.length);
  if (!cand.length) return;
  const toks = state.tokens.filter(t => t.unit === cand[0].uk);
  const entry = { id: cand[0].uk, owner: 1, name: toks[0].name, ds: false, toks: JSON.parse(JSON.stringify(toks)) };
  op({ k: "rsv+", res: entry });
  op({ k: "tok-", ids: toks.map(t => t.id) });
}

// ---- Command: battle-shock tests for below-half side-1 units (mirrors aiCommand, owner 1) ----
function challengerCommand() {
  const acts = [];
  chUnits().forEach(u => {
    const ms = state.tokens.filter(t => t.unit === u.uk); if (!ms.length) return;
    if (!aiBelowHalf(ms)) {
      if (ms.some(t => t.bs)) op({ k: "tok~", toks: ms.map(t => ({ id: t.id, bs: false })) }); // rallied
      return;
    }
    const ld = aiLd(ms), a = aiD6(), b = aiD6(), ok = a + b >= ld;
    op({ k: "tok~", toks: ms.map(t => ({ id: t.id, bs: !ok })) });
    acts.push({ type: "shock", unit: ms[0].name, dice: [a, b], ld, pass: ok });
  });
  return acts;
}

// ---- Movement: each unit heads to the nearest useful objective (or nearest enemy if pure
//      melee). Never advances (keeps shooting + a clean M-only move cap). aiTryTranslate keeps
//      it legal; coherency is preserved because the whole formation translates rigidly. ----
function challengerMoveUnit(uk) {
  const ms = state.tokens.filter(t => t.unit === uk); if (!ms.length) return null;
  const M = Math.min(...ms.map(t => (typeof t.Mv === "number" && t.Mv > 0) ? t.Mv : 6));
  const cx = ms.reduce((s, t) => s + t.x, 0) / ms.length, cy = ms.reduce((s, t) => s + t.y, 0) / ms.length;
  const W = aiWeapons(ms);
  const enemyToks = chEnemyToks();
  let tx, ty, why;
  if (!W.ranged.length && enemyToks.length) {                 // pure melee: close on nearest enemy unit
    let near = null, nd = Infinity;
    aiUnits(2).forEach(e => { if (!e.toks.length) return; const d = wp3UnitDist(ms, e.toks); if (d < nd) { nd = d; near = e; } });
    if (near) {
      tx = near.toks.reduce((s, t) => s + t.x, 0) / near.toks.length;
      ty = near.toks.reduce((s, t) => s + t.y, 0) / near.toks.length;
      why = "advances on " + near.toks[0].name;
    }
  }
  if (tx === undefined) {                                     // otherwise: nearest objective, preferring ones we don't already hold
    const tal = wp6Tallies();
    let obj = null, bd = Infinity;
    tal.forEach(o => { const d = Math.hypot(o.o.x - cx, o.o.y - cy); const pref = o.holder === 1 ? d + 40 : d; if (pref < bd) { bd = pref; obj = o; } });
    if (obj) { tx = obj.o.x; ty = obj.o.y; why = "moves toward objective"; }
  }
  if (tx === undefined) return { uk, unit: ms[0].name, moved: 0, why: "holds (no target)" };
  const dx = tx - cx, dy = ty - cy, dist = Math.hypot(dx, dy) || 0.001;
  if (dist < 0.5) return { uk, unit: ms[0].name, moved: 0, why: "holds position" };
  const moved = challengerTranslate(ms, dx, dy, M, enemyToks, false);  // normal move only, strictly capped at M
  if (moved > 0.05) {
    const ms2 = state.tokens.filter(t => t.unit === uk);
    const ncx = ms2.reduce((s, t) => s + t.x, 0) / ms2.length, ncy = ms2.reduce((s, t) => s + t.y, 0) / ms2.length;
    return { uk, unit: ms[0].name, moved: +moved.toFixed(2), cap: M, why, fromX: +cx.toFixed(1), fromY: +cy.toFixed(1), toX: +ncx.toFixed(1), toY: +ncy.toFixed(1) };
  }
  return { uk, unit: ms[0].name, moved: 0, why: "blocked" };
}
function challengerMovement() {
  const acts = [];
  chUnits().forEach(u => { const r = challengerMoveUnit(u.uk); if (r) acts.push(Object.assign({ type: "move" }, r)); });
  return acts;
}

// ---- Shooting: each ranged weapon fires at its best legal (visible + in-range) target.
//      Uses the real roller (aiFireWeapon), so casualties are applied exactly as in play. ----
function challengerShootUnit(uk) {
  const ms = state.tokens.filter(t => t.unit === uk); if (!ms.length) return [];
  const W = aiWeapons(ms); if (!W.ranged.length) return [];
  const main = aiMainWeapon(W.ranged);
  const acts = [];
  W.ranged.forEach(w => {
    const ms2 = state.tokens.filter(t => t.unit === uk); if (!ms2.length) return;
    const shooters = (w === main) ? ms2.length : 1;
    let best = null;
    aiUnits(2).forEach(e => {
      if (!e.toks.length) return;
      const los = losCheckUnits(uk, e.uk);
      if (!los || !los.vis || los.dist > w.rng + 0.02) return;
      const exp = aiExpDamage(w, shooters, e.toks, los.dist, !!los.cover);
      if (exp < 0.05) return;
      const sc = aiTargetScore(e, exp);                       // reuse the app's target valuation (focus fire)
      if (!best || sc > best.sc) best = { e, los, exp, sc };
    });
    if (!best) return;
    const before = best.e.toks.length, beforeW = best.e.toks.reduce((s, t) => s + (t.wounds || 1), 0);
    aiFireWeapon(uk, ms2, w, shooters, best.e, best.los);     // rolls + auto-applies casualties to owner-2 target
    const after = state.tokens.filter(t => t.unit === best.e.uk);
    acts.push({ type: "shoot", unit: ms2[0].name, target: best.e.toks[0].name, weapon: w.n, shooters,
      dist: +best.los.dist.toFixed(1), rng: w.rng, vis: !!best.los.vis, cover: !!best.los.cover,
      slain: before - after.length, woundsDealt: beforeW - after.reduce((s, t) => s + (t.wounds || 1), 0) });
  });
  return acts;
}
function challengerShooting() {
  const acts = [];
  chUnits().forEach(u => { const r = challengerShootUnit(u.uk); if (r.length) acts.push(...r); });
  return acts;
}

// ---- Charge: only when clearly favorable (expected melee damage beats what we'd take back),
//      target in 2..12", real 2D6 roll, move into contact via aiTryTranslate (mirrors aiChargeUnit). ----
function challengerChargeUnit(uk) {
  const ms = state.tokens.filter(t => t.unit === uk); if (!ms.length) return null;
  if (ms.every(t => t.bs)) return null;                       // battle-shocked units play safe
  const W = aiWeapons(ms); if (!W.melee.length) return null;
  let best = null;
  aiUnits(2).forEach(e => {
    if (!e.toks.length) return;
    const d = wp3UnitDist(ms, e.toks);
    if (d > 12.02 || d <= 1.02) return;
    const los = losCheckUnits(uk, e.uk);
    if (!los || !los.vis) return;
    const exp = Math.max(...W.melee.map(w => aiExpDamage(w, ms.length, e.toks, 0, false)));
    const profit = exp * 1.0 - aiMeleeThreat(e.toks, ms);     // charge only if we out-trade
    if (profit > 0 && (!best || profit > best.profit)) best = { e, d, profit };
  });
  if (!best) return null;
  const a = aiD6(), b = aiD6(), roll = a + b;
  if (roll + 1.02 < best.d) return { type: "charge", unit: ms[0].name, target: best.e.toks[0].name, need: +best.d.toFixed(1), roll, made: false };
  const [am, bm] = aiClosestPair(ms, best.e.toks);
  const need = Math.max(0, edgeDist(am, bm) - 0.15), dd = Math.hypot(bm.x - am.x, bm.y - am.y) || 1;
  // charge move is capped by the 2D6 roll (not M); strict translate keeps it <= roll
  const made = challengerTranslate(ms, (bm.x - am.x) / dd * need, (bm.y - am.y) / dd * need, roll, chEnemyToks(), true) > 0.01;
  return { type: "charge", unit: ms[0].name, target: best.e.toks[0].name, need: +best.d.toFixed(1), roll, made };
}
function challengerCharges() {
  const acts = [];
  chUnits().forEach(u => { const r = challengerChargeUnit(u.uk); if (r) acts.push(r); });
  return acts;
}

// ---- Fight: strike engaged enemies with the best melee weapon (mirrors aiFightUnit, owner 1) ----
function challengerFightUnit(uk) {
  const ms = state.tokens.filter(t => t.unit === uk); if (!ms.length) return null;
  const W = aiWeapons(ms); if (!W.melee.length) return null;
  let best = null;
  aiUnits(2).forEach(e => {
    if (!e.toks.length || wp3UnitDist(ms, e.toks) > 1.02) return;
    const w = W.melee.reduce((a2, b2) => aiExpDamage(b2, ms.length, e.toks, 0, false) > aiExpDamage(a2, ms.length, e.toks, 0, false) ? b2 : a2);
    const sc = aiTargetScore(e, aiExpDamage(w, ms.length, e.toks, 0, false));
    if (!best || sc > best.sc) best = { e, w, sc };
  });
  if (!best) return null;
  const engaged = Math.max(1, ms.filter(t => best.e.toks.some(b2 => edgeDist(t, b2) <= 2.02)).length);
  const before = best.e.toks.length;
  aiFireWeapon(uk, ms, best.w, engaged, best.e, { dist: 0, vis: true, cover: false });
  const after = state.tokens.filter(t => t.unit === best.e.uk).length;
  return { type: "fight", unit: ms[0].name, target: best.e.toks[0].name, weapon: best.w.n, slain: before - after };
}
function challengerFights() {
  const acts = [];
  chUnits().forEach(u => { const r = challengerFightUnit(u.uk); if (r) acts.push(r); });
  return acts;
}

// ===================== TIER S (skilled, still fully deterministic) =====================
// All actions reuse the app's own legality-safe helpers, so Tier S produces ZERO auditor
// findings just like Tier N. The uplift is DECISION quality, not new powers.

// ---- Tier-S reserves: arrive the held unit from round 2 at a legal edge spot near a contested
//      objective (mirrors aiArriveReserves for owner 1; wp7ArriveIllegal guards every rule). ----
function chResSpotScore(x, y, tal) {
  if (!tal.length) return 0;
  return -Math.min(...tal.filter(o => o.holder !== 1).concat(tal).map(o => Math.hypot(o.o.x - x, o.o.y - y)));
}
function challengerArriveReserves(round, arrivedUks) {
  const acts = [];
  if (round < 2) return acts;
  ((state.reserves && state.reserves[1]) || []).slice().forEach(entry => {
    const e = ((state.reserves && state.reserves[1]) || []).find(r => r.id === entry.id); if (!e) return;
    const toks = JSON.parse(JSON.stringify(e.toks || [])); if (!toks.length) { op({ k: "rsv-", id: e.id }); return; }
    const enemies = state.tokens.filter(t => t.owner === 2), enemyDz = (state.dz || [])[1];
    const tal = wp6Tallies(), spots = [];
    for (let x = 3; x < state.board.w - 2; x += 3) { spots.push([x, 3], [x, state.board.h - 3]); }
    for (let y = 3; y < state.board.h - 2; y += 3) { spots.push([3, y], [state.board.w - 3, y]); }
    spots.sort((a, b) => chResSpotScore(b[0], b[1], tal) - chResSpotScore(a[0], a[1], tal));
    const [cx, cy] = chCentroid(toks);
    for (const [sx, sy] of spots) {
      const moved = toks.map(t => Object.assign({}, t, { x: t.x + sx - cx, y: t.y + sy - cy }));
      if (wp7ArriveIllegal(moved, !!e.ds, round, state.board, enemyDz, enemies)) continue;
      if (!moved.every(t => !wp5Illegal(t) && t.x > tokRadius(t) && t.y > tokRadius(t)
        && t.x < state.board.w - tokRadius(t) && t.y < state.board.h - tokRadius(t)
        && state.tokens.every(o => edgeDist(t, o) > 0.02))) continue;
      op({ k: "rsv-", id: e.id });
      op({ k: "tok+", toks: moved });
      arrivedUks.add(e.id);
      acts.push({ type: "arrive", unit: e.name, n: moved.length, toX: +sx.toFixed(1), toY: +sy.toFixed(1), why: "arrives from Strategic Reserves" });
      return;
    }
  });
  return acts;
}

// ---- Tier-S screening: cheap units picket ~7" in front of the most valuable friendly unit,
//      toward the nearest enemy — denies charge lanes / deep-strike onto the backfield. ----
function challengerScreenCands(cands, ctx) {
  const val = chUnitValue(ctx.ms);
  if (val > CH_S.screenCheap || ctx.ms.some(t => tokKw(t).includes("CHARACTER"))) return;
  if (!ctx.enemies.length) return;
  const others = chUnits().filter(u => u.uk !== ctx.uk)
    .map(u => ({ toks: state.tokens.filter(t => t.unit === u.uk) }))
    .filter(o => o.toks.length && chUnitValue(o.toks) >= CH_S.screenProtect)
    .sort((a, b) => chUnitValue(b.toks) - chUnitValue(a.toks));
  if (!others.length) return;
  const [px, py] = chCentroid(others[0].toks);
  let near = null, nd = 1e9;
  ctx.enemies.forEach(e => { const [ex, ey] = chCentroid(e.toks); const d = Math.hypot(ex - px, ey - py); if (d < nd) { nd = d; near = e; } });
  if (!near) return;
  const [ex, ey] = chCentroid(near.toks), d = Math.hypot(ex - px, ey - py) || 1, g = 7;
  cands.push({ x: px + (ex - px) / d * g, y: py + (ey - py) / d * g, screen: true, why: "screens the backfield" });
}

// ---- Tier-S movement: objective-control-aware destination scoring (hold / take / contest /
//      screen), reward for firepower from the spot, penalty for walking into melee threat. ----
function challengerMoveUnitS(uk) {
  const ms = state.tokens.filter(t => t.unit === uk); if (!ms.length) return null;
  const M = Math.min(...ms.map(t => (typeof t.Mv === "number" && t.Mv > 0) ? t.Mv : 6));
  const [cx, cy] = chCentroid(ms);
  const W = aiWeapons(ms), ranged = W.ranged, melee = W.melee;
  const enemies = aiUnits(2).filter(e => e.toks.length);
  const tal = wp6Tallies(), prep = losPrep(state.terrain);
  const infantry = unitHasKw(ms, KW_COVER);
  const unitOC = chUnitOC(ms);
  const cands = [{ x: cx, y: cy, why: "holds position" }];
  tal.forEach((o, i) => {   // approach each objective, normal move only (cap M)
    const dx = o.o.x - cx, dy = o.o.y - cy, d = Math.hypot(dx, dy) || 0.001;
    const step = Math.min(Math.max(0, d - 1.2), M);
    if (step > 0.2) cands.push({ x: cx + dx / d * step, y: cy + dy / d * step, obj: i, why: "→ Obj " + (i + 1) });
  });
  if (ranged.length && enemies.length) {   // shooters keep stand-off from the nearest melee threat
    let near = null, nd = Infinity;
    enemies.forEach(e => { const d = wp3UnitDist(ms, e.toks); if (d < nd) { nd = d; near = e; } });
    if (near && nd < 10) {
      const [ex, ey] = chCentroid(near.toks), d = Math.hypot(cx - ex, cy - ey) || 0.001, step = Math.min(M, Math.max(0, 12 - nd));
      if (step > 0.5) cands.push({ x: cx + (cx - ex) / d * step, y: cy + (cy - ey) / d * step, why: "keeps range on " + near.toks[0].name });
    }
  }
  if (melee.length && !ranged.length && enemies.length) {   // pure melee closes to charge range
    let near = null, nd = Infinity;
    enemies.forEach(e => { const d = wp3UnitDist(ms, e.toks); if (d < nd) { nd = d; near = e; } });
    if (near) { const [ex, ey] = chCentroid(near.toks), d = Math.hypot(ex - cx, ey - cy) || 0.001, step = Math.min(M, Math.max(0, d - 2.2)); if (step > 0.5) cands.push({ x: cx + (ex - cx) / d * step, y: cy + (ey - cy) / d * step, why: "advances on " + near.toks[0].name }); }
  }
  if (infantry) state.terrain.forEach(ter => {   // cover within a normal move
    if (!LOS_DENSE[ter.kind]) return;
    const tx2 = ter.x + ter.w / 2, ty2 = ter.y + ter.h / 2, d = Math.hypot(tx2 - cx, ty2 - cy);
    if (d > 0.3 && d <= M) cands.push({ x: tx2, y: ty2, why: "takes cover" });
  });
  challengerScreenCands(cands, { uk, ms, cx, cy, M, enemies, tal });
  cands.forEach(c => { c.x = Math.min(state.board.w - 1, Math.max(1, c.x)); c.y = Math.min(state.board.h - 1, Math.max(1, c.y)); });
  cands.forEach(c => {
    let s = 0, why2 = null, holdsObj = false;
    tal.forEach((o, i) => {
      const dd = Math.hypot(o.o.x - c.x, o.o.y - c.y), wasOn = Math.hypot(o.o.x - cx, o.o.y - cy) <= 2.8, onIt = dd <= 2.2;
      if (!onIt) {
        const dNow = Math.hypot(o.o.x - cx, o.o.y - cy), gain = dNow - dd;
        if (gain > 0.1) s += gain * CH_S.objApproach * (o.holder !== 1 ? 1 : 0.12) / Math.max(1, Math.sqrt(dNow / 14));
        return;
      }
      const oc1Without = o.oc1 - (wasOn ? unitOC : 0), oc1After = oc1Without + unitOC;
      const holderAfter = oc1After > o.oc2 ? 1 : o.oc2 > oc1After ? 2 : (o.o.sec || 0);
      if (holderAfter === 1 && o.holder !== 1) { s += CH_S.objBase + (o.holder === 2 ? CH_S.objContest : 0); why2 = `→ Obj ${i + 1} (OC ${oc1After} v ${o.oc2})`; holdsObj = true; }
      else if (holderAfter === 1) { if (oc1Without > o.oc2) { s += 1.2; why2 = `screens Obj ${i + 1}`; } else { s += CH_S.objBase * CH_S.objKeep; why2 = `holds Obj ${i + 1}`; holdsObj = true; } }
      else { s += CH_S.objContest * 0.5; why2 = `contests Obj ${i + 1} (OC ${oc1After} v ${o.oc2})`; }
    });
    const sh = aiBestShoot(c.x, c.y, ms, ranged, enemies, prep);
    s += sh * CH_S.shootW;
    if (ranged.length && enemies.length && sh === 0) {   // nothing in LoS: close toward range
      const ndTo = p => Math.min(...enemies.map(e => Math.min(...e.toks.map(t => Math.hypot(t.x - p[0], t.y - p[1])))));
      const gain = ndTo([cx, cy]) - ndTo([c.x, c.y]);
      if (gain > 0.1) s += gain * CH_S.rangeApproach;
    }
    if (infantry && state.terrain.some(t2 => LOS_DENSE[t2.kind] && geomPointInRect(c.x, c.y, t2))) s += CH_S.coverW;
    // don't overextend into open ground — but a point we can HOLD is worth eating some fire for (OC wins games)
    const threatMul = (holdsObj ? CH_S.holdThreat : CH_S.threatW) * ((ranged.length && !melee.length) ? 1.4 : 0.7);
    s -= chThreatAt(c.x, c.y, ms, enemies) * threatMul;
    if (melee.length && !ranged.length && enemies.length) {
      const nd = Math.min(...enemies.map(e => Math.min(...e.toks.map(t => Math.hypot(t.x - c.x, t.y - c.y)))));
      s += Math.max(0, 20 - nd) * CH_S.closeW;
    }
    if (c.screen) s += CH_S.screenW;
    c.s = s; if (why2) c.why = why2;
  });
  cands.sort((a, b) => b.s - a.s);
  const enemyToks = chEnemyToks();
  for (const c of cands) {
    const dx = c.x - cx, dy = c.y - cy, dist = Math.hypot(dx, dy);
    if (dist < 0.3) return { uk, unit: ms[0].name, moved: 0, why: c.why };
    const moved = challengerTranslate(ms, dx, dy, M, enemyToks, false);
    if (moved > 0.05) {
      const [ncx, ncy] = chCentroid(state.tokens.filter(t => t.unit === uk));
      return { uk, unit: ms[0].name, moved: +moved.toFixed(2), cap: M, why: c.why, fromX: +cx.toFixed(1), fromY: +cy.toFixed(1), toX: +ncx.toFixed(1), toY: +ncy.toFixed(1) };
    }
  }
  return { uk, unit: ms[0].name, moved: 0, why: "blocked" };
}
function challengerMovementS() {
  const acts = [];
  const arrivedUks = new Set();
  challengerArriveReserves(state.trackers.round, arrivedUks).forEach(a => acts.push(a));
  chUnits().forEach(u => {
    if (arrivedUks.has(u.uk)) return;   // just walked on from reserve — it already made its move
    const r = challengerMoveUnitS(u.uk); if (r) acts.push(Object.assign({ type: "move" }, r));
  });
  return acts;
}

// ---- Tier-S shooting: ARMY-COORDINATED focus fire. Greedily assign the best remaining gun to the
//      highest-priority live enemy, filling each target only to ~10% over its wounds before spilling
//      to the next — so fire REMOVES whole units instead of spreading. Real roller, casualties live. ----
function challengerShootingS() {
  const acts = [];
  const jobs = [];
  chUnits().forEach(u => {
    const ms = state.tokens.filter(t => t.unit === u.uk); if (!ms.length) return;
    const W = aiWeapons(ms); if (!W.ranged.length) return;
    const main = aiMainWeapon(W.ranged);
    W.ranged.forEach(w => jobs.push({ uk: u.uk, w, main: (w === main) }));
  });
  const committed = {}, used = new Set();
  let guard = 0;
  while (guard++ < 500) {
    const enemies = aiUnits(2).filter(e => e.toks.length);
    if (!enemies.length) break;
    let pick = null;
    for (let ji = 0; ji < jobs.length; ji++) {
      if (used.has(ji)) continue;
      const job = jobs[ji];
      const ms2 = state.tokens.filter(t => t.unit === job.uk);
      if (!ms2.length) { used.add(ji); continue; }
      const shooters = job.main ? ms2.length : 1;
      enemies.forEach(e => {
        const totW = e.toks.reduce((s, t) => s + (t.wounds || 1), 0);
        if ((committed[e.uk] || 0) >= totW * CH_S.overkill) return;   // enough fire already assigned here
        const los = losCheckUnits(job.uk, e.uk);
        if (!los || !los.vis || los.dist > job.w.rng + 0.02) return;
        const exp = aiExpDamage(job.w, shooters, e.toks, los.dist, !!los.cover);
        if (exp < 0.05) return;
        const score = chTargetPriority(e, exp);
        if (!pick || score > pick.score) pick = { ji, job, e, los, exp, shooters, score };
      });
    }
    if (!pick) break;
    used.add(pick.ji);
    const bUk = pick.e.uk, myMs = state.tokens.filter(t => t.unit === pick.job.uk);
    const myName0 = (myMs[0] || {}).name, tgtName = (state.tokens.find(t => t.unit === bUk) || {}).name;
    const beforeN = state.tokens.filter(t => t.unit === bUk).length;
    const beforeW = state.tokens.filter(t => t.unit === bUk).reduce((s, t) => s + (t.wounds || 1), 0);
    aiFireWeapon(pick.job.uk, myMs, pick.job.w, pick.shooters, pick.e, pick.los);
    committed[bUk] = (committed[bUk] || 0) + pick.exp;
    const after = state.tokens.filter(t => t.unit === bUk);
    acts.push({ type: "shoot", unit: myName0, target: tgtName, weapon: pick.job.w.n, shooters: pick.shooters,
      dist: +pick.los.dist.toFixed(1), rng: pick.job.w.rng, vis: !!pick.los.vis, cover: !!pick.los.cover,
      slain: beforeN - after.length, woundsDealt: beforeW - after.reduce((s, t) => s + (t.wounds || 1), 0) });
  }
  return acts;
}

// ---- Tier-S charges: out-trade, PLUS tie up gunlines (tag a shooty/weak-melee enemy in combat) and
//      shift objective squatters. Same 2D6 roll + strict-cap contact move ⇒ legal by construction. ----
function challengerChargeUnitS(uk) {
  const ms = state.tokens.filter(t => t.unit === uk); if (!ms.length) return null;
  if (ms.every(t => t.bs)) return null;
  const W = aiWeapons(ms); if (!W.melee.length) return null;
  let best = null;
  const mR = mmIn(40) / 2;
  aiUnits(2).forEach(e => {
    if (!e.toks.length) return;
    const d = wp3UnitDist(ms, e.toks);
    if (d > 12.02 || d <= 1.02) return;
    const los = losCheckUnits(uk, e.uk);
    if (!los || !los.vis) return;
    const exp = Math.max(...W.melee.map(w => aiExpDamage(w, ms.length, e.toks, 0, false)));
    const back = aiMeleeThreat(e.toks, ms);
    let profit = exp - back;
    const eW = aiWeapons(e.toks);
    if (eW.ranged.length && back < exp * 0.6) profit += CH_S.tagGun;   // pin a gunline that can't fight back
    if (wp6Tallies().some(x => x.holder !== 1 && e.toks.some(t => Math.hypot(t.x - x.o.x, t.y - x.o.y) - mR - tokRadius(t) <= 3.02))) profit += CH_S.onObjCharge;
    if (profit > 0 && (!best || profit > best.profit)) best = { e, d, profit };
  });
  if (!best) return null;
  const a = aiD6(), b = aiD6(), roll = a + b;
  if (roll + 1.02 < best.d) return { type: "charge", unit: ms[0].name, target: best.e.toks[0].name, need: +best.d.toFixed(1), roll, made: false };
  const [am, bm] = aiClosestPair(ms, best.e.toks);
  const need = Math.max(0, edgeDist(am, bm) - 0.15), dd = Math.hypot(bm.x - am.x, bm.y - am.y) || 1;
  const made = challengerTranslate(ms, (bm.x - am.x) / dd * need, (bm.y - am.y) / dd * need, roll, chEnemyToks(), true) > 0.01;
  return { type: "charge", unit: ms[0].name, target: best.e.toks[0].name, need: +best.d.toFixed(1), roll, made };
}
function challengerChargesS() {
  const acts = [];
  chUnits().forEach(u => { const r = challengerChargeUnitS(u.uk); if (r) acts.push(r); });
  return acts;
}

// Per-phase entry the driver calls (ph: 0..5). Returns action records for the jsonl/report.
function challengerActPhase(ph) {
  // Tier-S seam: an agent policy may short-circuit any phase.
  if (typeof global !== "undefined" && typeof global.CHALLENGER_POLICY === "function") {
    const custom = global.CHALLENGER_POLICY(challengerSnapshot(), ph, state.trackers.round);
    if (custom) return custom;
  }
  const s = chTierS();
  switch (ph) {
    case 0: return challengerCommand();                              // battle-shock — same at both tiers
    case 1: return s ? challengerMovementS() : challengerMovement();
    case 2: return s ? challengerShootingS() : challengerShooting();
    case 3: return s ? challengerChargesS() : challengerCharges();
    case 4: return challengerFights();                              // strike-best — adequate at both tiers
    default: return [];
  }
}
