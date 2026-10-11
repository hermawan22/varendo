import { css, html, LitElement, nothing } from 'lit';
import { aeliqoThemeStyles } from '../styles/theme.js';
import { AELIQO_WEB_VERSION } from '../version.js';
import type { AeliqoDataStatus, AeliqoFieldOption, AeliqoFilterPredicate } from './types.js';
import { AeliqoFilterChangeEvent } from './events.js';
import { dataStyles, statusTemplate } from './shared.js';
import type { AeliqoFilterClause, AeliqoFilterOperator } from './filter-builder-types.js';
import type { AeliqoFilterLogical, PredicateProjection } from './filter-builder-internal-types.js';
import { MAX_PREDICATE_NODES } from './filter-builder-limits.js';
import {
  buildAeliqoPredicate,
  clausesSourceSignature,
  combineAeliqoPredicates,
  predicateSourceSignature,
  predicateText,
  projectPredicate,
  validateAeliqoPredicate,
} from './filter-builder-logic.js';

export type { AeliqoFilterClause, AeliqoFilterOperator } from './filter-builder-types.js';
export { buildAeliqoPredicate, combineAeliqoPredicates, validateAeliqoPredicate } from './filter-builder-logic.js';

const DRAFT_SOURCE_PROPERTIES = ['predicate', 'clauses', 'logical', 'entity', 'fields'] as const;
const MAX_MANUAL_CLAUSES = MAX_PREDICATE_NODES - 1;

/** Builds a typed predicate locally and only emits it on an explicit Apply.
 * Typing, composition and IME input never execute a query. */
export class AeliqoFilterBuilderElement extends LitElement {
  static readonly aeliqoVersion = AELIQO_WEB_VERSION;
  static readonly properties = {
    fields: { attribute: false },
    predicate: { attribute: false },
    inherited: { attribute: false },
    entity: { type: String },
    scopeLabel: { attribute: 'scope-label', type: String },
    applyLabel: { attribute: 'apply-label', type: String },
    autoApply: { attribute: 'auto-apply', type: Boolean },
    clauses: { attribute: false },
    logical: { type: String },
    status: { type: String },
    message: { type: String },
  };

  fields: readonly AeliqoFieldOption[] = [];
  predicate: AeliqoFilterPredicate | undefined = undefined;
  inherited: AeliqoFilterPredicate | undefined = undefined;
  entity = '';
  scopeLabel = 'Current authorized scope';
  applyLabel = 'Apply filter';
  autoApply = false;
  clauses: readonly AeliqoFilterClause[] = [];
  logical: 'and' | 'or' = 'and';
  status: AeliqoDataStatus = 'ready';
  message = '';

  private clauseDrafts: AeliqoFilterClause[] = [];
  private logicalMode: AeliqoFilterLogical = 'and';
  private unsupportedPredicate: AeliqoFilterPredicate | undefined = undefined;
  private draftSourceSignature: string | undefined;
  private draftInitialized = false;
  private draftInteracted = false;
  private validationMessage = '';

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!this.shouldProjectDraft(changed)) return;
    const projection = this.currentProjection();
    const signature = this.currentProjectionSignature(projection);
    this.unsupportedPredicate = projection.unsupported;
    if (!this.draftInitialized || signature !== this.draftSourceSignature) this.replaceDraft(projection);
    this.seedDraftWhenFieldsArrive();
    this.draftSourceSignature = signature;
    this.draftInitialized = true;
  }

  protected override render() {
    const disabled = this.isUnavailable();
    return html`
      <form part="builder" @submit=${this.handleSubmit}>
        <fieldset ?disabled=${disabled}>
          <legend>Filter</legend>
          <div part="scope">${this.scopeLabel}</div>
          ${this.renderClauses()} ${this.renderAddCondition(disabled)} ${this.renderUnsupportedPredicate()}
          ${this.renderInheritedPredicate()} ${this.renderApplyButton(disabled)} ${this.renderValidationMessage()}
        </fieldset>
      </form>
      ${this.renderStatus()}
    `;
  }

  private shouldProjectDraft(changed: Map<string, unknown>): boolean {
    return DRAFT_SOURCE_PROPERTIES.some((property) => changed.has(property)) || !this.draftInitialized;
  }

  private currentProjection(): PredicateProjection {
    if (this.predicate !== undefined) return projectPredicate(this.predicate, 0, { nodes: 0 }, this.entity);
    return {
      clauses: this.clauses.map((clause) => ({ ...clause })),
      logical: this.logical === 'or' ? 'or' : 'and',
    };
  }

  private currentProjectionSignature(projection: PredicateProjection): string {
    if (this.predicate !== undefined) return predicateSourceSignature(this.predicate, projection, this.entity);
    return clausesSourceSignature(projection.clauses, projection.logical);
  }

  private replaceDraft(projection: PredicateProjection): void {
    this.clauseDrafts = projection.clauses.map((clause) => ({ ...clause }));
    this.logicalMode = projection.logical;
    this.draftInteracted = false;
  }

  private seedDraftWhenFieldsArrive(): void {
    if (this.clauseDrafts.length > 0 || this.fields.length === 0) return;
    if (this.unsupportedPredicate !== undefined || this.draftInteracted) return;
    this.clauseDrafts = [{ field: this.fields[0]!.id, operator: 'eq', value: '' }];
  }

  private isUnavailable(): boolean {
    return this.status === 'loading' || this.status === 'error' || this.status === 'unavailable';
  }

  private renderClauses() {
    return html`<div part="clauses">
      ${this.clauseDrafts.map((clause, index) => this.renderClause(clause, index))} ${this.renderLogicalControl()}
    </div>`;
  }

  private renderLogicalControl() {
    if (this.clauseDrafts.length <= 1) return nothing;
    return html`<label part="logical-label"
      >Match
      <select part="logical" .value=${this.logicalMode} @change=${this.handleLogicalChange}>
        <option value="and">All conditions</option>
        <option value="or">Any condition</option>
      </select>
    </label>`;
  }

  private renderAddCondition(disabled: boolean) {
    if (this.unsupportedPredicate !== undefined) return nothing;
    const atLimit = this.clauseDrafts.length >= MAX_MANUAL_CLAUSES;
    return html`<button
      part="add-condition"
      type="button"
      ?disabled=${disabled || this.fields.length === 0 || atLimit}
      @click=${this.handleAddCondition}
    >
      Add condition
    </button>`;
  }

  private renderUnsupportedPredicate() {
    if (this.unsupportedPredicate === undefined) return nothing;
    return html`<div part="unsupported-predicate" role="status">
      This filter contains a nested condition that is read-only: ${predicateText(this.unsupportedPredicate)}
    </div>`;
  }

  private renderInheritedPredicate() {
    if (this.inherited === undefined) return nothing;
    return html`<div part="inherited-predicate" role="status">
      Inherited filter (read-only): ${predicateText(this.inherited)}
    </div>`;
  }

  private renderApplyButton(disabled: boolean) {
    return html`<button part="apply" type="submit" ?disabled=${disabled || this.unsupportedPredicate !== undefined}>
      ${this.applyLabel}
    </button>`;
  }

  private renderValidationMessage() {
    if (this.validationMessage.length === 0) return nothing;
    return html`<p part="validation" role="alert">${this.validationMessage}</p>`;
  }

  private renderStatus() {
    if (this.status !== 'partial' && this.status !== 'stale') return nothing;
    return statusTemplate(this.status, this.message);
  }

  private renderClause(clause: AeliqoFilterClause, index: number) {
    return html`<div part="clause" data-clause-index=${index}>
      <label part="field-label"
        >Field ${index + 1}
        <select part="field" data-clause-index=${index} @change=${this.handleFieldChange}>
          <option value="" ?selected=${clause.field.length === 0}>Choose a field</option>
          ${this.fields.map((field) => html`<option value=${field.id} ?selected=${field.id === clause.field}>${field.label}</option>`)}
        </select>
      </label>
      <label part="operator-label"
        >Condition ${index + 1}
        <select
          part="operator"
          data-clause-index=${index}
          .value=${clause.operator}
          @change=${this.handleOperatorChange}
        >
          <option value="eq">Equals</option>
          <option value="ne">Does not equal</option>
          <option value="lt">Less than</option>
          <option value="lte">Less than or equal</option>
          <option value="gt">Greater than</option>
          <option value="gte">Greater than or equal</option>
          <option value="in">Is one of</option>
          <option value="is-null">Is empty</option>
          <option value="not-null">Is not empty</option>
        </select>
      </label>
      ${
        this.clauseNeedsValue(clause)
          ? html`<label part="value-label"
              >${clause.operator === 'in' ? 'Values (JSON array)' : 'Value'} ${index + 1}
              <input
                part="value"
                data-clause-index=${index}
                .value=${clause.value ?? ''}
                @input=${this.handleValueInput}
                @compositionend=${this.handleValueInput}
              />
            </label>`
          : nothing
      }
      <button
        part="remove-condition"
        type="button"
        data-clause-index=${index}
        aria-label=${`Remove condition ${index + 1}`}
        ?disabled=${this.isUnavailable() || this.clauseDrafts.length <= 1 || this.unsupportedPredicate !== undefined}
        @click=${this.handleRemoveCondition}
      >
        Remove
      </button>
    </div>`;
  }

  private clauseNeedsValue(clause: AeliqoFilterClause): boolean {
    return clause.operator !== 'is-null' && clause.operator !== 'not-null';
  }

  private clauseIndex(event: Event): number | undefined {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return undefined;
    const index = Number(target.dataset.clauseIndex);
    return Number.isSafeInteger(index) && index >= 0 && index < this.clauseDrafts.length ? index : undefined;
  }

  private updateClause(index: number, update: Partial<AeliqoFilterClause>): void {
    const clause = this.clauseDrafts[index];
    if (clause === undefined) return;
    this.clauseDrafts = this.clauseDrafts.map((candidate, position) =>
      position === index ? { ...candidate, ...update } : candidate,
    );
    this.draftInteracted = true;
    this.validationMessage = '';
    this.requestUpdate();
  }

  private readonly handleAddCondition = (): void => {
    if (
      this.fields.length === 0 ||
      this.unsupportedPredicate !== undefined ||
      this.isUnavailable() ||
      this.clauseDrafts.length >= MAX_MANUAL_CLAUSES
    )
      return;
    this.clauseDrafts = [...this.clauseDrafts, { field: this.fields[0]!.id, operator: 'eq', value: '' }];
    this.draftInteracted = true;
    this.validationMessage = '';
    this.requestUpdate();
  };

  private readonly handleRemoveCondition = (event: Event): void => {
    const index = this.clauseIndex(event);
    if (
      index === undefined ||
      this.clauseDrafts.length <= 1 ||
      this.unsupportedPredicate !== undefined ||
      this.isUnavailable()
    )
      return;
    this.clauseDrafts = this.clauseDrafts.filter((_, position) => position !== index);
    const focusIndex = Math.min(index, this.clauseDrafts.length - 1);
    this.draftInteracted = true;
    this.validationMessage = '';
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const field = [...this.renderRoot.querySelectorAll<HTMLSelectElement>('select[part="field"]')].find(
        (candidate) => Number(candidate.dataset.clauseIndex) === focusIndex,
      );
      (field ?? this.renderRoot.querySelector<HTMLButtonElement>('button[part="add-condition"]'))?.focus();
    });
    if (this.autoApply) this.apply();
  };

  private readonly handleFieldChange = (event: Event): void => {
    const target = event.currentTarget;
    const index = this.clauseIndex(event);
    if (!(target instanceof HTMLSelectElement) || index === undefined) return;
    this.updateClause(index, { field: target.value });
    if (this.autoApply) this.apply();
  };

  private readonly handleOperatorChange = (event: Event): void => {
    const target = event.currentTarget;
    const index = this.clauseIndex(event);
    if (!(target instanceof HTMLSelectElement) || index === undefined) return;
    const operator = target.value as AeliqoFilterOperator;
    this.updateClause(index, { operator });
    if (this.autoApply) this.apply();
  };

  private readonly handleValueInput = (event: Event): void => {
    const target = event.currentTarget;
    const index = this.clauseIndex(event);
    if (!(target instanceof HTMLInputElement) || index === undefined) return;
    this.updateClause(index, { value: target.value });
    // Deliberately no event/query here; only Apply commits the predicate.
  };

  private readonly handleLogicalChange = (event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    this.logicalMode = target.value === 'or' ? 'or' : 'and';
    this.validationMessage = '';
    this.requestUpdate();
  };

  private readonly handleSubmit = (event: Event): void => {
    event.preventDefault();
    this.apply();
  };

  private readonly apply = (): void => {
    if (this.unsupportedPredicate !== undefined) return;
    const local = this.buildPredicate();
    const checked = validateAeliqoPredicate(local);
    if (!checked.ok || local === undefined) {
      this.validationMessage = checked.ok ? 'Choose a valid filter.' : checked.message;
      this.requestUpdate();
      return;
    }
    this.validationMessage = '';
    const predicate = combineAeliqoPredicates(local, this.inherited);
    this.dispatchEvent(
      new AeliqoFilterChangeEvent({
        ...(predicate === undefined ? {} : { predicate }),
        ...(this.inherited === undefined ? {} : { inherited: this.inherited }),
        scopeLabel: this.scopeLabel,
        applied: true,
      }),
    );
  };

  private buildPredicate(): AeliqoFilterPredicate | undefined {
    const predicates = this.clauseDrafts.map((clause) =>
      buildAeliqoPredicate(
        clause,
        this.fields.find((field) => field.id === clause.field),
        this.entity,
      ),
    );
    if (predicates.some((predicate) => predicate === undefined)) return undefined;
    const valid = predicates as AeliqoFilterPredicate[];
    if (valid.length === 1) return valid[0];
    return { op: this.logicalMode, predicates: valid };
  }

  static readonly styles = [
    aeliqoThemeStyles,
    dataStyles,
    css`
      :host {
        min-inline-size: 0;
      }
      form {
        max-inline-size: 100%;
      }
      fieldset {
        border: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-8, 0.5rem);
        margin: 0;
        min-inline-size: 0;
        padding: 0;
      }
      legend {
        font-weight: var(--aeliqo-typography-font-weight-semibold, 600);
        padding: 0;
      }
      [part='clauses'] {
        display: grid;
        flex-basis: 100%;
        gap: var(--aeliqo-space-8, 0.5rem);
      }
      [part='clause'] {
        align-items: end;
        display: flex;
        flex-wrap: wrap;
        gap: var(--aeliqo-space-8, 0.5rem);
      }
      label {
        display: grid;
        gap: var(--aeliqo-space-4, 0.25rem);
        max-inline-size: 100%;
        min-inline-size: min(100%, 9rem);
      }
      [part='scope'] {
        color: var(--aeliqo-color-muted, #475569);
        flex-basis: 100%;
        font-size: var(--aeliqo-typography-font-size-caption, 0.8125rem);
      }
      [part='unsupported-predicate'],
      [part='inherited-predicate'] {
        background: var(--aeliqo-color-surface-muted, #f1f5f9);
        border-inline-start: 0.1875rem solid var(--aeliqo-color-warning, #b45309);
        flex-basis: 100%;
        padding: var(--aeliqo-space-8, 0.5rem);
      }
      select,
      input,
      [part='add-condition'],
      [part='remove-condition'],
      [part='apply'] {
        background: var(--aeliqo-color-surface, #fff);
        border: var(--aeliqo-control-border-width, 0.0625rem) solid var(--aeliqo-color-border, #94a3b8);
        border-radius: var(--aeliqo-radius-small, 0.375rem);
        color: inherit;
        font: inherit;
        min-block-size: var(--aeliqo-control-min-target, 2.75rem);
        padding-inline: var(--aeliqo-space-8, 0.5rem);
      }
      select,
      input {
        inline-size: 100%;
        min-inline-size: 0;
      }
      [part='add-condition'],
      [part='remove-condition'] {
        cursor: pointer;
      }
      [part='apply'] {
        align-self: end;
        background: var(--aeliqo-color-accent, #4338ca);
        border-color: var(--aeliqo-color-accent, #4338ca);
        color: var(--aeliqo-color-on-accent, #fff);
        cursor: pointer;
      }
      [part='validation'] {
        color: var(--aeliqo-color-danger, #b91c1c);
        flex-basis: 100%;
        margin: 0;
      }
      @media (forced-colors: active) {
        select,
        input,
        [part='add-condition'],
        [part='remove-condition'],
        [part='apply'] {
          background: Canvas;
          border-color: ButtonText;
          color: CanvasText;
        }
        [part='apply'] {
          background: Highlight;
          color: HighlightText;
        }
      }
    `,
  ];
}
