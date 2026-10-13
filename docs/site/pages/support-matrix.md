---
id: 'support-matrix'
path: '/ship/support-matrix/'
section: 'Releases'
title: 'Support matrix and release acceptance'
description: 'Varendo 0.2.0 profiles, tested source revisions, and release qualification boundaries.'
---

<p class="lead">Varendo 0.2.0 targets the maintained profiles below. Recorded source checks cover framework consumers, browser behavior, and bounded workloads. Release qualification, package publication, and production deployment are verified separately.</p>
<varendo-release-status></varendo-release-status>

The [machine-readable source record](https://github.com/hermawan22/varendo/blob/main/docs/support-matrix.json)
identifies the revisions and checks that were tested, with profile limits
preserved independently from publication. Varendo 0.2.0 is an unpublished
source candidate that renames the remaining identifiers; it is not yet
qualified for release. All five 0.1.0 npm packages were verified from source
`53406eeab85103fd0b1159e765ee3996e2b4ab70`; this does not qualify a later
source commit or production container deployment.

The [full main-push quality run](https://github.com/hermawan22/varendo/actions/runs/38203288539)
passed all 93 acceptance commands at the published source. The
[canonical stable publication](https://github.com/hermawan22/varendo/actions/runs/38210717157)
verified all five installed packages, 166 exports and source-bound provenance.
Historical Aeliqo acceptance remains in the preserved release records and does
not qualify changed Varendo source. The publication banner follows this verified
release metadata. The public
[`/version`](https://hermawan22.github.io/varendo/version) endpoint identifies the deployed site.

## Maintained profiles

| Area              | Profile                                                                                                     | Tested boundary                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain         | Node 24.20.0, pnpm 11.24.0, TypeScript 7.0.2, Vite 8.2.2, Playwright 1.63.0                                 | The repository pins these versions for its acceptance checks.                                                                                                           |
| Frameworks        | Vanilla DOM, Lit 3.3.3, React 19.2.8, Vue 3.5.42, Next 16.3.8                                               | Installed package consumers and SSR/hydration checks. Svelte and Angular are unverified.                                                                                |
| Browsers          | Chromium, Firefox, WebKit                                                                                   | Browser behavior, accessibility, responsive geometry and visual captures. Container pixel comparisons provide advisory evidence.                                        |
| Native WebMCP     | Chromium 153.0.8010.12 with `WebMCPTesting` enabled                                                         | Native discovery, invocation, component/workspace/page rendering, cancellation, disposal and reset checks. The browser capability is experimental and must be detected. |
| Agent integration | No-model operation, local protocol fixtures, standalone MCP HTTP/stdio, optional server-owned model adapter | Protocol and deterministic fixtures do not establish hosted-model quality. No current live-provider profile is qualified.                                               |
| Composition       | Components, multi-result workspaces and registered pages with application-owned header/sidebar views        | Installed consumers, state continuity, guarded draft exits, cancellation and revocation. [Run the composition tutorial](/guides/workspace/).                            |
| Workloads         | Synthetic reference journeys, paged data, and 1,000 declarations with five active surfaces                  | Bounded workloads under recorded conditions; they do not establish production database throughput or unlimited scale.                                                   |

## Recorded source checks

The [current status record](https://github.com/hermawan22/varendo/blob/main/docs/STATUS.md)
tracks each candidate separately from published source revisions and their
93-command main-push matrices, package receipts, and production verification.
Earlier release receipts do not qualify changed 0.2.0 source. The
[visual reference review](https://github.com/hermawan22/varendo/blob/main/docs/testing/0.6.3-visual-reference.md)
records the approved comparison evidence and its review scope. Container visual
and paired-performance CI jobs are advisory; the functional matrix and release
contract are the required gates.

The [performance reference review](https://github.com/hermawan22/varendo/blob/main/docs/testing/0.6.3-performance-reference.md)
preserves historical three-pair measurements. Under
[ADR 014](https://github.com/hermawan22/varendo/blob/main/docs/adr/014-planner-timing-diagnostics.md),
presentation-planner timings are diagnostic only, with no absolute latency gate.
The changed workload retired the earlier reference; the current reference is
unapproved, so current paired-performance qualification is not claimed. Reducer,
mounted-row, relative comparison, provenance, functional and visual policies
remain in force. Final release receipts bind acceptance to the source that
actually published each artifact; the Varendo image remains unpublished.

Follow [WebMCP setup](/agents/webmcp/) for the tested experimental flag path.
Native, simulated and unavailable-browser results are separate evidence.
Provider independence means agents can submit bounded requests through common
contracts; it does not mean every provider uses the same wire format or has
passed a quality evaluation. Read the [shipping guide](/ship/) for application checks.

## Historical 0.5.2 record

The former matrix is preserved byte for byte in
[`docs/releases/0.5.2/support-matrix.json`](https://github.com/hermawan22/varendo/blob/main/docs/releases/0.5.2/support-matrix.json).
Its original candidate metadata and qualified profiles describe that historical
record. They are not acceptance for 0.2.0.

That record includes a bounded DeepSeek `deepseek-flash` run: 12/12 synthetic
J1–J3 browser/provider/renderer cases on tree-equivalent PR head `21afcca`
(tree `955a7d1`), recorded in the
[sanitized case receipt](https://github.com/hermawan22/varendo/blob/main/docs/releases/0.5.0/evidence/deepseek-flash-j1-j3-21afcca.json).
It qualifies only that recorded model, corpus and source context. It does not
establish other model quality, production workloads, human assistive-technology
use, or current-release acceptance.
