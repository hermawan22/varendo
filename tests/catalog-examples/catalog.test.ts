import { describe, expect, it } from 'vitest';
import { CATALOG_EXAMPLE_IDS, catalogExamples, getCatalogExample } from '../../examples/catalog/index.js';

describe('catalog examples', () => {
  it('has one metadata entry and executable mount for every advertised component', () => {
    expect(CATALOG_EXAMPLE_IDS).toHaveLength(71);
    expect(catalogExamples).toHaveLength(71);
    expect(new Set(catalogExamples.map((example) => example.id)).size).toBe(71);
    for (const id of CATALOG_EXAMPLE_IDS) {
      const definition = getCatalogExample(id);
      expect(definition.metadata.source).toContain('registerAeliqoElements');
      expect(definition.metadata.source).toContain(`aeliqo-${id}`);
      expect(definition.metadata.source).toContain('function createCatalogRoot');
      expect(definition.metadata.source).toContain('function createCatalogElement');
      expect(definition.metadata.source).toContain('const root = createCatalogRoot(host)');
      expect(definition.metadata.source).not.toContain('__vite_ssr_import_');
      expect(definition.metadata.props.length).toBeGreaterThan(0);
      expect(definition.metadata.fixture.length).toBeGreaterThan(0);
      expect(definition.metadata.propsNotes.length).toBeGreaterThan(0);
      expect(definition.metadata.states.length).toBeGreaterThan(0);
      expect(definition.metadata.keyboard.length).toBeGreaterThan(0);
      expect(definition.metadata.events.length).toBeGreaterThan(0);
      expect(definition.metadata.expectedOutcome.length).toBeGreaterThan(0);
    }
  });
});
