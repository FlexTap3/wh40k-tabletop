// WP23 network auto-deploy + side-switch regression: run via  node harness.js wp23-tests.js
// Covers: WP17 auto-deploy verified from the NETWORK GUEST's seat (mySide=2, conn live) —
// DZ polygon index (side 2 → state.dz[1]), top-edge fallback rows, tok~ ops actually sent
// over a stubbed conn, the shared pre-battle gate (synced round/phase, so side 2 refuses at
// round 2 exactly like side 1), and the ⚡ button existing and routing mySide. Plus the WP23
// side-switch fix: a network pre-battle switch re-broadcasts cards under the new key, vacates
// the old slot and re-owns tokens; a network mid-battle switch is refused and logged; offline
// hot-seat flips (pre- and mid-battle) keep the legacy behaviour; the wp8SideClaim guest flip
// re-homes cards without touching the host's contested slot. Ends with the wp17-tests-style
// side-1 offline regression.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- helpers (as wp17-tests) ----------
  const mk = (id, owner, unit, x, y, dmm) => ({ id, owner, unit, name: unit + " model", shape: "c", dmm: dmm || 32,
    x, y, rot: 0, wounds: 2, maxW: 2, kw: ["INFANTRY"] });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const diam = t => 2 * tokRadius(t);
  const noClash = toks => {
    for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++)
      if (dist(toks[i], toks[j]) < Math.min(diam(toks[i]), diam(toks[j])) - 1e-9) return false;
    return true;
  };
  const posSig = toks => toks.map(t => t.id + ":" + t.x.toFixed(4) + "," + t.y.toFixed(4)).join("|");
  const lastLog = () => { const c = document.getElementById("log").children; return c.length ? String(c[c.length - 1].innerHTML) : ""; };

  // stub a live connection and capture everything send() pushes out
  let sent = [];
  conn = { open: true, send: m => sent.push(m) };
  const sentOps = k => sent.filter(m => m.t === "op" && m.op.k === k).map(m => m.op);

  const DZ1 = [[2, 2], [28, 2], [28, 12], [2, 12]];   // side 1 zone (dz[0])
  const DZ2 = [[2, 32], [28, 32], [28, 42], [2, 42]]; // side 2 zone (dz[1])
  const reset = () => {
    state.tokens.length = 0; state.terrain.length = 0; state.objectives.length = 0;
    state.board = { w: 60, h: 44 };
    state.trackers.round = 1;
    state.phase = { side: 1, ph: -1, cpDone: {} };
    state.dz = [DZ1, DZ2];
    state.cards = { 1: [], 2: [] };
    sent = [];
  };

  // ---------- 1: guest (side 2) DZ deploy uses state.dz[1] ----------
  reset(); mySide = 2;
  for (let i = 0; i < 5; i++) state.tokens.push(mk("g" + i, 2, "gu1", 40 + i, 4)); // guest unit far from its DZ
  for (let i = 0; i < 3; i++) state.tokens.push(mk("h" + i, 2, "gu2", 48 + i, 4));
  const foe = mk("f0", 1, "fu", 10, 36); state.tokens.push(foe);                    // side-1 token parked INSIDE DZ2
  aiSeed(42);
  wp17DeploySide(2);
  const guestToks = state.tokens.filter(t => t.owner === 2);
  assert(guestToks.every(t => wp7PtInPoly(t.x, t.y, DZ2)), "side 2: every own token inside dz[1] (the side-2 poly)");
  assert(guestToks.every(t => !wp7PtInPoly(t.x, t.y, DZ1)), "side 2: no own token ended up in the side-1 poly");
  assert(noClash(guestToks), "side 2: no own-token overlaps");
  assert(foe.x === 10 && foe.y === 36, "side 2: the side-1 token is untouched");

  // ---------- 2: the ops went OUT over the live conn ----------
  const movedIds = new Set(); sentOps("tok~").forEach(o => o.toks.forEach(u => movedIds.add(u.id)));
  assert(guestToks.every(t => movedIds.has(t.id)), "network: every placed token id was sent in a tok~ op (nothing host-only)");
  assert(sent.every(m => m.t === "op" || m.t === "log"), "network: only op/log frames emitted by the deploy");

  // ---------- 3: side-2 edge fallback packs the TOP half ----------
  reset(); mySide = 2;
  for (let i = 0; i < 5; i++) state.tokens.push(mk("g" + i, 2, "gu1", 30 + i, 22));
  state.tokens.push(mk("f0", 1, "fu", 10, 40));
  state.dz = []; // no layout
  aiSeed(7);
  wp17DeploySide(2);
  const top = state.tokens.filter(t => t.owner === 2);
  assert(top.every(t => t.y < state.board.h / 2), "fallback: side 2 rows along the TOP half");
  assert(top.every(t => { const r = tokRadius(t);
    return t.x - r >= 1 - 1e-6 && t.x + r <= state.board.w - 1 + 1e-6 && t.y - r >= 1 - 1e-6; }),
    "fallback: side 2 keeps the 1\" board margin");
  assert(noClash(top), "fallback: side 2 no overlaps");
  assert(state.tokens.find(t => t.id === "f0").y === 40, "fallback: side-1 token untouched");

  // ---------- 4: gate agreement — synced state, so side 2 refuses too ----------
  reset(); mySide = 2;
  for (let i = 0; i < 3; i++) state.tokens.push(mk("g" + i, 2, "gu1", 30 + i, 22));
  state.trackers.round = 2;                        // trackers are synced — both clients see round 2
  assert(wp17PreBattle() === false, "gate reads synced trackers.round — false at round 2 regardless of side");
  let frozen = posSig(state.tokens);
  wp17AutoDeploy();
  assert(posSig(state.tokens) === frozen, "round 2: side-2 ⚡ Auto-deploy refuses — tokens unmoved");
  state.trackers.round = 1; state.phase = { side: 2, ph: 3, cpDone: {} }; // synced phase engine under way
  assert(wp17PreBattle() === false, "gate reads synced state.phase — false once the battle started");
  wp17AutoDeploy();
  assert(posSig(state.tokens) === frozen, "battle under way: side-2 ⚡ Auto-deploy refuses — tokens unmoved");

  // ---------- 5: ⚡ button exists in the Army tab and routes mySide ----------
  assert(html.includes('onclick="wp17AutoDeploy()"'), "⚡ Auto-deploy button is wired to wp17AutoDeploy in the (shared) Army tab HTML");
  assert(typeof wp17AutoDeploy === "function", "wp17AutoDeploy handler exists");
  state.phase = { side: 1, ph: -1, cpDone: {} }; state.dz = [DZ1, DZ2];
  aiSeed(9);
  wp17AutoDeploy();                                // mySide is still 2 → must deploy into DZ2
  assert(state.tokens.filter(t => t.owner === 2).every(t => wp7PtInPoly(t.x, t.y, DZ2)),
    "⚡ button routes mySide: as side 2 it deploys my units into dz[1]");

  // ---------- 6: side-switch — network, pre-battle: cards + tokens re-home ----------
  reset(); mySide = 1;
  myArmy = [{ name: "Testers", profiles: [{ n: "Tester", count: 2, base: "32mm", W: 2 }] }];
  for (let i = 0; i < 2; i++) state.tokens.push(mk("m" + i, 1, "mu", 10 + i, 40)); // my mustered tokens
  broadcastCards();
  assert(state.cards[1].length === 1 && state.cards[2].length === 0, "repro: after muster as side 1 my cards sit under key 1");
  sent = [];
  setSide(2);
  assert(mySide === 2, "pre-battle network switch: mySide updated");
  assert(state.tokens.filter(t => t.id[0] === "m").every(t => t.owner === 2), "pre-battle network switch: my tokens re-owned to side 2");
  assert(state.cards[2].length === 1 && state.cards[1].length === 0, "pre-battle network switch: cards now under key 2, old slot vacated");
  assert(sentOps("cards").some(o => o.owner === 2 && o.cards.length === 1), "pre-battle network switch: cards op sent under the NEW key");
  assert(sentOps("cards").some(o => o.owner === 1 && o.cards.length === 0), "pre-battle network switch: empty cards op sent to clear the OLD key");
  assert(sentOps("tok~").some(o => o.toks.every(u => u.owner === 2)), "pre-battle network switch: tok~ owner re-own op sent to the peer");
  assert(sentOps("name").some(o => o.side === 2), "pre-battle network switch: name op sent for the new side");

  // ---------- 7: side-switch — network, mid-battle: refused + logged ----------
  state.trackers.round = 2;
  document.getElementById("mySide").value = "1"; // the user just picked the other side in the selector
  frozen = posSig(state.tokens);
  const cardsBefore = JSON.stringify(state.cards);
  sent = [];
  setSide(1);
  assert(mySide === 2, "mid-battle network switch: refused — mySide unchanged");
  assert(document.getElementById("mySide").value === "2", "mid-battle network switch: selector snapped back");
  assert(posSig(state.tokens) === frozen && JSON.stringify(state.cards) === cardsBefore, "mid-battle network switch: tokens and cards untouched");
  assert(sent.length === 0, "mid-battle network switch: nothing sent to the peer");
  assert(lastLog().indexOf("setup only") >= 0, "mid-battle network switch: refusal logged");

  // ---------- 8: offline hot-seat flips keep the legacy behaviour ----------
  conn = null;
  setSide(1);                                       // still round 2 — but offline the flip is the hot-seat toggle
  assert(mySide === 1, "offline mid-game flip still works (hot-seat toggle preserved)");
  state.trackers.round = 1; state.phase = { side: 1, ph: -1, cpDone: {} };
  state.cards = { 1: [{ name: "Testers" }], 2: [] };
  state.tokens.forEach(t => { if (t.id[0] === "m") t.owner = 1; });
  setSide(2);                                       // offline pre-battle: this is how the SECOND hot-seat army gets mustered
  assert(mySide === 2, "offline pre-battle flip: mySide updated");
  assert(state.tokens.filter(t => t.id[0] === "m").every(t => t.owner === 1), "offline pre-battle flip: tokens NOT re-owned (hot-seat muster flow intact)");
  assert(state.cards[1].length === 1 && state.cards[2].length === 0, "offline pre-battle flip: cards untouched (hot-seat)");

  // ---------- 9: wp8SideClaim guest flip re-homes cards, host slot untouched ----------
  conn = { open: true, send: m => sent.push(m) };
  isHost = false; mySide = 1; sent = [];
  state.cards = { 1: [{ name: "HostCard" }], 2: [] }; // the contested slot holds the HOST's cards after full-state sync
  const rt = global.setTimeout; global.setTimeout = f => f(); // run the post-sync callback inline
  wp8SideClaim({ side: 1, name: "Host" });
  global.setTimeout = rt;
  assert(mySide === 2, "wp8SideClaim: guest flipped off the contested side");
  assert(sentOps("cards").some(o => o.owner === 2 && o.cards.length === 1), "wp8SideClaim: guest re-broadcast its cards under the new side");
  assert(!sentOps("cards").some(o => o.owner === 1), "wp8SideClaim: the contested (host's) card slot was NOT cleared");
  assert(state.cards[1].length === 1, "wp8SideClaim: host cards still under key 1 locally");

  // ---------- 10: regression — side-1 offline deploy identical to wp17 expectations ----------
  conn = null; reset(); mySide = 1;
  for (let i = 0; i < 5; i++) state.tokens.push(mk("a" + i, 1, "u1", 40 + i, 40));
  for (let i = 0; i < 3; i++) state.tokens.push(mk("b" + i, 1, "u2", 48 + i, 40));
  const enemy = mk("e0", 2, "eu", 10, 6); state.tokens.push(enemy);
  aiSeed(42);
  wp17DeploySide(1);
  const own = state.tokens.filter(t => t.owner === 1);
  assert(own.every(t => wp7PtInPoly(t.x, t.y, DZ1)), "regression: side-1 offline deploy — every own token inside dz[0]");
  assert(noClash(own), "regression: side-1 offline deploy — no overlaps");
  assert(enemy.x === 10 && enemy.y === 6, "regression: side-1 offline deploy — enemy untouched");
  state.dz = [];
  aiSeed(7);
  wp17DeploySide(1);
  assert(state.tokens.filter(t => t.owner === 1).every(t => t.y > state.board.h / 2), "regression: side-1 fallback still packs the BOTTOM half");

  console.log(failed ? "WP23 TESTS: " + failed + " FAILURES" : "WP23 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
