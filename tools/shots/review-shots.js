// One-off review screenshots of the live app + metatracker site.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = __dirname + '/shots-out';
  const shots = [
    { url: 'https://flextap3.github.io/wh40k-tabletop/', name: 'app-desktop', vp: { width: 1440, height: 900 } },
    { url: 'https://flextap3.github.io/wh40k-tabletop/', name: 'app-phone', vp: { width: 390, height: 844 } },
    { url: 'https://flextap3.github.io/metatracker-site/', name: 'site-desktop', vp: { width: 1440, height: 900 }, full: true },
    { url: 'https://flextap3.github.io/metatracker-site/', name: 'site-phone', vp: { width: 390, height: 844 }, full: true },
  ];
  for (const s of shots) {
    const pg = await b.newPage({ viewport: s.vp });
    await pg.goto(s.url, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => console.log(s.name, 'goto:', e.message));
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: `${out}/${s.name}.png`, fullPage: !!s.full });
    console.log('shot', s.name);
    await pg.close();
  }
  await b.close();
})();
