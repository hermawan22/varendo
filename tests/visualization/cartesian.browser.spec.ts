import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/visualization/cartesian.html');
  await page.locator('aeliqo-trend table').waitFor({ state: 'attached' });
});

test('renders six families with exact tables, histogram scope and heatmap color key', async ({ page }) => {
  for (const tag of ['trend', 'bar', 'area', 'scatter', 'histogram', 'heatmap']) {
    const element = page.locator(`aeliqo-${tag}`);
    await expect(element.locator('table')).toHaveCount(1);
    await expect(element.locator('svg')).toHaveCount(1);
  }
  await expect(page.locator('aeliqo-heatmap [part="color-key"]')).toContainText('Intensity');
  await expect(page.locator('aeliqo-histogram [part="scope"]')).toContainText('Source observation coverage');
  await expect(page.locator('aeliqo-area svg path')).toHaveCount(3);
  const scatter = page.locator('aeliqo-scatter');
  await expect(scatter.getByRole('cell', { name: '5', exact: true }).first()).toBeHidden();
  await scatter.getByText('View data table', { exact: true }).click();
  await expect(scatter.getByRole('cell', { name: '5', exact: true }).first()).toBeVisible();
});

test('keeps x-axis labels on one row when they fit and staggers them when text grows', async ({ page }) => {
  const bar = page.locator('aeliqo-bar');
  const rows = () =>
    bar.evaluate((host) => {
      const svg = host.shadowRoot?.querySelector('svg');
      const boxes = [...(svg?.querySelectorAll('text.axis-x-tick') ?? [])]
        .map((label) => label.getBoundingClientRect())
        .sort((left, right) => left.left - right.left);
      return {
        single: svg?.hasAttribute('data-single-row-ticks') ?? false,
        tops: new Set(boxes.map((box) => Math.round(box.top))).size,
        overlaps: boxes.some((box, index) => index > 0 && boxes[index - 1]!.right > box.left),
        titleGap: Math.round(
          (svg?.querySelector('text.axis-title-x')?.getBoundingClientRect().top ?? 0) -
            Math.max(...boxes.map((box) => box.bottom)),
        ),
      };
    });
  await expect.poll(rows).toMatchObject({ single: true, tops: 1, overlaps: false });
  expect((await rows()).titleGap).toBeLessThan(40);
  await expect
    .poll(() => bar.evaluate((host) => host.shadowRoot?.querySelector('svg')?.style.marginBlockEnd))
    .toMatch(/^-/u);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '64px';
  });
  await expect.poll(async () => (await rows()).overlaps).toBe(false);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await expect.poll(async () => (await rows()).single).toBe(true);
});

test('fit-width charts follow their container instead of the fixed width', async ({ page }) => {
  const bar = page.locator('aeliqo-bar');
  const svgWidth = () => bar.evaluate((host) => Number(host.shadowRoot?.querySelector('svg')?.getAttribute('width')));
  await bar.evaluate((host) => {
    host.style.inlineSize = '900px';
    (host as HTMLElement & { fitWidth: boolean }).fitWidth = true;
  });
  await expect.poll(svgWidth).toBe(900);
  await bar.evaluate((host) => {
    host.style.inlineSize = '480px';
  });
  await expect.poll(svgWidth).toBe(480);
});

test('keeps edge x-axis labels inside the chart viewport', async ({ page }) => {
  const bounds = await page.locator('aeliqo-trend').evaluate((host) => {
    const svg = host.shadowRoot?.querySelector<SVGSVGElement>('svg');
    if (svg === undefined || svg === null) throw new Error('Missing trend SVG');
    const svgBounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll<SVGTextElement>('text.axis-x-tick')].map((label) => {
      const bounds = label.getBoundingClientRect();
      return {
        text: label.textContent,
        left: bounds.left,
        right: bounds.right,
        svgLeft: svgBounds.left,
        svgRight: svgBounds.right,
      };
    });
  });
  expect(bounds.length).toBeGreaterThan(1);
  for (const bound of bounds) {
    expect(bound.left, `${bound.text} starts outside the SVG`).toBeGreaterThanOrEqual(bound.svgLeft - 0.5);
    expect(bound.right, `${bound.text} ends outside the SVG`).toBeLessThanOrEqual(bound.svgRight + 0.5);
  }
});

test('keeps date and category edge labels inside LTR and RTL chart viewports', async ({ page }) => {
  for (const direction of ['ltr', 'rtl'] as const) {
    await page.evaluate(async (nextDirection) => {
      document.documentElement.dir = nextDirection;
      for (const host of document.querySelectorAll<HTMLElement>('aeliqo-trend, aeliqo-bar')) {
        const element = host as HTMLElement & { requestUpdate?: () => void; updateComplete?: Promise<unknown> };
        element.requestUpdate?.();
        if (element.updateComplete !== undefined) await element.updateComplete;
      }
    }, direction);
    const bounds = await page.evaluate(() => {
      const output: Record<
        string,
        { text: string | null; left: number; right: number; svgLeft: number; svgRight: number }[]
      > = {};
      for (const id of ['trend', 'bar']) {
        const svg = document
          .querySelector<HTMLElement>(`aeliqo-${id}`)
          ?.shadowRoot?.querySelector<SVGSVGElement>('svg');
        if (svg === undefined || svg === null) throw new Error(`Missing ${id} SVG`);
        const svgBounds = svg.getBoundingClientRect();
        output[id] = [...svg.querySelectorAll<SVGTextElement>('text.axis-x-tick')].map((label) => {
          const labelBounds = label.getBoundingClientRect();
          return {
            text: label.textContent,
            left: labelBounds.left,
            right: labelBounds.right,
            svgLeft: svgBounds.left,
            svgRight: svgBounds.right,
          };
        });
      }
      return output;
    });
    for (const id of ['trend', 'bar']) {
      expect(bounds[id]?.length, `${direction} ${id} should expose x-axis labels`).toBeGreaterThan(1);
      for (const bound of bounds[id] ?? []) {
        expect(bound.left, `${direction} ${id} ${bound.text} starts outside the SVG`).toBeGreaterThanOrEqual(
          bound.svgLeft - 0.5,
        );
        expect(bound.right, `${direction} ${id} ${bound.text} ends outside the SVG`).toBeLessThanOrEqual(
          bound.svgRight + 0.5,
        );
      }
    }
  }
});

test('centers a single category label in a narrow LTR and RTL chart', async ({ page }) => {
  await page.locator('aeliqo-bar').evaluate(async (node) => {
    const element = node as HTMLElement & {
      width: number;
      context: any;
      datasets: any[];
      updateComplete?: Promise<unknown>;
    };
    const current = element.datasets[0];
    const contextResult = element.context.results[0];
    element.width = 160;
    element.context = {
      ...element.context,
      results: [{ ...contextResult, counts: { ...contextResult.counts, loaded: 1 } }],
    };
    element.datasets = [{ result: current.result, rows: [{ ...current.rows[0], category: 'Single category label' }] }];
    await element.updateComplete;
  });
  for (const direction of ['ltr', 'rtl'] as const) {
    const bounds = await page.locator('aeliqo-bar').evaluate(async (host, nextDirection) => {
      document.documentElement.dir = nextDirection;
      const element = host as HTMLElement & { requestUpdate?: () => void; updateComplete?: Promise<unknown> };
      element.requestUpdate?.();
      if (element.updateComplete !== undefined) await element.updateComplete;
      const svg = host.shadowRoot?.querySelector<SVGSVGElement>('svg');
      if (svg === undefined || svg === null) throw new Error('Missing bar SVG');
      const svgBounds = svg.getBoundingClientRect();
      const label = svg.querySelector<SVGTextElement>('text.axis-x-tick');
      if (label === null) throw new Error('Missing single category label');
      const labelBounds = label.getBoundingClientRect();
      return {
        anchor: label.getAttribute('text-anchor'),
        left: labelBounds.left,
        right: labelBounds.right,
        svgLeft: svgBounds.left,
        svgRight: svgBounds.right,
      };
    }, direction);
    expect(bounds.anchor, `${direction} single category should be centered`).toBe('middle');
    expect(bounds.left, `${direction} single category starts outside the SVG`).toBeGreaterThanOrEqual(
      bounds.svgLeft - 0.5,
    );
    expect(bounds.right, `${direction} single category ends outside the SVG`).toBeLessThanOrEqual(
      bounds.svgRight + 0.5,
    );
  }
});

test('selection is keyboard reachable and an over-budget graphic retains exact data', async ({ page }) => {
  await page.locator('aeliqo-trend').evaluate((node) => {
    node.addEventListener('aeliqo-visualization-select', (event) => {
      (window as any).selection = (event as CustomEvent).detail;
    });
  });
  await page.locator('aeliqo-trend').getByText('View data table', { exact: true }).click();
  await page.locator('aeliqo-trend button').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('aeliqo-trend button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).selection?.source)).toBe('user');
  const updateMs = await page.locator('aeliqo-trend').evaluate(async (node) => {
    const started = performance.now();
    (node as HTMLElement & { maxMarks: number }).maxMarks = 1;
    await (node as any).updateComplete;
    return performance.now() - started;
  });
  test.info().annotations.push({ type: 'cartesian-budget-update-ms', description: updateMs.toFixed(2) });
  expect(updateMs).toBeLessThan(2_000);
  await expect(page.locator('aeliqo-trend [role="status"]')).toContainText('mark budget');
  await expect(page.locator('aeliqo-trend svg')).toHaveCount(0);
  await expect(page.locator('aeliqo-trend table')).toHaveCount(1);
});

test('narrow RTL at 24px retains a keyboard scroll region and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '24px';
  });
  const viewport = page.locator('aeliqo-trend [part="viewport"]');
  await expect(viewport).toHaveAttribute('role', 'region');
  await expect(viewport).toHaveAttribute('tabindex', '0');
  await expect(viewport).toHaveAttribute('aria-label', /Scroll to view/);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
});

test('keeps result warnings and precision uncertainty visible beside loaded values', async ({ page }) => {
  await page.locator('aeliqo-trend').evaluate(async (node) => {
    const element = node as any;
    const result = element.context.results[0];
    element.context = {
      ...element.context,
      results: [
        {
          ...result,
          precision: {
            kind: 'approximate',
            method: 'bounded sample arithmetic',
            uncertainty: { kind: 'unquantified', reason: 'Sampling uncertainty is not quantified.' },
          },
          warnings: [{ code: 'fixture.delayed', message: 'Source rows may be delayed.', retryable: false }],
        },
      ],
    };
    await element.updateComplete;
  });
  await expect(page.locator('aeliqo-trend [part="note"]')).toContainText('Sampling uncertainty is not quantified.');
  await expect(page.locator('aeliqo-trend [part="warnings"]')).toContainText('Source rows may be delayed.');
  await expect(page.locator('aeliqo-trend table caption')).toContainText('Loaded approximate values');
});
