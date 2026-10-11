import { AeliqoTextControlElement } from './text-control.js';

/** Multiline native textarea preserving draft, caret and composition state. */
export class AeliqoTextAreaElement extends AeliqoTextControlElement {
  protected readonly multiline = true;
}
