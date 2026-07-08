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
  mySide = prevSide; myName = prevName;
  return { list, pts: list.reduce((s, u) => s + u.pts, 0), units: chUnits().length };
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

// Per-phase entry the driver calls (ph: 0..5). Returns action records for the jsonl/report.
function challengerActPhase(ph) {
  // Tier-S seam: an agent policy may short-circuit any phase.
  if (typeof global !== "undefined" && typeof global.CHALLENGER_POLICY === "function") {
    const custom = global.CHALLENGER_POLICY(challengerSnapshot(), ph, state.trackers.round);
    if (custom) return custom;
  }
  switch (ph) {
    case 0: return challengerCommand();
    case 1: return challengerMovement();
    case 2: return challengerShooting();
    case 3: return challengerCharges();
    case 4: return challengerFights();
    default: return [];
  }
}
