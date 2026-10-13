import { VarendoTextControlElement } from './text-control.js';

/** Single-line native text field with controlled/uncontrolled IME-safe editing. */
export class VarendoTextFieldElement extends VarendoTextControlElement {
  protected readonly multiline = false;
}
