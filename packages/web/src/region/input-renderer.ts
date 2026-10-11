import type { ValidatedPresentation } from '@varendo/core/presentation';
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { AeliqoInputId } from '../input/manifest.js';
import { resolveInputInteraction, type AeliqoInputEmit } from './input-interactions.js';

export { resolveInputInteraction } from './input-interactions.js';
export type { AeliqoInputEmit } from './input-interactions.js';

type Node = ValidatedPresentation['nodes'][number];
type ChildRenderer = (nodeId: string) => unknown;

interface RenderContext {
  readonly id: string;
  readonly values: Record<string, unknown>;
  readonly childContent: () => unknown;
  readonly handle: (event: Event) => void;
  readonly locale: string;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly name: string;
}

type InputRenderer = (context: RenderContext) => TemplateResult;

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown): boolean => value === true;

function eventHandler(node: Node, emit: AeliqoInputEmit): (event: Event) => void {
  return (event) => {
    for (const interaction of resolveInputInteraction(node, event)) emit(node, interaction.portId, interaction.payload);
  };
}

const INPUT_RENDERERS: Record<AeliqoInputId, InputRenderer> = {
  'input.text-field': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-text-field
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .placeholder=${text(values.placeholder)}
      .autocomplete=${text(values.autocomplete)}
      .inputType=${text(values.inputType, 'text')}
      @aeliqo-input-commit=${handle}
    ></aeliqo-text-field>`,
  'input.text-area': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-text-area
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .rows=${typeof values.rows === 'number' ? values.rows : 4}
      @aeliqo-input-commit=${handle}
    ></aeliqo-text-area>`,
  'input.number-field': ({ id, values, label, description, required, disabled, readOnly, name, handle, locale }) =>
    html`<aeliqo-number-field
      .locale=${locale}
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .value=${typeof values.value === 'string' ? values.value : undefined}
      .defaultValue=${text(values.defaultValue)}
      .min=${text(values.min)}
      .max=${text(values.max)}
      .step=${text(values.step)}
      .unit=${text(values.unit)}
      @aeliqo-input-commit=${handle}
    ></aeliqo-number-field>`,
  'input.checkbox': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-checkbox
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .checked=${bool(values.checked)}
      .defaultChecked=${bool(values.defaultChecked)}
      .indeterminate=${bool(values.indeterminate)}
      .value=${text(values.value, 'on')}
      @aeliqo-input-change=${handle}
    ></aeliqo-checkbox>`,
  'input.radio-group': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-radio-group
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .options=${Array.isArray(values.options) ? values.options : []}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .orientation=${values.orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      @aeliqo-input-change=${handle}
    ></aeliqo-radio-group>`,
  'input.switch': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-switch
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .checked=${bool(values.checked)}
      .defaultChecked=${bool(values.defaultChecked)}
      .value=${text(values.value, 'on')}
      @aeliqo-input-change=${handle}
    ></aeliqo-switch>`,
  'input.select': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-select
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .options=${Array.isArray(values.options) ? values.options : []}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .emptyLabel=${text(values.emptyLabel, 'Select an option')}
      @aeliqo-input-change=${handle}
    ></aeliqo-select>`,
  'input.combobox': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-combobox
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .options=${Array.isArray(values.options) ? values.options : []}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .query=${text(values.query)}
      .minQueryLength=${typeof values.minQueryLength === 'number' ? values.minQueryLength : 0}
      .placeholder=${text(values.placeholder)}
      @aeliqo-input-change=${handle}
    ></aeliqo-combobox>`,
  'input.date-field': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-date-field
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .min=${text(values.min)}
      .max=${text(values.max)}
      .calendar=${'gregory'}
      @aeliqo-input-commit=${handle}
    ></aeliqo-date-field>`,
  'input.date-range': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-date-range
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .start=${text(values.start)}
      .end=${text(values.end)}
      .defaultStart=${text(values.defaultStart)}
      .defaultEnd=${text(values.defaultEnd)}
      .boundary=${values.boundary === 'exclusive' ? 'exclusive' : 'inclusive'}
      .timezone="calendar"
      .calendar="gregory"
      @aeliqo-input-commit=${handle}
    ></aeliqo-date-range>`,
  'input.slider': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-slider
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .value=${typeof values.value === 'number' ? values.value : 0}
      .defaultValue=${typeof values.defaultValue === 'number' ? values.defaultValue : 0}
      .min=${typeof values.min === 'number' ? values.min : 0}
      .max=${typeof values.max === 'number' ? values.max : 100}
      .step=${typeof values.step === 'number' ? values.step : 1}
      .unit=${text(values.unit)}
      @aeliqo-input-commit=${handle}
    ></aeliqo-slider>`,
  'input.search-field': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-search-field
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .placeholder=${text(values.placeholder)}
      .autocomplete=${text(values.autocomplete)}
      .queryOnInput=${bool(values.queryOnInput)}
      .debounceMs=${typeof values.debounceMs === 'number' ? values.debounceMs : 250}
      @aeliqo-input-commit=${handle}
      @aeliqo-search=${handle}
    ></aeliqo-search-field>`,
  'input.file-input': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<aeliqo-file-input
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .accept=${text(values.accept)}
      .multiple=${bool(values.multiple)}
      .capture=${text(values.capture)}
      .maxFiles=${typeof values.maxFiles === 'number' ? values.maxFiles : 0}
      .maxBytes=${typeof values.maxBytes === 'number' ? values.maxBytes : 0}
      @aeliqo-file-change=${handle}
    ></aeliqo-file-input>`,
  'input.field-group': ({ id, values, childContent, description, disabled }) =>
    html`<aeliqo-field-group
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .legend=${text(values.legend)}
      .description=${description}
      .error=${text(values.error)}
      .disabled=${disabled}
      >${childContent()}</aeliqo-field-group
    >`,
  'input.form': ({ id, values, childContent, handle }) =>
    html`<aeliqo-form
      data-aeliqo-node-id=${id}
      data-aeliqo-theme="inherit"
      .label=${text(values.label)}
      .noValidate=${bool(values.noValidate)}
      @aeliqo-form-submit=${handle}
      >${childContent()}${text(values.submitLabel).length > 0 ? html`<button part="submit" type="submit">${text(values.submitLabel)}</button>` : nothing}</aeliqo-form
    >`,
};

function renderContext(node: Node, child: ChildRenderer, emit: AeliqoInputEmit, locale: string): RenderContext {
  const values = node.config.values as Record<string, unknown>;
  return {
    id: node.node.id,
    values,
    childContent: () =>
      repeat(
        node.node.children,
        (id) => id,
        (id) => child(id),
      ),
    handle: eventHandler(node, emit),
    locale,
    label: text(values.label),
    description: text(values.description),
    required: bool(values.required),
    disabled: bool(values.disabled),
    readOnly: bool(values.readOnly),
    name: text(values.name),
  };
}

/** Render one of the registered input primitives. Tags and event names are fixed by this adapter. */
export function renderInputNode(
  node: Node,
  child: ChildRenderer,
  emit: AeliqoInputEmit,
  locale = 'en-US',
): TemplateResult | typeof nothing | undefined {
  if (!Object.hasOwn(INPUT_RENDERERS, node.manifest.id)) return undefined;
  return INPUT_RENDERERS[node.manifest.id as AeliqoInputId](renderContext(node, child, emit, locale));
}
