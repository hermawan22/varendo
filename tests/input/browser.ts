import {
  VarendoCheckboxElement,
  VarendoComboboxElement,
  VarendoDateFieldElement,
  VarendoDateRangeElement,
  VarendoFieldGroupElement,
  VarendoFileInputElement,
  VarendoFormElement,
  VarendoNumberFieldElement,
  VarendoRadioGroupElement,
  VarendoSearchFieldElement,
  VarendoSelectElement,
  VarendoSliderElement,
  VarendoSwitchElement,
  VarendoTextAreaElement,
  VarendoTextFieldElement,
  type VarendoOption,
} from '../../packages/web/src/input/index.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['varendo-text-field', VarendoTextFieldElement],
  ['varendo-text-area', VarendoTextAreaElement],
  ['varendo-number-field', VarendoNumberFieldElement],
  ['varendo-checkbox', VarendoCheckboxElement],
  ['varendo-radio-group', VarendoRadioGroupElement],
  ['varendo-switch', VarendoSwitchElement],
  ['varendo-select', VarendoSelectElement],
  ['varendo-combobox', VarendoComboboxElement],
  ['varendo-date-field', VarendoDateFieldElement],
  ['varendo-date-range', VarendoDateRangeElement],
  ['varendo-slider', VarendoSliderElement],
  ['varendo-search-field', VarendoSearchFieldElement],
  ['varendo-file-input', VarendoFileInputElement],
  ['varendo-field-group', VarendoFieldGroupElement],
  ['varendo-form', VarendoFormElement],
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Input fixture root is missing.');

const nativeForm = document.createElement('form');
nativeForm.id = 'native-form';
nativeForm.innerHTML = `
  <varendo-text-field id="name" label="Name" name="person" value="Ada" description="Full name"></varendo-text-field>
  <varendo-text-area id="notes" label="Notes" name="notes" default-value="Draft"></varendo-text-area>
  <varendo-number-field id="amount" label="Amount" name="amount" locale="de-DE" text="1.234,50" value="1234.50" unit="EUR"></varendo-number-field>
  <varendo-checkbox id="agree" label="Agree" name="agree" value="yes"></varendo-checkbox>
  <varendo-select id="country" label="Country" name="country"></varendo-select>
  <button type="reset">Reset</button>`;
fixture.append(nativeForm);

const country = nativeForm.querySelector<VarendoSelectElement>('#country');
if (country === null) throw new Error('Select fixture missing.');
country.options = [
  { value: 'id', label: 'Indonesia' },
  { value: 'us', label: 'United States' },
];
country.value = 'id';

const choices = document.createElement('div');
choices.id = 'choices';
choices.innerHTML = `
  <varendo-radio-group id="radio" label="Role"></varendo-radio-group>
  <varendo-switch id="switch" label="Notifications"></varendo-switch>
  <varendo-combobox id="combo" label="Person"></varendo-combobox>
  <varendo-date-field id="date" label="Date"></varendo-date-field>
  <varendo-date-range id="range" label="Period"></varendo-date-range>
  <varendo-slider id="slider" label="Progress"></varendo-slider>
  <varendo-search-field id="search" label="Search"></varendo-search-field>
  <varendo-file-input id="file" label="Attachment"></varendo-file-input>`;
fixture.append(choices);

const radio = choices.querySelector<VarendoRadioGroupElement>('#radio');
const combo = choices.querySelector<VarendoComboboxElement>('#combo');
const date = choices.querySelector<VarendoDateFieldElement>('#date');
const range = choices.querySelector<VarendoDateRangeElement>('#range');
const slider = choices.querySelector<VarendoSliderElement>('#slider');
const search = choices.querySelector<VarendoSearchFieldElement>('#search');
if (radio === null || combo === null || date === null || range === null || slider === null || search === null)
  throw new Error('Choice fixture missing.');
const options: readonly VarendoOption[] = [
  { value: 'ada', label: 'Ada Lovelace', description: 'Engineer' },
  { value: 'grace', label: 'Grace Hopper', description: 'Admiral' },
];
radio.options = options;
radio.value = 'ada';
combo.options = options;
date.value = '2026-09-08';
range.start = '2026-09-01';
range.end = '2026-09-08';
slider.min = 0;
slider.max = 100;
slider.value = 40;
search.queryOnInput = true;
search.debounceMs = 30;

const group = document.createElement('varendo-field-group') as VarendoFieldGroupElement;
group.id = 'group';
group.legend = 'Profile';
group.description = 'Fields are validated together.';
const groupedField = document.createElement('varendo-text-field');
groupedField.setAttribute('label', 'Profile name');
group.append(groupedField);
fixture.append(group);

const appForm = document.createElement('varendo-form') as VarendoFormElement;
appForm.id = 'app-form';
const appField = document.createElement('varendo-text-field') as VarendoTextFieldElement;
appField.label = 'Required app field';
appField.name = 'app-field';
appField.required = true;
appForm.append(appField);
appForm.addEventListener('varendo-form-submit', () => {
  (window as Window & { varendoInputSubmitted?: boolean }).varendoInputSubmitted = true;
});
fixture.append(appForm);

Object.assign(window, {
  varendoInputReady: true,
  varendoInputFixture: { nativeForm, country, radio, combo, date, range, slider, search, appForm },
});
