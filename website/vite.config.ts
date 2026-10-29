import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Две сборки из одного кода:
//   npm run build       → dist/        — обычный сайт (GitHub Pages, любой хостинг)
//   npm run build:demo  → demo/NeuroMove.html — ОДИН файл: всё внутри, включая шрифты.
//                          Открывается двойным щелчком, без Node.js и без интернета —
//                          для показа в клинике, где Wi-Fi может не быть.

// Политика безопасности страницы (CSP). Обещание «данные остаются на компьютере клиники»
// держится не только на том, что в коде нет сетевых вызовов: браузер сам запрещает странице
// любые запросы (`connect-src 'none'`), чужие скрипты, отправку форм и встраивание объектов.
// Web Serial и Web Bluetooth политикой не управляются — датчики работают. Только для сборок:
// сервер разработки Vite держит связь через WebSocket и вставляет свои скрипты.
function contentPolicy(scriptSrc: string): string {
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    // React пишет стили в атрибут style, в демо одним файлом CSS лежит в <style>
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Вставить политику сразу после <meta charset> — до первого скрипта. */
function withPolicy(html: string, policy: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  return html.replace(/(<meta charset="[^"]*"\s*\/?>)/i, `$1\n    ${meta}`);
}

/** Сайт в dist/: скрипт — отдельным файлом, разрешаем только свои файлы. */
function sitePolicy(): Plugin {
  return {
    name: 'neuromove-site-policy',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: (html) => withPolicy(html, contentPolicy("'self'")) },
  };
}

/**
 * Фото первого экрана грузится вместе со скриптом, а не после него. Без подсказки браузер узнаёт
 * о картинке, только когда скрипт скачан и React отрисовал страницу: на медленном телефоне (4G, CPU ×4)
 * LCP был 2,96 с. Только для сайта — в демо одним файлом картинки уже внутри страницы.
 * imagesrcset и imagesizes — те же, что у <img> в HeroPhoto.tsx: иначе браузер скачает фото дважды.
 */
function heroPreload(): Plugin {
  return {
    name: 'neuromove-hero-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const files = Object.values(ctx.bundle ?? {}).map((f) => f.fileName);
        const small = files.find((f) => /movement-study-768-[\w-]+\.webp$/.test(f));
        const large = files.find((f) => /movement-study-1536-[\w-]+\.webp$/.test(f));
        if (!small || !large) return html;
        const link = `<link rel="preload" as="image" fetchpriority="high" imagesrcset="./${small} 768w, ./${large} 1536w" imagesizes="(max-width: 700px) 170vw, 100vw" />`;
        return html.replace('</head>', `  ${link}\n  </head>`);
      },
    },
  };
}

/**
 * После сборки демо-файла: политика с хешами встроенных скриптов (в одном файле скрипт лежит
 * внутри страницы, 'self' для file:// не работает) и dist-demo/index.html → demo/NeuroMove.html.
 */
function moveDemoFile(): Plugin {
  return {
    name: 'neuromove-move-demo-file',
    apply: 'build',
    closeBundle() {
      const from = resolve(__dirname, 'dist-demo/index.html');
      if (!existsSync(from)) return;
      // Иконку вкладки Vite оставляет отдельным файлом и в демо — встраиваем её в страницу сами
      const html = readFileSync(from, 'utf8').replace(/href="\.\/([\w.-]+\.svg)"/g, (whole, file: string) => {
        const path = resolve(__dirname, 'dist-demo', file);
        if (!existsSync(path)) return whole;
        return `href="data:image/svg+xml;base64,${readFileSync(path).toString('base64')}"`;
      });
      const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash('sha256').update(m[1] ?? '', 'utf8').digest('base64')}'`,
      );
      mkdirSync(resolve(__dirname, 'demo'), { recursive: true });
      writeFileSync(resolve(__dirname, 'demo/NeuroMove.html'), withPolicy(html, contentPolicy(hashes.join(' '))));
      rmSync(resolve(__dirname, 'dist-demo'), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const singleFile = mode === 'demo';
  return {
    // Относительные пути: сайт работает и из подпапки GitHub Pages, и с диска (file://).
    base: './',
    plugins: [react(), ...(singleFile ? [viteSingleFile(), moveDemoFile()] : [sitePolicy(), heroPreload()])],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    build: singleFile
      ? { outDir: 'dist-demo', assetsInlineLimit: 100_000_000, cssCodeSplit: false, emptyOutDir: true }
      : { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  };
});
