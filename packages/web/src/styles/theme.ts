import { css, unsafeCSS } from 'lit';
import type { CSSResult } from 'lit';
import { VARENDO_DARK_TOKENS, VARENDO_LIGHT_TOKENS, VARENDO_SHARED_TOKENS } from './tokens.js';

const declarations = (values: Readonly<Record<string, string>>): string =>
  Object.entries(values)
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n');

// Shared defaults come first so theme-specific values, including palettes, win.
const baseDeclarations = `${declarations(VARENDO_SHARED_TOKENS)}\n${declarations(VARENDO_LIGHT_TOKENS)}`;
const darkDeclarations = declarations(VARENDO_DARK_TOKENS);

const forcedColorDeclarations = `
  --varendo-color-canvas: Canvas;
  --varendo-color-surface: Canvas;
  --varendo-color-text: CanvasText;
  --varendo-color-muted: CanvasText;
  --varendo-color-border: ButtonText;
  --varendo-color-accent: Highlight;
  --varendo-color-on-accent: HighlightText;
  --varendo-color-danger: LinkText;
  --varendo-color-success: Highlight;
  --varendo-color-warning: Highlight;
  --varendo-color-info: Highlight;
  --varendo-color-focus: Highlight;
  --varendo-visualization-series1: Highlight;
  --varendo-visualization-series2: Highlight;
  --varendo-visualization-series3: Highlight;
  --varendo-visualization-series4: Highlight;
  --varendo-visualization-series5: Highlight;
  --varendo-visualization-series6: Highlight;
  --varendo-visualization-quantitative-start: CanvasText;
  --varendo-visualization-quantitative-end: CanvasText;
  --varendo-visualization-reference: ButtonText;
`;

const inheritedThemeDeclarations = Object.keys({ ...VARENDO_LIGHT_TOKENS, ...VARENDO_SHARED_TOKENS })
  .map((name) => `${name}: unset;`)
  .join('\n');

const sharedRules = `
  --_varendo-border-subtle: color-mix(in srgb, var(--varendo-color-border) 28%, var(--varendo-color-surface));
  --_varendo-accent-subtle: color-mix(in srgb, var(--varendo-color-accent) 8%, var(--varendo-color-surface));
  --_varendo-accent-selected: color-mix(in srgb, var(--varendo-color-accent) 14%, var(--varendo-color-surface));
  --_varendo-danger-subtle: color-mix(in srgb, var(--varendo-color-danger) 8%, var(--varendo-color-surface));
  --_varendo-warning-subtle: color-mix(in srgb, var(--varendo-color-warning) 9%, var(--varendo-color-surface));
  --_varendo-info-subtle: color-mix(in srgb, var(--varendo-color-info) 8%, var(--varendo-color-surface));
  color: var(--varendo-color-text);
  background-color: var(--varendo-color-canvas);
  direction: inherit;
  font-family: var(--varendo-typography-font-family-system);
  font-size: var(--varendo-typography-font-size-body);
  font-weight: var(--varendo-typography-font-weight-regular);
  line-height: var(--varendo-typography-line-height-normal);
  text-rendering: optimizeLegibility;
`;

/**
 * Component-scoped baseline styles. Add this result before component-specific
 * styles in a Lit `static styles` array; it never selects document or host-app
 * elements outside the component root.
 */
export const varendoThemeStyles: CSSResult = css`
  :host {
    ${unsafeCSS(baseDeclarations)}
    ${unsafeCSS(sharedRules)}
    color-scheme: light;
    box-sizing: border-box;
    --_varendo-coarse-target: 0px;
  }

  :host([data-varendo-theme='dark']) {
    ${unsafeCSS(darkDeclarations)}
    color-scheme: dark;
  }

  /* Opt into a theme supplied by an ancestor scope using inherited variables. */
  :host([data-varendo-theme='inherit']) {
    ${unsafeCSS(inheritedThemeDeclarations)}
    color-scheme: inherit;
  }

  @media (prefers-color-scheme: dark) {
    :host(:not([data-varendo-theme='light']):not([data-varendo-theme='dark']):not([data-varendo-theme='inherit'])) {
      ${unsafeCSS(darkDeclarations)}
      color-scheme: dark;
    }
  }

  :host([dir='rtl']) {
    direction: rtl;
  }

  :host([dir='ltr']) {
    direction: ltr;
  }

  :host :where(button, input, select, textarea, [role='button'], [role='tab'], [role='menuitem']) {
    transition-property: border-color, box-shadow, transform;
    transition-duration: var(--varendo-motion-duration-fast, 120ms);
    transition-timing-function: var(--varendo-motion-easing-standard, cubic-bezier(0.2, 0, 0, 1));
  }

  :host :where(dialog) {
    border-color: var(--_varendo-border-subtle);
  }

  :host dialog [part='header'],
  :host [part='inline'] [part='header'] {
    border-block-end-color: var(--_varendo-border-subtle);
  }

  :host([data-varendo-text-scale='large']) {
    font-size: 1.125rem;
  }

  :host([data-varendo-density='compact']) {
    --varendo-control-min-target: var(--varendo-control-compact-target);
  }

  @media (pointer: coarse) {
    :host {
      --_varendo-coarse-target: max(44px, var(--varendo-control-coarse-target, 2.75rem));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :host,
    :host([data-varendo-theme='inherit']) {
      --varendo-motion-duration-fast: 0ms;
      --varendo-motion-duration-standard: 0ms;
    }
  }

  @media (forced-colors: active) {
    :host {
      ${unsafeCSS(forcedColorDeclarations)}
      forced-color-adjust: auto;
    }
  }
`;

/**
 * Explicit opt-in stylesheet for a chosen application scope. Apply it to a
 * container carrying `data-varendo-theme`; importing this module has no global
 * side effect and does not mutate `document.documentElement`.
 */
export const varendoStandaloneThemeStyles: CSSResult = /* @__PURE__ */ (() => css`
  :where([data-varendo-theme]:not([data-varendo-theme='inherit'])) {
    ${unsafeCSS(baseDeclarations)}
    ${unsafeCSS(sharedRules)}
    color-scheme: light;
  }

  :where([data-varendo-theme='dark']) {
    ${unsafeCSS(darkDeclarations)}
    color-scheme: dark;
  }

  @media (prefers-color-scheme: dark) {
    :where(
      [data-varendo-theme]:not([data-varendo-theme='light']):not([data-varendo-theme='dark']):not(
          [data-varendo-theme='inherit']
        )
    ) {
      ${unsafeCSS(darkDeclarations)}
      color-scheme: dark;
    }
  }

  :where([data-varendo-theme][dir='rtl']),
  :where([data-varendo-theme] [dir='rtl']) {
    direction: rtl;
  }

  :where([data-varendo-theme][dir='ltr']),
  :where([data-varendo-theme] [dir='ltr']) {
    direction: ltr;
  }

  @media (prefers-reduced-motion: reduce) {
    :where([data-varendo-theme]) {
      --varendo-motion-duration-fast: 0ms;
      --varendo-motion-duration-standard: 0ms;
    }
  }

  @media (forced-colors: active) {
    :where([data-varendo-theme]) {
      ${unsafeCSS(forcedColorDeclarations)}
      forced-color-adjust: auto;
    }
  }
`)();

export const varendoThemeStyleText = varendoThemeStyles.cssText;
