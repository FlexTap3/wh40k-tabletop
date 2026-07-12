/* wp3d-motion-shots.js — WP3D-10 visual verification: musters the board, toggles 3D on,
 * then (a) scripts a remote-style committed move (direct state mutation + draw(), mimicking
 * what an incoming network op looks like) and screenshots it mid-flight (airborne between
 * start/end), and (b) triggers the app's REAL attack roller (quickRoll()/d6()) and
 * screenshots the resulting physical dice on the table. Best-effort visual check for the
 * motion packet — not part of the pass/fail test suite (tools/tests/*.js are that).
 * Run: cd tools/shots && node wp3d-motion-shots.js
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'shots-out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/wh40k-tabletop.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end('nope'); }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  let fails = 0;
  const check = (c, msg) => { console.log((c ? 'ok - ' : 'FAIL: ') + msg); if (!c) fails++; };

  await page.goto(`http://127.0.0.1:${port}/wh40k-tabletop.html`);
  await page.waitForFunction(() => { const cv = document.getElementById('board'); return cv && cv.width > 0; });

  const nTok = await page.evaluate(() => {
    const sel = document.getElementById('terrLayout');
    const opts = [...sel.querySelectorAll('option')];
    const opt = opts.find((o) => /Official 1A/i.test(o.value)) || opts[0];
    sel.value = opt.value; loadLayout();
    if (typeof wpImportPopulate === 'function') wpImportPopulate();
    const pick = document.getElementById('metaListPick');
    pick.value = '0'; wpImportSelected();
    setSide('2'); pick.value = '1'; wpImportSelected(); setSide('1');
    fitView(); draw();
    return state.tokens.length;
  });
  check(nTok > 0, `mustered board has ${nTok} tokens`);

  await page.evaluate(() => { const el = document.getElementById('wp3d'); el.checked = true; return wp3dToggle(); });
  await page.waitForFunction(() => typeof window.wp3dOnDraw === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(600); // let the scene settle/render a few frames

  // Zoom in on the board via real wheel events (the actual WP3D-4 interaction path) so the
  // moved token and thrown dice aren't lost in a tiny wide shot of the whole 122-token board.
  const board3d = page.locator('#board3d');
  const box = await board3d.boundingBox();
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);

  // -----------------------------------------------------------------------------------
  // (a) remote-move mid-flight: mutate a token's committed position directly (this is
  // exactly what an incoming P2P "tok~" op does — a single, instant state write, never a
  // stream of small deltas) then screenshot ~225ms later (half the 450ms arc).
  // -----------------------------------------------------------------------------------
  const moveInfo = await page.evaluate(() => {
    const b = state.board || { w: 60, h: 44 };
    const cx = b.w / 2, cy = b.h / 2;
    // pick the token closest to board center — that's roughly where the camera is now
    // framed after the wheel-zoom above, so the move reads clearly in the screenshot.
    let t = state.tokens[0], best = Infinity;
    for (const tk of state.tokens) {
      const d = Math.hypot(tk.x - cx, tk.y - cy);
      if (d < best) { best = d; t = tk; }
    }
    const from = { x: t.x, y: t.y };
    t.x = Math.min(b.w - 2, t.x + 8);
    t.y = Math.min(b.h - 2, t.y + 5);
    draw(); // marks the 3D module dirty so sceneSync writes the final (landed) position
    return { id: t.id, from, to: { x: t.x, y: t.y } };
  });
  await page.waitForTimeout(225); // mid-flight (450ms arc)
  const shotMidFlight = path.join(OUT, 'wp3d-motion-remote-move-midflight.png');
  const bufMid = await page.locator('#board3d').screenshot({ path: shotMidFlight });
  check(bufMid.length > 20000, `remote-move mid-flight screenshot is contentful (${bufMid.length} bytes) — token ${moveInfo.id} ${JSON.stringify(moveInfo.from)} -> ${JSON.stringify(moveInfo.to)}`);
  await page.waitForTimeout(600); // let it land + settle so it doesn't bleed into the next shot

  // -----------------------------------------------------------------------------------
  // (b) real dice: the app's actual attack-roller path (quickRoll() -> N x d6() ->
  // wp20Note -> wp3dDiceCbs -> bridge.onDice -> this module's batcher/throw).
  // -----------------------------------------------------------------------------------
  const rolled = await page.evaluate(() => {
    document.getElementById('qtyDice').value = 14; // > DICE_CAP(12), exercises overflow too
    quickRoll();
    return true;
  });
  check(rolled, 'quickRoll() (the real attack-roller d6 path) fired 14 d6');
  await page.waitForTimeout(120 + 550); // batch-close window + most of the 700ms throw arc
  const shotDiceThrow = path.join(OUT, 'wp3d-motion-dice-throw.png');
  const bufThrow = await page.locator('#board3d').screenshot({ path: shotDiceThrow });
  check(bufThrow.length > 20000, `dice mid-throw screenshot is contentful (${bufThrow.length} bytes)`);
  await page.waitForTimeout(400); // let dice land + settle
  const shotDiceRest = path.join(OUT, 'wp3d-motion-dice-rest.png');
  const bufRest = await page.locator('#board3d').screenshot({ path: shotDiceRest });
  check(bufRest.length > 20000, `dice resting-on-table screenshot is contentful (${bufRest.length} bytes)`);

  const fatal = errors.filter((e) => !/favicon|manifest|sw\.js|peerjs|unpkg/i.test(e));
  check(fatal.length === 0, 'no console/page errors' + (fatal.length ? ': ' + fatal.slice(0, 5).join(' | ') : ''));

  await browser.close();
  srv.close();
  console.log(fails ? `WP3D MOTION SHOTS: ${fails} FAILURES` : 'WP3D MOTION SHOTS: ALL PASSED');
  process.exitCode = fails ? 1 : 0;
})();
