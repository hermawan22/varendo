# Aeliqo status

Last updated: 2026-10-09. This is the single maintained status record. Release
history lives in the [release notes](site/pages/release-notes.md) and on
[GitHub releases](https://github.com/Arconath/aeliqo/releases).

## Goal

Aeliqo is an Apache-2.0 framework that turns a validated intent into a
registered view. The same path works from application code or an optional
agent (MCP, WebMCP, or a bring-your-own-key model). The host application owns
data, permissions, routes, and business effects. Aeliqo needs no account,
hosted backend, license server, or model call.

## Published

| Surface  | Current                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm      | All five public packages at `0.7.1` on `latest`, source `1c0e9a4f0db95a08fd964890cb38204cae86826d`.                                                          |
| Site     | Site and embedded SDK source `1c0e9a4f0db95a08fd964890cb38204cae86826d`, SDK `0.7.1`.                                                                        |
| Image    | `ghcr.io/arconath/aeliqo-web@sha256:93ac05c7d2269353b27129abfd66259f103babdc1f0e94028de65faa0755fd54`; two Ready replicas with zero restarts.                |
| Delivery | Main-push quality `37917114993`, RC `37920436512`, stable publication `37922564840`, image `37923842277`, GitOps `b7cc12a790e474ac16d401a36c89be00f473bcb4`. |

Publication, deployment and the recorded public acceptance are complete for
0.7.1. [GitHub release 0.7.1](https://github.com/Arconath/aeliqo/releases/tag/v0.7.1)
is published; its tag resolves to the exact source above. The production receipts
and their coverage limits are recorded below. Package versions are never overwritten.

### Historical 0.7.0 published evidence

| Surface  | Published                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm      | All five public packages at `0.7.0` on `latest`, source `253b792d1bd870097ca5211727613dafdadab4e6`.                                                          |
| Site     | Site and embedded SDK source `253b792d1bd870097ca5211727613dafdadab4e6`, SDK `0.7.0`.                                                                        |
| Image    | `ghcr.io/arconath/aeliqo-web@sha256:3985097b71ce542e007bc7a83125f5c2194e8590a30fd10e5f11cf393322fc46`; two Ready replicas with zero restarts.                |
| Delivery | Main-push quality `37896852849`, RC `37899895151`, stable publication `37901439296`, image `37902968422`, GitOps `6e449cccc7d198a8a816db4e12a569048b967e07`. |

Publication and deployment of 0.7.0 were verified. Post-deployment acceptance
found an initial-render cancellation bug, so complete live acceptance was not
claimed for that release. The failed acceptance and subsequent 0.7.1 correction
remain recorded below. The historical GitHub release body is preserved, with an
appended link to the patch release.

### Historical 0.6.3 published evidence

| Surface  | Current                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm      | `@aeliqo/core`, `runtime`, `web`, `react`, `agent` at `0.6.3` (`latest`), published source `f697627b65aec0a1b0e81159fe13b9f19ddce74c`                                                                             |
| Site     | Site/embedded SDK source `f697627b65aec0a1b0e81159fe13b9f19ddce74c`, SDK `0.6.3`; anonymous OSS, no persistent staging                                                                                            |
| Image    | `ghcr.io/arconath/aeliqo-web@sha256:eea9879a3923756def7da9878e001761b13ad37e8e332a19f62667802d70ccf6`; two exact-image ready production replicas                                                                  |
| Delivery | Main-push quality `36814670613`, stable publication `36822915145`, production image `36824490075`, GitOps acceptance `414cb72723af0773153c73cb96737d579075a18d`; public acceptance and live verification complete |

All five 0.6.3 packages are published on `latest`. Canonical RC and stable
verification passed their registry consumers and source provenance at the exact
source above. [GitHub release 0.6.3](https://github.com/Arconath/aeliqo/releases/tag/v0.6.3)
is published as a stable release; its commit tag resolves exactly to
`f697627b65aec0a1b0e81159fe13b9f19ddce74c`. The canonical public-acceptance
record is committed and pushed on `platform-apps` main at
`414cb72723af0773153c73cb96737d579075a18d`. The previous
[GitHub 0.6.2 release](https://github.com/Arconath/aeliqo/releases/tag/v0.6.2)
records historical npm source `e86a6e2f8d7808d1a580a2d3c63ff33e7fa3b89b`.

**Current live evidence (2026-10-01):** final runtime readback at
`2026-10-01T06:50:10.200635Z` reports both `aeliqo-config` and `aeliqo` Flux
kustomizations Ready and Healthy, with applied and attempted GitOps revision
exactly `414cb72723af0773153c73cb96737d579075a18d`. Their current generations
6 and 23 are observed. Both non-terminating Ready pods use the exact desired
and running `eea9879` digest, source `f697627`, with zero restarts.

Initial runtime acceptance at 06:34 UTC reported both controllers Ready and
Healthy at promotion `83aaf375574871890224e3bfee2c0fd34e28af03`; deployment
generation 23 was observed and all replica counts were two. Canonical public
acceptance exited zero at `2026-10-01T06:34:20Z`, covering production health,
readiness, public revision, cache/security headers and routes.

The live smoke passed documentation search and the 71-component sidebar,
manual component/workspace/registered-page journeys, native experimental
WebMCP, and export ZIP dependencies at 0.6.3, with zero model calls. Thirty
focused public browser journeys passed at 06:37 UTC: 27 homepage, quickstart and
playground renders in Chromium, Firefox and WebKit at 360, 768 and 1440 pixels,
with zero axe violations or page errors, plus three no-JavaScript quickstart
keyboard/reflow checks at 320 pixels. All 36 public form/dialog cases also passed
in Chromium, Firefox and WebKit at 360, 768 and 1440 pixels, with no skipped,
unexpected or flaky tests. All nine live saved-default PNGs were independently
inspected with no actionable visual findings. The form/dialog run started at
`2026-10-01T06:38:30.901Z` and completed in 76.7 seconds. Live verification is
complete. Accessibility evidence covers these recorded routes and states;
general assistive-technology acceptance remains unverified.

## Progress against the goal

- **Done:** intent-to-view for components, workspaces, and registered pages;
  71 documented components; React, Vue, Vanilla, and Next SSR consumers; agent
  tools that accept a minimal intent and return ready-to-send examples; a
  standalone local MCP/BYOK example; a public playground with manual controls
  and native WebMCP.
- **Partly done:** render-tool diagnostics now include valid context choices
  for common field, view, measure, filter-value, and time-grain errors, and
  distinguish a malformed measure object from an unknown meaning. A
  `renderer-ready` result confirms visibility; `plan-committed` does not.
- **Not proven:** no measured success rate with a real model on the 0.6 tools,
  no external adopters yet, and WebMCP still needs an experimental browser
  flag.

Field/data-status direction and context-aware diagnostic hints first published
in `0.6.2` remain in `0.6.3`. The factual JSON-LD and gtag queue fixes remain
live on the current verified source.

### Historical 0.6.2 visual evidence

The retained Chromium visual review of source `4b86ed9` inspected 513 images,
including all 71 catalog components at three sizes and all visualization states.
Table/comparison narrow RTL overflow is intentional; fresh focused keyboard
scroll and geometry checks passed. The review found a synthetic form-flow
invalid state claiming an empty required name while showing the populated
catalog example. Its fixture now clears the displayed field and draft together,
requires the field, and asserts the actual empty value. The prior fixture failed
the new assertion; all nine browser/size variants and visual TypeScript checks
passed after correction. No component, package or live site behavior changed.
The historical clean fixture source `4a7562f4f552ba1349c487243ad81aa047d1b6ae`
passed required quality `36672716809`. Its pinned Linux full visual aggregate
contains 1,830 tests and 2,862 PNGs: 610 tests/954 images per browser, two
byte-identical captures, sourceBuilt=true and candidateDirty=false. Fixture
SHA is `5f1e2c7b664412af5b79572b16db1935d1f835238f9a504f84932ebbbc096625`.

**Baseline approval, 30 September 2026:** root deliberately approves this
source/fixture and the exact recorded container, browsers and fonts after
review by root, Luna visual reviewer and an independent Sol metadata reviewer.
The retained Chromium review covers all 71 catalog components at three sizes
and visualization/important states; current inventory matches, 951/954 images
are byte-identical to that reviewed source, and all three corrected invalid-form
frames were reviewed. Firefox and WebKit each had all 954 images inspected in
contact sheets, all 71 desktop component images and 21 important state images
inspected at full resolution. Narrow RTL tables retain intentional horizontal
scrolling. This does not claim exhaustive full-resolution review of all 2,862
images or assistive-technology acceptance. The exact runner and two-capture,
zero-diff policy are recorded in `scripts/visual/baseline.json`.

Strict pinned-image comparison passed on approval commit
`6e1ab03f405c8c50b4238144fd952440c2c92e8d`, quality run `36682155398`.
Its fresh aggregate reports approved=true, full scope, 1,830 tests and 2,862
images across Chromium, Firefox and WebKit against the exact fixture SHA above.
The required functional shards, aggregate and release contract also passed.
The earlier probe stays `probe-reproducible-unapproved`; it is not relabeled.
The paired performance job failed before measurement because its workload
hash differed from the old baseline. Qualification was owner-deferred on
30 September. The later 1 October planner timing policy and 0.6.3 release
evidence are recorded below; this historical report is not relabeled.

## Historical release: 0.6.3

The owner requested all outstanding fixes and a release on 1 October 2026.
All five packages and the same-source production image are published and live.
Live verification, the committed acceptance receipt and the GitHub release
record are complete. Package versions, peer pins, examples and current
installation instructions align at 0.6.3. Public APIs and runtime/wire contracts remain
compatible with 0.6.2.

1. **Next.js security fix — published:** the integration fixture uses
   security-patched Next.js 16.3.6. The frozen installation, optimized production
   build and real SSR/hydration checks passed; the fixture does not use
   ImageResponse. GitHub alerts 3 and 5, which identify the same Node `next/og`
   ImageResponse RCE, are fixed and there are zero open alerts.
2. **Form and dialog repairs — verified:** double-click Done preserves trigger
   focus using the `mousedown` click count before default focus behavior. Saved
   widgets reset only unchanged fields to registered defaults and preserve newer
   edits. Presentation adaptation waits for the action to settle, then resumes
   for the current region with the existing task and authority checks. Independent
   review found no actionable issues. The required matrix includes the
   three-browser action-review regression and now has 93 commands. All 36
   site form/dialog browser/width cases passed on the release source, and all
   36 corresponding production cases passed without skips or flaky outcomes.
3. **Final source quality and visual evidence — passed:** local clean source
   `599421e4` passed all 93 commands without source changes. Pull request
   [quality run 36812332528](https://github.com/Arconath/aeliqo/actions/runs/36812332528)
   passed the full 93-command matrix. Exact final source
   `f697627b65aec0a1b0e81159fe13b9f19ddce74c` passed the same full matrix and
   release contract in main-push
   [quality run 36814670613](https://github.com/Arconath/aeliqo/actions/runs/36814670613).
   Its approved visual aggregate passed 1,830 tests and 2,862 images across
   Chromium, Firefox and WebKit, with zero pixel differences and byte-identical
   repeated captures against approved source `6c31d36`. The fixture SHA is
   `99515fd220704b5ea51993d0090c802ec8ecf0e1b47f64a4c07d25fa8ce8ee79`;
   the [visual reference review](testing/0.6.3-visual-reference.md) preserves the
   approval evidence and review scope.
4. **Planner timing policy — removal verified:** the owner permanently removed
   the absolute presentation-planner timing gate on 1 October, as recorded in
   [ADR 014](adr/014-planner-timing-diagnostics.md). Configuration, policy
   validation, browser assertions, paired-report acceptance and contributor
   guidance treat planner timings as diagnostic, with no replacement threshold.
   Existing reducer, mounted-row, relative comparison, provenance, functional
   and visual policies remain. The changed workload identity retired the earlier
   performance reference; the current reference is unapproved and comparison
   evidence remains advisory. No new performance baseline is required to release.
   The earlier [performance reference review](testing/0.6.3-performance-reference.md)
   preserves its historical measurements and approval evidence.
5. **Package publication — verified:**
   [RC run 36821306728](https://github.com/Arconath/aeliqo/actions/runs/36821306728)
   and [stable run 36822915145](https://github.com/Arconath/aeliqo/actions/runs/36822915145)
   succeeded at exact source `f697627`. Canonical `verify-approved-rc` and
   `verify-approved-stable` both passed all five registry consumers and source
   provenance. Stable 0.6.3 is now `latest` for all five packages.
6. **Image, live promotion and release receipts — complete:**
   [image run 36824490075](https://github.com/Arconath/aeliqo/actions/runs/36824490075)
   succeeded with registry-verified SLSA provenance and SBOM, and zero high or
   critical findings. Its immutable digest is the published `eea9879` image
   above, with site/SDK revision `f697627` and SDK 0.6.3. Reviewed and validated
   canonical preflight promoted GitOps revision `83aaf375`; Flux, replicas and
   canonical public acceptance and all recorded public UI cases passed. Independent
   review of the GitOps acceptance record found no actionable issues. That record
   is pushed in commit `414cb72723af0773153c73cb96737d579075a18d`, and the final
   runtime readback matches it exactly. The stable
   [GitHub 0.6.3 release](https://github.com/Arconath/aeliqo/releases/tag/v0.6.3)
   is published with its tag at the exact verified source.

The initial 0.6.2 performance failure was a workload-identity mismatch, not a
measured regression: the digest at that time was
`c9f7283566889e784043cc07703215c6ca882dfdd45da284dc9849e6326314fb`
and the historical approved digest is
`867fadc9677857bbbca368716c9d52a78d97e7e5cb419f66207e1d42ed65c913`.
The changed fixture opens the collapsed exact-data disclosure and uses current
row copy; the bundle threshold change was already owner-approved for 0.6.0.
The historical source `dcb9837` passed its strict paired comparison against
`d90a2c8` in
[run 36775350492](https://github.com/Arconath/aeliqo/actions/runs/36775350492)
under the policy then in effect. Later final-source comparisons recorded planner
p95 of 17 ms under the former rule; an unchanged-source recheck failed on the
reference at 18.1 ms before measuring the candidate. An exact-source probe
recorded 14.9/16.3 ms and stopped early; its companion comparison recorded
15.5/16.2 ms. These failed reports remain historical evidence; no observations
were discarded or relabeled as passing. Workload identities and the remaining
policies are still verified. This release makes no latency speedup claim.

The site is stateless, so there is no data migration. The previously accepted
immutable `cebbb901` image and source `fb04d4a` remain the rollback target;
application rollback does not unpublish npm versions. This is recovery readiness
only: no executed disaster restore, relocation or live rollback drill is claimed.
The required pull request and exact-source full-matrix main push are complete.

## Historical 0.6.2 site repair

The previously accepted site/SDK source was
`fb04d4a752fb1357a6ab2c6aaf4969aafbd22aa4`, SDK 0.6.2, image
`ghcr.io/arconath/aeliqo-web@sha256:cebbb901d898ee677af05a4b79c1715fac87bfdfb44e3e578f2e8ab983a2b3ca`,
at GitOps pin `658b6703a13e2bb7ab9afa9eaa069f211b3f3589`. This historical
acceptance remains the qualified rollback target; it is not the current image.

Focused live Chromium review on 30 September 2026 exercised the homepage,
docs quickstart and playground at 360 and 1440 pixels. Homepage filtering and
trend, docs shortcut/search, and playground filtered/chart/workspace/page
journeys passed without page errors. The mobile quickstart table triggered
axe's `scrollable-region-focusable` finding: its 608-pixel content sits in a
326-pixel container without a keyboard tab stop. This review does not establish
screen-reader acceptance or repeat all browser/component coverage.

The findings above are now fixed in the reviewed site/docs change. The quickstart
results table reflows at 320, 360, 768 and 1440 pixels, keeps intent identifiers
on one line, and remains a named keyboard focus stop with or without JavaScript.
The narrow playground task chooser now precedes the result in both visual and
DOM order. README and introductory guides distinguish standalone components,
the smaller local React surface, and the registered-resource quickstart.

Fresh local verification passed `pnpm format:check`, `pnpm lint`,
`pnpm site:test`, `pnpm test:docs-artifact` and `pnpm site:build`, plus the
production image contract smoke. A focused review of that local image passed
27 homepage/quickstart/playground renders in Chromium, Firefox and WebKit at
360, 768 and 1440 pixels, with no page errors or settled axe findings, and
three no-JavaScript keyboard/reflow checks at 320 pixels. Independent source
and focused screenshot review supported the changes. These checks used a
modified local tree; they do not replace exact-commit CI or deployment evidence.

The first release CI run caught a Linux font-dependent overflow at 320 pixels.
Prose in the quickstart table now has additional word-wrap opportunities while
intent identifiers stay unbroken. Regression coverage also exercises a wider
fallback font. Clean source `b5b2cb054820f624e0095d96a690ca063419b9fa`
passed all 92 local acceptance commands and required CI `36739295753`, plus
the approved pinned Linux visual aggregate. Site build `36749158528` then
rejected `scripts/visual/baseline.json` as a package change. The site-only
classifier now permits that exact visual evidence file; package source,
package guides, the lockfile and other scripts remain rejected. An executable
regression reproduced the rejection before the fix and all 32 release-tooling
tests passed afterward. Exact-source quality run `36750567829` passed all
required checks; production image run `36759903067` and live acceptance for
source `fb04d4a` passed. A post-release fix to the live smoke test's search
initialization wait was verified against production without changing the
deployed image or package artifacts.

## Repository follow-up, 2 October 2026

The current support matrix points to the 0.6.3 release receipts and separates
required functional acceptance from advisory visual and paired-performance
evidence. The historical 0.6.0 records remain available. This documentation
update does not publish packages or deploy a new site image.

## Release 0.7.0 and initial 0.7.1 qualification

The owner authorized publication and production deployment on 9 October.
[PR 57](https://github.com/Arconath/aeliqo/pull/57) integrated the eleven audit
corrections and revised landing page, documentation, and playground.
[PR 62](https://github.com/Arconath/aeliqo/pull/62) prepared the breaking OAuth
migration, patched dependency advisories, Go 1.27.2 server builder, and the
quarantine-first production publisher at final source
`253b792d1bd870097ca5211727613dafdadab4e6`.

That source passed all 93 acceptance commands in main-push
[run 37896852849](https://github.com/Arconath/aeliqo/actions/runs/37896852849).
Independent verification matched all 93 raw log hashes, the unchanged matrix,
and the unchanged source. Its release contract verified the five tarballs and
166 exports, documentation, and the local production-image contract.

[RC 37899895151](https://github.com/Arconath/aeliqo/actions/runs/37899895151)
and [stable 37901439296](https://github.com/Arconath/aeliqo/actions/runs/37901439296)
published all five packages through trusted publishing. Canonical registry
consumers passed; independent public-registry review matched tarball bytes,
integrities, signatures, exact internal pins, and source-bound provenance.
[Image 37902968422](https://github.com/Arconath/aeliqo/actions/runs/37902968422)
verified attached registry provenance and SBOM, reported zero HIGH/CRITICAL
findings, and promoted the identical OCI index from quarantine. Eight retained
artifact checksums and independent identity checks passed. Anonymous GHCR
re-fetch was unavailable; registry verification is evidenced by the successful
trusted CI. No independent scan rerun is claimed.

Flux automatically promoted GitOps revision `6e449cccc7d198a8a816db4e12a569048b967e07`.
Both controllers were Ready and Healthy; deployment generation 7 was observed,
all replica counts were two, and both non-terminating pods ran the exact image
above with zero restarts. Both public `/version` endpoints reported SDK 0.7.0
and the exact source. Health/readiness, cache/security headers, representative
routes, both `llms.txt` endpoints, canonical/social metadata and the 1200×630
card passed. Live smoke passed search, the 71-component sidebar, component,
workspace and registered-page journeys, native experimental WebMCP and a ZIP
with the three required Aeliqo dependencies pinned to 0.7.0, with zero model calls.

Thirty public UI cases passed across Chromium, Firefox and WebKit, including
360/768/1440 layouts and 320-pixel no-JavaScript keyboard/reflow checks. The first
private harness incorrectly required an `aria-label` on a code block that uses
a figure caption; that failed run is retained. The corrected harness checks the
actual caption and preserves keyboard, reflow, content and accessibility checks.
Nine Chromium public screenshots received independent review. One minor narrow
quickstart table readability issue is included in the patch.

The separate 36-case production form/dialog run passed 29 and failed seven.
Traces and a deterministic headless runtime reproduction show that the initial
Region captured a temporary result before the first render committed. Aborting
or superseding that render leaves the next create request with an unavailable
result reference. Waiting for the aborted request to settle does not repair it.
Earlier supersession tests began from an already committed view and missed this
initial-mount case. This is a runtime defect, not a passing live acceptance.

The initial 0.7.1 candidate kept the 0.7 API and wire version 1. It excluded
unpublished results from the initial Region read set, added initial-mount
cancellation regressions, showed the current playground request as pending,
and improved narrow question labels. At that stage it still required a new
fully verified main revision, registry RC, stable publication, image and complete
public acceptance; the published table remained at 0.7.0.

[PR 63](https://github.com/Arconath/aeliqo/pull/63), source
`0abfb55b5429179801af6d06b8ba05f8b55db863`, passed all 93 commands in
[run 37906770693](https://github.com/Arconath/aeliqo/actions/runs/37906770693).
Independent verification matched all 93 raw log hashes and confirmed that its
tree equals merged main `c802208cf5cb9d0a2546c725ce623999fef4d404`. However,
attempt 1 of that main source's required push
[run 37910239474](https://github.com/Arconath/aeliqo/actions/runs/37910239474)
failed shard 0: `tests/runtime-presentation/browser/atomic-review.spec.ts:50`
lost the accepted semantic interaction. The release-contract job completed
successfully; independent review matched its five tarballs, 166 exports,
canonical guides/legal files, generated documentation and local image inputs.
That job does not replace the failed full-matrix qualification.

A private controlled browser probe confirmed that a stale projected interaction
can overwrite an accepted value across the renderer-registration await during
automatic layout preparation, including a control using the published 0.7.0
implementation and a valid declared selection port. The correction captures
the live presentation and interaction before that await and rejects stale
preparation. The new maintained regression failed before the correction and
passed after it in Chromium, Firefox and WebKit. The full unchanged
presentation browser command passed 123 cases, including all 21 original
atomic cases and the three new regression cases; independent security review
found no blocker. These local results did not replace required main CI.
The correction introduced no new API, wire contract or version change. The
unpublished `c802208c` candidate was superseded as the intended publication
source and was not qualified for release. At that point 0.7.1 had not been
published or deployed; the corrected source still required a fresh full same-SHA
main-push success and all subsequent registry, image and public acceptance steps.

The optional visual comparison for `c802208c` also stopped before build or
capture: the only changed hashed fixture was the private catalog example's
version, from 0.6.3 to 0.7.1. Paired performance stopped before measurement on
its unapproved budget. The retained advisory audit establishes neither pixel
comparison nor performance results; these jobs remain separate from the
required shard failure. No baseline approval or quality gate was changed.

Optional approved-reference visual comparison on final 0.7.0 main stopped
before build or capture: only the private catalog example version changed,
which changed the fixture hash. No final-source pixel or repeat-capture result
is claimed. The approved comparison on earlier integration source `3205517`
remains earlier-source evidence. Required three-engine visual behavior tests
passed within the 93-command matrix. Paired performance stopped before
measurement because its budget/reference is unapproved; it remains advisory.
No baseline approval, latency threshold, or quality gate was changed.

Contributor rollout is verified: remote main requires `DCO`, `functional` and
`policy`, each bound to GitHub Actions app `15368`, with strict branch freshness.
Readback preserved every other protection setting. The additive provider
configuration passed independent review and Linux CI.

## Release 0.7.1 production acceptance

[PR 64](https://github.com/Arconath/aeliqo/pull/64) integrated the interaction
correction. Final frozen main source
`1c0e9a4f0db95a08fd964890cb38204cae86826d` passed all 93 unchanged acceptance
commands in [run 37917114993](https://github.com/Arconath/aeliqo/actions/runs/37917114993).
Independent verification matched all 93 raw log hashes and the exact source.
This successful main revision supersedes the failed, unpublished `c802208c`
candidate; it preserves the 0.7 API and wire version 1.

[RC 37920436512](https://github.com/Arconath/aeliqo/actions/runs/37920436512)
and [stable 37922564840](https://github.com/Arconath/aeliqo/actions/runs/37922564840)
published all five packages from that same source. Canonical registry consumers
and independent public-registry audits matched all five tarballs byte for byte,
their SHA256/SHA512 integrities, exact internal pins, canonical guides/legal
files and all 166 exports. Cryptographic verification passed npm registry
signatures and Sigstore-backed publication and SLSA provenance for every package,
bound to the expected source, workflow and run. Stable `latest` is 0.7.1;
`next` remains 0.7.1-rc.1 at the recorded registry readback.

[Image 37923842277](https://github.com/Arconath/aeliqo/actions/runs/37923842277)
published the exact OCI index shown in the current table. Attached registry
provenance, SBOM and quarantine-to-final identity checks passed; the retained
scan reported zero HIGH/CRITICAL findings. Independent security review matched
all eight artifact checksums, source/version, index and runtime configuration.
Anonymous GHCR re-fetch returned 401, so attached registry verification remains
evidenced by trusted CI; no independent image scan rerun is claimed. The SBOM and
scan cover the reported image contents, not an exhaustive future advisory check.

Automatic GitOps revision `b7cc12a790e474ac16d401a36c89be00f473bcb4` changed
only the image reference. Deployment generation 8 was observed, with two ready,
updated and available replicas, zero terminating replicas and zero restarts.
Both non-terminating pods matched the exact desired index and configuration and
ran as UID/GID 101. Both Flux controllers were Ready and Healthy, with applied
and attempted revisions equal to that GitOps revision. Both public domains
reported site/SDK source `1c0e9a4f0db95a08fd964890cb38204cae86826d` and SDK 0.7.1.

All 18 public HTTP checks passed: health/readiness, version identity, both
`llms.txt` endpoints, 404 behavior, representative home/docs/quickstart/playground/
migration/release-note routes, canonical/social metadata, security/cache headers,
immutable hashed assets and the actual 1200×630 social card. Public smoke passed
search, all 71 sidebar components, four application journeys, native experimental
WebMCP and ZIP export with all three Aeliqo dependencies pinned to 0.7.1. These
checks made zero model calls.

All 45 public form/dialog cases and all 30 public UI cases passed in Chromium,
Firefox and WebKit, with no skipped, unexpected or flaky tests and no retries.
The UI cases cover 360/768/1440 layouts and 320-pixel no-JavaScript keyboard/reflow.
The first UI attempt passed 29 of 30; its WebKit native keyboard-scroll failure
and an isolated reproduction are retained. A plain native HTML control also
reproduced zero scroll with immediate synthetic keydown/keyup, while three
production and three plain native controls scrolled with a 100 ms native key
duration. This supports a private synthetic-input timing explanation; WebKit's
internal mechanism was not instrumented. The corrected private harness retained
all four native ArrowRight inputs, focus, no-JavaScript, reflow and scroll
assertions, and the original polling and test deadlines. No product source or
CSS correction, assertion weakening or retry was used for this diagnosis.

Independent review inspected nine actual Chromium full-page production captures:
home, quickstart and playground at 360, 768 and 1440 pixels. No blocking visible
defect was found. These still images and recorded browser checks do not establish
an approved-reference pixel comparison, exhaustive assistive-technology support,
real-model success or external adoption. Optional visual and paired-performance
evidence remains advisory and does not acquire baseline approval from this release.
On final source `1c0e9a4f`, optional visual comparison stopped before build or
capture on the catalog-version fixture hash; paired performance stopped before
observations because its budget was unapproved.

The retained `release-0.7.1-identity.json` and
`production-0.7.1-final-acceptance.json` under
`artifacts/remediation-2026-10-09/` bind these receipts to the source and image.
The final 30-case report and sidecars are retained in
`public-ui-0.7.1-native-key-duration-evidence/`; the archived failures and
`public-ui-0.7.1-webkit-keyboard-diagnosis/diagnosis-report.json` preserve the
diagnosis separately. The two runtime defects above are closed by this source's
regressions, required main qualification and complete recorded public acceptance.

## Open items

The [9 October launch audit](testing/2026-10-09-launch-audit.md) records the
original OAuth, form, validation, MCP action, input-admission, performance and
contributor-flow findings. Its local matrix stopped on a controller-commit
performance gate; an isolated repeat and the remaining commands passed.
The [remediation record](testing/2026-10-09-remediation.md) tracks source
corrections for all eleven findings and the revised site/docs/playground design.
Clean local snapshot `21c427b063ac537e0b4bbfa84c6a8e5263b00338` passed the
complete site gate and all 93 unchanged acceptance commands, 1,830 full visual
cases across three engines, 60 final input regressions, and same-source local
production image contracts plus five representative routes. Independent review
verified the command/log receipts and source identity. The snapshot is locally
authored by Codex without human contribution certification; it does not replace
accepted main-push CI or a maintainer release revision. The local snapshot remains historical evidence; the accepted publication,
deployment, and post-deployment findings are recorded above.

| Item                                                           | Next step                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Real-model success rate and external adoption remain unproven. | Collect evidence from real integrations without inferring model success from deterministic tests. |
| Native WebMCP requires an experimental browser flag.           | Keep the experimental scope explicit while baseline browser availability remains unproven.        |

The planner policy removal and patched Next.js release are complete; neither is
an open release blocker. Visual and paired-performance jobs are advisory; the
functional matrix in `quality/commands.json` is the required gate. Aeliqo keeps
its GitHub-hosted OSS and site-release workflows; hosted-product auth, billing
and staging do not apply.
