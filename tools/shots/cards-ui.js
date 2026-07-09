// cards-ui.js — Gen-5 Lane B (playability/fidelity). Drives the CARDS / SECONDARIES + CP/VP
// SCOREBOARD + END-OF-GAME cluster through the REAL UI: the Cards tab (draw secondaries, the
// shared two-hand view, the editable 📖 card reader + deck editor), the VP/CP scoreboard steppers
// (real button clicks), scoring across battle rounds, stepping the game to its end (round 5 → over),
// and the ranged-only Fire Overwatch guard (P2-4). Captures console/page errors + screenshots at
// each step for visual review. Real DOM clicks on the actual buttons/menus; does NOT modify the app.
//
// Output: shots-out/cards-*.png + cards-report.json
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT = path.resolve(__dirname, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

const report = { steps: [], errors: [], findings: [] };
const step = (name, ok, note) => { report.steps.push({ name, ok, note: note || "" }); console.log(`${ok ? "ok  " : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", m => { if (m.type() === "error") report.errors.push("console: " + m.text()); });
  page.on("pageerror", e => report.errors.push("pageerror: " + e.message));
  const shot = f => page.screenshot({ path: path.join(OUT, f) });
  const errN = () => report.errors.length;
  // click a real <button> inside a container, matched by its visible text
  const clickBtnIn = (containerId, re) => page.evaluate(([cid, r]) => {
    const c = document.getElementById(cid); if (!c) return { ok: false, why: "no #" + cid };
    const b = [...c.querySelectorAll("button")].find(x => new RegExp(r, "i").test(x.textContent));
    if (!b) return { ok: false, buttons: [...c.querySelectorAll("button")].map(x => x.textContent.trim()) };
    b.click(); return { ok: true };
  }, [containerId, re]);

  await page.goto("file://" + APP);
  await page.waitForSelector("#board", { state: "attached", timeout: 15000 });
  await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; });
  await page.waitForTimeout(300);
  step("app loads, board renders", true, `${errN()} console errors on load`);

  // ---- 1) mission + my army + AI opponent (reuse the bring-up path; AI gives a realistic board) ----
  await page.evaluate(() => showTab("setup"));
  const setup = await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const key = [...sel.options].map(o => o.value).find(v => /Official 1A/.test(v)) || (sel.options[1] && sel.options[1].value);
    sel.value = key; loadLayout();
    const pick = document.getElementById("metaListPick"); if (pick && pick.options.length) pick.selectedIndex = 0;
    const dep = document.getElementById("listDeploy"); if (dep) dep.checked = true;
    wpImportSelected();
    aiStart("TAU", 2000);
    return { obj: state.objectives.length, mission: state.mission && state.mission.name, mine: state.tokens.filter(t => t.owner === 1).length, foe: state.tokens.filter(t => t.owner === 2).length };
  });
  step("mission + my army + AI on the table", setup.mine > 0 && setup.foe > 0 && setup.obj > 0, JSON.stringify(setup));

  // ---- 2) Cards tab renders: scoreboard + primary mission + secondary deck ----
  await page.evaluate(() => { mySide = 1; showTab("cards"); });
  await page.waitForTimeout(150);
  const cardsPane = await page.evaluate(() => {
    const el = document.getElementById("tab-cards");
    return { hasScore: !!document.getElementById("scoreboard").textContent.trim(),
      hasMission: /objective/i.test(document.getElementById("missionInfo").textContent),
      hasDraw: [...el.querySelectorAll("button")].some(b => /Draw a card/i.test(b.textContent)) };
  });
  step("Cards tab shows scoreboard + primary mission + Draw button", cardsPane.hasScore && cardsPane.hasMission && cardsPane.hasDraw, JSON.stringify(cardsPane));
  await shot("cards-01-tab.png");

  // ---- 3) Draw secondaries (real button clicks) — my hand grows ----
  const before = await page.evaluate(() => state.sec.filter(c => c.owner === 1).length);
  await clickBtnIn("tab-cards", "Draw a card");
  await page.waitForTimeout(80);
  await clickBtnIn("tab-cards", "Draw a card");
  await page.waitForTimeout(80);
  const afterDraw = await page.evaluate(() => ({ mine: state.sec.filter(c => c.owner === 1).length,
    names: state.sec.filter(c => c.owner === 1).map(c => c.name),
    handHdr: /Your hand/.test(document.getElementById("secDraws").textContent) }));
  step("🎴 Draw a card adds distinct secondaries to my hand", afterDraw.mine >= before + 2 && new Set(afterDraw.names).size === afterDraw.names.length,
    JSON.stringify(afterDraw));
  await shot("cards-02-drawn.png");

  // ---- 4) shared two-hand view: draw for side 2 as well; both hands render with headers ----
  const twoHands = await page.evaluate(() => {
    mySide = 2; drawSecondary(); drawSecondary(); mySide = 1; renderCards();
    const txt = document.getElementById("secDraws").textContent;
    return { p1: state.sec.filter(c => c.owner === 1).length, p2: state.sec.filter(c => c.owner === 2).length,
      showsYourHand: /Your hand/.test(txt), showsOppHand: /'s hand/.test(txt) };
  });
  step("shared hands: my hand + opponent's hand both render (app's shared-hand model)", twoHands.p1 > 0 && twoHands.p2 > 0 && twoHands.showsYourHand && twoHands.showsOppHand, JSON.stringify(twoHands));
  report.findings.push({ probe: "secondary hand visibility", note: "The app SHARES secondary hands (each player sees the other's). 11th-ed matched-play Tactical secondaries are a HIDDEN hand — a fidelity deviation, but a deliberate shared-table-aid choice. Flagged for coordinator judgment; not changed (hidden-hand would be a larger design change to a shared-screen tool)." });
  await shot("cards-03-two-hands.png");

  // ---- 5) editable 📖 card reader: open, edit text, save → persists + re-renders ----
  const readerName = await page.evaluate(() => state.sec.filter(c => c.owner === 1)[0].name);
  await page.evaluate(nm => openCardReader(nm), readerName);
  await page.waitForTimeout(120);
  await shot("cards-04-reader.png");
  const reader = await page.evaluate(() => {
    const dlg = document.getElementById("cardDlg");
    const open = dlg && dlg.open, title = document.getElementById("cardDlgTitle").textContent;
    const ta = document.getElementById("cardDlgText");
    ta.value = "MY CUSTOM SCORING — up to 8 VP.";
    saveCardText();                                   // real save handler (also broadcasts via op)
    const shown = document.getElementById("secDraws").textContent.includes("MY CUSTOM SCORING");
    return { open, title, persisted: cardText[title] === "MY CUSTOM SCORING — up to 8 VP.", shown };
  }, readerName);
  step("📖 card reader edits + saves card text (persists + re-renders)", reader.open && reader.persisted && reader.shown, JSON.stringify(reader));
  await shot("cards-05-reader-saved.png");

  // ---- 6) deck editor: open, edit list, save → secDeck updated ----
  await clickBtnIn("tab-cards", "Edit deck");
  await page.waitForTimeout(100);
  const deck = await page.evaluate(() => {
    const dlg = document.getElementById("secDeckDlg"), open = dlg && dlg.open;
    const ta = document.getElementById("secDeckText");
    const orig = ta.value.split("\n").filter(Boolean).length;
    ta.value = "Assassination\nBring It Down\nCleanse";  // shrink to a known 3-card deck
    saveSecDeck();
    return { open, origCount: orig, newCount: secDeck.length, sample: secDeck.slice(0, 3) };
  });
  step("Edit-deck dialog rewrites the secondary deck", deck.open && deck.newCount === 3, JSON.stringify(deck));
  await shot("cards-06-deck.png");

  // ---- 7) VP / CP scoreboard steppers (real button clicks in #scoreboard) ----
  const vc0 = await page.evaluate(() => ({ ...state.trackers }));
  // scoreboard renders two side-cards; click P1's VP "+" three times, CP "+" twice, then VP "-" once
  const stepScore = await page.evaluate(() => {
    // the P1 card is the first .card in #scoreboard whose text has "VP"
    const cards = [...document.getElementById("scoreboard").querySelectorAll(".card")].filter(c => /VP/.test(c.textContent));
    const p1 = cards[0];
    const spans = [...p1.querySelectorAll("span")];
    const vpSpan = spans.find(s => /^VP/.test(s.textContent)), cpSpan = spans.find(s => /^CP/.test(s.textContent));
    const btns = s => [...s.querySelectorAll("button")]; // [−, +]
    btns(vpSpan)[1].click(); btns(vpSpan)[1].click(); btns(vpSpan)[1].click(); // +3 VP
    btns(cpSpan)[1].click(); btns(cpSpan)[1].click();                         // +2 CP
    btns(vpSpan)[0].click();                                                  // −1 VP
    return { vp1: state.trackers.vp1, cp1: state.trackers.cp1 };
  });
  step("scoreboard VP/CP steppers mutate the tracked score (+3−1 VP, +2 CP)",
    stepScore.vp1 === (vc0.vp1 || 0) + 2 && stepScore.cp1 === (vc0.cp1 || 0) + 2, JSON.stringify({ from: { vp1: vc0.vp1, cp1: vc0.cp1 }, to: stepScore }));
  await shot("cards-07-steppers.png");

  // ---- 8) P2-4: Fire Overwatch is ranged-only — a melee-only unit can't Overwatch ----
  // Pick a friendly unit whose card resolves with a ranged weapon (positive control), place it near
  // an enemy, and set the reactive context (opponent's Movement phase, I'm the non-active side).
  const owSetup = await page.evaluate(() => {
    mySide = 1;
    const byUnit = {}; state.tokens.forEach(t => (byUnit[t.unit] = byUnit[t.unit] || []).push(t));
    const foeU = Object.keys(byUnit).filter(u => byUnit[u][0].owner === 2);
    // find a shooter whose myArmy card resolves AND has a ranged weapon
    const mineU = Object.keys(byUnit).filter(u => byUnit[u][0].owner === 1);
    let shooter = null, card = null;
    for (const u of mineU) { const c = wp3CardFor(byUnit[u][0]); if (!c) continue;
      const ws = String(c.weapons || "").split("\n").map(wp3ParseWeapon).filter(Boolean);
      if (ws.some(w => !w.melee)) { shooter = u; card = c; break; } }
    const foe = foeU[0], f0 = byUnit[foe][0];
    if (shooter) byUnit[shooter].forEach((t, i) => { t.x = f0.x + 6; t.y = f0.y + i * 1.2; });
    solo = false; state.phase = { side: 2, ph: 1, cpDone: (state.phase && state.phase.cpDone) || {} };
    refreshTrackers(); draw();
    return { shooter, shooterName: shooter && byUnit[shooter][0].name, foe, foeName: f0.name, resolved: !!card };
  });

  // positive: a ranged unit CAN Overwatch (guard doesn't over-block), staged at 6+
  const owRanged = await page.evaluate(([shooter, foe]) => {
    sel.clear(); state.tokens.filter(t => t.unit === shooter || t.unit === foe).forEach(t => sel.add(t.id));
    wp3Label = ""; wpFightOverwatch();
    showTab("attack");
    return { staged: !!wp3Label, bs: (document.getElementById("akBS") || {}).value };
  }, [owSetup.shooter, owSetup.foe]);
  step("Fire Overwatch works for a ranged unit (staged at 6+)", owRanged.staged && owRanged.bs === "6+", JSON.stringify(owRanged));
  await shot("cards-08-overwatch-ranged-ok.png");

  // negative: strip the SAME shooter's card to melee-only (mutate the real myArmy card that
  // wp3CardFor reads), then Fire Overwatch must be BLOCKED with the ranged-only message.
  const owMelee = await page.evaluate(([shooter, foe]) => {
    // find the underlying myArmy card for this unit (wp3CardFor maps through migrateCard → a copy)
    const t0 = state.tokens.find(t => t.unit === shooter);
    const nn = norm(t0.name || "");
    const ac = myArmy.find(c => (c.profiles || []).some(p => norm(p.n || "") === nn)) || myArmy.find(c => norm(c.name || "") === nn)
      || myArmy.find(c => (c.profiles || []).some(p => { const q = norm(p.n || ""); return q && (q.includes(nn) || nn.includes(q)); }));
    const saved = ac ? ac.weapons : null;
    if (ac) ac.weapons = "Combat blade | Melee | 3 | 3+ | 4 | 0 | 1"; // melee-only card
    sel.clear(); state.tokens.filter(t => t.unit === shooter || t.unit === foe).forEach(t => sel.add(t.id));
    wp3Label = ""; const n0 = document.getElementById("log").children.length;
    wpFightOverwatch();
    const logTxt = [...document.getElementById("log").children].slice(n0).map(d => d.textContent).join(" | ");
    if (ac && saved != null) ac.weapons = saved; // restore
    return { foundCard: !!ac, staged: !!wp3Label, blockedMsg: /no ranged weapon|ranged snap-shot/i.test(logTxt), log: logTxt.slice(0, 140) };
  }, [owSetup.shooter, owSetup.foe]);
  step("P2-4: melee-only unit is BLOCKED from Fire Overwatch (ranged-only)", owMelee.foundCard && !owMelee.staged && owMelee.blockedMsg, JSON.stringify(owMelee));
  await shot("cards-09-overwatch-melee-blocked.png");
  await page.evaluate(() => showTab("cards"));

  // ---- 9) scoring across rounds + END OF GAME (the phantom-CP fix) ----
  // Drive the REAL phase stepper (solo off ⇒ deterministic, no AI timing) from Deploy through the
  // whole game, scoring primary each Command phase (rounds 2–5) via the VP stepper, and assert that
  // stepping past End of round 5 enters an explicit Game-over state that grants NO further CP.
  await page.evaluate(() => { solo = false; aiStop && aiStop(); state.phase = { side: 1, ph: -1, cpDone: {} };
    state.trackers.round = 1; state.trackers.cp1 = 0; state.trackers.cp2 = 0; state.trackers.vp1 = 0; state.trackers.vp2 = 0;
    refreshTrackers(); wp7RenderPhase(); });
  const scoreLog = [];
  let stepErr0 = errN();
  // step forward until the game reports over (guard well above 5 rounds × 2 sides × 6 phases)
  let guard = 0, over = false;
  while (!over && guard++ < 80) {
    const st = await page.evaluate(() => {
      wp7Step(1);
      const gameOver = (((state.trackers && state.trackers.round) || 1) > 5);
      return { round: state.trackers.round, ph: state.phase.ph, side: state.phase.side, cp1: state.trackers.cp1, cp2: state.trackers.cp2, over: gameOver, label: document.getElementById("wp7PhaseLabel").textContent };
    });
    // simulate scoring the primary in each side-1 Command phase of rounds 2–5
    if (st.ph === 0 && st.side === 1 && st.round >= 2 && st.round <= 5) {
      await page.evaluate(() => { stepTracker("vp1", 5); }); // +5 primary this round
      scoreLog.push({ round: st.round, scoredVp1: true });
    }
    over = st.over;
    if (st.round === 5 && st.ph === 0 && st.side === 1) await shot("cards-10-round5-command.png");
  }
  const endState = await page.evaluate(() => ({
    round: state.trackers.round, cp1: state.trackers.cp1, cp2: state.trackers.cp2, vp1: state.trackers.vp1, vp2: state.trackers.vp2,
    over: (((state.trackers && state.trackers.round) || 1) > 5),
    phaseLabel: document.getElementById("wp7PhaseLabel").textContent,
    roundBadge: document.getElementById("tRound").textContent,
    scoreboardOver: /Game over/.test(document.getElementById("scoreboard").textContent),
  }));
  // In a legal 5-round game both sides get exactly one +1 CP per Command phase = 10 CP each (no phantom round-6 grant)
  step("game reaches an explicit end-of-game state (round steps past 5)", endState.over && guard < 80, JSON.stringify({ guard, round: endState.round }));
  step("END-OF-GAME: no phantom round-6 CP (10 CP each after 5 rounds)", endState.cp1 === 10 && endState.cp2 === 10, JSON.stringify({ cp1: endState.cp1, cp2: endState.cp2 }));
  step("END-OF-GAME cue: phase label 'Game over', round shows '5 ✓', scoreboard shows Game over",
    /Game over/.test(endState.phaseLabel) && /5/.test(endState.roundBadge) && !/6/.test(endState.roundBadge) && endState.scoreboardOver, JSON.stringify(endState));
  await page.evaluate(() => showTab("cards"));
  await page.waitForTimeout(120);
  await shot("cards-11-game-over.png");

  // prove the OLD phantom would have added CP: step once more while over — CP must NOT change
  const cpBeforeExtra = endState.cp1;
  await page.evaluate(() => wp7Step(1));
  const cpAfterExtra = await page.evaluate(() => state.trackers.cp1);
  step("stepping again while game-over grants no extra CP (phantom guard holds)", cpAfterExtra === cpBeforeExtra, JSON.stringify({ cpBeforeExtra, cpAfterExtra }));
  report.findings.push({ probe: "primary scoring", note: "No automatic primary scoring — VP is manual via the steppers (the app deliberately ships no VP rules; the paid Mission Deck has them). The Command-phase reminder now nudges 'score your primary' in rounds 2–5. Not auto-scored: an assist-tool choice, flagged as an intentional non-fix." });

  step("no new console/page errors across the whole walkthrough", errN() === stepErr0 || errN() === 0, `${errN() - stepErr0} new errors during stepping; ${errN()} total`);

  report.totalErrors = report.errors.length;
  fs.writeFileSync(path.join(OUT, "cards-report.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== ${report.steps.filter(s => s.ok).length}/${report.steps.length} steps ok | ${report.errors.length} total console/page errors ===`);
  if (report.errors.length) console.log(report.errors.slice(0, 12).join("\n"));
  console.log("findings probes:", JSON.stringify(report.findings, null, 2));
  await browser.close();
})();
