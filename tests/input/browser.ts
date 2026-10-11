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
} from '../../packages/web/src/input/index.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['aeliqo-text-field', AeliqoTextFieldElement],
  ['aeliqo-text-area', AeliqoTextAreaElement],
  ['aeliqo-number-field', AeliqoNumberFieldElement],
  ['aeliqo-checkbox', AeliqoCheckboxElement],
  ['aeliqo-radio-group', AeliqoRadioGroupElement],
  ['aeliqo-switch', AeliqoSwitchElement],
  ['aeliqo-select', AeliqoSelectElement],
  ['aeliqo-combobox', AeliqoComboboxElement],
  ['aeliqo-date-field', AeliqoDateFieldElement],
  ['aeliqo-date-range', AeliqoDateRangeElement],
  ['aeliqo-slider', AeliqoSliderElement],
  ['aeliqo-search-field', AeliqoSearchFieldElement],
  ['aeliqo-file-input', AeliqoFileInputElement],
  ['aeliqo-field-group', AeliqoFieldGroupElement],
  ['aeliqo-form', AeliqoFormElement],
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Input fixture root is missing.');

const nativeForm = document.createElement('form');
nativeForm.id = 'native-form';
nativeForm.innerHTML = `
  <aeliqo-text-field id="name" label="Name" name="person" value="Ada" description="Full name"></aeliqo-text-field>
  <aeliqo-text-area id="notes" label="Notes" name="notes" default-value="Draft"></aeliqo-text-area>
  <aeliqo-number-field id="amount" label="Amount" name="amount" locale="de-DE" text="1.234,50" value="1234.50" unit="EUR"></aeliqo-number-field>
  <aeliqo-checkbox id="agree" label="Agree" name="agree" value="yes"></aeliqo-checkbox>
  <aeliqo-select id="country" label="Country" name="country"></aeliqo-select>
  <button type="reset">Reset</button>`;
fixture.append(nativeForm);

const country = nativeForm.querySelector<AeliqoSelectElement>('#country');
if (country === null) throw new Error('Select fixture missing.');
country.options = [
  { value: 'id', label: 'Indonesia' },
  { value: 'us', label: 'United States' },
];
country.value = 'id';

const choices = document.createElement('div');
choices.id = 'choices';
choices.innerHTML = `
  <aeliqo-radio-group id="radio" label="Role"></aeliqo-radio-group>
  <aeliqo-switch id="switch" label="Notifications"></aeliqo-switch>
  <aeliqo-combobox id="combo" label="Person"></aeliqo-combobox>
  <aeliqo-date-field id="date" label="Date"></aeliqo-date-field>
  <aeliqo-date-range id="range" label="Period"></aeliqo-date-range>
  <aeliqo-slider id="slider" label="Progress"></aeliqo-slider>
  <aeliqo-search-field id="search" label="Search"></aeliqo-search-field>
  <aeliqo-file-input id="file" label="Attachment"></aeliqo-file-input>`;
fixture.append(choices);

const radio = choices.querySelector<AeliqoRadioGroupElement>('#radio');
const combo = choices.querySelector<AeliqoComboboxElement>('#combo');
const date = choices.querySelector<AeliqoDateFieldElement>('#date');
const range = choices.querySelector<AeliqoDateRangeElement>('#range');
const slider = choices.querySelector<AeliqoSliderElement>('#slider');
const search = choices.querySelector<AeliqoSearchFieldElement>('#search');
if (radio === null || combo === null || date === null || range === null || slider === null || search === null)
  throw new Error('Choice fixture missing.');
const options: readonly AeliqoOption[] = [
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

const group = document.createElement('aeliqo-field-group') as AeliqoFieldGroupElement;
group.id = 'group';
group.legend = 'Profile';
group.description = 'Fields are validated together.';
const groupedField = document.createElement('aeliqo-text-field');
groupedField.setAttribute('label', 'Profile name');
group.append(groupedField);
fixture.append(group);

const appForm = document.createElement('aeliqo-form') as AeliqoFormElement;
appForm.id = 'app-form';
const appField = document.createElement('aeliqo-text-field') as AeliqoTextFieldElement;
appField.label = 'Required app field';
appField.name = 'app-field';
appField.required = true;
appForm.append(appField);
appForm.addEventListener('aeliqo-form-submit', () => {
  (window as Window & { aeliqoInputSubmitted?: boolean }).aeliqoInputSubmitted = true;
});
fixture.append(appForm);

Object.assign(window, {
  aeliqoInputReady: true,
  aeliqoInputFixture: { nativeForm, country, radio, combo, date, range, slider, search, appForm },
});
