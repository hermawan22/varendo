import { css, html, LitElement, nothing } from 'lit';
import { varendoThemeStyles } from '../styles/theme.js';
import { VARENDO_WEB_VERSION } from '../version.js';
import type { VarendoDataScope, VarendoDataStatus, VarendoDataValue } from './types.js';
import {
  dataValueText,
  dataStatusMessage,
  displaysStatusBanner,
  scopeText,
  dataStyles,
  statusTemplate,
} from './shared.js';

export type VarendoMetricFormat = 'plain' | 'number' | 'percent';

/** A single host-validated value. This component formats and labels data; it
 * never computes a metric or changes its scope. */
export class VarendoMetricElement extends LitElement {
  static readonly varendoVersion = VARENDO_WEB_VERSION;
  static readonly properties = {
    label: { type: String },
    value: { attribute: false },
    displayValue: { attribute: 'display-value', type: String },
    unit: { type: String },
    description: { type: String },
    scope: { attribute: false },
    status: { type: String },
    message: { type: String },
    format: { type: String },
    locale: { type: String },
  };

  label = '';
  value: VarendoDataValue | undefined = undefined;
  displayValue: string | undefined = undefined;
  unit = '';
  description = '';
  scope: VarendoDataScope | undefined = undefined;
  status: VarendoDataStatus = 'ready';
  message = '';
  format: VarendoMetricFormat = 'plain';
  locale = '';

  protected override render() {
    const effectiveStatus = this.effectiveStatus;
    const unavailable = this.isUnavailable(effectiveStatus);
    const direction = unavailable || !this.numericValue ? 'auto' : 'ltr';
    const value = this.valueForStatus(effectiveStatus, unavailable);
    const unit = this.renderUnit(unavailable);
    const describedBy = this.describedBy();
    const status = this.renderStatus(effectiveStatus);
    return html`
      <dl part="metric" aria-describedby=${describedBy || nothing} data-status=${effectiveStatus}>
        <dt part="label">${this.label}</dt>
        <dd part="value" class=${unavailable ? 'unavailable' : nothing}>
          <bdi part="number" dir=${direction} tabindex=${direction === 'ltr' ? '0' : nothing}>${value}</bdi>${unit}
        </dd>
      </dl>
      ${this.description ? html`<div id="description" part="description">${this.description}</div>` : nothing}
      ${this.scopeText ? html`<div id="scope" part="scope">${this.scopeText}</div>` : nothing} ${status}
    `;
  }

  private get effectiveStatus(): VarendoDataStatus {
    if (this.value === undefined && this.status === 'ready') return 'unavailable';
    return this.status;
  }

  private isUnavailable(status: VarendoDataStatus): boolean {
    return status === 'unavailable' || status === 'error';
  }

  private valueForStatus(status: VarendoDataStatus, unavailable: boolean): string {
    if (!unavailable) return this.renderValue();
    return dataStatusMessage(status, this.message) ?? 'Value unavailable.';
  }

  private renderUnit(unavailable: boolean) {
    if (!this.unit || unavailable || !this.hasDisplayableValue) return nothing;
    return html`<span part="unit">${this.unit}</span>`;
  }

  private get hasDisplayableValue(): boolean {
    return (this.value !== undefined && this.value !== null) || this.displayValue !== undefined;
  }

  private describedBy(): string {
    const ids: string[] = [];
    if (this.description) ids.push('description');
    if (this.scopeText) ids.push('scope');
    return ids.join(' ');
  }

  private renderStatus(status: VarendoDataStatus) {
    if (!displaysStatusBanner(status)) return nothing;
    return statusTemplate(status, this.message);
  }

  private get scopeText(): string | undefined {
    return scopeText(this.scope);
  }

  private get numericValue(): boolean {
    return (
      this.displayValue === undefined &&
      (typeof this.value === 'number' ||
        (typeof this.value === 'object' &&
          this.value !== null &&
          !Array.isArray(this.value) &&
          typeof this.value.decimal === 'string'))
    );
  }

  private renderValue(): string {
    if (this.displayValue !== undefined) return this.displayValue;
    if (this.value === null || this.value === undefined) return '—';
    if (this.format === 'plain' || typeof this.value !== 'number') return dataValueText(this.value);
    const options: Intl.NumberFormatOptions =
      this.format === 'percent' ? { style: 'percent', maximumFractionDigits: 2 } : { maximumFractionDigits: 2 };
    try {
      return new Intl.NumberFormat(this.locale || undefined, options).format(this.value);
    } catch {
      return dataValueText(this.value);
    }
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
        font-weight: var(--varendo-typography-font-weight-semibold, 600);
        overflow-wrap: anywhere;
      }
      [part='number'][dir='ltr'] {
        display: inline-block;
        max-inline-size: 100%;
        min-inline-size: 0;
        overflow-x: auto;
        overflow-y: hidden;
        overflow-wrap: normal;
        white-space: nowrap;
      }
      [part='unit'] {
        color: var(--varendo-color-muted, #475569);
        overflow-wrap: anywhere;
      }
      [part='description'],
      [part='scope'] {
        color: var(--varendo-color-muted, #475569);
        font-size: var(--varendo-typography-font-size-caption, 0.8125rem);
        margin-block-start: var(--varendo-space-4, 0.25rem);
        overflow-wrap: anywhere;
      }
      dd.unavailable [part='number'] {
        color: var(--varendo-color-muted, #475569);
        font-size: inherit;
        font-weight: 400;
      }
    `,
  ];
}
