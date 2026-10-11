import { css, html, nothing } from 'lit';
import { AeliqoCheckboxElement } from './checkbox.js';

/** Binary setting using native checkbox form behavior with switch semantics. */
export class AeliqoSwitchElement extends AeliqoCheckboxElement {
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
    ...AeliqoCheckboxElement.styles,
    css`
      .switch-label {
        align-items: center;
        display: inline-flex;
        gap: var(--aeliqo-space-8, 0.5rem);
        min-block-size: max(var(--_aeliqo-coarse-target, 0px), var(--aeliqo-control-min-target, 2.75rem));
      }
      .switch-track {
        background: var(--aeliqo-color-muted, #4b5563);
        border-radius: 999px;
        display: inline-flex;
        inline-size: 2.75rem;
        padding: 0.125rem;
        transition: background-color var(--aeliqo-motion-duration-fast, 120ms) ease;
      }
      .switch-thumb {
        background: var(--aeliqo-color-canvas, #fff);
        border-radius: 50%;
        block-size: 1.25rem;
        inline-size: 1.25rem;
        transform: translateX(0);
        transition: transform var(--aeliqo-motion-duration-fast, 120ms) ease;
      }
      input {
        block-size: 1px;
        inline-size: 1px;
        opacity: 0;
        position: absolute;
      }
      input:checked + .switch-track {
        background: var(--aeliqo-color-accent, #4338ca);
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
