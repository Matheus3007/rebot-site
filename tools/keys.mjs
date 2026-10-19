// Key pages in capture mode (needs ?capture=1): node tools/keys.mjs url outdir pages [WxH,...]
import { chromium } from 'playwright';
const [url, out, pages = '0,1,2,3,4', sizes = '1200x750,390x844'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const sz of sizes.split(',')) {
  const [w, h] = sz.split('x').map(Number);
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__step, null, { timeout: 60000 });
  for (const n of pages.split(',').map(Number)) {
    await p.evaluate((n) => { window.__goto(n, true); window.__step(45, 1 / 30); }, n);
    await p.screenshot({ path: `${out}/${w}-p${n}.png` });
    console.log('shot', w, n);
  }
  await p.close();
}
await b.close();
