// Computational motor-learning lab in a real browser (demo workspace, Russian, built site with production CSP):
// overview → Explorer (models, exclusion with reason, freeze) → report (reproduced, exports pseudonymised) →
// Study Designer (save, freeze, use as analysis plan) → Twin (scope, sandbox labelled hypothetical, assistant) →
// Movement Lab (imu-csv file) → reload keeps runs and protocols.

import { expect, test } from '@playwright/test';
import { waitReady, watchErrors } from './helpers';

/** imu-csv v1 with a still period and four slow raises of the right upper arm (rotation about the sensor y axis). */
function raisesCsv(): Buffer {
  const lines = ['# imu-csv v1', '# device=NM-01 fw=0.1 rate_hz=100 acc_g=4 gyro_dps=1000 sensors=upper_r', '# operator=e2e', 'seq,upper_r_ax,upper_r_ay,upper_r_az,upper_r_gx,upper_r_gy,upper_r_gz'];
  let angle = 0; // elevation, degrees
  for (let i = 0; i < 2600; i++) {
    const t = i / 100;
    let w = 0; // °/s
    if (t > 4) {
      const c = (t - 4) % 5; // 5 s cycle: 1.5 s raise, 1 s hold, 1.5 s lower, 1 s rest
      if (c < 1.5) w = 60 * Math.sin((Math.PI * c) / 1.5) * (Math.PI / 2);
      else if (c >= 2.5 && c < 4) w = -60 * Math.sin((Math.PI * (c - 2.5)) / 1.5) * (Math.PI / 2);
    }
    angle += w / 100;
    const a = (angle * Math.PI) / 180;
    // gravity in sensor frame: X along the bone (down when hanging) → "up" = −X at rest
    const ax = Math.round(-8192 * Math.cos(a));
    const az = Math.round(8192 * Math.sin(a));
    lines.push(`${i},${ax},${(i % 3) - 1},${az},${(i % 2) - 1},${Math.round(w * 32.8)},${(i % 3) - 1}`);
  }
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

test('motor-learning lab: explore, freeze, reproduce, design, simulate, analyse raw @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('./#/research/lab');
  await waitReady(page);
  await expect(page.getByRole('heading', { name: 'Лаборатория двигательного научения' })).toBeVisible();
  await expect(page.getByText('Синтетические демонстрационные данные')).toBeVisible();

  // Explorer: the scripted steady improvement of demo-p01 (right shoulder flexion) selects a model of change
  await page.goto('./#/research/learning?p=demo-p01&task=shoulder_flexion%3Aright&metric=rom');
  await expect(page.getByRole('heading', { name: 'Сравнение моделей' })).toBeVisible({ timeout: 20_000 });
  const selectedRow = page.locator('tr.is-selected');
  await expect(selectedRow).toContainText('Линейный тренд');
  await expect(page.getByText('Выполнение — ещё не научение')).toBeVisible();

  // Exclusion needs a reason and is reflected in the counts
  page.once('dialog', (d) => void d.accept('strap slipped'));
  await page.getByRole('button', { name: 'Исключить…' }).first().click();
  await expect(page.getByText('исключён исследователем: strap slipped').first()).toBeVisible();

  // Freeze → report → re-check
  await page.getByRole('button', { name: 'Зафиксировать этот анализ' }).click();
  await page.getByRole('link', { name: 'Зафиксировано — открыть отчёт' }).click();
  await expect(page).toHaveURL(/#\/research\/runs\/run_/);
  await page.getByRole('button', { name: 'Перепроверить текущим движком' }).click();
  await expect(page.getByText('Воспроизведено', { exact: false })).toBeVisible();
  // Export is pseudonymised: no participant id or name in the downloaded JSON
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON' }).click()]);
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[]).toString('utf8'));
  expect(text).not.toContain('demo-p01');
  expect(text).not.toContain('Алихан');
  expect(text).toContain('"pseudonymised":true');

  // Study Designer: save, freeze, then use the frozen version as the analysis plan
  await page.goto('./#/research/designer');
  await page.getByLabel('Название').fill('ROM acquisition pilot');
  await page.getByLabel('Исследовательский вопрос').fill('Does shoulder flexion ROM change across 8 weekly sessions?');
  await page.getByLabel('Гипотеза').fill('ROM increases; no change is possible.');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено, версия 1')).toBeVisible();
  await page.getByRole('button', { name: 'Зафиксировать' }).first().click();
  await expect(page.locator('td', { hasText: 'зафиксирован' })).toBeVisible();
  await page.goto('./#/research/learning?p=demo-p01&task=shoulder_flexion%3Aright&metric=rom');
  await page.getByLabel('План анализа').selectOption({ label: 'ROM acquisition pilot · v1' });
  await expect(page.getByText('Задано зафиксированным протоколом', { exact: false })).toBeVisible();

  // Twin: scope statement, hypothetical sandbox, grounded assistant
  await page.goto('./#/research/twin/demo-p04');
  await expect(page.getByText('Двойник не может наблюдать')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Активность мозга или нервной системы', { exact: false })).toBeVisible();
  await page.locator('tr', { hasText: 'Подъём руки вперёд · Правая' }).click();
  await expect(page.getByText('Гипотетически: что предсказала бы модель', { exact: false })).toBeVisible();
  await expect(page.getByText('Эти данные не могут установить', { exact: false })).toBeVisible();

  // Movement Lab on a recording file: quality table and detected movements
  await page.goto('./#/research/movement');
  await page.locator('input[type=file]').setInputFiles({ name: 'raises.csv', mimeType: 'text/csv', buffer: raisesCsv() });
  await expect(page.getByRole('heading', { name: /Качество сигнала/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Движения и признаки \(([4-9]|\d\d)\)/ })).toBeVisible();

  // Reload: runs and protocols persist (IndexedDB store `lab`)
  await page.goto('./#/research/runs');
  await page.reload();
  await waitReady(page);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.goto('./#/research/designer');
  await expect(page.getByRole('cell', { name: 'ROM acquisition pilot' })).toBeVisible();

  expect(errors).toEqual([]);
});
