import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function setRegionWidth(page: import('@playwright/test').Page, width: number): Promise<void> {
  await page.locator('#people-host').evaluate((element, value) => {
    (element as HTMLElement).style.width = `${value}px`;
  }, width);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#page-status')).toHaveText('Ready', { timeout: 15_000 });
});

test('keeps keyboard focus and a dirty draft through adaptive, RTL, touch, zoom, and reduced-motion changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('html').evaluate((element) => {
    element.setAttribute('dir', 'rtl');
    element.style.fontSize = '200%';
  });
  await page.locator('[data-action="people-start-cancellable"]').evaluate((element) => {
    element.textContent = 'ابدأ تحديثاً قابلاً للإلغاء مع وصف مترجم طويل يمكن قراءته بالكامل';
  });

  const draft = page.getByLabel('Draft note');
  await draft.fill('Unsubmitted draft');
  await draft.focus();
  await setRegionWidth(page, 620);
  await expect(draft).toHaveValue('Unsubmitted draft');
  await expect(draft).toBeFocused();

  await page.getByRole('button', { name: 'Cards' }).click();
  await expect(page.locator('#people-status')).toContainText('renderer-ready:data.card-collection');
  await expect(draft).toHaveValue('Unsubmitted draft');
  await expect(page.locator('#people-host aeliqo-region [part="region"]')).toHaveAttribute('dir', 'rtl');

  const action = page.locator('[data-action="people-start-cancellable"]');
  const box = await action.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await action.focus();
  await expect(action).toBeFocused();
  await expect
    .poll(() => action.evaluate((element) => getComputedStyle(element).transitionDuration))
    .toMatch(/^(0\.01ms|1e-05s)$/u);
  expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('announces a resolver clarification and lets a keyboard user complete it through the same presentation path', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Trend with two measures' }).click();
  await expect(page.locator('#analysis-status')).toHaveAttribute('data-state', 'needs-input');
  await expect(page.locator('#analysis-status')).toContainText('web.recipe.needs-input.measure');

  const measure = page.getByLabel('Measure for trend');
  await expect(measure).toBeVisible();
  await measure.focus();
  await measure.press('Tab');
  const apply = page.getByRole('button', { name: 'Show selected measure' });
  await expect(apply).toBeFocused();
  await apply.press('Enter');
  await expect(page.locator('#analysis-status')).toContainText('renderer-ready:data.trend');
  await expect(page.locator('#analysis-host aeliqo-chart')).toHaveCount(1);
  await expect(page.locator('#analysis-clarification')).toBeHidden();
});

test('makes partial, unsupported, and cancelled updates truthful while retaining the last valid presentation', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Show partial page' }).click();
  await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
  await expect(page.locator('#people-host aeliqo-table').getByRole('alert')).toContainText('Showing a partial result.');

  const draft = page.getByLabel('Draft note');
  await draft.fill('Keep this during recovery');
  await page.getByRole('button', { name: 'Unsupported request' }).click();
  await expect(page.locator('#people-status')).toHaveAttribute('data-state', 'unsupported');
  await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
  await expect(draft).toHaveValue('Keep this during recovery');

  await page.getByRole('button', { name: 'Start cancellable update' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-people-read-held', 'true');
  await page.getByRole('button', { name: 'Cancel update' }).click();
  await expect(page.locator('#people-status')).toHaveAttribute('data-state', 'cancelled');
  await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
  await expect(draft).toHaveValue('Keep this during recovery');
});

test('announces denial and immediately removes revoked presentation content', async ({ page }) => {
  await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
  await page.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.locator('#people-status')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#people-status')).toHaveAttribute('data-state', 'denied');
  await expect(page.locator('#people-host aeliqo-table')).toHaveCount(0);
  await expect(page.getByText('Ada Chen')).toHaveCount(0);
});

test('keeps the adaptive control surface free of automated accessibility violations', async ({ page }) => {
  await expect(page.locator('#page-status')).toHaveText('Ready', { timeout: 15_000 });
  const result = await new AxeBuilder({ page }).include('main').analyze();
  expect(result.violations).toEqual([]);
});
