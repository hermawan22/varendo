import type { InteractionPayload, InteractionState } from '@varendo/core';
import type { VarendoPageRequest, VarendoSortState, VarendoTableWindowDetail } from '../data/types.js';

/**
 * Host requests emitted by the renderer. Selection and filter carry the
 * canonical core InteractionPayload. Page/sort/window/load-more stay typed
 * component requests because the core wire contract has no implicit window or
 * sort payload. The host decides whether and how to query.
 */
export type VarendoDataHostRequest =
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
      readonly request: VarendoPageRequest;
    }
  | {
      readonly kind: 'sort';
      readonly nodeId: string;
      readonly portId: string;
      readonly request: VarendoSortState | undefined;
    }
  | {
      readonly kind: 'window';
      readonly nodeId: string;
      readonly portId: string;
      readonly request: VarendoTableWindowDetail;
    }
  | {
      readonly kind: 'load-more';
      readonly nodeId: string;
      readonly portId: string;
    };

export type VarendoDataHostRequestHandler = (request: VarendoDataHostRequest) => void;

export interface VarendoDataRenderContext {
  readonly interaction?: InteractionState;
  readonly onRequest?: VarendoDataHostRequestHandler;
}
