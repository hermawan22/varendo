import React from 'react';
import { createComponent, type EventName } from '@lit/react';
import {
  AeliqoTextFieldElement,
  AeliqoTextAreaElement,
  AeliqoNumberFieldElement,
  AeliqoCheckboxElement,
  AeliqoRadioGroupElement,
  AeliqoSwitchElement,
  AeliqoSelectElement,
  AeliqoComboboxElement,
  AeliqoDateFieldElement,
  AeliqoDateRangeElement,
  AeliqoSliderElement,
  AeliqoSearchFieldElement,
  AeliqoFileInputElement,
  AeliqoFieldGroupElement,
  AeliqoFormElement,
  type AeliqoComboboxQueryEvent,
  type AeliqoInputChangeEvent,
  type AeliqoInputCommitEvent,
  type AeliqoValidationEvent,
  type AeliqoSearchEvent,
  type AeliqoFileChangeEvent,
  type AeliqoFormSubmitEvent,
  type AeliqoFormResetEvent,
  type AeliqoNumberChange,
  type AeliqoDateRangeValue,
  type AeliqoSliderValue,
} from '@varendo/web/inputs';

export const AeliqoTextField = createComponent({
  react: React,
  tagName: 'aeliqo-text-field',
  elementClass: AeliqoTextFieldElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<string>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
    onValueCommit: 'aeliqo-input-commit' as EventName<AeliqoInputCommitEvent<string>>,
  },
  displayName: 'AeliqoTextField',
});
export const AeliqoTextArea = createComponent({
  react: React,
  tagName: 'aeliqo-text-area',
  elementClass: AeliqoTextAreaElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<string>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
    onValueCommit: 'aeliqo-input-commit' as EventName<AeliqoInputCommitEvent<string>>,
  },
  displayName: 'AeliqoTextArea',
});
export const AeliqoNumberField = createComponent({
  react: React,
  tagName: 'aeliqo-number-field',
  elementClass: AeliqoNumberFieldElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<AeliqoNumberChange>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
    onValueCommit: 'aeliqo-input-commit' as EventName<AeliqoInputCommitEvent<AeliqoNumberChange>>,
  },
  displayName: 'AeliqoNumberField',
});
export const AeliqoCheckbox = createComponent({
  react: React,
  tagName: 'aeliqo-checkbox',
  elementClass: AeliqoCheckboxElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<boolean>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
  },
  displayName: 'AeliqoCheckbox',
});
export const AeliqoRadioGroup = createComponent({
  react: React,
  tagName: 'aeliqo-radio-group',
  elementClass: AeliqoRadioGroupElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<string>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
  },
  displayName: 'AeliqoRadioGroup',
});
export const AeliqoSwitch = createComponent({
  react: React,
  tagName: 'aeliqo-switch',
  elementClass: AeliqoSwitchElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<boolean>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
  },
  displayName: 'AeliqoSwitch',
});
export const AeliqoSelect = createComponent({
  react: React,
  tagName: 'aeliqo-select',
  elementClass: AeliqoSelectElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<string>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
  },
  displayName: 'AeliqoSelect',
});
export const AeliqoCombobox = createComponent({
  react: React,
  tagName: 'aeliqo-combobox',
  elementClass: AeliqoComboboxElement,
  events: {
    onQueryChange: 'aeliqo-combobox-query' as EventName<AeliqoComboboxQueryEvent>,
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<string>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
  },
  displayName: 'AeliqoCombobox',
});
export const AeliqoDateField = createComponent({
  react: React,
  tagName: 'aeliqo-date-field',
  elementClass: AeliqoDateFieldElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<string>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
    onValueCommit: 'aeliqo-input-commit' as EventName<AeliqoInputCommitEvent<string>>,
  },
  displayName: 'AeliqoDateField',
});
export const AeliqoDateRange = createComponent({
  react: React,
  tagName: 'aeliqo-date-range',
  elementClass: AeliqoDateRangeElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<AeliqoDateRangeValue>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
    onValueCommit: 'aeliqo-input-commit' as EventName<AeliqoInputCommitEvent<AeliqoDateRangeValue>>,
  },
  displayName: 'AeliqoDateRange',
});
export const AeliqoSlider = createComponent({
  react: React,
  tagName: 'aeliqo-slider',
  elementClass: AeliqoSliderElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<AeliqoSliderValue>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
    onValueCommit: 'aeliqo-input-commit' as EventName<AeliqoInputCommitEvent<AeliqoSliderValue>>,
  },
  displayName: 'AeliqoSlider',
});
export const AeliqoSearchField = createComponent({
  react: React,
  tagName: 'aeliqo-search-field',
  elementClass: AeliqoSearchFieldElement,
  events: {
    onValueChange: 'aeliqo-input-change' as EventName<AeliqoInputChangeEvent<string>>,
    onValidation: 'aeliqo-validation' as EventName<AeliqoValidationEvent>,
    onValueCommit: 'aeliqo-input-commit' as EventName<AeliqoInputCommitEvent<string>>,
    onSearch: 'aeliqo-search' as EventName<AeliqoSearchEvent>,
  },
  displayName: 'AeliqoSearchField',
});
export const AeliqoFileInput = createComponent({
  react: React,
  tagName: 'aeliqo-file-input',
  elementClass: AeliqoFileInputElement,
  events: { onFilesChange: 'aeliqo-file-change' as EventName<AeliqoFileChangeEvent> },
  displayName: 'AeliqoFileInput',
});
export const AeliqoFieldGroup = createComponent({
  react: React,
  tagName: 'aeliqo-field-group',
  elementClass: AeliqoFieldGroupElement,
  displayName: 'AeliqoFieldGroup',
});
export const AeliqoForm = createComponent({
  react: React,
  tagName: 'aeliqo-form',
  elementClass: AeliqoFormElement,
  events: {
    onSubmit: 'aeliqo-form-submit' as EventName<AeliqoFormSubmitEvent>,
    onReset: 'aeliqo-form-reset' as EventName<AeliqoFormResetEvent>,
  },
  displayName: 'AeliqoForm',
});
