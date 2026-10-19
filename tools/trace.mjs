// Per-frame trace of the procedural drive after a key press: node tools/trace.mjs key ms [startPage]
import { chromium } from 'playwright';
const [key, ms, startPage = '0'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.getElementById('loader').classList.contains('done'));
await p.evaluate((s) => window.__goto(+s, true), startPage);
await p.waitForTimeout(1000);
await p.evaluate(() => { window.__tr = []; const t0 = performance.now(); const f = () => { __tr.push([((performance.now() - t0) / 1000).toFixed(2), __G.mode, __G.x.toFixed(3), __G.z.toFixed(3), __G.h.toFixed(2), __G.v.toFixed(2), __G.k.toFixed(2)]); requestAnimationFrame(f); }; f(); });
await p.keyboard.press(key);
await p.waitForTimeout(+ms);
const tr = await p.evaluate(() => __tr);
const step = Math.max(1, Math.floor(tr.length / 30));
tr.filter((_, i) => i % step === 0).forEach((r) => console.log(r.join(' ')));
await b.close();
