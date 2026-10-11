import { expect, type Page } from '@playwright/test';

export interface CompareJourneyResult {
  readonly normalizedIntent: string | undefined;
  readonly selectedIds: readonly string[];
}

async function readComparison(page: Page): Promise<CompareJourneyResult> {
  const output = page.locator('#catalog-intent');
  await expect(output).toHaveAttribute('data-normalized-intent', 'compare');
  const selected = await output.getAttribute('data-selected-ids');
  const normalizedIntent = await output.getAttribute('data-normalized-intent');
  return Object.freeze({
    normalizedIntent: normalizedIntent ?? undefined,
    selectedIds: Object.freeze(selected?.split(',') ?? []),
  });
}

/** Drives the user-owned control through the real app/runtime/renderer path. */
export async function runManualCompareJourney(page: Page): Promise<CompareJourneyResult> {
  await page.getByRole('button', { name: 'Manual compare p1 and p2' }).click();
  await expect(page.locator('#catalog-status')).toContainText('manual comparison renderer-ready');
  return readComparison(page);
}

/** Uses a deterministic host fixture, never a provider call, for parity evidence. */
export async function runFixtureAgentCompareJourney(page: Page): Promise<CompareJourneyResult> {
  await page.getByRole('button', { name: 'Fixture-agent compare p1 and p2' }).click();
  await expect(page.locator('#catalog-status')).toContainText('fixture-agent comparison renderer-ready');
  await expect(page.locator('#catalog-intent')).toHaveAttribute('data-bridge-receipt', 'renderer-ready');
  return readComparison(page);
}

/** A host action clears the comparison receipt before another actor submits it. */
export async function resetJourneyThroughHostControl(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset through host control' }).click();
  await expect(page.locator('#catalog-status')).toContainText('Host reset');
  await expect(page.locator('#catalog-intent')).not.toHaveAttribute('data-normalized-intent', /.+/);
}
