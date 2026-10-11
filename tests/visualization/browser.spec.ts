import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/visualization/index.html');
  await page.locator('aeliqo-tree table').waitFor();
});

test('tree keeps bounded SVG and exact table selection', async ({ page }) => {
  await expect(page.locator('aeliqo-tree svg')).toHaveCount(1);
  await expect(page.locator('aeliqo-tree').getByRole('cell', { name: 'Child A', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('aeliqo-tree').analyze()).violations).toEqual([]);
  await page.locator('aeliqo-tree table button').nth(1).focus();
  await page.keyboard.press('Enter');
  const selection = await page.evaluate(
    () =>
      (window as typeof window & { selection?: { source: string; identity: string; result: { scopeDigest: string } } })
        .selection,
  );
  expect(selection?.source).toBe('user');
  expect(selection?.result.scopeDigest).toBe('scope');
  expect(selection?.identity).toContain('child-a');
  await expect(page.locator('aeliqo-tree [part=node][aria-label="Child A"]')).toHaveAttribute('aria-pressed', 'true');
});

test('geometry budget preserves exact data alternative', async ({ page }) => {
  await page.evaluate(async () => {
    const tree = (window as typeof window & { tree: { maxMarks: number; updateComplete: Promise<unknown> } }).tree;
    tree.maxMarks = 1;
    await tree.updateComplete;
  });
  await expect(page.locator('aeliqo-tree svg')).toHaveCount(0);
  await expect(page.locator('aeliqo-tree').getByRole('status')).toContainText('mark budget');
  await expect(page.locator('aeliqo-tree tbody tr')).toHaveCount(3);
  await page.locator('aeliqo-tree table button').first().focus();
  await page.keyboard.press('Enter');
  const selection = await page.evaluate(() => (window as typeof window & { selection?: { source: string } }).selection);
  expect(selection?.source).toBe('user');
});

test('hierarchy marks are real SVG geometry rather than HTML lookalikes', async ({ page }) => {
  const marks = await page.locator('aeliqo-tree rect').evaluateAll((nodes) =>
    nodes.map((node) => ({
      namespace: node.namespaceURI,
      svg: node instanceof SVGGraphicsElement,
      box: node instanceof SVGGraphicsElement ? node.getBBox().width : 0,
    })),
  );
  expect(marks.length).toBeGreaterThan(0);
  for (const mark of marks) {
    expect(mark.namespace).toBe('http://www.w3.org/2000/svg');
    expect(mark.svg).toBe(true);
    expect(mark.box).toBeGreaterThan(0);
  }
});

for (const view of ['tree', 'treemap', 'relationship'])
  test(`${view} real marks, keyboard selection, revocation and narrow RTL`, async ({ page }) => {
    const host = page.locator(`aeliqo-${view}`);
    const selector = view === 'relationship' ? 'line[part=edge]' : 'rect[part=node]';
    await expect(host.locator('svg')).toHaveCount(1);
    expect(
      await host
        .locator('svg rect,svg line,svg circle,svg text')
        .evaluateAll((nodes) => nodes.every((node) => node instanceof SVGGraphicsElement)),
    ).toBe(true);
    const mark = host.locator(selector).first();
    await mark.focus();
    await page.keyboard.press('Enter');
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    const graphicIdentity = await page.evaluate(() => Reflect.get(window, 'selection').identity);
    await host.locator('table button').first().click();
    expect(await page.evaluate(() => Reflect.get(window, 'selection').identity)).toBe(graphicIdentity);
    await expect(host.locator('[part=scope]')).toContainText('Partial result');
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
      document.documentElement.style.fontSize = '24px';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    expect((await new AxeBuilder({ page }).include(`aeliqo-${view}`).analyze()).violations).toEqual([]);
    await page.evaluate(async (view) => {
      const element = Reflect.get(window, view);
      element.context = { results: [] };
      await element.updateComplete;
    }, view);
    await expect(host.locator('table,svg')).toHaveCount(0);
  });
test('dense trees retain paged exact rows and focus on data refresh', async ({ page }) => {
  await page.evaluate(async () => {
    const tree = Reflect.get(window, 'tree');
    const ref = Reflect.get(window, 'ref');
    const result = Reflect.get(window, 'result');
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, parent: null, label: `Node ${i}`, amount: i }));
    tree.context = { results: [{ ...result, counts: { ...result.counts, loaded: 100 } }] };
    tree.datasets = [{ result: ref, rows }];
    await tree.updateComplete;
  });
  const tree = page.locator('aeliqo-tree');
  await expect(tree.locator('svg')).toHaveCount(0);
  await expect(tree.locator('tbody tr')).toHaveCount(25);
  await tree.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(tree.getByText('Rows 26–50 of 100')).toBeVisible();
  const button = tree.locator('table button').first();
  await button.focus();
  await page.evaluate(async () => {
    const tree = Reflect.get(window, 'tree');
    tree.datasets = [...tree.datasets];
    await tree.updateComplete;
  });
  await expect(button).toBeFocused();
  await page.screenshot({ path: 'artifacts/visualization-browser/hierarchy.png', fullPage: true });
});
