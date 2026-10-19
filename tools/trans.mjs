// Frame strip of a live page transition: node tools/trans.mjs key n interval_ms out_prefix [startPage]
import { chromium } from 'playwright';
const [key, n, iv, out, startPage = '0'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.getElementById('loader').classList.contains('done'));
await p.evaluate((s) => window.__goto(+s, true), startPage);
await p.waitForTimeout(1200);
await p.keyboard.press(key);
for (let i = 0; i < +n; i++) {
  await p.screenshot({ path: `${out}-${i}.png` });
  console.log(i, await p.evaluate(() => JSON.stringify({ m: __G.mode, k: +__G.k.toFixed(2), x: +__G.x.toFixed(3), u: +__S.u.toFixed(2), eR: +__S.eR.toFixed(2) })));
  await p.waitForTimeout(+iv);
}
console.log(errs);
await b.close();
