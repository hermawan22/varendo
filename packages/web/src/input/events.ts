/** Typed input events are user proposals; the host remains authoritative. */

type VarendoInputSource = 'user';

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

export interface VarendoInputChangeDetail<T> {
  readonly source: VarendoInputSource;
  readonly value: T;
  readonly composing?: boolean;
}

export class VarendoInputChangeEvent<T> extends EventBase {
  readonly detail: VarendoInputChangeDetail<T>;

  constructor(detail: VarendoInputChangeDetail<T>) {
    super('varendo-input-change', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export interface VarendoInputCommitDetail<T> {
  readonly source: VarendoInputSource;
  readonly value: T;
}

export class VarendoInputCommitEvent<T> extends EventBase {
  readonly detail: VarendoInputCommitDetail<T>;

  constructor(detail: VarendoInputCommitDetail<T>) {
    super('varendo-input-commit', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export type VarendoValidationState = 'idle' | 'pending' | 'valid' | 'invalid';

export interface VarendoValidationDetail {
  readonly source: VarendoInputSource;
  readonly state: VarendoValidationState;
  readonly message: string;
}

export class VarendoValidationEvent extends EventBase {
  readonly detail: VarendoValidationDetail;

  constructor(detail: VarendoValidationDetail) {
    super('varendo-validation', { bubbles: true, composed: true });
    this.detail = detail;
  }
}

export interface VarendoFormSubmitDetail {
  readonly source: VarendoInputSource;
  readonly submitter: string | undefined;
}

export class VarendoFormSubmitEvent extends EventBase {
  readonly detail: VarendoFormSubmitDetail;

  constructor(detail: VarendoFormSubmitDetail) {
    super('varendo-form-submit', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export class VarendoFormResetEvent extends EventBase {
  constructor() {
    super('varendo-form-reset', { bubbles: true, composed: true, cancelable: true });
  }
}

export interface VarendoSearchDetail {
  readonly source: VarendoInputSource;
  readonly query: string;
}

/** A committed search query. The host decides whether and how to execute it. */
export class VarendoSearchEvent extends EventBase {
  readonly detail: VarendoSearchDetail;

  constructor(detail: VarendoSearchDetail) {
    super('varendo-search', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

/** A combobox query draft is separate from its selected value. */
export interface VarendoComboboxQueryDetail {
  readonly source: VarendoInputSource;
  readonly query: string;
}

export class VarendoComboboxQueryEvent extends EventBase {
  readonly detail: VarendoComboboxQueryDetail;

  constructor(detail: VarendoComboboxQueryDetail) {
    super('varendo-combobox-query', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}

export interface VarendoFileMetadata {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly lastModified: number;
}

export interface VarendoFileChangeDetail {
  readonly source: VarendoInputSource;
  readonly files: readonly VarendoFileMetadata[];
}

/** File selections expose metadata only; the host owns any subsequent upload. */
export class VarendoFileChangeEvent extends EventBase {
  readonly detail: VarendoFileChangeDetail;

  constructor(detail: VarendoFileChangeDetail) {
    super('varendo-file-change', { bubbles: true, composed: true, cancelable: true });
    this.detail = detail;
  }
}
