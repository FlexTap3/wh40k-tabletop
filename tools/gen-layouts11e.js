#!/usr/bin/env node
// Deterministic generator of 11th-edition 16-piece terrain footprints for the wh40k-tabletop app.
// Reads the current layouts40k-data JSON out of the HTML, keeps o/dz/m/name for every
// "Official *" layout, replaces its `t` array with a fresh symmetric 16-piece footprint set.
// "Custom *" layouts are passed through unchanged.

const fs = require("fs");
const path = require("path");

const HTML_PATH = "/Users/paulstadick/dev/PNT/WH40k/Tabletop/wh40k-tabletop.html";
const OUT_JSON = path.join(__dirname, "layouts11e.json");

const BOARD_W = 60, BOARD_H = 44;
const CENTER = { x: 30, y: 22 };

// ---------- deterministic RNG (seeded from layout name) ----------
function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(name) {
  return mulberry32(hashStr(name));
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function jitter(rng, span) { return (rng() * 2 - 1) * span; }

// ---------- bounding box for a (possibly rotated) axis-aligned-declared piece ----------
// x,y is the UNROTATED top-left corner; rotation happens about the piece CENTER.
// For rot in {0,90,180,270} the rotated bbox is simple: for 90/270 the box becomes h x w,
// still centered on the same center point.
function centerOf(p) {
  return { cx: p.x + p.w / 2, cy: p.y + p.h / 2 };
}
function rotatedExtent(p) {
  // normalize rot to 0/90 (mirror symmetric enough for our axis-aligned placements)
  const r = ((p.rot % 180) + 180) % 180;
  if (r === 90) return { ew: p.h, eh: p.w };
  return { ew: p.w, eh: p.h };
}
function bboxOf(p) {
  const { cx, cy } = centerOf(p);
  const { ew, eh } = rotatedExtent(p);
  return { minX: cx - ew / 2, maxX: cx + ew / 2, minY: cy - eh / 2, maxY: cy + eh / 2, cx, cy, ew, eh };
}
function inBounds(p) {
  const b = bboxOf(p);
  return b.minX >= -1e-6 && b.maxX <= BOARD_W + 1e-6 && b.minY >= -1e-6 && b.maxY <= BOARD_H + 1e-6;
}
function overlapArea(a, b) {
  const A = bboxOf(a), B = bboxOf(b);
  const ox = Math.max(0, Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX));
  const oy = Math.max(0, Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY));
  return ox * oy;
}
function heavyOverlap(a, b) {
  const ov = overlapArea(a, b);
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return ov > smaller * 0.35; // allow small touches, reject heavy overlap
}
// mirror a piece 180 degrees about board center -> new top-left corner + same w/h, rot+180
function mirrorPiece(p) {
  const { cx, cy } = centerOf(p);
  const mcx = 2 * CENTER.x - cx, mcy = 2 * CENTER.y - cy;
  const rot = ((p.rot || 0) + 180) % 360;
  return { ...p, x: mcx - p.w / 2, y: mcy - p.h / 2, rot };
}

// clamp a bbox fully inside the board by nudging center (used post-hoc as safety net)
function clampToBoard(p) {
  const { ew, eh } = rotatedExtent(p);
  let { cx, cy } = centerOf(p);
  cx = Math.min(Math.max(cx, ew / 2), BOARD_W - ew / 2);
  cy = Math.min(Math.max(cy, eh / 2), BOARD_H - eh / 2);
  return { ...p, x: cx - p.w / 2, y: cy - p.h / 2 };
}

// nudge a piece away from an objective point if the point sits deep inside its footprint,
// specifically for solid-corner triangle pieces (avoid burying an objective under the
// triangle's filled corner).
function distPointToRectCenter(pt, p) {
  const b = bboxOf(p);
  return Math.hypot(pt[0] - b.cx, pt[1] - b.cy);
}
function pointDeepInside(pt, p, marginFrac) {
  const b = bboxOf(p);
  const mx = b.ew * marginFrac, my = b.eh * marginFrac;
  return pt[0] > b.minX + mx && pt[0] < b.maxX - mx && pt[1] > b.minY + my && pt[1] < b.maxY - my;
}

// ---------- piece templates (11th-ed 16-piece set, one half; mirror gives the other half) ----------
// We build 8 "seed" pieces in one half of the board (roughly x in [0,30]-ish region, but they
// can range full board since symmetry is about center) and mirror each to get 16 total.
//   2 triangle (1 seed -> mirrored partner)
//   4 large rect (2 seeds -> mirrored partners)
//   4 medium rect/crate (2 seeds -> mirrored partners)
//   2 long wall (1 seed -> mirrored partner)
//   4 short wall (2 seeds -> mirrored partners)
// total seeds = 1+2+2+1+2 = 8 -> mirrored = 16. Good.

function buildLayoutTerrain(name, objectives) {
  const rng = makeRng(name);
  const pieces = [];
  const pairIdx = []; // list of [i,j] index pairs into `pieces` that are 180-mirrors of each other
  let idCounter = 0;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const nextId = () => `${slug}-t${idCounter++}`;

  // overlapScore: sum of overlap-ratio (vs the smaller piece's area) across all already-placed
  // pieces AND their would-be mirror, so both halves of the board are considered at once.
  function overlapScore(clamped) {
    const mirror = mirrorPiece(clamped);
    let score = 0;
    for (const ex of pieces) {
      score += overlapArea(clamped, ex) / Math.min(clamped.w * clamped.h, ex.w * ex.h);
      score += overlapArea(mirror, ex) / Math.min(mirror.w * mirror.h, ex.w * ex.h);
    }
    score += overlapArea(clamped, mirror) / Math.min(clamped.w * clamped.h, mirror.w * mirror.h);
    return score;
  }
  // bestPlace: try many candidates from candidateFn(i), scoring each by total overlap against
  // everything placed so far (+ its own mirror). Returns the lowest-overlap in-bounds candidate
  // found; exits early on a perfect (score===0) candidate. NEVER silently falls back to an
  // unchecked position — worst case it returns the least-bad of everything it tried.
  function bestPlace(candidateFn, maxTries) {
    let best = null, bestScore = Infinity;
    for (let i = 0; i < maxTries; i++) {
      const cand = candidateFn(i);
      if (!cand) continue;
      const clamped = clampToBoard(cand);
      if (!inBounds(clamped)) continue;
      const score = overlapScore(clamped);
      if (score < bestScore) { bestScore = score; best = clamped; }
      if (bestScore <= 1e-9) break; // perfect placement found
    }
    return { piece: best, score: bestScore };
  }

  function addSymmetricPair(base, kind, extra) {
    const piece = { id: nextId(), kind, x: base.x, y: base.y, w: base.w, h: base.h, rot: base.rot || 0, ...extra };
    const mirror = { ...mirrorPiece(piece), id: nextId() };
    const i = pieces.length;
    pieces.push(piece, mirror);
    pairIdx.push([i, i + 1]);
    return [piece, mirror];
  }

  // --- 1. Triangles: centerpiece near board center, mirrored so hypotenuses face each other.
  // tc pairs whose hypotenuses face each other across the center when 180-mirrored:
  // tc 1 (right-angle top-right) mirrors to tc 3 (bottom-left) under our mirrorPiece (rot+180
  // doesn't change tc though -- tc is a static shape index, not rotated). We must choose tc
  // for the mirror piece explicitly so the visual hypotenuse actually faces inward.
  // tc semantics: 0=TL,1=TR,2=BR,3=BL right angle corner; hypotenuse is the opposite edge.
  // If piece A has tc=1 (right angle TR, hypotenuse runs BL), and sits left-of-center,
  // its hypotenuse (bottom-left facing) already faces toward center-right if the piece
  // is left of center... simplest robust approach: pick tcA, and set tcB = (tcA+2)%4 for the
  // mirrored copy (opposite corner), which after 180 positional mirroring makes the two
  // hypotenuses face each other.
  {
    const tW = 8, tH = 11.5;
    const tcA = pick(rng, [0, 1, 2, 3]);
    const tcB = (tcA + 2) % 4;
    const offX = 6 + rng() * 3; // how far off-center along x
    const offY = jitter(rng, 4);
    let base = {
      x: CENTER.x - offX - tW / 2 + jitter(rng, 1),
      y: CENTER.y + offY - tH / 2,
      w: tW, h: tH, rot: 0,
    };
    base = clampToBoard(base);
    const pA = { id: nextId(), kind: "ruin", x: base.x, y: base.y, w: tW, h: tH, rot: 0, shape: "tri", tc: tcA };
    const mB = mirrorPiece(pA);
    const pB = { id: nextId(), kind: "ruin", x: mB.x, y: mB.y, w: tW, h: tH, rot: mB.rot, shape: "tri", tc: tcB };
    const i = pieces.length;
    pieces.push(pA, pB);
    pairIdx.push([i, i + 1]);
  }

  // Two-stage placement: (1) local jitter around a design-intent seed point (keeps the
  // "workhorses in quadrants / lines mid-field / satellites near flanks" composition), then
  // (2) if that still has any heavy overlap, a broad randomized-zone search across a wider
  // box. Whichever stage yields the lower overlap score wins. Never silently falls back to
  // an unchecked position.
  const overlapWarnings = [];
  function resolvePlacement(w, h, rot, localCx, localCy, localJitter, localTries, zone, zoneTries, label) {
    const local = bestPlace((i) => ({
      x: localCx + jitter(rng, localJitter) - w / 2,
      y: localCy + jitter(rng, localJitter) - h / 2,
      w, h, rot,
    }), localTries);
    let winner = local;
    if (local.score > 1e-9) {
      const wide = bestPlace((i) => ({
        x: zone.xMin + rng() * (zone.xMax - zone.xMin) - w / 2,
        y: zone.yMin + rng() * (zone.yMax - zone.yMin) - h / 2,
        w, h, rot,
      }), zoneTries);
      if (wide.piece && wide.score < winner.score) winner = wide;
    }
    if (winner.score > 1e-9) overlapWarnings.push({ label, score: winner.score });
    return winner.piece;
  }

  // --- 2. Large rectangle buildings x4 (2 mirrored pairs), spread across mid-field quadrants.
  {
    const lW = 7, lH = 11.5;
    const quadrantSeeds = [
      { qx: 0.30 + rng() * 0.12, qy: 0.20 + rng() * 0.10 }, // upper-ish, left-ish of center
      { qx: 0.12 + rng() * 0.10, qy: 0.55 + rng() * 0.15 }, // lower-left flank
    ];
    for (const q of quadrantSeeds) {
      const rot = pick(rng, [0, 90]);
      const cx = q.qx * BOARD_W, cy = q.qy * BOARD_H;
      const finalP = resolvePlacement(
        lW, lH, rot, cx, cy, 3, 40,
        { xMin: Math.max(lW, cx - 10), xMax: Math.min(BOARD_W - lW, cx + 10), yMin: Math.max(lH, cy - 10), yMax: Math.min(BOARD_H - lH, cy + 10) },
        150, "large"
      );
      addSymmetricPair(finalP, "ruin", {});
    }
  }

  // --- 3. Medium rectangle buildings x4 (2 mirrored pairs); may be crate obstacles; near flanks.
  {
    const mW = 6, mH = 4;
    const seedsSpec = [
      { qx: 0.06 + rng() * 0.08, qy: 0.10 + rng() * 0.10, asCrate: rng() < 0.5 },
      { qx: 0.34 + rng() * 0.10, qy: 0.85 + rng() * 0.08, asCrate: rng() < 0.5 },
    ];
    for (const s of seedsSpec) {
      const rot = pick(rng, [0, 90]);
      const cx = s.qx * BOARD_W, cy = s.qy * BOARD_H;
      const finalP = resolvePlacement(
        mW, mH, rot, cx, cy, 4, 40,
        { xMin: Math.max(mW, cx - 12), xMax: Math.min(BOARD_W - mW, cx + 12), yMin: Math.max(mH, cy - 12), yMax: Math.min(BOARD_H - mH, cy + 12) },
        150, "medium"
      );
      addSymmetricPair(finalP, s.asCrate ? "crate" : "ruin", {});
    }
  }

  // --- 4. Long defence lines x2 (1 mirrored pair), mid-field LoS blockers.
  {
    const lW = 10, lH = 2.5;
    const rot = pick(rng, [0, 90]);
    const cx = CENTER.x + jitter(rng, 10);
    const cy = CENTER.y + jitter(rng, 8);
    const finalP = resolvePlacement(
      lW, lH, rot, cx, cy, 4, 40,
      { xMin: lW / 2 + 1, xMax: BOARD_W - lW / 2 - 1, yMin: lH / 2 + 1, yMax: BOARD_H - lH / 2 - 1 },
      250, "long-line"
    );
    addSymmetricPair(finalP, "wall", {});
  }

  // --- 5. Short defence lines x4 (2 mirrored pairs), near flanks/objectives.
  {
    const sW = 6, sH = 2;
    const seedsSpec = [
      { qx: 0.14 + rng() * 0.10, qy: 0.35 + rng() * 0.15 },
      { qx: 0.42 + rng() * 0.10, qy: 0.60 + rng() * 0.15 },
    ];
    for (const s of seedsSpec) {
      const rot = pick(rng, [0, 90]);
      const cx = s.qx * BOARD_W, cy = s.qy * BOARD_H;
      const finalP = resolvePlacement(
        sW, sH, rot, cx, cy, 5, 40,
        { xMin: Math.max(sW, cx - 14), xMax: Math.min(BOARD_W - sW, cx + 14), yMin: Math.max(sH, cy - 14), yMax: Math.min(BOARD_H - sH, cy + 14) },
        200, "short-line"
      );
      addSymmetricPair(finalP, "wall", {});
    }
  }

  // --- 6. Objective-clash nudge: don't bury an objective fully under a triangle's solid corner.
  // Nudges are applied per mirror-PAIR so 180-symmetry is preserved exactly: whichever pair
  // member clashes gets pushed away from ITS clashing objective, then the partner is recomputed
  // as the exact 180-mirror of the nudged member (never left at its stale pre-nudge position).
  // resolveNudge: search a fan of push directions/magnitudes away from the clashing objective,
  // scored by (a) clearing the objective clash and (b) minimizing overlap against every OTHER
  // already-placed piece (excluding this pair's own two members, since the partner gets
  // re-derived as an exact mirror afterward anyway). Never silently ignores collisions.
  function resolveNudge(p, obj, othersExcludingPair) {
    const b0 = bboxOf(p);
    const dx0 = b0.cx - obj[0], dy0 = b0.cy - obj[1];
    const mag0 = Math.hypot(dx0, dy0) || 1;
    const baseAngle = Math.atan2(dy0, mag0 === 0 ? 1 : dx0);
    let best = null, bestScore = Infinity;
    const angleOffsets = [0, -15, 15, -30, 30, -45, 45];
    const magnitudes = [3, 4, 5, 6, 8, 10, 12];
    for (const ang of angleOffsets) {
      const theta = Math.atan2(dy0, dx0) + (ang * Math.PI) / 180;
      for (const mag of magnitudes) {
        const cand = clampToBoard({ ...p, x: p.x + Math.cos(theta) * mag, y: p.y + Math.sin(theta) * mag });
        if (pointDeepInside(obj, cand, 0.28)) continue; // still clashes the objective, reject
        let score = 0;
        for (const ex of othersExcludingPair) {
          score += overlapArea(cand, ex) / Math.min(cand.w * cand.h, ex.w * ex.h);
        }
        if (score < bestScore) { bestScore = score; best = cand; }
        if (bestScore <= 1e-9) break;
      }
      if (bestScore <= 1e-9) break;
    }
    return best || clampToBoard({ ...p, x: p.x + dx0 / mag0 * 4, y: p.y + dy0 / mag0 * 4 });
  }

  const nudgeLog = [];
  for (const [i, j] of pairIdx) {
    if (pieces[i].shape !== "tri" && pieces[j].shape !== "tri") continue;
    const touched = { [i]: false, [j]: false };
    for (const idx of [i, j]) {
      const p = pieces[idx];
      if (p.shape !== "tri") continue;
      for (const obj of objectives || []) {
        if (pointDeepInside(obj, p, 0.28)) {
          const others = pieces.filter((_, k) => k !== i && k !== j);
          const moved = resolveNudge(p, obj, others);
          pieces[idx] = { ...p, x: moved.x, y: moved.y };
          nudgeLog.push({ name, obj, pieceId: p.id });
          touched[idx] = true;
        }
      }
    }
    // Re-derive whichever member did NOT get a direct nudge as the exact 180-mirror of the
    // member that did, guaranteeing exact positional symmetry. If neither or both moved,
    // no correction is needed (both-moved case: objectives that trigger this are themselves
    // 180-symmetric, so independent symmetric pushes already land as exact mirrors).
    if (touched[i] && !touched[j]) {
      const mirrored = mirrorPiece(pieces[i]);
      pieces[j] = { ...pieces[j], x: mirrored.x, y: mirrored.y, rot: mirrored.rot };
    } else if (touched[j] && !touched[i]) {
      const mirrored = mirrorPiece(pieces[j]);
      pieces[i] = { ...pieces[i], x: mirrored.x, y: mirrored.y, rot: mirrored.rot };
    }
  }

  // Final post-nudge sweep: the objective-clash nudge (step 6) can reintroduce overlap that
  // didn't exist at placement time, since it moves a triangle after everything else was
  // already settled. Catch and report any such residual heavy overlap here.
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      if (heavyOverlap(pieces[a], pieces[b])) {
        overlapWarnings.push({ label: `post-nudge ${pieces[a].id} vs ${pieces[b].id}`, score: overlapArea(pieces[a], pieces[b]) / Math.min(pieces[a].w * pieces[a].h, pieces[b].w * pieces[b].h) });
      }
    }
  }

  return { pieces, nudgeLog, overlapWarnings };
}

// ---------- main ----------
function main() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const marker = '<script id="layouts40k-data" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("layouts40k-data marker not found");
  const jsonStart = start + marker.length;
  const end = html.indexOf("</script>", jsonStart);
  const jsonStr = html.slice(jsonStart, end);
  const original = JSON.parse(jsonStr);

  const output = {};
  let regenCount = 0;
  const allNudges = [];
  const allOverlapWarnings = [];

  for (const [name, layout] of Object.entries(original)) {
    if (!name.startsWith("Official ")) {
      // Custom * (or anything else): pass through unchanged.
      output[name] = layout;
      continue;
    }
    const { pieces, nudgeLog, overlapWarnings } = buildLayoutTerrain(name, layout.o || []);
    allNudges.push(...nudgeLog);
    for (const w of overlapWarnings) allOverlapWarnings.push({ name, ...w });
    output[name] = {
      t: pieces,
      o: layout.o,
      dz: layout.dz,
      m: layout.m,
    };
    regenCount++;
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(output));
  console.log(`Regenerated ${regenCount} Official layouts; passed through ${Object.keys(original).length - regenCount} Custom layouts.`);
  console.log(`Total layouts written: ${Object.keys(output).length}`);
  console.log(`Output: ${OUT_JSON}`);
  if (allNudges.length) {
    console.log(`Objective-clash nudges applied (${allNudges.length}):`);
    for (const n of allNudges) console.log(`  - ${n.name}: piece ${n.pieceId} nudged away from objective [${n.obj}]`);
  } else {
    console.log("No objective-clash nudges were needed.");
  }
  if (allOverlapWarnings.length) {
    console.log(`WARNING: ${allOverlapWarnings.length} residual heavy-overlap placement(s) (best-effort could not fully clear):`);
    for (const w of allOverlapWarnings) console.log(`  - [${w.name}] ${w.label}: overlap score ${w.score.toFixed(3)}`);
  } else {
    console.log("No heavy overlaps in any layout (all placements clean).");
  }
}

main();
