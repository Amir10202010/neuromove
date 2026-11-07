// Goniometer validation workflow in a real browser (demo workspace, simulator — labelled simulated):
// protocol from template → session → sensors → calibration → capture → pause for the goniometer →
// save → live statistics → reload restores the session exactly (IndexedDB).

import { expect, test } from '@playwright/test';
import { waitReady, watchErrors } from './helpers';

test('validation session: capture → goniometer → save → reload restores progress and pending capture', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);

  await page.goto('./#/research/protocols');
  await waitReady(page);
  await page.getByRole('button', { name: 'Elbow flexion — goniometer agreement' }).click();
  await page.getByRole('button', { name: 'Создать протокол' }).click();
  await expect(page.getByText('Сохранено как версия 1.')).toBeVisible();

  await page.goto('./#/research/new');
  await page.getByLabel('Участник (псевдонимный код)').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Создать сеанс и подключить датчики' }).click();
  await expect(page).toHaveURL(/#\/research\/sessions\/vs_/);
  await expect(page.getByText('Симулятор: эти значения — не измерения')).toBeVisible();

  const begin = page.locator('main').getByRole('button', { name: 'Начать тест' });
  await expect(begin).toBeEnabled({ timeout: 20_000 });
  await begin.click();

  // Calibration (3 s still) → recording → capture
  const captureBtn = page.getByRole('button', { name: /Записать значение IMU/ });
  await expect(captureBtn).toBeEnabled({ timeout: 40_000 });
  await captureBtn.click();

  // Paused: the goniometer field has focus; the next capture is refused until the value is saved
  await expect(page.getByText('Пауза — ждём показание гониометра')).toBeVisible();
  const gonio = page.getByLabel('Показание гониометра');
  await expect(gonio).toBeFocused();
  await expect(captureBtn).toHaveCount(0);
  await gonio.fill('85,5');
  await gonio.press('Enter');

  // Saved on this device; statistics and table updated from the stored trial
  await expect(page.getByText(/Сохранено на устройстве/).first()).toBeVisible();
  await expect(page.locator('.vprogress__label')).toHaveText('1 / 20');
  await expect(page.locator('.table tbody tr').first()).toContainText('85.50');

  // Second capture left pending, then reload: progress and the pending capture are restored
  await expect(captureBtn).toBeEnabled();
  await captureBtn.click();
  await expect(page.getByLabel('Показание гониометра')).toBeVisible();
  await page.reload();
  await waitReady(page);
  await expect(page.locator('.vprogress__label')).toHaveText('1 / 20');
  await expect(page.getByText('Ждёт гониометр')).toBeVisible();

  expect(errors).toEqual([]);
});
