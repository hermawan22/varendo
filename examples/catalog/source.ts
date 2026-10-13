/**
 * Build a copyable TypeScript example from the same mount function used by
 * the catalog.  The generated snippet deliberately owns its host, fixture
 * helpers, registration call, and invocation so it can be pasted into a
 * small application without importing this examples package.
 */
export interface CatalogSourceOptions {
  readonly imports: string;
  readonly setup?: string;
  /** Authored mount expression preserved as source data. */
  readonly mount: string;
}

export function catalogSource({ imports, setup = '', mount }: CatalogSourceOptions): string {
  return `import {registerVarendoElements} from "@varendo/web";
${imports.trim()}

${setup.trim()}

registerVarendoElements();

const host = document.querySelector<HTMLElement>("#varendo-example") ?? (() => {
  const created = document.createElement("div");
  created.id = "varendo-example";
  (document.body ?? document.documentElement).append(created);
  return created;
})();

function createCatalogRoot(container: HTMLElement): HTMLElement {
  const root = document.createElement("div");
  root.dataset.catalogSourceRoot = "true";
  root.style.display = "grid";
  root.style.gap = "12px";
  container.append(root);
  return root;
}

function createCatalogElement<T extends HTMLElement>(tagName: string, container: HTMLElement): T {
  const element = document.createElement(tagName) as T;
  element.setAttribute("data-varendo-theme", "light");
  container.append(element);
  return element;
}

function appendSlottedText(root: HTMLElement, slot: string, textContent: string): void {
  const content = document.createElement("span");
  content.slot = slot;
  content.textContent = textContent;
  root.append(content);
}

const root = createCatalogRoot(host);
(${mount})(root);
`;
}

export { catalogMountSource, CATALOG_MOUNT_SOURCES } from './source-snippets.js';
