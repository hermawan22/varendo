export type AeliqoActionKind = 'button' | 'icon-button' | 'link';

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

export interface AeliqoActionDetail {
  readonly source: 'user';
  readonly action: AeliqoActionKind;
  readonly type: 'button' | 'submit' | 'reset';
}

export class AeliqoActionEvent extends EventBase {
  readonly detail: AeliqoActionDetail;

  constructor(detail: AeliqoActionDetail) {
    super('aeliqo-action', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    this.detail = detail;
  }
}

export interface AeliqoLinkDetail {
  /** Preserve browser new-tab/download modifier behavior in semantic hosts. */
  readonly modified?: boolean;
  readonly source: 'user';
  readonly target: '_self' | '_blank';
}

export class AeliqoLinkEvent extends EventBase {
  readonly detail: AeliqoLinkDetail;

  constructor(detail: AeliqoLinkDetail) {
    super('aeliqo-link', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    this.detail = detail;
  }
}

export interface AeliqoSplitChangeDetail {
  readonly source: 'user';
  readonly orientation: 'horizontal' | 'vertical';
  readonly position: number;
}

export class AeliqoSplitChangeEvent extends EventBase {
  readonly detail: AeliqoSplitChangeDetail;

  constructor(detail: AeliqoSplitChangeDetail) {
    super('aeliqo-split-change', {
      bubbles: true,
      composed: true,
    });
    this.detail = detail;
  }
}
