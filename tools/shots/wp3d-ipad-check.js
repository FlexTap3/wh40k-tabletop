/* wp3d-ipad-check.js — verify the WP3D-v7b iPad tier engages under iPad emulation:
   iPadOS-Safari-style env (Macintosh UA + maxTouchPoints 5) must produce a 3D context with
   antialias:false (desktop default is true), while plain desktop stays antialias:true.
   Run: cd tools/shots && node wp3d-ipad-check.js */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
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

async function probe(browser, port, opts, label) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  if (opts.hasTouch) {
    // Real iPads report maxTouchPoints=5; Playwright's hasTouch gives 1. Fix via CDP so the
    // app's "Macintosh UA + multi-touch = iPad" branches actually see an iPad.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => {
    const cv = document.getElementById("board");
    return cv && cv.width > 0;
  });
  await page.evaluate(() => {
    const sel = document.getElementById("terrLayout");
    const opt = [...sel.querySelectorAll("option")].find((o) => /Official 1A/i.test(o.value));
    if (opt) { sel.value = opt.value; loadLayout(); }
    wp3dSetMode("full");
  });
  // Wait for the 3D module to be running (start() sets window.wp3dOnDraw). Never call
  // getContext() here — that would CREATE a default-attribute context before three.js does
  // and poison the antialias probe below.
  await page.waitForFunction(() => typeof window.wp3dOnDraw === "function", null, { timeout: 20000 });
  const result = await page.evaluate(() => {
    const cv = document.getElementById("board3d");
    const gl = cv.getContext("webgl2");
    return {
      antialias: gl.getContextAttributes().antialias,
      phone: document.documentElement.classList.contains("phone"),
      touchPoints: navigator.maxTouchPoints,
      ua: navigator.userAgent.slice(0, 60),
      touchAction: getComputedStyle(cv).touchAction,
    };
  });
  await ctx.close();
  return { label, result, errors };
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  let fails = 0;
  const check = (c, msg) => { console.log((c ? "ok - " : "FAIL: ") + msg); if (!c) fails++; };

  const ipad = await probe(browser, port, {
    viewport: { width: 1194, height: 834 }, // iPad Pro 11" landscape CSS px
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    hasTouch: true,
    deviceScaleFactor: 2,
  }, "ipad");
  check(!ipad.result.phone, "iPad emulation is NOT classified as phone (keeps desktop layout)");
  check(ipad.result.touchPoints > 1, "iPad emulation exposes multi-touch (maxTouchPoints=" + ipad.result.touchPoints + ")");
  check(ipad.result.antialias === false, "iPad tier engaged: 3D context antialias=false (got " + ipad.result.antialias + ")");
  check(ipad.result.touchAction === "none", "3D canvas touch-action:none (got " + ipad.result.touchAction + ")");
  check(ipad.errors.length === 0, "no page errors on iPad emulation" + (ipad.errors.length ? ": " + ipad.errors[0] : ""));

  const desktop = await probe(browser, port, {
    viewport: { width: 1440, height: 900 },
  }, "desktop");
  check(desktop.result.antialias === true, "desktop keeps antialias=true (got " + desktop.result.antialias + ")");
  check(desktop.errors.length === 0, "no page errors on desktop" + (desktop.errors.length ? ": " + desktop.errors[0] : ""));

  await browser.close();
  srv.close();
  console.log(fails ? "WP3D IPAD CHECK: FAILED" : "WP3D IPAD CHECK: ALL PASSED");
  process.exitCode = fails ? 1 : 0;
})();
