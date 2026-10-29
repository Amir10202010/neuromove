// Главный путь продукта так, как его проходит человек: лендинг → демо → тест вживую → отчёт.
// Тесты с меткой @mobile идут ещё и на телефоне (Pixel 7).

import { expect, test } from '@playwright/test';
import { startDemoTest, waitReady, watchErrors } from './helpers';

test('лендинг → «Попробовать демо» → карточка пациента, гид переживает перезагрузку @mobile', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Каждый градус');
  // Честные подписи на первом экране
  await expect(page.getByText('На фото концепт, а не настоящее устройство.')).toBeVisible();

  await page.getByRole('button', { name: 'Попробовать демо' }).first().click();
  await expect(page).toHaveURL(/#\/patients\/demo-p01/);
  await waitReady(page);
  // Дети в демо названы по именам, а не кодами P01–P06
  await expect(page).toHaveTitle('Алихан · NeuroMove');
  // Вступление: одна фраза и три кадра с подписью в одно слово — одна кнопка «Начать».
  // О том, что это демо, говорит только тёмная полоса сверху: во вступлении пометок нет
  const intro = page.getByRole('dialog', { name: 'NeuroMove измеряет, как ребёнок с ДЦП поднимает руку' });
  await expect(intro).toBeVisible();
  await expect(intro.getByText(/демо|симуляц|P01|—/i)).toHaveCount(0);
  await expect(page.locator('.demo-banner')).toContainText('Демо');
  await intro.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(intro).toHaveCount(0);
  const guide = page.getByRole('complementary', { name: 'Гид', exact: true });
  await expect(guide).toBeVisible();
  // Ни карточка, ни гид не повторяют «демо», не зовут пациента кодом и не ставят длинное тире
  await expect(page.locator('main').getByText(/демо|симуляц/i)).toHaveCount(0);
  await expect(guide.getByText(/P01|—/)).toHaveCount(0);

  // Шаг 1 объясняет — в подсказке «Далее»
  await expect(guide.getByText('Карточка пациента')).toBeVisible();
  await guide.getByRole('button', { name: 'Далее' }).click();
  // Шаг 2 просит действие: гид показывает на настоящую кнопку и не дублирует её своей
  await expect(guide.getByText('Начните тест')).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Начать тест' })).toHaveCount(0);
  await page.locator('[data-guide="start-test"]').click();
  await expect(page).toHaveURL(/#\/session\/new/);
  // На шаге-действии только заголовок: кнопку показывает обводка, строки «Нажмите …» нет
  await expect(guide.getByText('Наденьте датчики')).toBeVisible();
  await expect(guide.getByText('Нажмите')).toHaveCount(0);

  await page.reload();
  await waitReady(page);
  await expect(guide).toBeVisible();
  await expect(guide.getByText('Наденьте датчики')).toBeVisible();
  expect(errors).toEqual([]);
});

test('тест вживую → досрочное завершение → отчёт без пометок «демо», сохранён после перезагрузки @mobile', async ({ page }) => {
  const errors = watchErrors(page);
  await startDemoTest(page);

  // Дождаться хотя бы одного засчитанного повтора — виртуальный пациент двигается в реальном времени
  await expect(page.getByText(/^[1-3] из 3$/).first()).toBeVisible({ timeout: 40_000 });

  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page).toHaveURL(/#\/sessions\/[^?]+\?complete=1/, { timeout: 20_000 });
  await expect(page.getByText('Неполный').first()).toBeVisible();
  // Что это демо, говорит полоса сверху; в самом отчёте пометок нет
  await expect(page.locator('main').getByText(/демо|симуляц/i)).toHaveCount(0);

  const url = page.url();
  await page.reload();
  await waitReady(page);
  expect(page.url()).toBe(url);
  await expect(page.getByText('Неполный').first()).toBeVisible();
  await expect(page.getByText('Сеанс не найден')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('перезагрузка посреди теста → «Сеанс был прерван» → удалить', async ({ page }) => {
  const errors = watchErrors(page);
  await startDemoTest(page);
  await page.waitForTimeout(2500); // запись восстановления пишется раз в 2 с
  await page.reload();
  await waitReady(page);
  const dialog = page.getByRole('dialog', { name: 'Сеанс был прерван' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Удалить' }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await waitReady(page);
  await expect(page.getByRole('dialog', { name: 'Сеанс был прерван' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('обрыв связи посреди теста → пауза → связь восстановлена → продолжить, без ошибок @mobile', async ({ page }) => {
  const errors = watchErrors(page);
  await startDemoTest(page);
  // Меню сбоев симулятора — в подробном виде теста
  await page.getByRole('button', { name: /Показать подробности/ }).first().click();
  await page.getByRole('button', { name: 'Сбои' }).click();
  await page.getByRole('menuitem', { name: 'Обрыв связи на 5 с' }).click();

  const overlay = page.getByRole('alertdialog');
  await expect(overlay).toContainText('Связь с устройством потеряна');
  // Симулятор возвращает связь примерно через 5 с, приложение переподключается само
  await expect(overlay).toContainText('Связь восстановлена', { timeout: 30_000 });
  await overlay.getByRole('button', { name: 'Продолжить' }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByText(/^Шаг [1-4] из 4/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('сбой «датчик плеча отвалился»: подсказка называет датчик, затем запись идёт дальше', async ({ page }) => {
  const errors = watchErrors(page);
  await startDemoTest(page);
  await expect(page.getByText(/^[1-3] из 3$/).first()).toBeVisible({ timeout: 40_000 });
  const details = page.getByRole('button', { name: /Показать подробности/ }).first();
  if (await details.isVisible()) await details.click();
  await page.getByRole('button', { name: 'Сбои' }).click();
  await page.getByRole('menuitem', { name: 'Датчик плеча отвалился на 3 с' }).click();
  await expect(page.getByText(/Нет данных от датчика: (Левое|Правое) плечо/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Нет данных от датчика: (Левое|Правое) плечо/)).toHaveCount(0, { timeout: 8_000 });
  expect(errors).toEqual([]);
});

test('гид: весь путь до «Вы прошли весь путь», возврат к шагу и «Пройти ещё раз»', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Попробовать демо' }).first().click();
  await waitReady(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Начать', exact: true }).click();
  const guide = page.getByRole('complementary', { name: 'Гид', exact: true });

  // Ушли с шага — гид говорит об этом и возвращает одной кнопкой
  await page.goto('./#/overview');
  await expect(guide.getByText('Вы ушли с шага «Карточка пациента»')).toBeVisible();
  await guide.getByRole('button', { name: 'Вернуться к шагу' }).click();
  await expect(page).toHaveURL(/#\/patients\/demo-p01/);
  await expect(guide.getByText('Вы ушли с шага', { exact: false })).toHaveCount(0);

  // Где нужно действие, человек нажимает настоящие кнопки, на которые показывает гид
  await guide.getByRole('button', { name: 'Далее' }).click();
  await page.locator('[data-guide="start-test"]').click();
  await page.locator('[data-guide="wear"]').click();
  const begin = page.locator('[data-guide="begin"]');
  await expect(begin).toBeEnabled({ timeout: 20_000 });
  await expect(guide.getByText('Датчики выходят на связь')).toBeVisible();
  await begin.click();
  // Тест идёт в реальном времени (≈1 минута) — гид сам переходит к итогу
  await expect(page).toHaveURL(/#\/sessions\/[^?]+\?complete=1/, { timeout: 150_000 });
  await expect(page.getByText('Сеанс завершён и сохранён')).toBeVisible();
  await expect(guide.getByText('Итог теста')).toBeVisible();

  await guide.getByRole('button', { name: 'Далее' }).click();
  await expect(guide.getByText('Тест уже в карточке')).toBeVisible();
  await guide.getByRole('button', { name: 'Далее' }).click();
  await expect(guide.getByText('Все пациенты')).toBeVisible();
  await guide.getByRole('button', { name: 'Готово' }).click();
  await expect(guide.getByText('Вы прошли весь путь')).toBeVisible();
  await expect(guide.getByText('Сегодняшний тест сохранён в карточке пациента.')).toBeVisible();

  await guide.getByRole('button', { name: 'Пройти ещё раз' }).click();
  await expect(page).toHaveURL(/#\/patients\/demo-p01/);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
