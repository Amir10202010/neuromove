// Functional Progression System in a real browser (demo workspace, Russian):
// professional sets a goal → family records a home activity (not done, with a barrier) and pain →
// professional sees the safety alert, reviews the incident, records a review with a decision →
// the program changes only by a new version that cites the review → reload keeps everything.

import { expect, test } from '@playwright/test';
import { waitReady, watchErrors } from './helpers';

test('home-to-clinic workflow: goal → family report → safety review → professional review → new version', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);

  // Professional workspace with the demo history
  await page.goto('./#/rehab');
  await waitReady(page);
  await expect(page.getByRole('heading', { name: 'Реабилитация' })).toBeVisible();
  await page.locator('main').getByRole('link', { name: 'Алихан', exact: true }).click();
  await expect(page).toHaveURL(/#\/rehab\/p\/demo-p01/);

  // 1. New functional goal (professional)
  await page.getByRole('tab', { name: /Цели/ }).click();
  await page.getByRole('button', { name: 'Новая цель' }).click();
  await page.getByLabel('Цель обычными словами').fill('Открывать дверь своей комнаты');
  await page.getByLabel('Почему это важно ребёнку и семье').fill('Хочет сам заходить к себе');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('heading', { name: 'Открывать дверь своей комнаты' })).toBeVisible();

  // 2. Family view: "not done" is a neutral answer; pain → safety message
  await page.goto('./#/home/demo-p01');
  await expect(page.getByText('Пропустить день — нормально', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Рассказать, как прошло' }).first().click();
  await page.getByRole('button', { name: 'Остановили' }).click();
  await page.getByText('Ребёнок устал', { exact: true }).click();
  await page.getByRole('button', { name: 'Было больно' }).click();
  await expect(page.getByText('Пожалуйста, остановите занятие.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить отчёт' }).click();
  await expect(page.getByText('Сохранено на этом устройстве').first()).toBeVisible();

  // Reload: the report is still there (IndexedDB)
  await page.reload();
  await waitReady(page);
  await expect(page.locator('.family-card').filter({ hasText: 'Что вы недавно сообщили' })).toContainText('Остановили');

  // 3. Professional: safety alert first, incident reviewed once
  await page.goto('./#/rehab');
  await expect(page.getByText('Сообщения о безопасности ждут специалиста', { exact: true })).toBeVisible();
  await page.goto('./#/rehab/p/demo-p01?tab=family');
  await page.getByRole('button', { name: 'Рассмотреть событие' }).first().click();
  await page.getByLabel('Итог рассмотрения (обязательно)').fill('Позвонили семье, уменьшили расстояние.');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить рассмотрение' }).click();
  await expect(page.getByText('События ждут рассмотрения', { exact: true })).toHaveCount(0);

  // 4. Review: observations are shown with their data; the decision is recorded with reasoning
  await page.getByRole('tab', { name: /Обзор/ }).click();
  await expect(page.getByText('Наблюдения описывают данные', { exact: false })).toBeVisible();
  await page.locator('main select').filter({ hasText: 'Продолжить программу' }).selectOption('modify_program');
  await page.getByLabel('Обоснование (обязательно)').fill('Сообщения о боли и усталости: короче занятия дома.');
  await page.getByRole('button', { name: 'Записать обзор' }).click();

  // 5. The editor opens; the current version is unchanged until a NEW version is saved
  await expect(page).toHaveURL(/tab=program&review=rev_/);
  await expect(page.getByText('по итогам обзора специалиста').first()).toBeVisible();
  await page.getByRole('button', { name: /Сохранить версию 3/ }).click();
  // Nothing changed in the definition → no new version is created (no silent "v3")
  await expect(page.getByRole('heading', { name: /v2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Изменить → новая версия' }).click();
  await page.getByLabel('Название программы').fill('Дотягивание и работа двумя руками, блок 1 (короче)');
  await page.getByLabel('Причина новой версии (обязательно)').fill('Короче занятия после сообщения о боли.');
  await page.getByRole('button', { name: /Сохранить версию 3/ }).click();
  await expect(page.getByRole('heading', { name: /v3/ })).toBeVisible();
  await expect(page.locator('.rh-versions').first()).toContainText('v2');
  await expect(page.locator('.rh-versions').first()).toContainText('v1');

  // Timeline keeps sources apart
  await page.getByRole('tab', { name: 'Хронология' }).click();
  await expect(page.locator('.rh-timeline .src-badge--reported').first()).toBeVisible();
  await expect(page.locator('.rh-timeline .src-badge--imu').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('child mode: participation reward, break and stop are always available; exit needs a grown-up', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/play/demo-p01');
  await waitReady(page);
  await page.getByRole('button', { name: 'Дотянуться до чашки' }).click();
  await expect(page.getByRole('button', { name: 'Перерыв' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();
  // Measured feedback only from a real (here: simulated, labelled) sensor session
  await expect(page.locator('.child-measure')).toContainText('симуляция');
  await page.getByRole('button', { name: 'Перерыв' }).click();
  await expect(page.getByText('Отдыхаем')).toBeVisible();
  await page.getByRole('button', { name: 'Я готов' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Получилось!' }).click();
  await page.getByRole('button', { name: 'Сделали' }).click();
  await page.getByRole('button', { name: 'Нет' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Спасибо, что попробовал!')).toBeVisible();
  // No leaderboard, no comparison with other children
  await expect(page.getByText(/рейтинг|лучше других|место/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('live sensor feedback in child mode (demo simulator), labelled and never saved as a measurement', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.goto('./#/play/demo-p01');
  await waitReady(page);
  await page.getByRole('button', { name: 'Дотянуться до чашки' }).click();
  await page.getByRole('button', { name: 'Датчики (для взрослого)' }).click();
  const live = page.getByRole('region', { name: 'Датчики в реальном времени' });
  await expect(live).toContainText('не сохраняется как измерение');
  await expect(live).toContainText('симулятор');
  await live.locator('[data-guide="begin"]').click({ timeout: 30_000 });
  await expect(live.locator('.rh-live__angle')).toHaveText(/^\d+°$/, { timeout: 40_000 });
  await expect(live).toContainText('Твоя линия цели: 120°');
  // Break and Stop of the activity stay available while the sensors run
  await expect(page.getByRole('button', { name: 'Перерыв' })).toBeVisible();
  await page.getByRole('button', { name: 'Выключить датчики' }).click();
  await expect(live).toHaveCount(0);
  // Nothing was added to the sensor session history
  await page.goto('./#/rehab/p/demo-p01?tab=movement');
  await expect(page.getByText('Подсказка во время занятия')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ICF tags, family access and the built-in summary are visible to the professional', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/rehab/p/demo-p01?tab=goals');
  await waitReady(page);
  await expect(page.locator('.rh-icf__code', { hasText: 'd445' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Профиль' }).click();
  await expect(page.getByRole('heading', { name: 'Доступ семьи' })).toBeVisible();
  await expect(page.getByText('Учётные записи семьи есть только в пространстве клиники', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: /Обзор/ }).click();
  await expect(page.getByRole('heading', { name: 'Сводка для обзора' })).toBeVisible();
  await expect(page.getByText('Собрано из записей на этом устройстве, без ИИ.', { exact: false })).toBeVisible();
  // No AI button without a team server with AI enabled
  await expect(page.getByRole('button', { name: 'Черновик с ИИ' })).toHaveCount(0);
  await page.getByRole('button', { name: 'В клиническую заметку…' }).click();
  await expect(page.getByRole('dialog').locator('textarea')).toHaveValue(/Цели:/);
  expect(errors).toEqual([]);
});
