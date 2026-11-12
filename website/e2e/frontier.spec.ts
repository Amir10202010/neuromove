// Research-frontier workspaces in a real browser (demo workspace, Russian, built site with production CSP):
// overview tiles → measurement & observability (registry, sensor configuration) → learning observatory (change
// detection, envelope, competing explanations) → strategy atlas on synthetic recordings with a known answer (worker)
// → twin layers, maturity and prediction records, sealed snapshot survives a reload → sandbox (one scenario, Monte
// Carlo, benchmark registry with its documented failures) → hypothesis registry → report built from a frozen run,
// exported pseudonymised.

import { expect, test } from '@playwright/test';
import { waitReady, watchErrors } from './helpers';

test('research frontier: measurement, observatory, strategy atlas, twin, sandbox, hypotheses, report @mobile', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await page.goto('./#/research/lab');
  await waitReady(page);
  await expect(page.getByRole('heading', { name: 'Передний край исследований' })).toBeVisible();
  await page.getByRole('link', { name: /Измерение и наблюдаемость/ }).click();
  await expect(page).toHaveURL(/#\/research\/frontier\/measurement/);

  // Measurement & observability: scope statement, registry, what a sensor configuration loses
  await expect(page.getByRole('heading', { level: 1, name: 'Измерение и наблюдаемость' })).toBeVisible();
  await expect(page.getByText('Исследовательский инструмент — не поддержка клинических решений')).toBeVisible();
  await expect(page.getByText('теряется при этой конфигурации')).toBeVisible();
  await page.getByLabel('Туловище (грудина)').uncheck();
  await expect(page.locator('.fr-list li').first()).toBeVisible();
  await page.locator('.mlfilters').getByLabel('Статус').selectOption({ label: 'не наблюдается' });
  await expect(page.getByText(/Показано записей: 16 \/ \d+/)).toBeVisible();
  // what cannot be observed is named, in the canonical wording
  await expect(page.getByRole('button', { name: 'Brain activity' })).toBeVisible();
  await page.getByRole('button', { name: 'Brain activity' }).click();
  await expect(page.getByText('Границы интерпретации')).toBeVisible();

  // Learning observatory: the scripted steady improvement of demo-p01 (right shoulder flexion)
  await page.goto('./#/research/frontier/observatory?p=demo-p01');
  await expect(page.getByRole('heading', { name: 'Изменился ли уровень?' })).toBeVisible({ timeout: 30_000 });
  await page.locator('.mlfilters').getByLabel('Ряд').selectOption({ label: 'Подъём руки вперёд · Правая · Объём движения' });
  await expect(page.locator('.fr-chip', { hasText: 'сигнал изменения' }).first()).toBeVisible();
  await expect(page.locator('.fr-chip', { hasText: 'выше коридора' })).toBeVisible();
  // a signalled change is not attributed to the movement while measurement explanations are open
  await expect(page.getByRole('heading', { name: 'Что ещё могло бы объяснить отличие от исходного уровня?' })).toBeVisible();
  await expect(page.locator('.fr-chip', { hasText: 'измерение не исключено' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Попытки опровергнуть обнаруженное изменение' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Что эти данные могут и не могут разделить' })).toBeVisible();
  await expect(page.getByText('никогда как перенос', { exact: false })).toBeVisible();

  // Strategy atlas: demo history has no raw frames, so the synthetic recordings with a known answer are used
  await page.goto('./#/research/frontier/strategy?p=demo-p01');
  await expect(page.getByRole('button', { name: 'Построить профили по сырым записям' })).toBeDisabled();
  await page.getByRole('button', { name: 'Синтетическая демонстрация' }).click();
  await expect(page.getByRole('heading', { name: 'Профили' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Синтетические записи с известным ответом')).toBeVisible();
  // recording 3 against recording 1: trunk involvement changed, the outcome is not called different
  const cmp = page.locator('section', { has: page.getByRole('heading', { name: 'Сравнение с первой записью' }) });
  await expect(cmp.locator('tbody tr', { hasText: 'Экскурсия туловища вперёд–назад' }).locator('.fr-chip')).toHaveText('вне шума');
  await expect(cmp.locator('tbody tr', { hasText: 'Результат (пиковый угол)' }).locator('.fr-chip')).not.toHaveText('вне шума');
  // recording 2 = the same movement with the sensors put on again: not a change of the movement
  await cmp.getByLabel('Запись').selectOption({ index: 0 });
  await expect(cmp.locator('tbody tr', { hasText: 'Результат (пиковый угол)' }).locator('.fr-chip')).not.toHaveText('вне шума');
  await expect(cmp.locator('tbody tr', { hasText: 'Экскурсия туловища вперёд–назад' }).locator('.fr-chip')).not.toHaveText('вне шума');
  await page.getByRole('button', { name: 'Запечатать как запись свидетельства' }).click();
  await expect(page.getByText('Запечатано на этом устройстве')).toBeVisible();

  // Twin workspace: layers, maturity against fixed criteria, predictions issued or refused, sealed snapshot
  await page.goto('./#/research/frontier/twin?p=demo-p01');
  await page.getByRole('button', { name: 'Построить слои двойника' }).click();
  await expect(page.getByRole('heading', { name: 'Зрелость' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Все сеансы этого участника смоделированы', { exact: false })).toBeVisible();
  const ladder = page.locator('.fr-ladder > li');
  await expect(ladder).toHaveCount(5);
  await expect(ladder.nth(0)).toContainText('критерии выполнены');
  await expect(ladder.nth(4)).toContainText('не выполнены');
  await expect(ladder.nth(4)).toContainText('cannot be reached by software evidence');
  await expect(page.locator('.fr-chip', { hasText: /^(выдан|отказано)$/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Запечатать этот снимок' }).click();
  await expect(page.getByRole('heading', { name: 'Запечатанные снимки на этом устройстве' })).toBeVisible();
  await page.reload();
  await waitReady(page);
  await expect(page.getByRole('heading', { name: 'Запечатанные снимки на этом устройстве' })).toBeVisible({ timeout: 20_000 });

  // Sandbox: one scenario, a small Monte Carlo, and the registry of the last full benchmark run with its failures
  await page.goto('./#/research/frontier/sandbox');
  await expect(page.getByRole('heading', { name: 'Реестр тестов' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Тесты, не выполнившие критерий')).toBeVisible();
  const failed = page.locator('.callout--warn', { hasText: 'Тесты, не выполнившие критерий' });
  await expect(failed).toContainText('M2a');
  await expect(failed).toContainText('O2');
  await page.locator('.mlfilters').getByLabel('Сценарий').selectOption({ label: '4. Strategy transition across sessions' });
  await page.getByRole('button', { name: 'Запустить один раз' }).click();
  await expect(page.locator('.fr-chip', { hasText: /^(как ожидалось|не как ожидалось)$/ })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel(/^Прогонов/).fill('20');
  await page.getByRole('button', { name: 'Монте-Карло' }).click();
  await expect(page.getByText(/Выполнено прогонов: 20/)).toBeVisible({ timeout: 120_000 });

  // Hypotheses: registered, formal, and none testable on generated data
  await page.goto('./#/research/frontier/hypotheses');
  await expect(page.getByRole('heading', { name: 'Зарегистрированные гипотезы' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.fr-chip', { hasText: 'не проверяема на текущих данных' })).toHaveCount(10);
  await page.getByRole('button', { name: /^Do repetitions of the same task/ }).click();
  await expect(page.getByText('Нулевая гипотеза')).toBeVisible();
  await expect(page.getByText('Что опровергает')).toBeVisible();

  // Report builder: needs a frozen run; exploratory without a protocol; the export is pseudonymised
  await page.goto('./#/research/frontier/reports');
  await expect(page.getByText('Нет замороженного прогона анализа')).toBeVisible({ timeout: 20_000 });
  await page.goto('./#/research/learning?p=demo-p01&task=shoulder_flexion%3Aright&metric=rom');
  await expect(page.getByRole('heading', { name: 'Сравнение моделей' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Зафиксировать этот анализ' }).click();
  await expect(page.getByRole('link', { name: 'Зафиксировано — открыть отчёт' })).toBeVisible();
  await page.goto('./#/research/frontier/reports');
  await expect(page.getByRole('heading', { name: '9. Results' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.mlkpis')).toContainText('поисковый');
  await expect(page.locator('.mlkpis')).toContainText('воспроизведён');
  await expect(page.getByText('ALL DATA ARE SYNTHETIC', { exact: false })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать в Markdown' }).click()]);
  const md = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[]).toString('utf8'));
  expect(md).toContain('ALL DATA ARE SYNTHETIC');
  expect(md).toContain('Pseudonymised export');
  expect(md).toContain('## 15. References');
  expect(md).not.toContain('demo-p01');
  expect(md).not.toContain('Алихан');
  expect(md).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  await page.getByRole('button', { name: 'Запечатать как запись свидетельства' }).click();
  await expect(page.getByText('Запечатано на этом устройстве')).toBeVisible();

  expect(errors).toEqual([]);
});

test('workers run under the production content policy: the coordination analysis finishes in the built site', async ({ page }) => {
  // Regression for 11 Nov 2026: the engine worker was created from a blob: URL (`?worker&inline`), which the
  // site's policy (script-src 'self') blocks — the page stayed at "analysing…" forever and reported nothing.
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('./#/research/coordination?p=demo-p01');
  await waitReady(page);
  await page.getByRole('button', { name: 'Синтетическая демонстрация' }).click();
  await expect(page.getByRole('heading', { name: /Компоненты координации/ })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { name: /Двигательные стратегии/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('research frontier in Kazakh and English: titles and engine codes are translated', async ({ page }) => {
  await page.goto('./#/settings');
  await waitReady(page);
  await page.locator('main button[lang="kk"]').first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
  await page.goto('./#/research/frontier/measurement');
  await expect(page.getByRole('heading', { level: 1, name: 'Өлшеу және бақыланушылық' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.fr-chip', { hasText: 'бақыланбайды' }).first()).toBeVisible();
  await page.goto('./#/settings');
  await page.locator('main button[lang="en"]').first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('./#/research/frontier/hypotheses');
  await expect(page.getByRole('heading', { level: 1, name: 'Hypotheses' })).toBeVisible({ timeout: 20_000 });
  // an engine code without underscores, in English
  await expect(page.locator('.fr-chip', { hasText: 'not testable with current data' }).first()).toBeVisible();
});
