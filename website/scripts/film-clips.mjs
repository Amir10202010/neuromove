// Настоящие кадры NeuroMove для видео (video/): короткие ролики из стартовой страницы,
// снятые покадрово, а не записью экрана, — поэтому они чёткие и плавные при любой скорости машины.
//
// Как: время страницы подменяет часы Playwright (page.clock) — анимации на requestAnimationFrame
// идут ровно на 1/30 с за кадр; анимации и переходы CSS ставятся на нужный момент вручную
// (document.getAnimations, currentTime). Каждый кадр — снимок части экрана в удвоенном разрешении;
// ffmpeg собирает кадры в mp4 1920 × 1080, 30 к/с, на чёрном поле.
//
// Нужен запущенный dev-сервер (npm run dev) и ffmpeg:
//   node scripts/film-clips.mjs http://localhost:5173/#/ ../video/ui [имя ролика]
// Ролики: hero — шкала угла рисуется на фото; model — модель датчика разбирается;
// live — экран теста вживую; report — рука на листе отчёта идёт от 127° к 144°;
// study — хронофотография подъёма руки. Ролик study снят из коммита ed6f200: секция
// «Специалистам» убрана со страницы 19 октября.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url = 'http://localhost:5173/#/', outDir = '../video/ui', only] = process.argv.slice(2);
const FPS = 30;
const VW = 1920;
const VH = 1080;

const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Ролики: что прячем на время съёмки, что снимаем и что меняем в каждом кадре. */
const CLIPS = {
  hero: {
    seconds: 4,
    css: `.lp-nav, .lp-hero__content { display: none !important; }
          .lp-hero__media { top: 0 !important; }
          .lp-hero__media::after { display: none !important; }
          .hp { transform: none !important; }`,
    target: '.lp-hero__media',
    scrollTo: 0,
    // Шкала рисуется по таймеру страницы: с часами Playwright она идёт кадр в кадр
    restartReveal: true,
  },
  model: {
    seconds: 8,
    css: `.lp-nav { display: none !important; }
          .lp-how__readout, .lp-how__signal, .lp-how__report { display: none !important; }
          .lp-how__art { transform: none !important; }`,
    target: '.lp-how__art',
    // Модель закреплена (sticky): встаём внутрь сцены, а не центрируем сам рисунок
    scrollToSel: '#lp-how',
    offset: 400,
    frame: (page, t) =>
      page.evaluate(
        ({ a, b }) => {
          const el = document.querySelector('.lp-how__art');
          el.style.setProperty('--a', String(a));
          el.style.setProperty('--b', String(b));
          el.style.setProperty('--c', '0');
        },
        // 0–1 с собран, 1–3 с слои расходятся, 4–6 с «камера» на плате
        { a: smooth((t - 1) / 2), b: smooth((t - 4) / 2) },
      ),
  },
  live: {
    seconds: 8,
    css: `.lp-nav { display: none !important; }
          body, .lp, .lp-product { background: #000 !important; }
          .lp-tab { transform: none !important; }
          .ps__spot { display: none !important; }`,
    target: '.lp-tab',
    center: true,
  },
  report: {
    seconds: 5,
    css: `.lp-nav { display: none !important; }
          body, .lp, .lp-families { background: #000 !important; }
          .lp-families__sheet { transform: none !important; opacity: 1 !important; }`,
    target: '.lp-families__sheet .rs',
    center: true,
    // Рука на шкале идёт от прокрутки: подставляем лист туда, где он был бы при нужной прокрутке
    setup: (page) =>
      page.evaluate(() => {
        const wrap = document.querySelector('.lp-families__sheet');
        const real = wrap.getBoundingClientRect.bind(wrap);
        wrap.getBoundingClientRect = () => {
          const r = real();
          if (window.__fakeTop === undefined) return r;
          return new DOMRect(r.x, window.__fakeTop, r.width, r.height);
        };
      }),
    frame: (page, t) =>
      page.evaluate((p) => {
        // 0 — верх листа на 95 % высоты экрана, 1 — на 40 % (Families.tsx)
        const vh = window.innerHeight;
        window.__fakeTop = (0.95 - 0.55 * p) * vh;
        window.dispatchEvent(new Event('scroll'));
      }, smooth((t - 0.6) / 3)),
  },
  study: {
    seconds: 6,
    css: `.lp-nav { display: none !important; }
          .lp-study { opacity: 1 !important; transform: none !important; }`,
    target: '.lp-study:first-child .ms',
    center: true,
    // Шкала и число выходят за рамку рисунка — снимаем с полями
    pad: 56,
    frame: (page, t) =>
      page.evaluate((p) => {
        document.querySelector('.lp-study:first-child').style.setProperty('--p', String(p));
      }, Math.min(1, Math.max(0, (t - 0.4) / 4))),
  },
};

const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, clip] of Object.entries(CLIPS)) {
  if (only && only !== name) continue;
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, locale: 'ru-RU' });
  await ctx.clock.install({ time: new Date('2026-10-18T10:00:00') });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  // Демо-данные считаются на часах страницы: прокручиваем время, пока лист отчёта не получит цифры
  for (let i = 0; i < 120; i++) {
    await page.clock.runFor(500);
    if (await page.locator('.rs:not(.rs--ghost) .dial__now, .rs:not(.rs--ghost)').count()) break;
  }
  await page.addStyleTag({ content: clip.css });
  const exists = await page.locator(clip.target).count();
  if (!exists) {
    console.log(name, 'пропущен: на странице нет', clip.target);
    await ctx.close();
    continue;
  }
  if (clip.scrollTo !== undefined) {
    await page.evaluate((y) => window.scrollTo(0, y), clip.scrollTo);
  } else if (clip.scrollToSel) {
    await page.evaluate(
      ([sel, off]) => window.scrollTo(0, document.querySelector(sel).getBoundingClientRect().top + window.scrollY + off),
      [clip.scrollToSel, clip.offset ?? 0],
    );
  } else if (clip.center) {
    await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      window.scrollTo(0, r.top + window.scrollY - (window.innerHeight - r.height) / 2);
    }, clip.target);
  }
  await page.clock.runFor(600);
  if (clip.setup) await clip.setup(page);
  if (clip.restartReveal) {
    // Первый экран: шкала начинается заново — снимаем data-run и ждём, пока страница поставит его сама
    await page.reload({ waitUntil: 'load' });
    await page.addStyleTag({ content: clip.css });
  }
  const box = await page.evaluate(
    ([sel, pad]) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      const x = Math.max(0, r.x - pad);
      const y = Math.max(0, r.y - pad);
      return { x, y, width: Math.min(r.right + pad, window.innerWidth) - x, height: Math.min(r.bottom + pad, window.innerHeight) - y };
    },
    [clip.target, clip.pad ?? 0],
  );
  const dir = join(outDir, `.frames-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = clip.seconds * FPS;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    if (clip.frame) await clip.frame(page, t);
    await page.clock.runFor(1000 / FPS);
    // Анимации и переходы CSS идут по настоящему времени — ставим их на момент кадра
    // (у каждой анимации своё начало — момент кадра, когда она появилась)
    await page.evaluate((ms) => {
      for (const a of document.getAnimations()) {
        if (a.__t0 === undefined) a.__t0 = ms;
        a.pause();
        a.currentTime = ms - a.__t0;
      }
    }, t * 1000);
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.png`), clip: box, animations: 'allow' });
  }
  await ctx.close();
  const out = join(outDir, `neuromove-${name}.mp4`);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%04d.png'),
    '-vf', `scale=w=${VW}:h=${VH}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${VW}:${VH}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', out,
  ]);
  // Кадр-обложка — середина ролика
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(clip.seconds * 0.75), '-i', out, '-frames:v', '1', join(outDir, `neuromove-${name}.png`)]);
  rmSync(dir, { recursive: true, force: true });
  console.log(name, `${n} кадров за ${Math.round((Date.now() - t0) / 1000)} с →`, out);
}
await browser.close();
