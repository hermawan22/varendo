import { css, html, nothing } from 'lit';
import { AeliqoFieldElement, aeliqoInputStyles } from './base.js';
import { AeliqoFileChangeEvent, type AeliqoFileMetadata } from './events.js';

/** Native file picker that exposes metadata while leaving bytes with the host. */
export class AeliqoFileInputElement extends AeliqoFieldElement<readonly AeliqoFileMetadata[]> {
  static readonly properties = {
    ...AeliqoFieldElement.properties,
    accept: { type: String },
    multiple: { type: Boolean, reflect: true },
    capture: { type: String },
    maxFiles: { attribute: 'max-files', type: Number },
    maxBytes: { attribute: 'max-bytes', type: Number },
    selected: { attribute: false },
  };

  accept = '';
  multiple = false;
  capture = '';
  maxFiles = 0;
  maxBytes = 0;
  selected: readonly AeliqoFileMetadata[] = [];

  protected override updated(): void {
    this.syncNative();
  }

  protected override isCurrentValidationValue(value: readonly AeliqoFileMetadata[]): boolean {
    return (
      value.length === this.selected.length &&
      value.every((file, index) => {
        const selected = this.selected[index];
        return (
          selected !== undefined &&
          file.name === selected.name &&
          file.size === selected.size &&
          file.type === selected.type &&
          file.lastModified === selected.lastModified
        );
      })
    );
  }

  protected override resetField(): void {
    this.selected = [];
    const input = this.native();
    if (input !== undefined) input.value = '';
    this.syncNative();
  }

  protected override render() {
    const describedBy = this.describedByIds();
    return html`
      <div part="field">
        <label part="label" for="control"><span class="label-text">${this.label}</span></label>
        <input
          part="input"
          id="control"
          type="file"
          name=""
          accept=${this.accept || nothing}
          ?multiple=${this.multiple}
          capture=${this.capture || nothing}
          ?disabled=${this.fieldDisabled || this.readOnly}
          aria-readonly=${this.readOnly ? 'true' : nothing}
          aria-describedby=${describedBy || nothing}
          aria-invalid=${this.error ? 'true' : nothing}
          @change=${this.handleChange}
        />
        ${
          this.selected.length > 0
            ? html`<ul part="files">
                ${this.selected.map((file) => html`<li>${file.name} <span>(${file.size} bytes)</span></li>`)}
              </ul>`
            : nothing
        }
        ${this.renderMessages()}
      </div>
    `;
  }

  override focus(options?: FocusOptions): void {
    this.native()?.focus(options);
  }

  private readonly handleChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.fieldDisabled) return;
    if (this.readOnly) {
      input.value = '';
      this.syncNative();
      return;
    }
    const metadata: AeliqoFileMetadata[] =
      input.files === null
        ? []
        : Array.from(input.files, (file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
          }));
    this.selected = metadata;
    this.dispatchEvent(new AeliqoFileChangeEvent({ source: 'user', files: metadata }));
    void this.validateProposed(metadata);
    this.syncNative();
  };

  private native(): HTMLInputElement | undefined {
    const root = this.renderRoot;
    if (root === undefined || typeof root.querySelector !== 'function') return undefined;
    return root.querySelector<HTMLInputElement>('input[part=input]') ?? undefined;
  }

  private syncNative(): void {
    const valid = this.isValidSelection();
    // File bytes remain in the native picker and are never copied into the
    // custom element's form value. The host can explicitly read the native
    // FileList after receiving the metadata event if it owns that capability.
    this.setFormValue(null);
    if (this.internals !== undefined && !this.fieldDisabled && !valid)
      this.internals.setValidity({ customError: true }, this.error || this.selectionError(), this.native());
    else this.updateValidity(this.native(), this.required && this.selected.length === 0);
  }

  private isValidSelection(): boolean {
    if (this.maxFiles > 0 && this.selected.length > this.maxFiles) return false;
    if (this.maxBytes > 0 && this.selected.reduce((sum, file) => sum + file.size, 0) > this.maxBytes) return false;
    return true;
  }

  private selectionError(): string {
    if (this.maxFiles > 0 && this.selected.length > this.maxFiles)
      return `Choose at most ${this.maxFiles} file${this.maxFiles === 1 ? '' : 's'}.`;
    if (this.maxBytes > 0 && this.selected.reduce((sum, file) => sum + file.size, 0) > this.maxBytes)
      return 'The selected files are too large.';
    return 'Choose a file.';
  }

  static readonly styles = [
    ...aeliqoInputStyles,
    css`
      input::file-selector-button {
        max-inline-size: 100%;
        white-space: normal;
      }
      [part='files'] {
        margin: 0;
        padding-inline-start: 1.25rem;
      }
      [part='files'] span {
        color: var(--aeliqo-color-muted, #4b5563);
      }
    `,
  ];
}
