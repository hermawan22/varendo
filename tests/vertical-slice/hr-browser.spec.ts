import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AeliqoRegionElement } from '@varendo/web/region';
import type { HrViewSession } from '../../examples/vertical-slice/src/view-session.js';

declare global {
  interface Window {
    hrFixture?: HrViewSession;
  }
}

test('actual raw-data view supports selection, queryless reorder, stale refusal and revocation', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Five employees');
  const table = page.locator('#hr-region aeliqo-table');
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(table.locator('tbody tr').first()).toContainText('0.3333333333333333');
  const plot = page.locator('#hr-region aeliqo-chart');
  const drawn = await plot.locator('polyline').evaluateAll((nodes) =>
    nodes.map((node) => ({
      svg: node instanceof SVGPolylineElement,
      width: node instanceof SVGPolylineElement ? node.getBBox().width : 0,
    })),
  );
  expect(drawn).toHaveLength(5);
  expect(drawn.every((line) => line.svg && line.width > 0)).toBe(true);
  expect(
    await plot.locator('[part="legend-marker"]').evaluateAll(
      (nodes) =>
        new Set(
          nodes.map((node) => {
            const style = getComputedStyle(node);
            return `${style.borderBlockStartColor}/${style.borderBlockStartStyle}`;
          }),
        ).size,
    ),
  ).toBe(5);
  const selected = table.getByRole('radio', { name: 'Select employees e2', exact: true });
  await selected.check();
  await expect(page.locator('#status')).toHaveText('Selected employee e2.');
  expect(await page.evaluate(() => window.hrFixture!.data.queryCount)).toBe(2);
  await page.getByRole('button', { name: 'Swap view order' }).click();
  await expect(page.locator('#status')).toContainText('same results and selection');
  await expect(table.getByRole('radio', { name: 'Select employees e2', exact: true })).toBeChecked();
  expect(await page.evaluate(() => window.hrFixture!.data.queryCount)).toBe(2);
  const stale = await page.evaluate(async () => {
    const session = window.hrFixture!;
    const before = JSON.stringify(session.presentation!.plan);
    const diagnostics = await session.refuseStaleProposal();
    return { code: diagnostics[0]?.code, preserved: JSON.stringify(session.presentation!.plan) === before };
  });
  expect(stale).toEqual({ code: 'runtime.region-stale', preserved: true });
  await page.screenshot({ path: testInfo.outputPath('hr-light.png'), fullPage: true });
  await page.getByLabel('Appearance').selectOption('dark');
  expect(
    await plot.evaluate((element) => {
      const root = document.querySelector('main')!;
      return getComputedStyle(element).backgroundColor === getComputedStyle(root).backgroundColor;
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('hr-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('hr-mobile.png'), fullPage: true });
  await page.evaluate(() => window.hrFixture!.revoke());
  await expect(page.locator('#hr-region aeliqo-table')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unknown server measurements render real HR output and hydrate without replacing the table', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const html = await (await page.request.get('/ssr')).text();
  expect(html).toContain('shadowrootmode="open"');
  expect(html).toContain('"inlineSize":{"state":"unknown"}');
  const withoutScript = await browser.newContext({ javaScriptEnabled: false });
  const serverPage = await withoutScript.newPage();
  await serverPage.goto(
    new URL('/ssr', page.url() === 'about:blank' ? (test.info().project.use.baseURL as string) : page.url()).href,
  );
  await expect(serverPage.locator('#ssr-region aeliqo-table tbody tr')).toHaveCount(5);
  await withoutScript.close();
  await page.goto('/ssr');
  await expect(page.locator('#ssr-region')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('#ssr-region')).toHaveAttribute('data-preserved', 'true');
  await page
    .locator('#ssr-region aeliqo-table')
    .getByRole('radio', { name: 'Select employees e1', exact: true })
    .check();
  await expect(page.locator('#hydration-status')).toHaveText('Selected e1 after hydration.');
  expect(errors).toEqual([]);
});

test('hydrated owners survive synchronous wrapper publication, rollback, reverse and disposal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ssr');
  await expect(page.locator('#ssr-region')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('#ssr-region')).toHaveAttribute('data-preserved', 'true');
  const result = await page.locator('#ssr-region').evaluate((host) => {
    const element = host as AeliqoRegionElement;
    const original = element.presentation!;
    const root = original.nodes.find((node) => node.node.id === original.plan.rootId)!;
    const wrapper = { ...root, node: { ...root.node, id: 'hydrated-wrapper', children: [root.node.id] } };
    const wrapped = {
      ...original,
      plan: { ...original.plan, rootId: wrapper.node.id, nodes: [wrapper.node, ...original.plan.nodes] },
      nodes: [wrapper, ...original.nodes],
    };
    const table = element.shadowRoot!.querySelector('aeliqo-table')!;
    const preserved: boolean[] = [];
    const record = () => preserved.push(table === element.shadowRoot!.querySelector('aeliqo-table'));
    // No microtask or updateComplete between apply and rollback/adoption.
    const rejected = element.preparePublication();
    element.presentation = wrapped;
    rejected.apply();
    record();
    element.presentation = original;
    rejected.rollback();
    rejected.complete();
    record();
    for (const presentation of [wrapped, original]) {
      const publication = element.preparePublication();
      element.presentation = presentation;
      publication.apply();
      publication.complete();
      record();
    }
    element.dispose();
    const disposed = !table.isConnected && element.shadowRoot!.querySelector('aeliqo-table') === null;
    const recovered = element.preparePublication();
    element.presentation = original;
    recovered.apply();
    recovered.complete();
    const replacement = element.shadowRoot!.querySelector('aeliqo-table');
    element.revoke();
    return {
      preserved,
      disposed,
      replacement: replacement !== null && replacement !== table,
      revoked: !replacement?.isConnected,
    };
  });
  expect(result).toEqual({ preserved: [true, true, true, true], disposed: true, replacement: true, revoked: true });
  expect(errors).toEqual([]);
});
