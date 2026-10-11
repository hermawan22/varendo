import { SITE_BASE } from './base.js';
import { prepareDeploymentAnalytics } from './analytics.js';
import { startDeploymentTelemetry } from './telemetry.js';
import type { HomeDemoView } from './home-example.js';

const navToggle = document.querySelector<HTMLButtonElement>('#nav-toggle');
const primaryNav = document.querySelector<HTMLElement>('#site-nav');
const narrowNav = matchMedia('(max-width: 760px)');
const themeSelect = document.querySelector<HTMLSelectElement>('#theme-select');
const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
const darkTheme = matchMedia('(prefers-color-scheme: dark)');
type ThemeMode = 'system' | 'light' | 'dark';
const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function storedTheme(): ThemeMode {
  try {
    const value = localStorage.getItem('aeliqo-theme');
    return isThemeMode(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

let themeMode = storedTheme();

function resolvedTheme(): 'light' | 'dark' {
  if (themeMode !== 'system') return themeMode;
  return darkTheme.matches ? 'dark' : 'light';
}

function themeComponent(root: ParentNode): void {
  const theme = resolvedTheme();
  const candidates = [
    ...(root instanceof HTMLElement && root.hasAttribute('data-aeliqo-theme') ? [root] : []),
    ...root.querySelectorAll<HTMLElement>('[data-aeliqo-theme]'),
  ];
  for (const candidate of candidates) {
    if (candidate.dataset.aeliqoTheme !== 'inherit' && candidate.dataset.aeliqoTheme !== theme)
      candidate.dataset.aeliqoTheme = theme;
  }
}

function syncThemeControls(): void {
  if (themeSelect) themeSelect.value = themeMode;
  if (!themeToggle) return;
  themeToggle.dataset.themeMode = themeMode;
  themeToggle.setAttribute('aria-label', `Theme: ${themeMode}`);
  themeToggle.title = `Theme: ${themeMode}`;
}

function applyTheme(persist: boolean): void {
  if (themeMode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = themeMode;
  syncThemeControls();
  themeComponent(document);
  if (!persist) return;
  try {
    localStorage.setItem('aeliqo-theme', themeMode);
  } catch {
    // The selected theme still applies when storage is unavailable.
  }
}

themeToggle?.addEventListener('click', () => {
  const current = THEME_MODES.indexOf(themeMode);
  themeMode = THEME_MODES[(current + 1) % THEME_MODES.length] ?? 'system';
  applyTheme(true);
});
themeSelect?.addEventListener('change', () => {
  if (!isThemeMode(themeSelect.value)) return;
  themeMode = themeSelect.value;
  applyTheme(true);
});
darkTheme.addEventListener('change', () => {
  if (themeMode === 'system') applyTheme(false);
});
new MutationObserver((records) => {
  for (const record of records)
    for (const node of record.addedNodes) if (node instanceof HTMLElement) themeComponent(node);
}).observe(document.body, { childList: true, subtree: true });
applyTheme(false);

function setNavOpen(open: boolean, restoreFocus = false): void {
  document.documentElement.dataset.navOpen = open ? 'true' : 'false';
  navToggle?.setAttribute('aria-expanded', String(open));
  if (!open && restoreFocus) navToggle?.focus();
}
if (navToggle && primaryNav) {
  navToggle.addEventListener('click', () => setNavOpen(navToggle.getAttribute('aria-expanded') !== 'true'));
  primaryNav.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setNavOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.documentElement.dataset.navOpen === 'true') {
      event.preventDefault();
      setNavOpen(false, true);
    }
  });
  narrowNav.addEventListener('change', (event) => {
    if (!event.matches) setNavOpen(false);
  });
}

// Both files are deployment-owned and ship disabled. They are not requested
// from previews, localhost, SDK examples, or any non-public origin.
void startDeploymentTelemetry();
void prepareDeploymentAnalytics();

document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
  const path = event.composedPath();
  const viewport = path.find(
    (node) => node instanceof HTMLElement && node.getAttribute('part')?.split(/\s+/u).includes('scroll'),
  );
  if (!(viewport instanceof HTMLElement) || path[0] !== viewport || viewport.scrollWidth <= viewport.clientWidth)
    return;
  event.preventDefault();
  if (event.key === 'Home') {
    viewport.scrollLeft = 0;
    return;
  }
  const rtl = getComputedStyle(viewport).direction === 'rtl';
  const end = viewport.scrollWidth - viewport.clientWidth;
  if (event.key === 'End') {
    viewport.scrollLeft = rtl ? -end : end;
    return;
  }
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  viewport.scrollBy({ left: direction * 40, behavior: 'auto' });
});

const source = `const app = createAeliqoApp({
  resources: [{resource: people, data}],
  authority,
});

app.mount({
  target: document.querySelector('#people'),
  regionId: 'people',
  resourceId: 'people',
});

await app.render({
  regionId: 'people',
  intent: {
    version: '1', id: 'browse-people', kind: 'browse',
    resource: 'people', fields: ['name', 'team', 'location'],
  },
});`;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const installChip = document.querySelector<HTMLButtonElement>('#install-chip');
const installStatus = document.querySelector<HTMLElement>('#install-status');
installChip?.addEventListener('click', async () => {
  const copied = await copyText('npm i @varendo/react');
  if (installStatus) installStatus.textContent = copied ? 'Copied.' : 'Copy unavailable — copy the command text.';
  if (!copied) return;
  installChip.dataset.copied = 'true';
  window.setTimeout(() => {
    installChip.dataset.copied = 'false';
  }, 1600);
});

function setupDemoTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.demo-tab[role="tab"]')];
  if (tabs.length === 0) return;
  const selectTab = (tab: HTMLButtonElement, focus: boolean): void => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      const panelId = item.getAttribute('aria-controls');
      const panel = panelId === null ? null : document.getElementById(panelId);
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      let next = -1;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      event.preventDefault();
      const target = tabs[next];
      if (target) selectTab(target, true);
    });
  }
}
setupDemoTabs();

function isDemoView(value: string | undefined): value is HomeDemoView {
  return value === 'table' || value === 'cards' || value === 'chart';
}

const browseIntentLabel = (team: string): string =>
  team === 'all'
    ? `{ kind: 'browse', resource: 'people', fields: ['name', 'team', 'location'] }`
    : `{ kind: 'browse', resource: 'people', fields: ['name', 'team', 'location'], filter: team = '${team}' }`;
const chartIntentLabel = `{ kind: 'analyze', resource: 'workforce-headcount', preferredView: 'trend' }`;

const demo = document.querySelector<HTMLElement>('#home-demo');
const demoTrend = document.querySelector<HTMLElement>('#home-trend');

async function setupHomeDemo(peopleRoot: HTMLElement, trendRoot: HTMLElement): Promise<void> {
  const { mountHomeDemo } = await import('./home-example.js');
  const example = mountHomeDemo({ people: peopleRoot, trend: trendRoot });
  const teamControl = document.querySelector<HTMLSelectElement>('#team');
  const status = document.querySelector<HTMLElement>('#demo-status');
  const intentLine = document.querySelector<HTMLElement>('#demo-intent');
  const intentInline = document.querySelector<HTMLElement>('#demo-intent-inline');
  const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-demo-view]')];
  let view: HomeDemoView = 'table';
  let totalPeople: number | undefined;
  const setDemoStatus = (message: string): void => {
    if (status) status.textContent = message;
  };
  const showResult = (
    receipt: Extract<Awaited<ReturnType<typeof example.render>>, { readonly status: 'renderer-ready' }>,
    team: string,
  ): void => {
    if (view === 'chart') {
      setDemoStatus('Varendo rendered the headcount analysis as a trend chart.');
      return;
    }
    const rows = receipt.runtime.outputs[0]?.handle.snapshot().batches.flatMap((batch) => batch.rows) ?? [];
    if (team === 'all') totalPeople = rows.length;
    const total = totalPeople ?? rows.length;
    const viewId = receipt.presentation.plan.nodes[0]?.representation.id.split('.').at(-1) ?? 'registered';
    const viewName = viewId === 'card-collection' ? 'cards' : viewId;
    setDemoStatus(`${rows.length} of ${total} synthetic people matched — Varendo chose the ${viewName} view.`);
  };
  async function renderIntent(): Promise<void> {
    const team = teamControl?.value ?? 'all';
    const intentText = view === 'chart' ? chartIntentLabel : browseIntentLabel(team);
    if (intentLine) intentLine.textContent = intentText;
    if (intentInline) intentInline.textContent = intentText;
    setDemoStatus('Checking the request against registered data and views…');
    try {
      const receipt = await example.render(team, view);
      if (receipt.status !== 'renderer-ready') throw new Error(receipt.diagnostics[0]?.message ?? receipt.status);
      showResult(receipt, team);
    } catch {
      setDemoStatus('This request could not be shown. The previous valid view remains available.');
    }
  }
  teamControl?.addEventListener('change', () => void renderIntent());
  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      if (!isDemoView(button.dataset.demoView)) return;
      view = button.dataset.demoView;
      for (const item of viewButtons) item.setAttribute('aria-pressed', String(item === button));
      peopleRoot.dataset.width = view === 'cards' ? 'narrow' : 'wide';
      peopleRoot.hidden = view === 'chart';
      trendRoot.hidden = view !== 'chart';
      if (teamControl) teamControl.disabled = view === 'chart';
      void renderIntent();
    });
  }
  void renderIntent();
  const sourceElement = document.querySelector<HTMLElement>('#demo-source');
  if (sourceElement) sourceElement.textContent = source;
  document.querySelector('#copy-demo')?.addEventListener('click', async () => {
    const copyStatus = document.querySelector<HTMLElement>('#copy-status');
    const copied = await copyText(source);
    if (copyStatus)
      copyStatus.textContent = copied
        ? 'Source copied.'
        : 'Copy unavailable. Select the source above to copy it manually.';
  });
  window.addEventListener('pagehide', () => example.dispose(), { once: true });
  document.querySelector('#copy-quickstart')?.addEventListener('click', async () => {
    const snippet = document.querySelector<HTMLElement>('#quickstart-snippet')?.textContent ?? '';
    const copyStatus = document.querySelector<HTMLElement>('#copy-quickstart-status');
    const copied = await copyText(snippet);
    if (copyStatus) copyStatus.textContent = copied ? 'Snippet copied.' : 'Select the snippet above to copy it.';
  });
}

const bootFailure = (selector: string, message: string): void => {
  const target = document.querySelector<HTMLElement>(selector);
  if (target) {
    target.setAttribute('role', 'alert');
    target.textContent = message;
  }
};
if (demo && demoTrend)
  void setupHomeDemo(demo, demoTrend).catch(() =>
    bootFailure('#demo-status', 'The live demo could not load. Reload the page to try again.'),
  );
if (document.body.dataset.docs === 'true')
  void import('/docs-src/docs.js').catch(() => {
    // Enhanced docs tooling stays unavailable; the authored content is static.
  });
if (location.pathname.startsWith(`${SITE_BASE}playground/`))
  void import('/playground-src/playground.js').catch(() => {
    document.querySelector<HTMLElement>('.pg-app')?.setAttribute('aria-busy', 'false');
    bootFailure('#pg-boot', 'The playground could not load. Check your connection and reload the page.');
  });
