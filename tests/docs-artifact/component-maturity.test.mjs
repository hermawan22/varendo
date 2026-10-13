import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { VARENDO_PRESENTATION_MANIFESTS } from '@varendo/web/region';
import { STANDARD_VIEW_REFS, standardFormRecipe } from '@varendo/web/recipes';

const catalog = JSON.parse(
  await readFile(new URL('../../catalog/components.json', import.meta.url), 'utf8'),
).components;
const semanticRepresentations = new Set(VARENDO_PRESENTATION_MANIFESTS.map((manifest) => manifest.ref.id));
const adaptiveViews = new Set(Object.values(STANDARD_VIEW_REFS).map((ref) => ref.id));
// The legacy data.trend recipe renders varendo-chart, not the catalog's visualization.trend element.
adaptiveViews.delete('data.trend');
if (standardFormRecipe.intents.includes('create') && standardFormRecipe.intents.includes('edit'))
  adaptiveViews.add('input.form');

test('catalog maturity matches registered semantic representations and standard recipes', () => {
  assert.equal(catalog.length, 71);
  for (const component of catalog) {
    const surfaces = component.surfaces;
    assert.deepEqual([...new Set(surfaces)], surfaces, `Duplicate maturity level for ${component.id}`);
    assert.ok(surfaces.includes('standalone'), `Missing standalone adoption for ${component.id}`);
    assert.ok(surfaces.every((level) => ['standalone', 'semantic', 'adaptive'].includes(level)));
    const representation = component.id === 'data.filter-builder' ? 'control.filter-builder' : component.id;
    assert.equal(
      surfaces.includes('semantic'),
      semanticRepresentations.has(representation),
      `Semantic binding metadata differs from the registered representation for ${component.id}`,
    );
    assert.equal(
      surfaces.includes('adaptive'),
      adaptiveViews.has(component.id),
      `Adaptive metadata differs from standard recipe support for ${component.id}`,
    );
  }
});
