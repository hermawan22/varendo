import { AeliqoTextControlElement } from './text-control.js';

/** Single-line native text field with controlled/uncontrolled IME-safe editing. */
export class AeliqoTextFieldElement extends AeliqoTextControlElement {
  protected readonly multiline = false;
}
