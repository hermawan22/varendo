import type { ValidatedPresentation } from '@varendo/core/presentation';
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { VarendoInputId } from '../input/manifest.js';
import { resolveInputInteraction, type VarendoInputEmit } from './input-interactions.js';

export { resolveInputInteraction } from './input-interactions.js';
export type { VarendoInputEmit } from './input-interactions.js';

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

function eventHandler(node: Node, emit: VarendoInputEmit): (event: Event) => void {
  return (event) => {
    for (const interaction of resolveInputInteraction(node, event)) emit(node, interaction.portId, interaction.payload);
  };
}

const INPUT_RENDERERS: Record<VarendoInputId, InputRenderer> = {
  'input.text-field': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-text-field
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-commit=${handle}
    ></varendo-text-field>`,
  'input.text-area': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-text-area
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .value=${text(values.value)}
      .defaultValue=${text(values.defaultValue)}
      .rows=${typeof values.rows === 'number' ? values.rows : 4}
      @varendo-input-commit=${handle}
    ></varendo-text-area>`,
  'input.number-field': ({ id, values, label, description, required, disabled, readOnly, name, handle, locale }) =>
    html`<varendo-number-field
      .locale=${locale}
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-commit=${handle}
    ></varendo-number-field>`,
  'input.checkbox': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-checkbox
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-change=${handle}
    ></varendo-checkbox>`,
  'input.radio-group': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-radio-group
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-change=${handle}
    ></varendo-radio-group>`,
  'input.switch': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-switch
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
      .label=${label}
      .description=${description}
      .required=${required}
      .disabled=${disabled}
      .readOnly=${readOnly}
      .name=${name}
      .checked=${bool(values.checked)}
      .defaultChecked=${bool(values.defaultChecked)}
      .value=${text(values.value, 'on')}
      @varendo-input-change=${handle}
    ></varendo-switch>`,
  'input.select': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-select
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-change=${handle}
    ></varendo-select>`,
  'input.combobox': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-combobox
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-change=${handle}
    ></varendo-combobox>`,
  'input.date-field': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-date-field
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-commit=${handle}
    ></varendo-date-field>`,
  'input.date-range': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-date-range
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-commit=${handle}
    ></varendo-date-range>`,
  'input.slider': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-slider
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-commit=${handle}
    ></varendo-slider>`,
  'input.search-field': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-search-field
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-input-commit=${handle}
      @varendo-search=${handle}
    ></varendo-search-field>`,
  'input.file-input': ({ id, values, label, description, required, disabled, readOnly, name, handle }) =>
    html`<varendo-file-input
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
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
      @varendo-file-change=${handle}
    ></varendo-file-input>`,
  'input.field-group': ({ id, values, childContent, description, disabled }) =>
    html`<varendo-field-group
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
      .legend=${text(values.legend)}
      .description=${description}
      .error=${text(values.error)}
      .disabled=${disabled}
      >${childContent()}</varendo-field-group
    >`,
  'input.form': ({ id, values, childContent, handle }) =>
    html`<varendo-form
      data-varendo-node-id=${id}
      data-varendo-theme="inherit"
      .label=${text(values.label)}
      .noValidate=${bool(values.noValidate)}
      @varendo-form-submit=${handle}
      >${childContent()}${text(values.submitLabel).length > 0 ? html`<button part="submit" type="submit">${text(values.submitLabel)}</button>` : nothing}</varendo-form
    >`,
};

function renderContext(node: Node, child: ChildRenderer, emit: VarendoInputEmit, locale: string): RenderContext {
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
  emit: VarendoInputEmit,
  locale = 'en-US',
): TemplateResult | typeof nothing | undefined {
  if (!Object.hasOwn(INPUT_RENDERERS, node.manifest.id)) return undefined;
  return INPUT_RENDERERS[node.manifest.id as VarendoInputId](renderContext(node, child, emit, locale));
}
