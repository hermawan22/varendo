# Aeliqo open source launch audit

Audit date: 9 October 2026, Asia/Jakarta.

Aeliqo is already public and installable as an Apache-2.0 project. Its packaging, public quickstart, documented boundaries, and contribution infrastructure support early adoption. A wider launch announcement should wait for the OAuth credential issue and the form and action defects below to be corrected. Passing the existing acceptance checks does not refute these independently reproduced failures.

The engineering foundation is substantial. The largest remaining gaps are correctness across component compositions, the cost of the promoted application entry point, and evidence from people integrating the framework outside its own fixtures. Adding more components would not resolve those gaps.

## Scope and release identity

- Audited checkout: `7e655b5dded41b929d67e6f5d66ac02cdf8713da`, branch `claude/seo-geo-baseline`, initially clean.
- Public packages: five packages at `0.6.3`, published source `f697627b65aec0a1b0e81159fe13b9f19ddce74c`. The [stable release](https://github.com/Arconath/aeliqo/releases/tag/v0.6.3) was published on 1 October 2026.
- Package sources, root dependency manifest and lockfile, and the standalone local-agent example have no diff between that published source and the audited checkout. The reproduced package defects therefore concern existing 0.6.3 behavior, rather than a new package implementation on this branch.
- Latest main observed through GitHub during the audit: `d3cf8fb`. [Run 37350153433](https://github.com/Arconath/aeliqo/actions/runs/37350153433) passed the site lane. It is not a full-matrix result.
- Historical publication evidence: [run 36814670613](https://github.com/Arconath/aeliqo/actions/runs/36814670613) passed the full functional shards and release contract for the published source.
- Local toolchain: Node `24.20.0`, pnpm `11.24.0`, Python `3.14.7`, Go `1.27.0`, macOS arm64. Isolated component probes used installed Chrome `154.0.8037.98`; the repository checks use pinned Playwright browsers.

This is a repository, package, interface, and launch-readiness audit with sampled implementation review and local reproductions. No source remediation, merge, package publication, deployment, paid model evaluation, or attack against a live service occurred.

## Findings to correct before wider promotion

### 1 OAuth credentials can reach an authorization server named by the MCP server

**P1, confirmed, optional MCP HTTP OAuth profile.** `packages/agent/src/mcp/client.ts:294` forwards an OAuth provider to the transport. `packages/agent/package.json:81` and `:97` pin `@modelcontextprotocol/client` to `2.0.0`. The origin allowlist checks the initial MCP resource URL; it does not bind the provider's credentials to an authorization server.

An isolated reproduction allowed only `https://resource.example` as the MCP origin. Mocked resource metadata selected `https://attacker.invalid` as the authorization server. A bundled `ClientCredentialsProvider` without an issuer binding sent a dummy client secret to that server's token endpoint. Every request retained `redirect: 'error'`; this path uses metadata discovery rather than an HTTP redirect.

The prerequisite is a consumer supplying an unbound OAuth provider or stored credentials while connecting to an untrusted or compromised MCP server. The demonstrated impact is disclosure of those OAuth credentials. It does not establish exposure of the static site, stdio clients, or the example's bearer-authenticated local server.

Update the affected client pins and lockfile to a patched version, and establish the expected issuer for bundled providers and persisted credentials. An upgrade alone does not secure unbound legacy credentials. These requirements and affected configurations are detailed in the [SDK maintainers' advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h).

**Verification:** mock malicious authorization metadata and assert that a mismatched issuer prevents any credential-bearing token request. Also prove that the configured issuer succeeds. Evidence: `artifacts/audit-2026-10-09/aeliqo-mcp-oauth-audit.mjs` and `aeliqo-audit-oauth-reproduction.log`.

### 2 DateRange values disappear from Form submission

**P2, confirmed data loss.** `packages/web/src/input/date-range.ts:176` writes directly to `ElementInternals.setFormValue`, bypassing the inherited setter that maintains the public `formValue` cache. `packages/web/src/input/form.ts:119` serializes that cache and skips the range because it stays `null`.

A valid named DateRange with both endpoints inside `<aeliqo-form>` passes validation but produces an empty FormData. The same element inside a native `<form>` produces `period[start]` and `period[end]`. Source and compiled package export targets reproduced the difference. A successful submission can silently omit a period the user entered.

Use the inherited `setFormValue` for null and FormData branches. Add a browser and clean-tarball composition regression for DateRange inside Form, covering valid, invalid, disabled, updated, and reset states. The existing DateRange consumer at `tests/consumers/input-tarballs.mjs:350` tests the native-form path, while the wrapper consumer covers simpler text fields.

**Verification:** both form compositions must submit the same endpoints for a valid range and omit them only in the documented states. Evidence: `aeliqo-architecture-probe-results.json` in the audit evidence directory.

### 3 Old validation results reject newer values

**P2, confirmed asynchronous race.** `packages/web/src/input/base.ts:464` defaults its current-value guard to `true`. TextControl invalidates validation when its value or validator changes at `packages/web/src/input/text-control.ts:103`; the tested NumberField, Select, and DateField paths do not provide equivalent protection.

Start delayed validation for `1`, `old`, or `2026-09-01`; then let the host assign `2`, `new`, or `2026-09-08`. Resolving the old validator with an error marks the newer value invalid and makes `checkValidity()` false. All three cases reproduced against source and compiled targets.

Invalidate outstanding and completed validation when the relevant host value or validator changes, and reject completions that describe an older value. Preserve independently supplied host errors. Object-valued controls need an appropriate structural comparison rather than an assumed scalar comparison.

**Verification:** extend the existing text-only stale-validation regressions at `tests/input/browser.spec.ts:900` and `:931` across the applicable input family. Cover late valid and invalid results, validator replacement, host errors, reset, and disconnection. Evidence: `aeliqo-architecture-probe-results.json`.

### 4 MCP action previews are cancelled at the end of their own call

**P2, confirmed integration failure.** `packages/agent/src/mcp/server.ts:79` creates an endpoint per invocation and closes it at `:91`. App action state stores previews in endpoint-local maps; `packages/agent/src/app/action-capability.ts:206` cancels and clears them on close.

Composing the stock MCP handler with a `createAppToolEndpoint` factory returns an accepted preview, cancels it while finishing that call, and rejects the subsequent execute with `agent.app.preview-stale`. The reproduction used the real official HTTP client, MCP handler, and runtime action port with in-memory fetch and a harmless action requiring no confirmation. Dispatch count remained zero. Discovery also closes its endpoint, so simply returning one shared app endpoint is insufficient.

Provide a supported host-owned action session that survives freshly authenticated calls, with expiry and immutable principal, scope, and goal binding. Preserve revocation and one-use receipts. The local example's persistent browser endpoint avoids this particular composition failure.

**Verification:** exercise real MCP preview, optional host confirmation, and execute, then reject another principal, an expired preview, and replay. Evidence: `aeliqo-mcp-action-audit.mjs` and `aeliqo-audit-mcp-action.log`.

### 5 Mutable input bypasses capability admission limits

**P2, confirmed contract failure with a restricted threat model.** `packages/agent/src/capabilities/dispatcher-input.ts:50` retains the caller's payload after validation, and the request freeze at `:87` is shallow. `packages/agent/src/capabilities/dispatcher-admission.ts:253` awaits the authority read; `:255` then parses that same mutable reference.

A same-process caller admitted a small object under a 32-byte input ceiling, paused the host authority read, then enlarged the object to 1,035 bytes and added forbidden `actor: 'administrator'`. A generic registered wire parser and handler received the changes and returned an accepted receipt.

This breaks byte-budget and authority-shaped-field admission guarantees. It is not a demonstrated remote tenant takeover: the caller must retain the in-process object, and strict built-in parsers and host authority still restrict privilege effects.

Capture a deep immutable input and metadata snapshot before the first asynchronous boundary, then validate budgets against that snapshot.

**Verification:** mutate original nested input and metadata during a deferred authority read; prove the handler and receipt retain only the admitted snapshot. Evidence: `aeliqo-capability-mutation-audit.mjs` and `aeliqo-audit-input-mutation.log`.

### 6 Invalid slotted submission does not focus the error summary

**P2, confirmed accessibility and recovery defect.** The invalid branch at `packages/web/src/input/form.ts:227` creates errors and returns without the summary-focus action used by the other submission path. A slotted submit click produced an error summary while its shadow root had no focused element.

The authored contract at `docs/site/components/input.form.md:16` promises that invalid submissions focus the summary. The implementation omits the documented focus transfer. Assistive-technology journeys remain unverified by this probe.

Share the summary and focus behavior across submission paths. **Verification:** assert summary focus after a slotted button click and Enter, while successful submission retains its intended behavior. Evidence: the component probe's `errorFocus` result.

### 7 Form drops enabled controls in the first legend

**P2, narrower native-semantics defect.** `packages/web/src/input/form.ts:386` treats every descendant of a disabled fieldset as disabled. Native forms exempt controls inside the fieldset's first legend.

The probe's legend input reported `matches(':disabled') === false`, but Form omitted its value. A control can remain visibly enabled while its data is discarded.

Honor native effective-disabled semantics and the first-legend exception. **Verification:** compare first and later legends, nested fieldsets, and directly disabled controls with native FormData. Evidence: the component probe's `legendData` result.

## Adoption and maintenance work

### 8 The promoted quickstart loads substantial initial JavaScript

**P2 adoption and performance concern; timing impact remains unmeasured.** A disposable application copied from the public React quickstart, using published npm 0.6.3 packages, built one minified JavaScript chunk of **1,504,589 bytes, or 394,353 bytes gzip** under Node 24.20.0 default gzip, for five records and four questions. This is the total application chunk, including React, rather than isolated Aeliqo overhead. It measures bytes rather than production load time. The fresh scaffold resolved Vite 8.3.4, TypeScript 6.0.3, and React/React DOM 19.3.0; Aeliqo was pinned to 0.6.3. The independent byte measurement and installed versions are retained in `public-quickstart-bundle.json`.

`packages/web/src/app/mount.ts:3` imports full registration, called at `:34`; `packages/web/src/register.ts:1` pulls in every component family. Existing workloads at `tests/performance/bundles.mjs:47` measure direct components, core planning, and a region/table path, but omit the promoted app/React quickstart.

Measure this installed quickstart as an explicit workload, then investigate selective registration or loading. Preserve its four-question behavior and responsive rendering. Agree any new budget separately; planner timing remains diagnostic under ADR 014.

### 9 Negative zero is rejected at zero bounds

**P3, confirmed numeric edge case.** `packages/web/src/input/number-field.ts:22` compares signs before detecting zero magnitude. `min="0"` with value `-0` becomes invalid even though its numeric value equals the lower bound.

Normalize zero for numeric comparison while preserving display precision where appropriate. **Verification:** compare positive and negative zero with minimum, maximum, and step constraints. Evidence: the component probe's `negZero` result.

### 10 Root contributor instructions omit prerequisites

**P3 onboarding defect.** `README.md:119` leads from Node and pnpm setup directly to `pnpm check`. Browser installation, Go 1.27.0, and Python 3 are explained in `CONTRIBUTING.md:24` and `:50`, but the root sequence does not direct the contributor to complete those prerequisites first.

Link the complete setup before the check command or include its prerequisites. **Verification:** follow the root instructions in a fresh Node-only environment.

### 11 DCO requirements differ from actual commits

**P3 contribution-policy drift.** `CONTRIBUTING.md:146` requires every commit to contain a Signed-off-by trailer. The audited `7e655b5` commit and the observed `d3cf8fb` main merge lack it; no DCO/signoff enforcement was found in the workflow or acceptance matrix.

Reconcile the written policy with the contribution flow and validate the agreed requirement. This finding does not establish that the Apache license is invalid. Mandatory second-person review is intentionally absent while the project has one active maintainer, as `.github/CODEOWNERS:1` explains; that is not reported as a defect.

## Fresh verification

- `pnpm install --frozen-lockfile` passed with the pinned toolchain.
- The uninterrupted `pnpm check` attempt **failed** after 87 of 93 commands: 86 passed, and `pnpm test:performance:vnext` failed its existing Node controller request-to-commit p95 budget of 100 ms. The 10/100/1,000-declaration tiers recorded 174.06 / 138.03 / 44.96 ms. Source stayed clean and unchanged throughout that invocation.
- An isolated repeat of the same performance command, without code or budget changes, passed at 11.07 / 10.03 / 8.02 ms. The large variation warrants caution; the repeat does not establish the precise cause of the first failure. This is a controller-commit budget, distinct from presentation-planner timing withdrawn by ADR 014. Both raw reports remain retained.
- The runner's unchanged `run_commands` function then executed the six remaining declared commands and their original timeouts on the same clean revision; all six passed. Every one of the 93 declared commands has a passing execution in this audit, but **no successful uninterrupted full-matrix run was obtained**. The failed receipt is not relabeled as passing.
- The three complete visual/interaction suites passed **1,830 tests**, with 610 per browser and zero unexpected or flaky cases, producing 2,862 PNGs. They cover the existing 360/768/1440-pixel profiles, including dark/RTL states. `visual-summary.json` retains per-batch counts and timestamps.
- The final sequential `pnpm site:test` passed: 17 unit tests, 102 browser tests, one skipped browser case, the production site build, SEO checks for 132 canonical pages, Go server checks, and CI provenance tests. Native WebMCP passed only in its configured experimental profile. This local result is not current production acceptance.
- The installed public npm quickstart built and completed its four-question production-browser journey and narrow viewport check. The isolated security and component reproductions produced the failures described in the findings above.

Before a correction release, the contributor guide still requires a clean full-matrix result and same-source publication evidence. The local performance failure and successful repeat should remain visible during that qualification.

Focused input, platform, and component accessibility suites are configured for Chromium. The full visual and interaction suite spans Chromium, Firefox, and WebKit. Browser count should not be interpreted as every focused input or accessibility case running in every engine. Regressions for the form defects should cover all three engines.

The reviewer also inspected fresh Chromium captures of a narrow dark/RTL form, a desktop matrix, and a medium-width dialog. Those three samples showed no additional actionable layout defect. Automated captures are not an independent review of every image or a newly approved Linux pixel baseline.

All isolated security reproductions used synthetic values and either in-memory or fully mocked fetch. The OAuth, MCP-action, and mutable-input reproductions were independently rerun after building this source. DateRange composition and stale validation reproduced against both source and compiled targets; summary focus, first-legend submission, and negative-zero bounds reproduced against source targets. Detailed results were retained.

The first matrix attempt lacked the required Playwright headless browser. The documented browsers were installed. An intermediate run and site run overlapped package rebuilds, causing reloads and missing build files; those contaminated failures are not classified as application defects. The failed Enter test passed when rerun in isolation. The subsequent results are listed separately above; the required full-matrix performance failure remains recorded.

Independent cross-review checked the security and integration findings separately from the form, accessibility, and performance findings. It upheld the priorities and prerequisites and prompted the precision corrections reflected above. Reviewers did not run concurrent builds or tests.

Evidence directory: `artifacts/audit-2026-10-09/`. It contains the probe programs, structured component results, dependency audit, and reproduction logs. Generated evidence is ignored by Git and is not a substitute for committed regression coverage.

## Requirements and evidence coverage

| Requirement | Status | Evidence and limit |
| --- | --- | --- |
| Public OSS license and distributable packages | Satisfied | Apache-2.0, NOTICE, contribution terms, conduct, security/support reporting and trademark guidance exist. All five registry tarballs contain LICENSE, NOTICE and README; license and notice bytes match the repository. |
| Installable public quickstart | Satisfied for the tested profile | Fresh npm installation and production TypeScript/Vite build passed. Optimized Chrome runtime produced all five rows, Engineering-only Sam/Jo, monthly counts 1/2/1/1 and team counts 2/2/1; 360-pixel cards had no overflow or page errors. |
| Package provenance | Inspected | All five fetched SLSA statements name published source `f697627`, main and `release-publish.yml`. The audit inspected statement contents; it did not independently validate their signatures. |
| Uninterrupted required acceptance matrix | Not passed in this audit | The full invocation stopped on controller-commit performance. Its isolated repeat and the remaining six commands passed; those separate receipts do not replace a whole-matrix pass. |
| Architectural separation | Satisfied in inspected paths | Core/runtime remain separate from DOM adapters; inspected exports and boundary checks preserve package direction. No new reverse dependency or public-export defect was found. |
| Stable form and asynchronous interaction behavior | Unmet | Findings 2, 3, 6 and 7 reproduce composition, validation and recovery failures. |
| Supported MCP action lifecycle | Unmet for the stock factory composition | Finding 4 prevents preview-to-execute completion in that composition. |
| OAuth credential destination binding | Unmet for affected optional configurations | Finding 1 reproduces the exported adapter's vulnerable path with dummy credentials. |
| Capability admission immutability | Unmet for a retained same-process object | Finding 5 bypasses admission checks across an asynchronous read. |
| Browser usability and accessibility | Partly verified | Local homepage/playground inspection, repository browser checks and public quickstart cover tested routes and states. Findings include an invalid-submit focus defect. General assistive-technology acceptance is not established. |
| Current production acceptance | Unknown from current probes | Operational endpoint requests returned 403 from this environment; the browser blocked the version endpoint. These access failures do not establish a production outage. Historical release receipts remain separate evidence. |
| Real-model success on current tools | Unknown | `docs/STATUS.md:72` discloses no current measured real-model success rate. Deterministic fixtures do not establish provider quality. |
| External adoption and integration usability | Unknown | The status record reports no external adopters. An audit-run quickstart is not independent user adoption. |
| Native WebMCP without experimental flags | Not established | The documented tested profile remains experimental. Preserve that qualification. |

## Dependency advisories

The fresh workspace audit reported **11 advisories: four high, six moderate, one low, zero critical**. Advisory counts describe the dependency graph and are not equivalent to eleven reachable production vulnerabilities.

The MCP OAuth issue above is reachable through an exported optional adapter. Other findings include Next.js 16.3.6 and sharp in the Next integration fixture, source-map-js in build/framework tooling, smol-toml through Knip, and fast-uri through development AJV. The public React quickstart's default installed dependency audit reported zero vulnerabilities.

The inspected Next fixture has no configured `images.remotePatterns`; the maintainers' [image-optimization SSRF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4) explicitly excludes that configuration. The public site uses a Go static server, not the Next fixture. Do not label these scanner results as demonstrated compromise of the deployed site.

Update applicable dependency pins and assess each advisory's conditions before release. The retained `dependency-advisories-summary.json` records affected and patched ranges and dependency paths.

## Product maturity and next actions

The project's strongest qualities are its explicit authority boundaries, no-model operation, typed contracts, scoped lifecycle handling, clean tarball consumers, runnable component documentation, and separation of source checks from publication and live acceptance. Those are meaningful engineering assets.

Wider promotion should follow a focused correction release for the OAuth, form, validation and MCP action failures, with regressions for the actual failing compositions. The input admission snapshot should be repaired in the same reliability work. Keep the smaller edge cases in a visible backlog if they are deliberately deferred.

Measure the advertised app entry point, then improve its initial code cost without losing its behavior. Run onboarding trials with a small group of outside developers: ask them to install, render a first result, filter it, add a new resource, and recover from an invalid request. Record where they stop and what assistance they need. That evidence can distinguish API friction from missing explanation.

Qualify current agent tools with a bounded real-model corpus only when the owner authorizes paid evaluation. Keep model-independent and experimental-browser claims explicit. Perform targeted assistive-technology journeys for forms, search, dialogs, and adaptive results before stronger accessibility claims.

## Refuted and bounded candidates

- A temporary mismatch between the responsive playground's cards and its view label resolved after adaptation completed; the final label correctly reported Card collection. No persistent diagnostic bug is reported.
- AeliqoRegion remounts when only `resourceId` changes without rerendering an unchanged intent. Standard intents already contain their resource, so ordinary immutable callers changing both inputs work. The isolated call-sequence observation is retained as a narrow lifecycle/diagnostic follow-up rather than a broad React launch blocker.
- Missing mandatory PR approvals follows the documented solo-maintainer policy. It is not an accidental protection gap.
- Historical planner/performance-reference failures are advisory and disclosed. ADR 014 removes absolute planner-latency gating; this audit adds no replacement threshold.
- No cross-tenant leak, arbitrary agent HTML execution, or exposure of real provider secrets was demonstrated in the inspected scope. This sampled review is not a security certification.

No application code was changed by the audit. No identified defect is marked fixed.
