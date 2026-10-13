import { css, html, nothing } from 'lit';
import { VarendoCheckboxElement } from './checkbox.js';

/** Binary setting using native checkbox form behavior with switch semantics. */
export class VarendoSwitchElement extends VarendoCheckboxElement {
  protected override render() {
    const describedBy = this.describedByIds();
    return html`
      <div part="field">
        <label part="label" class="switch-label">
          <input
            part="input"
            type="checkbox"
            role="switch"
            name=""
            .checked=${this.checked}
            .indeterminate=${false}
            ?disabled=${this.fieldDisabled}
            aria-readonly=${this.readOnly ? 'true' : nothing}
            aria-checked=${String(this.checked)}
            aria-invalid=${this.error ? 'true' : nothing}
            aria-describedby=${describedBy || nothing}
            @change=${this.handleChange}
          />
          <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
          <span class="choice-text">${this.label}</span>
        </label>
        ${this.renderMessages()}
      </div>
    `;
  }

  static readonly styles = [
    ...VarendoCheckboxElement.styles,
    css`
      .switch-label {
        align-items: center;
        display: inline-flex;
        gap: var(--varendo-space-8, 0.5rem);
        min-block-size: max(var(--_varendo-coarse-target, 0px), var(--varendo-control-min-target, 2.75rem));
      }
      .switch-track {
        background: var(--varendo-color-muted, #4b5563);
        border-radius: 999px;
        display: inline-flex;
        inline-size: 2.75rem;
        padding: 0.125rem;
        transition: background-color var(--varendo-motion-duration-fast, 120ms) ease;
      }
      .switch-thumb {
        background: var(--varendo-color-canvas, #fff);
        border-radius: 50%;
        block-size: 1.25rem;
        inline-size: 1.25rem;
        transform: translateX(0);
        transition: transform var(--varendo-motion-duration-fast, 120ms) ease;
      }
      input {
        block-size: 1px;
        inline-size: 1px;
        opacity: 0;
        position: absolute;
      }
      input:checked + .switch-track {
        background: var(--varendo-color-accent, #4338ca);
      }
      input:checked + .switch-track .switch-thumb {
        transform: translateX(1.25rem);
      }
      :host(:dir(rtl)) input:checked + .switch-track .switch-thumb {
        transform: translateX(-1.25rem);
      }
      @media (prefers-reduced-motion: reduce) {
        .switch-track,
        .switch-thumb {
          transition-duration: 0ms;
        }
      }
    `,
  ];
}
