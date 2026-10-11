# Runtime presentation adaptation

Import the opt-in adapter from `@varendo/web/region/adaptation` and install
`@varendo/runtime` explicitly. Ordinary web primitives do not require runtime.
The lower-level controller is `@varendo/runtime/presentation`.

Provide a RegionHandle, the canonical presentation registry, and host context
containing the Experience, authorized Result descriptors and renderer
capabilities. `readContext`, when present, replaces the base context completely.
Task, incumbent and current revisions always come from the region snapshot.
Optional `candidates` are ordinary core composition proposals; explicit and
registered pattern candidates pass the same validation as generated candidates.

The web adapter measures the region and guards focused editors (including nested
shadow roots), IME and active pointers. The application can add a live dirty-draft
or drag guard. Resize requests coalesce, small deltas accumulate from the last
applied environment, and text-scale changes are re-evaluated. Routine adaptation
has no model dependency. Applications provide honest keyboard facts where known;
the default measurement keeps unknown keyboard availability explicit.

Composition and staging finish before visible application. The final synchronous
commit recheck gives the renderer the exact prospective revisions. Failed commits
roll back; revocation clears the surface and invalidates old prepared rollbacks.
The default web adapter clears the region. A custom callback renderer that writes
visible/private content must provide its own `clear` callback; omitting it is only
appropriate for headless instrumentation. Generic callbacks cannot prove browser
paint, host navigation execution or assistive-technology behavior.

Semantic ambiguity is explicit. A trend request with more than one authorized
numeric measure returns `needs-input` with the bounded field IDs as choices; it
does not infer a measure from descriptor order. An authored candidate that is
missing or rejected is `unsupported` even when a registered suggestion exists,
while an empty candidate set may search trusted registered suggestions. Explicit
view pins are hard gates; preferred views remain ranking input and may fall back
to another eligible candidate.

Registered comparison compositions are bounded by their layout manifest. A
simultaneous split owns its child views and coverage, and the resolver rejects
extra children or exclusive layouts that hide a required comparison. During web
adaptation, focused or dirty draft controls defer replacement; after the guard
ends, the newest measurement is applied. Resize thresholds use hysteresis so a
small oscillation does not alternate views, and the last valid presentation stays
visible while a replacement is unsupported.

Interaction and navigation transfer require declared ownership and matching port
semantics. Domain drafts remain keyed independently of layout. A live guard may
defer a candidate; ending the interaction retries the newest measurement.
Disconnect disposes subscriptions and queued work.
