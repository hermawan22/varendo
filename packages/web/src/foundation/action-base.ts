import { AeliqoActionEvent, type AeliqoActionKind } from './events.js';
import { AeliqoFoundationElement } from './base.js';

export type AeliqoActionType = 'button' | 'submit' | 'reset';

export abstract class AeliqoActionElement extends AeliqoFoundationElement {
  static readonly formAssociated = true;

  disabled = false;
  pending = false;
  type: AeliqoActionType = 'button';
  name = '';
  value = '';

  private readonly internals: ElementInternals | undefined;
  private formDisabled = false;
  private activationQueued = false;

  constructor() {
    super();
    this.internals = typeof this.attachInternals === 'function' ? this.attachInternals() : undefined;
  }

  formDisabledCallback(disabled: boolean): void {
    this.formDisabled = disabled;
    if (disabled) this.internals?.setFormValue(null);
    this.requestUpdate();
  }

  formResetCallback(): void {
    this.internals?.setFormValue(null);
  }

  protected get actionDisabled(): boolean {
    return this.disabled || this.pending || this.formDisabled;
  }

  /** Normalize attribute input before it reaches the native control or event wire. */
  protected get actionType(): AeliqoActionType {
    return this.type === 'submit' || this.type === 'reset' ? this.type : 'button';
  }

  protected get associatedForm(): HTMLFormElement | undefined {
    return this.internals?.form ?? undefined;
  }

  protected handleActionClick = (event: Event, action: AeliqoActionKind): void => {
    if (this.actionDisabled || this.activationQueued) {
      event.preventDefault();
      return;
    }
    this.activationQueued = true;
    queueMicrotask(() => {
      this.activationQueued = false;
    });

    const type = this.actionType;
    const accepted = this.dispatchEvent(new AeliqoActionEvent({ source: 'user', action, type }));
    if (!accepted) {
      event.preventDefault();
      return;
    }

    const form = this.associatedForm;
    if (form === undefined) return;
    if (type === 'submit') {
      this.internals?.setFormValue(this.value);
      HTMLFormElement.prototype.requestSubmit.call(form);
      queueMicrotask(() => this.internals?.setFormValue(null));
    } else if (type === 'reset') {
      // A control named "reset" can mask the method on an HTMLFormElement.
      HTMLFormElement.prototype.reset.call(form);
    }
  };
}
