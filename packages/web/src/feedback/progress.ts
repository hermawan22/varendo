import { css, html } from 'lit';
import { VarendoFoundationElement, varendoFoundationThemeStyles } from '../foundation/base.js';
import { varendoFeedbackStyles } from './shared.js';

export class VarendoProgressElement extends VarendoFoundationElement {
  static readonly properties = { value: { type: Number }, max: { type: Number }, label: { type: String } };
  static readonly styles = [
    ...varendoFoundationThemeStyles,
    ...varendoFeedbackStyles,
    css`
      :host {
        display: block;
        min-inline-size: 8rem;
      }
      [part='label'] {
        display: block;
        margin-block-end: var(--varendo-space-4, 0.25rem);
      }
      progress,
      [role='progressbar'] {
        accent-color: var(--varendo-color-accent, #4338ca);
        block-size: 0.75rem;
        inline-size: 100%;
      }
      [role='progressbar'] {
        background: var(--varendo-color-border, #64748b);
        border-radius: 999px;
        overflow: hidden;
      }
      [role='progressbar']::before {
        animation: varendo-progress-indeterminate 1.4s ease-in-out infinite;
        background: var(--varendo-color-accent, #4338ca);
        block-size: 100%;
        content: '';
        display: block;
        inline-size: 100%;
        transform: translateX(-100%);
      }
      @keyframes varendo-progress-indeterminate {
        to {
          transform: translateX(100%);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        [role='progressbar']::before {
          animation: none;
          transform: none;
        }
      }
    `,
  ];

  value?: number;
  max = 100;
  label = 'Progress';

  protected override render() {
    const boundedMax = Number.isFinite(this.max) && this.max > 0 ? this.max : 100;
    const determinate = this.value !== undefined && Number.isFinite(this.value);
    const value = determinate ? Math.min(boundedMax, Math.max(0, this.value!)) : undefined;
    return html`<label part="label">${this.label}</label>${
        determinate
          ? html`<progress part="progress" max=${boundedMax} value=${value} aria-label=${this.label}>
              ${value} of ${boundedMax}
            </progress>`
          : html`<div part="progress" role="progressbar" aria-label=${this.label} aria-valuetext="In progress"></div>`
      }`;
  }
}
