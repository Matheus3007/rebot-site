// Out-of-sequence page jumps in capture mode: checks each lands on exactly the page's state and shoots the way there.
// node tools/direct.mjs url outdir "0-3,4-0,..." [WxH]
import { chromium } from 'playwright';
const [url, out, pairs = '0-3,4-0,1-4,2-4,4-1,3-0', sz = '960x600'] = process.argv.slice(2);
const [w, h] = sz.split('x').map(Number);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: w, height: h } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__step, null, { timeout: 60000 });
const state = () => p.evaluate(() => {
  const S = window.__S, ids = ['p1', 'p2', 'p3', 'p4a', 'p4b', 'p5'];
  const own = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k[0] !== '_'));
  return { ...own(S), focus: [...S.focus], show: own(S.show), time: window.__tl.time(),
    panels: ids.map((i) => { const cs = getComputedStyle(document.getElementById(i)); return [+cs.opacity, cs.transform]; }) };
});
for (const pr of pairs.split(',')) {
  const [a, z] = pr.split('-').map(Number);
  await p.evaluate((n) => { window.__goto(n, true); window.__step(30, 1 / 30); }, z);
  await p.waitForTimeout(300);
  const ref = await state();
  await p.evaluate((n) => { window.__goto(n, true); window.__step(30, 1 / 30); }, a);
  await p.waitForTimeout(300);
  await p.evaluate((n) => window.__goto(n), z);
  const t0 = Date.now();
  for (const f of [0.6, 1.2, 1.8, 2.4]) {
    await p.waitForTimeout(Math.max(0, f * 1000 - (Date.now() - t0)));
    await p.evaluate(() => window.__step(1, 1 / 30));
    await p.screenshot({ path: `${out}/${a}-${z}-${f}.png` });
  }
  await p.waitForTimeout(Math.max(0, 3600 - (Date.now() - t0)));
  await p.evaluate(() => window.__step(1, 1 / 30));
  await p.screenshot({ path: `${out}/${a}-${z}-end.png` });
  const got = await state();
  const diffs = [];
  for (const k of Object.keys(ref)) {
    const x = JSON.stringify(ref[k]), y = JSON.stringify(got[k]);
    if (k === 'yaw' ? Math.abs(Math.atan2(Math.sin(ref.yaw - got.yaw), Math.cos(ref.yaw - got.yaw))) > 1e-6 : x !== y) diffs.push(`${k}: ${x} vs ${y}`);
  }
  console.log(pr, diffs.length ? 'DIFF ' + diffs.join(' | ') : 'exact');
}
await b.close();
