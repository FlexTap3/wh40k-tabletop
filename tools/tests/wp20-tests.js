// WP20 dice-stats + game-summary regression: run via  node harness.js wp20-tests.js
// Covers: wp20Note tallying (600 scripted rolls → exact counts, zero expectation
// deltas), hot/cold streak tracking, Reset, the instrumented d6() actually feeding
// wp20Note, the create-once 📊 popover (toggle open/close, bars + exp + Reset in the
// markup, Esc), and wp20Summary (players, mission, VP, ×alive/u0 unit tally, log
// lines, export filename via a stubbed dl, and never throwing on an empty state).
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- stats: 600 scripted notes, 100 per face ----------
  wp20Reset();
  for (let f = 1; f <= 6; f++) for (let i = 0; i < 100; i++) wp20Note(f);
  assert(wp20Stats.n === 600, "600 notes counted");
  assert(wp20Stats.counts.join(",") === "100,100,100,100,100,100", "exactly 100 per face");
  const exp = wp20Stats.n / 6;
  assert(wp20Stats.counts.every(c => c - exp === 0), "expectation deltas all zero at 100 per face");
  wp20Note(0); wp20Note(7); wp20Note(NaN);
  assert(wp20Stats.n === 600, "out-of-range values are ignored");

  // ---------- streaks: 7 hot fives, 4 cold ones ----------
  wp20Reset();
  [3, 5, 5, 5, 5, 5, 5, 5, 3, 1, 1, 1, 1, 3].forEach(wp20Note);
  assert(wp20Stats.hot === 7, "longest hot streak (≥5) of 7 recorded");
  assert(wp20Stats.cold === 4, "longest cold streak (≤2) of 4 recorded");
  [6, 5, 6].forEach(wp20Note); // 6s count as hot too, but 3 < 7 keeps the record
  assert(wp20Stats.hot === 7, "a shorter later hot run does not overwrite the record");
  [2, 1, 2, 1, 2].forEach(wp20Note);
  assert(wp20Stats.cold === 5, "2s extend a cold run; a longer run replaces the record");
  wp20Note(3);
  assert(wp20Stats.curHot === 0 && wp20Stats.curCold === 0, "a mid roll (3–4) breaks both current runs");

  // ---------- reset zeroes everything ----------
  wp20Reset();
  assert(wp20Stats.n === 0 && wp20Stats.counts.every(c => c === 0) &&
         wp20Stats.hot === 0 && wp20Stats.cold === 0 &&
         wp20Stats.curHot === 0 && wp20Stats.curCold === 0, "Reset zeroes counts and streaks");

  // ---------- d6() feeds wp20Note ----------
  const before = wp20Stats.n;
  let inRange = true;
  for (let i = 0; i < 25; i++) { const r = d6(); if (!(r >= 1 && r <= 6)) inRange = false; }
  assert(inRange, "d6() still returns 1..6");
  assert(wp20Stats.n === before + 25, "every d6() call lands in wp20Stats");
  assert(wp20Stats.counts.reduce((a, b) => a + b, 0) === 25, "face counts sum to the dice rolled");

  // ---------- popover: create-once, toggle, contents, Esc ----------
  document.body = { children: [], appendChild(c) { this.children.push(c); } };
  wp20Reset();
  [1, 1, 6].forEach(wp20Note);
  wp20Toggle();
  assert(wp20Open === true, "📊 toggle opens the popover");
  assert(document.body.children.filter(c => c.id === "wp20Pop").length === 1, "#wp20Pop injected once into <body>");
  assert(/rolled on this screen/i.test(wp20El.innerHTML), "panel is labelled 'rolled on this screen'");
  assert(/>3<\/b>/.test(wp20El.innerHTML), "total dice shown");
  assert((wp20El.innerHTML.match(/w20row/g) || []).length === 6, "six face rows rendered");
  assert(/w20exp/.test(wp20El.innerHTML) && /exp/.test(wp20El.innerHTML), "expected (n/6) marker present and marked 'exp'");
  assert(/wp20Reset\(\)/.test(wp20El.innerHTML), "Reset button present");
  assert(/hot \(5–6\): <b>1<\/b>/.test(wp20El.innerHTML) && /cold \(1–2\): <b>2<\/b>/.test(wp20El.innerHTML), "streak line shows hot 1 / cold 2");
  wp20Note(6); // rolling while open re-renders
  assert(/>4<\/b>/.test(wp20El.innerHTML), "panel live-updates while open");
  wp20Toggle();
  assert(wp20Open === false, "re-tap closes the popover");
  wp20Toggle();
  winHandlers.keydown({ key: "Escape", target: { tagName: "DIV" } });
  assert(wp20Open === false, "Esc closes the popover");
  assert(document.body.children.filter(c => c.id === "wp20Pop").length === 1, "still exactly one #wp20Pop after toggling (create-once)");

  // ---------- summary: seeded game ----------
  state.names = { 1: "Alice", 2: "Bob" };
  state.mission = { name: "Crucible of Battle", m: "Purge the Foe" };
  state.trackers = { round: 3, cp1: 2, cp2: 1, vp1: 37, vp2: 24 };
  state.tokens.length = 0;
  state.tokens.push(
    { id: "s1", owner: 1, unit: "uA", name: "Intercessor Squad", shape: "c", dmm: 32, x: 10, y: 10, rot: 0, wounds: 2, maxW: 2, u0: 5 },
    { id: "s2", owner: 1, unit: "uA", name: "Intercessor Squad", shape: "c", dmm: 32, x: 11, y: 10, rot: 0, wounds: 1, maxW: 2, u0: 5 },
    { id: "b1", owner: 2, unit: "uB", name: "Boyz", shape: "c", dmm: 32, x: 40, y: 10, rot: 0, wounds: 1, maxW: 1 }
  );
  logEl.children.length = 0;
  logEntry("🎲 <b>Alice</b> rolls 3D6: <b>6 4 1</b>", "dice");
  logEntry("· A quiet turn", "sys");
  const txt = wp20Summary();
  assert(txt.indexOf("Alice") >= 0 && txt.indexOf("Bob") >= 0, "summary names both players");
  assert(/VP: Alice 37 — 24 Bob/.test(txt), "summary carries the VP score");
  assert(/CP: Alice 2 — 1 Bob/.test(txt), "summary carries the CP totals");
  assert(txt.indexOf("Crucible of Battle") >= 0 && txt.indexOf("Purge the Foe") >= 0, "summary names the mission");
  assert(/Battle round: 3/.test(txt), "summary carries the round");
  assert(/Intercessor Squad ×2\/5/.test(txt), "unit tally uses alive/u0 (×2/5)");
  assert(/Boyz ×1\/1/.test(txt), "tokens without u0 fall back to the live count (×1/1)");
  assert(/Surviving units/.test(txt), "tally is headlined as surviving units");
  assert(/Alice rolls 3D6: 6 4 1/.test(txt), "log lines appear as plain text (tags stripped)");
  assert(/A quiet turn/.test(txt), "system log lines included too");

  // ---------- export goes through dl() with the right filename ----------
  const realDl = dl; let dlName = null, dlText = null;
  dl = (name, text) => { dlName = name; dlText = text; };
  wp20Export();
  assert(dlName === "wh40k-battle-summary.txt", "export downloads wh40k-battle-summary.txt");
  assert(typeof dlText === "string" && /WH40K BATTLE SUMMARY/.test(dlText), "export body is the summary text");
  dl = realDl;

  // ---------- summary never throws on an empty state ----------
  state.mission = null; state.tokens.length = 0; logEl.children.length = 0;
  state.names = {}; state.trackers = {};
  let ok = true, empty = "";
  try { empty = wp20Summary(); } catch (e) { ok = false; }
  assert(ok, "empty state: wp20Summary does not throw");
  assert(/WH40K BATTLE SUMMARY/.test(empty) && /no layout loaded/.test(empty) && /none on the table/.test(empty),
    "empty state: sane placeholders for mission and units");
  state.names = { 1: "Player 1", 2: "Player 2" }; state.trackers = { round: 1, cp1: 0, cp2: 0, vp1: 0, vp2: 0 };

  console.log(failed ? "WP20 TESTS: " + failed + " FAILURES" : "WP20 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
