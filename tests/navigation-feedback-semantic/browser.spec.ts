import { expect, test } from '@playwright/test';

type SemanticWindow = Window & {
  aeliqoNavigationFeedbackSemanticReady?: boolean;
  aeliqoNavigationFeedbackSemanticEvents?: readonly {
    nodeId: string;
    portId: string;
    payload: Record<string, unknown>;
  }[];
};

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/navigation-feedback-semantic/index.html');
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoNavigationFeedbackSemanticReady))
    .toBe(true);
});

test('renders dialog and tab slots from one validated semantic region', async ({ page }) => {
  const region = page.locator('#region');
  const dialog = region.locator('aeliqo-dialog');
  await expect(dialog.locator('dialog')).toBeVisible();
  await expect(dialog.locator('aeliqo-tabs')).toBeVisible();
  await expect(region.locator('aeliqo-breadcrumb')).toHaveCount(1);
  await expect(dialog.locator('aeliqo-tabs').getByRole('tab', { name: 'Breadcrumb' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect
    .poll(() =>
      dialog.locator('aeliqo-tabs').evaluate((element) => {
        const panel = element.shadowRoot?.querySelector<HTMLElement>('[role="tabpanel"][id*="breadcrumb"]');
        const slot = panel?.querySelector<HTMLSlotElement>('slot[name="breadcrumb"]');
        const assigned = slot?.assignedElements({ flatten: true }) ?? [];
        return {
          hidden: panel?.hasAttribute('hidden') ?? true,
          child: assigned[0]?.querySelector('aeliqo-breadcrumb')?.localName ?? '',
        };
      }),
    )
    .toEqual({ hidden: false, child: 'aeliqo-breadcrumb' });
});

test('maps route, action and page events while native navigation stays suppressed', async ({ page }) => {
  const region = page.locator('#region');
  const tabs = region.locator('aeliqo-tabs');
  const before = page.url();

  await tabs.getByRole('tab', { name: 'Breadcrumb' }).click();
  await region.locator('aeliqo-breadcrumb').getByRole('link', { name: 'Home' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoNavigationFeedbackSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'breadcrumb',
      portId: 'navigate',
      payload: { kind: 'navigate', route: { id: 'route.home', revision: '1' } },
    });
  expect(page.url()).toBe(before);

  await tabs.getByRole('tab', { name: 'Menu' }).click();
  const menu = region.locator('aeliqo-menu');
  await menu.getByRole('button', { name: 'Actions' }).click();
  await menu.getByRole('menuitem', { name: 'Open' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoNavigationFeedbackSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'menu',
      portId: 'action',
      payload: { kind: 'action-request', action: { id: 'action.open', revision: '1' }, input: { mode: 'open' } },
    });
  await expect(menu.getByRole('menu')).toBeHidden();

  await tabs.getByRole('tab', { name: 'Pagination' }).click();
  await region.locator('aeliqo-pagination').getByRole('button', { name: 'Next page' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoNavigationFeedbackSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'pagination',
      portId: 'page',
      payload: { kind: 'page', outputId: 'results', cursor: 'cursor-2', queryDigest: 'query-1' },
    });
});

test('keeps a keyed overlay instance and local open state when tab children move', async ({ page }) => {
  const region = page.locator('#region');
  await region.locator('aeliqo-tabs').getByRole('tab', { name: 'Popover', exact: true }).click();
  const popover = region.locator('aeliqo-popover');
  await popover.getByRole('button', { name: 'Details', exact: true }).click();
  await popover.evaluate((el) => {
    (window as any).originalSemanticPopover = el;
  });
  await page.evaluate(() => (window as any).reorderSemanticPopover());
  await expect
    .poll(() =>
      popover.evaluate((el) => ({ same: el === (window as any).originalSemanticPopover, open: (el as any).open })),
    )
    .toEqual({ same: true, open: true });
  await expect(popover.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
});
