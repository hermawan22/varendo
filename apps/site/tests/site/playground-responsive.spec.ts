import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

test('a new request clears the previous ready receipt while its view family is loading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/playground/');
  const receipt = page.locator('#pg-receipt-state');
  await expect(receipt).toHaveText('renderer-ready');
  await expect(page.locator('#pg-region aeliqo-table')).toContainText('Ada Chen');
  let hold!: (route: Route) => void;
  const loading = new Promise<Route>((resolve) => {
    hold = resolve;
  });
  await page.route('**/register-data*.js*', hold);
  const immediateState = await page.locator('#pg-scenario').evaluate((element: HTMLSelectElement) => {
    element.value = 'products';
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('#pg-receipt-state')?.textContent;
  });
  const route = await loading;
  try {
    expect(immediateState).toBe('checking');
    await expect(receipt).toHaveText('checking');
    await expect(page.locator('#pg-journey-result')).toHaveText('Checking…');
    await expect(page.locator('#pg-journey-view')).toHaveText('Waiting');
    await expect(page.locator('#pg-region aeliqo-card-collection')).toHaveCount(0);
  } finally {
    await route.continue();
  }
  await expect(receipt).toHaveText('renderer-ready');
  await expect(page.locator('#pg-region aeliqo-card-collection')).toBeVisible();
  await expect(page.locator('#pg-result-title')).toHaveText('Browse products');
  await expect(page.locator('#pg-error')).toBeHidden();
});

test('the first result precedes optional request details and stays in the initial viewport', async ({ page }) => {
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/playground/');
    await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
    const request = page.locator('#pg-intent');
    await expect(request).not.toHaveAttribute('open');
    const result = await page.locator('#pg-region').boundingBox();
    const details = await request.boundingBox();
    expect(result).not.toBeNull();
    expect(details).not.toBeNull();
    expect(result!.y, `first result at ${width}px`).toBeLessThan(650);
    expect(result!.y + result!.height).toBeLessThanOrEqual(details!.y + 1);
    await request.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(request).toHaveAttribute('open', '');
    await expect(page.locator('#pg-intent-json')).toContainText('people');
    await page.keyboard.press('Enter');
    await expect(request).not.toHaveAttribute('open');
    await expect(page.locator('#pg-model-calls')).toHaveText('0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

async function openScenario(page: Page, scenario: 'people' | 'products' | 'support' | 'knowledge'): Promise<void> {
  await page.locator('#pg-scenario').selectOption(scenario);
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
}

async function openTaskRail(page: Page): Promise<void> {
  await expect(page.locator('#pg-boot')).toBeHidden();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => {
    const rail = document.querySelector<HTMLDetailsElement>('#pg-request');
    if (rail !== null) rail.open = true;
  });
}

async function expectToolbarTouchTargets(page: Page): Promise<void> {
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const controls = await page.locator('.pg-toolbar :is(button, select, summary):visible').evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.id || element.textContent?.trim(),
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
    })),
  );
  for (const control of controls) {
    expect(control.height, `${control.name} touch height`).toBeGreaterThanOrEqual(44);
    expect(control.width, `${control.name} touch width`).toBeGreaterThanOrEqual(44);
  }
}

test('toolbar menu aligns with Inspect across responsive widths and pointer modes', async ({ browser, baseURL }) => {
  if (baseURL === undefined) throw new Error('The site test base URL is required.');
  for (const hasTouch of [false, true]) {
    const context = await browser.newContext({ hasTouch, baseURL });
    const page = await context.newPage();
    try {
      await page.goto('/playground/');
      await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const direction of ['ltr', 'rtl']) {
          await page.locator('html').evaluate((element, dir) => {
            element.setAttribute('dir', dir);
          }, direction);
          const inspect = page.locator('#pg-inspect');
          const summary = page.locator('#pg-menu > summary');
          const inspectBox = await inspect.boundingBox();
          const menuBox = await summary.boundingBox();
          const selectBox = await page.locator('#pg-scenario').boundingBox();
          if (direction === 'rtl') {
            const chevron = await page.locator('#pg-scenario').evaluate((element) => {
              const style = getComputedStyle(element);
              return { position: style.backgroundPositionX, padding: Number.parseFloat(style.paddingLeft) };
            });
            expect(Number.parseFloat(chevron.position)).toBeGreaterThan(0);
            expect(Number.parseFloat(chevron.position)).toBeLessThan(chevron.padding);
          }
          expect(inspectBox).not.toBeNull();
          expect(menuBox).not.toBeNull();
          expect(
            Math.abs(inspectBox!.y + inspectBox!.height / 2 - menuBox!.y - menuBox!.height / 2),
          ).toBeLessThanOrEqual(1);
          if (hasTouch) await expectToolbarTouchTargets(page);
          await summary.focus();
          await page.keyboard.press('Enter');
          await expect(page.locator('#pg-menu')).toHaveAttribute('open', '');
          await expect(page.getByRole('button', { name: 'Reset playground' })).toBeVisible();
          const openSelectBox = await page.locator('#pg-scenario').boundingBox();
          expect(Math.abs(openSelectBox!.width - selectBox!.width)).toBeLessThanOrEqual(1);
          const popup = await page.locator('.pg-menu-body').boundingBox();
          expect(popup!.x).toBeGreaterThanOrEqual(0);
          expect(popup!.x + popup!.width).toBeLessThanOrEqual(width);
          if (hasTouch) await expectToolbarTouchTargets(page);
          await summary.focus();
          await page.keyboard.press('Enter');
          await expect(page.locator('#pg-menu')).not.toHaveAttribute('open', '');
          await page.locator('.pg-toolbar').screenshot({
            path: test.info().outputPath(`toolbar-${hasTouch ? 'touch' : 'fine'}-${width}-${direction}.png`),
          });
        }
      }
    } finally {
      await context.close();
    }
  }
});

test('scroll keeps narrow playground controls below the site header', async ({ page }) => {
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/playground/');
    await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
    await page.evaluate(() => window.scrollTo(0, 400));
    const controls = await page.locator('#pg-scenario, #pg-inspect, #pg-menu > summary').evaluateAll((elements) => {
      const header = document.querySelector('.topbar')!.getBoundingClientRect();
      return elements.map((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { belowHeader: box.top >= header.bottom, reachable: hit === element || element.contains(hit) };
      });
    });
    expect(controls).toHaveLength(3);
    expect(controls.every((control) => control.belowHeader && control.reachable)).toBe(true);
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Inspector' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Inspect', exact: true })).toBeFocused();
  }
});

test('the narrow task chooser precedes the result and opens with the keyboard', async ({ page }) => {
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/playground/');
    await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
    const rail = page.locator('#pg-request');
    const chooser = rail.locator('summary');
    await expect(rail).not.toHaveAttribute('open');
    await expect(chooser).toBeInViewport();
    const chooserBox = await chooser.boundingBox();
    const resultBox = await page.locator('.pg-result').boundingBox();
    expect(chooserBox).not.toBeNull();
    expect(resultBox).not.toBeNull();
    expect(chooserBox!.y + chooserBox!.height).toBeLessThanOrEqual(resultBox!.y + 1);
    await chooser.focus();
    await page.keyboard.press('Enter');
    await expect(rail).toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Engineering only' }).click();
    await expect(page.locator('#pg-region')).toContainText('Sam Rivera');
    await expect(page.locator('#pg-region')).not.toContainText('Ada Chen');
    await chooser.focus();
    await page.keyboard.press('Enter');
    await expect(rail).not.toHaveAttribute('open');
    await expect(page.locator('#pg-model-calls')).toHaveText('0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`task-chooser-${width}.png`), fullPage: true });
  }
});

test('guided intents render real adaptive views without a model', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto('/playground/');

  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
  await expect(page.locator('aeliqo-table')).toBeVisible();
  await expect(page.locator('#pg-status')).toContainText('is ready');
  await expect(page.locator('#pg-model-calls')).toHaveText('0');
  await page.getByRole('button', { name: 'Engineering only' }).click();
  await expect(page.locator('aeliqo-table')).toContainText('Sam Rivera');
  await expect(page.locator('aeliqo-table')).not.toContainText('Ada Chen');
  await page.getByRole('button', { name: 'Browse people' }).click();
  await expect(page.locator('aeliqo-table')).toContainText('Ada Chen');
  await page.getByRole('button', { name: 'Monthly headcount' }).click();
  await expect(page.locator('#pg-result-definition')).toContainText('employees active at the end of each month');
  await expect(page.locator('#pg-result-definition')).toContainText('never summed across months');
  await expect(page.locator('aeliqo-chart')).toBeVisible();
  await expect(page.locator('aeliqo-chart svg')).toBeAttached();
  await expect(page.locator('aeliqo-chart svg text.axis-x-tick')).toHaveCount(3);
  await expect(page.locator('aeliqo-chart svg text.axis-y-tick')).toHaveCount(3);
  await expect(page.locator('#pg-model-calls')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('guided demos remain legible at mobile, tablet, and desktop widths', async ({ page }) => {
  await page.goto('/playground/');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openTaskRail(page);
    await page.locator('[data-journey="attendance"]').click();
    await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
    await expect(page.locator('#pg-region aeliqo-chart')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await openTaskRail(page);
    await page.locator('[data-journey="workspace"]').click();
    await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
    await expect(page.locator('#pg-region [data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
    await openTaskRail(page);
    await page.locator('[data-journey="page"]').click();
    await expect(page.getByRole('navigation', { name: 'Registered page navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.pg-app').analyze()).violations).toEqual([]);
  }
});

test('a constant series keeps its mark on the labeled y-axis tick', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
  const positions = await page.evaluate(async () => {
    const chart = document.createElement('aeliqo-chart') as HTMLElement & {
      points: readonly { label: string; value: number }[];
      title: string;
      updateComplete: Promise<unknown>;
    };
    chart.title = 'Stable count';
    chart.points = [
      { label: 'First', value: 7 },
      { label: 'Second', value: 7 },
    ];
    document.body.append(chart);
    await chart.updateComplete;
    const svg = chart.shadowRoot?.querySelector('svg');
    const tick = svg?.querySelector('text.axis-y-tick')?.getAttribute('y');
    const point = svg?.querySelector('circle[part="point"]')?.getAttribute('cy');
    return { tickY: Number(tick) - 3, pointY: Number(point) };
  });

  expect(positions.tickY).toBeCloseTo(positions.pointY, 4);
});

test('trend axis labels stay inside the chart on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 });
  await page.goto('/playground/');
  await openTaskRail(page);
  await page.getByRole('button', { name: 'Monthly headcount' }).click();

  const svg = page.locator('aeliqo-chart svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator('text.axis-x-tick')).toHaveCount(3);
  await expect(svg.locator('text.axis-y-tick')).toHaveCount(3);
  const ticksOverflow = await svg.locator('text.axis-x-tick, text.axis-y-tick').evaluateAll((ticks) =>
    ticks.some((tick) => {
      if (!(tick instanceof SVGGraphicsElement)) return true;
      const bounds = tick.getBBox();
      const viewBox = tick.ownerSVGElement?.viewBox.baseVal;
      return (
        viewBox === undefined ||
        bounds.x < 0 ||
        bounds.y < 0 ||
        bounds.x + bounds.width > viewBox.width ||
        bounds.y + bounds.height > viewBox.height
      );
    }),
  );
  expect(ticksOverflow).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('trend geometry follows its container without stretching labels', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 });
  await page.goto('/playground/');
  await openTaskRail(page);
  await page.getByRole('button', { name: 'Monthly headcount' }).click();
  const svg = page.locator('aeliqo-chart svg');
  await expect(svg).toBeVisible();

  const narrow = await svg.evaluate((node) => {
    const chart = node as SVGSVGElement;
    const box = chart.getBoundingClientRect();
    const matrix = chart.getScreenCTM();
    return { clientWidth: box.width, logicalWidth: chart.viewBox.baseVal.width, xScale: matrix?.a, yScale: matrix?.d };
  });
  expect(Math.abs(narrow.logicalWidth - narrow.clientWidth)).toBeLessThan(4);
  expect(Math.abs((narrow.xScale ?? 0) - (narrow.yScale ?? 0))).toBeLessThan(0.02);

  await page.setViewportSize({ width: 1_280, height: 850 });
  await expect
    .poll(async () => svg.evaluate((node) => (node as SVGSVGElement).viewBox.baseVal.width))
    .toBeGreaterThan(narrow.logicalWidth + 400);
  const wideScale = await svg.evaluate((node) => {
    const matrix = (node as SVGSVGElement).getScreenCTM();
    return { x: matrix?.a, y: matrix?.d };
  });
  expect(Math.abs((wideScale.x ?? 0) - (wideScale.y ?? 0))).toBeLessThan(0.02);
});

test('container adaptation switches browse to cards but preserves comparisons', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 });
  await page.goto('/playground/');
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
  await expect(page.locator('aeliqo-card-collection')).toBeVisible();
  await expect(page.locator('aeliqo-table')).toHaveCount(0);
  await expect(page.locator('#pg-view-badge')).toHaveText('data.card-collection');
  await expect(page.locator('#pg-status')).toContainText('is ready');
  await openScenario(page, 'products');
  await expect(page.locator('aeliqo-card-collection')).toContainText('Field notebook');
  await openTaskRail(page);
  await page.getByRole('button', { name: 'Compare products' }).click();
  await expect(page.locator('aeliqo-table')).toBeVisible();
  await expect(page.locator('aeliqo-table')).toContainText('Desk lamp');
  await expect(page.locator('aeliqo-table')).toContainText('Laptop stand');
  await expect(page.locator('#pg-model-calls')).toHaveText('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('schema-derived create form requires explicit confirmation before writing', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/playground/');
  await openScenario(page, 'products');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.locator('aeliqo-form')).toBeVisible();
  await page.getByRole('textbox', { name: 'Product ID' }).fill('pr-5');
  await page.getByRole('textbox', { name: 'Name' }).fill('Travel ruler');
  await page.getByRole('textbox', { name: 'Category' }).fill('Stationery');
  await page.getByRole('textbox', { name: 'Price' }).fill('6.5');
  await page.getByRole('textbox', { name: 'Stock' }).fill('24');
  await page.getByRole('button', { name: 'Create record' }).click();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeVisible();
  await expect(page.locator('#pg-action-content')).toContainText('products.create');
  await expect(page.locator('#pg-action-content')).toContainText('Travel ruler');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Travel ruler');
  await page.getByRole('button', { name: 'Create record' }).click();
  const confirm = page.getByRole('button', { name: 'Confirm action' });
  await confirm.dblclick();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeVisible();
  await expect(page.locator('#pg-status')).toHaveText('Action completed.');
  await expect(page.locator('#pg-receipt-state')).toHaveText('executed');
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Done' }).dblclick();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeHidden();
  await expect(page.locator('#pg-status')).toHaveText('Action completed.');
  await expect(page.getByRole('button', { name: 'Create record' })).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('edit form loads trusted current state and keeps the draft after cancellation', async ({ page }) => {
  await page.goto('/playground/');
  await openScenario(page, 'support');
  await page.getByRole('button', { name: 'Edit ticket' }).click();
  await expect(page.locator('aeliqo-form')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Subject' })).toHaveValue('Invoice PDF is unavailable');
  await expect(page.getByRole('textbox', { name: 'Ticket ID' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Status' }).fill('Pending');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Review action' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Status' })).toHaveValue('Pending');
});

test('consumer-defined intent and view work without modifying core', async ({ page }) => {
  await page.goto('/playground/');
  await openScenario(page, 'knowledge');
  await page.getByRole('button', { name: 'Read article' }).click();
  await expect(page.locator('.knowledge-article')).toContainText('Rotate an API token safely');
  await page.getByRole('button', { name: 'Security topic' }).click();
  await expect(page.locator('aeliqo-card-collection')).toContainText('Rotate an API token safely');
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
});

test('inspector exposes bounded evidence, not records or private runtime payloads', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(page.locator('#pg-inspector-content')).toContainText('catalogRevision');
  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await expect(page.locator('#pg-inspector-content')).toContainText('"loaded": 4');
  await expect(page.locator('#pg-inspector-content')).not.toContainText('Ada Chen');
  await expect(page.locator('#pg-inspector-content')).not.toContainText('"rows"');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page.getByRole('button', { name: 'Inspect', exact: true })).toBeFocused();
});

test('mobile controls, disconnected agent state, and accessibility remain honest and usable', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/playground/');
  await page.getByRole('button', { name: 'Browser agent', exact: true }).click();
  await expect(page.locator('#pg-prompt')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable WebMCP' }).click();
  await expect(page.locator('#pg-connect-status')).not.toContainText('Checking capability');
  await expect(page.locator('#pg-prompt')).toHaveCount(0);
  await expect(page.locator('#pg-model-calls')).toHaveText('0');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Inspector' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('.pg-app').analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Inspector' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Inspect', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests.some((url) => url.includes('/api/aeliqo/'))).toBe(false);
  expect(requests.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
});
