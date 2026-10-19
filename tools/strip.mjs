// Key frames through one timeline span, deterministic (needs the page's ?capture=1 mode):
// node tools/strip.mjs url from to frames seconds out_prefix [w h]
// The span plays over `seconds` of sim time at 30 steps/s; each frame is one render, then a screenshot.
import { chromium } from 'playwright';
const [url, a, b, n, secs, out, w = 640, h = 400] = process.argv.slice(2);
const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await br.newPage({ viewport: { width: +w, height: +h } });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__step, null, { timeout: 60000 });
await p.evaluate(() => window.__step(60, 1 / 30, false)); // let the zig-zag get going
const per = Math.round(+secs * 30 / +n);
for (let i = 0; i <= +n; i++) {
  await p.evaluate(([a, b, n, i, per]) => {
    for (let k = 0; k < per; k++) {
      const x = Math.min(1, (i - 1 + (k + 1) / per) / n);
      window.__tl.seek(a + (b - a) * Math.max(0, x), false);
      window.__step(1, 1 / 30, false);
    }
    window.__step(1, 1 / 30);
  }, [+a, +b, +n, i, i ? per : 0]);
  await p.screenshot({ path: `${out}-${String(i).padStart(2, '0')}.png` });
  console.log('frame', i);
}
await br.close();
