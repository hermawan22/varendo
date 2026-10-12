# Varendo status

Last updated: 2026-10-12. This is the maintained status of the independent Varendo
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

All five public packages are published at **0.1.0**: `@varendo/core`, `@varendo/runtime`,
`@varendo/web`, `@varendo/react`, and `@varendo/agent`. There is no previous
Varendo release; metadata separately records upstream Aeliqo 0.7.1. Imports,
repository metadata and current documentation use the new scope. Public API
identifiers, `aeliqo-*` elements/events/tokens, serialized contracts, persistence
keys and protocols retain compatible behavior. See the
[migration guide](site/pages/migration-varendo.md).

**All five npm packages are published and verified; the Varendo container image
remains unpublished.** Public documentation is live at
<https://hermawan22.github.io/varendo/>. The
[current recorded Pages deployment](https://github.com/hermawan22/varendo/actions/runs/38205265973)
published clean source `53406eeab85103fd0b1159e765ee3996e2b4ab70`, version 0.1.0.
The post-publication documentation and ZIP-export wiring are not yet deployed;
the live version endpoint identifies subsequent deployments independently.
Pages requires successful quality evidence for current `main`. Container
publication remains a separate owner-run manual workflow with unchanged gates.

## Verified Varendo 0.1.0 publication

The frozen published source is
`53406eeab85103fd0b1159e765ee3996e2b4ab70`. With pinned Node.js **24.20.0**
and pnpm **11.24.0**, a complete local `pnpm check` passed all **93 acceptance
commands**. The [same-SHA full main-push quality run](https://github.com/hermawan22/varendo/actions/runs/38203288539)
passed its four shards, merged functional evidence and release contract.
The [canonical RC 0.1.0-rc.2](https://github.com/hermawan22/varendo/actions/runs/38209749684)
and [stable 0.1.0 publication](https://github.com/hermawan22/varendo/actions/runs/38210717157)
then completed successfully from that same unchanged source through trusted
publishing, with no long-lived npm token fallback in GitHub Actions.

Authenticated scope authority, account 2FA and all five exact trusted publisher
records were verified before publication. New-package bootstrap used distinct
staged `0.1.0-rc.1` tarballs with the `bootstrap` tag to establish package records;
it was not used as canonical RC approval. Pending bootstrap stages were not
automatically approved or rejected.

The stable installed registry consumer checked **166 exports** and reported
`provenanceVerified: true` against the frozen source. Independent registry checks
confirmed **all five `latest` tags equal 0.1.0**, with matching tarball integrity;
the downloaded tarballs were independently rehashed. Publication and consumer
receipts are retained with the canonical workflow artifacts. These receipts
qualify the published source, not the later documentation commit or an image.
See the [maintainer procedure](releasing-varendo.md) for the preserved release
gates and [support matrix](support-matrix.json) for bounded profile claims.

## Earlier source-bound verification receipts

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

## Release completion and legacy retirement

The maintainer authorized publishing all five Varendo 0.1.0 packages after
verified npm namespace ownership on 12 October 2026. The Aeliqo music application
is paused and is outside this release. This approval does not establish ownership
or substitute for successful release evidence.

Current execution state:

1. **GitHub presentation complete:** the profile README features Varendo, its
   repository is the first profile pin, and repository About links to the live
   HTTPS documentation. Other profile projects and personal links are preserved.
2. **Ownership and npm publication complete:** verified authority and account
   2FA preceded bootstrap, trusted publisher setup, canonical RC and stable
   publication. The initial HTTP 401 was resolved; it is not a current blocker.
   All five stable packages passed registry consumers and provenance checks.
3. **Pages follow-up pending:** the recorded deployment above serves source
   `53406ee...`. This post-publication documentation change and the existing ZIP
   export feature still require reviewed integration, required quality checks,
   Pages deployment and live verification. No post-change deployment is claimed.
4. **Legacy retirement pending:** [GitOps retirement PR 496](https://github.com/Arconath/platform-apps/pull/496)
   is a draft with green checks and remains unmerged. Original repository,
   container and npm backups have been verified as described below. Removal of
   active references and reconciliation of rollback requirements precede any
   deletion. No legacy deletion, npm deprecation or support request is claimed.
   The private archived site repository and new music repositories are outside
   the public-framework deletion scope; original attribution remains in Varendo.

Independent protected backups cover the original framework repository at
`3b5328dc717de0bb6aad57e8f17a4b9aa5f89f79`: an independently cloned Git bundle
passed fsck across 79 refs, with bounded GitHub metadata for 66 issue/PR entries,
8 releases without assets, 11 tags and 2 branches. Secrets, Actions, Projects,
webhooks and attachments are outside that backup. Container backups preserve
90 known GHCR versions, 90 manifests and 222 blobs with verified hashes and
descriptors. A local restore of the original AMD64 config/layer bytes passed
seven HTTP routes as UID 101 with read-only filesystem and no-new-privileges,
without external calls; the ephemeral container was removed. This is not a full
interactive application or GitHub-service restoration.

Legacy npm backups preserve all five packages' 140 tarballs with SHA-512/SHA-1
verification and stable before/after version sets. Independent rehashing covered
all 160 manifest-listed files and the 140 tarball integrity values. This supports
distribution and public-metadata recovery; npm same-version restoration is not
guaranteed. Backup manifests and restore receipts remain in protected maintainer
storage, rather than being represented as public download links.

All five legacy npm packages are older than 72 hours and exceed npm's routine
unpublish ceiling of 300 downloads in the preceding week. The checked 5–11
October counts were 764, 735, 677, 565 and 607 respectively for core, runtime,
web, react and agent; published sibling dependencies also exist. The current
`hermawan22` npm account has no write access to these packages, whose recorded
maintainer is `arconath`. No legacy-package access change, deprecation or unpublish was
performed. Permanent removal requires npm support consideration; the prepared
support request awaits explicit owner approval and has not been sent.
Deprecation must not be described as deletion. See the
[official npm policy](https://docs.npmjs.com/policies/unpublish/).

Paired performance and historical visual-baseline approval remain advisory
follow-ups, not substitutes for or blockers on the required functional matrix.

## Historical migration infrastructure boundary

At the initial migration, original `@aeliqo/*` packages were not published over,
deleted or deprecated.
The original site still reports revision
`1c0e9a4f0db95a08fd964890cb38204cae86826d`, SDK 0.7.1, with healthy `/healthz` and
`/readyz`. GitOps retains
`ghcr.io/arconath/aeliqo-web@sha256:93ac05c7d2269353b27129abfd66259f103babdc1f0e94028de65faa0755fd54`
and the `aeliqo.com`, `www.aeliqo.com`, and `docs.aeliqo.com` ingresses. Empty
repository secrets/deployment lists do not exclude organization or environment
credentials. No original repository, domain, deployment, registry or production
service was changed by that framework migration. Later music cutover and the
newly authorized retirement are separate operations. The new manual image tooling targets
`ghcr.io/hermawan22/varendo-web`.
