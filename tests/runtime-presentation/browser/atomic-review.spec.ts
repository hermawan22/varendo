import { test, expect } from '@playwright/test';

type Fixture = {
  snapshot(): {
    runtime: unknown;
    plan: unknown;
    renders: number;
    sameInput: boolean;
    liveInteraction: unknown;
    canonicalInteraction: unknown;
    initialInteractions: { live: unknown; canonical: unknown };
  };
  render(mode: string): Promise<{ status: string; diagnostics?: unknown }>;
  emitSelection(): void;
  directThrow(kind?: string): { rolledBack: boolean; error?: string };
};
type Host = typeof window & { transactionFixture: Fixture };

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/atomic-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
});

test('nested keyed host renderer failure restores prior DOM without reentering failed callbacks', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Host draft' });
  await input.fill('Unsaved nested draft');
  await input.focus();
  const before = await page.evaluate(() => (window as Host).transactionFixture.snapshot());
  const receipt = await page.evaluate(() => (window as Host).transactionFixture.directThrow());
  expect(receipt.rolledBack, JSON.stringify(receipt)).toBe(true);
  const after = await page.evaluate(() => (window as Host).transactionFixture.snapshot());
  expect(after.runtime).toEqual(before.runtime);
  expect(after.plan).toEqual(before.plan);
  expect(after.sameInput).toBe(true);
  await expect(input).toHaveValue('Unsaved nested draft');
  await expect(input).toBeFocused();
});

test('semantic interaction reentered during synchronous publication cannot diverge from staged state', async ({
  page,
}) => {
  await page.goto('/tests/runtime-presentation/browser/atomic-review.html?mode=emit');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const after = await page.evaluate(() => (window as Host).transactionFixture.snapshot());
  expect(after.initialInteractions.live ?? { version: '1', values: [], drafts: [] }).toEqual(
    after.initialInteractions.canonical,
  );
});

test('semantic interaction after synchronous publication remains available', async ({ page }) => {
  await page.evaluate(() => (window as Host).transactionFixture.emitSelection());
  const after = await page.evaluate(() => (window as Host).transactionFixture.snapshot());
  expect(after.liveInteraction).toMatchObject({ values: [{ portId: 'selection', payload: { kind: 'selection' } }] });
});

test('selection accepted during adaptive element loading survives the stale preparation', async ({ page }) => {
  type Snapshot = ReturnType<Fixture['snapshot']>;
  type ProbeHost = Host & {
    resizeObserved: Promise<void>;
    releaseResize(): Promise<{ before: Snapshot; accepted: Snapshot; after: Snapshot }>;
  };
  await page.addInitScript(() => {
    const host = window as ProbeHost;
    const Observer = window.ResizeObserver;
    const frame = window.requestAnimationFrame.bind(window);
    const pending: (() => void)[] = [];
    let holding = true;
    let armed = false;
    let observed = () => {};
    let complete: (value: { before: Snapshot; accepted: Snapshot; after: Snapshot }) => void;
    let before: Snapshot;
    host.resizeObserved = new Promise<void>((resolve) => (observed = resolve));
    window.ResizeObserver = class extends Observer {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (!entries.some((entry) => entry.target.id === 'target')) return callback(entries, observer);
          observed();
          if (holding) pending.push(() => callback(entries, observer));
          else callback(entries, observer);
        });
      }
    };
    window.requestAnimationFrame = (callback) =>
      frame((time) => {
        callback(time);
        if (!armed) return;
        armed = false;
        queueMicrotask(async () => {
          host.transactionFixture.emitSelection();
          const accepted = host.transactionFixture.snapshot();
          // Use the real cached registration module, then a frame boundary, so
          // the adaptive preparation settles before inspecting its publication.
          await import(new URL('/packages/web/src/register.ts', location.href).href);
          await new Promise<void>((resolve) => frame(() => resolve()));
          complete({ before, accepted, after: host.transactionFixture.snapshot() });
        });
      });
    host.releaseResize = () => {
      before = host.transactionFixture.snapshot();
      const completed = new Promise<{ before: Snapshot; accepted: Snapshot; after: Snapshot }>(
        (resolve) => (complete = resolve),
      );
      holding = false;
      armed = true;
      for (const callback of pending.splice(0)) callback();
      return completed;
    };
  });
  await page.goto('/tests/runtime-presentation/browser/atomic-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.evaluate(() => (window as ProbeHost).resizeObserved);
  const { before, accepted, after } = await page.evaluate(() => (window as ProbeHost).releaseResize());
  expect(accepted.liveInteraction).toMatchObject({
    values: [{ portId: 'selection', payload: { kind: 'selection' } }],
  });
  expect(after.liveInteraction).toEqual(accepted.liveInteraction);
  expect(after.runtime).toEqual(before.runtime);
  expect(after.plan).toEqual(before.plan);

  // Rejecting the stale preparation must still allow a fresh resize to retain
  // and canonically publish the accepted, declared selection.
  await page.setViewportSize({ width: 700, height: 720 });
  await expect
    .poll(() => page.evaluate(() => (window as Host).transactionFixture.snapshot().canonicalInteraction))
    .toEqual(accepted.liveInteraction);
  expect((await page.evaluate(() => (window as Host).transactionFixture.snapshot())).liveInteraction).toEqual(
    accepted.liveInteraction,
  );
});

test('deterministic host-owned repeat callback failure restores the prior template', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Host draft' });
  await input.fill('Nested host directive draft');
  const receipt = await page.evaluate(() =>
    (window as Host).transactionFixture.directThrow('captured-directive-throw'),
  );
  expect(receipt.rolledBack, JSON.stringify(receipt)).toBe(true);
  await expect(input).toHaveValue('Nested host directive draft');
});

// This intentionally violates the replayable host-template contract. Keep the limitation executable.
test('impure host-owned repeat callback can also fail during raw rollback', async ({ page }) => {
  const receipt = await page.evaluate(() => (window as Host).transactionFixture.directThrow('directive-throw'));
  expect(receipt).toEqual({ rolledBack: false, error: 'Error: synthetic nested directive failure' });
});

test('app contains an impure rollback failure without publishing the candidate', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/atomic-review.html?wrap=false');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  // Capture the transaction boundary in one browser call; initial resize may commit between calls.
  const { before, receipt, after } = await page.evaluate(async () => {
    const fixture = (window as Host).transactionFixture;
    const before = fixture.snapshot();
    const receipt = await fixture.render('directive-throw');
    return { before, receipt, after: fixture.snapshot() };
  });
  expect(receipt.status, JSON.stringify(receipt)).toBe('failed');
  expect(after.runtime).toEqual(before.runtime);
  await expect(page.getByRole('textbox', { name: 'Host draft' })).toHaveCount(0);
});

test('semantic interaction reentered during rollback cannot change the prior live or canonical state', async ({
  page,
}) => {
  await page.goto('/tests/runtime-presentation/browser/atomic-review.html?wrap=false');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const { before, receipt, after } = await page.evaluate(async () => {
    const fixture = (window as Host).transactionFixture;
    const before = fixture.snapshot();
    const receipt = await fixture.render('emit-rollback');
    return { before, receipt, after: fixture.snapshot() };
  });
  expect(receipt.status).toBe('failed');
  expect(after.runtime).toEqual(before.runtime);
  expect(after.liveInteraction).toEqual(before.liveInteraction);
  expect(after.sameInput).toBe(true);
});
