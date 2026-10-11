import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { imageInventory, sameInventory } from '../../scripts/visual/policy.mjs';
const baseline = process.env.AELIQO_VISUAL_BASELINE;
const candidate = process.env.AELIQO_VISUAL_CANDIDATE;
const inventory = await imageInventory(baseline);
sameInventory(inventory, await imageInventory(candidate));
for (const file of inventory) {
  test(file, async () => {
    expect(await readFile(join(candidate, file))).toMatchSnapshot(file.split(/[\\/]/u));
  });
}
