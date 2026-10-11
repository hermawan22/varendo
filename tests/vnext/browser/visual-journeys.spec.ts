import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function checkFrame(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
  const report = await new AxeBuilder({ page }).include('main').analyze();
  expect(report.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

for (const width of [360, 768, 1440]) {
  test(`J1 Jakarta browse at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('#page-status')).toHaveText('Ready');
    const jakarta = page.getByRole('button', { name: 'People in Jakarta' });
    await jakarta.focus();
    await page.keyboard.press('Enter');
    await expect(jakarta).toBeFocused();
    await expect(page.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
    const view = page.locator('#people-host');
    await expect(view.getByText('Ada Chen')).toBeVisible();
    await expect(view.getByText('Sam Rivera')).toHaveCount(0);
    await checkFrame(page, testInfo, 'j1-jakarta');
    await expect(page.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
    await expect(view.getByText('Sam Rivera')).toHaveCount(0);
  });

  test(`J2 attendance clarification at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/attendance/');
    await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
    await expect(page.getByTestId('coverage')).toContainText('4–5 September: no observations');
    await checkFrame(page, testInfo, 'j2-attendance');

    const compare = page.getByRole('button', { name: 'Compare attendance metrics' });
    await compare.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('attendance-status')).toContainText('needs-input');
    const metric = page.getByLabel('Attendance metric');
    await metric.focus();
    await expect(metric).toBeFocused();
    const apply = page.getByRole('button', { name: 'Show selected attendance metric' });
    await apply.focus();
    await expect(apply).toBeFocused();
    await checkFrame(page, testInfo, 'j2-clarification');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('attendance-status')).toHaveText('renderer-ready:data.trend');
    await expect(metric).toBeHidden();
  });

  test(`J3 registered workspace at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace-goal/');
    const workspace = page.getByTestId('goal-workspace');
    await expect(workspace).toHaveAttribute('data-node-results', 'summary:summary,trend:trend,breakdown:breakdown');
    await expect(page.locator('aeliqo-region [data-aeliqo-node-id="summary"]')).toContainText('2');
    await expect(page.locator('aeliqo-region [data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
    await checkFrame(page, testInfo, 'j3-workspace');

    const anomaly = page.getByRole('button', { name: 'Request anomaly' });
    await anomaly.focus();
    await page.keyboard.press('Enter');
    await expect(anomaly).toBeFocused();
    await expect(page.getByTestId('goal-status')).toHaveText('unsupported:intent.unknown-custom');
    await expect(workspace).toHaveAttribute('data-node-results', 'summary:summary,trend:trend,breakdown:breakdown');
    await checkFrame(page, testInfo, 'j3-retained-after-rejection');
  });
}
