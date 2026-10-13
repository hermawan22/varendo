import { css } from 'lit';
import { varendoThemeStyles } from '../styles/theme.js';

export const varendoChartStyles = [
  varendoThemeStyles,
  css`
    :host {
      color: var(--varendo-chart-color, var(--varendo-color-text, #18202a));
      display: block;
      max-inline-size: 100%;
    }

    figure {
      margin: 0;
    }

    figcaption {
      display: grid;
      gap: var(--varendo-space-4, 0.25rem);
      margin-block-end: var(--varendo-space-12, 0.75rem);
    }

    [part='summary'],
    [part='unit'],
    [part='scope'],
    [part='error'],
    [part='gap'] {
      color: var(--varendo-chart-muted, var(--varendo-color-muted, #495464));
      font-size: 0.9em;
    }

    svg {
      background: var(--varendo-chart-background, var(--varendo-color-canvas, #fff));
      block-size: 11.25rem;
      border: var(--varendo-control-border-width, 1px) solid
        var(--varendo-chart-border, var(--varendo-color-border, #c9d0d8));
      box-sizing: border-box;
      inline-size: 100%;
    }

    line {
      stroke: var(--varendo-chart-rule, var(--varendo-color-border, #8d98a5));
      stroke-width: 1;
    }

    line.gridline {
      opacity: 0.45;
      stroke-dasharray: 2 4;
    }

    text:is(.axis-x-tick, .axis-y-tick) {
      fill: currentColor;
      font:
        11px system-ui,
        sans-serif;
    }

    [part='line'] {
      fill: none;
      stroke: var(--varendo-chart-line, var(--varendo-visualization-series1, #0b63ce));
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 3;
    }

    [part='line'].color-1 {
      stroke: var(--varendo-visualization-series2, #7c3aed);
    }
    [part='line'].color-2 {
      stroke: var(--varendo-visualization-series3, #0f766e);
    }
    [part='line'].color-3 {
      stroke: var(--varendo-visualization-series4, #b45309);
    }

    [part='line'].style-1,
    [part='point'].style-1,
    [part='legend-marker'].style-1 {
      stroke-dasharray: 8 4;
    }
    [part='line'].style-2,
    [part='point'].style-2,
    [part='legend-marker'].style-2 {
      stroke-dasharray: 2 4;
    }
    [part='line'].style-3,
    [part='point'].style-3,
    [part='legend-marker'].style-3 {
      stroke-dasharray: 12 3 2 3;
    }
    [part='line'].style-4,
    [part='point'].style-4,
    [part='legend-marker'].style-4 {
      stroke-dasharray: 1 4;
    }

    [part='point'] {
      fill: var(--varendo-chart-point, var(--varendo-color-canvas, #fff));
      stroke: var(--varendo-chart-line, var(--varendo-visualization-series1, #0b63ce));
      stroke-width: 2;
    }

    [part='point'].color-1 {
      stroke: var(--varendo-visualization-series2, #7c3aed);
    }
    [part='point'].color-2 {
      stroke: var(--varendo-visualization-series3, #0f766e);
    }
    [part='point'].color-3 {
      stroke: var(--varendo-visualization-series4, #b45309);
    }

    [part='legend-marker'].color-1 {
      border-block-start-color: var(--varendo-visualization-series2, #7c3aed);
    }
    [part='legend-marker'].color-2 {
      border-block-start-color: var(--varendo-visualization-series3, #0f766e);
    }
    [part='legend-marker'].color-3 {
      border-block-start-color: var(--varendo-visualization-series4, #b45309);
    }

    [part='legend'] {
      display: flex;
      flex-wrap: wrap;
      gap: var(--varendo-space-8, 0.5rem) var(--varendo-space-16, 1rem);
      list-style: none;
      margin: var(--varendo-space-8, 0.5rem) 0 0;
      padding: 0;
    }

    [part='legend'] li {
      align-items: center;
      display: inline-flex;
      gap: var(--varendo-space-4, 0.25rem);
    }

    [part='legend-marker'] {
      border-block-start: 0.2rem solid var(--varendo-chart-line, var(--varendo-visualization-series1, #0b63ce));
      display: inline-block;
      inline-size: 1.25rem;
    }

    [part='legend-marker'].style-1 {
      border-block-start-style: dashed;
    }
    [part='legend-marker'].style-2 {
      border-block-start-style: dotted;
    }
    [part='legend-marker'].style-3 {
      border-block-start-style: double;
    }
    [part='legend-marker'].style-4 {
      border-block-start-style: dashed;
      border-block-start-width: 0.1rem;
    }

    [part='legend-label'] {
      font-size: 0.9em;
    }

    details {
      margin-block-start: var(--varendo-space-12, 0.75rem);
    }

    details:focus-within {
      outline: var(--varendo-focus-width, 0.1875rem) solid
        var(--varendo-chart-focus, var(--varendo-color-focus, #0b63ce));
      outline-offset: var(--varendo-focus-offset, 0.1875rem);
    }

    table {
      border-collapse: collapse;
      margin-block-start: var(--varendo-space-8, 0.5rem);
      min-inline-size: min(100%, 20rem);
    }

    th,
    td {
      border-block-end: var(--varendo-control-border-width, 1px) solid
        var(--varendo-chart-rule, var(--varendo-color-border, #c9d0d8));
      padding: var(--varendo-space-4, 0.25rem) var(--varendo-space-8, 0.5rem);
      text-align: start;
    }
  `,
];
