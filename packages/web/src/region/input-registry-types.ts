import type { ReadonlyJsonValue, SemanticType, VersionRef } from '@varendo/core';
import type { AeliqoInputRef } from '../input/manifest.js';

/** A host reviewed semantic target for one draft-producing control. */
export interface AeliqoInputDraftBinding {
  readonly entity: string;
  readonly key: string;
  readonly field: string;
  readonly entityRevision: string;
  readonly type: SemanticType;
}

/** A host reviewed, immutable form action. Input values are static parameters; drafts stay host-owned. */
export interface AeliqoInputActionBinding {
  readonly action: VersionRef;
  readonly input: Readonly<Record<string, ReadonlyJsonValue>>;
}

/** A registered schema for metadata-only file selections. */
export interface AeliqoInputFileBinding {
  readonly schema: VersionRef;
}

/**
 * One application-owned input binding. The presentation graph contains only
 * `bindingRef` and `bindingRevision`; labels, options, semantic targets,
 * defaults and effects are copied from this reviewed table.
 */
export interface AeliqoInputBinding {
  readonly id: string;
  readonly ref: AeliqoInputRef;
  readonly config: Readonly<Record<string, unknown>>;
  readonly draft?: AeliqoInputDraftBinding;
  readonly range?: {
    readonly start: AeliqoInputDraftBinding;
    readonly end: AeliqoInputDraftBinding;
  };
  readonly action?: AeliqoInputActionBinding;
  readonly file?: AeliqoInputFileBinding;
}

/** Immutable host bindings captured by an Experience revision. */
export interface AeliqoInputBindings {
  readonly revision: string;
  readonly inputs: readonly AeliqoInputBinding[];
}
