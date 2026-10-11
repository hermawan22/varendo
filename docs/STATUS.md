# Varendo status

Last updated: 2026-10-11. This is the maintained status of the independent Varendo
framework. The original Aeliqo status and release receipts remain unchanged in
[the upstream archive](history/aeliqo-status-2026-10-09.md), `docs/adr/`,
`docs/releases/` and the historical public release notes.

## Delivered source and release state

[hermawan22/varendo](https://github.com/hermawan22/varendo) is the separate public
framework repository, initialized from the tracked `Arconath/aeliqo` snapshot
`3b5328dc717de0bb6aad57e8f17a4b9aa5f89f79` with one `Initialize` root
commit carrying the maintainer author and DCO signoff. It is independent of the
new Aeliqo music application. Apache-2.0 attribution, notices and historical
release/decision records are preserved; original Git history remains upstream.

All five public packages target **0.1.0**: `@varendo/core`, `@varendo/runtime`,
`@varendo/web`, `@varendo/react`, and `@varendo/agent`. There is no previous
Varendo release; metadata separately records upstream Aeliqo 0.7.1. Imports,
repository metadata and current documentation use the new scope. Public API
identifiers, `aeliqo-*` elements/events/tokens, serialized contracts, persistence
keys and protocols retain compatible behavior. See the
[migration guide](site/pages/migration-varendo.md).

**Packages and images remain unpublished.** The public documentation is live at
<https://hermawan22.github.io/varendo/>. The
[first Pages deployment](https://github.com/hermawan22/varendo/actions/runs/38124097408)
published source `540786dde4460de55e9ec3b7d543156ece518d60`. Pages requires successful
quality evidence for the current `main` source; npm and container publication
remain separate owner-run manual workflows with unchanged gates.

## Source-bound verification receipts

Pinned Node.js **24.20.0** and pnpm **11.24.0** were used. At source
`540786dde4460de55e9ec3b7d543156ece518d60`, the canonical clean release candidate
built all five `varendo-*-0.1.0.tgz` archives, verified an external installed
consumer across **166 exports**, produced a **60-component SBOM**, and reported
**zero secret findings**. The clean documentation artifact verified **132 pages**
and **71 components**, with 13 Node tests and one runtime test passing.

The [hosted quality run](https://github.com/hermawan22/varendo/actions/runs/38122474108)
passed all **93 acceptance commands** across four shards, the functional evidence
merge and the release contract at that same source revision. The duplicate local
serial run passed 82 commands, including all 610 visual cases in both Chromium
and Firefox, then was intentionally stopped after hosted full-matrix success.
It is a partial local run, not a completed local `pnpm check`.

Actual hosted verification passed **27 route/browser/viewport cases** across
Chromium, Firefox and WebKit at 360/768/1440 pixels, including the landing page,
quickstart and responsive playground. The playground rendered real Ada data;
search matched known content and showed its no-results state. Axe violations,
page errors and horizontal overflow were zero. Hosted `/version` returned clean
source `540786dde4460de55e9ec3b7d543156ece518d60` and docs version 0.1.0.

Receipts above bind their stated source revision.
[Actions](https://github.com/hermawan22/varendo/actions) and the
[live version record](https://hermawan22.github.io/varendo/version) expose
subsequent per-revision acceptance and deployment. A later status-only change
uses the documented site lane; any package publication still requires its own
same-source full-matrix gate. Earlier receipts never authorize a different
source revision for package or image publication.

Earlier focused verification passed core contracts (267), agent tests (155),
quality/DCO policy, clean tarball consumers, production dependency audit, and the
complete site suite: 18 unit tests, 116 browser cases plus one explicit capability
skip, 134-page SEO, Go server contracts and eight provenance tests. A diagnostic
Pages snapshot passed 27 browser/route/viewport cases with zero axe violations,
page errors or overflow. These modified-tree diagnostics are separate from the
clean-source receipts above. Current evidence is ignored under `artifacts/` and
local logs; generated output is excluded from the source snapshot.

Advisory paired performance comparison lacks an approved budget, and the
historical visual comparison baseline has a legacy fixture hash. Those advisory
jobs report failures; no baseline, approval or timing threshold was invented.
Planner latency remains diagnostic under ADR 014. Required functional quality
and release-contract acceptance passed for the explicit receipt above.

## Remaining work and untouched infrastructure

- Verify authenticated npm `varendo` namespace ownership and configure trusted
  publishing before seeking distinct package-publication approval. All five
  public package lookups returned HTTP 404, while authenticated npm checks
  returned HTTP 401. Neither result proves namespace ownership or availability.
- Review and approve new paired performance/visual comparison evidence through
  the existing process; do not silently adopt the migration snapshot as a baseline.
- Review any future image publication, legacy docs redirect, GitOps retirement,
  DNS change or commercial `aeliqo.com` cutover separately.

Original `@aeliqo/*` packages were not published over, deleted or deprecated.
The original site still reports revision
`1c0e9a4f0db95a08fd964890cb38204cae86826d`, SDK 0.7.1, with healthy `/healthz` and
`/readyz`. GitOps retains
`ghcr.io/arconath/aeliqo-web@sha256:93ac05c7d2269353b27129abfd66259f103babdc1f0e94028de65faa0755fd54`
and the `aeliqo.com`, `www.aeliqo.com`, and `docs.aeliqo.com` ingresses. Empty
repository secrets/deployment lists do not exclude organization or environment
credentials. No original repository, domain, deployment, registry or production
service was changed. The new manual image tooling targets
`ghcr.io/hermawan22/varendo-web`.
