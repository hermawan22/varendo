# ADR 015: Load browser component families before publication

Status: implemented in unreleased source on 9 October 2026.

## Context

The promoted React quickstart imports the application facade. Mounting that
application previously registered every shared element, so its initial bundle
included unrelated component families. Direct component usage and custom
renderer callbacks still need the existing complete registration API.

## Decision

Mounting registers the Region, table and chart base elements. After a presentation
has been validated, the web adapter loads its required component families through
a fixed table of literal local imports. Custom view callbacks and unknown
extension representations use the complete registration fallback, preserving
compound elements' nested dependencies. Full and selective registration share
the same constructor/tag tables and version-conflict checks.

Load before renderer preparation and publication, both on explicit render and
container adaptation. Recheck cancellation, disposal and captured authority after
the asynchronous boundary. A loading or version-conflict failure retains the
previous authorized result; a revoked authority must not retain that result.
The existing synchronous publication and rollback checks remain in force.

The package-boundary scanner permits only the nine reviewed literal `import()`
edges in `packages/web/src/app/presentation-elements.ts`. It traverses those
targets exactly as it traverses static imports, including their external
dependencies. It continues to reject nonliteral imports, `require`, unlisted
targets, dynamic imports elsewhere, and prohibited package dependencies. Neither
agent input nor a resource definition supplies a module path.

## Consequences

The existing render API remains asynchronous. Applications that need immediate
registration for direct element usage continue to call `registerAeliqoElements`.
Custom extensions may still download the complete catalog. Bundle diagnostics
separate the initial static graph from all emitted deferred chunks and include
the real React quickstart. These measurements do not establish download timing,
interaction latency, or a new byte budget. Dependency-direction, publication
and performance requirements, including ADR 014, remain unchanged.
