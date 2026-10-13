import { css } from 'lit';
import { varendoNavigationStyles } from '../navigation/shared.js';

export const varendoFeedbackStyles = [
  varendoNavigationStyles,
  css`
    :host {
      color: var(--varendo-color-text, #111827);
    }
    button {
      color: inherit;
      font: inherit;
    }
    :is(button, [tabindex]):focus-visible {
      outline: var(--varendo-focus-width, 0.1875rem) solid var(--varendo-color-focus, #4338ca);
      outline-offset: var(--varendo-focus-offset, 0.125rem);
      box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--varendo-color-focus, #4338ca) 16%, transparent);
    }
    [hidden] {
      display: none !important;
    }
  `,
];

export type VarendoFeedbackTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function toneColor(tone: VarendoFeedbackTone): string {
  switch (tone) {
    case 'success':
      return 'var(--varendo-color-success, #166534)';
    case 'warning':
      return 'var(--varendo-color-warning, #854d0e)';
    case 'danger':
      return 'var(--varendo-color-danger, #b91c1c)';
    case 'info':
      return 'var(--varendo-color-info, #1d4ed8)';
    default:
      return 'var(--varendo-color-border, #64748b)';
  }
}
