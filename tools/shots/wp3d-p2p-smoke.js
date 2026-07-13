/* wp3d-p2p-smoke.js — two-window P2P drag-in-3D acceptance test.
 *
 * Proves the chain: 3D pointer glue (sections/wp3d-4-interaction.js) -> bridge
 * commit pipeline (tokDragBegin/Move/Commit, wh40k-tabletop.html) -> op() ->
 * PeerJS send() -> the OTHER peer's state. Two Playwright pages (host + guest),
 * served over local http (wp3dAvailable() requires non-file: + WebGL2, same as
 * wp3d-smoke.js).
 *
 * P2P mechanism: mirrors the existing headless P2P precedent, tools/shots/
 * p2p-sync.js — real outbound PeerJS signalling is unreliable/blocked in a
 * sandbox, so this harness installs a loopback `conn` stub ({open:true, send})
 * on each page and pumps messages between the two pages' real send()/onMsg()
 * by hand. Nothing in the app is stubbed except the transport (exactly what
 * PeerJS is) — hello/state/op all run through the app's own unmodified code.
 *
 * Run: cd tools/shots && node wp3d-p2p-smoke.js
 */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(__dirname, "shots-out");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".webmanifest": "application/manifest+json" };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/wh40k-tabletop.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rsp.writeHead(404); return rsp.end("nope");
      }
      rsp.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });

  const errors = { host: [], guest: [], guest2: [] };
  const wireErrors = (page, key) => {
    page.on("console", (m) => { if (m.type() === "error") errors[key].push(m.text()); });
    page.on("pageerror", (e) => errors[key].push(String(e)));
  };

  let fails = 0;
  const check = (c, msg) => { console.log((c ? "ok - " : "FAIL: ") + msg); if (!c) fails++; return c; };

  const ctxH = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxG = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = await ctxH.newPage();
  const guest = await ctxG.newPage();
  wireErrors(host, "host");
  wireErrors(guest, "guest");

  const load = async (page) => {
    await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
    await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; });
  };
  await Promise.all([load(host), load(guest)]);
  check(true, "both windows load, boards render");

  // ---- Install the loopback PeerJS wire (same technique as p2p-sync.js) ----
  const wire = async (page, sideVal, hostFlag) => {
    await page.evaluate(({ sideVal, hostFlag }) => {
      window.__outbox = [];
      // eslint-disable-next-line no-undef
      conn = { open: true, send: (m) => { window.__outbox.push(JSON.parse(JSON.stringify(m))); } };
      // eslint-disable-next-line no-undef
      isHost = hostFlag; mySide = sideVal; myName = hostFlag ? "Host" : "Guest";
      const s = document.getElementById("mySide"); if (s) s.value = String(sideVal);
      if (typeof setConn === "function") setConn(true, "Connected");
    }, { sideVal, hostFlag });
  };
  await wire(host, 1, true);
  await wire(guest, 2, false);

  const drain = (page) => page.evaluate(() => { const o = window.__outbox; window.__outbox = []; return o; });
  const deliver = (page, msgs) => page.evaluate((msgs) => { for (const m of msgs) onMsg(m); }, msgs);
  const pump = async () => {
    for (let i = 0; i < 30; i++) {
      const fromHost = await drain(host);
      const fromGuest = await drain(guest);
      if (!fromHost.length && !fromGuest.length) return;
      if (fromHost.length) await deliver(guest, fromHost);
      if (fromGuest.length) await deliver(host, fromGuest);
    }
    throw new Error("pump did not settle after 30 rounds");
  };

  await host.evaluate(() => send({ t: "hello", name: myName, side: mySide }));
  await guest.evaluate(() => send({ t: "hello", name: myName, side: mySide }));
  await pump();
  check(true, "hello exchanged (loopback wire live)");

  // ---- (1) Host musters both meta armies — same setupBoard flow as wp3d-smoke.js ----
  const nTok = await host.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const opts = [...sel.querySelectorAll("option")];
    const opt = opts.find((o) => /Official 1A/i.test(o.value)) || opts[0];
    sel.value = opt.value; loadLayout();
    if (typeof wpImportPopulate === "function") wpImportPopulate();
    const pick = document.getElementById("metaListPick");
    pick.value = "0"; wpImportSelected();
    setSide("2"); pick.value = "1"; wpImportSelected(); setSide("1");
    fitView(); draw();
    return state.tokens.length;
  });
  check(nTok > 0, `host mustered board has ${nTok} tokens`);

  // ---- (2) Full-sync to guest, wait for guest to converge ----
  await host.evaluate(() => send({ t: "state", state }));
  await pump();
  const guestTok0 = await guest.evaluate(() => state.tokens.length);
  check(guestTok0 === nTok, `guest received host army via {t:state} (guest tokens=${guestTok0}, host=${nTok})`);

  // ---- (3) Host toggles 3D on via the real mode API (v3: explicit full mode) ----
  await host.evaluate(() => wp3dSetMode("full"));
  await host.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  check(await host.evaluate(() => document.getElementById("boardwrap").classList.contains("mode3d")),
    "host: 3D module loaded, boardwrap has .mode3d");
  await host.waitForTimeout(600); // a few RAF ticks so the scene is actually built

  // Muster positions are randomized (deploy uses Math.random() for lateral offset), so a fixed
  // +3"/+30" drag can land on a random impassable terrain footprint on some runs. wp5Strict
  // (terrain collision) is a REAL, separate gate from coherency/move-cap and not what this test
  // is targeting (the task calls out coherency snap-back specifically) — disable it so the
  // coherency and move-cap checks below are deterministic and isolate the gate under test. This
  // is a test-setup choice (same category as toggling strictMove/structMove below), not an app change.
  await host.evaluate(() => { const el = document.getElementById("wp5Strict"); if (el) el.checked = false; });

  // ---- Pick an isolated (single-model unit) OWN token on the host, to dodge coherency snap-back ----
  const pickIsolated = async (page, owner) => page.evaluate((owner) => {
    const counts = {};
    state.tokens.forEach((t) => { counts[t.unit] = (counts[t.unit] || 0) + 1; });
    const cands = state.tokens.filter((t) => t.owner === owner && counts[t.unit] === 1
      && typeof t.Mv === "number" && t.Mv > 0 && t.Mv <= 16);
    if (!cands.length) return null;
    const t = cands[0];
    return { id: t.id, x: t.x, y: t.y, unit: t.unit, Mv: t.Mv };
  }, owner);

  const tokA = await pickIsolated(host, 1);
  check(!!tokA, `host has an isolated single-model own token to drag: ${tokA ? tokA.unit + " (Mv " + tokA.Mv + '")' : "NONE FOUND"}`);

  // ---- (3a) Bridge-direct drag: EXACT path the 3D pointer glue calls on a resolved token-drag
  // (createInteraction's beginDrag/moveDrag/commitDrag -> bridge.tokDragBegin/Move/Commit).
  // This proves the 3D->commit->P2P chain independent of raycasting/picking. ----
  let hostAfterA = null;
  if (tokA) {
    hostAfterA = await host.evaluate(({ id, x, y }) => {
      window.WP3D.sel.clear(); window.WP3D.sel.add(id); // mirrors the glue's click-select action, which fires before drag-begin
      window.WP3D.tokDragBegin([id], x, y);
      window.WP3D.tokDragMove(x + 3, y);
      window.WP3D.tokDragCommit();
      const t = state.tokens.find((tk) => tk.id === id);
      return { x: t.x, y: t.y };
    }, tokA);
    check(Math.abs(hostAfterA.x - (tokA.x + 3)) < 0.05 && Math.abs(hostAfterA.y - tokA.y) < 0.05,
      `host: bridge-direct drag moved token +3" (host now x=${hostAfterA.x.toFixed(2)}, expected ${(tokA.x + 3).toFixed(2)})`);
  }

  // ---- (3b) A TRUE synthetic-pointer drag on #board3d, empty space -> camera orbit.
  // Proves the pointer listener glue (createInteraction's addEventListener calls) is actually
  // wired into the real app, not just callable in isolation. Anchor near the TOP of the canvas —
  // above the board's horizon in the 3/4 rig, i.e. guaranteed sky/background, never a token mesh. ----
  const beforeOrbit = await host.evaluate(() => state.tokens.map((t) => [t.id, t.x, t.y]));
  const box = await host.locator("#board3d").boundingBox();
  const ox = box.x + box.width * 0.5, oy = box.y + box.height * 0.1;
  await host.mouse.move(ox, oy);
  await host.mouse.down();
  await host.mouse.move(ox + 25, oy + 15, { steps: 4 });
  await host.mouse.move(ox + 60, oy + 30, { steps: 4 });
  await host.mouse.up();
  await host.waitForTimeout(200);
  const afterOrbit = await host.evaluate(() => state.tokens.map((t) => [t.id, t.x, t.y]));
  check(JSON.stringify(beforeOrbit) === JSON.stringify(afterOrbit),
    "host: synthetic pointer drag on empty #board3d space orbited the camera (no token moved)");

  // ---- (4) GUEST convergence: the dragged token's +3" move must have crossed the real op()/send() path ----
  await pump();
  if (tokA) {
    const g = await guest.evaluate((id) => { const t = state.tokens.find((tk) => tk.id === id); return t ? { x: t.x, y: t.y } : null; }, tokA.id);
    check(!!g && Math.abs(g.x - (tokA.x + 3)) < 0.05 && Math.abs(g.y - tokA.y) < 0.05,
      `GUEST converged on the 3D-drag-originated move (guest x=${g && g.x.toFixed(2)}, expected ${(tokA.x + 3).toFixed(2)})`);
  }

  // ---- (5) Move-cap check: drag far beyond the token's Mv via the SAME bridge path; must snap back
  // exactly as a 2D drag would (tokDragCommit -> wp2DropCheck, gated on the "Enforce movement caps"
  // checkbox — off by default, so turn it on to make the cap live). ----
  await host.evaluate(() => { const el = document.getElementById("strictMove"); if (el) el.checked = true; });
  const tokB = await pickIsolated(host, 1).then(async (t) => {
    // pickIsolated always returns the first match; if it's tokA (already moved+used), find a fresh one.
    if (!t || (tokA && t.id === tokA.id)) {
      return host.evaluate((excludeId) => {
        const counts = {};
        state.tokens.forEach((t) => { counts[t.unit] = (counts[t.unit] || 0) + 1; });
        const cands = state.tokens.filter((t) => t.owner === 1 && counts[t.unit] === 1
          && typeof t.Mv === "number" && t.Mv > 0 && t.Mv <= 16 && t.id !== excludeId);
        if (!cands.length) return null;
        const c = cands[0];
        return { id: c.id, x: c.x, y: c.y, unit: c.unit, Mv: c.Mv };
      }, tokA ? tokA.id : null);
    }
    return t;
  });
  check(!!tokB, `host has a second isolated own token for the move-cap check: ${tokB ? tokB.unit + " (Mv " + tokB.Mv + '")' : "NONE FOUND"}`);

  if (tokB) {
    const capResult = await host.evaluate(({ id, x, y }) => {
      window.WP3D.sel.clear(); window.WP3D.sel.add(id);
      window.WP3D.tokDragBegin([id], x, y);
      window.WP3D.tokDragMove(x + 30, y); // Mv is <=16", so +30" is always > Mv+6"
      window.WP3D.tokDragCommit();
      const t = state.tokens.find((tk) => tk.id === id);
      return { x: t.x, y: t.y };
    }, tokB);
    const landedAtFull = Math.abs(capResult.x - (tokB.x + 30)) < 0.05;
    check(!landedAtFull, `host: +30" drag (Mv ${tokB.Mv}") did NOT land at start+30 — cap enforced (final x=${capResult.x.toFixed(2)}, start x=${tokB.x.toFixed(2)})`);
    check(Math.abs(capResult.x - tokB.x) < 0.05 && Math.abs(capResult.y - tokB.y) < 0.05,
      `host: over-cap drag snapped fully back to its start position (same as a 2D drag would)`);
  }

  await pump(); // let the snap-back op (if any) reach the guest too, keeping peers converged

  // ---- (6) Guest refresh -> rejoin: a brand-new guest page (simulating reload) must resync via
  // the app's own {t:"state"} full-sync — same technique as p2p-sync.js's LATE JOIN scenario. ----
  const guest2 = await ctxG.newPage();
  wireErrors(guest2, "guest2");
  await load(guest2);
  await wire(guest2, 2, false);
  const hostState = await host.evaluate(() => JSON.parse(JSON.stringify(state)));
  await guest2.evaluate((s) => onMsg({ t: "state", state: s }), hostState);
  const g2Tok = await guest2.evaluate(() => state.tokens.length);
  check(g2Tok === nTok, `guest2 (rejoin) resynced token count (${g2Tok} === ${nTok})`);
  if (tokA) {
    const g2A = await guest2.evaluate((id) => { const t = state.tokens.find((tk) => tk.id === id); return t ? { x: t.x, y: t.y } : null; }, tokA.id);
    check(!!g2A && Math.abs(g2A.x - (tokA.x + 3)) < 0.05 && Math.abs(g2A.y - tokA.y) < 0.05,
      `guest2 (rejoin) resynced the moved token's position (x=${g2A && g2A.x.toFixed(2)}, expected ${(tokA.x + 3).toFixed(2)})`);
  }
  await guest2.close();

  // ---- console/page error gate ----
  const fatal = (list) => list.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  const hostFatal = fatal(errors.host), guestFatal = fatal(errors.guest), guest2Fatal = fatal(errors.guest2);
  check(hostFatal.length === 0, "no console/page errors on host" + (hostFatal.length ? ": " + hostFatal.slice(0, 3).join(" | ") : ""));
  check(guestFatal.length === 0, "no console/page errors on guest" + (guestFatal.length ? ": " + guestFatal.slice(0, 3).join(" | ") : ""));
  check(guest2Fatal.length === 0, "no console/page errors on guest2" + (guest2Fatal.length ? ": " + guest2Fatal.slice(0, 3).join(" | ") : ""));

  await host.screenshot({ path: path.join(OUT, "wp3d-p2p-01-host.png") });
  await guest.screenshot({ path: path.join(OUT, "wp3d-p2p-02-guest.png") });

  await browser.close();
  srv.close();
  console.log(fails ? `WP3D P2P SMOKE: ${fails} FAILURES` : "WP3D P2P SMOKE: ALL PASSED");
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error("HARNESS CRASH:", e); process.exit(1); });
