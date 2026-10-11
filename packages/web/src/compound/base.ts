import { css, LitElement } from 'lit';
import { aeliqoFoundationThemeStyles } from '../foundation/base.js';
import type { AeliqoDataStatus } from '../data/types.js';
import { AELIQO_WEB_VERSION } from '../version.js';

export const COMPOUND_VERSION = AELIQO_WEB_VERSION;

const STATUS_TEXT: Record<AeliqoDataStatus, string> = {
  ready: '',
  loading: 'Loading authorized data…',
  empty: 'No matching records.',
  partial: 'Showing a partial result.',
  stale: 'This result is stale and needs refresh.',
  error: 'The authorized data could not be displayed.',
  unavailable: 'This data is unavailable.',
};
export const compoundStyles = css`
  :host {
    box-sizing: border-box;
    color: var(--aeliqo-color-text, #111827);
    display: block;
    min-inline-size: 0;
    max-inline-size: 100%;
  }
  :host,
  :host * {
    box-sizing: border-box;
  }
  section,
  article,
  form {
    min-inline-size: 0;
  }
  [part='header'] {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: var(--aeliqo-space-8, 0.5rem);
    justify-content: space-between;
  }
  h2,
  h3 {
    overflow-wrap: anywhere;
  }
  h2 {
    font-size: var(--aeliqo-typography-font-size-title, 1.125rem);
    margin: 0;
  }
  h3 {
    font-size: var(--aeliqo-typography-font-size-body, 1rem);
    margin: 0;
  }
  [part='status'],
  [part='scope'],
  [part='hint'],
  [part='meta'] {
    color: var(--aeliqo-color-muted, #475569);
    overflow-wrap: anywhere;
    unicode-bidi: plaintext;
  }
  [part='status'] {
    margin-block: var(--aeliqo-space-8, 0.5rem);
  }
  [part='grid'] {
    display: grid;
    gap: var(--aeliqo-space-16, 1rem);
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  }
  [part='actions'],
  [part='navigation'] {
    display: flex;
    flex-wrap: wrap;
    gap: var(--aeliqo-space-8, 0.5rem);
    margin-block-start: var(--aeliqo-space-16, 1rem);
  }
  button {
    background: var(--aeliqo-color-surface, #fff);
    border: 0.0625rem solid var(--aeliqo-color-border, #c9d0d8);
    border-radius: var(--aeliqo-radius-medium, 0.625rem);
    color: inherit;
    cursor: pointer;
    font: inherit;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline: var(--aeliqo-space-12, 0.75rem);
  }
  button:hover:not(:disabled) {
    border-color: var(--aeliqo-color-accent, #4338ca);
  }
  button:focus-visible {
    outline: 0.1875rem solid var(--aeliqo-color-focus, #4338ca);
    outline-offset: 0.125rem;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }
  [data-status='error'] [part='status'],
  [data-status='invalid'] [part='status'] {
    color: var(--aeliqo-color-danger, #b42318);
  }
  @media (forced-colors: active) {
    button {
      background: Canvas;
      color: CanvasText;
    }
  }
`;

export abstract class AeliqoCompoundElement extends LitElement {
  static readonly aeliqoVersion = COMPOUND_VERSION;
  static readonly shadowRootOptions: ShadowRootInit = { mode: 'open', delegatesFocus: true };
  protected statusText(status: AeliqoDataStatus, message = ''): string {
    return message || STATUS_TEXT[status] || '';
  }
  protected statusTemplate(status: AeliqoDataStatus, message = ''): string {
    return this.statusText(status, message);
  }
  protected scopeLabel(
    scope:
      | { readonly label?: string; readonly kind?: string; readonly loaded?: number; readonly filteredTotal?: number }
      | undefined,
  ): string {
    if (scope?.label) return scope.label;
    if (scope?.filteredTotal !== undefined)
      return `${scope.filteredTotal.toLocaleString()} matching records in the authorized scope`;
    if (scope?.loaded !== undefined) return `${scope.loaded.toLocaleString()} loaded records`;
    if (scope?.kind === 'unknown') return 'Scope is not known';
    return '';
  }
}

export const aeliqoCompoundThemeStyles = [...aeliqoFoundationThemeStyles, compoundStyles] as const;
