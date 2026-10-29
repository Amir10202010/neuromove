import { expect, type Page } from '@playwright/test';

/** Ошибки консоли и необработанные исключения страницы. Тест сверяет список с пустым. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Приложение загрузилось: прошла подготовка демо (первый запуск — симуляция ~2 с). */
export async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('.boot')).toHaveCount(0, { timeout: 30_000 });
}

/** Новый тест для первого ребёнка демо (Алихан) → датчики на связи → «Начать тест» → идёт запись. */
export async function startDemoTest(page: Page): Promise<void> {
  await page.goto('./#/session/new?patient=demo-p01&protocol=upper_quick');
  await waitReady(page);
  await page.locator('main').getByRole('button', { name: 'Надеть датчики' }).click();
  await expect(page).toHaveURL(/#\/session\/run/);
  const begin = page.locator('main').getByRole('button', { name: 'Начать тест' });
  await expect(begin).toBeEnabled({ timeout: 20_000 });
  await begin.click();
  await expect(page.getByText('Шаг 1 из 4')).toBeVisible({ timeout: 30_000 });
}

/** Файл записи imu-csv v1 с одним датчиком — для проверки повтора записи. */
export function recordingCsv(passportExtra: string, device = 'NM-01'): Buffer {
  const lines = [
    '# imu-csv v1',
    `# device=${device} fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=fore_r`,
    `# ${passportExtra}`,
    'seq,fore_r_ax,fore_r_ay,fore_r_az,fore_r_gx,fore_r_gy,fore_r_gz',
  ];
  for (let i = 0; i < 300; i++) lines.push(`${i},-8192,0,0,0,0,0`);
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}
