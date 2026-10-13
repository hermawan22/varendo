import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  VarendoTextFieldElement,
  VarendoTextAreaElement,
  VarendoNumberFieldElement,
  VarendoCheckboxElement,
  VarendoRadioGroupElement,
  VarendoSwitchElement,
  VarendoSelectElement,
  VarendoComboboxElement,
  VarendoDateFieldElement,
  VarendoDateRangeElement,
  VarendoSliderElement,
  VarendoSearchFieldElement,
  VarendoFileInputElement,
  VarendoFieldGroupElement,
  VarendoFormElement,
  type VarendoComboboxQueryEvent,
  type VarendoInputChangeEvent,
  type VarendoInputCommitEvent,
  type VarendoValidationEvent,
  type VarendoSearchEvent,
  type VarendoFileChangeEvent,
  type VarendoFormSubmitEvent,
  type VarendoFormResetEvent,
  type VarendoNumberChange,
  type VarendoDateRangeValue,
  type VarendoSliderValue,
} from '@varendo/web/inputs';

export const VarendoTextField = createComponent({
  react: React,
  tagName: 'varendo-text-field',
  elementClass: VarendoTextFieldElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<string>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
    onValueCommit: 'varendo-input-commit' as EventName<VarendoInputCommitEvent<string>>,
  },
  displayName: 'VarendoTextField',
});
export const VarendoTextArea = createComponent({
  react: React,
  tagName: 'varendo-text-area',
  elementClass: VarendoTextAreaElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<string>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
    onValueCommit: 'varendo-input-commit' as EventName<VarendoInputCommitEvent<string>>,
  },
  displayName: 'VarendoTextArea',
});
export const VarendoNumberField = createComponent({
  react: React,
  tagName: 'varendo-number-field',
  elementClass: VarendoNumberFieldElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<VarendoNumberChange>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
    onValueCommit: 'varendo-input-commit' as EventName<VarendoInputCommitEvent<VarendoNumberChange>>,
  },
  displayName: 'VarendoNumberField',
});
export const VarendoCheckbox = createComponent({
  react: React,
  tagName: 'varendo-checkbox',
  elementClass: VarendoCheckboxElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<boolean>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
  },
  displayName: 'VarendoCheckbox',
});
export const VarendoRadioGroup = createComponent({
  react: React,
  tagName: 'varendo-radio-group',
  elementClass: VarendoRadioGroupElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<string>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
  },
  displayName: 'VarendoRadioGroup',
});
export const VarendoSwitch = createComponent({
  react: React,
  tagName: 'varendo-switch',
  elementClass: VarendoSwitchElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<boolean>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
  },
  displayName: 'VarendoSwitch',
});
export const VarendoSelect = createComponent({
  react: React,
  tagName: 'varendo-select',
  elementClass: VarendoSelectElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<string>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
  },
  displayName: 'VarendoSelect',
});
export const VarendoCombobox = createComponent({
  react: React,
  tagName: 'varendo-combobox',
  elementClass: VarendoComboboxElement,
  events: {
    onQueryChange: 'varendo-combobox-query' as EventName<VarendoComboboxQueryEvent>,
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<string>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
  },
  displayName: 'VarendoCombobox',
});
export const VarendoDateField = createComponent({
  react: React,
  tagName: 'varendo-date-field',
  elementClass: VarendoDateFieldElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<string>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
    onValueCommit: 'varendo-input-commit' as EventName<VarendoInputCommitEvent<string>>,
  },
  displayName: 'VarendoDateField',
});
export const VarendoDateRange = createComponent({
  react: React,
  tagName: 'varendo-date-range',
  elementClass: VarendoDateRangeElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<VarendoDateRangeValue>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
    onValueCommit: 'varendo-input-commit' as EventName<VarendoInputCommitEvent<VarendoDateRangeValue>>,
  },
  displayName: 'VarendoDateRange',
});
export const VarendoSlider = createComponent({
  react: React,
  tagName: 'varendo-slider',
  elementClass: VarendoSliderElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<VarendoSliderValue>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
    onValueCommit: 'varendo-input-commit' as EventName<VarendoInputCommitEvent<VarendoSliderValue>>,
  },
  displayName: 'VarendoSlider',
});
export const VarendoSearchField = createComponent({
  react: React,
  tagName: 'varendo-search-field',
  elementClass: VarendoSearchFieldElement,
  events: {
    onValueChange: 'varendo-input-change' as EventName<VarendoInputChangeEvent<string>>,
    onValidation: 'varendo-validation' as EventName<VarendoValidationEvent>,
    onValueCommit: 'varendo-input-commit' as EventName<VarendoInputCommitEvent<string>>,
    onSearch: 'varendo-search' as EventName<VarendoSearchEvent>,
  },
  displayName: 'VarendoSearchField',
});
export const VarendoFileInput = createComponent({
  react: React,
  tagName: 'varendo-file-input',
  elementClass: VarendoFileInputElement,
  events: { onFilesChange: 'varendo-file-change' as EventName<VarendoFileChangeEvent> },
  displayName: 'VarendoFileInput',
});
export const VarendoFieldGroup = createComponent({
  react: React,
  tagName: 'varendo-field-group',
  elementClass: VarendoFieldGroupElement,
  displayName: 'VarendoFieldGroup',
});
export const VarendoForm = createComponent({
  react: React,
  tagName: 'varendo-form',
  elementClass: VarendoFormElement,
  events: {
    onSubmit: 'varendo-form-submit' as EventName<VarendoFormSubmitEvent>,
    onReset: 'varendo-form-reset' as EventName<VarendoFormResetEvent>,
  },
  displayName: 'VarendoForm',
});
