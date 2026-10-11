import type { Scalar, VersionRef } from '@varendo/core';
import type { AeliqoEmptyStateKind } from '../feedback/empty-state.js';

/**
 * Host-owned references used by the navigation and feedback region adapters.
 *
 * A presentation proposal contains only `bindingRevision` and `bindingRef`.
 * Labels, messages, routes, actions and tree/tab/menu item definitions are
 * resolved from this immutable host table. This keeps model-authored wire data
 * from becoming a destination, business action or trusted copy source.
 */
export interface AeliqoNavigationFeedbackBindings {
  readonly revision: string;
  readonly contents?: readonly AeliqoNavigationFeedbackContent[];
  readonly routes?: readonly AeliqoNavigationFeedbackRoute[];
  readonly actions?: readonly AeliqoNavigationFeedbackAction[];
  readonly breadcrumbs?: readonly AeliqoBreadcrumbBinding[];
  readonly menus?: readonly AeliqoMenuBinding[];
  readonly pagination?: readonly AeliqoPaginationBinding[];
  readonly tabs?: readonly AeliqoTabsBinding[];
  readonly trees?: readonly AeliqoTreeBinding[];
  readonly feedback?: readonly AeliqoFeedbackBinding[];
}

export interface AeliqoNavigationFeedbackContent {
  readonly id: string;
  readonly text: string;
}

export interface AeliqoNavigationFeedbackRoute {
  readonly id: string;
  readonly route: VersionRef;
  readonly params: Readonly<Record<string, Scalar>>;
  /** A browser destination resolved by the application, never by a proposal. */
  readonly href: string;
}

export interface AeliqoNavigationFeedbackAction {
  readonly id: string;
  readonly action: VersionRef;
  readonly input: Readonly<Record<string, Scalar>>;
}

export interface AeliqoBreadcrumbBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly items: readonly AeliqoBreadcrumbBindingItem[];
}

export interface AeliqoBreadcrumbBindingItem {
  readonly id: string;
  readonly labelRef: string;
  readonly routeRef?: string;
  readonly current?: boolean;
}

export interface AeliqoMenuBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly items: readonly AeliqoMenuBindingItem[];
}

export interface AeliqoMenuBindingItem {
  readonly id: string;
  readonly labelRef: string;
  readonly actionRef?: string;
  readonly routeRef?: string;
  readonly disabled?: boolean;
}

export interface AeliqoPaginationBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly outputId: string;
  readonly queryDigest: string;
  readonly page: number;
  readonly pageCount?: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly pending?: boolean;
  readonly cursors: readonly AeliqoPaginationCursor[];
}

export interface AeliqoPaginationCursor {
  readonly page: number;
  readonly cursor: string;
}

export interface AeliqoTabsBinding {
  readonly id: string;
  readonly items: readonly AeliqoTabsBindingItem[];
}

export interface AeliqoTabsBindingItem {
  readonly id: string;
  readonly labelRef: string;
  readonly contentRef?: string;
  readonly disabled?: boolean;
}

export interface AeliqoTreeBinding {
  readonly id: string;
  readonly labelRef: string;
  readonly nodes: readonly AeliqoTreeBindingNode[];
}

export interface AeliqoTreeBindingNode {
  readonly id: string;
  readonly labelRef: string;
  readonly children?: readonly AeliqoTreeBindingNode[];
  readonly disabled?: boolean;
  readonly actionRef?: string;
  readonly routeRef?: string;
}

/** Shared host text and action references for feedback primitives. */
export interface AeliqoFeedbackBinding {
  readonly id: string;
  readonly labelRef?: string;
  readonly contentRef?: string;
  readonly headingRef?: string;
  readonly messageRef?: string;
  readonly actionLabelRef?: string;
  readonly actionRef?: string;
  readonly kind?: AeliqoEmptyStateKind;
  readonly progressValue?: number;
  readonly progressMax?: number;
}
