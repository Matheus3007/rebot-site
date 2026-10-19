// Frames at fractions through a timeline segment: node tools/segment.mjs from to out
import { chromium } from 'playwright';
const [a, b, out] = process.argv.slice(2);
const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await br.newPage({ viewport: { width: 720, height: 450 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.getElementById('loader').classList.contains('done'));
const fr = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
for (let i = 0; i < fr.length; i++) {
  await p.evaluate((t) => window.__tl.seek(t, false), +a + fr[i] * (+b - +a));
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}-${i}.png` });
}
await br.close();
