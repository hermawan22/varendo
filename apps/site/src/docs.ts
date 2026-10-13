import { SITE_BASE } from './base.js';
import type { VarendoDialogElement as VarendoDialog } from '@varendo/web/dialog';
import type { CatalogExampleDefinition, CatalogExampleFamily } from '../../../examples/catalog/types.js';

type SearchEntry = {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly content: string;
};
type SearchDialog = {
  readonly element: VarendoDialog;
  readonly field: HTMLInputElement;
  readonly status: HTMLParagraphElement;
  readonly results: HTMLUListElement;
};
type PreviewRequest = { readonly family: CatalogExampleFamily; readonly id: string };

const previewLoaders: Record<CatalogExampleFamily, () => Promise<readonly CatalogExampleDefinition[]>> = {
  foundation: async () => (await import('../../../examples/catalog/foundation.js')).foundationExamples,
  input: async () => (await import('../../../examples/catalog/input.js')).inputExamples,
  navigation: async () => (await import('../../../examples/catalog/navigation.js')).navigationExamples,
  feedback: async () => (await import('../../../examples/catalog/feedback.js')).feedbackExamples,
  data: async () => (await import('../../../examples/catalog/data.js')).dataExamples,
  visualization: async () => (await import('../../../examples/catalog/visualization.js')).visualizationExamples,
  compound: async () => (await import('../../../examples/catalog/compound.js')).compoundExamples,
};

if (!location.hash) window.scrollTo(0, 0);

const trigger = document.querySelector<HTMLAnchorElement>('.search-trigger');
trigger?.setAttribute('aria-haspopup', 'dialog');

let searchDialog: Promise<SearchDialog> | undefined;
let searchEntries: readonly SearchEntry[] | undefined;

function setQuery(query: string): void {
  const url = new URL(location.href);
  if (query.length > 0) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function validSearchIndex(data: unknown): data is SearchEntry[] {
  return (
    Array.isArray(data) &&
    data.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { path?: unknown }).path === 'string' &&
        (entry as { path: string }).path.startsWith('/') &&
        !(entry as { path: string }).path.startsWith('//') &&
        typeof (entry as { title?: unknown }).title === 'string' &&
        typeof (entry as { description?: unknown }).description === 'string' &&
        typeof (entry as { content?: unknown }).content === 'string',
    )
  );
}

async function loadSearchIndex(): Promise<readonly SearchEntry[]> {
  if (searchEntries !== undefined) return searchEntries;
  const response = await fetch(`${SITE_BASE}search-index.json`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw Error(`Search index request failed (${response.status}).`);
  const data: unknown = await response.json();
  if (!validSearchIndex(data)) throw Error('Search index has an invalid shape.');
  searchEntries = data;
  return data;
}

const words = (value: string): readonly string[] => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function searchScore(entry: SearchEntry, query: string): number | undefined {
  const queryWords = words(query);
  if (queryWords.length === 0) return 7;
  const titleWords = words(entry.title);
  const descriptionWords = words(entry.description);
  if (titleWords.join(' ') === queryWords.join(' ')) return 0;
  if (queryWords.every((word) => titleWords.includes(word))) return 1;
  if (queryWords.every((word) => titleWords.some((candidate) => candidate.startsWith(word)))) return 2;
  const allWords = [...titleWords, ...descriptionWords];
  if (queryWords.every((word) => allWords.includes(word))) return 3;
  if (queryWords.every((word) => allWords.some((candidate) => candidate.startsWith(word)))) return 4;
  const contentWords = words(entry.content);
  if (queryWords.every((word) => contentWords.includes(word))) return 5;
  if (queryWords.every((word) => contentWords.some((candidate) => candidate.startsWith(word)))) return 6;
  return undefined;
}

async function loadSearchDialog(): Promise<SearchDialog> {
  if (searchDialog !== undefined) return searchDialog;
  searchDialog = (async () => {
    const { VarendoDialogElement } = await import('@varendo/web/dialog');
    const current = customElements.get('varendo-dialog');
    if (current === undefined) customElements.define('varendo-dialog', VarendoDialogElement);
    else if (current !== VarendoDialogElement) throw Error('An incompatible documentation dialog is registered.');

    const element = new VarendoDialogElement();
    element.id = 'docs-search-dialog';
    element.heading = 'Search documentation';
    const form = document.createElement('form');
    form.setAttribute('role', 'search');
    const field = document.createElement('input');
    field.type = 'search';
    field.name = 'q';
    field.setAttribute('aria-label', 'Search documentation');
    field.placeholder = 'Component, concept, or integration';
    field.className = 'docs-search-field';
    field.value = new URL(location.href).searchParams.get('q')?.trim() ?? '';
    const results = document.createElement('ul');
    results.className = 'search-results';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.append(field);
    element.append(form, status, results);
    const main = document.querySelector<HTMLElement>('main');
    if (main === null) throw Error('Documentation main landmark is unavailable.');
    (main.querySelector<HTMLElement>('.reading') ?? main).append(element);
    const state = { element, field, status, results };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setQuery(field.value.trim());
      void updateSearch(state);
    });
    field.addEventListener('input', () => {
      setQuery(field.value.trim());
      void updateSearch(state);
    });
    return state;
  })();
  return searchDialog;
}

async function updateSearch(dialog: SearchDialog): Promise<void> {
  dialog.results.replaceChildren();
  const query = dialog.field.value.trim();
  if (searchEntries === undefined) {
    dialog.status.textContent = 'Loading search index…';
    return;
  }
  const ranked = searchEntries
    .map((entry, index) => ({ entry, index, score: searchScore(entry, query) }))
    .filter((match): match is { entry: SearchEntry; index: number; score: number } => match.score !== undefined)
    .sort((left, right) => left.score - right.score || left.index - right.index);
  const matches = ranked.slice(0, 20);
  if (query.length === 0) dialog.status.textContent = 'Browse documentation or type to narrow the results.';
  else if (ranked.length > matches.length)
    dialog.status.textContent = `${ranked.length} matching pages; first ${matches.length} shown.`;
  else dialog.status.textContent = `${ranked.length} matching pages.`;
  if (matches.length === 0) dialog.status.textContent = 'No pages found. Try a component name or a broader term.';
  for (const { entry } of matches) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `${SITE_BASE}${entry.path === '/' ? 'docs/' : entry.path.slice(1)}`;
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const description = document.createElement('span');
    description.textContent = entry.description;
    link.append(title, description);
    item.append(link);
    dialog.results.append(item);
  }
}

async function openSearch(): Promise<void> {
  try {
    const dialog = await loadSearchDialog();
    dialog.element.open = true;
    await dialog.element.updateComplete;
    dialog.field.focus();
    try {
      await loadSearchIndex();
      await updateSearch(dialog);
    } catch {
      dialog.status.textContent =
        'Search is unavailable. Use the documentation navigation or the no-JavaScript search page.';
    }
  } catch {
    const query = new URL(location.href).searchParams.get('q')?.trim() ?? '';
    location.assign(`${SITE_BASE}search/${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  }
}

trigger?.addEventListener('click', (event) => {
  event.preventDefault();
  void openSearch();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    void openSearch();
  }
});
if (new URL(location.href).searchParams.has('q')) void openSearch();

async function mountRecordListExamples(): Promise<void> {
  const mounts = [...document.querySelectorAll<HTMLElement>('[data-example="record-list"]')];
  if (mounts.length === 0) return;
  const { VarendoRecordListElement } = await import('@varendo/web/record-list');
  const current = customElements.get('varendo-record-list');
  if (current === undefined) customElements.define('varendo-record-list', VarendoRecordListElement);
  else if (current !== VarendoRecordListElement) throw Error('An incompatible record list is registered.');
  for (const mount of mounts) {
    const list = new VarendoRecordListElement();
    list.columns = [
      { key: 'name', label: 'Name' },
      { key: 'team', label: 'Team' },
    ];
    list.identity = ['id'];
    list.rows = [{ id: 'ada', name: 'Ada Chen', team: 'Design' }];
    list.scope = { label: 'Synthetic people', kind: 'filtered', loaded: 1, filteredTotal: 1 };
    mount.append(list);
    const pre = document.createElement('pre');
    pre.tabIndex = 0;
    const code = document.createElement('code');
    code.textContent = `import {VarendoRecordListElement} from '@varendo/web/record-list';
if (!customElements.get('varendo-record-list')) customElements.define('varendo-record-list', VarendoRecordListElement);
const list = new VarendoRecordListElement();
list.columns = [{key:'name', label:'Name'}, {key:'team', label:'Team'}];
list.identity = ['id'];
list.rows = [{id:'ada', name:'Ada Chen', team:'Design'}];
list.scope = {label:'Synthetic people', kind:'filtered', loaded:1, filteredTotal:1};
document.body.append(list);`;
    pre.append(code);
    mount.append(pre);
  }
}

void mountRecordListExamples().catch(() => {
  for (const mount of document.querySelectorAll<HTMLElement>('[data-example="record-list"]')) {
    mount.setAttribute('role', 'alert');
    mount.textContent = 'The example could not load. The complete source is available in the documentation.';
  }
});

function componentExampleRequest(preview: HTMLElement): PreviewRequest {
  const family = preview.dataset.previewFamily as CatalogExampleFamily | undefined;
  const id = preview.dataset.previewId;
  if (family === undefined || !Object.hasOwn(previewLoaders, family) || id === undefined)
    throw Error('The component example is unavailable.');
  return { family, id };
}

function installExampleCopy(componentMount: HTMLElement, id: string): void {
  const reading = componentMount.closest('.reading');
  const code = reading?.querySelector<HTMLElement>(`[data-example-code="${id}"]`);
  const copy = reading?.querySelector<HTMLButtonElement>(`[data-copy-example="${id}"]`);
  const copyStatus = reading?.querySelector<HTMLElement>('[data-copy-status]');
  if (copy && code) copy.disabled = false;
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code?.textContent ?? '');
      if (copyStatus) copyStatus.textContent = 'Example copied.';
    } catch {
      if (copyStatus) copyStatus.textContent = 'Copy is unavailable. Select the code to copy manually.';
    }
  });
}

async function mountComponentPreview(componentMount: HTMLElement): Promise<void> {
  const preview = componentMount.querySelector<HTMLElement>('[data-preview-mount]');
  if (preview === null) throw Error('The component preview mount is unavailable.');
  const requested = componentExampleRequest(preview);
  const definitions = await previewLoaders[requested.family]();
  const definition = definitions.find((candidate) => candidate.metadata.id === requested.id);
  if (definition === undefined) throw Error('The component example is unavailable.');
  const cleanup = definition.mount(preview);
  window.addEventListener('pagehide', cleanup, { once: true });
  const previewStatus = preview.querySelector<HTMLElement>('[data-preview-status]');
  if (previewStatus) {
    // Keep the loaded state for assistive technology without a visible engineering note.
    previewStatus.textContent = 'Interactive preview loaded.';
    previewStatus.classList.add('visually-hidden');
  }
  if (!location.hash) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, 0)));
  installExampleCopy(componentMount, requested.id);
}

const componentMount = document.querySelector<HTMLElement>('[data-component-preview]');
if (componentMount) {
  void mountComponentPreview(componentMount).catch(() => {
    const status = componentMount.querySelector<HTMLElement>('[data-preview-status]');
    if (status) {
      status.setAttribute('role', 'alert');
      status.textContent = 'The interactive example could not load. Use the public API below.';
    }
  });
}

async function copyDocCode(button: HTMLButtonElement): Promise<void> {
  const code = button.closest('.doc-code')?.querySelector('pre')?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = 'Copy';
    }, 1600);
  } catch {
    button.textContent = 'Copy unavailable';
    window.setTimeout(() => {
      button.textContent = 'Copy';
    }, 2400);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.doc-code-copy')) {
  button.disabled = false;
  button.addEventListener('click', () => void copyDocCode(button));
}
