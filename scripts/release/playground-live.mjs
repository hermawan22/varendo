import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

async function nativeCall(page, name, input) {
  return page.evaluate(
    async ({ name, input }) => {
      const host = document.modelContext;
      const tool = (await host.getTools()).find((entry) => entry.name === name);
      if (!tool) throw new Error(`Native tool ${name} is unavailable.`);
      let result;
      try {
        result = await host.executeTool(tool, input);
      } catch (error) {
        if (!error.message.includes('parse input arguments')) throw error;
        result = await host.executeTool(tool, JSON.stringify(input));
      }
      return typeof result === 'string' ? JSON.parse(result) : result;
    },
    { name, input },
  );
}

export async function verifyNativePlayground(page) {
  await page.getByRole('button', { name: 'Browser agent', exact: true }).click();
  await expect(page.locator('#pg-connect-status')).toContainText('API available');
  await page.getByRole('button', { name: 'Enable WebMCP' }).click();
  await expect(page.locator('#pg-connect-status')).toContainText('registered 3 tools');
  assert.equal((await nativeCall(page, 'aeliqo_context', {})).value.state, 'accepted');
  const component = await nativeCall(page, 'aeliqo_render', {
    version: '1',
    id: 'release-people',
    kind: 'browse',
    resource: 'people',
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
  });
  assert.equal(component.value.state, 'renderer-ready');
  await expect(page.locator('#pg-region')).toContainText('Sam Rivera');
  await expect(page.locator('#pg-region')).not.toContainText('Ada Chen');
  for (const kind of ['overview', 'page', 'overview', 'page']) {
    const result = await nativeCall(page, 'aeliqo_render', {
      version: '1',
      id: `release-${kind}`,
      kind: 'custom',
      resource: 'attendance',
      intent: { id: `attendance.${kind}`, revision: '1' },
      input: { team: 'Engineering' },
    });
    assert.equal(result.value.state, 'renderer-ready', JSON.stringify(result));
    await expect(page.locator('#pg-region [data-aeliqo-node-id="summary"]')).toContainText('2');
    await expect(page.locator('#pg-region [data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
  }
  await expect(page.getByRole('navigation', { name: 'Registered page navigation' })).toBeVisible();
  await page.locator('#pg-menu > summary').click();
  await page.getByRole('button', { name: 'Reset playground' }).click();
  assert.deepEqual(
    await page.evaluate(async () =>
      (await document.modelContext.getTools()).map((tool) => tool.name).filter((name) => name.startsWith('aeliqo_')),
    ),
    [],
  );
  return {
    evidence: 'native',
    flag: 'WebMCPTesting',
    discovery: true,
    component: true,
    workspace: true,
    page: true,
    resetUnregistered: true,
  };
}

export async function verifyManualLayouts(page) {
  const layouts = [];
  for (const [journey, root] of [
    ['attendance', 'primary'],
    ['workspace', 'workspace'],
    ['page', 'page'],
  ]) {
    await page.locator(`[data-journey="${journey}"]`).click();
    await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
    if (journey === 'attendance') await expect(page.locator('#pg-region aeliqo-chart')).toBeVisible();
    else {
      const layout =
        journey === 'page'
          ? page.getByRole('region', { name: 'Registered attendance page', exact: true })
          : page.locator(`#pg-region [data-aeliqo-node-id="${root}"]`);
      await expect(layout).toBeVisible();
      await expect(page.locator('#pg-region [data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
    }
    layouts.push({ journey, status: await page.locator('#pg-receipt-state').textContent() });
  }
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('navigation', { name: 'Registered page navigation' })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await expect(page.locator('#pg-model-calls')).toHaveText('0');
  return layouts;
}
