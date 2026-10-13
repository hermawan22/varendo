import { VarendoBreadcrumbElement } from '../../packages/web/src/navigation/breadcrumb.js';
import { VarendoMenuElement } from '../../packages/web/src/navigation/menu.js';
import { VarendoPaginationElement } from '../../packages/web/src/navigation/pagination.js';
import { VarendoTabsElement } from '../../packages/web/src/navigation/tabs.js';
import { VarendoTreeNavElement } from '../../packages/web/src/navigation/tree-nav.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['varendo-breadcrumb', VarendoBreadcrumbElement],
  ['varendo-menu', VarendoMenuElement],
  ['varendo-pagination', VarendoPaginationElement],
  ['varendo-tabs', VarendoTabsElement],
  ['varendo-tree-nav', VarendoTreeNavElement],
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Navigation fixture root is missing.');
fixture.innerHTML = `
  <button id="before">Before</button>
  <varendo-tabs id="tabs"></varendo-tabs>
  <varendo-breadcrumb id="breadcrumb"></varendo-breadcrumb>
  <varendo-pagination id="pagination"></varendo-pagination>
  <varendo-menu id="menu"></varendo-menu>
  <varendo-tree-nav id="tree"></varendo-tree-nav>
  <button id="after">After</button>`;

const tabs = document.querySelector<VarendoTabsElement>('#tabs')!;
tabs.items = [
  { id: 'overview', label: 'Overview', content: 'Overview content' },
  { id: 'details', label: 'Details', content: 'Details content' },
  { id: 'disabled', label: 'Disabled', content: 'Unavailable', disabled: true },
];

const breadcrumb = document.querySelector<VarendoBreadcrumbElement>('#breadcrumb')!;
breadcrumb.items = [
  { id: 'home', label: 'Home', href: '/home' },
  { id: 'unsafe', label: 'Unsafe', href: 'javascript:alert(1)' },
  { id: 'current', label: 'Current', current: true },
];

const pagination = document.querySelector<VarendoPaginationElement>('#pagination')!;
pagination.page = 2;
pagination.pageCount = 3;
pagination.hasPrevious = true;
pagination.hasNext = true;

const menu = document.querySelector<VarendoMenuElement>('#menu')!;
menu.items = [
  { id: 'open', label: 'Open' },
  { id: 'disabled', label: 'Disabled', disabled: true },
  { id: 'archive', label: 'Archive' },
];

const tree = document.querySelector<VarendoTreeNavElement>('#tree')!;
tree.nodes = [
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

const events: CustomEvent[] = [];
for (const type of [
  'varendo-tabs-change',
  'varendo-navigation',
  'varendo-page-change',
  'varendo-menu-action',
  'varendo-tree-nav-select',
  'varendo-tree-nav-expand',
]) {
  fixture.addEventListener(type, (event) => {
    events.push(event as CustomEvent);
    if (type === 'varendo-navigation') event.preventDefault();
  });
}
Object.assign(window, { varendoNavigationReady: true, varendoNavigationEvents: events });
