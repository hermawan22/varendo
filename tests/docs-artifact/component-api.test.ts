import { resolve } from 'node:path';
import { expect, it } from 'vitest';

type Metadata = {
  readonly properties: readonly { readonly name: string; readonly type: string; readonly default: string }[];
  readonly parts: readonly string[];
  readonly semantics: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly dependencies: readonly string[];
  readonly sizing: readonly string[];
  readonly bounds: readonly string[];
};
type ComponentSources = Map<string, unknown>;
type ComponentApiModule = {
  readonly loadComponentSources: (root: string) => Promise<ComponentSources>;
  readonly componentApi: (classes: ComponentSources, name: string) => Metadata;
};

it('keeps generated component metadata inside the selected class lineage', async () => {
  const api = (await import('../../scripts/docs/component-api.mjs')) as ComponentApiModule;
  const classes = await api.loadComponentSources(resolve(process.cwd(), 'packages/web/src'));
  const table = api.componentApi(classes, 'AeliqoTableElement');
  const formFlow = api.componentApi(classes, 'AeliqoFormFlowElement');
  const comparison = api.componentApi(classes, 'AeliqoComparisonElement');
  const trend = api.componentApi(classes, 'AeliqoTrendElement');

  expect(table.sourceFiles).toEqual(['packages/web/src/elements/aeliqo-table.ts']);
  expect(table.sourceFiles.every((path) => !path.startsWith('/') && !path.includes('..'))).toBe(true);
  expect(table.sizing).toContain('grid-template-columns');
  expect(table.bounds).toContain('The source-defined `AELIQO_TABLE_MAX_VIRTUAL_ROWS` limit is 100.');
  expect(table.bounds.join(' ')).toContain('`virtualCount` (default 40)');

  expect(formFlow.sourceFiles).toEqual([
    'packages/web/src/compound/base.ts',
    'packages/web/src/compound/elements-inputs.ts',
  ]);
  expect(formFlow.sizing).toEqual(['flex-wrap']);
  expect(formFlow.bounds.join(' ')).not.toContain('MAX_COMPARISON');
  expect(comparison.bounds).toEqual([
    'The source-defined `MAX_COMPARISON_KEYS` limit is 32.',
    'The source-defined `MAX_COMPARISON_METRICS` limit is 64.',
  ]);

  expect(trend.properties.find(({ name }) => name === 'label')).toEqual({
    name: 'label',
    type: 'string',
    default: "'Data visualization'",
  });
  expect(trend.parts).toContain('viewport');
  expect(trend.parts).toContain('data');
  expect(trend.semantics).toEqual(
    expect.arrayContaining(['aria-label', 'aria-pressed', 'button', 'role', 'svg', 'table']),
  );

  for (const metadata of [table, formFlow, comparison, trend]) {
    const published = JSON.stringify(metadata);
    for (const fragment of ['${', 'height: {type', 'width: 30rem) {', 'slice(0', '"bounded"', '"window"']) {
      expect(published).not.toContain(fragment);
    }
  }
});
