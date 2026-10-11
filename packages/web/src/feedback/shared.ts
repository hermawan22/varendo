import { css } from 'lit';
import { aeliqoNavigationStyles } from '../navigation/shared.js';

export const aeliqoFeedbackStyles = [
  aeliqoNavigationStyles,
  css`
    :host {
      color: var(--aeliqo-color-text, #111827);
    }
    button {
      color: inherit;
      font: inherit;
    }
    :is(button, [tabindex]):focus-visible {
      outline: var(--aeliqo-focus-width, 0.1875rem) solid var(--aeliqo-color-focus, #4338ca);
      outline-offset: var(--aeliqo-focus-offset, 0.125rem);
      box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--aeliqo-color-focus, #4338ca) 16%, transparent);
    }
    [hidden] {
      display: none !important;
    }
  `,
];

export type AeliqoFeedbackTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function toneColor(tone: AeliqoFeedbackTone): string {
  switch (tone) {
    case 'success':
      return 'var(--aeliqo-color-success, #166534)';
    case 'warning':
      return 'var(--aeliqo-color-warning, #854d0e)';
    case 'danger':
      return 'var(--aeliqo-color-danger, #b91c1c)';
    case 'info':
      return 'var(--aeliqo-color-info, #1d4ed8)';
    default:
      return 'var(--aeliqo-color-border, #64748b)';
  }
}
