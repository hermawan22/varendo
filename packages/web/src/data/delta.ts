import { css, html, LitElement, nothing } from 'lit';
import { aeliqoThemeStyles } from '../styles/theme.js';
import { AELIQO_WEB_VERSION } from '../version.js';
import type { AeliqoDataScope, AeliqoDataStatus, AeliqoDataValue } from './types.js';
import { dataStyles, dataStatusMessage, displaysStatusBanner, scopeText, statusTemplate } from './shared.js';
import { calculateAeliqoDelta, type AeliqoDeltaMode } from './delta-calculation.js';

export { calculateAeliqoDelta, type AeliqoDeltaMode } from './delta-calculation.js';

const DISPLAYABLE_STATUSES: ReadonlySet<AeliqoDataStatus> = new Set(['ready', 'partial', 'stale']);

/** Displays a comparison supplied by the host. Percentage points and
 * relative percentage change use distinct modes and labels. */
export class AeliqoDeltaElement extends LitElement {
  static readonly aeliqoVersion = AELIQO_WEB_VERSION;
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
  current: AeliqoDataValue | undefined = undefined;
  baseline: AeliqoDataValue | undefined = undefined;
  mode: AeliqoDeltaMode = 'absolute';
  compatible = true;
  unit = '';
  scope: AeliqoDataScope | undefined = undefined;
  status: AeliqoDataStatus = 'ready';
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
      ? calculateAeliqoDelta(this.current, this.baseline, this.validMode, this.compatible)
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

  private renderedValue(canDisplay: boolean, result: ReturnType<typeof calculateAeliqoDelta> | undefined): string {
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

  private renderUnit(view: ReturnType<AeliqoDeltaElement['presentation']>) {
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

  private get validMode(): AeliqoDeltaMode {
    return this.mode === 'relative' || this.mode === 'percentage-point' ? this.mode : 'absolute';
  }

  static readonly styles = [
    aeliqoThemeStyles,
    dataStyles,
    css`
      dl {
        margin: 0;
      }
      dt {
        color: var(--aeliqo-color-muted, #475569);
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
      }
      dd {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-4, 0.25rem);
        margin: var(--aeliqo-space-4, 0.25rem) 0 0;
      }
      [part='number'] {
        font-size: var(--aeliqo-typography-font-size-heading, 1.5rem);
        font-variant-numeric: tabular-nums;
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
        overflow-wrap: anywhere;
      }
      [part='unit'],
      [part='mode'],
      [part='scope'] {
        color: var(--aeliqo-color-muted, #475569);
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
      }
      [part='mode'],
      [part='scope'] {
        margin-block-start: var(--aeliqo-space-4, 0.25rem);
      }
      dd.unavailable [part='number'] {
        color: var(--aeliqo-color-muted, #475569);
        font-size: inherit;
        font-weight: 400;
      }
    `,
  ];
}
