// WP16 quality-of-life regression: run via  node harness.js wp16-tests.js
// Covers: wp16CycleSec cycles an objective's Secured 0→1→2→0 through applyOp (shared
// by the WP6 right-click handler and the new touch long-press branch), wp16AfterRoll
// gating (staged label + target required, final>0 required, solo stands down),
// the one-tap apply-damage button (wounded-first allocation via aiApplyCasualties,
// total wounds drop by exactly min(final, available), dead tokens removed, mortals
// become 1-damage packets, second click is a no-op), stale-button invalidation via
// wp16Hide, and the desktop-DOM-untouched snapshot.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- desktop snapshot baseline (same trick as wp12/wp13-tests) ----------
  const topbarEl = document.getElementById("topbar"), sideEl = document.getElementById("side");
  const snap = () => [
    topbarEl.innerHTML, topbarEl.children.length,
    sideEl.innerHTML, sideEl.children.length,
  ].join("|");
  const baseline = snap();
  document.body = document.body || { children: [], appendChild(c) { this.children.push(c); } };

  const unitWounds = uk => state.tokens.filter(t => t.unit === uk).reduce((s, t) => s + (t.wounds || 0), 0);

  // ---------- Feature B: wp16CycleSec cycles Secured 0→1→2→0 via applyOp ----------
  state.objectives.length = 0;
  const OBJ = { id: "ob1", x: 30, y: 22 };
  state.objectives.push(OBJ);
  assert(!OBJ.sec, "objective starts not Secured");
  wp16CycleSec(OBJ);
  assert(OBJ.sec === 1, "wp16CycleSec: none → Secured by P1 (obj~ applied)");
  wp16CycleSec(OBJ);
  assert(OBJ.sec === 2, "wp16CycleSec: P1 → Secured by P2");
  wp16CycleSec(OBJ);
  assert(OBJ.sec === 0, "wp16CycleSec: P2 → not Secured (full cycle)");

  // ---------- Feature A: wp16AfterRoll gating ----------
  state.tokens.length = 0; solo = false;
  const ATK = { id: "a1", owner: 1, unit: "u9", name: "Intercessors", shape: "c", dmm: 32, x: 10, y: 10, rot: 0, wounds: 2, maxW: 2 };
  const M1 = { id: "m1", owner: 2, unit: "u1", name: "Ork Boyz", shape: "c", dmm: 32, x: 14, y: 10, rot: 0, wounds: 1, maxW: 2 }; // pre-wounded
  const M2 = { id: "m2", owner: 2, unit: "u1", name: "Ork Boyz", shape: "c", dmm: 32, x: 12, y: 10, rot: 0, wounds: 2, maxW: 2 }; // closest to attacker
  const M3 = { id: "m3", owner: 2, unit: "u1", name: "Ork Boyz", shape: "c", dmm: 32, x: 16, y: 10, rot: 0, wounds: 2, maxW: 2 };
  state.tokens.push(ATK, M1, M2, M3);
  const btn = document.getElementById("wp16Apply");

  wp3Label = ""; wp16Staged = { tgtUk: "u1", atkUk: "u9" };
  wp16AfterRoll(3, 3, 0, [1, 1, 1]);
  assert(wp16Pending === null, "no staged label → no pending apply");

  wp3Label = "⚔ Intercessors → Ork Boyz · Bolt rifle"; wp16Staged = null;
  wp16AfterRoll(3, 3, 0, [1, 1, 1]);
  assert(wp16Pending === null, "label without wp16Staged bookkeeping → no pending apply");

  wp16Staged = { tgtUk: "u1", atkUk: "u9" };
  wp16AfterRoll(0, 0, 0, []);
  assert(wp16Pending === null, "final=0 → no pending apply");

  solo = true;
  wp16AfterRoll(3, 3, 0, [1, 1, 1]);
  assert(wp16Pending === null, "solo mode → wp16 stands down (wp10/wp11 own the roll)");
  solo = false;

  wp16AfterRoll(3, 3, 0, [1, 1, 1]);
  assert(!!wp16Pending && wp16Pending.tgtUk === "u1" && wp16Pending.final === 3, "staged roll → pending apply recorded");
  assert(btn.style.display === "block" && /Apply 3 damage to Ork Boyz \(wounded first\)/.test(btn.textContent),
    "button shown: 'Apply 3 damage to Ork Boyz (wounded first)'");

  // a new roll replaces the pending one
  wp16AfterRoll(2, 2, 0, [1, 1]);
  assert(wp16Pending.final === 2, "a new roll replaces the stale pending apply");
  wp16AfterRoll(3, 3, 0, [1, 1, 1]); // back to the real scenario

  // wp16Hide (called from the tab-attack change listener) invalidates the button
  wp16Hide();
  assert(wp16Pending === null && btn.style.display === "none", "wp16Hide clears the pending apply and hides the button");
  wp16Staged = { tgtUk: "u1", atkUk: "u9" };
  wp16AfterRoll(3, 3, 0, [1, 1, 1]);

  // ---------- apply click: wounded-first, exact totals, dead tokens removed ----------
  const before = unitWounds("u1"); // 1+2+2 = 5
  wp16ApplyClick();
  assert(unitWounds("u1") === before - 3, "total wounds drop by exactly min(final, available) = 3");
  assert(!state.tokens.includes(M1), "pre-wounded model dies first (wounded-first allocation)");
  assert(!state.tokens.includes(M2), "next packets go to the model closest to the attacker");
  assert(state.tokens.includes(M3) && M3.wounds === 2, "farthest model untouched");
  assert(wp16Pending === null && btn.style.display === "none" && wp16Staged === null,
    "apply consumed: pending cleared, button hidden, staged pair cleared");

  // second click is a no-op
  const snapshot = JSON.stringify(state.tokens);
  wp16ApplyClick();
  assert(JSON.stringify(state.tokens) === snapshot, "second click is a no-op (one-shot button)");

  // ---------- excess damage is capped at the wounds available ----------
  const S1 = { id: "s1", owner: 2, unit: "u2", name: "Ork Nob", shape: "c", dmm: 32, x: 20, y: 20, rot: 0, wounds: 2, maxW: 2 };
  state.tokens.push(S1);
  wp3Label = "⚔ Intercessors → Ork Nob · Melta"; wp16Staged = { tgtUk: "u2", atkUk: "u9" };
  wp16AfterRoll(10, 1, 0, [10]);
  assert(!!wp16Pending, "excess-damage roll staged");
  wp16ApplyClick();
  assert(!state.tokens.some(t => t.unit === "u2"), "unit destroyed — excess beyond available wounds is lost, token removed");

  // ---------- mortals become 1-damage packets (no failed saves) ----------
  const S2 = { id: "s2", owner: 2, unit: "u3", name: "Ork Warboss", shape: "c", dmm: 40, x: 22, y: 22, rot: 0, wounds: 3, maxW: 5 };
  state.tokens.push(S2);
  document.getElementById("akD").value = "1";
  wp3Label = "⚔ Intercessors → Ork Warboss · Psychic"; wp16Staged = { tgtUk: "u3", atkUk: "u9" };
  wp16AfterRoll(2, 0, 2, []);
  assert(!!wp16Pending && wp16Pending.mortals === 2, "mortal-wound roll staged");
  wp16ApplyClick();
  assert(S2.wounds === 1 && state.tokens.includes(S2), "2 mortals applied as two 1-damage packets");

  // ---------- desktop DOM untouched ----------
  assert(snap() === baseline, "desktop DOM untouched: #topbar + #side snapshot identical");

  console.log(failed ? "WP16 TESTS: " + failed + " FAILURES" : "WP16 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
