import {
  AeliqoCheckboxElement,
  AeliqoComboboxElement,
  AeliqoDateFieldElement,
  AeliqoDateRangeElement,
  AeliqoFieldGroupElement,
  AeliqoFileInputElement,
  AeliqoFormElement,
  AeliqoNumberFieldElement,
  AeliqoRadioGroupElement,
  AeliqoSearchFieldElement,
  AeliqoSelectElement,
  AeliqoSliderElement,
  AeliqoSwitchElement,
  AeliqoTextAreaElement,
  AeliqoTextFieldElement,
  type AeliqoOption,
} from '@varendo/web/inputs';
import { cleanupCatalogRoot, createCatalogElement, createCatalogRoot } from './fixture.js';
import { catalogMountSource, catalogSource } from './source.js';
import type { CatalogExampleDefinition, CatalogExampleId, CatalogExampleMetadata } from './types.js';

const sourceImports = `import {
  AeliqoCheckboxElement,
  AeliqoComboboxElement,
  AeliqoDateFieldElement,
  AeliqoDateRangeElement,
  AeliqoFieldGroupElement,
  AeliqoFileInputElement,
  AeliqoFormElement,
  AeliqoNumberFieldElement,
  AeliqoRadioGroupElement,
  AeliqoSearchFieldElement,
  AeliqoSelectElement,
  AeliqoSliderElement,
  AeliqoSwitchElement,
  AeliqoTextAreaElement,
  AeliqoTextFieldElement,
  type AeliqoOption,
} from "@varendo/web/inputs";`;

const sourceSetup = `const options: readonly AeliqoOption[] = [
  {value: "ada", label: "Ada Lovelace", description: "Research"},
  {value: "grace", label: "Grace Hopper", description: "Product"},
  {value: "lin", label: "Lin Chen", disabled: true},
];`;

type MetadataNotes = Pick<
  CatalogExampleMetadata,
  'fixture' | 'props' | 'propsNotes' | 'states' | 'keyboard' | 'events' | 'expectedOutcome'
>;
const componentNotes: Record<string, Partial<MetadataNotes>> = {
  'text-field': {
    fixture: 'One labelled display-name field with an initial value.',
    props: ['label', 'name', 'value', 'defaultValue', 'required', 'disabled', 'validationState', 'description'],
    propsNotes:
      'Set value for the current draft or defaultValue for its initial value; user input updates the local value and the host owns validation and persistence.',
    states: ['ready', 'disabled', 'read-only', 'invalid', 'pending'],
    keyboard: ['Tab', 'Type and edit', 'Enter commits where configured', 'IME composition'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    expectedOutcome: 'The labelled text draft is editable and emits typed change/commit proposals.',
  },
  'text-area': {
    fixture: 'One labelled multi-line notes field with four visible rows.',
    props: ['label', 'name', 'value', 'defaultValue', 'rows', 'required', 'disabled', 'validationState'],
    propsNotes:
      'Set the current or initial draft and observe changes; multiline input stays intact during IME composition.',
    states: ['ready', 'disabled', 'read-only', 'invalid', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Enter creates a line', 'IME composition'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    expectedOutcome: 'The notes draft preserves line breaks and emits changes without submitting implicitly.',
  },
  'number-field': {
    fixture: 'One currency amount field showing a locale-formatted exact value.',
    props: ['label', 'name', 'value', 'text', 'unit', 'locale', 'min', 'max', 'step'],
    propsNotes:
      'The host owns numeric meaning and validation; text is the draft representation and value is the committed representation.',
    states: ['ready', 'disabled', 'read-only', 'invalid', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Home and End where supported', 'IME composition'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    expectedOutcome: 'The amount remains precise while the user edits a locale-aware draft.',
  },
  checkbox: {
    fixture: 'One unchecked archive-inclusion checkbox with a stable form name.',
    props: ['label', 'name', 'value', 'checked', 'disabled', 'required'],
    propsNotes: 'checked is the boolean state; value is the submitted token chosen by the host.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Space'],
    events: ['aeliqo-input-change', 'aeliqo-validation'],
    expectedOutcome: 'The checkbox exposes its checked state and emits a typed boolean change.',
  },
  'radio-group': {
    fixture: 'One vertical owner choice with one disabled option.',
    props: ['label', 'name', 'options', 'value', 'orientation', 'required', 'disabled'],
    propsNotes: 'Option IDs remain stable; user selection updates the local value and emits a change for the host.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Space'],
    events: ['aeliqo-input-change', 'aeliqo-validation'],
    expectedOutcome: 'The group exposes one selected owner and keeps the disabled option discoverable.',
  },
  switch: {
    fixture: 'One enabled live-updates switch in the on state.',
    props: ['label', 'name', 'checked', 'disabled', 'required'],
    propsNotes: 'The switch communicates a boolean preference; the host decides whether to start live work.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Space'],
    events: ['aeliqo-input-change', 'aeliqo-validation'],
    expectedOutcome: 'The boolean preference is keyboard operable and emitted as a typed change proposal.',
  },
  select: {
    fixture: 'One closed team select with a bounded option list and placeholder label.',
    props: ['label', 'name', 'options', 'value', 'emptyLabel', 'required', 'disabled'],
    propsNotes: 'The host supplies the complete bounded options and controls selected value semantics.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Enter', 'Escape'],
    events: ['aeliqo-input-change', 'aeliqo-validation'],
    expectedOutcome: 'The selected team remains one of the supplied options and emits a typed change.',
  },
  combobox: {
    fixture: 'One open person combobox with a query draft and bounded options.',
    props: ['label', 'name', 'options', 'optionsLoader', 'value', 'query', 'open', 'minQueryLength', 'disabled'],
    propsNotes:
      'query is a draft separate from the selected value. Supply bounded options or a host-owned optionsLoader; stale loader results are cancelled and ignored.',
    states: ['ready', 'disabled', 'invalid', 'pending', 'error'],
    keyboard: ['Tab', 'Arrow keys', 'Enter', 'Escape', 'IME composition'],
    events: ['aeliqo-input-change', 'aeliqo-combobox-query', 'aeliqo-validation'],
    expectedOutcome: 'The query and selected identity remain distinct while the list stays bounded.',
  },
  'date-field': {
    fixture: 'One report date field constrained to the 2026 calendar year.',
    props: ['label', 'name', 'value', 'min', 'max', 'calendar', 'required', 'disabled'],
    propsNotes: 'Dates are calendar values with explicit bounds; the host decides any timezone or query meaning.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Enter', 'IME composition'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    expectedOutcome: 'The date draft stays within declared calendar bounds and emits typed changes.',
  },
  'date-range': {
    fixture: 'One inclusive September reporting range in the calendar timezone.',
    props: ['label', 'name', 'start', 'end', 'boundary', 'timezone', 'required', 'disabled'],
    propsNotes:
      'Start and end are explicit values; boundary and timezone are part of the meaning, not display decoration.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Enter', 'IME composition'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    expectedOutcome: 'The range preserves ordering and boundary semantics while emitting a typed range proposal.',
  },
  slider: {
    fixture: 'One confidence slider at 75 percent with five-point increments.',
    props: ['label', 'name', 'min', 'max', 'step', 'value', 'unit', 'disabled'],
    propsNotes: 'The host supplies numerical bounds and unit; each change is a proposal for host state.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Arrow keys', 'Page Up and Page Down', 'Home and End'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    expectedOutcome: 'The value remains on the declared step grid and is announced with its unit.',
  },
  'search-field': {
    fixture: 'One report search field with a debounced query-on-input policy.',
    props: ['label', 'name', 'value', 'queryOnInput', 'debounceMs', 'placeholder', 'disabled'],
    propsNotes: 'The component emits a query proposal; the host decides whether and how to execute it.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Type and edit', 'Enter', 'Escape', 'IME composition'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-search', 'aeliqo-validation'],
    expectedOutcome: 'The query draft is editable and emits bounded search proposals without owning data access.',
  },
  'file-input': {
    fixture: 'One single CSV evidence input with a two-megabyte host limit.',
    props: ['label', 'name', 'accept', 'multiple', 'maxFiles', 'maxBytes', 'disabled', 'required'],
    propsNotes: 'Only file metadata crosses the component boundary; the host owns upload and persistence.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab', 'Enter', 'Space'],
    events: ['aeliqo-file-change', 'aeliqo-validation'],
    expectedOutcome: 'The user can choose bounded file metadata without an implicit upload.',
  },
  'field-group': {
    fixture: 'One legend and description wrapping a preferred-name field.',
    props: ['legend', 'description', 'error', 'disabled'],
    propsNotes: 'The group supplies shared semantics; child controls own their values and events.',
    states: ['ready', 'disabled', 'invalid'],
    keyboard: ['Tab follows child field order', 'IME composition in child fields'],
    events: ['Child field events bubble', 'No group-owned value event'],
    expectedOutcome: 'The grouped field exposes one coherent legend and preserves child control semantics.',
  },
  form: {
    fixture: 'One host-owned form containing a required filter and submit button.',
    props: ['label', 'novalidate', 'disabled'],
    propsNotes:
      'The form coordinates validation and emits a submit proposal; persistence and navigation remain with the host.',
    states: ['ready', 'disabled', 'invalid', 'pending'],
    keyboard: ['Tab follows form order', 'Enter submits when valid', 'Escape preserves draft'],
    events: ['aeliqo-form-submit', 'aeliqo-form-reset', 'aeliqo-validation'],
    expectedOutcome:
      'The form reports validity and emits a cancellable submit/reset request without executing business effects.',
  },
};

const options: readonly AeliqoOption[] = [
  { value: 'ada', label: 'Ada Lovelace', description: 'Research' },
  { value: 'grace', label: 'Grace Hopper', description: 'Product' },
  { value: 'lin', label: 'Lin Chen', disabled: true },
];

const mount = (id: CatalogExampleId, fn: (root: HTMLElement) => void): CatalogExampleDefinition => ({
  metadata: {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    family: 'input',
    description: 'A native-first form control with explicit value, validation, and draft semantics.',
    fixture:
      'A standalone control mounted into a host-owned form surface; no agent, Studio, or remote data is required.',
    props: ['label', 'name', 'value', 'required', 'disabled', 'validationState'],
    propsNotes:
      'Value and draft props are explicit; the host remains responsible for validation authority and submit effects.',
    states: ['ready', 'disabled', 'read-only', 'invalid', 'pending'],
    keyboard: ['Tab', 'native control keys', 'Enter commits where applicable', 'IME composition is preserved'],
    events: ['aeliqo-input-change', 'aeliqo-input-commit', 'aeliqo-validation'],
    expectedOutcome:
      'The control renders with an explicit label and leaves authoritative validation and submission with the host.',
    ...componentNotes[id],
    source: catalogSource({ imports: sourceImports, setup: sourceSetup, mount: catalogMountSource(id) }),
  },
  mount(container) {
    const root = createCatalogRoot(container);
    fn(root);
    return cleanupCatalogRoot(root);
  },
});

export const inputExamples: readonly CatalogExampleDefinition[] = [
  mount('text-field', (root) => {
    const element = createCatalogElement<AeliqoTextFieldElement>('aeliqo-text-field', root, AeliqoTextFieldElement);
    element.label = 'Display name';
    element.name = 'displayName';
    element.value = 'Ada Lovelace';
    element.description = 'Used in the report header.';
    element.autocomplete = 'name';
  }),
  mount('text-area', (root) => {
    const element = createCatalogElement<AeliqoTextAreaElement>('aeliqo-text-area', root, AeliqoTextAreaElement);
    element.label = 'Notes';
    element.name = 'notes';
    element.defaultValue = 'Draft notes';
    element.rows = 4;
    element.spellcheck = true;
  }),
  mount('number-field', (root) => {
    const element = createCatalogElement<AeliqoNumberFieldElement>(
      'aeliqo-number-field',
      root,
      AeliqoNumberFieldElement,
    );
    element.label = 'Amount';
    element.name = 'amount';
    element.locale = 'en-US';
    element.text = '1,234.50';
    element.value = '1234.50';
    element.unit = 'USD';
    element.min = '0';
  }),
  mount('checkbox', (root) => {
    const element = createCatalogElement<AeliqoCheckboxElement>('aeliqo-checkbox', root, AeliqoCheckboxElement);
    element.label = 'Include archived records';
    element.name = 'includeArchived';
    element.value = 'yes';
    element.checked = false;
  }),
  mount('radio-group', (root) => {
    const element = createCatalogElement<AeliqoRadioGroupElement>('aeliqo-radio-group', root, AeliqoRadioGroupElement);
    element.label = 'Report owner';
    element.name = 'owner';
    element.options = options;
    element.value = 'ada';
    element.orientation = 'vertical';
  }),
  mount('switch', (root) => {
    const element = createCatalogElement<AeliqoSwitchElement>('aeliqo-switch', root, AeliqoSwitchElement);
    element.label = 'Live updates';
    element.name = 'live';
    element.checked = true;
  }),
  mount('select', (root) => {
    const element = createCatalogElement<AeliqoSelectElement>('aeliqo-select', root, AeliqoSelectElement);
    element.label = 'Team';
    element.name = 'team';
    element.options = [
      { value: 'research', label: 'Research' },
      { value: 'product', label: 'Product' },
    ];
    element.value = 'research';
    element.emptyLabel = 'Choose a team';
  }),
  mount('combobox', (root) => {
    const element = createCatalogElement<AeliqoComboboxElement>('aeliqo-combobox', root, AeliqoComboboxElement);
    element.label = 'Person';
    element.name = 'person';
    element.options = options;
    element.value = 'ada';
    element.query = 'Ada';
    element.open = true;
    element.minQueryLength = 1;
  }),
  mount('date-field', (root) => {
    const element = createCatalogElement<AeliqoDateFieldElement>('aeliqo-date-field', root, AeliqoDateFieldElement);
    element.label = 'Report date';
    element.name = 'reportDate';
    element.value = '2026-09-09';
    element.min = '2026-01-01';
    element.max = '2026-12-31';
    element.calendar = 'gregory';
  }),
  mount('date-range', (root) => {
    const element = createCatalogElement<AeliqoDateRangeElement>('aeliqo-date-range', root, AeliqoDateRangeElement);
    element.label = 'Reporting period';
    element.name = 'period';
    element.start = '2026-09-01';
    element.end = '2026-09-30';
    element.boundary = 'inclusive';
    element.timezone = 'calendar';
  }),
  mount('slider', (root) => {
    const element = createCatalogElement<AeliqoSliderElement>('aeliqo-slider', root, AeliqoSliderElement);
    element.label = 'Confidence';
    element.name = 'confidence';
    element.min = 0;
    element.max = 100;
    element.step = 5;
    element.value = 75;
    element.unit = '%';
  }),
  mount('search-field', (root) => {
    const element = createCatalogElement<AeliqoSearchFieldElement>(
      'aeliqo-search-field',
      root,
      AeliqoSearchFieldElement,
    );
    element.label = 'Search reports';
    element.name = 'query';
    element.value = 'retention';
    element.queryOnInput = true;
    element.debounceMs = 150;
    element.placeholder = 'Search by name';
  }),
  mount('file-input', (root) => {
    const element = createCatalogElement<AeliqoFileInputElement>('aeliqo-file-input', root, AeliqoFileInputElement);
    element.label = 'Evidence file';
    element.name = 'evidence';
    element.accept = '.csv,text/csv';
    element.multiple = false;
    element.maxFiles = 1;
    element.maxBytes = 2_000_000;
  }),
  mount('field-group', (root) => {
    const group = createCatalogElement<AeliqoFieldGroupElement>('aeliqo-field-group', root, AeliqoFieldGroupElement);
    group.legend = 'Profile details';
    group.description = 'All fields are validated together.';
    const field = document.createElement('aeliqo-text-field') as AeliqoTextFieldElement;
    field.label = 'Preferred name';
    field.name = 'preferredName';
    group.append(field);
  }),
  mount('form', (root) => {
    const form = createCatalogElement<AeliqoFormElement>('aeliqo-form', root, AeliqoFormElement);
    form.label = 'Report filters';
    const field = document.createElement('aeliqo-text-field') as AeliqoTextFieldElement;
    field.label = 'Required filter';
    field.name = 'filter';
    field.required = true;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Apply';
    form.append(field, submit);
  }),
];
