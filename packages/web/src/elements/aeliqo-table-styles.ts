import { css } from 'lit';
import { aeliqoThemeStyles } from '../styles/theme.js';

export const aeliqoTableStyles = [
  aeliqoThemeStyles,
  css`
    :host {
      color: var(--aeliqo-table-color, var(--aeliqo-color-text, #18202a));
      display: block;
      inline-size: 100%;
      max-inline-size: 100%;
      min-inline-size: 0;
    }
    :host,
    :host * {
      box-sizing: border-box;
    }
    [part='scroll'] {
      inline-size: 100%;
      max-inline-size: 100%;
      min-inline-size: 0;
      overflow-x: auto;
    }
    .visually-hidden {
      block-size: 1px;
      clip-path: inset(50%);
      clip: rect(0 0 0 0);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }
    [part='scroll']:focus-visible,
    [part='cell']:focus-visible,
    [part='selection-cell']:focus-visible,
    [part='grid-row']:focus-visible,
    :is(button, input):focus-visible {
      outline: var(--aeliqo-focus-width, 0.1875rem) solid var(--aeliqo-table-focus, var(--aeliqo-color-focus, #0b63ce));
      outline-offset: var(--aeliqo-focus-offset, 0.1875rem);
    }
    table {
      background: var(--aeliqo-color-canvas, #fff);
      border: var(--aeliqo-control-border-width, 0.0625rem) solid
        var(--_aeliqo-border-subtle, var(--aeliqo-table-rule, var(--aeliqo-color-border, #c9d0d8)));
      border-collapse: separate;
      border-radius: var(--aeliqo-radius-medium, 0.625rem);
      border-spacing: 0;
      min-inline-size: 100%;
    }
    caption {
      font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      padding-block: var(--aeliqo-space-8, 0.5rem);
      text-align: start;
    }
    th,
    td {
      border-block-end: var(--aeliqo-control-border-width, 1px) solid
        var(--aeliqo-table-rule, var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #c9d0d8)));
      padding: var(--aeliqo-space-12, 0.75rem) var(--aeliqo-space-16, 1rem);
      text-align: start;
      vertical-align: top;
    }
    th {
      background: var(--aeliqo-table-heading-background, var(--aeliqo-color-surface, #eef2f5));
      font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
      text-align: start;
    }
    tbody tr:not([data-selected]):hover td {
      background: var(--_aeliqo-accent-subtle, var(--aeliqo-color-surface, #f8fafc));
    }
    th [part='sort'],
    [part='grid-row'] [part='sort'] {
      background: transparent;
      border: 0;
      border-radius: var(--aeliqo-radius-small, 0.375rem);
      color: inherit;
      cursor: pointer;
      font: inherit;
      inline-size: 100%;
      min-block-size: var(--aeliqo-control-compact-target, 2rem);
      padding: 0 var(--aeliqo-space-4, 0.25rem);
      text-align: inherit;
    }
    th [part='sort']:hover,
    [part='grid-row'] [part='sort']:hover {
      background: var(--_aeliqo-accent-subtle, var(--aeliqo-color-surface, #f8fafc));
      color: var(--aeliqo-color-accent, #4338ca);
    }
    tr[data-selected] td,
    [part='grid-row'][data-selected] {
      background: var(
        --_aeliqo-accent-selected,
        color-mix(in srgb, var(--aeliqo-color-accent, #4338ca) 9%, transparent)
      );
    }
    [part='grid'] {
      min-inline-size: max-content;
    }
    [part='grid-row'] {
      align-items: stretch;
      display: grid;
    }
    [part='grid-row']:not([data-selected]):hover {
      background: var(--_aeliqo-accent-subtle, var(--aeliqo-color-surface, #f8fafc));
    }
    [part='grid-head'] [part='grid-row'] {
      font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
    }
    [part='grid-row'] [part='heading'],
    [part='grid-row'] [part='cell'],
    [part='grid-row'] [part='selection-cell'],
    [part='grid-head'] [part='grid-row'] > * {
      border-block-end: var(--aeliqo-control-border-width, 1px) solid
        var(--aeliqo-table-rule, var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #c9d0d8)));
      min-inline-size: 9rem;
      padding: var(--aeliqo-space-12, 0.75rem) var(--aeliqo-space-16, 1rem);
    }
    [part='grid-head'] [part='grid-row'] > * {
      background: var(--aeliqo-table-heading-background, var(--aeliqo-color-surface, #eef2f5));
    }
    [part='grid-row'] [part='selection-cell'],
    [part='grid-head'] [part='grid-row'] > [part='selection-heading'] {
      min-inline-size: 3.25rem;
    }
    [part='scope'],
    [part='status'] {
      color: var(--aeliqo-color-muted, #475569);
      font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
      margin: var(--aeliqo-space-8, 0.5rem) 0 0;
      max-inline-size: 100%;
      overflow-wrap: anywhere;
    }
    [part='scope'] {
      unicode-bidi: plaintext;
    }
    [part='status'].error,
    [part='status'].unavailable {
      color: var(--aeliqo-color-danger, #b91c1c);
    }
    [part='status'].partial,
    [part='status'].stale {
      color: var(--aeliqo-color-warning, #854d0e);
    }
    [part='pagination'] {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: var(--aeliqo-space-8, 0.5rem);
      margin-block-start: var(--aeliqo-space-12, 0.75rem);
    }
    [part='pagination'] button {
      background: var(--aeliqo-color-surface, #fff);
      border: var(--aeliqo-control-border-width, 0.0625rem) solid
        var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #94a3b8));
      border-radius: var(--aeliqo-radius-small, 0.375rem);
      color: inherit;
      cursor: pointer;
      font: inherit;
      min-block-size: var(--aeliqo-control-compact-target, 2rem);
      padding-inline: var(--aeliqo-space-8, 0.5rem);
    }
    [part='pagination'] button:not(:disabled):hover {
      background: var(--_aeliqo-accent-subtle, var(--aeliqo-color-surface, #f8fafc));
      border-color: var(--aeliqo-color-accent, #4338ca);
      color: var(--aeliqo-color-accent, #4338ca);
    }
    [part='pagination'] button:disabled {
      background: var(--aeliqo-color-surface, #f8fafc);
      border-color: var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #94a3b8));
      color: var(--aeliqo-color-muted, #64748b);
      cursor: not-allowed;
    }
    @media (max-width: 30rem) {
      :host([data-reflow='stack']) [part='scroll'] {
        overflow: visible;
      }
      :host([data-reflow='stack']) table {
        border: 0;
        box-shadow: inset 0 0 0 var(--aeliqo-control-border-width, 0.0625rem)
          var(--_aeliqo-border-subtle, var(--aeliqo-table-rule, var(--aeliqo-color-border, #c9d0d8)));
        display: block;
        inline-size: 100%;
        min-inline-size: 0;
      }
      :host([data-reflow='stack']) caption {
        display: block;
        overflow-wrap: anywhere;
        padding-block: var(--aeliqo-space-8, 0.5rem);
        unicode-bidi: plaintext;
      }
      :host([data-reflow='stack']) thead {
        block-size: 1px;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        inline-size: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
      }
      :host([data-reflow='stack']) tbody {
        display: grid;
        gap: var(--aeliqo-space-12, 0.75rem);
      }
      :host([data-reflow='stack']) tr {
        border-block-end: var(--aeliqo-control-border-width, 1px) solid
          var(--aeliqo-table-rule, var(--_aeliqo-border-subtle, var(--aeliqo-color-border, #c9d0d8)));
        display: block;
        padding-block: var(--aeliqo-space-4, 0.25rem);
      }
      :host([data-reflow='stack']) td {
        border: 0;
        display: grid;
        gap: var(--aeliqo-space-8, 0.5rem);
        grid-template-columns: minmax(4.75rem, 0.7fr) minmax(0, 1.3fr);
        padding: var(--aeliqo-space-4, 0.25rem);
      }
      :host([data-reflow='stack']) td::before {
        content: attr(data-label);
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
        overflow-wrap: anywhere;
      }
    }
    @media (forced-colors: active) {
      th,
      td,
      [part='grid-row'] > *,
      [part='pagination'] button {
        border-color: ButtonText;
      }
      tr[data-selected],
      [part='grid-row'][data-selected] {
        outline: 0.125rem solid Highlight;
        outline-offset: -0.125rem;
      }
      tr[data-selected] td,
      [part='grid-row'][data-selected] {
        background: Canvas;
        color: CanvasText;
      }
    }
  `,
];
