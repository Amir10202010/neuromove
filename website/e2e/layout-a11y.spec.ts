// Ширина экрана и доступность: каждый экран на ширинах от 320 до 1440 px без горизонтальной
// прокрутки; проверка axe (WCAG 2.1 A и AA) на главных экранах.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { waitReady } from './helpers';

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440];
const ROUTES = [
  '#/',
  '#/overview',
  '#/patients',
  '#/patients/demo-p01',
  '#/patients/demo-p01?tab=sessions',
  '#/patients/demo-p01/family',
  '#/session/new?patient=demo-p01',
  '#/sessions',
  '#/sessions/demo-p01-s9',
  '#/sessions/demo-p01-s9/print',
  '#/analytics',
  '#/devices',
  '#/settings',
  '#/onboarding',
];

/** Что вылезает за правый край: селектор и на сколько пикселей. */
async function overflow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const extra = document.documentElement.scrollWidth - window.innerWidth;
    if (extra <= 1) return null;
    const culprits: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1) {
        const name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
        culprits.push(`${name}(${Math.round(r.right - window.innerWidth)}px)`);
        if (culprits.length >= 4) break;
      }
    }
    return `+${extra}px: ${culprits.join(', ')}`;
  });
}

test('нет горизонтальной прокрутки на ширинах 320–1440 px', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./#/overview');
  await waitReady(page);
  const problems: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 860 });
    for (const route of ROUTES) {
      await page.goto(`./${route}`);
      await waitReady(page);
      await page.waitForTimeout(250);
      const o = await overflow(page);
      if (o) problems.push(`${width}px ${route} ${o}`);
    }
  }
  expect(problems).toEqual([]);
});

const AXE_ROUTES = ['#/', '#/overview', '#/patients/demo-p01', '#/session/new?patient=demo-p01', '#/sessions/demo-p01-s9', '#/analytics', '#/devices', '#/settings', '#/onboarding'];

test('доступность: нет серьёзных и критичных нарушений WCAG 2.1 AA и автоматических правил 2.2 AA', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#/overview');
  await waitReady(page);
  const found: string[] = [];
  for (const route of AXE_ROUTES) {
    await page.goto(`./${route}`);
    await waitReady(page);
    await page.waitForTimeout(400);
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    for (const v of res.violations) {
      if (v.impact !== 'serious' && v.impact !== 'critical') continue;
      const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ');
      found.push(`${route} ${v.id} (${v.impact}, ${v.nodes.length}): ${where}`);
    }
  }
  expect(found).toEqual([]);
});

test('клавиатура: первый Tab ведёт к ссылке «к содержимому», фокус виден', async ({ page }) => {
  await page.goto('./#/overview');
  await waitReady(page);
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { text: el.textContent?.trim() ?? '', outline: s.outlineStyle !== 'none' || s.boxShadow !== 'none' };
  });
  expect(focused?.text).toBeTruthy();
  expect(focused?.outline).toBe(true);
});

test('окно подтверждения: фокус внутри, Tab не уходит наружу, Escape закрывает и возвращает фокус', async ({ page }) => {
  await page.goto('./#/overview');
  await waitReady(page);
  const reset = page.getByRole('button', { name: 'Сбросить демо' });
  await reset.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  expect(await inside()).toBe(true);
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await inside()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
});

test('казахский и английский интерфейс: нет горизонтальной прокрутки на 320 и 390 px', async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  for (const lang of ['kk', 'en']) {
    await page.setViewportSize({ width: 1024, height: 860 });
    await page.goto('./#/settings');
    await waitReady(page);
    // Кнопки языка подписаны «KZ», «EN»; язык кнопки — в атрибуте lang
    await page.locator(`main button[lang="${lang}"]`).first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 860 });
      for (const route of ROUTES) {
        await page.goto(`./${route}`);
        await waitReady(page);
        await page.waitForTimeout(200);
        const o = await overflow(page);
        if (o) problems.push(`${lang} ${width}px ${route} ${o}`);
      }
    }
  }
  expect(problems).toEqual([]);
});

/** Сколько раз элемент с фокусом оказался целиком закрыт другим элементом (WCAG 2.2, 2.4.11). */
async function obscuredFocus(page: Page, tabs: number): Promise<string[]> {
  const hidden: string[] = [];
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const pts = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + 2, rect.top + 2],
        [rect.right - 2, rect.bottom - 2],
      ] as const;
      const seen = pts.some(([x, y]) => {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
        const top = document.elementFromPoint(x, y);
        return !!top && (top === el || el.contains(top) || top.contains(el));
      });
      return seen ? null : (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
    });
    if (r) hidden.push(r);
  }
  return hidden;
}

test('фокус не прячется под закреплёнными панелями (WCAG 2.4.11) @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems: string[] = [];
  for (const route of ['#/', '#/overview', '#/patients/demo-p01']) {
    await page.goto(`./${route}`);
    await waitReady(page);
    await page.waitForTimeout(300);
    for (const h of await obscuredFocus(page, 70)) problems.push(`${route}: ${h}`);
  }
  expect(problems).toEqual([]);
});
