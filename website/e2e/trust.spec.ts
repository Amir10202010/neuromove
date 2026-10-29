// Обещания лендинга, проверенные в браузере: данные не уходят со страницы, демо не попадает
// в историю настоящих пациентов, демо одним файлом открывается с диска.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseImuCsv, serializeImuCsv } from '../src/devices/contract';
import { benchCsv, simulateBench } from '../src/simulation/bench';
import { recordingCsv, startDemoTest, waitReady, watchErrors } from './helpers';

test('политика безопасности запрещает странице сетевые запросы', async ({ page }) => {
  await page.goto('./');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("connect-src 'none'");
  const result = await page.evaluate(() =>
    fetch('https://example.com/collect', { method: 'POST', body: 'x' }).then(
      () => 'sent',
      () => 'blocked',
    ),
  );
  expect(result).toBe('blocked');
});

test('пространство клиники: запись из демо не загружается, настоящая — загружается', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/onboarding');
  await waitReady(page);
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Имя и фамилия специалиста').fill('Тест Специалист');
  await page.getByRole('button', { name: 'Далее' }).click();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('button', { name: 'Открыть пространство' }).click();
  await expect(page).toHaveURL(/#\/overview/);

  await page.goto('./#/patients');
  await page.locator('main').getByRole('button', { name: 'Добавить пациента' }).first().click();
  await page.getByRole('dialog').getByLabel('Имя', { exact: true }).fill('Тимур');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('./#/session/new');
  await page.getByText('Показать подробности').click();
  await page.getByRole('button', { name: /Запись CSV/ }).click();
  const input = page.locator('input[type=file][accept*=".csv"]');

  await input.setInputFiles({ name: 'demo-export.csv', mimeType: 'text/csv', buffer: recordingCsv('patient=P01 demo=yes') });
  await expect(page.getByRole('alert').filter({ hasText: 'Это запись из демо' })).toBeVisible();
  await expect(page.locator('main').getByRole('button', { name: 'Надеть датчики' })).toBeDisabled();

  await input.setInputFiles({ name: 'lab.csv', mimeType: 'text/csv', buffer: recordingCsv('patient=P07 demo=no') });
  await expect(page.getByText(/lab\.csv: 300 отсчётов/)).toBeVisible();
  await expect(page.getByText('Сеанс сохранится с пометкой «Запись из файла»')).toBeVisible();
  await expect(page.locator('main').getByRole('button', { name: 'Надеть датчики' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('демо одним файлом открывается с диска: знак, фото и шрифты внутри, без ошибок', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(new URL('../demo/NeuroMove.html', import.meta.url).href);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Каждый градус');
  const images = await page.locator('img').evaluateAll((list) =>
    (list as HTMLImageElement[]).map((img) => ({ src: img.src.slice(0, 30), ok: img.complete && img.naturalWidth > 0 })),
  );
  expect(images.length).toBeGreaterThan(0);
  expect(images.filter((i) => !i.ok)).toEqual([]);
  expect(errors).toEqual([]);
});

test('сырые данные, выгруженные из демо, нельзя загрузить в пространство клиники', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  // 1. Живой тест в демо → досрочно завершить → отчёт
  await startDemoTest(page);
  await expect(page.getByText(/^[1-3] из 3$/).first()).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page).toHaveURL(/#\/sessions\/[^?]+\?complete=1/, { timeout: 20_000 });

  // 2. Выгрузка сырых данных: имя файла с DEMO
  const details = page.getByRole('button', { name: /Показать подробности/ }).first();
  if (await details.isVisible()) await details.click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Сырые данные CSV' }).click()]);
  // В имени файла — имя ребёнка, кириллица сохраняется
  expect(download.suggestedFilename()).toMatch(/^neuromove-DEMO-Алихан-\d{4}-\d{2}-\d{2}-raw\.csv$/);
  const file = await download.path();

  // 3. Пространство клиники: онбординг, пациент, повтор записи — отказ
  await page.goto('./#/onboarding');
  await waitReady(page);
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Имя и фамилия специалиста').fill('Тест Специалист');
  await page.getByRole('button', { name: 'Далее' }).click();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('button', { name: 'Открыть пространство' }).click();
  await page.goto('./#/patients');
  await page.locator('main').getByRole('button', { name: 'Добавить пациента' }).first().click();
  await page.getByRole('dialog').getByLabel('Имя', { exact: true }).fill('Тимур');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await page.goto('./#/session/new');
  const more = page.getByRole('button', { name: /Показать подробности/ }).first();
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: /Запись CSV/ }).click();
  await page.locator('input[type=file][accept*=".csv"]').setInputFiles(file);
  await expect(page.getByRole('alert').filter({ hasText: 'Это запись из демо' })).toBeVisible();
  await expect(page.locator('main').getByRole('button', { name: 'Надеть датчики' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('проверка точности: запись станка с отметками → таблица и итог против порога 5°, пометка «симулятор»', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/devices');
  await waitReady(page);
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Проверка точности' }) });
  await card.locator('input[type=file]').setInputFiles({ name: 'bench-elbow.csv', mimeType: 'text/csv', buffer: Buffer.from(benchCsv('elbow_flexion')) });
  await expect(card.getByText('bench-elbow.csv · отметок: 5')).toBeVisible();
  await card.getByRole('button', { name: 'Посчитать' }).click();
  await expect(card.getByText('Пройдено: средняя ошибка не больше 5°')).toBeVisible();
  await expect(card.getByText('Запись симулятора: проверены формулы, а не прибор')).toBeVisible();
  await expect(card.locator('tbody tr')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('запись с датчиков для проверки точности: отметки, файл DEMO-bench с паспортом, загрузка в проверку', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/devices');
  await waitReady(page);
  // Симулятор комплекта — первый источник в «Источниках данных»
  await page.locator('main').getByRole('button', { name: 'Подключить' }).first().click();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Проверка точности' }) });
  await card.getByRole('button', { name: 'Начать запись' }).click();
  await page.waitForTimeout(1500);
  const ref = card.getByLabel('Угол эталона, °');
  for (const angle of ['30', '60']) {
    await ref.fill(angle);
    await card.getByRole('button', { name: 'Отметка' }).click();
    await page.waitForTimeout(400);
  }
  await expect(card.getByText(/отметок: 2/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Остановить' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^neuromove-DEMO-bench-elbow_flexion-right-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync((await download.path()) as string, 'utf8');
  const parsed = parseImuCsv(text);
  expect(parsed.passport.extra).toMatchObject({ kind: 'bench', exercise: 'elbow_flexion', side: 'right', demo: 'yes' });
  expect(parsed.marks.map((m) => m.ref)).toEqual([30, 60]);
  expect(parsed.frames.length).toBeGreaterThan(100);
  await expect(card.getByText(/отметок: 2$/)).toBeVisible();
  await card.getByRole('button', { name: 'Посчитать' }).click();
  // Доброволец симулятора всё время двигает рукой: итог — или цифры с пометкой «симулятор», или честное «нет калибровки»
  await expect(card.getByText(/Запись симулятора|[Бб]ез калибровки/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('печать и отчёт для семьи из демо: водяной знак «ДЕМО · СИМУЛИРОВАННЫЕ ДАННЫЕ» на бумаге, не на экране', async ({ page }) => {
  for (const route of ['#/sessions/demo-p01-s9/print', '#/patients/demo-p01/family']) {
    await page.emulateMedia({ media: 'screen' });
    await page.goto(`./${route}`);
    await waitReady(page);
    const mark = page.locator('.sheet__watermark');
    await expect(mark).toHaveText('ДЕМО · СИМУЛИРОВАННЫЕ ДАННЫЕ');
    // На экране о демо говорит полоса сверху; лист, вынесенный из приложения, помечен сам
    await expect(mark).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(mark).toBeVisible();
  }
});

test('карточка пациента и отчёт для семьи называют одну и ту же прибавку за курс', async ({ page }) => {
  // Было: карточка — «на 17° выше» (144° и «было 127°»), отчёт для семьи — «на 18°» по неокруглённым числам
  const gain = async (route: string) => {
    await page.goto(`./${route}`);
    await waitReady(page);
    const text = await page.getByText(/на \d+° выше, чем в начале курса/).first().textContent();
    return text?.match(/на (\d+)° выше/)?.[1];
  };
  const card = await gain('#/patients/demo-p01');
  expect(card).toBeTruthy();
  expect(await gain('#/patients/demo-p01/family')).toBe(card);
});

test('клиника: повтор лабораторной записи → сеанс → отчёт без «Демо», с пометкой «Запись из файла»', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  // «Лабораторная» запись: формулы симулятора, но устройство и паспорт — как у стенда (не демо)
  const { frames } = simulateBench('elbow_flexion');
  const csv = serializeImuCsv(
    { device: 'NM-01', firmware: '0.1', rateHz: 100, accG: 4, gyroDps: 1000, sensors: ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'], extra: { patient: 'V01', demo: 'no' } },
    frames,
  );
  await page.goto('./#/onboarding');
  await waitReady(page);
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Имя и фамилия специалиста').fill('Тест Специалист');
  await page.getByRole('button', { name: 'Далее' }).click();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('button', { name: 'Открыть пространство' }).click();
  await page.goto('./#/patients');
  await page.locator('main').getByRole('button', { name: 'Добавить пациента' }).first().click();
  await page.getByRole('dialog').getByLabel('Имя', { exact: true }).fill('Тимур');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await page.goto('./#/session/new');
  const more = page.getByRole('button', { name: /Показать подробности/ }).first();
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: /Запись CSV/ }).click();
  await page.locator('input[type=file][accept*=".csv"]').setInputFiles({ name: 'lab-v01.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('main').getByRole('button', { name: 'Надеть датчики' }).click();
  const begin = page.locator('main').getByRole('button', { name: 'Начать тест' });
  await expect(begin).toBeEnabled({ timeout: 20_000 });
  await begin.click();
  await page.waitForTimeout(5000); // калибровка по первым 3 с записи и начало шага
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page).toHaveURL(/#\/sessions\/[^?]+\?complete=1/, { timeout: 20_000 });
  await expect(page.getByText('Запись из файла').first()).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(page.locator('.sheet__watermark')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('пример на симуляторе в проверке точности: один клик — метод на экране, с пометкой «проверены формулы»', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/devices');
  await waitReady(page);
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Проверка точности' }) });
  await card.getByRole('button', { name: 'Пример: станок на симуляторе' }).click();
  await expect(card.getByText('Станок на симуляторе (пример) · отметок: 5')).toBeVisible();
  await card.getByRole('button', { name: 'Посчитать' }).click();
  await expect(card.getByText('Пройдено: средняя ошибка не больше 5°')).toBeVisible();
  await expect(card.getByText('Запись симулятора: проверены формулы, а не прибор')).toBeVisible();
  expect(errors).toEqual([]);
});

test('архив: перед заменой видно, что в нём и что заменится; испорченный файл до вопроса не доходит', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/settings');
  await waitReady(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать архив пространства' }).click()]);
  const file = await download.path();
  const input = page.locator('input[type=file][accept*=".json"]');
  await input.setInputFiles(file);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/В архиве: пациентов \d+, сеансов \d+ \(с .+ по .+\)\./);
  await expect(dialog).toContainText(/Сейчас в пространстве «Демо-пространство»: пациентов \d+, сеансов \d+\. Они будут заменены архивом/);
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);
  // Испорченный архив: сразу ошибка, без вопроса «Заменить?»
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"neuromove-backup","version":1}') });
  await expect(page.getByText('Не удалось прочитать архив')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
