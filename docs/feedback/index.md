# Feedback and status components

Feedback components distinguish transient, persistent, modal, nonmodal, and loading states. Messages are supplied by the host or trusted content; a passing render does not imply that data or an operation succeeded.

| Component | Contract | Key state behavior |
| --- | --- | --- |
| `varendo-tooltip` | Supplemental information | Available on focus and hover, labeled by its trigger, and dismissible with Escape. It is never the only label. |
| `varendo-popover` | Contextual surface | `modal=false` leaves outside content usable and dismisses outside; `modal=true` contains focus and returns it to the trigger. |
| `varendo-dialog` | Native-first overlay | Uses `<dialog>` and native modal/nonmodal modes, explicit Escape policy, focus containment, and focus return. |
| `varendo-drawer` | Explicit inline or modal detail | `mode="inline"` is an ordinary disclosed region; `mode="modal"` uses native modal behavior and its own focus lifecycle. |
| `varendo-toast` | Bounded transient feedback | Non-danger toasts may auto-dismiss; danger toasts remain until an explicit user dismissal. Essential error recovery belongs in persistent UI too. |
| `varendo-alert` | Persistent status or error | Severity maps to status/alert semantics and optional recovery/dismiss actions. |
| `varendo-progress` | Honest progress | Finite `value` is clamped to `max`; an unknown value uses an indeterminate progressbar without `aria-valuenow`. |
| `varendo-skeleton` | Reserved loading geometry | Named `role="status"` loading state reserves text/rect/circle geometry and respects reduced-motion preferences. |
| `varendo-empty-state` | Result-state explanation | `kind` distinguishes `no-records`, `no-matches`, `forbidden`, `loading`, and `failure`; optional actions emit a cancelable host event. |

Overlay close events are cancelable. Focus is restored only when the invoking element is still connected. All surfaces retain readable DOM text at narrow widths, RTL, high text scale, and reduced motion.
