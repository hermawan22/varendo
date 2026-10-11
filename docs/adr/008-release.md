# ADR 008-release: New immutable release without legacy deletion

Status: Accepted.

## Decision

Target the owner-selected direct `@aeliqo/{core,runtime,web,react,agent,devtools}` identities at 0.1.0 after prerelease validation. `@aeliqo/core` and `@aeliqo/react` previously contained an incompatible 0.2.0 preview lineage, and an aborted bootstrap created `@aeliqo/sdk-core@0.1.0-rc.1`. The owner manually unpublished all organization packages on 10 September 2026. Those historical name+version pairs remain permanently unavailable, the direct-name bootstrap must respect npm's 24-hour name hold, and later 404 responses cannot erase that history. The lower-semver reset and explicit `latest` cutover remain documented and verified. Build the rewrite on a clean tree, preserve production until reviewed migration and digest-based rollback are ready, and do not use further unpublish as migration.

## Consequences

This ADR records a design decision. Replacing it requires explicit alternatives, migration guidance, and conformance tests.
