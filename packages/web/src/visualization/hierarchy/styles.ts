import { css } from 'lit';
import { aeliqoFoundationThemeStyles } from '../../foundation/base.js';

export const aeliqoHierarchyStyles = [
  ...aeliqoFoundationThemeStyles,
  css`
    :host {
      container-type: inline-size;
      display: block;
      min-inline-size: 0;
      inline-size: 100%;
      max-inline-size: 100%;
      color: var(--aeliqo-color-text, #111827);
    }
    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
    figure {
      margin: 0;
    }
    figcaption,
    [part='scope'],
    p,
    caption,
    th,
    td {
      overflow-wrap: anywhere;
      unicode-bidi: plaintext;
    }
    [part='viewport'] {
      /* Enlarged glyphs may extend beyond the fixed data-coordinate canvas. */
      padding-block: 1em;
      direction: ltr;
      overflow: auto;
      max-inline-size: 100%;
      border: 1px solid var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #cbd5e1));
      border-radius: var(--aeliqo-radius-medium, 0.625rem);
    }
    svg {
      overflow: visible;
      display: block;
      max-inline-size: none;
    }
    svg text {
      font: inherit;
      fill: currentColor;
      pointer-events: none;
    }
    svg .tree-label {
      fill: #111827;
    }
    svg .treemap-label {
      fill: var(--aeliqo-color-on-accent, #fff);
    }
    [part='node'],
    [part='edge'] {
      cursor: pointer;
    }
    [part='node']:focus-visible,
    [part='edge']:focus-visible {
      outline: 3px solid var(--aeliqo-color-focus, #4338ca);
      outline-offset: 2px;
    }
    [part='node'][aria-pressed='true'] {
      stroke: var(--aeliqo-color-focus, #4338ca);
      stroke-width: 3;
    }
    [part='edge'][aria-pressed='true'] {
      stroke: var(--aeliqo-color-focus, #4338ca);
      stroke-width: 3;
    }
    [part='data'] {
      overflow: auto;
      margin-block-start: 1rem;
    }
    nav {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    button {
      background: var(--aeliqo-color-surface, #f8fafc);
      border: var(--aeliqo-control-border-width, 0.0625rem) solid
        var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #64748b));
      border-radius: var(--aeliqo-radius-small, 0.375rem);
      color: var(--aeliqo-color-text, #111827);
      font: inherit;
      min-block-size: 2.75rem;
      min-inline-size: 2.75rem;
    }
    button:not(:disabled):hover {
      background: var(--_aeliqo-accent-subtle, var(--aeliqo-color-surface, #f8fafc));
      border-color: var(--aeliqo-color-accent, #4338ca);
      color: var(--aeliqo-color-accent, #4338ca);
    }
    table {
      border-collapse: collapse;
      inline-size: 100%;
    }
    th,
    td {
      text-align: start;
      padding: var(--aeliqo-space-8, 0.5rem) var(--aeliqo-space-12, 0.75rem);
      border-block-end: 1px solid var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #cbd5e1));
      vertical-align: top;
    }
    th {
      background: var(--aeliqo-color-surface, #f8fafc);
      font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
    }
    tbody tr:not([aria-selected='true']):hover {
      background: var(--_aeliqo-accent-subtle, var(--aeliqo-color-surface, #f8fafc));
    }
    [aria-selected='true'] {
      background: var(
        --_aeliqo-accent-selected,
        color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 12%, transparent)
      );
    }
    [part='scope'] {
      color: var(--aeliqo-color-muted, #4b5563);
    }
    @container (max-width: 30rem) {
      [part='data'] {
        overflow: visible;
      }
      table {
        display: block;
        inline-size: 100%;
        min-inline-size: 0;
      }
      caption {
        display: block;
        margin-block: 0.75rem;
        text-align: start;
      }
      thead {
        block-size: 1px;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        inline-size: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
      }
      tbody {
        display: grid;
        gap: 0.75rem;
      }
      tr {
        border-block-end: 1px solid var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #cbd5e1));
        display: block;
        padding-block: 0.25rem;
      }
      td {
        border: 0;
        display: grid;
        gap: 0.5rem;
        grid-template-columns: minmax(min(4.75rem, 40%), 0.7fr) minmax(0, 1.3fr);
        padding: 0.25rem;
      }
      td::before {
        content: attr(data-label);
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      td > button,
      nav > button {
        justify-self: start;
        min-inline-size: min(2.75rem, 100%);
        max-inline-size: 100%;
        overflow-wrap: anywhere;
      }
    }
    @media (forced-colors: active) {
      button {
        background: Canvas;
        color: CanvasText;
      }
      svg path,
      svg line,
      svg rect,
      svg circle {
        stroke: CanvasText;
        fill: Canvas;
      }
    }
  `,
];
