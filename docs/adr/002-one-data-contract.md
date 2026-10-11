# ADR 002-one-data-contract: One Application Data Contract

Status: Accepted.

## Decision

In-process and generic HTTP carry the same describe/plan/execute semantics. Optional importers assist metadata authoring but do not magically translate arbitrary endpoint semantics. Host-owned execution may be opaque or implement the supported relational subset. No per-database driver in core.

## Consequences

This ADR records a design decision. Replacing it requires explicit alternatives, migration guidance, and conformance tests.
