import type { Scalar, VersionRef } from '@varendo/core';
import type { VarendoEmptyStateKind } from '../feedback/empty-state.js';

/**
 * Host-owned references used by the navigation and feedback region adapters.
 *
 * A presentation proposal contains only `bindingRevision` and `bindingRef`.
 * Labels, messages, routes, actions and tree/tab/menu item definitions are
 * resolved from this immutable host table. This keeps model-authored wire data
 * from becoming a destination, business action or trusted copy source.
 */
export interface VarendoNavigationFeedbackBindings {
  readonly revision: string;
  readonly contents?: readonly VarendoNavigationFeedbackContent[];
  readonly routes?: readonly VarendoNavigationFeedbackRoute[];
  readonly actions?: readonly VarendoNavigationFeedbackAction[];
  readonly breadcrumbs?: readonly VarendoBreadcrumbBinding[];
  readonly menus?: readonly VarendoMenuBinding[];
  readonly pagination?: readonly VarendoPaginationBinding[];
  readonly tabs?: readonly VarendoTabsBinding[];
  readonly trees?: readonly VarendoTreeBinding[];
  readonly feedback?: readonly VarendoFeedbackBinding[];
}

export interface VarendoNavigationFeedbackContent {
  readonly id: string;
  readonly text: string;
}

export interface VarendoNavigationFeedbackRoute {
  readonly id: string;
  readonly route: VersionRef;
  readonly params: Readonly<Record<string, Scalar>>;
  /** A browser destination resolved by the application, never by a proposal. */
  readonly href: string;
}

export interface VarendoNavigationFeedbackAction {
  readonly id: string;
  readonly action: VersionRef;
  readonly input: Readonly<Record<string, Scalar>>;
}

export interface VarendoBreadcrumbBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly items: readonly VarendoBreadcrumbBindingItem[];
}

export interface VarendoBreadcrumbBindingItem {
  readonly id: string;
  readonly labelRef: string;
  readonly routeRef?: string;
  readonly current?: boolean;
}

export interface VarendoMenuBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly items: readonly VarendoMenuBindingItem[];
}

export interface VarendoMenuBindingItem {
  readonly id: string;
  readonly labelRef: string;
  readonly actionRef?: string;
  readonly routeRef?: string;
  readonly disabled?: boolean;
}

export interface VarendoPaginationBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly outputId: string;
  readonly queryDigest: string;
  readonly page: number;
  readonly pageCount?: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly pending?: boolean;
  readonly cursors: readonly VarendoPaginationCursor[];
}

export interface VarendoPaginationCursor {
  readonly page: number;
  readonly cursor: string;
}

export interface VarendoTabsBinding {
  readonly id: string;
  readonly items: readonly VarendoTabsBindingItem[];
}

export interface VarendoTabsBindingItem {
  readonly id: string;
  readonly labelRef: string;
  readonly contentRef?: string;
  readonly disabled?: boolean;
}

export interface VarendoTreeBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly nodes: readonly VarendoTreeBindingNode[];
}

export interface VarendoTreeBindingNode {
  readonly id: string;
  readonly labelRef: string;
  readonly children?: readonly VarendoTreeBindingNode[];
  readonly disabled?: boolean;
  readonly actionRef?: string;
  readonly routeRef?: string;
}

/** Shared host text and action references for feedback primitives. */
export interface VarendoFeedbackBinding {
  readonly id: string;
  readonly labelRef?: string;
  readonly contentRef?: string;
  readonly headingRef?: string;
  readonly messageRef?: string;
  readonly actionLabelRef?: string;
  readonly actionRef?: string;
  readonly kind?: VarendoEmptyStateKind;
  readonly progressValue?: number;
  readonly progressMax?: number;
}
