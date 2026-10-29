// Проверка диаграмм: каждый блок ```mermaid из docs/ рендерится Mermaid 11 в Chrome.
// Синтаксическая ошибка — ненулевой код выхода. Нужен интернет (Mermaid берётся с jsDelivr).
//   node scripts/check-mermaid.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

function mdFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? mdFiles(p) : p.endsWith('.md') ? [p] : [];
  });
}

const blocks = mdFiles('docs').flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m, i) => ({ file, i: i + 1, code: m[1] })),
);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext()).newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' });
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false }));

let failed = 0;
for (const b of blocks) {
  const err = await page.evaluate(async (code) => {
    try {
      await window.mermaid.render('d' + Math.random().toString(36).slice(2), code);
      return null;
    } catch (e) {
      return String(e?.message ?? e).slice(0, 300);
    }
  }, b.code);
  if (err) failed++;
  console.log(`${err ? '✘' : '✓'} ${b.file} #${b.i}${err ? `\n    ${err}` : ''}`);
}
await browser.close();
console.log(`${blocks.length - failed} из ${blocks.length} диаграмм отрисованы`);
process.exit(failed ? 1 : 0);
