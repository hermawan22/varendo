import {
  CATALOG_EXAMPLE_IDS,
  catalogExample,
  getCatalogExample,
  type CatalogExampleId,
} from '../../examples/catalog/index.js';
const params = new URLSearchParams(location.search);
const id = params.get('component') as CatalogExampleId;
if (!CATALOG_EXAMPLE_IDS.includes(id)) throw Error('Unknown component review fixture');
const theme = params.get('variant') === 'narrow-dark-rtl' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
document.documentElement.dir = theme === 'dark' ? 'rtl' : 'ltr';
if (theme === 'dark') document.documentElement.style.fontSize = '32px';
const container = document.getElementById('fixture')!;
document.getElementById('title')!.textContent = getCatalogExample(id).metadata.name;
const cleanup = catalogExample(id, container);
async function settle(root: Element | ShadowRoot): Promise<void> {
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    if (!element.localName.startsWith('aeliqo-')) continue;
    element.setAttribute('data-aeliqo-theme', theme);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
    if (element.shadowRoot) await settle(element.shadowRoot);
  }
}
await settle(container);
await document.fonts.ready;
Object.assign(window, {
  aeliqoReviewReady: true,
  disposeAeliqoReview: cleanup,
  reviewMetadata: getCatalogExample(id).metadata,
});
