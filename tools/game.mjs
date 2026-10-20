// Lane steering and the ending minigame in capture mode: lane trace, one aimed click (fine frames, hits),
// side clicks, and the step's cost. node tools/game.mjs outdir   (needs the dev server)
import { chromium } from 'playwright';
const out = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:5173/?capture=1&fx=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__step, null, { timeout: 60000 });
const step = (n, draw) => p.evaluate(([n, d]) => { window.__step(n, 1 / 30, d); return { x: window.__lane.x, d: window.__lane.d, n: window.__boxes.count, ...window.__boxes.stats }; }, [n, draw]);
// lane: right, then left of the robot on the landing
await p.evaluate(() => window.__goto(0, true));
for (const [x, tag] of [[940, 'R'], [560, 'L']]) {
  await p.mouse.move(x, 450);
  const tr = [];
  for (let i = 0; i < 8; i++) { const r = await step(8, i === 7); tr.push(`${r.x.toFixed(3)}/${r.d.toFixed(2)}`); if (i === 2 || i === 7) await p.screenshot({ path: `${out}/lane-${tag}-${i}.png` }); }
  console.log('lane', tag, 'x/heading', tr.join(' '));
}
await p.evaluate(() => window.__goto(4, true));
await p.mouse.move(250, 420); await step(60, false);
let s0 = await step(0, false);
await p.mouse.click(250, 520);
for (let i = 0; i < 30; i++) { await step(3, true); await p.screenshot({ path: `${out}/fine-${String(i).padStart(2, '0')}.png` }); }
let r = await step(0, false); console.log('aimed: hits', r.hits - s0.hits, 'shoves', r.shoves - s0.shoves, 'alive', r.n);
await step(120, false);
s0 = await step(0, false);
for (const x of [80, 120, 330, 380]) { await p.mouse.move(x, 420); await step(20, false); await p.mouse.click(x, 520); await step(40, false); }
r = await step(0, false); console.log('four more: hits', r.hits - s0.hits, 'shoves', r.shoves - s0.shoves);
const cost = await p.evaluate(() => {
  const t = (n) => { const a = performance.now(); window.__step(n, 1 / 60, false); return (performance.now() - a) / n; };
  const none = t(300);
  for (let i = 0; i < 12; i++) document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200 + i * 10, clientY: 560 }));
  return { none, full: t(300), n: window.__boxes.count };
});
console.log('ms/frame (no draw) idle', cost.none.toFixed(3), 'busy', cost.full.toFixed(3), 'objects', cost.n);
await b.close();
