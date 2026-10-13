import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  VarendoTabsElement,
  VarendoBreadcrumbElement,
  VarendoPaginationElement,
  VarendoMenuElement,
  VarendoTreeNavElement,
} from '@varendo/web/navigation';
type UserEvent<T> = CustomEvent<Readonly<T & { source: 'user' }>>;
export const VarendoTabs = createComponent({
  react: React,
  tagName: 'varendo-tabs',
  elementClass: VarendoTabsElement,
  events: { onSelectionChange: 'varendo-tabs-change' as EventName<UserEvent<{ id: string; previousId: string }>> },
  displayName: 'VarendoTabs',
});
export const VarendoBreadcrumb = createComponent({
  react: React,
  tagName: 'varendo-breadcrumb',
  elementClass: VarendoBreadcrumbElement,
  events: { onNavigate: 'varendo-navigation' as EventName<UserEvent<{ id: string; href?: string }>> },
  displayName: 'VarendoBreadcrumb',
});
export const VarendoPagination = createComponent({
  react: React,
  tagName: 'varendo-pagination',
  elementClass: VarendoPaginationElement,
  events: {
    onPageChange: 'varendo-page-change' as EventName<
      UserEvent<{ page: number; previousPage: number; direction: 'previous' | 'next' }>
    >,
  },
  displayName: 'VarendoPagination',
});
export const VarendoMenu = createComponent({
  react: React,
  tagName: 'varendo-menu',
  elementClass: VarendoMenuElement,
  events: { onAction: 'varendo-menu-action' as EventName<UserEvent<{ id: string }>> },
  displayName: 'VarendoMenu',
});
export const VarendoTreeNav = createComponent({
  react: React,
  tagName: 'varendo-tree-nav',
  elementClass: VarendoTreeNavElement,
  events: {
    onSelectionChange: 'varendo-tree-nav-select' as EventName<UserEvent<{ id: string; previousId: string }>>,
    onExpand: 'varendo-tree-nav-expand' as EventName<UserEvent<{ id: string; expanded: boolean }>>,
  },
  displayName: 'VarendoTreeNav',
});
