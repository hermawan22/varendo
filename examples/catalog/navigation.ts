import {
  AeliqoBreadcrumbElement,
  AeliqoMenuElement,
  AeliqoPaginationElement,
  AeliqoTabsElement,
  AeliqoTreeNavElement,
  type AeliqoBreadcrumbItem,
  type AeliqoMenuItem,
  type AeliqoTabItem,
  type AeliqoTreeNavNode,
} from '@varendo/web/navigation';
import { cleanupCatalogRoot, createCatalogElement, createCatalogRoot } from './fixture.js';
import { catalogMountSource, catalogSource } from './source.js';
import type { CatalogExampleDefinition, CatalogExampleId, CatalogExampleMetadata } from './types.js';

const sourceImports = `import {
  AeliqoBreadcrumbElement,
  AeliqoMenuElement,
  AeliqoPaginationElement,
  AeliqoTabsElement,
  AeliqoTreeNavElement,
  type AeliqoBreadcrumbItem,
  type AeliqoMenuItem,
  type AeliqoTabItem,
  type AeliqoTreeNavNode,
} from "@varendo/web/navigation";`;

const sourceSetup = `const tabs: readonly AeliqoTabItem[] = [
  {id: "overview", label: "Overview", content: "Overview content"},
  {id: "details", label: "Details", content: "Details content"},
  {id: "history", label: "History", content: "History content", disabled: true},
];
const breadcrumb: readonly AeliqoBreadcrumbItem[] = [
  {id: "home", label: "Home", href: "/"},
  {id: "reports", label: "Reports", href: "/reports"},
  {id: "current", label: "Weekly report", current: true},
];
const menuItems: readonly AeliqoMenuItem[] = [
  {id: "open", label: "Open report"},
  {id: "archive", label: "Archive"},
  {id: "disabled", label: "Unavailable", disabled: true},
];
const treeNodes: readonly AeliqoTreeNavNode[] = [
  {id: "reports", label: "Reports", children: [{id: "weekly", label: "Weekly"}, {id: "monthly", label: "Monthly"}]},
  {id: "settings", label: "Settings", disabled: true},
];`;

type MetadataNotes = Pick<
  CatalogExampleMetadata,
  'fixture' | 'props' | 'propsNotes' | 'states' | 'keyboard' | 'events' | 'expectedOutcome'
>;
const componentNotes: Record<string, Partial<MetadataNotes>> = {
  tabs: {
    fixture: 'Three report tabs with one disabled history tab and manual activation.',
    props: ['items', 'value', 'activation', 'label', 'disabled'],
    propsNotes:
      'Item IDs and the selected value are stable; manual activation lets the host decide when selection commits.',
    states: ['ready', 'disabled'],
    keyboard: ['Tab', 'Arrow keys', 'Home and End', 'Enter'],
    events: ['aeliqo-tabs-change'],
    expectedOutcome: 'The active panel follows a stable tab ID and emits a cancellable change request.',
  },
  breadcrumb: {
    fixture: 'A three-level report path ending at the current weekly report.',
    props: ['items', 'label'],
    propsNotes: 'Only approved hrefs are supplied and the current item is exposed as the page endpoint.',
    states: ['ready'],
    keyboard: ['Tab', 'Enter'],
    events: ['aeliqo-navigation'],
    expectedOutcome: 'The path is navigable while the current location remains semantically marked.',
  },
  pagination: {
    fixture: 'Page two of four with previous and next controls enabled.',
    props: ['page', 'pageCount', 'hasPrevious', 'hasNext', 'label'],
    propsNotes: 'The host owns page data and applies the requested page after validating it.',
    states: ['ready', 'disabled'],
    keyboard: ['Tab', 'Enter', 'Space'],
    events: ['aeliqo-page-change'],
    expectedOutcome:
      'The current page and available directions are announced and page changes are emitted as requests.',
  },
  menu: {
    fixture: 'An open report action menu with one disabled item.',
    props: ['items', 'label', 'open'],
    propsNotes: 'Menu item IDs are stable and action effects remain with the host.',
    states: ['ready', 'disabled'],
    keyboard: ['Tab', 'Arrow keys', 'Enter', 'Escape'],
    events: ['aeliqo-menu-action'],
    expectedOutcome: 'The menu manages roving focus and emits only the chosen enabled action.',
  },
  'tree-nav': {
    fixture: 'A two-level report tree with the reports branch expanded and weekly selected.',
    props: ['nodes', 'expandedIds', 'selectedId', 'label'],
    propsNotes:
      'Node IDs are stable. After an uncancelled event, the component updates its selected ID or local expanded set; the host can supply selectedId and expandedIds to synchronize external state.',
    states: ['ready', 'disabled'],
    keyboard: ['Tab', 'Arrow keys', 'Home and End', 'Enter', 'Space'],
    events: ['aeliqo-tree-nav-select', 'aeliqo-tree-nav-expand'],
    expectedOutcome: 'The tree preserves hierarchy and emits typed selection or expansion requests by node ID.',
  },
};

const mount = (id: CatalogExampleId, fn: (root: HTMLElement) => void): CatalogExampleDefinition => ({
  metadata: {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    family: 'navigation',
    description: 'A keyboard navigable navigation primitive with stable item identities.',
    fixture: 'A bounded set of application-approved items or nodes with one current/selected identity.',
    props: ['items or nodes', 'value or selectedId', 'label', 'disabled'],
    propsNotes: 'Items carry stable IDs; labels are visible and disabled entries remain discoverable.',
    states: ['ready', 'disabled', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Enter or Space', 'Home and End where supported'],
    events: ['aeliqo-navigation', 'component-specific change event'],
    expectedOutcome:
      'Navigation state remains addressable by stable IDs and user intent is emitted as a cancellable host request.',
    ...componentNotes[id],
    source: catalogSource({ imports: sourceImports, setup: sourceSetup, mount: catalogMountSource(id) }),
  },
  mount(container) {
    const root = createCatalogRoot(container);
    fn(root);
    return cleanupCatalogRoot(root);
  },
});

const tabs: readonly AeliqoTabItem[] = [
  { id: 'overview', label: 'Overview', content: 'Overview content' },
  { id: 'details', label: 'Details', content: 'Details content' },
  { id: 'history', label: 'History', content: 'History content', disabled: true },
];
const breadcrumb: readonly AeliqoBreadcrumbItem[] = [
  { id: 'home', label: 'Home', href: '/' },
  { id: 'reports', label: 'Reports', href: '/reports' },
  { id: 'current', label: 'Weekly report', current: true },
];
const menuItems: readonly AeliqoMenuItem[] = [
  { id: 'open', label: 'Open report' },
  { id: 'archive', label: 'Archive' },
  { id: 'disabled', label: 'Unavailable', disabled: true },
];
const treeNodes: readonly AeliqoTreeNavNode[] = [
  {
    id: 'reports',
    label: 'Reports',
    children: [
      { id: 'weekly', label: 'Weekly' },
      { id: 'monthly', label: 'Monthly' },
    ],
  },
  { id: 'settings', label: 'Settings', disabled: true },
];

export const navigationExamples: readonly CatalogExampleDefinition[] = [
  mount('tabs', (root) => {
    const element = createCatalogElement<AeliqoTabsElement>('aeliqo-tabs', root, AeliqoTabsElement);
    element.items = tabs;
    element.value = 'overview';
    element.activation = 'manual';
  }),
  mount('breadcrumb', (root) => {
    const element = createCatalogElement<AeliqoBreadcrumbElement>('aeliqo-breadcrumb', root, AeliqoBreadcrumbElement);
    element.items = breadcrumb;
    element.label = 'Report path';
  }),
  mount('pagination', (root) => {
    const element = createCatalogElement<AeliqoPaginationElement>('aeliqo-pagination', root, AeliqoPaginationElement);
    element.page = 2;
    element.pageCount = 4;
    element.hasPrevious = true;
    element.hasNext = true;
    element.label = 'Report pages';
  }),
  mount('menu', (root) => {
    const element = createCatalogElement<AeliqoMenuElement>('aeliqo-menu', root, AeliqoMenuElement);
    element.items = menuItems;
    element.label = 'Report actions';
    element.open = true;
  }),
  mount('tree-nav', (root) => {
    const element = createCatalogElement<AeliqoTreeNavElement>('aeliqo-tree-nav', root, AeliqoTreeNavElement);
    element.nodes = treeNodes;
    element.expandedIds = ['reports'];
    element.selectedId = 'weekly';
    element.label = 'Report navigation';
  }),
];
