// WP18 wound-allocation v2 regression: run via  node harness.js wp18-tests.js
// Covers: wp18Order truth table (pre-wounded first, then nearest to the attacker,
// sgt/CHARACTER last even when closest, stable), wp18SuggOrder's wounded-first
// redirection hoist (matches wp11AllocClick's rule, even for a wounded leader),
// onMsg "dmg" hostile-payload hardening (capped/coerced/ignored, never throws),
// the "dmg" happy path (wp11Alloc set, banner shown, defender click + A flow works
// with solo=false), the attacker send path (conn stub captures {t:"dmg"}, target
// untouched), the offline path (existing WP16 instant-apply re-asserted), the
// suggestion-overlay draw() smoke, and the solo wp11MaybeAlloc regression.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- desktop snapshot baseline (same trick as wp13/wp16-tests) ----------
  const topbarEl = document.getElementById("topbar"), sideEl = document.getElementById("side");
  const snap = () => [
    topbarEl.innerHTML, topbarEl.children.length,
    sideEl.innerHTML, sideEl.children.length,
  ].join("|");
  const baseline = snap();

  const cvEl = els["board"];
  const click = (x, y) => cvEl.handlers.pointerdown({ offsetX: x * 10, offsetY: y * 10, button: 0, shiftKey: false, altKey: false });
  const key = k => winHandlers.keydown({ key: k, target: { tagName: "DIV" }, preventDefault(){} });
  const unitWounds = uk => state.tokens.filter(t => t.unit === uk).reduce((s, t) => s + (t.wounds || 0), 0);
  const mkTok = (id, unit, owner, x, y, o) => Object.assign({ id, owner, unit, name: unit, shape: "c", dmm: 32, x, y, rot: 0,
    wounds: 2, maxW: 2, kw: ["INFANTRY"] }, o || {});
  view.x = 0; view.y = 0; view.s = 10;

  // ---------- wp18Order truth table ----------
  state.tokens.length = 0; sel.clear(); solo = false; mySide = 1; wp11Alloc = null; wp11Banner();
  const AT = mkTok("at1", "AU", 2, 0, 10);                                            // attacker centroid at x=0
  const SG = mkTok("sg", "TU", 1, 1, 10, { sgt: true });                              // sgt — closest of all
  const CH = mkTok("ch", "TU", 1, 1.5, 10, { kw: ["CHARACTER", "INFANTRY"], wounds: 4, maxW: 4 }); // CHARACTER — 2nd closest
  const N1 = mkTok("n1", "TU", 1, 3, 10);                                             // closest normal
  const N2 = mkTok("n2", "TU", 1, 5, 10);
  const WD = mkTok("wd", "TU", 1, 8, 10, { wounds: 1 });                              // pre-wounded, farthest
  state.tokens.push(AT, SG, CH, N1, N2, WD);

  const ord1 = wp18Order("TU", "AU").map(t => t.id).join(",");
  assert(ord1 === "wd,n1,n2,sg,ch", "wp18Order: wounded first, then nearest, sgt+CHARACTER last even when closest (got " + ord1 + ")");
  assert(wp18Order("TU", "AU").map(t => t.id).join(",") === ord1, "wp18Order is stable across calls");

  // order matches what aiApplyCasualties actually consumes: 3 one-wound kills = wd, n1, n2
  const savedToks = state.tokens.map(t => Object.assign({}, t));
  aiApplyCasualties("TU", [1, 2, 2], 5, "AU");
  assert(!state.tokens.some(t => t.id === "wd") && !state.tokens.some(t => t.id === "n1") && !state.tokens.some(t => t.id === "n2")
    && state.tokens.some(t => t.id === "sg") && state.tokens.some(t => t.id === "ch"),
    "wp18Order matches aiApplyCasualties' real consumption order (wd, n1, n2 die; sg/ch survive)");
  state.tokens.length = 0; savedToks.forEach(t => state.tokens.push(t));              // restore the truth-table board

  // no attacker unit → distance is moot, but wounded-first and leaders-last still hold
  const ordNoAtk = wp18Order("TU", "nope").map(t => t.id);
  assert(ordNoAtk[0] === "wd" && ordNoAtk.indexOf("sg") >= 3 && ordNoAtk.indexOf("ch") >= 3,
    "wp18Order without a live attacker unit: wounded still first, leaders still last");

  // wp18SuggOrder: the wp11AllocClick redirection target (first wounded, even a leader) is hoisted to #1
  const sugg1 = wp18SuggOrder({ tgtUk: "TU", atkUk: "AU" }).map(t => t.id);
  assert(sugg1[0] === "wd", "wp18SuggOrder: pre-wounded model is suggestion #1 (redirection rule)");
  const wdT = state.tokens.find(t => t.id === "wd"), chT = state.tokens.find(t => t.id === "ch"); // restored board holds copies
  wdT.wounds = 2; chT.wounds = 3;                                                     // now the CHARACTER is the unit's only wounded model
  const sugg2 = wp18SuggOrder({ tgtUk: "TU", atkUk: "AU" }).map(t => t.id);
  assert(sugg2[0] === "ch", "wp18SuggOrder: a wounded leader is hoisted to #1 — clicks WOULD be redirected there");
  chT.wounds = 4;

  // ---------- onMsg "dmg": hostile payloads never throw, never allocate wrongly ----------
  wp11Alloc = null;
  const dmg = o => onMsg(Object.assign({ t: "dmg" }, o));
  let threw = false;
  try {
    dmg({});                                                                          // empty
    dmg({ tgtUk: null, atkUk: {}, packets: "lol", final: NaN, label: 7 });            // garbage types
    dmg({ tgtUk: "nope", atkUk: "AU", packets: [1], final: 1, label: "x" });          // unknown unit id
    dmg({ tgtUk: "AU", atkUk: "TU", packets: [1], final: 1, label: "x" });            // wrong side: AU is owner 2, mySide 1
    dmg({ tgtUk: "TU", atkUk: "AU", packets: [-3, "x", {}, 0, 1e9], final: 5, label: "x" }); // every packet invalid
    dmg({ tgtUk: "TU", atkUk: "AU", packets: [1], final: -4, label: "x" });           // negative final
    dmg({ tgtUk: "TU", atkUk: "AU", packets: [1], final: "junk", label: "x" });       // non-numeric final
  } catch (e) { threw = true; }
  assert(!threw, "onMsg dmg: hostile payloads never throw");
  assert(wp11Alloc === null, "onMsg dmg: all hostile payloads ignored — nothing pends");

  dmg({ tgtUk: "TU", atkUk: "AU", packets: new Array(1000).fill(2), final: 999, label: "flood" });
  assert(!!wp11Alloc && wp11Alloc.packets.length === 60, "onMsg dmg: 1000-length packets array capped at 60");
  wp11Alloc = null; wp11Banner();

  dmg({ tgtUk: "TU", atkUk: "AU", packets: ["3", -5, 2.7, "x", 25, 1], final: 7.9, label: "coerce" });
  assert(!!wp11Alloc && wp11Alloc.packets.join(",") === "3,2,1" && wp11Alloc.budget === 7,
    "onMsg dmg: packets coerced to ints 1..24 (strings/floats kept, negatives/oversize dropped), final floored");
  wp11Alloc = null; wp11Banner();

  // ---------- onMsg "dmg" happy path + defender click/A flow with solo === false ----------
  state.tokens.length = 0;
  const AT2 = mkTok("at2", "AU", 2, 0, 10);
  const D1 = mkTok("d1", "DU", 1, 2, 10);                                             // closest to attacker
  const D2 = mkTok("d2", "DU", 1, 5, 10);
  const D3 = mkTok("d3", "DU", 1, 8, 10);
  state.tokens.push(AT2, D1, D2, D3);
  solo = false;
  dmg({ tgtUk: "DU", atkUk: "AU", packets: [2, 1, 1], final: 4, label: "Bolt rifle" });
  assert(!!wp11Alloc && wp11Alloc.tgtUk === "DU" && wp11Alloc.budget === 4 && wp11Alloc.label === "Bolt rifle",
    "onMsg dmg happy path: wp11Alloc set with the sent packets, budget and label");
  const banner = document.getElementById("wp11Banner");
  assert(banner.style.display === "block" && /Suggested next/.test(banner.innerHTML),
    "banner shown to the defender, with the WP18 suggestion line");

  click(5, 10);                                                                       // defender clicks d2: 2-dmg packet → slain
  assert(!state.tokens.some(t => t.id === "d2") && wp11Alloc.packets.length === 2,
    "defender click allocates a packet with solo=false (no solo gate on wp11AllocClick)");
  click(8, 10);                                                                       // d3 takes 1 → wounded 1/2
  assert(state.tokens.find(t => t.id === "d3").wounds === 1, "second click allocates to the clicked model");
  key("a");                                                                           // auto-assign the last packet: wounded d3 first
  assert(wp11Alloc === null && banner.style.display === "none", "A auto-assigns the rest and closes the allocation (solo=false)");
  assert(!state.tokens.some(t => t.id === "d3") && state.tokens.some(t => t.id === "d1"),
    "auto-assigned packet went to the wounded model first");

  // ---------- attacker send path: conn stub captures the message, target untouched ----------
  state.tokens.length = 0;
  const MYA = mkTok("my1", "MU", 1, 10, 10);
  const E1 = mkTok("e1", "EU", 2, 14, 10);
  const E2 = mkTok("e2", "EU", 2, 12, 10);
  state.tokens.push(MYA, E1, E2);
  const sent = [];
  conn = { open: true, send: m => sent.push(m) };
  wp3Label = "⚔ Marines → Boyz · Bolt rifle"; wp16Staged = { tgtUk: "EU", atkUk: "MU" };
  wp16AfterRoll(3, 3, 0, [1, 1, 1]);
  const btn = document.getElementById("wp16Apply");
  assert(!!wp16Pending && /Send 3 damage to EU — they allocate/.test(btn.textContent),
    "network game: button relabelled 'Send 3 damage to EU — they allocate'");
  const beforeW = unitWounds("EU");
  wp16ApplyClick();
  const dmsgs = sent.filter(m => m && m.t === "dmg");
  assert(dmsgs.length === 1 && dmsgs[0].tgtUk === "EU" && dmsgs[0].atkUk === "MU" && dmsgs[0].final === 3
    && dmsgs[0].packets.join(",") === "1,1,1" && /Bolt rifle/.test(dmsgs[0].label),
    "click sends {t:'dmg'} with the exact packets/final/label");
  assert(unitWounds("EU") === beforeW && state.tokens.includes(E1) && state.tokens.includes(E2),
    "send path does NOT mutate the target's wounds — the defender allocates");
  assert(wp16Pending === null, "send is one-shot: pending consumed");
  wp16ApplyClick();
  assert(sent.filter(m => m && m.t === "dmg").length === 1, "second click sends nothing (one-shot)");

  // ---------- no conn → existing WP16 instant-apply behaviour re-asserted ----------
  conn = null;
  wp3Label = "⚔ Marines → Boyz · Bolt rifle"; wp16Staged = { tgtUk: "EU", atkUk: "MU" };
  wp16AfterRoll(3, 3, 0, [1, 1, 1]);
  assert(/Apply 3 damage to EU \(wounded first\)/.test(btn.textContent), "offline: button label unchanged from WP16");
  wp16ApplyClick();
  assert(unitWounds("EU") === beforeW - 3, "offline: click still instant-applies via aiApplyCasualties (WP16 contract)");

  // ---------- suggestion overlay smoke: draw() with a live wp11Alloc must not throw ----------
  state.tokens.length = 0;
  const AT3 = mkTok("at3", "AU", 2, 0, 10);
  const S1 = mkTok("s1", "SU", 1, 2, 10), S2 = mkTok("s2", "SU", 1, 4, 10, { wounds: 1 });
  state.tokens.push(AT3, S1, S2);
  wp11Alloc = { tgtUk: "SU", atkUk: "AU", packets: [1, 1], applied: 0, budget: 2, label: "smoke" };
  let drew = true;
  try { draw(); wp18Overlay(); } catch (e) { drew = false; console.log("   draw threw: " + e.message); }
  assert(drew, "draw() + wp18Overlay() with a live allocation do not throw");
  mySide = 2;                                                                         // not my unit → overlay must stand down silently
  try { wp18Overlay(); } catch (e) { drew = false; }
  assert(drew, "overlay stands down silently when the allocation is not mine");
  mySide = 1;
  wp11Alloc = null; wp11Banner();
  if (wp18Timer) { clearTimeout(wp18Timer); wp18Timer = null; }                       // don't hold node open

  // ---------- solo regression: wp11MaybeAlloc still pends exactly as before ----------
  state.tokens.length = 0;
  const AT4 = mkTok("at4", "AU", 2, 0, 10);
  const P1 = mkTok("pp1", "PU", 1, 2, 10), P2 = mkTok("pp2", "PU", 1, 4, 10);
  state.tokens.push(AT4, P1, P2);
  solo = true; document.getElementById("wp11AutoCas").checked = false; wp3Label = "⚔ AI attack";
  assert(wp11MaybeAlloc("PU", "AU", 3, 2, 1, [1, 1]) === true, "solo: wp11MaybeAlloc still takes over for a player-owned target");
  assert(!!wp11Alloc && wp11Alloc.packets.join(",") === "1,1,1" && wp11Alloc.budget === 3,
    "solo: packets built as before (one per failed save + mortals as 1s), budget = final");
  wp11AllocDiscard();
  solo = false; wp3Label = "";
  if (wp18Timer) { clearTimeout(wp18Timer); wp18Timer = null; }                       // no stray timers at exit

  // ---------- desktop DOM untouched ----------
  assert(snap() === baseline, "desktop DOM untouched: #topbar + #side snapshot identical");

  console.log(failed ? "WP18 TESTS: " + failed + " FAILURES" : "WP18 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
