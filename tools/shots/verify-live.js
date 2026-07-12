const { chromium } = require('playwright');
(async () => {
  const base = 'https://flextap3.github.io/wh40k-tabletop/';
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(base, { waitUntil: 'load' });
  const man = await p.evaluate(async () => {
    const h = document.querySelector('link[rel=manifest]').href;
    const m = await (await fetch(h)).json();
    return { name: m.name, display: m.display, icons: m.icons.length, start: m.start_url };
  });
  const apple = await p.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content');
  const sw = await p.evaluate(async () => {
    const r = await navigator.serviceWorker.ready.catch(e => 'fail:' + e);
    return typeof r === 'string' ? r : (r.active ? 'active' : 'inactive');
  });
  const scope = await p.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  console.log('manifest :', JSON.stringify(man));
  console.log('apple    :', apple);
  console.log('SW       :', sw);
  console.log('SW scope :', scope);
  console.log('pageerrs :', errs.length ? errs : 'none');
  const pass = man.name === 'WH40k Tabletop' && apple === 'yes' && sw === 'active' && (scope||'').endsWith('/wh40k-tabletop/');
  console.log('\nLIVE RESULT:', pass ? 'PASS ✅' : 'FAIL ❌');
  await b.close();
})();
