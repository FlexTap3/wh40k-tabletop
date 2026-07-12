// Dev-only: rasterize the WH40k monogram icon to PNGs via headless Chromium.
// Outputs icon-512.png / icon-192.png / icon-180.png into ../../ (Tabletop dir).
const { chromium } = require('playwright');
const path = require('path');

// Monogram: bold "40K" in the app's gold on the app ink background, thin gold rule.
// Rendered at 512 then downscaled by the browser for crisp smaller sizes.
const svg = (px) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c191d"/>
      <stop offset="1" stop-color="#0b0a0c"/>
    </linearGradient>
    <linearGradient id="au" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8c34a"/>
      <stop offset="1" stop-color="#c9a227"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="26" y="26" width="460" height="460" rx="90" fill="none" stroke="url(#au)" stroke-width="10" opacity="0.85"/>
  <text x="256" y="232" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, 'Times New Roman', serif" font-weight="700"
        font-size="200" letter-spacing="-2" fill="url(#au)">40K</text>
  <text x="256" y="392" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, serif" font-weight="700" font-size="50"
        letter-spacing="16" fill="#ddd6cc" opacity="0.7">WH40K</text>
</svg>`;

(async () => {
  const outDir = path.resolve(__dirname, '../../');
  const browser = await chromium.launch();
  for (const size of [512, 192, 180]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    // Always render the 512 artwork; the viewport downscales it for smaller icons.
    const html = `<!doctype html><meta charset=utf-8><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg(size)}`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    const el = await page.$('svg');
    const file = path.join(outDir, `icon-${size}.png`);
    await el.screenshot({ path: file, omitBackground: false });
    console.log('wrote', file);
    await page.close();
  }
  await browser.close();
})();
