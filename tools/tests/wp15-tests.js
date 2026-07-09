// WP15 two-click attack quick-flow regression: run via  node harness.js wp15-tests.js
// Covers: the ⚔ tool arm→fire dispatch through the real pointerdown handler, default-
// weapon choice (melee when engaged, best in-range gun, least range shortfall),
// carrier counting off WP14 role pips (pipped special ×2, unpipped basic ×3, unmarked
// special → 1 + note), end-to-end Attack-tab fill (akA/akS/tgT/tgSv), weapon-selector
// restaging, Esc / tool-switch disarm, the WP13 menu row, and the desktop-DOM snapshot.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const g = id => document.getElementById(id);

  // ---------- desktop snapshot baseline (same trick as wp12/wp13-tests) ----------
  const topbarEl = document.getElementById("topbar"), sideEl = document.getElementById("side");
  const snap = () => [
    topbarEl.innerHTML, topbarEl.children.length,
    sideEl.innerHTML, sideEl.children.length,
  ].join("|");
  const baseline = snap();

  // ---------- DOM stubs the WP13 menu path needs (functional classLists) ----------
  const mkClassList = () => { const s = new Set(); return {
    add: (...c) => c.forEach(x => s.add(x)),
    remove: (...c) => c.forEach(x => s.delete(x)),
    toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; },
    contains: c => s.has(c), _s: s };
  };
  document.documentElement = { classList: mkClassList() };
  document.body = { children: [], appendChild(c) { this.children.push(c); } };
  global.confirm = () => true; // swallow any Rapid Fire prompts deterministically

  // ---------- seed: Intercessors (mine, P1) vs Boyz (P2), synthetic weapon set ----------
  state.tokens.length = 0; sel.clear(); mySide = 1;
  const smIdx = DB.units.SM.findIndex(u => u.n === "Intercessor Squad");
  const orkIdx = DB.units.ORK.findIndex(u => u.n === "Boyz");
  assert(smIdx >= 0 && orkIdx >= 0, "DB has Intercessor Squad + Boyz");
  const atkCard = addFromDb("SM", smIdx, 5, true); deployCard(atkCard);
  mySide = 2;
  const tgtCard = addFromDb("ORK", orkIdx, 10, true); deployCard(tgtCard);
  mySide = 1;
  myArmy = myArmy.filter(c => c !== tgtCard); // target card is the opponent's, not mine
  // fully synthetic, deterministic weapon lines (roles: SPC, PLA, SNP, SPC-melee)
  atkCard.weapons = 'Boltgun | 24" | 2 | 3+ | 4 | 0 | 1\n'
                  + 'Plasma gun | 24" | 1 | 3+ | 7 | -2 | 2\n'
                  + 'Stalker rifle | 48" | 1 | 3+ | 5 | -1 | 2\n'
                  + 'Chainsword | Melee | 3 | 3+ | 4 | 0 | 1';
  const atkToks = state.tokens.filter(t => t.owner === 1), tgtToks = state.tokens.filter(t => t.owner === 2);
  assert(atkToks.length === 5 && tgtToks.length === 10, "5 Intercessors + 10 Boyz deployed");
  atkToks.forEach((t, i) => { t.x = 5 + i * 1.5; t.y = 20; });
  tgtToks.forEach((t, i) => { t.x = 5 + i * 1.5; t.y = 28; }); // ~6.7" edge-to-edge
  // 2 plasma pips on non-leader bodies; the other 3 (incl. any SGT pip) are basic-gun carriers
  atkToks.filter(t => !t.role && !t.sgt).slice(0, 2).forEach(t => t.role = "PLA");
  const weapons = String(atkCard.weapons).split("\n").map(wp3ParseWeapon).filter(Boolean);
  assert(weapons.length === 4, "synthetic weapon lines parse");

  // ---------- default-weapon choice (unit level) ----------
  assert(wp15DefaultWi(weapons, 0.5, atkToks) === 3, "engaged (≤2.02\"): first melee weapon preferred");
  assert(wp15DefaultWi(weapons, 6.7, atkToks) === 0, "in range: unpipped Boltgun (3×2 output) beats plasma/sniper");
  assert(wp15DefaultWi(weapons, 30, atkToks) === 2, "at 30\": only the 48\" rifle is in range");
  assert(wp15DefaultWi(weapons, 60, atkToks) === 2, "nothing in range: smallest range shortfall (longest gun)");
  assert(wp15CarrierCount(atkToks, weapons[1]) === 2, "carriers: 2 PLA pips carry the plasma gun");
  assert(wp15CarrierCount(atkToks, weapons[0]) === 3, "carriers: 3 unpipped bodies carry the basic gun");
  assert(wp15CarrierCount(atkToks, weapons[2]) === 0, "carriers: unmarked special counts 0 (→ 1 + note)");

  // ---------- two-click flow through the real pointerdown handler ----------
  view.x = 0; view.y = 0; view.s = 10;
  const pd = (x, y) => document.getElementById("board").handlers.pointerdown({ offsetX: x * 10, offsetY: y * 10, button: 0, shiftKey: false, altKey: false });
  setTool("attack");
  assert(tool === "attack", "⚔ toolbar tool selectable via setTool");
  pd(1, 1);
  assert(wp15Atk === null, "click on empty ground is ignored (nothing armed)");
  pd(atkToks[0].x, atkToks[0].y);
  assert(wp15Atk && wp15Atk.unit === atkToks[0].unit, "first click on an own model arms the unit");
  assert(sel.size === 5 && atkToks.every(t => sel.has(t.id)), "arming selects the whole unit for the highlight");
  pd(atkToks[3].x, atkToks[3].y);
  assert(wp15Atk && wp15Atk.unit === atkToks[3].unit, "clicking another own model re-arms");
  pd(tgtToks[0].x, tgtToks[0].y);
  assert(wp15Atk === null, "firing disarms — the next two clicks are a fresh attack");
  assert(tool === "attack", "tool stays on ⚔ after firing");
  assert(sel.has(atkToks[0].id), "selection keeps the attacker");
  // end-to-end fill: Boltgun default, ×3 carriers, Boyz target profile
  assert(g("akA").value === "6", "akA = 2 attacks × 3 basic-gun carriers = 6");
  assert(g("akBS").value === "3+", "akBS staged from the weapon");
  assert(+g("akS").value === 4, "akS staged = 4");
  assert(g("akD").value === "1", "akD staged = 1");
  assert(+g("tgT").value === 5, "tgT auto-filled from the target token (Boyz T5)");
  assert(g("tgSv").value === "5+", "tgSv auto-filled (Boyz 5+)");
  assert(g("akStage").innerHTML.includes("×3 models"), "banner notes the ×3 carrier multiplication");
  assert(wp15Ctx && wp15Ctx.tgtTok === tgtToks[0], "restage ctx kept for weapon switching");
  assert(g("wp15WepRow").style.display === "", "weapon selector row shown");
  assert(g("wp15Wep").value === "0" && g("wp15Wep").innerHTML.includes("Boltgun — 2/3+/4/0/1"), "selector lists weapons with A/BS/S/AP/D summaries");

  // ---------- weapon switching without re-clicking ----------
  wp15WepChange("1"); // plasma: 1 attack × 2 pipped carriers
  assert(g("akA").value === "2", "weapon switch restages: plasma 1A × 2 PLA pips = 2");
  assert(+g("akS").value === 7 && g("akAP").value === "-2" && g("akD").value === "2", "plasma profile staged on switch");
  assert(g("akStage").innerHTML.includes("×2 models"), "banner notes ×2 plasma carriers");
  wp15WepChange("2"); // unmarked special: 1 carrier assumed + note
  assert(g("akA").value === "1", "unmarked special: attacks NOT multiplied (1 carrier assumed)");
  assert(g("akStage").innerHTML.includes("mark carriers with role pips"), "banner explains how to get auto-counts");
  wp15WepChange("0");
  assert(g("akA").value === "6", "switching back restores the multiplied Boltgun attacks");

  // ---------- melee default when engaged ----------
  const savedXY = { x: tgtToks[0].x, y: tgtToks[0].y };
  tgtToks[0].x = atkToks[0].x + 1.0; tgtToks[0].y = 20; // bases overlap-adjacent → engaged
  pd(atkToks[0].x, atkToks[0].y); pd(tgtToks[0].x, tgtToks[0].y);
  assert(g("wp15Wep").value === "3", "engaged: melee weapon staged by default");
  assert(g("akA").value === "9", "melee 3A × 3 unpipped bodies = 9");
  tgtToks[0].x = savedXY.x; tgtToks[0].y = savedXY.y;

  // ---------- manual edit hides the selector and drops the ctx ----------
  wp15ManualEdit(); // the tab-attack change listener calls this for non-wp15Wep/ldTarget edits
  assert(wp15Ctx === null && g("wp15WepRow").style.display === "none", "manual edit: selector hidden, ctx dropped");
  g("akA").value = "99";
  wp15WepChange("1");
  assert(g("akA").value === "99", "weapon switch is a no-op once the ctx is dropped");

  // ---------- Esc / tool-switch disarm ----------
  pd(atkToks[0].x, atkToks[0].y);
  assert(wp15Atk !== null, "re-armed for the Esc test");
  winHandlers.keydown({ key: "Escape", target: { tagName: "CANVAS" } });
  assert(wp15Atk === null, "Esc disarms the attacker");
  wp15Arm(atkToks[0]);
  setTool("select");
  assert(wp15Atk === null, "switching tools disarms the attacker");

  // ---------- no card → polite abort ----------
  const ghost = { id: "g1", owner: 1, unit: "gu", name: "Mystery Model", shape: "c", dmm: 32, x: 3, y: 3, rot: 0, wounds: 1, maxW: 1 };
  state.tokens.push(ghost);
  wp15Ctx = null; g("akA").value = "42";
  wp15Atk = { unit: "gu", owner: 1 };
  wp15Go(tgtToks[1]);
  assert(wp15Ctx === null && g("akA").value === "42", "unit without a card aborts politely (nothing staged)");
  state.tokens.pop();

  // ---------- inspector ⚔ flow gets the selector (per-model attacks, wp3 contract) ----------
  sel.clear(); sel.add(atkToks[0].id);
  wp3Inspect();
  const pi = wp3Ctx.weapons.findIndex(w => w.n === "Plasma gun");
  assert(pi >= 0, "inspector parsed the synthetic weapons");
  wp3Aim(pi); wp3PickTarget(tgtToks[0].x, tgtToks[0].y);
  assert(g("akA").value === "1", "inspector ⚔ aim keeps per-model attacks (wp3 regression contract)");
  assert(wp15Ctx !== null && g("wp15WepRow").style.display === "", "inspector flow shows the weapon selector too");
  wp15WepChange("0");
  assert(g("akA").value === "2", "weapon switch works from an inspector-staged attack (still per-model)");

  // ---------- WP13 token-menu entry ----------
  sel.clear();
  wp13MenuOpen(atkToks[0], 0, 0);
  assert(wp13El.innerHTML.includes("Attack with this unit"), "WP13 menu offers the ⚔ row on own tokens");
  wp15FromMenu();
  assert(wp13Tok === null, "menu row closes the menu");
  assert(tool === "attack" && wp15Atk && wp15Atk.unit === atkToks[0].unit, "menu row switches to the ⚔ tool and arms the unit");
  setTool("select");
  mySide = 2; sel.clear();
  wp13MenuOpen(tgtToks[0], 0, 0); mySide = 1;
  wp13Close();

  // ---------- desktop DOM untouched ----------
  assert(snap() === baseline, "desktop DOM untouched: #topbar + #side snapshot identical after a full ⚔ session");

  console.log(failed ? "WP15 TESTS: " + failed + " FAILURES" : "WP15 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
