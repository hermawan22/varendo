# ADR 003-shared-web: One owned web implementation

Status: Accepted with blocking M0 evidence.

## Decision

Lit 3 custom elements, native controls, CSS and modular D3/SVG form the candidate implementation. React is a thin lifecycle/property/event binding, vanilla is first-class. SSR/hydration/form/shadow accessibility issues must be resolved here or in a narrowly scoped replacement ADR; do not duplicate the catalog to hide problems.

## Consequences

This ADR records a design decision. Replacing it requires explicit alternatives, migration guidance, and conformance tests.
