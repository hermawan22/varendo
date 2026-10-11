import { expect, test, type Page } from '@playwright/test';

type Snapshot = {
  guardCalls: number;
  saves: number;
  queryCalls: number;
  savedName: string;
  savedValues: { id: string; name: string; team: string };
  taskRevision: string;
  inlineSize: { state: 'known'; value: number } | { state: 'unknown' };
  drafts: readonly { field: string; value: unknown }[];
};
const snapshot = (page: Page) =>
  page.evaluate(() => (window as typeof window & { draftFixture: { snapshot(): Snapshot } }).draftFixture.snapshot());
async function edit(page: Page, value = 'Edited Ada') {
  await page.goto('/tests/runtime-presentation/browser/app-draft-exit.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(value);
  await page.getByRole('button', { name: 'Browse', exact: true }).focus();
  await expect.poll(async () => (await snapshot(page)).drafts.length).toBe(1);
}

test('successful form action clears saved drafts before the next render', async ({ page }) => {
  await edit(page);
  await page.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('executed');
  expect((await snapshot(page)).savedName).toBe('Edited Ada');
  await expect.poll(async () => (await snapshot(page)).drafts.length).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ada');
  await expect(page.getByRole('textbox', { name: 'Team', exact: true })).toHaveValue('Research');
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  expect((await snapshot(page)).guardCalls).toBe(0);
  await expect(page.locator('aeliqo-table')).toContainText('Ada');
});

test('an empty create form visibly resets before creating another record', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/app-draft-exit.html?form=empty');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  for (const [id, name, team] of [
    ['lin', 'Lin', 'Design'],
    ['grace', 'Grace', 'Engineering'],
  ]) {
    await page.getByRole('textbox', { name: 'ID', exact: true }).fill(id!);
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name!);
    await page.getByRole('textbox', { name: 'Team', exact: true }).fill(team!);
    await page.getByRole('button', { name: 'Create record', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).savedValues).toEqual({ id, name, team });
    await expect.poll(async () => (await snapshot(page)).drafts.length).toBe(0);
    for (const label of ['ID', 'Name', 'Team'])
      await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue('');
  }
});

test('a saved edit resets visible defaults and keeps the old revision fenced until host refresh', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/app-draft-exit.html?form=edit');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Edited Ada');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('executed');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ada');
  await expect(page.getByRole('textbox', { name: 'Team', exact: true })).toHaveValue('Research');
  await page.getByRole('textbox', { name: 'Team', exact: true }).fill('Engineering');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('failed');
  expect((await snapshot(page)).savedValues).toEqual({ id: 'ada', name: 'Edited Ada', team: 'Research' });
  await expect(page.getByRole('textbox', { name: 'Team', exact: true })).toHaveValue('Engineering');
});

test('Stay and failed Save retain the blurred draft without evaluating the target', async ({ page }) => {
  await edit(page);
  for (const [choice, status] of [
    ['stay', 'needs-input'],
    ['failed-save', 'failed'],
  ]) {
    await page.locator('#choice').selectOption(choice!);
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(page.locator('#status')).toHaveText(status!);
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Edited Ada');
    expect((await snapshot(page)).queryCalls).toBe(0);
    expect((await snapshot(page)).drafts).toHaveLength(1);
  }
});

for (const choice of ['save', 'discard']) {
  test(`${choice} retains the draft on failed target and clears it after a successful transition`, async ({ page }) => {
    await edit(page);
    await page.locator('#choice').selectOption(choice);
    await page.getByRole('button', { name: 'Invalid target' }).click();
    await expect(page.locator('#status')).not.toHaveText('renderer-ready');
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Edited Ada');
    expect((await snapshot(page)).drafts).toHaveLength(1);
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('renderer-ready');
    await expect(page.locator('aeliqo-table')).toContainText('Ada');
    expect((await snapshot(page)).drafts).toHaveLength(0);
    expect((await snapshot(page)).saves).toBe(choice === 'save' ? 2 : 0);
  });
}

test('a successful action preserves edits made after its input was captured', async ({ page }) => {
  await edit(page, 'First edit');
  await page.locator('#action-mode').selectOption('held');
  await page.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('dispatching');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('New edit');
  await page.getByRole('button', { name: 'Release action' }).click();
  await expect(page.locator('#action-status')).toHaveText('executed');
  expect((await snapshot(page)).savedName).toBe('First edit');
  expect((await snapshot(page)).drafts).toEqual([expect.objectContaining({ field: 'name', value: 'New edit' })]);
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('needs-input');
});

test('failed form action retains the edited draft', async ({ page }) => {
  await edit(page);
  await page.locator('#action-mode').selectOption('failed');
  await page.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('failed');
  expect((await snapshot(page)).drafts).toHaveLength(1);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Edited Ada');
});

async function resizeHeldAction(page: Page, taskRevision: string): Promise<void> {
  await page.locator('#target').evaluate(async (target) => {
    target.style.width = '360px';
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect((await snapshot(page)).taskRevision).toBe(taskRevision);
}

test('a resize waits through held execution, then adapts the clean saved form', async ({ page }) => {
  await edit(page);
  await page.locator('#action-mode').selectOption('held');
  await page.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('dispatching');
  const before = await snapshot(page);
  await resizeHeldAction(page, before.taskRevision);
  await page.getByRole('button', { name: 'Release action', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('executed');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Ada');
  await expect.poll(async () => (await snapshot(page)).drafts.length).toBe(0);
  await expect.poll(async () => (await snapshot(page)).inlineSize).toEqual({ state: 'known', value: 360 });
  expect((await snapshot(page)).taskRevision).not.toBe(before.taskRevision);
});

test('cancelling a live preview resumes a queued resize while preserving the draft', async ({ page }) => {
  await edit(page);
  await page.locator('#action-mode').selectOption('preview');
  await page.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('preview');
  const before = await snapshot(page);
  await resizeHeldAction(page, before.taskRevision);
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await expect(page.locator('#action-status')).toHaveText('cancelled');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Edited Ada');
  await expect.poll(async () => (await snapshot(page)).inlineSize).toEqual({ state: 'known', value: 360 });
  expect((await snapshot(page)).drafts).toHaveLength(1);
});
