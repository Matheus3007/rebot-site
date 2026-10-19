// Load timing + requests: node tools/perf.mjs url [slow]   ('slow' = 10 Mbit/s, 40 ms latency)
import { chromium } from 'playwright';
const [url, net] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await p.context().newCDPSession(p);
if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8 });
const res = [];
p.on('requestfinished', async (r) => { const t = r.timing(); const s = await r.sizes().catch(() => ({})); res.push([r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60), (s.responseBodySize / 1024).toFixed(0) + 'KB', (t.responseEnd).toFixed(0) + 'ms']); });
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => document.getElementById('loader').classList.contains('done') && (window.__ready = window.__ready || performance.now()), null, { timeout: 120000, polling: 'raf' });
const T = await p.evaluate(() => ({ ready: window.__ready, dom: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart }));
console.log(`DOMContentLoaded ${T.dom}ms | ready (loader off) ${T.ready.toFixed(0)}ms | wall ${Date.now() - t0}ms`);
res.forEach((r) => console.log('  ', r.join('  ')));
await b.close();
