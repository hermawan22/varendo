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
release/decision records are preserved; original Git history is retained in the
maintainer’s independent Git backup.

All five public packages are published at **0.1.0**: `@varendo/core`, `@varendo/runtime`,
`@varendo/web`, `@varendo/react`, and `@varendo/agent`. There is no previous
Varendo release; metadata separately records upstream Aeliqo 0.7.1. Imports,
repository metadata and current documentation use the new scope. Public API
identifiers, `aeliqo-*` elements/events/tokens, serialized contracts, persistence
keys and protocols retain compatible behavior. See the
[migration guide](site/pages/migration-varendo.md).

**All five npm packages are published and verified; the Varendo container image
remains unpublished.** Public documentation is live at
<https://hermawan22.github.io/varendo/>. The first stable-documentation rollout
[Pages checkpoint](https://github.com/hermawan22/varendo/actions/runs/38219004316)
published clean source `1c48d45b3680a3b9aa23095bec936a4954042e1f`, version 0.1.0,
after its [main-push quality run](https://github.com/hermawan22/varendo/actions/runs/38216529324)
merged all 93 acceptance commands from four successful shards. Pages verified
all four exported projects by installing and building against public npm 0.1.0.
The first source-selection attempt saw an empty successful-run index immediately
after CI completion; a retry passed the unchanged source gate. The live version
endpoint identifies later deployments independently. Container publication
remains a separate owner-run manual workflow with unchanged gates.

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

At those earlier checkpoints, advisory paired performance correctly rejected an
unapproved budget and visual comparison rejected the inherited fixture hash.
The fresh Varendo reference renewal below supersedes that metadata; it does not
relabel the historical failures. Planner latency remains diagnostic under ADR 014. Required functional quality and release-contract acceptance passed for the
explicit receipts above.

## Advisory reference renewal

The maintainer requested completion of visual and paired-performance acceptance
on 12 October 2026. Both reference records now bind reachable Varendo source
`e50eda3f3b34a2957e5cd1f9f9228c32d3e4c84a`, rather than commits present only in
the preserved upstream Git archive. The owner-dispatched
[reference probe](https://github.com/hermawan22/varendo/actions/runs/38230522021)
passed all 93 functional commands and the release contract, all three complete
visual probes and their aggregate, and the three-pair performance probe.

The [visual review](testing/0.1.0-visual-reference.md) records 1,830 tests and
2,862 unique PNGs with identical repeated captures, actual image inspection,
archive digests and the unchanged runner. The
[performance review](testing/0.1.0-performance-reference.md) records independent
source-manifest and raw-sample verification, three alternating pairs, the
unchanged 20% **and** 2 ms comparison policy, 4 ms reducer p95 and 100-row limit.
Probe artifacts retain their unapproved diagnostic results; acceptance is
recorded separately in the reviewed metadata. No workload, hash exclusion,
comparison threshold or workflow gate was weakened.

Ordinary strict comparisons use that fixed source for subsequent candidates;
their per-revision results remain available in
[main quality runs](https://github.com/hermawan22/varendo/actions/workflows/quality.yml?query=branch%3Amain).
These reference receipts are separate from the immutable npm publication above
and do not authorize an Aeliqo music-app change or a new package publication.

## Release completion and legacy retirement

The maintainer authorized all five Varendo 0.1.0 npm packages after verified
namespace authority on 12 October 2026. They are published from immutable source
`53406eeab85103fd0b1159e765ee3996e2b4ab70`; stable run 38210717157 verified
166 installed exports and source-bound provenance. The independent Aeliqo music
application's current state is tracked in [its STATUS](https://github.com/Arconath/aeliqo/blob/main/STATUS.md).
Its original **US$1 total** AI-test cap and unresolved
usage accounting remain in force; no further model call, reset or top-up is
implied by framework delivery or retirement.

Current execution state:

1. **GitHub presentation complete:** the profile README features Varendo, its
   repository is the first profile pin, and About links to HTTPS documentation.
   Other profile projects and personal links are preserved.
2. **Ownership and npm publication complete:** verified authority and account
   2FA preceded bootstrap, exact trusted-publisher setup, canonical RC and
   stable publication. All five stable packages passed registry consumers,
   provenance and independent integrity/latest-tag checks. Preserve the complete
   original npm acceptance record above; later documentation commits do not
   change the published source.
3. **Stable Pages deployed:** the fixed rollout checkpoint above serves clean
   source `1c48d45...`, with all four registry-backed ZIP projects verified during
   the build. Live browser verification rendered all four scenarios, and all four
   downloaded ZIPs independently matched the exact 0.1.0 package pins. The
   playground passed 360/768/1440-pixel overflow checks and keyboard navigation;
   guided-journey exports remained disabled as intended. Documentation navigation
   and the stable quickstart worked on the public base-prefixed routes. No model
   was called.
4. **Legacy runtime and container retirement complete:**
   [GitOps PR496](https://github.com/Arconath/platform-apps/pull/496) merged as
   `92ca531452e5fa724e3a4ebfb97d05e90c185bcc`. At 07:17 UTC on 12 October,
   **28/28 native checks passed**: both Flux units observed the merged source,
   legacy framework workload/service/config/image-automation resources were
   absent, no legacy-image pod remained in the owned namespace, retained music
   identity/image/generation and ready replicas were unchanged, and the existing
   PVC remained unchanged and Bound. Desired ingress/redirect configuration
   matched. **Five public docs redirects** returned 301 to working Varendo 200
   targets, including preserved path/query cases. Music health/readiness/version
   returned 200, apex returned 200, and www redirected to the retained music
   domain. These checks made **zero model calls**.
   The exact legacy GHCR package `ghcr.io/arconath/aeliqo-web`, ID **14891059**,
   was deleted and absence verified at 07:19:32 UTC. All **90** deleted versions
   matched the verified backup beforehand; that backup is retained. Music image
   package identity/metadata were unchanged. This operation deleted neither the
   old npm packages nor the public framework repository.
5. **Managed public repository removed:** reviewed [workspace PR127](https://github.com/Arconath/workspace/pull/127) and
   [infrastructure PR359](https://github.com/Arconath/platform-infrastructure/pull/359)
   removed the exact four legacy management declarations.
   Encrypted-state [PR361](https://github.com/Arconath/platform-infrastructure/pull/361)
   retained all 176 unrelated instances unchanged after
   forgetting those four addresses; the state lineage was preserved. A fresh
   pre-deletion plan reported no changes or imports and no recreation of the
   old repository. The exact public `Arconath/aeliqo`, repository ID
   **1359193467**, was deleted at 08:02 UTC on 12 October. Independent
   authenticated checks confirmed both its old path and numeric ID return 404.
   The private archived `Arconath/aeliqo-site`, new music app and its separate
   documentation repository, and Varendo retain their identities and visibility.
   The post-deletion plan also reported no changes, imports or recreation.
   Fresh native checks preserved the music deployment identity, generation,
   exact image and two ready replicas, plus the existing Bound PVC and volume;
   legacy workloads and image references remained absent. All five exact
   path/query redirects and complete destination responses passed. One
   destination initially timed out after 200 headers; bounded retries returned
   complete 200 bodies without changing TLS or network protections. Music public
   health/readiness/version responses passed. The shared mutation freeze was
   released after these checks.
   DNS, retained music data/backups, signed music-image rollback and existing
   holds remain outside the public-framework deletion scope.

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
performed. Permanent removal requires npm support consideration. The owner-approved
request was submitted through the official npm support form on 12 October 2026
at 06:51:50 UTC. The form confirmed successful submission; no case number was
displayed. A support decision remains pending, and no legacy npm deletion is
claimed.
Deprecation must not be described as deletion. See the
[official npm policy](https://docs.npmjs.com/policies/unpublish/).

The fresh advisory reference records above supersede the inherited approval
follow-ups. Visual and paired-performance results remain separate evidence from
the required functional matrix.

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
