import { AeliqoBreadcrumbElement } from '../../packages/web/src/navigation/breadcrumb.js';
import { AeliqoMenuElement } from '../../packages/web/src/navigation/menu.js';
import { AeliqoPaginationElement } from '../../packages/web/src/navigation/pagination.js';
import { AeliqoTabsElement } from '../../packages/web/src/navigation/tabs.js';
import { AeliqoTreeNavElement } from '../../packages/web/src/navigation/tree-nav.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['aeliqo-breadcrumb', AeliqoBreadcrumbElement],
  ['aeliqo-menu', AeliqoMenuElement],
  ['aeliqo-pagination', AeliqoPaginationElement],
  ['aeliqo-tabs', AeliqoTabsElement],
  ['aeliqo-tree-nav', AeliqoTreeNavElement],
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Navigation fixture root is missing.');
fixture.innerHTML = `
  <button id="before">Before</button>
  <aeliqo-tabs id="tabs"></aeliqo-tabs>
  <aeliqo-breadcrumb id="breadcrumb"></aeliqo-breadcrumb>
  <aeliqo-pagination id="pagination"></aeliqo-pagination>
  <aeliqo-menu id="menu"></aeliqo-menu>
  <aeliqo-tree-nav id="tree"></aeliqo-tree-nav>
  <button id="after">After</button>`;

const tabs = document.querySelector<AeliqoTabsElement>('#tabs')!;
tabs.items = [
  { id: 'overview', label: 'Overview', content: 'Overview content' },
  { id: 'details', label: 'Details', content: 'Details content' },
  { id: 'disabled', label: 'Disabled', content: 'Unavailable', disabled: true },
];

const breadcrumb = document.querySelector<AeliqoBreadcrumbElement>('#breadcrumb')!;
breadcrumb.items = [
  { id: 'home', label: 'Home', href: '/home' },
  { id: 'unsafe', label: 'Unsafe', href: 'javascript:alert(1)' },
  { id: 'current', label: 'Current', current: true },
];

const pagination = document.querySelector<AeliqoPaginationElement>('#pagination')!;
pagination.page = 2;
pagination.pageCount = 3;
pagination.hasPrevious = true;
pagination.hasNext = true;

const menu = document.querySelector<AeliqoMenuElement>('#menu')!;
menu.items = [
  { id: 'open', label: 'Open' },
  { id: 'disabled', label: 'Disabled', disabled: true },
  { id: 'archive', label: 'Archive' },
];

const tree = document.querySelector<AeliqoTreeNavElement>('#tree')!;
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
  'aeliqo-tabs-change',
  'aeliqo-navigation',
  'aeliqo-page-change',
  'aeliqo-menu-action',
  'aeliqo-tree-nav-select',
  'aeliqo-tree-nav-expand',
]) {
  fixture.addEventListener(type, (event) => {
    events.push(event as CustomEvent);
    if (type === 'aeliqo-navigation') event.preventDefault();
  });
}
Object.assign(window, { aeliqoNavigationReady: true, aeliqoNavigationEvents: events });
