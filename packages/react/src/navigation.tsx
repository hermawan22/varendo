import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  AeliqoTabsElement,
  AeliqoBreadcrumbElement,
  AeliqoPaginationElement,
  AeliqoMenuElement,
  AeliqoTreeNavElement,
} from '@varendo/web/navigation';
type UserEvent<T> = CustomEvent<Readonly<T & { source: 'user' }>>;
export const AeliqoTabs = createComponent({
  react: React,
  tagName: 'aeliqo-tabs',
  elementClass: AeliqoTabsElement,
  events: { onSelectionChange: 'aeliqo-tabs-change' as EventName<UserEvent<{ id: string; previousId: string }>> },
  displayName: 'AeliqoTabs',
});
export const AeliqoBreadcrumb = createComponent({
  react: React,
  tagName: 'aeliqo-breadcrumb',
  elementClass: AeliqoBreadcrumbElement,
  events: { onNavigate: 'aeliqo-navigation' as EventName<UserEvent<{ id: string; href?: string }>> },
  displayName: 'AeliqoBreadcrumb',
});
export const AeliqoPagination = createComponent({
  react: React,
  tagName: 'aeliqo-pagination',
  elementClass: AeliqoPaginationElement,
  events: {
    onPageChange: 'aeliqo-page-change' as EventName<
      UserEvent<{ page: number; previousPage: number; direction: 'previous' | 'next' }>
    >,
  },
  displayName: 'AeliqoPagination',
});
export const AeliqoMenu = createComponent({
  react: React,
  tagName: 'aeliqo-menu',
  elementClass: AeliqoMenuElement,
  events: { onAction: 'aeliqo-menu-action' as EventName<UserEvent<{ id: string }>> },
  displayName: 'AeliqoMenu',
});
export const AeliqoTreeNav = createComponent({
  react: React,
  tagName: 'aeliqo-tree-nav',
  elementClass: AeliqoTreeNavElement,
  events: {
    onSelectionChange: 'aeliqo-tree-nav-select' as EventName<UserEvent<{ id: string; previousId: string }>>,
    onExpand: 'aeliqo-tree-nav-expand' as EventName<UserEvent<{ id: string; expanded: boolean }>>,
  },
  displayName: 'AeliqoTreeNav',
});
