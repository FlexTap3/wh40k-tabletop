const { chromium } = require('playwright');
(async () => {
  const url = 'http://127.0.0.1:8199/wh40k-tabletop.html';
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  // 1) First visit: registers + activates the SW (this nav itself precedes SW control).
  await p.goto(url, { waitUntil: 'load' });
  await p.evaluate(() => navigator.serviceWorker.ready);
  // 2) Revisit while online: this navigation goes THROUGH the SW, caching the exact doc.
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  // 3) Cut the network and reload — must come from cache.
  await ctx.setOffline(true);
  let ok = false, title = '';
  try {
    await p.goto(url, { waitUntil: 'load', timeout: 8000 });
    title = await p.title();
    const hasApp = await p.evaluate(() =>
      document.documentElement.innerHTML.includes('WH40k') &&
      !!document.querySelector('style'));
    ok = title.includes('WH40k') && hasApp;
  } catch (e) { title = 'LOAD FAILED: ' + e.message; }
  console.log('offline reload title:', title);
  console.log('RESULT:', ok ? 'PASS ✅ app loads with network OFF' : 'FAIL ❌');
  await b.close();
  process.exit(ok ? 0 : 1);
})();
