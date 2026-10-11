import { expect, test } from '@playwright/test';

type FlowDraftEvent = { readonly kind: 'step' | 'commit'; readonly draft: Record<string, unknown> };
type FlowTestWindow = Window & { readonly __flowDraftEvents?: FlowDraftEvent[] };

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/compound/index.html');
  await expect(page.locator('#flow')).toBeVisible();
  await page.evaluate(() => {
    const flow = document.querySelector('#flow')!;
    const events: FlowDraftEvent[] = [];
    (window as unknown as { __flowDraftEvents: FlowDraftEvent[] }).__flowDraftEvents = events;
    flow.addEventListener('aeliqo-form-flow-step', (event) => {
      events.push({ kind: 'step', draft: (event as CustomEvent<{ draft: Record<string, unknown> }>).detail.draft });
    });
    flow.addEventListener('aeliqo-form-flow-commit', (event) => {
      events.push({ kind: 'commit', draft: (event as CustomEvent<{ draft: Record<string, unknown> }>).detail.draft });
    });
  });
});

test('replaces a seeded scalar with the edited control while retaining repeated fields', async ({ page }) => {
  const flow = page.locator('#flow');
  await page.evaluate(async () => {
    const element = document.querySelector('#flow') as any;
    element.draft = { draftOnly: 'old', displayName: 'Ada Lovelace' };
    await element.updateComplete;
  });
  await flow.locator('aeliqo-text-field').locator('input').fill('Ada flow draft');
  await flow.getByRole('button', { name: 'Next', exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (window as unknown as FlowTestWindow).__flowDraftEvents ?? [];
        return events.findLast((event) => event.kind === 'step')?.draft;
      }),
    )
    .toMatchObject({
      draftOnly: 'old',
      displayName: 'Ada flow draft',
      tags: ['one', 'two'],
      plan: 'standard',
      consent: 'yes',
      choices: ['red', 'blue'],
      'window[start]': '2026-09-02',
      'window[end]': '2026-09-09',
    });
});

test('keeps an unmounted step until its replacement draft revokes it', async ({ page }) => {
  const flow = page.locator('#flow');
  await page.evaluate(async () => {
    const element = document.querySelector('#flow') as any;
    element.draft = { draftOnly: 'old', displayName: 'Ada Lovelace' };
    await element.updateComplete;
  });
  await flow.locator('aeliqo-text-field').locator('input').fill('Ada first');
  await flow.getByRole('button', { name: 'Next', exact: true }).click();
  await page.evaluate(async () => {
    const element = document.querySelector('#flow') as any;
    element.querySelector('[slot="step-one"]')?.remove();
    await element.updateComplete;
  });
  await flow.getByRole('button', { name: 'Commit', exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (window as unknown as FlowTestWindow).__flowDraftEvents ?? [];
        return events.filter((event) => event.kind === 'commit')[0]?.draft;
      }),
    )
    .toMatchObject({
      displayName: 'Ada first',
      tags: ['one', 'two'],
    });
  expect(
    await page.evaluate(() => {
      const events = (window as unknown as FlowTestWindow).__flowDraftEvents ?? [];
      const draft = events.filter((event) => event.kind === 'commit')[0]?.draft;
      return { displayName: draft?.displayName, oldSeed: draft?.displayName === 'Ada Lovelace' };
    }),
  ).toEqual({ displayName: 'Ada first', oldSeed: false });

  await page.evaluate(async () => {
    const element = document.querySelector('#flow') as any;
    element.draft = { draftOnly: 'new' };
    await element.updateComplete;
  });
  await flow.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (window as unknown as FlowTestWindow).__flowDraftEvents ?? [];
        return events.findLast((event) => event.kind === 'commit')?.draft;
      }),
    )
    .toMatchObject({
      draftOnly: 'new',
      tags: ['one', 'two'],
    });
  expect(
    await page.evaluate(() => {
      const events = (window as unknown as FlowTestWindow).__flowDraftEvents ?? [];
      const draft = events.findLast((event) => event.kind === 'commit')?.draft;
      return { displayName: draft?.displayName, oldDraftOnly: draft?.draftOnly === 'old' };
    }),
  ).toEqual({ displayName: undefined, oldDraftOnly: false });
});

test('clears unchecked and empty multiple controls instead of retaining seeded values', async ({ page }) => {
  const flow = page.locator('#flow');
  await page.evaluate(async () => {
    const element = document.querySelector('#flow') as any;
    element.draft = { displayName: 'Ada Lovelace', consent: 'yes', choices: ['red', 'blue'] };
    await element.updateComplete;
  });
  await flow.locator('aeliqo-text-field').locator('input').fill('Ada');
  await flow.getByRole('button', { name: 'Next', exact: true }).click();
  await flow.locator('input[type="checkbox"][name="consent"]').uncheck();
  await flow.locator('select[name="choices"]').selectOption([]);
  await flow.getByRole('button', { name: 'Commit', exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (window as unknown as FlowTestWindow).__flowDraftEvents ?? [];
        return events.findLast((event) => event.kind === 'commit')?.draft;
      }),
    )
    .toMatchObject({ displayName: 'Ada', tags: ['one', 'two'] });
  expect(
    await page.evaluate(() => {
      const events = (window as unknown as FlowTestWindow).__flowDraftEvents ?? [];
      const draft = events.findLast((event) => event.kind === 'commit')?.draft;
      return { consent: draft?.consent, choices: draft?.choices };
    }),
  ).toEqual({ consent: undefined, choices: undefined });
});
