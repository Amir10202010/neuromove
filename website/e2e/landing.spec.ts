// Стартовая страница: блоки, которые зависят от данных, видны; экран теста совпадает с приложением,
// тур под ним подсвечивает свою часть экрана; меню ведёт ко всем разделам; окно вступления демо
// держит фокус. Движение как на страницах Apple: текст появляется, когда доходит до ~82 % высоты
// экрана; фото датчика раскрывается прокруткой; модель в «Как это работает» и рука на листе отчёта
// идут вместе с прокруткой. «Проверка» и «Специалистам» убраны 19 октября — их тесты тоже.
// Разбор — docs/DESIGN_AUDIT.md.

import { expect, test } from '@playwright/test';

test('сравнение «на глаз / NeuroMove» видно после загрузки данных (аудит A1) @mobile', async ({ page }) => {
  await page.goto('./#/');
  const contrast = page.locator('.lp-contrast');
  // Блок появляется, только когда демо-данные готовы: при первом открытии — после симуляции
  await expect(contrast).toBeAttached({ timeout: 30_000 });
  await contrast.scrollIntoViewIfNeeded();
  await expect(contrast).toHaveAttribute('data-in', '');
  await expect.poll(() => contrast.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(contrast).toContainText('NeuroMove');
});

test('экран теста на странице совпадает с приложением: значок — буквы имени, без «Симулятор» и «Запись» (аудит A2)', async ({ page }) => {
  await page.goto('./#/');
  const screen = page.locator('.lp-tab');
  await screen.scrollIntoViewIfNeeded();
  await expect(screen.locator('.ps__avatar')).toHaveText(/^\p{L}{2}$/u);
  await expect(screen.locator('.ps__name')).not.toHaveText('');
  await expect(screen).not.toContainText('Симулятор');
  await expect(screen).not.toContainText('Запись');
  await expect(screen).not.toContainText('поражённая');
});

test('тур под планшетом: нажатый пункт подсвечивает свою часть экрана, тур дальше не идёт сам', async ({ page }) => {
  await page.goto('./#/');
  const screen = page.locator('.lp-tab .ps');
  await screen.scrollIntoViewIfNeeded();
  await expect(screen).toHaveAttribute('data-spot', 'angle');
  const items = page.locator('.lp-tour__item');
  await items.nth(2).click();
  await expect(items.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(screen).toHaveAttribute('data-spot', 'figure');
  // Подсветка встала вокруг фигурки: её прямоугольник внутри экрана и не пустой
  const box = await screen.locator('.ps__spot').evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
  expect(box.w).toBeGreaterThan(100);
  expect(box.h).toBeGreaterThan(100);
  await page.waitForTimeout(4600);
  await expect(screen).toHaveAttribute('data-spot', 'figure');
});

/** Прокрутить так, чтобы верх элемента оказался на высоте frac·экрана, и дождаться кадра. */
async function scrollTopTo(page: import('@playwright/test').Page, selector: string, frac: number) {
  await page.evaluate(
    ([sel, f]) => {
      const el = document.querySelector(sel as string)!;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - window.innerHeight * (f as number));
    },
    [selector, frac] as const,
  );
  await page.waitForTimeout(250);
}

test('появление как у Apple: заголовок ждёт, пока дойдёт до ~82 % высоты экрана, и поднимается на 30 px', async ({ page }) => {
  await page.goto('./#/');
  await page.waitForTimeout(800);
  const title = page.locator('#lp-families-title');
  // Ниже линии появления — ещё прозрачный и опущен
  await scrollTopTo(page, '#lp-families-title', 0.95);
  expect(await title.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  expect(await title.evaluate((el) => getComputedStyle(el).transform)).toContain('30');
  // Выше линии — проявляется и встаёт на место меньше чем за секунду
  await scrollTopTo(page, '#lp-families-title', 0.6);
  await expect.poll(() => title.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe('1');
});

test('«Датчики»: фото раскрывается прокруткой из карточки во весь экран, заголовок поднимается поверх', async ({ page }) => {
  await page.goto('./#/');
  await page.waitForTimeout(800);
  const geo = await page.evaluate(() => {
    const sc = document.querySelector('.lp-kit__scene')!;
    const r = sc.getBoundingClientRect();
    return { top: r.top + window.scrollY, len: r.height - window.innerHeight };
  });
  const at = async (f: number) => {
    await page.evaluate((y) => window.scrollTo(0, y), geo.top + f * geo.len);
    await page.waitForTimeout(250);
    return page.evaluate(() => ({
      clip: getComputedStyle(document.querySelector('.lp-kit__photo')!).clipPath,
      title: Number(getComputedStyle(document.querySelector('.lp-kit__title')!).opacity),
    }));
  };
  const start = await at(0);
  expect(start.clip).toContain('round');
  expect(start.title).toBe(0);
  const end = await at(0.9);
  expect(end.clip).toBe('inset(0%)');
  expect(end.title).toBe(1);
});

test('«Как это работает»: модель разбирается вместе с прокруткой, а не по таймеру', async ({ page }) => {
  await page.goto('./#/');
  await page.waitForTimeout(800);
  const art = page.locator('.lp-how__art');
  const varA = () => art.evaluate((el) => Number((el as HTMLElement).style.getPropertyValue('--a') || 0));
  // Линия чтения — середина экрана: шаг 1 в начале, затем граница шагов 1 и 2
  await scrollTopTo(page, '.lp-how__step[data-step="0"]', 0.3);
  const before = await varA();
  await page.waitForTimeout(600);
  expect(await varA()).toBe(before);
  await scrollTopTo(page, '.lp-how__step[data-step="1"]', 0.5);
  const mid = await varA();
  expect(mid).toBeGreaterThan(before);
  expect(mid).toBeLessThan(1);
  await scrollTopTo(page, '.lp-how__step[data-step="1"]', 0.1);
  expect(await varA()).toBe(1);
  await expect(art).toHaveAttribute('data-step', '1');
});

test('«Семьям»: рука на шкале идёт от начала курса к «сейчас» вместе с прокруткой', async ({ page }) => {
  await page.goto('./#/');
  // Цифры — только когда готовы демо-данные
  await expect(page.locator('.rs:not(.rs--ghost) .dial__now')).toBeAttached({ timeout: 30_000 });
  const value = () => page.locator('.dial__now').evaluate((el) => parseInt(el.textContent ?? '', 10));
  await scrollTopTo(page, '.lp-families__sheet', 0.97);
  const early = await value();
  await scrollTopTo(page, '.lp-families__sheet', 0.3);
  const late = await value();
  expect(late).toBeGreaterThan(early);
  await expect(page.locator('.dial__now')).toContainText('144°');
});

test('меню ведёт ко всем четырём разделам; «Специалистам» и «Проверки» на странице больше нет', async ({ page }) => {
  await page.goto('./#/');
  const links = page.locator('.lp-nav__links button');
  await expect(links).toHaveText(['Датчики', 'Как это работает', 'Тест вживую', 'Семьям']);
  await expect(page.locator('#lp-clinicians, #lp-proof, #lp-data')).toHaveCount(0);
  // «Тест вживую» из меню: заголовок раздела на экране
  await links.nth(2).click();
  await expect.poll(() => page.locator('#lp-product-title').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top > 0 && r.bottom < window.innerHeight;
  })).toBe(true);
});

test('«Попробовать демо»: фокус остаётся в окне вступления и не уходит на экран под ним @mobile', async ({ page }) => {
  await page.goto('./#/');
  await page.getByRole('button', { name: 'Попробовать демо' }).first().click();
  const intro = page.getByRole('dialog', { name: 'NeuroMove измеряет, как ребёнок с ДЦП поднимает руку' });
  await expect(intro).toBeVisible({ timeout: 30_000 });
  // Экран под окном загружается лениво и переводит фокус в <main> — но не из открытого окна
  await page.waitForTimeout(600);
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  expect(await inDialog()).toBe(true);
  await page.keyboard.press('Tab');
  expect(await inDialog()).toBe(true);
});
