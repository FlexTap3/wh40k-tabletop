// WP17 player auto-deploy regression: run via  node harness.js wp17-tests.js
// Covers: wp17DeploySide places every own token strictly inside the side's DZ poly
// with no overlaps and leaves the enemy untouched; unitIds scoping only moves the
// listed units; the no-DZ fallback packs deterministic tidy rows on the deployer's
// half of the board; the ⚡ Auto-deploy button's pre-battle gate refuses at round 2
// and once the phase engine has started.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- helpers ----------
  const mk = (id, owner, unit, x, y, dmm) => ({ id, owner, unit, name: unit + " model", shape: "c", dmm: dmm || 32,
    x, y, rot: 0, wounds: 2, maxW: 2, kw: ["INFANTRY"] });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const diam = t => 2 * tokRadius(t);
  const noClash = toks => { // approximate overlap check: centres at least the smaller diameter apart
    for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++)
      if (dist(toks[i], toks[j]) < Math.min(diam(toks[i]), diam(toks[j])) - 1e-9) return false;
    return true;
  };
  const posSig = toks => toks.map(t => t.id + ":" + t.x.toFixed(4) + "," + t.y.toFixed(4)).join("|");

  // ---------- shared setup: clean board, pre-battle ----------
  state.tokens.length = 0; state.terrain.length = 0; state.objectives.length = 0;
  state.board = { w: 60, h: 44 };
  state.trackers.round = 1;
  state.phase = { side: 1, ph: -1, cpDone: {} };
  mySide = 1;
  const DZ1 = [[2, 2], [28, 2], [28, 12], [2, 12]]; // seeded rectangular side-1 DZ
  const DZ2 = [[2, 32], [28, 32], [28, 42], [2, 42]];
  state.dz = [DZ1, DZ2];
  for (let i = 0; i < 5; i++) state.tokens.push(mk("a" + i, 1, "u1", 40 + i, 40)); // 5-model unit, far from the DZ
  for (let i = 0; i < 3; i++) state.tokens.push(mk("b" + i, 1, "u2", 48 + i, 40)); // 3-model unit
  const enemy = mk("e0", 2, "eu", 10, 6); // enemy token parked INSIDE the side-1 DZ
  state.tokens.push(enemy);

  // ---------- 1: DZ placement ----------
  aiSeed(42);
  wp17DeploySide(1);
  const own = state.tokens.filter(t => t.owner === 1);
  assert(own.length === 8, "setup sane: 8 own tokens on the table");
  assert(own.every(t => wp7PtInPoly(t.x, t.y, DZ1)), "every own token strictly inside the side-1 DZ poly");
  assert(noClash(own), "no two own tokens closer than the smaller of their diameters");
  assert(enemy.x === 10 && enemy.y === 6, "enemy token untouched");

  // ---------- 2: unitIds scoping ----------
  const u2Before = posSig(state.tokens.filter(t => t.unit === "u2"));
  state.tokens.filter(t => t.unit === "u1").forEach((t, i) => { t.x = 50; t.y = 30 + i; }); // scatter u1 out of the DZ
  aiSeed(43);
  wp17DeploySide(1, ["u1"]);
  assert(state.tokens.filter(t => t.unit === "u1").every(t => wp7PtInPoly(t.x, t.y, DZ1)), "scoped: listed unit re-placed inside the DZ");
  assert(posSig(state.tokens.filter(t => t.unit === "u2")) === u2Before, "scoped: unlisted own unit untouched");
  assert(noClash(state.tokens.filter(t => t.owner === 1)), "scoped: still no own-token overlaps");

  // ---------- 3: no-DZ fallback (deterministic edge rows) ----------
  state.dz = []; // no layout loaded
  aiSeed(7);
  wp17DeploySide(1);
  const own1 = state.tokens.filter(t => t.owner === 1);
  assert(own1.every(t => { const r = tokRadius(t);
    return t.x - r >= 1 - 1e-6 && t.x + r <= state.board.w - 1 + 1e-6 && t.y - r >= 1 - 1e-6 && t.y + r <= state.board.h - 1 + 1e-6; }),
    "fallback: every token fully on the board with a 1\" margin");
  assert(own1.every(t => t.y > state.board.h / 2), "fallback: side 1 packs along the BOTTOM half");
  assert(noClash(own1), "fallback: no overlaps between fallback-placed units");
  const run1 = posSig(own1.slice().sort((a, b) => a.id < b.id ? -1 : 1));
  own1.forEach((t, i) => { t.x = 30; t.y = 22 + i * 0.01; }); // scatter, then re-run from the same seed
  aiSeed(7);
  wp17DeploySide(1);
  const run2 = posSig(state.tokens.filter(t => t.owner === 1).slice().sort((a, b) => a.id < b.id ? -1 : 1));
  assert(run1 === run2, "fallback: deterministic — identical formation across two runs from the same aiSeed");
  // side 2 packs the top half
  wp17DeploySide(2);
  assert(state.tokens.filter(t => t.owner === 2).every(t => t.y < state.board.h / 2), "fallback: side 2 packs along the TOP half");

  // ---------- 4: pre-battle gate on the ⚡ button ----------
  state.trackers.round = 2;
  const frozen = posSig(state.tokens);
  wp17AutoDeploy();
  assert(posSig(state.tokens) === frozen, "round 2: ⚡ Auto-deploy refuses — tokens unmoved");
  state.trackers.round = 1;
  state.phase = { side: 1, ph: 2, cpDone: {} }; // battle under way in round 1
  wp17AutoDeploy();
  assert(posSig(state.tokens) === frozen, "phase engine started: ⚡ Auto-deploy refuses — tokens unmoved");
  state.phase = { side: 1, ph: -1, cpDone: {} }; // back to Deploy → allowed again
  state.tokens.filter(t => t.owner === 1).forEach((t, i) => { t.x = 30 + i * 0.01; t.y = 22; }); // scatter mid-board
  aiSeed(9);
  wp17AutoDeploy();
  assert(state.tokens.filter(t => t.owner === 1).every(t => t.y > state.board.h / 2),
    "back at Deploy: ⚡ Auto-deploy runs again (scattered units re-packed on my half)");

  console.log(failed ? "WP17 TESTS: " + failed + " FAILURES" : "WP17 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
