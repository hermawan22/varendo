import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadCanonicalExamples } from '../../scripts/docs/build-public-docs.mjs';
import {
  auditCatalogInventory,
  formatCatalogInventoryReport,
  readCatalogInventoryInputs,
} from '../../scripts/docs/catalog-inventory.mjs';

const root = resolve(import.meta.dirname, '../..');

test('active catalog IDs have exact authored-page, example, declaration, and section coverage', async () => {
  const inputs = await readCatalogInventoryInputs(root);
  const examples = await loadCanonicalExamples();
  const audit = auditCatalogInventory({ ...inputs, examples });
  assert.equal(audit.ok, true, formatCatalogInventoryReport(audit));
  assert.equal(
    audit.catalogIds.length,
    JSON.parse(await readFile(resolve(root, 'catalog/components.json'), 'utf8')).components.length,
  );
});

test('inventory failures name the exact component and missing section', async () => {
  const inputs = await readCatalogInventoryInputs(root);
  const examples = await loadCanonicalExamples();
  const component = inputs.components.find(({ id }) => id === 'foundation.button');
  assert.ok(component);
  const pageContents = new Map(inputs.pageContents);
  pageContents.set(
    'foundation.button.md',
    pageContents.get('foundation.button.md').replace('## Purpose', '## Purpose removed'),
  );
  const audit = auditCatalogInventory({
    ...inputs,
    examples: examples.filter((example) => `${example.family}.${example.id}` !== component.id),
    declarations: inputs.declarations.filter(({ text }) => !text.includes('AeliqoButtonElement')),
    pageContents,
  });
  const report = formatCatalogInventoryReport(audit);
  assert.equal(audit.ok, false);
  assert.match(report, /foundation\.button: documentation parser error/u);
  assert.match(report, /foundation\.button: missing sections: Purpose/u);
  assert.match(report, /foundation\.button: missing runnable example/u);
  assert.match(report, /foundation\.button: missing generated declaration AeliqoButtonElement/u);
});

test('inventory rejects a Purpose section copied from the catalog contract', async () => {
  const inputs = await readCatalogInventoryInputs(root);
  const examples = await loadCanonicalExamples();
  const component = inputs.components.find(({ id }) => id === 'data.metric');
  assert.ok(component);
  const pageContents = new Map(inputs.pageContents);
  const source = pageContents.get(`${component.id}.md`);
  pageContents.set(
    `${component.id}.md`,
    source.replace(/(## Purpose\r?\n\r?\n)[\s\S]*?(?=\r?\n## When to use it)/u, `$1${component.contract}\n`),
  );
  const audit = auditCatalogInventory({ ...inputs, examples, pageContents });
  assert.equal(audit.ok, false);
  assert.match(formatCatalogInventoryReport(audit), /data\.metric: Purpose repeats catalog contract/u);
});
