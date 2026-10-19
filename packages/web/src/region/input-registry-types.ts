import type { ReadonlyJsonValue, SemanticType, VersionRef } from '@varendo/core';
import type { VarendoInputRef } from '../input/manifest.js';

/** A host reviewed semantic target for one draft-producing control. */
export interface VarendoInputDraftBinding {
  readonly entity: string;
  readonly key: string;
  readonly field: string;
  readonly entityRevision: string;
  readonly type: SemanticType;
}

/** A host reviewed, immutable form action. Input values are static parameters; drafts stay host-owned. */
export interface VarendoInputActionBinding {
  readonly action: VersionRef;
  readonly input: Readonly<Record<string, ReadonlyJsonValue>>;
}

/** A registered schema for metadata-only file selections. */
export interface VarendoInputFileBinding {
  readonly schema: VersionRef;
}

/**
 * One application-owned input binding. The presentation graph contains only
 * `bindingRef` and `bindingRevision`; labels, options, semantic targets,
 * defaults and effects are copied from this reviewed table.
 */
export interface VarendoInputBinding {
  readonly id: string;
  readonly ref: VarendoInputRef;
  readonly config: Readonly<Record<string, unknown>>;
  readonly draft?: VarendoInputDraftBinding;
  readonly range?: {
    readonly start: VarendoInputDraftBinding;
    readonly end: VarendoInputDraftBinding;
  };
  readonly action?: VarendoInputActionBinding;
  readonly file?: VarendoInputFileBinding;
}

/** Immutable host bindings captured by an Experience revision. */
export interface VarendoInputBindings {
  readonly revision: string;
  readonly inputs: readonly VarendoInputBinding[];
}
