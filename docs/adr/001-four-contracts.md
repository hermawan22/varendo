# ADR 001-four-contracts: Four public contract families

Status: Accepted.

## Decision

Expose Catalog, Task, Result and Experience. Keep intermediate logical/physical/render plans internal versioned representations. This avoids a vocabulary/adapter at every layer while retaining testable boundaries.

## Consequences

This ADR records a design decision. Replacing it requires explicit alternatives, migration guidance, and conformance tests.
