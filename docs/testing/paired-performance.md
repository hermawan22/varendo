# Paired layout and visualization performance

> **Status: advisory.** This job runs on pushes to `main` and owner dispatches and
> keeps its evidence, but it does not block merges or package publication until
> the reference is approved and stable. The functional matrix remains required.

`node scripts/performance/compare.mjs` compares two explicit source revisions on
one runner. It recreates the reviewed baseline from `git archive`, installs the
frozen lockfile, and builds both sources. It never changes the budget file or
accepts a failing candidate automatically. Generated reports and traces live in
ignored `artifacts/performance-paired/<timestamp>/` directories.

## Workloads and measurements

The comparison reuses the existing Chromium production fixtures and assertions:

- `tests/performance/browser.spec.ts`: the timed small, medium, large-window,
  planner, and reducer workload, with CDP layout and paint traces.
- `tests/performance/adverse-visualization.spec.ts`: dense and null-heavy 2D
  visualization resize observations, bounded geometry, exact-data alternatives,
  selection continuity, and no interaction-triggered network requests.

The reported relative metrics are the CDP layout-event p95 and the 2D
mutation-to-DOM-and-forced-layout p95. The second metric is **not** paint latency or
input-to-paint latency. These fixtures do not establish limits for other datasets,
all devices, or all visualization workloads.

Each source runs three times. Order alternates baseline/candidate,
candidate/baseline, baseline/candidate. The runner retains every raw sample report
and trace and compares the median of each source's three p95 observations. Reports
include all three values plus their minimum, median, and maximum.

The reviewed relative policy rejects a metric only when the median increases by
**more than 20% and more than 2 ms**. Each new workload or runner requires its own
same-source stability review before it can use an approved reference. The remaining
absolute assertions are mandatory on every run: reducer dispatch p95 ≤4 ms, mounted
rows ≤100, and available trace phases. A failed workload stops the comparison;
partial observations and artifacts remain available.

Presentation-planner timing is diagnostic only. Reports retain its raw samples,
trace intervals and p95, without an absolute budget or pass/fail flag. It does
not gate tests, CI, merges, publication or deployment, and has no replacement
threshold. This follows the [owner decision of 1 October 2026](../adr/014-planner-timing-diagnostics.md).

## Bootstrap and approval

1. Commit source A containing this runner, its provenance helper, both paired
   configurations, and the workload fixtures. The checkout must be clean.
2. Use the same immutable Playwright container and pinned Node/pnpm environment as
   the [visual review gate](visual-review.md). Keep the machine free of concurrent
   builds or performance jobs.
3. Run `node scripts/performance/compare.mjs --probe --source <full-source-A-SHA>`.
   This compares source A with an independently archived copy of A across three
   pairs. It is a stability experiment, with status `stable-probe-unapproved` only
   if both absolute assertions and the proposed relative policy pass.
4. Review all six workload sets, their raw timing variation, traces, machine and
   browser metadata. Investigate instability before accepting a budget. A passing
   probe does not approve a baseline.
5. In a separate metadata commit B, update `scripts/performance/budget.json` with
   `status: "approved"`, source A's exact `baselineSHA`, the probe's `workloadSHA`
   and `runner`, and a nonempty `review` reference to the evidence. Retain the
   reviewed relative and absolute policy fields. Approval belongs to the release
   maintainer.
6. Run `node scripts/performance/compare.mjs` on clean B. The baseline remains A;
   metadata B does not become an automatic baseline. Upload the complete artifact
   directory even when the gate fails.

The gate rejects unapproved metadata, workload changes, environment changes,
missing or nonfinite samples, source changes, and weakened absolute assertions.
Workload hashes include the performance fixtures, shared test helpers, performance
orchestration, and reused visual environment/archive helpers. Budget files and
orchestration unit tests are excluded so an evidence-only approval commit can be
compared with its reviewed source.

Both checkouts are checked against a manifest of Git blob identities from their
explicit source revision before and after measurement. The archived browser test
also checks actual tracked file bytes at its boundaries; a supplied source SHA
environment variable alone is insufficient archive provenance. Builds and reports
may create ignored output, while tracked source changes invalidate the run.

Runner metadata includes the immutable container digest, browser executables and
versions, fonts, platform, Node, pnpm, locale, timezone, and device scale. The layout
fixture uses en-US/UTC at 1280×720; the existing 2D fixture keeps de-DE/Europe-Berlin
at 1440×900. The report records CPU models, logical processor count, memory, and
kernel for interpreting machine variation. Baseline and candidate measurements
always execute sequentially on the same machine.

## Tooling checks

`node --test tests/performance/paired-runner.test.mjs` checks the pair order,
relative policy, unchanged absolute budgets, archive-byte provenance, failure
handling, configuration preservation, and the unapproved gate's refusal to update
metadata. These checks validate orchestration; they do not substitute for the
clean-source three-pair experiment or release comparison.

## CI evidence

The quality workflow runs `performance` in the pinned visual container on pushes
to `main` and owner dispatches. The advisory job executes the approved comparison
and uploads raw artifacts even after failure. Its separate owner-dispatched
`performance_probe` input adds the bootstrap experiment; it never replaces or
bypasses the comparison. A passing probe remains unapproved until the maintainer
reviews its evidence and records approval in a separate metadata commit. The
release comparison must then pass against that approved reference before claiming
paired-performance qualification; advisory status alone does not supply that
evidence.
