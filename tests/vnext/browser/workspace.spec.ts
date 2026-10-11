import { expect, test } from '@playwright/test';

test('J3 registered overview evaluates one three-need Task and renders its selected workspace plan', async ({
  page,
}) => {
  await page.goto('/workspace-goal/');
  const workspace = page.getByTestId('goal-workspace');
  await expect(workspace).toHaveAttribute('data-task-id', 'attendance-overview-task');
  await expect(workspace).toHaveAttribute('data-needs', 'summary,trend,breakdown');
  await expect(workspace).toHaveAttribute('data-outputs', 'summary,trend,breakdown');
  await expect(workspace).toHaveAttribute('data-facade', 'app.render');
  await expect(workspace).toHaveAttribute('data-plan-nodes', 'workspace,summary,trend,breakdown');
  await expect(workspace).toHaveAttribute('data-node-results', 'summary:summary,trend:trend,breakdown:breakdown');
  await expect(workspace).toHaveAttribute('data-scope', 'attendance-scope');
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="workspace"]')).toBeVisible();
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="summary"]')).toContainText('2');
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="trend"]')).toContainText('2026-09-01');
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="breakdown"]')).not.toContainText('Lee');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(workspace).toHaveAttribute('data-node-results', 'summary:summary,trend:trend,breakdown:breakdown');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  }
});

test('J3 rejected goal retains the committed multi-need workspace', async ({ page }) => {
  await page.goto('/workspace-goal/');
  const workspace = page.getByTestId('goal-workspace');
  await expect(workspace).toHaveAttribute('data-plan-nodes', 'workspace,summary,trend,breakdown');
  await page.getByRole('button', { name: 'Request anomaly' }).click();
  await expect(page.getByTestId('goal-status')).toHaveText('unsupported:intent.unknown-custom');
  await expect(workspace).toHaveAttribute('data-plan-nodes', 'workspace,summary,trend,breakdown');
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="summary"]')).toContainText('2');
});

test('J3 mandatory breakdown failure retains the authorized prior workspace', async ({ page }) => {
  await page.goto('/workspace-goal/');
  const workspace = page.getByTestId('goal-workspace');
  await expect(workspace).toHaveAttribute('data-plan-nodes', 'workspace,summary,trend,breakdown');
  await page.getByRole('button', { name: 'Fail breakdown update' }).click();
  await expect(page.getByTestId('goal-status')).toHaveText('failed:attendance.breakdown-failed');
  await expect(workspace).toHaveAttribute('data-plan-nodes', 'workspace,summary,trend,breakdown');
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="summary"]')).toContainText('2');
  await expect(page.locator('aeliqo-region [data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
});

test('J3 child surfaces mount registered summary, trend and breakdown together', async ({ page }) => {
  await page.goto('/workspace/');
  await expect(page.getByRole('heading', { name: 'Engineering attendance workspace' })).toBeVisible();
  await expect(page.getByTestId('summary-status')).toHaveText('renderer-ready:data.metric');
  await expect(page.getByTestId('trend-status')).toHaveText('renderer-ready:data.trend');
  await expect(page.getByTestId('breakdown-status')).toHaveText('renderer-ready:data.table');
  await expect(page.getByTestId('summary-value')).toHaveText('2');
  await expect(page.getByTestId('trend-values')).toContainText('2026-09-01: 1');
  await expect(page.getByTestId('trend-values')).toContainText('2026-09-02: 1');
  await expect(page.getByTestId('breakdown-values')).toContainText('Ada: 1');
  await expect(page.getByTestId('breakdown-values')).toContainText('Sam: 1');
  await expect(page.getByTestId('breakdown-values')).not.toContainText('Lee');
});

test('J3 child surfaces keep other results and host focus through a failed update and resize', async ({ page }) => {
  await page.goto('/workspace/');
  await expect(page.getByTestId('breakdown-status')).toHaveText('renderer-ready:data.table');
  const draft = page.getByLabel('Workspace note');
  await draft.fill('Review tomorrow');
  await draft.focus();
  await page.getByRole('button', { name: 'Narrow workspace' }).click();
  await expect(page.getByTestId('workspace-layout')).toHaveAttribute('data-width', 'narrow');
  await expect(draft).toHaveValue('Review tomorrow');
  await draft.focus();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#unsupported-breakdown')!.click());
  await expect(page.getByTestId('breakdown-status')).toContainText('unsupported');
  await expect(page.getByTestId('summary-status')).toHaveText('renderer-ready:data.metric');
  await expect(page.getByTestId('trend-status')).toHaveText('renderer-ready:data.trend');
  await expect(page.getByTestId('breakdown-values')).toContainText('Ada: 1');
  await expect(draft).toHaveValue('Review tomorrow');
  await expect(draft).toBeFocused();
  await page.getByRole('button', { name: 'Restore breakdown' }).click();
  await expect(page.getByTestId('breakdown-status')).toHaveText('renderer-ready:data.table');
});

for (const width of [360, 768, 1440]) {
  test(`J3 child workspace fits ${width}px without horizontal clipping`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace/');
    await expect(page.getByTestId('summary-status')).toHaveText('renderer-ready:data.metric');
    await expect(page.getByTestId('trend-status')).toHaveText('renderer-ready:data.trend');
    await expect(page.getByTestId('breakdown-status')).toHaveText('renderer-ready:data.table');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  });
}
