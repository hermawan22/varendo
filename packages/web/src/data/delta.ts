import { css, html, LitElement, nothing } from 'lit';
import { varendoThemeStyles } from '../styles/theme.js';
import { VARENDO_WEB_VERSION } from '../version.js';
import type { VarendoDataScope, VarendoDataStatus, VarendoDataValue } from './types.js';
import { dataStyles, dataStatusMessage, displaysStatusBanner, scopeText, statusTemplate } from './shared.js';
import { calculateVarendoDelta, type VarendoDeltaMode } from './delta-calculation.js';

export { calculateVarendoDelta, type VarendoDeltaMode } from './delta-calculation.js';

const DISPLAYABLE_STATUSES: ReadonlySet<VarendoDataStatus> = new Set(['ready', 'partial', 'stale']);

/** Displays a comparison supplied by the host. Percentage points and
 * relative percentage change use distinct modes and labels. */
export class VarendoDeltaElement extends LitElement {
  static readonly varendoVersion = VARENDO_WEB_VERSION;
  static readonly properties = {
    label: { type: String },
    current: { attribute: false },
    baseline: { attribute: false },
    mode: { type: String },
    compatible: { type: Boolean },
    unit: { type: String },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
  };

  label = 'Change';
  current: VarendoDataValue | undefined = undefined;
  baseline: VarendoDataValue | undefined = undefined;
  mode: VarendoDeltaMode = 'absolute';
  compatible = true;
  unit = '';
  scope: VarendoDataScope | undefined = undefined;
  status: VarendoDataStatus = 'ready';
  message = '';

  protected override render() {
    const view = this.presentation();
    const scope = scopeText(this.scope);
    return html`
      <dl part="delta" aria-describedby=${view.scopeDescription} data-mode=${view.mode} data-status=${view.status}>
        <dt part="label">${this.label}</dt>
        <dd part="value" class=${view.valueClass}>
          <bdi part="number" dir=${view.direction}>${view.value}</bdi>${this.renderUnit(view)}
        </dd>
      </dl>
      <div part="mode">${view.modeLabel}</div>
      ${this.renderScope(scope)} ${this.renderStatus()}
    `;
  }

  private presentation() {
    const canDisplay = this.canDisplayStatus();
    const result = canDisplay
      ? calculateVarendoDelta(this.current, this.baseline, this.validMode, this.compatible)
      : undefined;
    const unavailable = !canDisplay || result?.status !== 'ready';
    return {
      mode: this.validMode,
      modeLabel: this.modeLabel(),
      value: this.renderedValue(canDisplay, result),
      valueClass: unavailable ? 'unavailable' : '',
      direction: unavailable ? 'auto' : 'ltr',
      status: unavailable ? 'unavailable' : this.status,
      scopeDescription: scopeText(this.scope) ? 'scope' : nothing,
      unavailable,
    };
  }

  private canDisplayStatus(): boolean {
    return DISPLAYABLE_STATUSES.has(this.status);
  }

  private renderedValue(canDisplay: boolean, result: ReturnType<typeof calculateVarendoDelta> | undefined): string {
    if (!canDisplay) return dataStatusMessage(this.status, this.message) ?? 'Value unavailable.';
    if (result?.status !== 'ready') return dataStatusMessage('unavailable', this.message) ?? 'Value unavailable.';
    return result.display ?? '—';
  }

  private modeLabel(): string {
    switch (this.validMode) {
      case 'relative':
        return 'relative change';
      case 'percentage-point':
        return 'percentage-point change';
      default:
        return 'absolute change';
    }
  }

  private renderUnit(view: ReturnType<VarendoDeltaElement['presentation']>) {
    if (this.unit.length === 0 || view.mode !== 'absolute' || view.unavailable) return nothing;
    return html`<span part="unit">${this.unit}</span>`;
  }

  private renderScope(scope: string | undefined) {
    if (scope === undefined || scope.length === 0) return nothing;
    return html`<div id="scope" part="scope">${scope}</div>`;
  }

  private renderStatus() {
    if (!displaysStatusBanner(this.status)) return nothing;
    return statusTemplate(this.status, this.message);
  }

  private get validMode(): VarendoDeltaMode {
    return this.mode === 'relative' || this.mode === 'percentage-point' ? this.mode : 'absolute';
  }

  static readonly styles = [
    varendoThemeStyles,
    dataStyles,
    css`
      dl {
        margin: 0;
      }
      dt {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
      }
      dd {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: var(--varendo-space-4, 0.25rem);
        margin: var(--varendo-space-4, 0.25rem) 0 0;
      }
      [part='number'] {
        font-size: var(--varendo-typography-font-size-heading, 1.5rem);
        font-variant-numeric: tabular-nums;
        font-weight: var(--varendo-typography-font-weight-semibold, 600);
        overflow-wrap: anywhere;
      }
      [part='unit'],
      [part='mode'],
      [part='scope'] {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
      }
      [part='mode'],
      [part='scope'] {
        margin-block-start: var(--varendo-space-4, 0.25rem);
      }
      dd.unavailable [part='number'] {
        color: var(--varendo-color-muted, #475569);
        font-size: inherit;
        font-weight: 400;
      }
    `,
  ];
}
