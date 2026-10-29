// Замер стартовой страницы на рабочей сборке: LCP, CLS за прокрутку всей страницы, длинные задачи
// за 10 секунд на сцене «Как это работает» (модель датчика и живой угол). Профиль телефона — как у Lighthouse: процессор ×4,
// «медленный 4G» (150 мс, 1,6 Мбит/с). Нужен запущенный сайт из dist/:
//   npm run build && npx vite preview --port 4174
//   node scripts/perf-landing.mjs http://localhost:4174/#/ 375 812 4 4g
//   node scripts/perf-landing.mjs http://localhost:4174/#/ 1440 900 1 none
import { chromium } from 'playwright';
const [url, w, h, cpu = '1', net = 'none'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu });
if (net === '4g') {
  await cdp.send('Network.enable');
  // «медленный 4G» из Lighthouse: 150 мс задержки, 1,6 Мбит/с вниз
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
}
await page.addInitScript(() => {
  window.__perf = { lcp: 0, lcpEl: '', cls: 0, long: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__perf.lcp = e.startTime; window.__perf.lcpEl = e.element ? e.element.tagName + '.' + (e.element.className || '') : ''; } }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
});
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
const loadMs = Date.now() - t0;
await page.waitForTimeout(2500);
const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transfer: n.transferSize }; });
const lcpEarly = await page.evaluate(() => ({ ...window.__perf, long: [...window.__perf.long] }));
// прокрутка всей страницы — CLS и появление блоков
const H = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < H; y += 300) { await page.mouse.wheel(0, 300); await page.waitForTimeout(60); }
await page.waitForTimeout(800);
// сцена «Как это работает»: 10 секунд
await page.evaluate(() => { window.__perf.long = []; document.getElementById('lp-how').scrollIntoView(); });
await page.waitForTimeout(10000);
const after = await page.evaluate(() => ({ cls: window.__perf.cls, long: window.__perf.long }));
const res = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => ({ n: r.name.split('/').pop().slice(0, 40), kb: Math.round(r.transferSize / 1024) })).filter((r) => r.kb > 5));
console.log(JSON.stringify({ url, w, cpu, net, loadMs, nav, lcpMs: Math.round(lcpEarly.lcp), lcpEl: lcpEarly.lcpEl, longOnLoad: lcpEarly.long, clsAfterScroll: Number(after.cls.toFixed(4)), longDuringScene: after.long, resources: res }, null, 1));
await browser.close();
