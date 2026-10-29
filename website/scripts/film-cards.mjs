// Финальные кадры для видео (video/end/): знак и слова NeuroMove на чёрном, 1920 × 1080,
// и знак отдельно на прозрачном фоне — для монтажа. Рисуется тем же знаком, что в приложении
// (src/ui/Logo.tsx), шрифтом страницы (Inter Display из @fontsource, как в сборке).
//   node scripts/film-cards.mjs ../video/end
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [outDir = '../video/end'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const font = (f) => `data:font/woff2;base64,${readFileSync(join('node_modules', f)).toString('base64')}`;
const fonts = `
@font-face { font-family: 'Inter Display'; font-weight: 100 900; src: url(${font('@fontsource-variable/inter/files/inter-cyrillic-ext-opsz-normal.woff2')}) format('woff2'); unicode-range: U+0460-052F; }
@font-face { font-family: 'Inter Display'; font-weight: 100 900; src: url(${font('@fontsource-variable/inter/files/inter-cyrillic-opsz-normal.woff2')}) format('woff2'); unicode-range: U+0400-045F; }
@font-face { font-family: 'Inter Display'; font-weight: 100 900; src: url(${font('@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2')}) format('woff2'); }`;
const mark = (stroke, dot) => `<svg viewBox="0 0 68 40" width="170" height="100" fill="none"><path d="M4 33V7M4 18C4 3 24 3 24 18V27C24 37 36 37 36 27V17C36 3 50 3 50 17V33M50 17C50 3 64 3 64 17V33" stroke="${stroke}" stroke-width="3.25" stroke-linecap="round" stroke-linejoin="round"/><circle cx="36" cy="21" r="3.25" fill="${dot}"/></svg>`;

const card = (sub, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
html,body{margin:0;width:1920px;height:1080px;background:#000;color:#fff;font-family:'Inter Display',sans-serif;font-optical-sizing:auto}
.c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px}
.w{font-size:96px;font-weight:300;letter-spacing:-0.05em}
.s{font-size:40px;font-weight:300;letter-spacing:-0.02em;color:rgba(255,255,255,.72)}
.n{position:absolute;left:0;right:0;bottom:64px;text-align:center;font-size:22px;color:#86868e;letter-spacing:-0.005em}
</style></head><body><div class="c">${mark('#fff', '#dc6440')}<div class="w">NeuroMove</div><div class="s">${sub}</div></div><div class="n">${note}</div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const cards = [
  ['end-card-ru.png', 'Каждый градус на счету.', 'Прототип. Видео-концепт, часть кадров сгенерирована ИИ. Точность на людях ещё не проверена.'],
  ['end-card-kk.png', 'Әр градус маңызды.', 'Прототип. Бейне-концепт, кейбір кадрлар ЖИ-мен жасалған. Адамдардағы дәлдік әлі тексерілген жоқ.'],
  ['end-card-en.png', 'Every degree counts.', 'Prototype. Concept film, some shots AI-generated. Accuracy on people not yet tested.'],
];
for (const [file, sub, note] of cards) {
  await page.setContent(card(sub, note), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outDir, file) });
}
// Знак на прозрачном фоне — белый и чёрный
for (const [file, stroke] of [['logo-white.png', '#fff'], ['logo-black.png', '#000']]) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${mark(stroke, stroke === '#fff' ? '#dc6440' : '#b7452c').replace('width="170" height="100"', 'width="680" height="400"')}</body></html>`);
  await page.locator('svg').screenshot({ path: join(outDir, file), omitBackground: true });
}
await browser.close();
console.log('ok');
