import { test, expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import components from '../../catalog/components.json' with { type: 'json' };
import { REVIEW_VARIANTS, reviewColorScheme, reviewViewport } from './review-variants.js';
// These are unapproved review captures, never auto-accepted pixel baselines.
for (const component of components.components)
  for (const variant of REVIEW_VARIANTS) {
    const id = component.id.slice(component.id.indexOf('.') + 1);
    test(`${id} ${variant}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize(reviewViewport(variant));
      await page.emulateMedia({ colorScheme: reviewColorScheme(variant) });
      await page.goto(`/tests/visual/index.html?component=${id}&variant=${variant}`);
      await page.waitForFunction(() =>
        Boolean((window as typeof window & { aeliqoReviewReady?: boolean }).aeliqoReviewReady),
      );
      await expect(page.locator(`#fixture aeliqo-${id}`).first()).toBeAttached();
      if (id === 'dialog') {
        const closedAxe = await new AxeBuilder({ page }).analyze();
        await info.attach('accessibility-closed.json', {
          body: JSON.stringify({ violations: closedAxe.violations, incomplete: closedAxe.incomplete }, null, 2),
          contentType: 'application/json',
        });
        expect(
          closedAxe.violations.map(({ id, impact, nodes }) => ({
            id,
            impact,
            nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
          })),
        ).toEqual([]);
        expect(closedAxe.incomplete.filter(({ id }) => id === 'aria-prohibited-attr')).toEqual([]);
        await page.getByRole('button', { name: 'Open confirmation' }).click();
        await expect(page.getByRole('dialog', { name: 'Confirm archive' })).toBeVisible();
      }
      const axeBuilder = new AxeBuilder({ page });
      if (id === 'dialog') {
        // WebKit measures the inert page control against the native modal backdrop while the dialog is open.
        axeBuilder.include(`#fixture aeliqo-${id}`);
      }
      const axe = await axeBuilder.analyze();
      await info.attach('accessibility.json', {
        body: JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }, null, 2),
        contentType: 'application/json',
      });
      const measurements = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        theme: document.documentElement.dataset.theme,
        dir: document.documentElement.dir,
        devicePixelRatio,
        renderedText: document.body.innerText,
      }));
      await info.attach('environment.json', {
        body: JSON.stringify(
          { browser: page.context().browser()?.version(), project: info.project.name, ...measurements },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath('review.png'), fullPage: true });
      expect(errors).toEqual([]);
      if (id === 'trend' && variant === 'desktop-light') {
        const axes = await page.locator('#fixture aeliqo-trend').evaluate((element) => {
          const svg = element.shadowRoot!.querySelector<SVGSVGElement>('[part="viewport"] svg')!;
          return {
            x: [...svg.querySelectorAll<SVGTextElement>('.axis-x-tick')].map((tick) => ({
              text: tick.textContent,
              bounds: tick.getBoundingClientRect().toJSON(),
              fill: getComputedStyle(tick).fill,
            })),
            y: [...svg.querySelectorAll<SVGTextElement>('.axis-y-tick')].map((tick) => ({
              text: tick.textContent,
              bounds: tick.getBoundingClientRect().toJSON(),
              fill: getComputedStyle(tick).fill,
            })),
          };
        });
        expect(axes.x).not.toHaveLength(0);
        expect(axes.y).not.toHaveLength(0);
        await info.attach('trend-axis-inspection.json', {
          body: JSON.stringify(axes, null, 2),
          contentType: 'application/json',
        });
      }
      expect(
        axe.violations.map(({ id, impact, nodes }) => ({
          id,
          impact,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      ).toEqual([]);
      expect(axe.incomplete.filter(({ id }) => id === 'aria-prohibited-attr')).toEqual([]);
      expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewport.width);
      if (id === 'select') {
        const control = page.locator('aeliqo-select select');
        await expect(control).toHaveValue('research');
        expect(await control.locator('option').allTextContents()).toEqual(['Choose a team', 'Research', 'Product']);
      }
      if (variant === 'desktop-light' && id === 'investigation') {
        const layout = await page.locator('aeliqo-investigation').evaluate((element) => {
          const root = element.shadowRoot!;
          const grid = root.querySelector<HTMLElement>('[part="grid"]')!;
          const trendPanel = root.querySelector<HTMLElement>('[part="trend"]')!;
          const trend = root.querySelector('aeliqo-trend')!;
          const trendRoot = trend.shadowRoot!;
          // Measure the exact-values table in its expanded state.
          trendRoot.querySelector<HTMLDetailsElement>('[part="data-details"]')!.open = true;
          const data = trendRoot.querySelector<HTMLElement>('[part="data"]')!;
          const dataBox = data.getBoundingClientRect();
          const caption = trendRoot.querySelector('caption')!.getBoundingClientRect();
          const cells = [...trendRoot.querySelectorAll<HTMLElement>('tbody tr:first-child td')].map(
            (cell) => cell.getBoundingClientRect().width,
          );
          return {
            gridWidth: grid.getBoundingClientRect().width,
            panelWidth: trendPanel.getBoundingClientRect().width,
            dataStart: dataBox.left,
            dataEnd: dataBox.right,
            dataOverflow: data.scrollWidth - data.clientWidth,
            captionStart: caption.left,
            captionEnd: caption.right,
            cells,
          };
        });
        expect(layout.panelWidth).toBeGreaterThanOrEqual(layout.gridWidth - 1);
        expect(layout.dataOverflow).toBeLessThanOrEqual(1);
        expect(layout.captionStart).toBeGreaterThanOrEqual(layout.dataStart - 1);
        expect(layout.captionEnd).toBeLessThanOrEqual(layout.dataEnd + 1);
        expect(layout.cells.length).toBeGreaterThan(2);
        expect(Math.min(...layout.cells)).toBeGreaterThanOrEqual(64);
      }
      if (
        variant === 'narrow-dark-rtl' &&
        ['trend', 'bar', 'area', 'scatter', 'histogram', 'heatmap', 'timeline', 'investigation'].includes(id)
      ) {
        const sizes = await page.locator(`aeliqo-${id}`).evaluate(async (element) => {
          const chart =
            element.localName === 'aeliqo-investigation' ? element.shadowRoot!.querySelector('aeliqo-trend')! : element;
          const label = chart.shadowRoot!.querySelector<SVGTextElement>(
            'svg text.axis-x-tick,svg text.timeline-label',
          )!;
          const original = document.documentElement.style.fontSize;
          const settle = () =>
            new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          document.documentElement.style.fontSize = '16px';
          await settle();
          const normal = label.getBoundingClientRect().height;
          document.documentElement.style.fontSize = '32px';
          await settle();
          const zoomed = label.getBoundingClientRect().height;
          document.documentElement.style.fontSize = original;
          await settle();
          return { normal, zoomed };
        });
        expect(sizes.normal).toBeGreaterThan(0);
        expect(sizes.zoomed / sizes.normal).toBeGreaterThanOrEqual(1.8);
      }
      if (variant === 'narrow-dark-rtl' && ['stack', 'grid'].includes(id)) {
        const layout = await page.locator(`aeliqo-${id}`).evaluate((element) => {
          const nodes = [...element.querySelectorAll('span')].map((node) => node.getBoundingClientRect());
          return nodes.map((box, index) =>
            index === 0
              ? Number.POSITIVE_INFINITY
              : Math.max(
                  0,
                  Math.max(
                    box.left - nodes[index - 1]!.right,
                    nodes[index - 1]!.left - box.right,
                    box.top - nodes[index - 1]!.bottom,
                    nodes[index - 1]!.top - box.bottom,
                  ),
                ),
          );
        });
        expect(layout).toHaveLength(2);
        expect(layout[1]).toBeGreaterThan(0);
      }
      if (variant === 'narrow-dark-rtl' && ['form', 'dialog'].includes(id)) {
        const control = await page.locator(`aeliqo-${id}`).evaluate((element) => {
          const button = element.querySelector('button')!;
          const box = button.getBoundingClientRect();
          return {
            fontSize: parseFloat(getComputedStyle(button).fontSize),
            hostFontSize: parseFloat(getComputedStyle(element).fontSize),
            width: box.width,
            height: box.height,
          };
        });
        expect(control.fontSize).toBeGreaterThanOrEqual(control.hostFontSize);
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.height).toBeGreaterThanOrEqual(44);
      }
      if (
        variant === 'narrow-dark-rtl' &&
        ['trend', 'bar', 'area', 'scatter', 'histogram', 'heatmap', 'investigation'].includes(id)
      ) {
        const intersections = await page.locator(`aeliqo-${id}`).evaluate((element) => {
          const chart =
            element.localName === 'aeliqo-investigation' ? element.shadowRoot!.querySelector('aeliqo-trend')! : element;
          const labels = [
            ...chart.shadowRoot!.querySelectorAll<SVGTextElement>(
              'svg text.axis-x-tick,svg text.axis-y-tick,svg text.axis-title',
            ),
          ];
          const boxes = labels.map((label) => ({ text: label.textContent ?? '', box: label.getBoundingClientRect() }));
          return boxes.flatMap((left, index) =>
            boxes
              .slice(index + 1)
              .filter(
                (right) =>
                  left.box.left < right.box.right &&
                  left.box.right > right.box.left &&
                  left.box.top < right.box.bottom &&
                  left.box.bottom > right.box.top,
              )
              .map((right) => `${left.text} / ${right.text}`),
          );
        });
        expect(intersections).toEqual([]);
      }
      if (variant === 'narrow-dark-rtl' && ['relationship', 'tree', 'treemap', 'timeline'].includes(id)) {
        const intersections = await page.locator(`aeliqo-${id}`).evaluate((element) => {
          const labels = [...element.shadowRoot!.querySelectorAll<SVGTextElement>('svg text:not(.sr-only)')];
          const boxes = labels.map((label) => ({ text: label.textContent ?? '', box: label.getBoundingClientRect() }));
          return boxes.flatMap((left, index) =>
            boxes
              .slice(index + 1)
              .filter(
                (right) =>
                  left.box.left < right.box.right &&
                  left.box.right > right.box.left &&
                  left.box.top < right.box.bottom &&
                  left.box.bottom > right.box.top,
              )
              .map((right) => `${left.text} / ${right.text}`),
          );
        });
        expect(intersections).toEqual([]);
      }
      if (variant === 'narrow-dark-rtl' && ['tree', 'treemap'].includes(id)) {
        const contrasts = await page.locator(`aeliqo-${id}`).evaluate((element) => {
          const rgb = (value: string) =>
            value
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((channel) => {
                const normalized = channel / 255;
                return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
              });
          const luminance = (value: string) => {
            const [r, g, b] = rgb(value);
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
          };
          return [
            ...element.shadowRoot!.querySelectorAll<SVGTextElement>('svg text.tree-label,svg text.treemap-label'),
          ].map((label) => {
            const rect = label.previousElementSibling!;
            const foreground = luminance(getComputedStyle(label).fill);
            const background = luminance(getComputedStyle(rect).fill);
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          });
        });
        expect(contrasts.length).toBeGreaterThan(0);
        expect(Math.min(...contrasts)).toBeGreaterThanOrEqual(4.5);
      }
      if (variant === 'narrow-dark-rtl' && id === 'quality-panel') {
        const columns = await page
          .locator('aeliqo-quality-panel')
          .evaluate((element) => getComputedStyle(element.shadowRoot!.querySelector('dl')!).gridTemplateColumns);
        expect(columns.trim().split(/\s+/)).toHaveLength(1);
      }
      if (variant === 'narrow-dark-rtl' && ['tree', 'treemap', 'relationship', 'timeline'].includes(id)) {
        const host = page.locator(`aeliqo-${id}`);
        await verifyScrollableGraphic(host);
        for (const width of [240, 320]) {
          await host.evaluate((element, width) => ((element as HTMLElement).style.width = `${width}px`), width);
          await verifyScrollableGraphic(host);
        }
        await host.evaluate((element) => ((element as HTMLElement).style.width = ''));
      }
      if (variant === 'narrow-dark-rtl' && id === 'timeline') {
        const layout = await page.locator(`aeliqo-${id}`).evaluate((element) => {
          const root = element.shadowRoot!;
          const viewport = root.querySelector<HTMLElement>('[part="viewport"]')!;
          const data = root.querySelector<HTMLElement>('[part="data"]')!;
          return {
            direction: getComputedStyle(viewport).direction,
            dataOverflow: data.scrollWidth - data.clientWidth,
          };
        });
        expect(layout.direction).toBe('ltr');
        expect(layout.dataOverflow).toBeLessThanOrEqual(1);
      }
      if (variant === 'narrow-dark-rtl' && id === 'investigation') {
        const layout = await page.locator('aeliqo-investigation').evaluate((element) => {
          const trend = element.shadowRoot!.querySelector('aeliqo-trend')!;
          const root = trend.shadowRoot!;
          root.querySelector<HTMLDetailsElement>('[part="data-details"]')!.open = true;
          const viewport = root.querySelector<HTMLElement>('[part="viewport"]')!;
          const data = root.querySelector<HTMLElement>('[part="data"]')!;
          const graphic = viewport.querySelector('svg')!.getBoundingClientRect();
          const viewportBox = viewport.getBoundingClientRect();
          return {
            direction: getComputedStyle(viewport).direction,
            dataOverflow: data.scrollWidth - data.clientWidth,
            graphicStart: graphic.left - viewportBox.left,
            graphicEnd: viewportBox.right - graphic.right,
          };
        });
        expect(layout.direction).toBe('ltr');
        expect(layout.dataOverflow).toBeLessThanOrEqual(1);
        expect(layout.graphicStart).toBeGreaterThanOrEqual(-1);
        expect(layout.graphicEnd).toBeGreaterThanOrEqual(-1);
      }
      if (variant === 'narrow-dark-rtl' && ['relationship', 'tree', 'treemap'].includes(id)) {
        const layout = await page.locator(`aeliqo-${id}`).evaluate((element) => {
          const root = element.shadowRoot!;
          const host = element.getBoundingClientRect();
          const viewport = root.querySelector<HTMLElement>('[part="viewport"]')!;
          const data = root.querySelector<HTMLElement>('[part="data"]')!;
          const caption = root.querySelector('caption')!.getBoundingClientRect();
          const cells = [...root.querySelectorAll<HTMLElement>('tbody tr:first-child td')].map((cell) => ({
            display: getComputedStyle(cell).display,
            width: cell.getBoundingClientRect().width,
          }));
          return {
            hostStart: host.left,
            hostEnd: host.right,
            direction: getComputedStyle(viewport).direction,
            dataOverflow: data.scrollWidth - data.clientWidth,
            captionStart: caption.left,
            captionEnd: caption.right,
            cells,
          };
        });
        expect(layout.direction).toBe('ltr');
        expect(layout.dataOverflow).toBeLessThanOrEqual(1);
        expect(layout.captionStart).toBeGreaterThanOrEqual(layout.hostStart - 1);
        expect(layout.captionEnd).toBeLessThanOrEqual(layout.hostEnd + 1);
        expect(layout.cells.length).toBeGreaterThan(1);
        expect(
          layout.cells.every((cell) => cell.display === 'grid' && cell.width >= layout.hostEnd - layout.hostStart - 1),
        ).toBe(true);
      }
      if (variant === 'narrow-dark-rtl' && id === 'heatmap') {
        const labels = await page.locator('aeliqo-heatmap').evaluate((element) => {
          const svg = element.shadowRoot!.querySelector('svg')!;
          const graphic = svg.getBoundingClientRect();
          return [...svg.querySelectorAll<SVGTextElement>('text')].map((label) => {
            const box = label.getBoundingClientRect();
            return {
              text: label.textContent,
              start: box.left,
              end: box.right,
              graphicStart: graphic.left,
              graphicEnd: graphic.right,
            };
          });
        });
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) {
          expect(label.start, `${label.text} starts outside the heatmap`).toBeGreaterThanOrEqual(
            label.graphicStart - 0.5,
          );
          expect(label.end, `${label.text} ends outside the heatmap`).toBeLessThanOrEqual(label.graphicEnd + 0.5);
        }
      }
      if (variant === 'narrow-dark-rtl' && id === 'calendar-grid') {
        const layout = await page.locator('aeliqo-calendar-grid').evaluate((element) => {
          const root = element.shadowRoot!;
          const host = element.getBoundingClientRect();
          const data = root.querySelector<HTMLElement>('[part="data"]')!;
          const cells = [...root.querySelectorAll<HTMLElement>('tbody tr:first-child td')].map((cell) => ({
            display: getComputedStyle(cell).display,
            width: cell.getBoundingClientRect().width,
            text: cell.textContent,
          }));
          return { hostWidth: host.width, dataOverflow: data.scrollWidth - data.clientWidth, cells };
        });
        expect(layout.dataOverflow).toBeLessThanOrEqual(1);
        expect(layout.cells.length).toBeGreaterThan(4);
        expect(
          layout.cells.every(
            (cell) => cell.display === 'grid' && cell.width >= layout.hostWidth - 1 && cell.text?.trim(),
          ),
        ).toBe(true);
      }
      if (variant === 'narrow-dark-rtl' && id === 'breakdown') {
        const layout = await page.locator('aeliqo-breakdown').evaluate((element) => {
          const host = element.getBoundingClientRect();
          const table = element.shadowRoot!.querySelector('aeliqo-table')!;
          const root = table.shadowRoot!;
          const scroll = root.querySelector<HTMLElement>('[part="scroll"]')!;
          const caption = root.querySelector('caption')!.getBoundingClientRect();
          const scope = root.querySelector<HTMLElement>('[part="scope"]')!.getBoundingClientRect();
          const cells = [...root.querySelectorAll<HTMLElement>('tbody tr:first-child td')].map((cell) => ({
            display: getComputedStyle(cell).display,
            width: cell.getBoundingClientRect().width,
          }));
          return {
            hostStart: host.left,
            hostEnd: host.right,
            scrollOverflow: scroll.scrollWidth - scroll.clientWidth,
            captionStart: caption.left,
            captionEnd: caption.right,
            scopeStart: scope.left,
            scopeEnd: scope.right,
            cells,
          };
        });
        expect(layout.scrollOverflow).toBeLessThanOrEqual(1);
        for (const [start, end] of [
          [layout.captionStart, layout.captionEnd],
          [layout.scopeStart, layout.scopeEnd],
        ]) {
          expect(start).toBeGreaterThanOrEqual(layout.hostStart - 1);
          expect(end).toBeLessThanOrEqual(layout.hostEnd + 1);
        }
        expect(layout.cells.length).toBeGreaterThan(1);
        expect(
          layout.cells.every((cell) => cell.display === 'grid' && cell.width >= layout.hostEnd - layout.hostStart - 1),
        ).toBe(true);
      }
      if (variant === 'narrow-dark-rtl' && id === 'combobox') {
        const layout = await page.locator('aeliqo-combobox').evaluate((element) => {
          const host = element.getBoundingClientRect();
          const root = element.shadowRoot!;
          const nodes = [
            root.querySelector<HTMLElement>('[part="label"]')!,
            root.querySelector<HTMLInputElement>('[part="input"]')!,
            ...root.querySelectorAll<HTMLElement>('[part="option"] span,[part="option"] small'),
          ];
          return {
            hostStart: host.left,
            hostEnd: host.right,
            nodes: nodes.map((node) => {
              const box = node.getBoundingClientRect();
              return { start: box.left, end: box.right, text: node.textContent };
            }),
          };
        });
        expect(layout.nodes.length).toBeGreaterThan(2);
        for (const node of layout.nodes) {
          expect(node.start, `${node.text} starts outside the combobox`).toBeGreaterThanOrEqual(layout.hostStart - 0.5);
          expect(node.end, `${node.text} ends outside the combobox`).toBeLessThanOrEqual(layout.hostEnd + 0.5);
        }
        const title = await page.locator('#title').evaluate((element) => {
          const box = element.getBoundingClientRect();
          const main = element.parentElement!.getBoundingClientRect();
          return { start: box.left, end: box.right, mainStart: main.left, mainEnd: main.right };
        });
        expect(title.start).toBeGreaterThanOrEqual(title.mainStart);
        expect(title.end).toBeLessThanOrEqual(title.mainEnd);
      }
      if (
        variant === 'narrow-dark-rtl' &&
        [
          'form',
          'dialog',
          'trend',
          'bar',
          'area',
          'scatter',
          'histogram',
          'heatmap',
          'matrix',
          'relationship',
          'tree',
          'treemap',
          'timeline',
          'calendar-grid',
          'investigation',
        ].includes(id)
      ) {
        await page.emulateMedia({ forcedColors: 'active' });
        const controls = await page.locator(`aeliqo-${id} button:not([part="close"])`).evaluateAll((buttons) =>
          buttons.map((button) => {
            const style = getComputedStyle(button);
            return {
              background: style.backgroundColor,
              color: style.color,
              borderStyle: style.borderStyle,
              borderWidth: parseFloat(style.borderWidth),
            };
          }),
        );
        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls) {
          expect(control.background).not.toBe('rgba(0, 0, 0, 0)');
          expect(control.color).not.toBe(control.background);
          expect(control.borderStyle).not.toBe('none');
          expect(control.borderWidth).toBeGreaterThanOrEqual(1);
        }
      }
    });
  }

async function verifyScrollableGraphic(host: Locator): Promise<void> {
  const viewport = host.locator('[part="viewport"]');
  await expect(viewport).toHaveAttribute('role', 'region');
  await expect(viewport).toHaveAttribute('aria-label', /.+/);
  await expect(viewport).toHaveAttribute('tabindex', '0');
  await viewport.focus();
  await expect(viewport).toBeFocused();
  const layout = await host.evaluate((element) => {
    const viewport = element.shadowRoot!.querySelector<HTMLElement>('[part="viewport"]')!;
    const svg = viewport.querySelector<SVGSVGElement>('svg')!;
    const host = element.getBoundingClientRect();
    const box = viewport.getBoundingClientRect();
    const initialScroll = viewport.scrollLeft;
    const clipStart = box.left + viewport.clientLeft;
    const clipEnd = clipStart + viewport.clientWidth;
    viewport.scrollLeft = 0;
    const graphic = svg.getBoundingClientRect();
    const labels = [...svg.querySelectorAll<SVGTextElement>('text:not(.sr-only)')].map((label) => {
      const bounds = label.getBoundingClientRect();
      const node = label.matches('.tree-label,.treemap-label')
        ? label.previousElementSibling!.getBoundingClientRect()
        : undefined;
      return {
        text: label.textContent,
        top: bounds.top - box.top,
        bottom: box.bottom - bounds.bottom,
        nodeTop: node === undefined ? undefined : bounds.top - node.top,
        nodeBottom: node === undefined ? undefined : node.bottom - bounds.bottom,
      };
    });
    viewport.scrollLeft = viewport.scrollWidth;
    const farEnd = svg.getBoundingClientRect().right;
    const scrolled = viewport.scrollLeft;
    viewport.scrollLeft = initialScroll;
    return {
      viewportStart: box.left - host.left,
      viewportEnd: host.right - box.right,
      overflow: getComputedStyle(viewport).overflowX,
      graphicWidth: graphic.width,
      intrinsicWidth: Number(svg.getAttribute('width')),
      viewportWidth: viewport.clientWidth,
      graphicStart: graphic.left - clipStart,
      farEnd: clipEnd - farEnd,
      scrolled,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      labels,
    };
  });
  expect(layout.viewportStart).toBeGreaterThanOrEqual(-1);
  expect(layout.viewportEnd).toBeGreaterThanOrEqual(-1);
  expect(layout.overflow).toBe('auto');
  expect(layout.intrinsicWidth).toBeGreaterThan(0);
  expect(layout.graphicWidth).toBeGreaterThanOrEqual(layout.intrinsicWidth);
  expect(layout.graphicWidth).toBeGreaterThan(layout.viewportWidth);
  expect(Math.abs(layout.graphicStart)).toBeLessThanOrEqual(1);
  expect(layout.scrolled).toBeGreaterThan(0);
  expect(Math.abs(layout.farEnd)).toBeLessThanOrEqual(1);
  expect(layout.pageOverflow).toBeLessThanOrEqual(0);
  expect(layout.labels.length).toBeGreaterThan(0);
  for (const label of layout.labels) {
    expect(label.top, `${label.text} is clipped above the graphic viewport`).toBeGreaterThanOrEqual(-1);
    expect(label.bottom, `${label.text} is clipped below the graphic viewport`).toBeGreaterThanOrEqual(-1);
    if (label.nodeTop !== undefined && label.nodeBottom !== undefined) {
      expect(label.nodeTop, `${label.text} must stay on its contrast background`).toBeGreaterThanOrEqual(0);
      expect(label.nodeBottom, `${label.text} must fit inside its node`).toBeGreaterThanOrEqual(0);
    }
  }
}
