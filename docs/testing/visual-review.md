# Visual review and approved source comparisons

> **Status: advisory.** This job runs on pushes to `main` and owner dispatches and
> keeps its evidence, but it does not block merges or package publication until
> the reference is approved and stable. The functional matrix remains required.

`pnpm test:visual` builds the packages and runs the existing geometry,
accessibility, keyboard, and screenshot suites in Chromium, Firefox, and WebKit.
The catalog covers all 71 components at 1440, 768, and 360 pixels. The narrow
variant uses dark mode, RTL, and doubled root text size. The state suites cover
field disabled/invalid/pending/read-only states, data and structure states,
compound interactions, and visualization selection, empty, and bounded data
views. Unsupported states are not invented for components.

These screenshots are review evidence. A successful geometry or accessibility
run does not approve pixels. Manual design review and assistive technology
checks remain separate evidence.

## Pixel regression gate

The complementary runner is:

```sh
node scripts/visual/run.mjs --full
```

It reads `scripts/visual/baseline.json`. An unapproved record fails before
capture. An approved record must name an exact reviewed Git commit, its fixture
SHA-256, review evidence, and the recorded runner. It never defaults to HEAD,
updates snapshots, or copies failed candidate images into a baseline.

For each run, the runner:

1. Requires a clean candidate checkout and an exact match with the approved
   browser versions, executable hashes, Node/pnpm/Playwright versions, platform,
   container digest or hosted runner image identity, font hashes, locale, timezone, and scale factor.
2. Reconstructs the approved commit with `git archive` into an isolated temporary
   directory, performs a frozen install, and checks its fixture and environment
   metadata against the candidate. It does not create a Git worktree.
3. Performs a frozen candidate install and builds both sources separately. Baseline rendering uses the
   approved source and its own dependencies and fixtures.
4. Runs each source twice into separate output directories. Missing PNGs,
   changed screenshot inventories, failed behavioral assertions, or any byte
   difference between repeated captures fail the run.
5. Compares the candidate to the reconstructed baseline with Playwright's
   public PNG snapshot comparator, `threshold: 0`, `maxDiffPixels: 0`, and
   `updateSnapshots: 'none'`. Playwright's standard antialias treatment applies.
   Pixel differences produce expected, actual, and diff images and fail the run.

The fixture hash covers `tests/visual` (including capture and comparator infrastructure),
`tests/shared`, `examples/catalog`, `catalog/components.json`, and `scripts/visual`.
Only `baseline.json` and tooling `*.test.mjs` files are excluded. Fixture
changes require explicit review and a new baseline; a deleted screenshot cannot
silently shrink the comparison. PNG files stay under ignored `artifacts/`.

Every run keeps its own `artifacts/visual-regression/<timestamp>/` directory:
`baseline/`, `baseline-repeat/`, `candidate/`, `candidate-repeat/`, `diff/`,
environment JSON, and `report.json`. Failures preserve evidence. Temporary
baseline source/install directories are removed after the run. Upload this
entire artifact directory even when CI fails. Reports identify full versus
selected coverage and distinguish an unapproved probe from an approved pass.

## Establish or change approval

1. Commit the proposed design and fixtures, including this infrastructure.
   Choose a fixed Linux browser image by immutable container digest, or use the
   existing GitHub Ubuntu runner with its recorded `ImageOS` and exact
   `ImageVersion` (for example `ubuntu24` and a date/version string). Install
   the repository's pinned Node and pnpm inside that image. Keep the installed
   fonts fixed. For containers, set `AELIQO_VISUAL_CONTAINER_DIGEST=sha256:<digest>`
   from the CI image reference. On GitHub hosted runners the harness records
   `hostImage` automatically and leaves `container: null`; it never invents a
   container identity. A floating label such as `ubuntu-latest` cannot be an
   approved image version. Use `AELIQO_VISUAL_FONT_DIRS=/usr/share/fonts` only when
   that is the complete font inventory available to the browsers.
2. Run `node scripts/visual/run.mjs --probe --full` in that image. A full probe
   performs a frozen install and builds the candidate before capture. Selected
   probes reuse existing output and remain diagnostics. Approval evidence must
   come from a clean proposed design commit and report `sourceBuilt: true`.
   No baseline is accepted by this command. Both complete captures must match.
3. Review all component and important state images. Record reviewer evidence
   outside generated images. Copy the exact clean design commit into
   `baselineSHA`, the reported `fixtureSHA`, and complete `runner` object into
   `scripts/visual/baseline.json`; set `status` to `approved` and `review` to
   the review record URL or repository document. Preserve the required
   two-capture, zero-diff reproducibility policy. This is a deliberate reviewed
   metadata change, never an automatic response to a failed candidate.
4. Commit that metadata and run the full gate in the same image. Fetch enough
   Git history for the approved commit to be available to `git archive`.
   Baseline source and approval metadata can be separate commits, avoiding a
   self-referential final SHA. The baseline commit must contain the harness.

The initial tracked record is deliberately **unapproved**. Local engine probes
are not release acceptance, container reproducibility, or design approval.
While it remains unapproved, the advisory CI jobs run the full pinned-container
reproducibility probe and report `probe-reproducible-unapproved`, never a pixel
comparison pass. The direct `--full` command still rejects the unapproved
record. Keep the existing behavioral visual suite in the quality matrix throughout.

## Required CI gate and diagnostic bootstrap

The `visual-shards` matrix in `.github/workflows/quality.yml` runs one job for
each of Chromium, Firefox, and WebKit. With an approved baseline, each job
performs its baseline, baseline repeat, candidate, candidate repeat, and pixel
comparison sequentially on the same runner in the immutable amd64 Playwright image.
With the exact `unapproved` status, it captures and compares two candidate
runs instead; any other status enters the strict gate and fails without approval:

```text
mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7
```

All browser capture jobs use Node 24.20.0, pnpm 11.24.0, the image's installed browsers,
`TZ=UTC`, `LANG=C.UTF-8`, and the image's system font directories. They do not
install or upgrade browsers or fonts after selecting the image. Browser locale
and timezone remain explicitly fixed in the capture configuration. The runner
records actual browser executable and font hashes as well as the container
identity; changing the image requires reviewed metadata.

Chromium visual captures also set `--disable-gpu`,
`--disable-skia-runtime-opts`, and `--disable-partial-raster`. The second selects the baseline CPU raster path
documented in [Chromium's test switches](https://chromium.googlesource.com/chromium/src/+/lkgr/content/public/common/content_switches.cc).
The third repaints complete tiles: a controlled native-button reproduction showed
that reusing partially painted tiles changed rounded-edge antialiasing despite
identical final geometry and styles. Disabling partial raster removed that
variation across ten fresh browser processes per state. See the
[pinned Chromium setting](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/platform/widget/compositing/layer_tree_settings.cc#L326).
This configuration is part of the fixture hash. It applies only to visual
captures; performance workloads and ordinary browser behavior tests retain
their own configurations. It neither masks pixels nor changes comparison
thresholds. Local emulated amd64 checks cannot establish native CI stability:
the complete repeated captures must still pass on the pinned Linux runner.

For bootstrap commit A, the repository owner can dispatch the existing quality
workflow with `visual_probe: true` and its exact source SHA. That adds a separate
`visual-probe-shards` matrix running `--probe --shard <browser>` in the same image.
That explicit dispatch skips the normal advisory matrix, so the same source is
not captured twice. On default dispatches and pushes, the normal advisory
matrix probes while the baseline is unapproved; every probe report remains
explicitly unapproved rather than claiming a pixel pass. Even after a baseline
is approved, `visual_probe: true` stays diagnostic and skips the strict
comparison; it cannot qualify as pixel acceptance or release evidence. A main
push or default dispatch runs the strict comparison once approval exists.
Every browser job uploads its complete artifact directory and a compact shard
report even on failure.

The advisory `visual` aggregate runs after all three browser jobs, including when
one fails. It rejects failed, skipped, cancelled, missing, or duplicate shards;
source, fixture, or environment mismatches; incomplete captures; and selected
family filters. It independently lists the full source test suite and requires
exactly 610 successful tests and 954 PNGs per browser (1,830 tests and 2,862 PNGs
in total). Every test must execute once and pass; metadata-only tests need no
screenshot. Both repeats must have identical PNG hashes. The `visual-probe`
aggregate applies the same completeness checks to the two candidate captures
and remains explicitly unapproved.

This partition preserves one worker per capture and the same complete suite.
A shard uses `--shard chromium|firefox|webkit`; it cannot claim a full pass by
itself or combine with `--full` or local selection filters. Serial `--full`
remains available locally. Splitting by browser gives each hosted job a bounded
share of the four-capture workload instead of putting all browsers into one
360-minute job. The aggregate evidence is under `artifacts/visual-aggregate/`;
compact shard evidence is under `artifacts/visual-shard-report/`. Changes to the
reviewed fixture inventory require deliberate count updates and baseline review.

After review, commit B records A's source SHA and exact environment/fixture
metadata. Dispatch B with the default `visual_probe: false`. Once approved, the
full comparison runs alongside the functional matrix. A local `pnpm check` run
covers the matrix and tooling tests; it does not replace the independent
same-source container visual gate. Package publication uses a successful
quality workflow for the same source revision; advisory visual results are reviewed, not required. Keep the diagnostic probe's
artifact and the subsequent approved gate's artifact as separate evidence.

## Daily focused runs

After building the packages, a local diagnostic example is:

```sh
AELIQO_VISUAL_PROJECT=chromium AELIQO_VISUAL_BATCH=catalog \
AELIQO_VISUAL_GREP='button desktop-light$' node scripts/visual/run.mjs --probe
```

For approved comparisons, omit `--probe`. Existing project and suite batch
selectors apply to both sources. `AELIQO_VISUAL_GREP` selects affected test titles
and can select component families or states; include relevant state suites as
well as the catalog. With no selectors, all seven suites and all three browsers
run. `--full` rejects selectors, so release CI cannot accidentally inherit a
partial local run. A focused pass is not a full release pass.

If double capture is unstable, inspect the two retained images and stabilize
the fixture or capture timing. Do not loosen thresholds or accept the second
image automatically. Browser, font, fixture, or container upgrades require a
new reviewed baseline in the new environment. GitHub periodically updates hosted
runner images; an exact image-version mismatch intentionally requires fresh
reviewed metadata. GitHub records ImageVersion but does not let you schedule that exact old image.
Pinning a container avoids that host-image update cycle; its runner identity
excludes the mutable outer host image.

## Performance comparisons

The same approved-source reconstruction can support performance comparisons,
but screenshot success does not establish performance. Run the baseline and
candidate 2D/layout workloads on the same pinned runner, alternate repetitions,
and retain raw timings plus source and runner metadata. Apply reviewed budgets
to that paired evidence; do not compare different machines or infer performance
from screenshot duration.
