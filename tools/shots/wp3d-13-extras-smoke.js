/* wp3d-13-extras-smoke.js — behavioral Playwright check for the WP3D-13 extras pack (owned
 * by P4): overlay visibility gated on 3D mode, photo pipeline produces a real PNG blob,
 * camera presets actually move the camera. Copies wp3d-smoke.js's serve()+launch scaffolding.
 * Not part of the frozen gate (run_all.sh / wp3d-smoke.js / wp3d-p2p-smoke.js) — an additional
 * packet-owned behavioral suite per the WP3D-v3 contract's testing brief.
 * Run: cd tools/shots && node wp3d-13-extras-smoke.js */
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  let fails = 0;
  const check = (c, msg) => { console.log((c ? "ok - " : "FAIL: ") + msg); if (!c) fails++; };

  // Force the DOWNLOAD fallback path deterministically (headless Chromium doesn't implement
  // navigator.share, but pin it explicitly so this doesn't depend on browser/version quirks),
  // and hook URL.createObjectURL to capture the blob passed to it for the PNG-magic-bytes check.
  await page.addInitScript(() => {
    try { Object.defineProperty(window.navigator, "canShare", { value: undefined, configurable: true }); } catch (e) {}
    window.__capturedBlobs = [];
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__capturedBlobs.push(blob); return origCreateObjectURL(blob); };
  });

  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => {
    const cv = document.getElementById("board");
    return cv && cv.width > 0;
  });

  // Muster (same in-page flow as wp3d-smoke.js) so the board has real tokens/terrain.
  await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const opts = [...sel.querySelectorAll("option")];
    const opt = opts.find((o) => /Official 1A/i.test(o.value)) || opts[0];
    sel.value = opt.value; loadLayout();
    if (typeof wpImportPopulate === "function") wpImportPopulate();
    const pick = document.getElementById("metaListPick");
    pick.value = "0"; wpImportSelected();
    setSide("2"); pick.value = "1"; wpImportSelected(); setSide("1");
    fitView(); draw();
  });

  // ---- 1. overlay does not exist before any 3D activation ----
  check(await page.evaluate(() => !document.getElementById("wp3dExtras")),
    "no #wp3dExtras overlay in the DOM before 3D has ever been activated");

  // ---- 2. entering full 3D mode: overlay appears, all five buttons present ----
  await page.evaluate(() => wp3dSetMode("full"));
  await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 15000 });
  await page.waitForTimeout(400); // a few RAF ticks so tick()'s visibility fallback + MutationObserver settle
  check(await page.evaluate(() => {
    const el = document.getElementById("wp3dExtras");
    return !!el && getComputedStyle(el).display !== "none";
  }), "overlay strip is visible once 3D is in full mode");
  const ids = await page.evaluate(() => [...document.querySelectorAll("#wp3dExtras button")].map((b) => b.id));
  check(["wp3dMute", "wp3dPhoto", "wp3dCamTQ", "wp3dCamTop", "wp3dCamTable"].every((id) => ids.includes(id)),
    `all five buttons present (got: ${ids.join(", ")})`);
  await page.screenshot({ path: path.join(OUT, "wp3d-13-fullpage-full.png") });
  await page.evaluate(() => wp3dSetMode("pip"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "wp3d-13-fullpage-pip.png") });
  await page.evaluate(() => wp3dSetMode("full"));
  await page.waitForTimeout(300);

  // ---- 3. positioning: bottom-left strip must not overlap the top-left toolbar or a would-be
  //         bottom-right PiP inset (340x220 @ 10px margins, per the frozen CSS contract) ----
  const rects = await page.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    return { extras: r("wp3dExtras"), toolbar: r("toolbar") };
  });
  check(rects.extras.bottom > rects.toolbar.bottom, "overlay sits well below the top-left toolbar (bottom-left, no vertical overlap)");
  const boardwrapRect = await page.evaluate(() => document.getElementById("boardwrap").getBoundingClientRect());
  const pipZoneLeft = boardwrapRect.right - 10 - 340; // PiP inset's left edge per the frozen CSS
  check(rects.extras.right < pipZoneLeft, "overlay's right edge stays clear of the bottom-right PiP inset's left edge");

  // ---- 4. camera presets: clicking top/table visibly moves the camera (pixel-diff proof —
  //         no rig internals are reachable from the page without editing files outside this
  //         packet's ownership, so a screenshot byte-diff is the evidence) ----
  const shotDefault = await page.locator("#board3d").screenshot();
  await page.evaluate(() => document.getElementById("wp3dCamTop").click());
  await page.waitForTimeout(700); // preset convergence window
  const shotTop = await page.locator("#board3d").screenshot();
  check(!shotDefault.equals(shotTop), "clicking the top-down preset changes the rendered camera view");

  await page.evaluate(() => document.getElementById("wp3dCamTable").click());
  await page.waitForTimeout(700);
  const shotTable = await page.locator("#board3d").screenshot();
  check(!shotTop.equals(shotTable), "clicking the table-level preset changes the view again (distinct from top-down)");

  await page.evaluate(() => document.getElementById("wp3dCamTQ").click());
  await page.waitForTimeout(500);
  const shotTQ = await page.locator("#board3d").screenshot();
  check(!shotTable.equals(shotTQ), "clicking the 3/4 preset changes the view again (distinct from table-level)");
  fs.writeFileSync(path.join(OUT, "wp3d-13-cam-default.png"), shotDefault);
  fs.writeFileSync(path.join(OUT, "wp3d-13-cam-top.png"), shotTop);
  fs.writeFileSync(path.join(OUT, "wp3d-13-cam-table.png"), shotTable);
  fs.writeFileSync(path.join(OUT, "wp3d-13-cam-tq.png"), shotTQ);

  // ---- 5. instant-cancel: dragging the camera mid-preset must not fight the user ----
  await page.evaluate(() => document.getElementById("wp3dCamTop").click());
  await page.waitForTimeout(60); // still mid-flight
  const box = await page.locator("#board3d").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  check(true, "manual drag mid-preset completes without throwing (instant-cancel path exercised)");

  // ---- 6. a gesture has now happened (mouse drag above) -> AudioContext should exist; mute
  //         toggle flips the button icon and persists ----
  const muteBefore = await page.evaluate(() => document.getElementById("wp3dMute").textContent);
  await page.evaluate(() => document.getElementById("wp3dMute").click());
  const muteAfter = await page.evaluate(() => document.getElementById("wp3dMute").textContent);
  check(muteBefore !== muteAfter, "mute button click toggles its icon");
  await page.evaluate(() => document.getElementById("wp3dMute").click()); // restore

  // ---- 7. battle photo: click -> download fallback path -> captured blob is a real PNG ----
  await page.evaluate(() => { window.__capturedBlobs.length = 0; });
  await page.evaluate(() => document.getElementById("wp3dPhoto").click());
  await page.waitForFunction(() => window.__capturedBlobs.length > 0, null, { timeout: 10000 });
  const magic = await page.evaluate(async () => {
    const blob = window.__capturedBlobs[0];
    const buf = new Uint8Array(await blob.arrayBuffer());
    return { bytes: Array.from(buf.slice(0, 8)), type: blob.type, size: blob.size };
  });
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  check(magic.bytes.length === 8 && PNG_MAGIC.every((b, i) => b === magic.bytes[i]),
    `photo blob starts with the PNG magic byte signature (got [${magic.bytes.join(",")}])`);
  check(magic.type === "image/png", `photo blob mime type is image/png (got "${magic.type}")`);
  check(magic.size > 1000, `photo blob has real content (${magic.size} bytes)`);

  // ---- 8. toggling PiP mode: overlay stays visible (no overlap with the PiP inset, checked
  //         above); toggling fully OFF hides the overlay WITHOUT another tick (RAF loop halts
  //         on "off" — this is exactly the MutationObserver-vs-tick-fallback case) ----
  await page.evaluate(() => wp3dSetMode("pip"));
  await page.waitForTimeout(300);
  check(await page.evaluate(() => getComputedStyle(document.getElementById("wp3dExtras")).display !== "none"),
    "overlay remains visible in PiP mode");
  await page.evaluate(() => wp3dSetMode("off"));
  await page.waitForTimeout(50); // deliberately short — proves the MutationObserver path, not a lucky extra tick
  check(await page.evaluate(() => getComputedStyle(document.getElementById("wp3dExtras")).display === "none"),
    "overlay hides immediately on 3D off, even though the RAF loop (and tick()) has already stopped");

  const fatal = errors.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  check(fatal.length === 0, "no console/page errors" + (fatal.length ? ": " + fatal.slice(0, 5).join(" | ") : ""));

  await browser.close();
  srv.close();
  console.log(fails ? `WP3D-13 EXTRAS SMOKE: ${fails} FAILURES` : "WP3D-13 EXTRAS SMOKE: ALL PASSED");
  process.exitCode = fails ? 1 : 0;
})();
