// p2p-sync.js — Gen-8 Lane B (playability / netcode). Verifies PLAN.md §1.1 invariant #3
// ("Both peers converge") for the two-window P2P game — the app's original goal, never tested.
//
// The real wire is PeerJS cloud signalling (outbound WebRTC/websocket). That is unreliable-to-blocked
// in a sandbox, so this harness reproduces the wire OFFLINE with full fidelity: it loads the REAL app
// in TWO isolated Playwright pages (separate JS contexts, each with its own module-level `state`),
// installs a fake `conn` ({open:true, send}) on each so the app's OWN `send()` / `applyOp()` / `onMsg()`
// run unchanged, and pumps every emitted message from one page's outbox into the OTHER page's `onMsg`
// (exactly what conn.on("data", onMsg) does over PeerJS). Nothing in the app is stubbed or modified —
// only the transport is replaced with a loopback, which is precisely what PeerJS is.
//
// It then drives the HOST's real mutations (op token-move, tracker steps, card draw, phase step, deploy,
// objective update) + a GUEST-originated op, and asserts BOTH `state` objects converge (deep-equal on
// tokens/trackers/phase/cards/objectives/sec/dz/reserves/mission/names/board) after each. Also covers
// the {t:"state"} full-sync on a LATE join and that an older-shape save (missing sec/cards/reserves/
// phase) loads without throwing and defaults sanely. Console/page errors captured throughout.
//
// A separate best-effort block (P2P_LIVE=1) attempts a real PeerJS host+join to record honestly whether
// outbound signalling works in this environment.
//
// Output: shots-out/p2p-*.png + p2p-report.json. Exit non-zero if any convergence check or invariant fails.
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT = path.resolve(__dirname, "shots-out");
fs.mkdirSync(OUT, { recursive: true });

const report = { steps: [], errors: [], convergence: [], live: null };
let failed = false;
const step = (name, ok, note) => {
  report.steps.push({ name, ok, note: note || "" });
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

// The exact sub-tree of `state` that must converge on both peers (invariant #3).
const SNAP = `(function(){return {
  tokens: state.tokens, trackers: state.trackers, phase: state.phase,
  cards: state.cards, objectives: state.objectives, sec: state.sec,
  dz: state.dz, reserves: state.reserves, mission: state.mission,
  names: state.names, board: state.board
};})()`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctxH = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxG = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await ctxH.newPage();
  const guest = await ctxG.newPage();
  host.on("console", m => { if (m.type() === "error") report.errors.push("HOST console: " + m.text()); });
  guest.on("console", m => { if (m.type() === "error") report.errors.push("GUEST console: " + m.text()); });
  host.on("pageerror", e => report.errors.push("HOST pageerror: " + e.message));
  guest.on("pageerror", e => report.errors.push("GUEST pageerror: " + e.message));
  const errN = () => report.errors.length;

  const load = async (page) => {
    await page.goto("file://" + APP);
    await page.waitForSelector("#board", { state: "attached", timeout: 15000 });
    await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; });
    await page.waitForTimeout(150);
  };
  await Promise.all([load(host), load(guest)]);
  step("both app windows load, boards render", true, `${errN()} console errors on load`);

  // ---- Install the loopback wire (replaces PeerJS transport ONLY) ----
  // Each page's app-level send() does `if(conn&&conn.open) conn.send(m)`. We give it a conn whose
  // send() just buffers the message; Node drains the buffer into the other page's real onMsg().
  const wire = async (page, sideVal, hostFlag) => {
    await page.evaluate(({ sideVal, hostFlag }) => {
      window.__outbox = [];
      // eslint-disable-next-line no-undef
      conn = { open: true, send: (m) => { window.__outbox.push(JSON.parse(JSON.stringify(m))); } };
      // eslint-disable-next-line no-undef
      isHost = hostFlag;
      // eslint-disable-next-line no-undef
      mySide = sideVal;
      // eslint-disable-next-line no-undef
      myName = hostFlag ? "Host" : "Guest";
      const s = document.getElementById("mySide"); if (s) s.value = String(sideVal);
      if (typeof setConn === "function") setConn(true, "Connected");
    }, { sideVal, hostFlag });
  };
  await wire(host, 1, true);
  await wire(guest, 2, false);
  step("loopback wire installed (fake conn on both, host=side1 / guest=side2)", true);

  const drain = (page) => page.evaluate(() => { const o = window.__outbox; window.__outbox = []; return o; });
  const deliver = (page, msgs) => page.evaluate((msgs) => { for (const m of msgs) onMsg(m); }, msgs);
  // Pump every buffered message across the wire until both outboxes are empty (cascades settle).
  const pump = async () => {
    for (let i = 0; i < 30; i++) {
      const fromHost = await drain(host);
      const fromGuest = await drain(guest);
      if (!fromHost.length && !fromGuest.length) return;
      if (fromHost.length) await deliver(guest, fromHost);
      if (fromGuest.length) await deliver(host, fromGuest);
    }
    throw new Error("pump did not settle after 30 rounds (message storm / echo loop?)");
  };

  // Deep-equal the converge-critical sub-tree of both peers' state.
  const converge = async (label) => {
    await pump();
    const h = await host.evaluate(SNAP);
    const g = await guest.evaluate(SNAP);
    let ok = true, detail = "";
    try { assert.deepStrictEqual(g, h); }
    catch (e) { ok = false; detail = firstDiff(h, g); }
    report.convergence.push({ label, ok, detail });
    step(`converge: ${label}`, ok, ok ? `tokens=${h.tokens.length} vp=${h.trackers.vp1}/${h.trackers.vp2} cp=${h.trackers.cp1}/${h.trackers.cp2} r${h.trackers.round} ph=${h.phase && h.phase.ph} sec=${h.sec.length}` : detail);
    return { h, g, ok };
  };

  // ---- helloes (name exchange), as wireConn does on open ----
  await host.evaluate(() => send({ t: "hello", name: myName, side: mySide }));
  await guest.evaluate(() => send({ t: "hello", name: myName, side: mySide }));
  await pump();

  // ---- Host sets up a real game: mission + army + a couple of side-2 tokens ----
  await host.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const key = [...sel.options].map(o => o.value).find(v => /Official 1A/.test(v)) || (sel.options[1] && sel.options[1].value);
    sel.value = key; loadLayout();
    const pick = document.getElementById("metaListPick"); if (pick && pick.options.length) pick.selectedIndex = 0;
    const dep = document.getElementById("listDeploy"); if (dep) dep.checked = true;
    wpImportSelected();
    // clean deterministic pre-game state
    state.phase = { side: 1, ph: -1, cpDone: {} };
    state.trackers.round = 1; state.trackers.cp1 = 0; state.trackers.cp2 = 0; state.trackers.vp1 = 0; state.trackers.vp2 = 0;
    refreshTrackers(); draw();
  });
  // A guest joining NOW gets the whole board via the host's {t:"state"} full-sync (wireConn on open).
  await host.evaluate(() => send({ t: "state", state }));
  const c0 = await converge("full-sync on join (mission + army loaded before guest connected)");
  await host.screenshot({ path: path.join(OUT, "p2p-01-host.png") });
  await guest.screenshot({ path: path.join(OUT, "p2p-02-guest-after-fullsync.png") });
  step("guest received host army via {t:state} (guest sees host's tokens)", c0.g.tokens.length > 0, `guest tokens=${c0.g.tokens.length}`);

  // ---- Host op #1: move a token (real op path, as a drag commits) ----
  await host.evaluate(() => {
    const t = state.tokens.find(x => x.owner === 1);
    op({ k: "tok~", toks: [{ id: t.id, x: +(t.x + 3).toFixed(2), y: +(t.y + 2).toFixed(2) }] });
  });
  await converge("host moves a token (tok~)");

  // ---- Host op #2: tracker steps (VP + CP via the real stepper) ----
  await host.evaluate(() => { stepTracker("vp1", 5); stepTracker("cp1", 1); stepTracker("vp2", 3); });
  await converge("host steps VP/CP trackers (track)");

  // ---- Host op #3: draw a secondary card ----
  await host.evaluate(() => { if (!secDeck || !secDeck.length) secDeck = ["Engage on All Fronts", "Behind Enemy Lines", "Storm Hostile Objective"]; drawSecondary(); drawSecondary(); });
  const c3 = await converge("host draws secondaries (sec+)");
  step("secondary owner is host's side on the guest too", c3.g.sec.every(s => s.owner === 1) && c3.g.sec.length >= 1, `sec owners=${JSON.stringify(c3.g.sec.map(s => s.owner))}`);

  // ---- Host op #4: add side-2 tokens (deploy) + objective update ----
  await host.evaluate(() => {
    const base = state.tokens.find(x => x.owner === 1) || { dmm: 32 };
    op({ k: "tok+", toks: [
      { id: uid(), owner: 2, unit: "Foe A", name: "Foe A", shape: "c", dmm: 40, x: 30, y: 30, rot: 0, wounds: 3, maxW: 3 },
      { id: uid(), owner: 2, unit: "Foe A", name: "Foe A", shape: "c", dmm: 40, x: 32, y: 30, rot: 0, wounds: 3, maxW: 3 },
    ] });
    if (state.objectives[0]) op({ k: "obj~", obj: { id: state.objectives[0].id, secured: 2 } });
  });
  const c4 = await converge("host deploys side-2 tokens + secures an objective (tok+, obj~)");
  step("side-2 tokens present on both peers", c4.h.tokens.some(t => t.owner === 2) && c4.g.tokens.some(t => t.owner === 2));

  // ---- Host op #5: step phases through a full round (Deploy → Command … → next side) ----
  await host.evaluate(() => { for (let i = 0; i < 8; i++) wp7Step(1); });
  const c5 = await converge("host steps phases through a round (phase; CP auto-grant derived on both)");
  step("CP auto-grant converged (both peers derived the same CP from the phase op)", c5.h.trackers.cp1 === c5.g.trackers.cp1 && c5.h.trackers.cp2 === c5.g.trackers.cp2, `cp=${c5.h.trackers.cp1}/${c5.h.trackers.cp2}`);

  // ---- Guest-originated op: the guest moves its OWN token; must reach the host ----
  await guest.evaluate(() => {
    const t = state.tokens.find(x => x.owner === 2);
    op({ k: "tok~", toks: [{ id: t.id, x: +(t.x - 4).toFixed(2), y: +(t.y + 1).toFixed(2) }] });
  });
  await converge("GUEST moves its own token — op reaches host (bidirectional)");

  // ---- Guest steps its own trackers ----
  await guest.evaluate(() => { stepTracker("vp2", 4); });
  await converge("GUEST steps its VP — reaches host");
  await host.screenshot({ path: path.join(OUT, "p2p-03-host-after-ops.png") });
  await guest.screenshot({ path: path.join(OUT, "p2p-04-guest-after-ops.png") });

  // ---- LATE JOIN: a brand-new guest connects mid-game and must catch up via {t:"state"} ----
  const guest2 = await ctxG.browser().newPage();
  guest2.on("console", m => { if (m.type() === "error") report.errors.push("GUEST2 console: " + m.text()); });
  guest2.on("pageerror", e => report.errors.push("GUEST2 pageerror: " + e.message));
  await load(guest2);
  await wire(guest2, 2, false);
  // Host sends the CURRENT (heavily-mutated) state to the late joiner.
  const hostState = await host.evaluate(() => JSON.parse(JSON.stringify(state)));
  await guest2.evaluate((s) => onMsg({ t: "state", state: s }), hostState);
  const lateSnap = await guest2.evaluate(SNAP);
  const hSnap = await host.evaluate(SNAP);
  let lateOk = true, lateDetail = "";
  try { assert.deepStrictEqual(lateSnap, hSnap); } catch (e) { lateOk = false; lateDetail = firstDiff(hSnap, lateSnap); }
  step("LATE JOIN full-sync: fresh guest catches up to mid-game state", lateOk, lateOk ? `tokens=${lateSnap.tokens.length} r${lateSnap.trackers.round} vp=${lateSnap.trackers.vp1}/${lateSnap.trackers.vp2}` : lateDetail);
  await guest2.screenshot({ path: path.join(OUT, "p2p-05-late-join.png") });

  // ---- OLDER-SAVE DEFAULTS: a legacy {t:"state"} missing new fields must not throw ----
  const beforeErr = errN();
  const oldOk = await guest2.evaluate(() => {
    try {
      // A minimal pre-WP save: only board/tokens/terrain/objectives/dz/trackers/names/mission.
      onMsg({ t: "state", state: {
        board: { w: 44, h: 60 },
        tokens: [{ id: "old1", owner: 1, unit: "U", name: "U", shape: "c", dmm: 32, x: 10, y: 10, rot: 0, wounds: 1, maxW: 1 }],
        terrain: [], objectives: [{ id: "o1", x: 22, y: 30 }], dz: [],
        trackers: { round: 1, cp1: 0, cp2: 0, vp1: 0, vp2: 0 }, names: { 1: "A", 2: "B" }, mission: null
        // NOTE: no sec, no cards, no reserves, no phase — invariant #3(d): must default sanely
      } });
      // Now poke the parts that read those fields, to prove the defaults are live (not just non-throwing).
      renderCards();
      wp7Step(1);            // touches state.phase (was absent) + trackers
      drawSecondary && (secDeck = secDeck && secDeck.length ? secDeck : ["X"]) && drawSecondary();
      return { ok: true, sec: Array.isArray(state.sec), cards: !!state.cards, reserves: !!state.reserves, phase: !!state.phase };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  });
  step("older-save load: missing sec/cards/reserves/phase default sanely, no throw", oldOk.ok && errN() === beforeErr, oldOk.ok ? `sec=${oldOk.sec} cards=${oldOk.cards} reserves=${oldOk.reserves} phase=${oldOk.phase} (+${errN() - beforeErr} errs)` : oldOk.err);

  // ---- transient {t:"dmg"} handling must not throw and must not enter state (documented behaviour) ----
  const dmgOk = await guest.evaluate(() => {
    try {
      const before = JSON.stringify(state);
      onMsg({ t: "dmg", tgtUk: "Foe A", atkUk: "nobody", packets: [{ dmg: 2, save: 4 }], final: 2, label: "test" });
      return { ok: true, stateUnchanged: JSON.stringify(state) === before };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  });
  step("transient {t:dmg} handled without throw (allocation is a direct message, never state)", dmgOk.ok, dmgOk.ok ? `state unchanged by dmg msg: ${dmgOk.stateUnchanged}` : dmgOk.err);

  // ---- Final all-clear ----
  step("0 console/page errors across the whole P2P convergence run", errN() === 0, errN() ? report.errors.slice(0, 6).join(" | ") : "clean");

  // ---- 2) LIVE PeerJS best-effort (attempt, don't depend on). Set P2P_LIVE=0 to skip (offline CI). ----
  if (process.env.P2P_LIVE === "0") { report.live = { attempted: false, reason: "skipped (P2P_LIVE=0)" }; }
  else await runLiveAttempt(browser).catch(e => { report.live = { attempted: true, connected: false, reason: "harness error: " + e.message }; });
  // The connection itself is best-effort (never fails the harness — outbound signalling may be blocked).
  step(`live PeerJS attempt: ${report.live ? (report.live.connected ? "CONNECTED" : "blocked/failed") : "skipped"}`, true, report.live ? report.live.reason : "");
  // But IF it connected, a real op MUST converge over the live wire — that's the true two-window test.
  if (report.live && report.live.connected) {
    step("live PeerJS: host op converges on guest over the REAL wire", !!report.live.opConverged,
      report.live.opDetail || "");
  }

  fs.writeFileSync(path.join(OUT, "p2p-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  const passed = report.steps.filter(s => s.ok).length;
  console.log(`\n${passed}/${report.steps.length} steps ok · ${report.errors.length} console/page errors · convergence checks ${report.convergence.filter(c => c.ok).length}/${report.convergence.length} passed`);
  if (failed) { console.error("P2P HARNESS FAILED"); process.exit(1); }
  console.log("P2P HARNESS PASSED — both peers converge under the op sequence.");

  // ---------- helpers ----------
  function firstDiff(a, b, pathStr = "state") {
    // Return a short human-readable first divergence between two snapshots.
    try {
      const sa = JSON.stringify(a), sb = JSON.stringify(b);
      if (sa === sb) return "";
      if (typeof a !== typeof b) return `${pathStr}: type ${typeof a} vs ${typeof b}`;
      if (a && b && typeof a === "object") {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
          const d = firstDiff(a[k], b[k], `${pathStr}.${k}`);
          if (d) return d;
        }
      }
      return `${pathStr}: ${String(sa).slice(0, 120)} != ${String(sb).slice(0, 120)}`;
    } catch (e) { return pathStr + ": <undiffable>"; }
  }

  async function runLiveAttempt(browser) {
    // Best-effort real PeerJS over the cloud broker. Sandboxes usually block outbound signalling;
    // record honestly. 12s budget. Loads the app, calls the app's OWN hostGame()/joinPrompt path.
    const p1 = await browser.newPage();
    const p2 = await browser.newPage();
    const consoleErrs = [];
    p1.on("pageerror", e => consoleErrs.push("live p1: " + e.message));
    p2.on("pageerror", e => consoleErrs.push("live p2: " + e.message));
    await load(p1); await load(p2);
    // Host: capture the room code from the peer "open" event.
    const code = await p1.evaluate(() => new Promise((res) => {
      let done = false;
      try {
        const orig = window.Peer;
        if (typeof orig !== "function") return res({ err: "Peer constructor missing (CDN not loaded offline)" });
        hostGame();
        // hostGame set peer.on("open"): poll conn/text for the code.
        const t0 = Date.now();
        const iv = setInterval(() => {
          const txt = (document.getElementById("connText") || {}).textContent || "";
          const m = txt.match(/Room ([A-Z0-9]+)/);
          if (m && !done) { done = true; clearInterval(iv); res({ code: m[1] }); }
          if (Date.now() - t0 > 8000 && !done) { done = true; clearInterval(iv); res({ err: "no peer 'open' within 8s (signalling unreachable): " + txt }); }
        }, 200);
      } catch (e) { res({ err: String(e && e.message || e) }); }
    }));
    if (code.err) { report.live = { attempted: true, connected: false, reason: code.err }; await p1.close(); await p2.close(); return; }
    // Guest: join with the code, wait for conn.open.
    const joined = await p2.evaluate((c) => new Promise((res) => {
      let done = false;
      try {
        const orig = prompt;
        window.prompt = () => c;              // feed the code into joinPrompt()
        joinPrompt();
        window.prompt = orig;
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (typeof conn === "object" && conn && conn.open && !done) { done = true; clearInterval(iv); res({ ok: true }); }
          if (Date.now() - t0 > 8000 && !done) { done = true; clearInterval(iv); res({ ok: false, reason: "conn never opened within 8s" }); }
        }, 200);
      } catch (e) { res({ ok: false, reason: String(e && e.message || e) }); }
    }), code.code);
    report.live = { attempted: true, connected: !!joined.ok, code: code.code,
      reason: joined.ok ? "real PeerJS host+guest connected over the cloud broker" : (joined.reason || "unknown") };
    if (!joined.ok) { await p1.close(); await p2.close(); return; }

    // ---- REAL two-window test: host mutates, guest must converge OVER THE LIVE WIRE ----
    // Give the host's on-open {t:"state"} sync a beat to land on the guest, then push a real op.
    await p1.waitForTimeout(400);
    await p1.evaluate(() => {
      // deterministic tiny board so the op is unambiguous
      op({ k: "clear" });
      op({ k: "tok+", toks: [{ id: "live1", owner: 1, unit: "Live", name: "Live", shape: "c", dmm: 32, x: 12, y: 12, rot: 0, wounds: 1, maxW: 1 }] });
      op({ k: "track", trackers: { round: 2, cp1: 4, cp2: 1, vp1: 9, vp2: 6 } });
    });
    // Poll the GUEST for the mutation to arrive over real WebRTC (has latency).
    const conv = await p2.evaluate(() => new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const t = state.tokens.find(x => x.id === "live1");
        if (t && state.trackers.vp1 === 9 && state.trackers.round === 2) { clearInterval(iv); res({ ok: true, tokens: state.tokens.length, vp1: state.trackers.vp1, round: state.trackers.round }); }
        if (Date.now() - t0 > 6000) { clearInterval(iv); res({ ok: false, tokens: state.tokens.length, vp1: state.trackers.vp1, round: state.trackers.round }); }
      }, 150);
    }));
    report.live.opConverged = !!conv.ok;
    report.live.opDetail = conv.ok
      ? `guest received host op over live PeerJS (tokens=${conv.tokens}, vp1=${conv.vp1}, round=${conv.round})`
      : `guest did NOT converge over live wire within 6s (tokens=${conv.tokens}, vp1=${conv.vp1}, round=${conv.round})`;
    if (consoleErrs.length) report.live.liveErrors = consoleErrs.slice(0, 6);
    await p1.close(); await p2.close();
  }
})().catch(e => { console.error("HARNESS CRASH:", e); process.exit(1); });
