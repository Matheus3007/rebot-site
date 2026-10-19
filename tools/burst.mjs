// Burst of frames at one scroll stop: node tools/burst.mjs url vh n interval_ms out_prefix [w h]
import { chromium } from 'playwright';
const [url, vh, n, iv, out, w = 1440, h = 900] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.getElementById('loader').classList.contains('done'));
await p.evaluate((vh) => scrollTo(0, vh * innerHeight / 100), +vh);
await p.waitForTimeout(1500);
for (let i = 0; i < +n; i++) { await p.screenshot({ path: `${out}-${i}.png` }); await p.waitForTimeout(+iv); }
await b.close();
