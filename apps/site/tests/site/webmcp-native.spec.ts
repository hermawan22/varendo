import { test, expect, type Page } from '@playwright/test';

async function nativeCall(page: Page, name: string, input: unknown) {
  return page.evaluate(
    async ({ name, input }) => {
      const host = (
        document as Document & {
          modelContext: {
            getTools(): Promise<{ name: string }[]>;
            executeTool(tool: { name: string }, input: unknown): Promise<unknown>;
          };
        }
      ).modelContext;
      const tool = (await host.getTools()).find((entry) => entry.name === name);
      if (tool === undefined) throw new Error(`Native tool ${name} is unavailable.`);
      let result: unknown;
      try {
        result = await host.executeTool(tool, input);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('parse input arguments')) throw error;
        result = await host.executeTool(tool, JSON.stringify(input));
      }
      return typeof result === 'string' ? JSON.parse(result) : result;
    },
    { name, input },
  );
}

test('native browser tools render component, workspace and page, then unregister on reset', async ({
  page,
  browser,
}, info) => {
  await page.goto('/playground/');
  await expect(page.locator('#pg-receipt-state')).toHaveText('renderer-ready');
  await page.getByRole('button', { name: 'Browser agent', exact: true }).click();
  await expect(page.locator('#pg-connect-status')).toContainText('API available');
  await page.getByRole('button', { name: 'Enable WebMCP' }).click();
  await expect(page.locator('#pg-connect-status')).toContainText('registered 3 tools');
  const context = await nativeCall(page, 'aeliqo_context', {});
  expect(context).toMatchObject({ ok: true, value: { state: 'accepted' } });
  const component = await nativeCall(page, 'aeliqo_render', {
    version: '1',
    id: 'native-people',
    kind: 'browse',
    resource: 'people',
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
  });
  expect(component).toMatchObject({ ok: true, value: { state: 'renderer-ready' } });
  await expect(page.locator('#pg-region')).toContainText('Sam Rivera');
  await expect(page.locator('#pg-region')).not.toContainText('Ada Chen');
  for (const kind of ['overview', 'page', 'overview', 'page']) {
    const result = await nativeCall(page, 'aeliqo_render', {
      version: '1',
      id: `native-${kind}`,
      kind: 'custom',
      resource: 'attendance',
      intent: { id: `attendance.${kind}`, revision: '1' },
      input: { team: 'Engineering' },
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, value: { state: 'renderer-ready' } });
    await expect(page.locator('#pg-region [data-aeliqo-node-id="summary"]')).toContainText('2');
    await expect(page.locator('#pg-region [data-aeliqo-node-id="breakdown"]')).toContainText('Ada');
  }
  await expect(page.getByRole('navigation', { name: 'Registered page navigation' })).toBeVisible();
  await page.locator('#pg-menu > summary').click();
  await page.getByRole('button', { name: 'Reset playground' }).click();
  const remaining = await page.evaluate(async () => {
    const host = (document as Document & { modelContext: { getTools(): Promise<{ name: string }[]> } }).modelContext;
    return (await host.getTools()).map((tool) => tool.name).filter((name) => name.startsWith('aeliqo_'));
  });
  expect(remaining).toEqual([]);
  await info.attach('native-evidence.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      browser: browser.version(),
      flag: 'WebMCPTesting',
      evidence: 'native',
      discovery: true,
      component: true,
      workspace: true,
      page: true,
      resetUnregistered: true,
    }),
  });
});
