export type VarendoActionKind = 'button' | 'icon-button' | 'link';

type EventInitLike = {
  readonly bubbles?: boolean;
  readonly cancelable?: boolean;
  readonly composed?: boolean;
};

/** Keep importing event types safe in SSR runtimes without browser globals. */
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

export interface VarendoActionDetail {
  readonly source: 'user';
  readonly action: VarendoActionKind;
  readonly type: 'button' | 'submit' | 'reset';
}

export class VarendoActionEvent extends EventBase {
  readonly detail: VarendoActionDetail;

  constructor(detail: VarendoActionDetail) {
    super('varendo-action', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    this.detail = detail;
  }
}

export interface VarendoLinkDetail {
  /** Preserve browser new-tab/download modifier behavior in semantic hosts. */
  readonly modified?: boolean;
  readonly source: 'user';
  readonly target: '_self' | '_blank';
}

export class VarendoLinkEvent extends EventBase {
  readonly detail: VarendoLinkDetail;

  constructor(detail: VarendoLinkDetail) {
    super('varendo-link', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    this.detail = detail;
  }
}

export interface VarendoSplitChangeDetail {
  readonly source: 'user';
  readonly orientation: 'horizontal' | 'vertical';
  readonly position: number;
}

export class VarendoSplitChangeEvent extends EventBase {
  readonly detail: VarendoSplitChangeDetail;

  constructor(detail: VarendoSplitChangeDetail) {
    super('varendo-split-change', {
      bubbles: true,
      composed: true,
    });
    this.detail = detail;
  }
}
