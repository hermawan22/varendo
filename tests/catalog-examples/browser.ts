import { CATALOG_EXAMPLE_IDS, catalogExample } from '../../examples/catalog/index.js';

const catalog = document.querySelector<HTMLElement>('#catalog');
if (catalog === null) throw new Error('Catalog fixture root is missing.');

const cleanups: (() => void)[] = [];
for (const id of CATALOG_EXAMPLE_IDS) {
  const section = document.createElement('section');
  section.dataset.exampleId = id;
  const heading = document.createElement('h2');
  heading.textContent = id;
  const host = document.createElement('div');
  host.dataset.exampleHost = 'true';
  section.append(heading, host);
  catalog.append(section);
  cleanups.push(catalogExample(id, host));
}

Object.assign(window, {
  catalogExamplesReady: true,
  catalogExamplesCount: CATALOG_EXAMPLE_IDS.length,
  disposeCatalogExamples: () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  },
});
