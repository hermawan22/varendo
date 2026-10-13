import { VarendoTextControlElement } from './text-control.js';

/** Multiline native textarea preserving draft, caret and composition state. */
export class VarendoTextAreaElement extends VarendoTextControlElement {
  protected readonly multiline = true;
}
