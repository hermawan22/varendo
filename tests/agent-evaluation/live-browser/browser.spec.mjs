import { expect, test } from '@playwright/test';
import { runToolModel } from '@varendo/agent/model';

const intents = {
  J1: {
    version: '1',
    id: 'j1-offline',
    kind: 'browse',
    resource: 'people',
    fields: ['name', 'team', 'location'],
    filter: { op: 'compare', field: 'location', comparison: 'eq', value: 'Jakarta' },
  },
  J2: {
    version: '1',
    id: 'j2-offline',
    kind: 'analyze',
    resource: 'attendance',
    measures: [{ id: 'attendance.rate', revision: '1' }],
    time: { field: 'day', grain: 'day', calendar: 'gregorian', timezone: 'Asia/Jakarta' },
    preferredView: 'trend',
  },
  J3: {
    version: '1',
    id: 'j3-offline',
    kind: 'custom',
    resource: 'attendance',
    intent: { id: 'attendance.overview', revision: '1' },
    input: { team: 'Engineering' },
  },
};

test('the agent endpoint reaches actual J1–J3 renderers and retains DOM after invalid proposals', async ({ page }) => {
  await page.goto('/tests/agent-evaluation/live-browser/browser.html');
  for (const journey of ['J1', 'J2', 'J3']) {
    const opened = await page.evaluate((value) => window.liveHost.open(value), journey);
    expect(opened).toBe(true);
    const discovered = await page.evaluate(() => window.liveHost.discover());
    expect(discovered.ok).toBe(true);
    const context = await page.evaluate(() => window.liveHost.invoke('aeliqo_context', {}, 'offline-context'));
    expect(context, `${journey}: ${JSON.stringify(context)}`).toMatchObject({ ok: true, value: { state: 'accepted' } });
    if (journey === 'J2')
      expect(context.value.value.resources[0]).toMatchObject({
        queryConstraint: {
          supportedPeriod: {
            from: '2026-09-01T00:00:00+07:00',
            toExclusive: '2026-09-06T00:00:00+07:00',
            interpretation: expect.any(String),
          },
          requiredFilter: {
            op: 'and',
            predicates: [
              { field: 'day', comparison: 'gte', value: '2026-09-01' },
              { field: 'day', comparison: 'lt', value: '2026-09-06' },
            ],
          },
        },
      });
    if (journey === 'J3')
      expect(context.value.value.resources[0]).toMatchObject({
        resource: { id: 'attendance' },
        customIntents: [
          {
            ref: { id: 'attendance.overview', revision: '1' },
            inputSchema: { properties: { team: { const: 'Engineering' } }, required: ['team'] },
          },
        ],
        patterns: [
          {
            ref: { id: 'attendance.overview-pattern', revision: '1' },
            intent: { id: 'attendance.overview', revision: '1' },
            outputs: ['summary', 'trend', 'breakdown'],
          },
        ],
      });
    const rendered = await page.evaluate(
      (value) => window.liveHost.invoke('aeliqo_render', value, 'offline-render'),
      intents[journey],
    );
    expect(rendered, `${journey}: ${JSON.stringify(rendered)}`).toMatchObject({
      ok: true,
      value: { state: 'renderer-ready' },
    });
    const selector = journey === 'J2' ? 'aeliqo-chart' : 'aeliqo-table';
    await expect(page.locator(`#journey-region ${selector}`).first()).toBeVisible();
    const before = await page.locator(`#journey-region ${selector}`).count();
    if (journey === 'J3') {
      await expect(page.locator('#journey-region')).toHaveAttribute('data-needs', 'summary,trend,breakdown');
      const snapshot = await page.evaluate(() => window.liveHost.snapshot());
      expect(snapshot.chartRows).toEqual([
        [
          ['2026-09-01', '1'],
          ['2026-09-02', '1'],
        ],
      ]);
    }
    const invalid = await page.evaluate(() =>
      window.liveHost.invoke('aeliqo_render', { version: '1', kind: 'browse', resource: 'secret' }, 'offline-invalid'),
    );
    // An unknown resource is rejected before rendering; generated id and version no longer make it malformed.
    expect(invalid.ok).toBe(true);
    expect(['invalid', 'unsupported', 'failed', 'denied']).toContain(invalid.value.state);
    expect(await page.locator(`#journey-region ${selector}`).count()).toBe(before);
  }
});

test('a synthetic model must use the scoped bridge before the J1–J3 DOM can change', async ({ page }) => {
  await page.goto('/tests/agent-evaluation/live-browser/browser.html');
  for (const journey of ['J1', 'J2', 'J3']) {
    await page.evaluate((value) => window.liveHost.open(value), journey);
    let requests = 0;
    const model = {
      estimateInputTokens: () => 100,
      async complete() {
        requests++;
        return {
          calls:
            requests === 1
              ? [{ id: 'context', name: 'aeliqo_context', input: {} }]
              : [{ id: 'render', name: 'aeliqo_render', input: intents[journey] }],
          usage: { inputTokens: 100, outputTokens: 25 },
        };
      },
    };
    const invoke = (name, input, options) =>
      page.evaluate((call) => window.liveHost.invoke(call.name, call.input, call.requestId), {
        name,
        input,
        requestId: options.requestId,
      });
    const endpoint = {
      transport: 'byok',
      targetRegionId:
        journey === 'J1' ? 'playground-main' : journey === 'J2' ? 'live-attendance' : 'attendance-workspace',
      goalEpoch: `live-${journey.toLowerCase()}`,
      authorizeModel: () => page.evaluate(() => window.liveHost.authorizeModel()),
      discover: () => page.evaluate(() => window.liveHost.discover()),
      invoke,
      close() {},
    };
    const result = await runToolModel({
      requestId: `offline-${journey}`,
      goal: 'experience',
      prompt: 'Synthetic fixture request',
      endpoint,
      model,
      policy: { requiredOperationSequence: [{ operation: 'catalog.read', acceptedStates: ['accepted'] }] },
      budget: {
        maxTurns: 4,
        maxModelRequests: 4,
        maxToolCalls: 4,
        maxMilliseconds: 10000,
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        maxTotalTokens: 2000,
        maxInputBytes: 64000,
        maxOutputBytes: 64000,
        maxRepeatedCalls: 2,
      },
    });
    expect(result, journey).toMatchObject({ ok: true, value: { stop: 'renderer-ready' } });
    const selector = journey === 'J2' ? 'aeliqo-chart' : 'aeliqo-table';
    await expect(page.locator(`#journey-region ${selector}`).first()).toBeVisible();
  }
});

test('J2 rejects a model-supplied alternate period instead of silently replacing it', async ({ page }) => {
  await page.goto('/tests/agent-evaluation/live-browser/browser.html');
  await page.evaluate(() => window.liveHost.open('J2'));
  const alternate = {
    ...intents.J2,
    filter: { op: 'compare', field: 'day', comparison: 'gte', value: '2026-08-01' },
  };
  const result = await page.evaluate(
    (value) => window.liveHost.invoke('aeliqo_render', value, 'wrong-period'),
    alternate,
  );
  expect(result).toMatchObject({ ok: true, value: { state: 'failed' } });
  await expect(page.locator('#journey-region aeliqo-chart')).toHaveCount(0);
});

test('J2 lowers the approved local-day period from the model to the bounded civil filter', async ({ page }) => {
  await page.goto('/tests/agent-evaluation/live-browser/browser.html');
  await page.evaluate(() => window.liveHost.open('J2'));
  const proposed = {
    ...intents.J2,
    dimensions: ['day'],
    filter: {
      op: 'and',
      predicates: [
        { op: 'compare', field: 'day', comparison: 'gte', value: '2026-09-01' },
        { op: 'compare', field: 'day', comparison: 'lt', value: '2026-09-06' },
      ],
    },
    period: {
      from: '2026-09-01T00:00:00+07:00',
      toExclusive: '2026-09-06T00:00:00+07:00',
      calendar: 'gregorian',
      timezone: 'Asia/Jakarta',
      interpretation: 'September 1–5 are complete local days',
    },
    sort: [{ field: 'day', direction: 'asc' }],
  };
  const rendered = await page.evaluate(
    (value) => window.liveHost.invoke('aeliqo_render', value, 'approved-period'),
    proposed,
  );
  expect(rendered, JSON.stringify(rendered)).toMatchObject({ ok: true, value: { state: 'renderer-ready' } });
  await expect(page.locator('#journey-region aeliqo-chart')).toBeVisible();
  await expect(page.locator('[data-testid="approved-period"]')).toContainText('Periode 1–5 September 2026');
  await expect(page.locator('#journey-region aeliqo-chart')).toHaveAttribute('lang', 'id-ID');
  const snapshot = await page.evaluate(() => window.liveHost.snapshot());
  expect(snapshot.text).toContain('Tingkat kehadiran');
  expect(snapshot.text).toContain('Lihat tabel data');
  expect(snapshot.text).toMatch(/2026-09-01 1 2026-09-02 0[.,]5 2026-09-03 1/u);
  expect(snapshot.text).not.toMatch(/2026-09-0[4-6]/u);
  expect(snapshot.chartRows).toEqual([
    [
      ['2026-09-01', '1'],
      ['2026-09-02', '0.5'],
      ['2026-09-03', '1'],
    ],
  ]);
  const wrong = { ...proposed, period: { ...proposed.period, toExclusive: '2026-09-07T00:00:00+07:00' } };
  const denied = await page.evaluate(
    (value) => window.liveHost.invoke('aeliqo_render', value, 'alternate-period'),
    wrong,
  );
  expect(denied).toMatchObject({ ok: true, value: { state: 'failed' } });
});

test('J2 fills omitted temporal metadata from its registered local-day field', async ({ page }) => {
  await page.goto('/tests/agent-evaluation/live-browser/browser.html');
  await page.evaluate(() => window.liveHost.open('J2'));
  const proposed = {
    ...intents.J2,
    dimensions: ['day'],
    time: { field: 'day', grain: 'day' },
    filter: {
      op: 'and',
      predicates: [
        { op: 'compare', field: 'day', comparison: 'gte', value: '2026-09-01' },
        { op: 'compare', field: 'day', comparison: 'lt', value: '2026-09-06' },
      ],
    },
    period: {
      from: '2026-09-01T00:00:00+07:00',
      toExclusive: '2026-09-06T00:00:00+07:00',
      calendar: 'gregorian',
      timezone: 'Asia/Jakarta',
      interpretation: 'September 1–5, 2026 are complete local days in Asia/Jakarta.',
    },
  };
  const rendered = await page.evaluate(
    (value) => window.liveHost.invoke('aeliqo_render', value, 'inferred-temporal-metadata'),
    proposed,
  );
  expect(rendered).toMatchObject({ ok: true, value: { state: 'renderer-ready' } });
  const snapshot = await page.evaluate(() => window.liveHost.snapshot());
  expect(snapshot.chartRows).toEqual([
    [
      ['2026-09-01', '1'],
      ['2026-09-02', '0.5'],
      ['2026-09-03', '1'],
    ],
  ]);
  const wrong = { ...proposed, time: { ...proposed.time, timezone: 'UTC' } };
  const denied = await page.evaluate(
    (value) => window.liveHost.invoke('aeliqo_render', value, 'wrong-temporal-metadata'),
    wrong,
  );
  expect(denied).toMatchObject({ ok: true, value: { state: 'failed' } });
});
