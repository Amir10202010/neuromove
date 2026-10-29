// Сквозные тесты в настоящем браузере — Chrome, установленный на компьютере (channel: 'chrome'):
// Playwright ничего не скачивает. Тестируется собранный сайт (`vite preview`) — с той же
// политикой безопасности (CSP), что уйдёт на хостинг, а не сервер разработки.
//
//   npm run e2e            все тесты
//   npm run e2e -- --ui    по шагам, с окном

import { defineConfig, devices } from '@playwright/test';

const PORT = 4175;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel: 'chrome',
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      // На телефоне — путь демо и ширина экрана; доступность и CSP проверяются один раз
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
