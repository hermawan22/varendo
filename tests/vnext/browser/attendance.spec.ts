import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('J2 renders approved daily attendance as a trend with truthful coverage', async ({ page }) => {
  await page.goto('/attendance/');
  await expect(page.getByRole('heading', { name: 'Daily attendance' })).toBeVisible();
  await expect(page.getByTestId('period')).toContainText('September 2026');
  await expect(page.getByTestId('period')).toContainText('Asia/Jakarta');
  await expect(page.getByTestId('metric-policy')).toContainText(
    'Present eligible employee-days / eligible employee-days',
  );
  await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
  await expect(page.locator('#attendance-host aeliqo-chart')).toHaveCount(1);
  await expect(page.getByTestId('daily-values')).toContainText('2026-09-01: 1');
  await expect(page.getByTestId('daily-values')).toContainText('2026-09-02: 0.5');
  await expect(page.getByTestId('daily-values')).toContainText('2026-09-03: 1');
  await expect(page.getByTestId('daily-values')).not.toContainText('2026-09-04: 0');
  await expect(page.getByTestId('coverage')).toContainText('4–5 September: no observations');
  await expect(page.getByTestId('coverage')).toContainText('6 September: future');
});

test('J2 asks for a metric when both approved rate and count are requested', async ({ page }) => {
  await page.goto('/attendance/');
  await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
  await page.getByRole('button', { name: 'Compare attendance metrics' }).click();
  await expect(page.getByTestId('attendance-status')).toContainText('needs-input');
  await expect(page.getByLabel('Attendance metric')).toBeVisible();
  await page.getByRole('button', { name: 'Show selected attendance metric' }).click();
  await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
});

test('J2 metric clarification is keyboard reachable and has no automated accessibility violations', async ({
  page,
}) => {
  await page.goto('/attendance/');
  await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
  const compare = page.getByRole('button', { name: 'Compare attendance metrics' });
  await compare.focus();
  await page.keyboard.press('Enter');
  const metric = page.getByLabel('Attendance metric');
  await expect(metric).toBeVisible();
  await metric.focus();
  await expect(metric).toBeFocused();
  const report = await new AxeBuilder({ page }).include('main').analyze();
  expect(report.violations).toEqual([]);
});

test('J2 keeps the latest metric after rapid compare and selection', async ({ page }) => {
  await page.goto('/attendance/');
  await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
  await page.evaluate(() => {
    document.querySelector<HTMLSelectElement>('#attendance-metric')!.value = 'attendance.present';
    document.querySelector<HTMLButtonElement>('#compare-metrics')!.click();
    document.querySelector<HTMLButtonElement>('#apply-metric')!.click();
  });
  await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
  await expect(page.getByTestId('daily-values')).toContainText('2026-09-02: 1');
  await expect(page.getByTestId('daily-values')).not.toContainText('2026-09-02: 0.5');
  await expect(page.getByLabel('Attendance metric')).toBeHidden();
});
