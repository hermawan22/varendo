import type { InteractionPayload, InteractionState } from '@varendo/core';
import type { AeliqoPageRequest, AeliqoSortState, AeliqoTableWindowDetail } from '../data/types.js';

/**
 * Host requests emitted by the renderer. Selection and filter carry the
 * canonical core InteractionPayload. Page/sort/window/load-more stay typed
 * component requests because the core wire contract has no implicit window or
 * sort payload. The host decides whether and how to query.
 */
export type AeliqoDataHostRequest =
  | {
      readonly kind: 'selection';
      readonly nodeId: string;
      readonly portId: string;
      readonly payload: Extract<InteractionPayload, { readonly kind: 'selection' }>;
    }
  | {
      readonly kind: 'filter';
      readonly nodeId: string;
      readonly portId: string;
      readonly payload: Extract<InteractionPayload, { readonly kind: 'filter' }>;
    }
  | {
      readonly kind: 'page';
      readonly nodeId: string;
      readonly portId: string;
      readonly request: AeliqoPageRequest;
    }
  | {
      readonly kind: 'sort';
      readonly nodeId: string;
      readonly portId: string;
      readonly request: AeliqoSortState | undefined;
    }
  | {
      readonly kind: 'window';
      readonly nodeId: string;
      readonly portId: string;
      readonly request: AeliqoTableWindowDetail;
    }
  | {
      readonly kind: 'load-more';
      readonly nodeId: string;
      readonly portId: string;
    };

export type AeliqoDataHostRequestHandler = (request: AeliqoDataHostRequest) => void;

export interface AeliqoDataRenderContext {
  readonly interaction?: InteractionState;
  readonly onRequest?: AeliqoDataHostRequestHandler;
}
