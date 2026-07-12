// wp3d-webgl-spike.js — WP3D-0 opening task: prove headless Chromium can render WebGL2
// before any app work happens. If this fails, the whole 3D-view plan is dead on arrival.
//
// RESULT (this machine, Playwright 1.61.1 / chromium 149.0.7827.55, darwin):
//   Default `chromium.launch({ headless: true })` (Playwright's modern headless mode,
//   NOT old headless=chrome) renders WebGL2 out of the box via ANGLE/SwiftShader —
//   no extra launch args (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`)
//   were needed. Those args are kept below, commented out, in case a CI box (older
//   Chromium, Linux without the right libs) needs them — flip USE_FALLBACK_ARGS=true
//   to exercise that path.
//
// Usage: node wp3d-webgl-spike.js

const { chromium } = require("playwright");

const USE_FALLBACK_ARGS = false; // set true to force the swiftshader launch args below

(async () => {
  const launchOpts = { headless: true };
  if (USE_FALLBACK_ARGS) {
    launchOpts.args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  }

  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });

  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

  await page.goto("about:blank");

  // 1. Create a canvas, get webgl2, clear to pure red, readPixels in-page.
  const inPage = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    document.body.appendChild(canvas);

    const gl = canvas.getContext("webgl2");
    if (!gl) return { ok: false, reason: "getContext('webgl2') returned null" };

    gl.clearColor(1, 0, 0, 1); // pure red
    gl.clear(gl.COLOR_BUFFER_BIT);

    const px = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

    const renderer = gl.getParameter(gl.RENDERER);
    const version = gl.getParameter(gl.VERSION);

    let unmasked = null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      unmasked = {
        vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
      };
    }

    return {
      ok: px[0] === 255 && px[1] === 0 && px[2] === 0 && px[3] === 255,
      px: Array.from(px),
      renderer, version, unmasked,
    };
  });

  // 2. Also render a full-canvas red quad, sized to viewport, and screenshot it —
  //    verify the PNG bytes actually show red (not just in-page readPixels, which
  //    could in theory pass on a context that doesn't composite to the page).
  await page.evaluate(() => {
    document.body.style.margin = "0";
    const canvas = document.createElement("canvas");
    canvas.id = "shotcanvas";
    canvas.width = 256;
    canvas.height = 256;
    canvas.style.width = "256px";
    canvas.style.height = "256px";
    canvas.style.display = "block";
    document.body.appendChild(canvas);
    const gl = canvas.getContext("webgl2");
    gl.viewport(0, 0, 256, 256);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });

  const shotPath = require("path").join(__dirname, "shots-out", "wp3d-webgl-spike.png");
  require("fs").mkdirSync(require("path").dirname(shotPath), { recursive: true });
  const canvasHandle = await page.$("#shotcanvas");
  await canvasHandle.screenshot({ path: shotPath });

  // Decode the PNG and check a center pixel is red-ish. Use a second page (data: URL
  // with an <img> + canvas 2d) to avoid pulling in a PNG-parsing dependency.
  const png = require("fs").readFileSync(shotPath);
  const dataUrl = "data:image/png;base64," + png.toString("base64");
  const page2 = await browser.newPage({ viewport: { width: 64, height: 64 } });
  const shotCheck = await page2.evaluate(async (url) => {
    const img = new Image();
    const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    img.src = url;
    await loaded;
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
    return { w: img.width, h: img.height, px: Array.from(d) };
  }, dataUrl);
  await page2.close();

  const shotIsRed = shotCheck.px[0] > 200 && shotCheck.px[1] < 60 && shotCheck.px[2] < 60 && shotCheck.px[3] > 200;
  const shotNonBlank = png.length > 200; // trivially-empty PNGs are tiny

  await browser.close();

  const pass = inPage.ok && shotIsRed && shotNonBlank && errors.length === 0;

  console.log("=== WP3D-0 headless WebGL2 spike ===");
  console.log("headless config:", USE_FALLBACK_ARGS ? "fallback args (swiftshader forced)" : "default headless:true, no extra args");
  console.log("in-page readPixels:", inPage.ok ? "PASS" : "FAIL", inPage.px ? `(px=${JSON.stringify(inPage.px)})` : "", inPage.reason || "");
  console.log("gl RENDERER:", inPage.renderer);
  console.log("gl VERSION:", inPage.version);
  console.log("unmasked (WEBGL_debug_renderer_info):", inPage.unmasked ? JSON.stringify(inPage.unmasked) : "(extension unavailable)");
  console.log("screenshot PNG bytes:", png.length, "non-blank:", shotNonBlank);
  console.log("screenshot center pixel:", JSON.stringify(shotCheck.px), "red-ish:", shotIsRed);
  console.log("page errors/console.error during run:", errors.length, errors.join(" | "));
  console.log("");
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  process.exitCode = pass ? 0 : 1;
})();
