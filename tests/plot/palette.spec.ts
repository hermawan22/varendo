import { expect, test } from '@playwright/test';
import type { AeliqoPlotElement } from '../../packages/web/src/plot/element.js';

test('theme changes repaint Canvas with the same token color as SVG', async ({ page }) => {
  await page.goto('/tests/plot/index.html');
  await page.locator('aeliqo-plot circle').first().waitFor();
  const positions = await page
    .locator('aeliqo-plot circle')
    .first()
    .evaluate((node) => ({
      x: Number(node.getAttribute('cx')),
      y: Number(node.getAttribute('cy')),
    }));
  for (const theme of ['light', 'dark', 'light']) {
    const expected = await page.locator('aeliqo-plot').evaluate(async (node, mode) => {
      const plot = node as AeliqoPlotElement;
      plot.renderer = 'svg';
      plot.setAttribute('data-aeliqo-theme', mode);
      await plot.updateComplete;
      const mark = plot.shadowRoot?.querySelector('circle');
      if (!mark) throw new Error('Missing plot mark');
      return {
        actual: getComputedStyle(mark).fill,
        token: getComputedStyle(plot).getPropertyValue('--aeliqo-visualization-series1').trim(),
      };
    }, theme);
    const rgb = await page.evaluate((color) => {
      const c = document.createElement('canvas').getContext('2d');
      if (!c) throw new Error('Missing canvas context');
      c.fillStyle = color;
      c.fillRect(0, 0, 1, 1);
      return Array.from(c.getImageData(0, 0, 1, 1).data);
    }, expected.token);
    await page.locator('aeliqo-plot').evaluate(async (node) => {
      const plot = node as AeliqoPlotElement;
      plot.renderer = 'canvas';
      await plot.updateComplete;
    });
    await expect
      .poll(() =>
        page.locator('canvas').evaluate((node, p) => {
          const canvas = node as HTMLCanvasElement;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Missing canvas context');
          const ratio = canvas.width / 640;
          return Array.from(context.getImageData(Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1).data);
        }, positions),
      )
      .toEqual(rgb);
    expect(expected.actual).toBe(`rgb(${rgb.slice(0, 3).join(', ')})`);
  }
  await page.locator('aeliqo-plot').evaluate((node) => node.setAttribute('data-aeliqo-theme', 'dark'));
  await expect
    .poll(() =>
      page.locator('canvas').evaluate((node, p) => {
        const canvas = node as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Missing canvas context');
        const ratio = canvas.width / 640;
        return Array.from(context.getImageData(Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1).data).slice(
          0,
          3,
        );
      }, positions),
    )
    .toEqual([165, 180, 252]);
});

for (const theme of ['light', 'dark']) {
  test(`quantitative endpoints match their tokens in SVG and Canvas (${theme})`, async ({ page }) => {
    await page.goto('/tests/plot/index.html');
    await page.locator('aeliqo-plot circle').first().waitFor();
    await page.locator('aeliqo-plot').evaluate(async (node, mode) => {
      const plot = node as AeliqoPlotElement;
      if (!plot.unit) throw new Error('Missing plot unit');
      plot.setAttribute('data-aeliqo-theme', mode);
      plot.unit = {
        ...plot.unit,
        mark: 'point',
        encoding: { ...plot.unit.encoding, color: { field: 'x', scale: 'linear' } },
      };
      await plot.updateComplete;
    }, theme);
    const marks = await page.locator('aeliqo-plot circle').evaluateAll((nodes) =>
      nodes.map((node) => ({
        x: Number(node.getAttribute('cx')),
        y: Number(node.getAttribute('cy')),
        fill: getComputedStyle(node).fill,
      })),
    );
    expect(marks).toHaveLength(2);
    const expected = await page.locator('aeliqo-plot').evaluate((node) => {
      const style = getComputedStyle(node);
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Missing canvas context');
      return ['start', 'end'].map((end) => {
        context.fillStyle = style.getPropertyValue(`--aeliqo-visualization-quantitative-${end}`).trim();
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      });
    });
    for (const [index, mark] of marks.entries()) {
      const actual = await page.evaluate((color) => {
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('Missing canvas context');
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      }, mark.fill);
      expect(actual).toEqual(expected[index]);
    }
    await page.locator('aeliqo-plot').evaluate(async (node) => {
      const plot = node as AeliqoPlotElement;
      plot.renderer = 'canvas';
      await plot.updateComplete;
    });
    expect(
      await page.locator('canvas').evaluate((node, positions) => {
        const canvas = node as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Missing canvas context');
        const ratio = canvas.width / 640;
        return positions.map((p) =>
          Array.from(context.getImageData(Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1).data),
        );
      }, marks),
    ).toEqual(expected);
  });
}

test('system theme and inherited custom tokens repaint a connected canvas', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/tests/plot/index.html');
  await page.locator('aeliqo-plot circle').first().waitFor();
  const position = await page
    .locator('aeliqo-plot circle')
    .first()
    .evaluate((node) => ({ x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }));
  await page.locator('aeliqo-plot').evaluate(async (node) => {
    const plot = node as AeliqoPlotElement;
    plot.renderer = 'canvas';
    await plot.updateComplete;
  });
  const pixel = () =>
    page.locator('canvas').evaluate((node, p) => {
      const canvas = node as HTMLCanvasElement,
        context = canvas.getContext('2d');
      if (!context) throw new Error('Missing canvas context');
      const ratio = canvas.width / 640;
      return Array.from(context.getImageData(Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1).data).slice(0, 3);
    }, position);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(pixel).toEqual([165, 180, 252]);
  await page.locator('aeliqo-plot').evaluate((node) => {
    node.setAttribute('data-aeliqo-theme', 'inherit');
    document.body.style.setProperty('--aeliqo-visualization-series1', '#123456');
  });
  await expect.poll(pixel).toEqual([18, 52, 86]);
  await page.evaluate(() => document.body.style.setProperty('--aeliqo-visualization-series1', '#345678'));
  await expect.poll(pixel).toEqual([52, 86, 120]);
});

test('forced colors preserve SVG and Canvas mark parity', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/tests/plot/index.html');
  await page.locator('aeliqo-plot circle').first().waitFor();
  const mark = await page
    .locator('aeliqo-plot circle')
    .first()
    .evaluate((node) => ({
      x: Number(node.getAttribute('cx')),
      y: Number(node.getAttribute('cy')),
      fill: getComputedStyle(node).fill,
    }));
  const expected = await page.evaluate((color) => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Missing canvas context');
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, mark.fill);
  await page.locator('aeliqo-plot').evaluate(async (node) => {
    const plot = node as AeliqoPlotElement;
    plot.renderer = 'canvas';
    await plot.updateComplete;
  });
  expect(
    await page.locator('canvas').evaluate((node, p) => {
      const canvas = node as HTMLCanvasElement,
        context = canvas.getContext('2d');
      if (!context) throw new Error('Missing canvas context');
      const ratio = canvas.width / 640;
      return Array.from(context.getImageData(Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1).data);
    }, mark),
  ).toEqual(expected);
});

test('disconnect removes theme listeners and reconnect restores painting', async ({ page }) => {
  await page.goto('/tests/plot/index.html');
  await page.locator('aeliqo-plot circle').first().waitFor();
  const result = await page.locator('aeliqo-plot').evaluate(async (node) => {
    const plot = node as AeliqoPlotElement;
    plot.setAttribute('data-aeliqo-theme', 'light');
    const mark = plot.shadowRoot?.querySelector('circle');
    if (!mark) throw new Error('Missing plot mark');
    const x = Number(mark.getAttribute('cx')),
      y = Number(mark.getAttribute('cy'));
    plot.renderer = 'canvas';
    await plot.updateComplete;
    const requestUpdate = plot.requestUpdate.bind(plot);
    let updates = 0;
    plot.requestUpdate = (...args) => {
      updates++;
      requestUpdate(...args);
    };
    plot.remove();
    plot.setAttribute('data-aeliqo-theme', 'dark');
    document.body.classList.add('theme-changed');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const whileDetached = updates;
    document.body.append(plot);
    await plot.updateComplete;
    const canvas = plot.shadowRoot?.querySelector('canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('Missing canvas context');
    const ratio = canvas.width / 640;
    const pixel = Array.from(context.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data).slice(0, 3);
    return { whileDetached, reconnectedUpdates: updates, pixel };
  });
  expect(result.whileDetached).toBe(0);
  expect(result.pixel).toEqual([165, 180, 252]);
  expect(result.reconnectedUpdates).toBeGreaterThan(0);
});

test('Cartesian heatmap marks and numeric key share theme endpoints', async ({ page }, info) => {
  await page.goto('/tests/visualization/cartesian.html');
  const heatmap = page.locator('aeliqo-heatmap');
  await heatmap.locator('svg rect').first().waitFor();
  const ticks = await heatmap.locator('[part="color-key-ticks"]').innerText();
  for (const theme of ['light', 'dark']) {
    await heatmap.evaluate((node, mode) => node.setAttribute('data-aeliqo-theme', mode), theme);
    const evidence = await heatmap.evaluate((node) => {
      const style = getComputedStyle(node),
        context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Missing canvas context');
      const rgb = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .join(', ');
      };
      const key = node.shadowRoot?.querySelector('[part="color-key-bar"]');
      if (!key) throw new Error('Missing numeric color key');
      return {
        gradient: getComputedStyle(key).backgroundImage,
        endpoints: ['start', 'end'].map((end) =>
          rgb(style.getPropertyValue(`--aeliqo-visualization-quantitative-${end}`).trim()),
        ),
        marks: [...(node.shadowRoot?.querySelectorAll('svg rect') ?? [])].map((mark) =>
          rgb(getComputedStyle(mark).fill),
        ),
      };
    });
    for (const endpoint of evidence.endpoints) {
      expect(evidence.marks).toContain(endpoint);
      expect(evidence.gradient).toContain(`rgb(${endpoint})`);
    }
    await expect(heatmap.locator('[part="color-key-ticks"]')).toHaveText(ticks, { useInnerText: true });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
  await heatmap.evaluate((node) => node.setAttribute('dir', 'rtl'));
  await heatmap.screenshot({ path: info.outputPath('heatmap-dark-rtl.png') });
});
