import { css, html } from 'lit';
import { AeliqoFoundationElement, aeliqoFoundationThemeStyles } from '../foundation/base.js';
import { aeliqoFeedbackStyles } from './shared.js';

export type AeliqoSkeletonVariant = 'text' | 'rect' | 'circle';

const SKELETON_VARIANTS: ReadonlySet<AeliqoSkeletonVariant> = new Set(['text', 'rect', 'circle']);

/** Reserves the shape of loading content without claiming that content exists. */
export class AeliqoSkeletonElement extends AeliqoFoundationElement {
  static readonly properties = {
    label: { type: String },
    lines: { type: Number },
    variant: { type: String },
    animated: { type: Boolean },
  };
  static readonly styles = [
    ...aeliqoFoundationThemeStyles,
    ...aeliqoFeedbackStyles,
    css`
      :host {
        display: block;
      }
      [part='skeleton'] {
        display: grid;
        gap: var(--aeliqo-space-8, 0.5rem);
      }
      [part='line'] {
        animation: aeliqo-skeleton-pulse 1.6s ease-in-out infinite;
        background: var(--aeliqo-color-border, #cbd5e1);
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        display: block;
        min-block-size: 1rem;
      }
      [data-animated='false'] [part='line'] {
        animation: none;
      }
      [data-variant='text'] [part='line']:last-child {
        inline-size: 72%;
      }
      [data-variant='rect'] [part='line'] {
        aspect-ratio: 16 / 9;
        min-block-size: 8rem;
      }
      [data-variant='circle'] [part='line'] {
        aspect-ratio: 1;
        border-radius: 50%;
        inline-size: 4rem;
        min-block-size: 4rem;
      }
      @keyframes aeliqo-skeleton-pulse {
        50% {
          opacity: 0.52;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        [part='line'] {
          animation: none;
        }
      }
    `,
  ];

  label = 'Loading';
  lines = 3;
  variant: AeliqoSkeletonVariant = 'text';
  animated = true;

  protected override render() {
    const variant: AeliqoSkeletonVariant = SKELETON_VARIANTS.has(this.variant) ? this.variant : 'text';
    const count = Number.isSafeInteger(this.lines) ? Math.min(12, Math.max(1, this.lines)) : 3;
    return html`<div
      part="skeleton"
      role="status"
      aria-label=${this.label}
      aria-busy="true"
      data-variant=${variant}
      data-animated=${this.animated ? 'true' : 'false'}
    >
      ${Array.from({ length: variant === 'text' ? count : 1 }, () => html`<span part="line" aria-hidden="true"></span>`)}
    </div>`;
  }
}
