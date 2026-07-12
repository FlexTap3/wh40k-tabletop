// Dev-only: verify the PWA layer loads (manifest parses, SW registers, icons resolve, no console errors).
const { chromium } = require('playwright');
(async () => {
  const base = 'http://127.0.0.1:8199/wh40k-tabletop.html';
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(base, { waitUntil: 'load' });

  // Manifest link + parse
  const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
  const manifest = await page.evaluate(async (h) => (await fetch(h)).json(), manifestHref);

  // Apple meta tags present
  const appleCapable = await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content');
  const touchIcon = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');

  // Service worker registers + controls the page
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.ready.catch((e) => 'ready-failed: ' + e);
    if (typeof reg === 'string') return reg;
    return reg.active ? 'active' : 'registered-not-active';
  });

  // Icons fetch 200 + correct content-type
  const iconOk = await page.evaluate(async () => {
    const out = {};
    for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png']) {
      const r = await fetch(f);
      out[f] = r.status + ' ' + r.headers.get('content-type');
    }
    return out;
  });

  console.log('manifest.name     :', manifest.name, '| display:', manifest.display, '| icons:', manifest.icons.length);
  console.log('apple-capable     :', appleCapable);
  console.log('apple-touch-icon  :', touchIcon);
  console.log('serviceWorker     :', swState);
  console.log('icons             :', JSON.stringify(iconOk));
  console.log('console errors    :', errors.length ? errors : 'none');

  const pass = manifest.name && appleCapable === 'yes' && touchIcon === 'icon-180.png'
    && swState === 'active' && Object.values(iconOk).every((v) => v.startsWith('200'));
  console.log('\nRESULT:', pass ? 'PASS ✅' : 'FAIL ❌');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
