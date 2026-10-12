# Publishing Varendo 0.1.0

All five `@varendo` packages were published at **0.1.0** on 12 October 2026
from source `53406eeab85103fd0b1159e765ee3996e2b4ab70`, after authenticated
scope authority, account 2FA and all five trusted publishers were verified.
[The canonical stable run](https://github.com/hermawan22/varendo/actions/runs/38210717157)
passed registry consumers and provenance verification. [Project status](STATUS.md)
records the receipts and remaining work. The procedure below describes the
maintainer gates; it does not grant account access or future publication approval.

## Verify authority before writing to npm

Authenticate to `https://registry.npmjs.org` using the maintainer's existing
account. Verify the account identity, account-level two-factor authentication,
and its authority over the `varendo` user or organization scope. For existing
packages, also verify write access to each of `@varendo/core`, `runtime`, `web`,
`react`, and `agent`. An authenticated identity alone does not establish scope
ownership. Keep credentials and authentication challenges out of commits,
screenshots, workflow inputs and release records.

The owner's publication approval is conditional on verified ownership. Until
that condition is met, do not create packages, stage candidates, configure
trusted publishers or dispatch publication. Enabling 2FA or changing account
access is a separate account operation; this guide does not grant that authority.

## Freeze a fully verified source

Use Node.js `24.20.0` and pnpm `11.24.0`. Review and merge the release preparation
through the contributor flow, including DCO signoffs. Require a successful
**full-matrix push to main at the exact release SHA**, including the release
contract and the merged acceptance evidence. A site-only push, an older source's
receipts or a manual diagnostic dispatch cannot replace that requirement.

The canonical workflow checks current `main`, the full functional step, and
source-bound evidence before publishing. Keep this SHA unchanged through both
RC and stable publication. Do not update status or release metadata between
those stages. Visual baseline and paired performance comparisons remain
advisory under the existing policy; do not invent approvals to make them green.

## Bootstrap absent packages only when necessary

Trusted publisher setup requires an existing package. After authority and source
verification, an authenticated maintainer may use staged publishing to establish
absent package records. This needs npm CLI `11.15.0` or later. Staging a new
package creates a **public `0.0.0-stage` placeholder**; staged implementation
contents remain unavailable until a maintainer approves them with 2FA.
[npm staged publishing](https://docs.npmjs.com/staged-publishing/).

Use a distinct bootstrap prerelease, for example `0.1.0-rc.1`, and reserve
`0.1.0-rc.2` for the canonical OIDC release. Staged and published versions share
the same version index, so a pending staged version cannot be published directly.
Do not stage `0.1.0` or the version selected for the canonical RC.
[npm stage behavior](https://docs.npmjs.com/cli/v11/commands/npm-stage/).

Build the verified bootstrap tarballs from the frozen clean source, using a new
or empty ignored output directory so existing release evidence is preserved.
Wait for other builds to finish: the builder recreates package outputs.

```sh
pnpm build:platform
pnpm build:agent
pnpm test:release-tooling
node scripts/release/candidate.mjs artifacts/bootstrap-0.1.0-rc.1 --version 0.1.0-rc.1
npm stage publish artifacts/bootstrap-0.1.0-rc.1/varendo-core-0.1.0-rc.1.tgz \
  --access public --tag bootstrap --registry https://registry.npmjs.org
```

Repeat the staging command for the verified `runtime`, `web`, `react`, and
`agent` tarballs in that order, recording the resulting stage IDs. Inspect all
five actual package records, access and dist-tags before proceeding. Keep the
bootstrap tag separate from canonical `next`: the existing RC advancement guard
rejects `next` pointing to `0.0.0-stage`; do not weaken it or force a tag change.
Bootstrap staging is not an approved OIDC RC and does not satisfy the stable
workflow's predecessor gate. Do not automatically approve or reject staged
records as part of publication. The first release used staged RC1 bootstrap,
then canonical OIDC RC2 and stable from the same frozen source.

## Configure the exact trusted publisher

For each of the five packages, configure GitHub Actions with owner
`hermawan22`, repository `varendo`, and workflow filename
`release-publish.yml`. Leave the environment field empty: the current publishing
job declares no environment. Explicitly enable **Allow npm publish** for this
approved workflow; a stage-only permission cannot run its direct publication.
Check the saved settings for every package. Do not add a long-lived npm token
fallback to GitHub Actions.
[npm trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Publish and verify RC, then stable

The following example assumes bootstrap used `0.1.0-rc.1`. Otherwise select an
unused RC number and use that exact identity consistently. The maintainer
`hermawan22` dispatches the existing workflow from the frozen current `main`:

```sh
gh workflow run release-publish.yml --repo hermawan22/varendo --ref main \
  -f stage=rc -f version=0.1.0-rc.2
```

Wait for successful completion, including all five public registry artifacts,
exact tarball integrity, installed export consumers and source-bound provenance.
Preserve the run ID and its publication artifact. Then substitute the verified
40-character source SHA and successful RC run ID below:

```sh
gh workflow run release-publish.yml --repo hermawan22/varendo --ref main \
  -f stage=stable -f version=0.1.0 \
  -f rc_version=0.1.0-rc.2 -f rc_source_sha=EXACT_SOURCE_SHA -f rc_run_id=RC_RUN_ID
```

The workflow reinstalls and verifies the approved RC before publishing stable,
then verifies the installed stable artifacts and provenance. It publishes in
dependency order, with `next` for RC and `latest` for stable. A failed or partial
run is not a completed release; retain its receipts and inspect the failure
before resuming the same immutable candidate. After successful stable registry
verification, update status and public release claims through a reviewed change.

## Preserve compatibility and retire legacy artifacts separately

Preserve Apache-2.0 license text, NOTICE attribution, historical release records
and compatible runtime identifiers described in the
[migration guide](site/pages/migration-varendo.md). Publishing Varendo does not
authorize rewriting historical provenance or changing serialized contracts.

Legacy `@aeliqo/*` deletion is subject to npm policy, including package age,
dependents, download limits and maintainer constraints. Do not claim those
packages can be deleted without checking the actual eligibility; deprecation
and migration guidance are the supported alternative when deletion is refused.
[npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).

Retire repositories and container images only after their replacements and
consumers are verified and active references and rollback requirements have
been reconciled. Record what was removed or retained. Keep the separately paused
`aeliqo.com` application outside this package-publication procedure.
