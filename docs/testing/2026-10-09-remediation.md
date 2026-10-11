# Launch audit remediation

This work follows the eleven findings in the [9 October audit](2026-10-09-launch-audit.md)
and the owner's request to improve the landing page, documentation, and playground.
The owner selected a clean editorial direction. Publication, deployment, package
versions, and historical release evidence are unchanged.

## Corrections

| Finding                          | Source correction                                                                                                                   | Acceptance focus                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. OAuth credential disclosure   | Patched MCP client, explicit expected issuer, issuer-stamped credential reads, no issuer-validation bypass                          | Malicious discovery is rejected before credentials are sent; legitimate issuer and static bearer paths remain usable                                      |
| 2. DateRange form values         | Update the inherited form-value cache as well as ElementInternals                                                                   | Both endpoints survive native and wrapper submission                                                                                                      |
| 3. Stale asynchronous validation | Invalidate completed and pending validation when values or validators change                                                        | Same-turn races, reset/disconnect, thirteen controls, independent host errors                                                                             |
| 4. MCP action continuity         | Host-owned session with fresh request endpoints and explicit authenticated request identity                                         | Real SDK HTTP preview, host confirmation, execution, replay, expiry, revocation, scope changes, cancellation                                              |
| 5. Mutable admitted input        | Deep immutable input/metadata snapshot before asynchronous admission and protocol scheduling                                        | Mutation after invocation cannot replace admitted payload or bypass its limits                                                                            |
| 6. Invalid form focus            | Await the rendered error summary before focusing it                                                                                 | Slotted submit click and Enter                                                                                                                            |
| 7. Disabled fieldsets            | Honor the first direct legend for every disabled ancestor                                                                           | Native and FACE controls, nested fieldsets, serialization and public validity methods across three browsers                                               |
| 8. Eager component registration  | Register the base Region eagerly and load required families before publication; custom extensions retain full registration fallback | Standard views, custom compound dependencies, loading/version failure, cancellation and authority boundaries; installed React quickstart byte measurement |
| 9. Signed zero                   | Compare negative zero as numeric zero                                                                                               | Bounds/step validity and exact value/text preservation                                                                                                    |
| 10. Incomplete setup             | Root quickstart links complete contributor prerequisites                                                                            | Pinned Node, pnpm, Go, Python and browser installation guidance                                                                                           |
| 11. DCO policy drift             | Check author signoff on incoming commits using the accepted base checker                                                            | Real Git histories, matching author trailers, merge handling, trusted bootstrap, no retrospective certification                                           |

## Interface changes

The owner rejected the first spacing and typography pass as too similar to the
previous design. The revised site uses a site-owned neutral palette, a floating
header, a centered and shorter hero, and a wider live demo. Documentation adds a
guide hub and a distinct navigation panel while retaining component pages,
themes, search and reading paths. The palette does not change package defaults.
The playground puts its live result ahead of request evidence. Request details
start closed and remain keyboard accessible; all four scenarios, agent controls,
export, inspection and action confirmation remain available. Inspector close and
Escape explicitly restore focus to its opening control in WebKit as well.
Focus indicators use an opaque accent outline. A new regression reproduced
mobile toolbar controls hidden behind the floating header after scrolling;
the toolbar now stays below it. Hit targets, Inspector opening and Escape focus
restoration passed at 360 and 768 pixels in all three engines.
A development-only HTML transform keeps known site navigation on the local
preview; production destinations, canonical metadata and external links stay
unchanged. A real navigation regression covers the header, quickstart and footer.

## Evidence and limits

Focused checks reproduce the defects before correction and verify behavior after
correction. Independent review covers input semantics, MCP security/session
boundaries, selective registration, and site interaction preservation. Fresh
qualification receipts are retained under `artifacts/remediation-2026-10-09/`.
Final local qualification passed on clean source snapshot
`21c427b063ac537e0b4bbfa84c6a8e5263b00338` (tree
`e97171e97ad805f3c2b6323c5bddc4e978897568`):

- The complete `pnpm site:test` gate passed, including native WebMCP.
- All 93 commands in the unchanged `quality/commands.json` matrix passed.
  Independent receipt review matched every command and its log hash; source
  did not change during the run.
- Full visual suites passed 610 cases per engine in Chromium, Firefox and
  WebKit, 1,830 total. The revised interface separately passed 72 route/theme/
  width captures and 45 responsive interaction cases. Representative captures
  were inspected; this is not manual inspection of every case or approval of
  a new pinned Linux baseline.
- The final input regression suite passed 60 cases across the three engines
  with the maintained assertion deadlines and no retries.
- The local production image built from that same snapshot passed health,
  readiness, version, security/cache headers and shutdown contracts. Five
  representative main/docs/quickstart/component/playground routes returned
  200 and retained production navigation. The image was not published.

Machine-readable receipts include `qualified-matrix/verification.json`,
`qualified-matrix/artifacts/product-ci/ci.json`, `site-final-receipt.json`,
`input-final-receipt.json`, `qualification-final.json` and
`image-representative-routes.json` under the artifact directory above.
The temporary snapshot uses a Codex local author, without human contribution
certification. It is local qualification, not accepted main-push CI, a certified
contribution or a release revision. Final updates to this record, its plan and
STATUS are recorded separately from the qualified source; production source is
unchanged.

Focused source evidence: agent tests passed 155 cases; input tests passed 120
cases across Chromium, Firefox and WebKit before the final public validity-method
guards, followed by 40 Chromium cases and six focused fieldset cases across all
three engines after those guards. Registration/transaction checks passed 36 cases
across the same engines. Contributor policy passed 20 real-Git/workflow tests.
Site captures passed 72 route/theme/width cases across three engines; two WebKit
Inspector focus failures were then corrected and six focused interaction cases
passed across the three engines. An initial Chromium server-start race was
retained as a failed setup receipt and passed after the server became ready.

Integrated qualification attempts exposed three further integration defects:
missing lint entry points, the package boundary scanner rejecting permitted
fixed family imports, and outdated renderer test fixtures. Each was corrected
without reducing acceptance checks; failed and partial receipts remain intact.
The remaining thirty-command preflight passed on its recorded source snapshot.

The site gate then exposed a genuine WebMCP cancellation race: overlapping
automatic adaptations could abort a post-render presentation while registration
yielded. Adaptations now queue and apply the latest environment after an owned
presentation succeeds. New tasks, actions, revocation and disposal still cancel
stale work. Deterministic loading and held-commit regressions, 160 adaptation
unit cases, 36 browser cases and 13 site browser cases passed after correction;
two independent reviews found no cancellation or authority-boundary blocker.

The revised interface retains failed diagnostics for an incorrect Vite preview
alias setup and initial or host-load-sensitive development bootstrap assertions.
These do not constitute a successful cold-start or whole-matrix receipt.
The revised layout passed 72 route/theme/width captures and 45 responsive
interaction cases across the three engines, after the focus and toolbar fixes.
The later complete site gate and clean acceptance matrix passed on the snapshot above.

A clean site-gate attempt passed its preceding suites but failed the final native
WebMCP initial receipt assertion while the development module graph was still
loading and the boot screen remained visible. The trace records no page errors
or HTTP failures; unfinished requests were interrupted by test teardown. The
unchanged focused native test passed on repetition. This is retained bootstrap
diagnostic evidence, not a whole-site pass or a cold-start latency claim. No
assertion deadline, retry policy or performance budget was changed.

The final local navigation regression covers header, docs overview, docs brand,
breadcrumb, playground, quickstart and footer links. Existing development-only
link expectations were aligned with that intentional local routing contract;
raw production HTML continues to assert absolute production links. Assertions
and browser deadlines remain intact.

The installed React quickstart's initial static JavaScript graph measures
301,503 gzip bytes, compared with 385,615 for published 0.6.3 using the same
consumer toolchain (about 22% smaller). All emitted JavaScript measures 400,881
bytes, including 99,378 deferred bytes (about 4% larger overall). This diagnostic
has no new acceptance budget and is not a measurement of fetched bytes across
four questions, startup time or planner latency. Existing bundle gates passed.

WebKit's native nested-fieldset behavior differs from Chromium and Firefox:
the inner first legend can incorrectly escape an outer disabled fieldset.
Aeliqo's wrapper applies every ancestor explicitly. This correction does not
claim to change browser-native FormData outside Aeliqo.

These changes are unreleased. They do not establish real-model success rates,
external adoption, general assistive-technology acceptance, or fresh production
health. Historical failed audit receipts remain available and are not converted
into a successful whole-matrix result. Maintainer release approval and a verified
release revision remain necessary before publication.

The maintainer must require the new trusted-base `DCO` pull-request status in
GitHub branch protection after its first landing. The source adds that workflow
and keeps main-push signoff enforcement in the required quality policy; it does
not change remote protection settings or certify previously accepted commits.
