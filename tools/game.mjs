// Ending minigame in capture mode: aimed and side clicks (hit / shove counts), fine frames, step cost.
// node tools/game.mjs outdir   (needs the dev server)
import { chromium } from 'playwright';
const out = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:5173/?capture=1&fx=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__step, null, { timeout: 60000 });
await p.evaluate(() => window.__goto(4, true));
for (const [mx, label] of [[250, 'aim'], [60, 'side']]) {
  await p.mouse.move(mx, 420);
  await p.evaluate(() => window.__step(60, 1 / 30, false));
  const s0 = await p.evaluate(() => ({ ...window.__boxes.stats }));
  await p.mouse.click(mx, 560);
  for (let i = 0; i < 16; i++) {
    const r = await p.evaluate(() => { window.__step(3, 1 / 30, false); window.__step(1, 1 / 30); return { n: window.__boxes.count, ...window.__boxes.stats }; });
    if (label === 'aim') await p.screenshot({ path: `${out}/fine-${String(i).padStart(2, '0')}.png` });
    if (i === 15) console.log(label, 'hits', r.hits - s0.hits, 'shove frames', r.shoves - s0.shoves, 'alive', r.n);
  }
  await p.evaluate(() => window.__step(150, 1 / 30, false));
}
// per-frame cost of the box step with a full set (24) on screen, vs none
const cost = await p.evaluate(() => {
  const t = (n) => { const a = performance.now(); window.__step(n, 1 / 60, false); return (performance.now() - a) / n; };
  const none = t(300);
  for (let i = 0; i < 8; i++) document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200 + i * 10, clientY: 560 }));
  return { none, full: t(300), n: window.__boxes.count };
});
console.log('ms/frame (no draw) none', cost.none.toFixed(3), 'with', cost.n, 'boxes', cost.full.toFixed(3));
await b.close();
