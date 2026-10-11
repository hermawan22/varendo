# Foundation components

The foundation family is the direct, framework-free web surface for Varendo. Each
element is a Lit custom element with an open shadow root, native semantic markup,
documented parts, and no Region, planner, chart, provider or model dependency.

Import and register the individual elements in a host application. Registration
belongs to the application because importing a leaf must not mutate the global
custom-element registry. The parent package integrates these constructors into
the shared registry; the standalone tests define them locally to prove that the
same implementation works outside a region.

Actions dispatch cancelable `aeliqo-action` proposals with `source: "user"` and
an explicit action kind. A host may call `preventDefault()` while validating or
authorizing the registered action reference. `Button` and `IconButton` expose
native `button` semantics, form association, submit/reset behavior, disabled and
pending latching, and stable named parts. `Link` accepts a host-resolved href
only at the direct API boundary; manifest configuration carries registered
`routeRef` and `contentRef` values, never an arbitrary URL or module reference.

`SplitPane` is controlled when `position` is supplied and otherwise keeps a
bounded local position from `defaultPosition`. Pointer movement and
Arrow/Home/End keyboard input emit typed `aeliqo-split-change` proposals. The
splitter exposes separator value semantics, respects minimum and maximum bounds,
and accounts for RTL horizontal direction.

Text, heading, badge, avatar, separator, surface, stack, grid and scroll area
remain data-free primitives. Text is interpolated through Lit as text; Avatar
uses initials and a generic accessible name when identity data is absent, and
network images are limited to HTTP(S) with a local fallback.

The versioned `manifest.ts` metadata is an integration boundary for the parent
registry. Its validator accepts only bounded typed configuration and host
registered references (`actionRef`, `routeRef`, `contentRef`, `identityRef`),
rejecting executable callbacks, actor/approval claims, arbitrary URLs and
module paths. It does not resolve business actions or invent source capability.

## Direct and React use

```ts
import {AeliqoButtonElement} from '@varendo/web/button';
customElements.define('aeliqo-button', AeliqoButtonElement);
```

Each of the 13 elements has a leaf export (`/button`, `/icon-button`, `/link`,
`/text`, `/heading`, `/badge`, `/avatar`, `/separator`, `/surface`, `/stack`,
`/grid`, `/split-pane`, `/scroll-area`). Importing `/foundation` collects the
constructors. Call `registerAeliqoElements` from `/register` to register the whole
web catalog. React wrappers are available from `@varendo/react/foundation`; they
use those same elements and typed `onAeliqoAction`, `onAeliqoLink` and
`onAeliqoSplitChange` events. Applications supply IconButton's `icon` slot.

## Validated presentation use

`createAeliqoPresentationRegistry({foundation: bindings})` adapts the same
foundation manifests into the core presentation registry. The application owns
an immutable snapshot of versioned bindings with `contents`, `actions`, `routes`
and `identities`. For example, a `contentRef` selects reviewed text and an
`actionRef` selects a registered action version plus scalar input. Every foundation node configuration pins `bindingRevision`; validation rejects
a plan authored against a different binding packet, even if the Experience
revision is unchanged. Copy changes require a new binding revision, a new
Experience revision and validation of the new presentation. Surface and
ScrollArea `labelRef` values select registered accessible-name text; direct
Surface `labelledBy` instead names an actual DOM element.
Static content bindings must not be used to let a model self-certify computed
claims; evidence-bound result narratives use the agent verifier.

`AeliqoRegion` renders the resulting `ValidatedPresentation`. Semantic buttons
emit `action-request` through `onSemanticInteraction`; they use `type="button"`
and do not submit or reset an enclosing form. The host performs authorization
and business execution. Ordinary links emit `navigate`; modified and new-tab
links retain native navigation to the application-registered destination.
The semantic IconButton currently uses the owned ellipsis glyph.

Containers use the presentation containment tree; SplitPane requires two
children. Its local resize position and focus survive an equivalent validated
presentation update. ScrollArea requires a bounded host block size for vertical
scrolling. Direct controls remain usable without a Task, registry or model.

## Verification scope

`pnpm test:foundation` exercises reference validation, operation coverage, stale
Experience rejection and immutable host bindings. `pnpm test:foundation:browser`
checks actual native forms, keyboard and pointer resizing, controlled position,
RTL, constrained scrolling, accessible names, action/route dispatch, focus
retention and light/dark/mobile/large-text/forced-colors screenshots with axe.
The screenshots require visual inspection; axe alone missed a forced-colors
text defect during implementation.

`pnpm test:platform:consumers` checks installed tarball bytes and TypeScript
exports, all 13 Lit SSR implementations, React rendering and events, and a
direct Button bundle without core/runtime/agent/React imports. These automated
checks do not stand in for manual screen-reader testing or native platform
implementations.
