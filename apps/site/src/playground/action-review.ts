import type { VarendoAppActionEvent } from '@varendo/web/app';

type PendingAction = Extract<VarendoAppActionEvent, { readonly state: 'preview' }>;

interface ActionReviewOptions {
  readonly dialog: HTMLDialogElement;
  readonly content: HTMLElement;
  readonly cancelButton: HTMLButtonElement;
  readonly confirmButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly pageStatus: HTMLElement;
  readonly receiptState: HTMLElement;
  readonly stringify: (value: unknown) => string;
  readonly setError: (message?: string) => void;
}

export interface ActionReviewController {
  readonly handle: (event: VarendoAppActionEvent) => void;
  reset(): void;
}

function deepestActiveElement(): HTMLElement | undefined {
  let active = document.activeElement;
  while (active instanceof HTMLElement && active.shadowRoot?.activeElement instanceof HTMLElement)
    active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : undefined;
}

class ActionReviewState implements ActionReviewController {
  private pending: PendingAction | undefined;
  private returnFocus: HTMLElement | undefined;
  private lastTrigger: HTMLElement | undefined;

  constructor(private readonly options: ActionReviewOptions) {
    document.addEventListener(
      'click',
      (event) => {
        if (options.dialog.contains(event.target as Node)) return;
        this.lastTrigger = event.composedPath().find((node) => node instanceof HTMLButtonElement) as
          HTMLElement | undefined;
      },
      true,
    );
    options.cancelButton.addEventListener('click', this.cancel);
    options.confirmButton.addEventListener('click', () => void this.confirm());
    options.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.cancel();
    });
    options.dialog.addEventListener('close', () => {
      const target = this.returnFocus;
      this.returnFocus = undefined;
      if (target?.isConnected === true) target.focus();
    });
  }

  handle = (event: VarendoAppActionEvent): void => {
    if (event.state === 'preview') {
      this.showPreview(event);
      return;
    }
    this.pending = undefined;
    if (event.state === 'failed') {
      this.showFailure(event.diagnostics[0]?.message ?? 'The action failed.');
      return;
    }
    this.showExecution(event.execution.state);
  };

  reset(): void {
    this.pending = undefined;
    this.returnFocus = undefined;
    document.removeEventListener('mousedown', this.guardNextMouseDown, true);
    document.removeEventListener('click', this.guardNextClick, true);
  }

  private guardNextMouseDown = (event: MouseEvent): void => {
    if (event.detail < 2) return;
    document.removeEventListener('mousedown', this.guardNextMouseDown, true);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private guardNextClick = (event: MouseEvent): void => {
    document.removeEventListener('mousedown', this.guardNextMouseDown, true);
    document.removeEventListener('click', this.guardNextClick, true);
    if (event.detail < 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private showPreview(event: PendingAction): void {
    this.pending = event;
    const active = deepestActiveElement();
    this.returnFocus = active === document.body || active === this.options.dialog ? this.lastTrigger : active;
    this.options.cancelButton.disabled = false;
    this.options.cancelButton.textContent = 'Cancel';
    this.options.confirmButton.disabled = false;
    this.options.confirmButton.removeAttribute('aria-busy');
    this.options.status.textContent = 'Waiting for your confirmation.';
    this.options.content.textContent = this.options.stringify({
      action: event.preview.action,
      sideEffect: event.preview.sideEffect,
      confirmation: event.preview.confirmation,
      input: event.preview.input,
    });
    this.options.dialog.showModal();
  }

  private showFailure(message: string): void {
    this.options.cancelButton.disabled = false;
    this.options.cancelButton.textContent = 'Close';
    this.options.confirmButton.disabled = true;
    this.options.confirmButton.removeAttribute('aria-busy');
    this.options.status.textContent = message;
    this.options.setError(message);
  }

  private showExecution(state: 'executed' | 'ambiguous'): void {
    this.options.confirmButton.disabled = true;
    this.options.confirmButton.removeAttribute('aria-busy');
    this.options.status.textContent =
      state === 'executed' ? 'Action completed.' : 'The remote result is uncertain; reconcile before retrying.';
    this.options.pageStatus.textContent = this.options.status.textContent;
    this.options.receiptState.textContent = state;
    this.options.cancelButton.disabled = false;
    this.options.cancelButton.textContent = state === 'executed' ? 'Done' : 'Close';
  }

  private close(): void {
    document.removeEventListener('mousedown', this.guardNextMouseDown, true);
    document.removeEventListener('click', this.guardNextClick, true);
    document.addEventListener('mousedown', this.guardNextMouseDown, true);
    document.addEventListener('click', this.guardNextClick, true);
    this.options.dialog.close();
  }

  private cancel = (): void => {
    this.pending?.cancel();
    this.pending = undefined;
    this.close();
  };

  private async confirm(): Promise<void> {
    const action = this.pending;
    if (action === undefined) return;
    this.options.cancelButton.disabled = true;
    this.options.confirmButton.disabled = true;
    this.options.confirmButton.setAttribute('aria-busy', 'true');
    this.options.status.textContent = 'Rechecking authority and executing…';
    try {
      await action.confirm();
    } catch {
      if (this.pending !== action) return;
      this.failConfirmation(action);
    }
  }

  private failConfirmation(action: PendingAction): void {
    action.cancel();
    this.pending = undefined;
    this.options.cancelButton.disabled = false;
    this.options.cancelButton.textContent = 'Close';
    this.options.confirmButton.removeAttribute('aria-busy');
    this.options.status.textContent = 'The action failed safely. Close this review and try again.';
    this.options.setError(this.options.status.textContent);
  }
}

export function createActionReviewController(options: ActionReviewOptions): ActionReviewController {
  return new ActionReviewState(options);
}
