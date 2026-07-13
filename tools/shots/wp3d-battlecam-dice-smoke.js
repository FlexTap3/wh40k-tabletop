/* wp3d-battlecam-dice-smoke.js — WP3D-v3 (P3) behavioral acceptance test: battle-cam +
 * shared dice, driven through the REAL app over a real (loopback-wired) P2P connection.
 * Same serve/wire/pump technique as tools/shots/wp3d-p2p-smoke.js (that file is owned by the
 * integrator; this is a standalone sibling, not an edit to it).
 *
 * (1) HOST stages a real attack via the real wp3Stage() path (ctx0 built exactly the way
 *     wp3Inspect() builds it — wp3CardFor + wp3ParseWeapon — then wp3Stage(ctx0, wi, tgtTok)
 *     called directly, since that's the one function BOTH the two-click ⚔ flow and the
 *     inspector flow funnel through, and it's what bridge.onAttackStaged actually wraps).
 *     Asserts the 3D camera's look-at target moves toward the midpoint of the two staged
 *     tokens.
 * (2) GUEST rolls a few real d6() on their own page. Asserts HOST's 3D scene grows tinted
 *     ("theirs") dice meshes once the {t:"dice"} transient message crosses the real P2P wire
 *     and lands in bridge.onRemoteDice.
 *
 * Neither wh40k-3d.js nor the window.WP3D bridge is edited to support this — both probes
 * (scene-add capture, camera look-at capture) are installed from THIS script via prototype
 * patches on the three.js module namespace's exported CLASSES (mutating THREE.Object3D.
 * prototype.add / THREE.PerspectiveCamera.prototype.lookAt — legal, since ES module
 * namespace BINDINGS are read-only but the objects they point at are ordinary mutable
 * objects), which the app's own `import * as THREE from './vendor/three.module.min.js'`
 * resolves to the exact same singleton module instance (same URL, same browser module
 * cache) — so patching from here reaches every three.js object the real app creates.
 * "a debug accessor... is acceptable if documented" (packet brief) — this is that, done from
 * the test side instead of a production file, since wh40k-3d.js/the bridge are out of scope.
 *
 * Run: cd tools/shots && node wp3d-battlecam-dice-smoke.js
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

  const errors = { host: [], guest: [] };
  const wireErrors = (page, key) => {
    page.on("console", (m) => { if (m.type() === "error") errors[key].push(m.text()); });
    page.on("pageerror", (e) => errors[key].push(String(e)));
  };

  let fails = 0;
  const check = (c, msg) => { console.log((c ? "ok - " : "FAIL: ") + msg); if (!c) fails++; return c; };
  const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-3 : eps);

  const ctxH = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxG = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = await ctxH.newPage();
  const guest = await ctxG.newPage();
  wireErrors(host, "host");
  wireErrors(guest, "guest");
  host.on("dialog", (d) => d.accept()); // wp3Stage may prompt for Rapid Fire; never let it hang

  const load = async (page) => {
    await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
    await page.waitForFunction(() => { const c = document.getElementById("board"); return c && c.width > 0; });
  };
  await Promise.all([load(host), load(guest)]);
  check(true, "both windows load, boards render");

  // ---- muster both armies on host FIRST, while still OFFLINE. Ordering is load-bearing:
  // with a live conn, wp23SetSide (WP23) RE-HOMES tokens/cards on every side switch (this
  // muster flow flips side twice), collapsing both armies onto one owner and vacating a
  // cards slot — offline, setSide keeps the legacy hot-seat flip, so the two imports land
  // as two distinct owners with their cards filed under state.cards[1]/[2]. ----
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
  check(nTok > 0, `host mustered board has ${nTok} tokens (offline, hot-seat two-list muster)`);
  const owners = await host.evaluate(() => {
    const o = { 1: 0, 2: 0 };
    state.tokens.forEach((t) => { o[t.owner] = (o[t.owner] || 0) + 1; });
    return o;
  });
  check(owners[1] > 0 && owners[2] > 0, `both owners present on the table (P1=${owners[1]}, P2=${owners[2]})`);

  // ---- loopback PeerJS wire (same technique as wp3d-p2p-smoke.js) ----
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

  // ---- full-sync the pre-mustered board to guest ----
  await host.evaluate(() => send({ t: "state", state }));
  await pump();
  check((await guest.evaluate(() => state.tokens.length)) === nTok, "guest received host army via {t:state}");

  // ---- host toggles 3D on ----
  await host.evaluate(() => wp3dSetMode("full"));
  await host.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  check(await host.evaluate(() => document.getElementById("boardwrap").classList.contains("mode3d")),
    "host: 3D module loaded, boardwrap has .mode3d");
  await host.waitForTimeout(400); // a few RAF ticks so the scene/camera actually exist

  // ---- install test probes (THREE.Object3D.add capture + THREE.PerspectiveCamera.lookAt capture) ----
  await host.evaluate(async () => {
    const THREE = await import("./vendor/three.module.min.js");
    window.__wp3dAdds = [];
    const origAdd = THREE.Object3D.prototype.add;
    THREE.Object3D.prototype.add = function (...args) {
      for (const o of args) window.__wp3dAdds.push(o);
      return origAdd.apply(this, args);
    };
    const origLookAt = THREE.PerspectiveCamera.prototype.lookAt;
    THREE.PerspectiveCamera.prototype.lookAt = function (v) {
      window.__wp3dCamera = this;
      if (v && typeof v.x === "number") window.__wp3dCamTarget = { x: v.x, y: v.y, z: v.z };
      return origLookAt.apply(this, arguments);
    };
  });
  await host.waitForTimeout(200); // let a few frames run so __wp3dCamTarget gets a baseline value
  const camTarget0 = await host.evaluate(() => window.__wp3dCamTarget);
  check(!!camTarget0, "probe installed: baseline camera look-at target captured");

  // ---- (1) GUEST rolls real dice; HOST must see TINTED ("theirs") dice meshes appear.
  // Run BEFORE the battle-cam phase deliberately: dice land in a spiral around the CURRENT
  // camera target, and at this point that's still the default whole-board overview (board
  // center, open ground) — after the battle-cam the target sits mid-terrain, where a ruin
  // roof can occlude the landed dice in the screenshot (visual-iteration finding). ----
  const addsBefore = await host.evaluate(() => window.__wp3dAdds.length);
  await guest.evaluate(() => { for (let i = 0; i < 5; i++) d6(); });
  await guest.waitForTimeout(250); // clear the app's own 150ms {t:"dice"} batching debounce
  await pump();
  await host.waitForTimeout(100);

  const diceInfo = await host.evaluate((before) => {
    const adds = window.__wp3dAdds.slice(before);
    const dice = adds.filter((o) => o.userData && o.userData.dieMine !== undefined);
    return dice.map((m) => ({
      mine: m.userData.dieMine,
      value: m.userData.dieValue,
      color: m.material && m.material.color ? { r: m.material.color.r, g: m.material.color.g, b: m.material.color.b } : null,
    }));
  }, addsBefore);

  await host.waitForTimeout(750); // dice settled on the table (past DICE_THROW_MS), still resting
  await host.locator("#board3d").screenshot({ path: path.join(OUT, "wp3d-battlecam-03-remote-dice.png") });

  check(diceInfo.length > 0, `host: physical dice meshes appeared after guest's remote roll (${diceInfo.length} dice)`);
  const theirs = diceInfo.filter((d) => d.mine === false);
  check(theirs.length === diceInfo.length && theirs.length > 0, `host: every die from the guest's roll is tagged theirs (dieMine:false) — ${theirs.length}/${diceInfo.length}`);
  const tinted = theirs.every((d) => d.color && !(near(d.color.r, 1) && near(d.color.g, 1) && near(d.color.b, 1)));
  check(tinted, "host: the guest's (opponent's) dice render with a REAL tint, not plain white/ivory");
  const blueLeaning = theirs.every((d) => d.color && d.color.b >= d.color.r); // host mySide=1 -> opponent=2=BLUE
  check(blueLeaning, "host: opponent (side 2) dice tint washes toward BLUE, not RED — side color mapping is correct end-to-end");

  // ---- (2) HOST stages a real attack via the real wp3Stage() path. ctx0 is built exactly
  // the way wp3Inspect() builds it (wp3CardFor + wp3ParseWeapon over card.weapons lines).
  // The attacker is picked from ALL tokens (first whose card actually resolves — which side's
  // cards resolve depends on the muster path's myArmy/state.cards filing, and battle-cam only
  // needs two live token ids, not "my" attacker); target = any token of the OTHER owner (the
  // same owner-differs rule the two-click flow enforces in wp3PickTarget). ----
  const staged = await host.evaluate(() => {
    for (const tok of state.tokens) {
      const card = wp3CardFor(tok);
      const weapons = card ? String(card.weapons || "").split("\n").map(wp3ParseWeapon).filter(Boolean) : [];
      if (!weapons.length) continue;
      // nearest token of the other owner — a realistic attack pick, and it makes the
      // battle-cam's separation-scaled radius produce a visually legible close-up.
      let tgtTok = null, best = Infinity;
      for (const t of state.tokens) {
        if (t.owner === tok.owner) continue;
        const d = Math.hypot(t.x - tok.x, t.y - tok.y);
        if (d < best) { best = d; tgtTok = t; }
      }
      if (!tgtTok) continue;
      const res = wp3Stage({ tok, card, weapons }, 0, tgtTok);
      if (res === false) continue; // fidelity-gate blocked (shouldn't happen fresh off muster) — try another
      return {
        staged: true, attackerId: tok.id, targetId: tgtTok.id,
        attacker: { x: tok.x, y: tok.y }, target: { x: tgtTok.x, y: tgtTok.y },
      };
    }
    return { staged: false, reason: "no token with a resolvable weapon card found" };
  });
  check(staged.staged, `host: staged a real attack via wp3Stage (${staged.attackerId} -> ${staged.targetId}${staged.reason ? " — " + staged.reason : ""})`);

  if (staged.staged) {
    const expectedMid = { x: (staged.attacker.x + staged.target.x) / 2, z: (staged.attacker.y + staged.target.y) / 2 };
    const dist0 = Math.hypot(camTarget0.x - expectedMid.x, camTarget0.z - expectedMid.z);

    await host.waitForTimeout(150); // mid-cinematic: pulse near its first peak, camera in flight
    await host.locator("#board3d").screenshot({ path: path.join(OUT, "wp3d-battlecam-01-midflight.png") });
    await host.waitForTimeout(850); // total ~1000ms — past the ~600ms eased cinematic + settle margin
    const camTarget1 = await host.evaluate(() => window.__wp3dCamTarget);
    const dist1 = Math.hypot(camTarget1.x - expectedMid.x, camTarget1.z - expectedMid.z);
    await host.locator("#board3d").screenshot({ path: path.join(OUT, "wp3d-battlecam-02-settled.png") });

    check(dist1 < dist0, `battle-cam: camera look-at target moved CLOSER to the staged pair's midpoint (before=${dist0.toFixed(2)}in, after=${dist1.toFixed(2)}in)`);
    check(dist1 < 3, `battle-cam: camera look-at target lands close to the staged pair's midpoint (final distance=${dist1.toFixed(2)}in)`);
  }

  // ---- error gate ----
  const fatal = (list) => list.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  check(fatal(errors.host).length === 0, "no console/page errors on host" + (fatal(errors.host).length ? ": " + fatal(errors.host).slice(0, 3).join(" | ") : ""));
  check(fatal(errors.guest).length === 0, "no console/page errors on guest" + (fatal(errors.guest).length ? ": " + fatal(errors.guest).slice(0, 3).join(" | ") : ""));

  await browser.close();
  srv.close();
  console.log(fails ? `WP3D BATTLECAM+DICE SMOKE: ${fails} FAILURES` : "WP3D BATTLECAM+DICE SMOKE: ALL PASSED");
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error("HARNESS CRASH:", e); process.exit(1); });
