// Headless screenshots of each scroll stop: node tools/shots.mjs [url] [outdir] [vh,vh,...]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/?still';
const out = process.argv[3] || 'shots';
const stops = (process.argv[4] || '0,160,300,420,560,700,860,980,1140').split(',').map(Number);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [tag, vp] of [['desk', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  if (process.env.ONLY && process.env.ONLY !== tag) continue;
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  const types = {};
  page.on('response', (r) => { if (/\.(glb|gltf|bin)(\?|$)/.test(r.url())) types[r.url()] = r.headers()['content-type']; });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('loader').classList.contains('done'), null, { timeout: 60000 });
  for (const vh of stops) {
    await page.evaluate((vh) => window.scrollTo(0, vh * innerHeight / 100), vh);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${out}/${tag}-${String(vh).padStart(4, '0')}.png` });
  }
  console.log(tag, JSON.stringify(types), '\n' + logs.join('\n'));
  await page.close();
}
await browser.close();
