/** Typed input events are user proposals; the host remains authoritative. */

type AeliqoInputSource = 'user';

type EventInitLike = {
  readonly bubbles?: boolean;
  readonly cancelable?: boolean;
  readonly composed?: boolean;
};

const EventBase: typeof Event =
  typeof globalThis.Event === 'function'
    ? globalThis.Event
    : (class {
        readonly bubbles = false;
        readonly cancelable = false;
        readonly composed = false;
        readonly defaultPrevented = false;
        readonly type: string;

        constructor(type: string, _init?: EventInitLike) {
          this.type = type;
        }

        preventDefault(): void {}
      } as unknown as typeof Event);

export interface AeliqoInputChangeDetail<T> {
  readonly source: AeliqoInputSource;
  readonly value: T;
  readonly composing?: boolean;
}

export class AeliqoInputChangeEvent<T> extends EventBase {
  readonly detail: AeliqoInputChangeDetail<T>;

  constructor(detail: AeliqoInputChangeDetail<T>) {
    super('aeliqo-input-change', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export interface AeliqoInputCommitDetail<T> {
  readonly source: AeliqoInputSource;
  readonly value: T;
}

export class AeliqoInputCommitEvent<T> extends EventBase {
  readonly detail: AeliqoInputCommitDetail<T>;

  constructor(detail: AeliqoInputCommitDetail<T>) {
    super('aeliqo-input-commit', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export type AeliqoValidationState = 'idle' | 'pending' | 'valid' | 'invalid';

export interface AeliqoValidationDetail {
  readonly source: AeliqoInputSource;
  readonly state: AeliqoValidationState;
  readonly message: string;
}

export class AeliqoValidationEvent extends EventBase {
  readonly detail: AeliqoValidationDetail;

  constructor(detail: AeliqoValidationDetail) {
    super('aeliqo-validation', { bubbles: true, composed: true });
    this.detail = detail;
  }
}

export interface AeliqoFormSubmitDetail {
  readonly source: AeliqoInputSource;
  readonly submitter: string | undefined;
}

export class AeliqoFormSubmitEvent extends EventBase {
  readonly detail: AeliqoFormSubmitDetail;

  constructor(detail: AeliqoFormSubmitDetail) {
    super('aeliqo-form-submit', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export class AeliqoFormResetEvent extends EventBase {
  constructor() {
    super('aeliqo-form-reset', { bubbles: true, composed: true, cancelable: true });
  }
}

export interface AeliqoSearchDetail {
  readonly source: AeliqoInputSource;
  readonly query: string;
}

/** A committed search query. The host decides whether and how to execute it. */
export class AeliqoSearchEvent extends EventBase {
  readonly detail: AeliqoSearchDetail;

  constructor(detail: AeliqoSearchDetail) {
    super('aeliqo-search', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

/** A combobox query draft is separate from its selected value. */
export interface AeliqoComboboxQueryDetail {
  readonly source: AeliqoInputSource;
  readonly query: string;
}

export class AeliqoComboboxQueryEvent extends EventBase {
  readonly detail: AeliqoComboboxQueryDetail;

  constructor(detail: AeliqoComboboxQueryDetail) {
    super('aeliqo-combobox-query', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export interface AeliqoFileMetadata {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly lastModified: number;
}

export interface AeliqoFileChangeDetail {
  readonly source: AeliqoInputSource;
  readonly files: readonly AeliqoFileMetadata[];
}

/** File selections expose metadata only; the host owns any subsequent upload. */
export class AeliqoFileChangeEvent extends EventBase {
  readonly detail: AeliqoFileChangeDetail;

  constructor(detail: AeliqoFileChangeDetail) {
    super('aeliqo-file-change', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}
