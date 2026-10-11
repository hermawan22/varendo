---
id: 'migration-varendo'
path: '/ship/migration-varendo/'
section: 'Releases'
title: 'Aeliqo to Varendo'
description: 'Move the adaptive UI framework from @aeliqo 0.7.1 to the separately versioned @varendo 0.1.0 package family.'
---

## Migrate from 0.7 to 0.1

Varendo 0.1.0 is the first release candidate of the independent Apache-2.0 framework repository, copied from Aeliqo framework source `3b5328dc717de0bb6aad57e8f17a4b9aa5f89f79`. Release metadata records no previous Varendo version (`previousVersion: null`); `upstreamVersion: 0.7.1` identifies the separate Aeliqo family. The version restarts for a new npm package family; it does not indicate a downgrade of the framework implementation. The original `@aeliqo/*` 0.7.1 packages, Git history and production service remain unchanged.

The five new package names are prepared in source. They are **not yet published**. npm returned 404 for `@varendo/core` during preflight, which is not proof of namespace ownership. The local npm authentication returned 401; a maintainer must prove control of the `varendo` scope and configure the new repository's trusted publishing identity before a separately approved release.

| Existing package | New package |
| --- | --- |
| `@aeliqo/core` | `@varendo/core` |
| `@aeliqo/runtime` | `@varendo/runtime` |
| `@aeliqo/web` | `@varendo/web` |
| `@aeliqo/react` | `@varendo/react` |
| `@aeliqo/agent` | `@varendo/agent` |

After publication and registry consumer verification, replace the packages used by your application together:

```sh
pnpm remove @aeliqo/core @aeliqo/runtime @aeliqo/web @aeliqo/react @aeliqo/agent
pnpm add @varendo/core@0.1.0 @varendo/runtime@0.1.0 @varendo/web@0.1.0 @varendo/react@0.1.0 @varendo/agent@0.1.0
```

Install only the packages your application actually uses. Preserve import subpaths and exported names while changing the package scope:

```ts
import { createAeliqoApp } from '@varendo/web/app';
import { AeliqoProvider } from '@varendo/react';
```

Use the package guides for the supported exports. A package scope replacement also applies to dynamic imports, bundler aliases, framework transpilation lists, mocks and dependency overrides. Remove stale workspace links and reinstall from the newly verified tarballs or registry versions. Do not load both web package families in the same browser document: they register the same custom-element names and can carry different Lit instances.

## Compatibility policy

Function, type and React component identifiers such as `createAeliqoApp`, `createAeliqoRuntime`, `AeliqoProvider`, `AeliqoRegion` and `registerAeliqoElements` keep their existing spellings. The `aeliqo-*` custom-element tags, CSS custom properties, event names, serialized schemas, protocol names and versions, persistence keys and diagnostic identifiers remain stable. There is no API deprecation deadline and no new aliases in 0.1.0. Package names and repository/documentation URLs are the intentional integration changes.

The existing runtime trust boundaries are unchanged. Resource `policy.expectedIssuer` and `issuer` checks still apply. `createAppToolSession` continues to target explicit application scopes. Host `onDraftExit` decisions can return `needs-input`; a committed plan is distinct from `renderer-ready`. Presentation callbacks (`onPresentation`), `stateMappings`, and `context.incumbent` retain their existing lifecycle and validation behavior. The earlier [0.6 to 0.7 guide](/ship/migration-0.6/) remains a historical record for those behavior changes.

## Documentation and release boundary

The new source is [hermawan22/varendo](https://github.com/hermawan22/varendo). Static documentation is prepared for [GitHub Pages](https://hermawan22.github.io/varendo/), including the existing playground. The Pages build uses `/varendo/` for assets, route navigation, search and redirect pages. Existing route suffixes remain available, including legacy aliases. No automatic cross-domain redirect has been configured on the old service, and no legacy DNS, GitOps object or published image is changed by this snapshot.

The original framework site is reported in the preserved status history as `ghcr.io/arconath/aeliqo-web`, managed by existing Arconath GitOps. The separate historical `Arconath/aeliqo-site` repository is archived. Empty repository-level secrets and deployments API responses cannot prove that environment or organization credentials are absent. The new image tooling targets `ghcr.io/hermawan22/varendo-web` and stays manually dispatched; Pages does not require image publication or npm publication. Telemetry remains disabled by default.

A clean `Initialize` root commit in the new repository must retain the original Apache-2.0 `LICENSE`, `NOTICE`, historical ADRs and release receipts. Its legitimate author must supply their own matching DCO signoff. The original repository history is not imported or rewritten. Original versioned release notes and evidence remain explicitly attributed to Aeliqo.

## Maintainer release and rollback

1. Verify scope ownership using authenticated npm account and organization access; verify all five target package/version names have no conflicting publication or tombstone.
2. Configure trusted publishing for `hermawan22/varendo`, review release workflow identity, and retain the exact-source full-matrix main-push gate. Run clean tarball consumers and the release candidate tooling on that clean commit.
3. Obtain explicit npm release approval; publish an RC in dependency order, verify provenance and registry consumers, then approve stable 0.1.0 promotion. Never overwrite or delete `@aeliqo/*` versions.
4. Publish static Pages documentation only after the same-source quality workflow succeeds. Verify actual URLs and browser journeys after deployment. Pages is independent of the legacy production site.
5. Coordinate any old documentation redirects, GHCR/GitOps retirement, DNS changes or `aeliqo.com` cutover separately with the owner. The music product has an independent repository and deployment lifecycle.

Before migrating consumers, rollback means leaving their current `@aeliqo/*@0.7.1` lockfiles and deployment untouched. After a consumer switches, restore its previous package scope and exact lockfile, rebuild and verify that application's data and persisted-state compatibility. Do not mix package families in a document. Unpublishing npm packages is not a rollback mechanism; restoring a source checkout does not undo external registry, DNS or deployment changes.
