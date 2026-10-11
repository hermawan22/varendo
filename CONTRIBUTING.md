# Contributing to Varendo

Thanks for helping improve Varendo. Code, documentation, examples, and bug
reports are all welcome — including contributions made with AI coding
assistants. [AGENTS.md](AGENTS.md) is the canonical contributor guide for
humans and agents: it has the repository map, layer boundaries, code and
documentation conventions, and the verification matrix. Read it, or point
your tool at it, before opening a pull request.

Keep a contribution focused, include tests for behavior that can regress, and
update the relevant documentation in the same change as the code. Do not
include secrets, customer records, generated build output, or local tool
configuration.

## Local setup

Use the pinned toolchain: Node.js `24.20.0` (see [.node-version](.node-version))
and pnpm `11.24.0` (the `packageManager` field in [package.json](package.json)).

```sh
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit
```

Browser suites need the Playwright browsers installed once (`--with-deps`
installs the system libraries on Linux; on macOS plain `playwright install`
is enough). `pnpm site:test` and `pnpm check` also run the production server
contract in Go, so install Go `1.27.2` before those commands.

## Preview the docs and Playground

```sh
pnpm --dir apps/site dev
```

Open the printed URL for the landing page; append `/start/` for the docs or
`/playground/` for the interactive demos. Edit Markdown under `docs/site/`.
The dev server regenerates pages from that source.

For MCP or optional BYOK, follow [the standalone local example](examples/local-agent/).
It has its own install and `pnpm dev` command. Optional model credentials belong
only in `examples/local-agent/.env.local` and the Node host process. The public
Playground exposes manual controls and experimental WebMCP; it has no model key
input. Never include keys in issues, screenshots, URLs, fixtures, or commits.

## Running checks

`pnpm check` runs the full acceptance matrix in
[quality/commands.json](quality/commands.json) (via `scripts/quality.py`, so
Python 3 is required) and writes evidence under `artifacts/product-ci/`. It
covers typecheck, unit, browser, package-consumer, performance, lint,
security, and boundary checks. Run it on a clean commit before a release;
for a routine pull request, run the smallest commands that exercise the
changed contract — the required GitHub checks still run before merge.

Common focused commands by area:

| Change area                    | Commands                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Any change                     | `pnpm lint`, `pnpm format:check`, `pnpm typecheck`                                                     |
| `packages/core`                | `pnpm build:core`, `pnpm test:contracts`, `pnpm test:core:consumers`                                   |
| `packages/runtime`             | `pnpm build:runtime`, `pnpm test:data`, `pnpm test:regions`, `pnpm test:runtime:consumers`             |
| `packages/web` / `react`       | `pnpm build:platform`, `pnpm test:platform`, `pnpm test:platform:browser`, `pnpm test:components:a11y` |
| `packages/agent`               | `pnpm build:agent`, `pnpm test:agents`, `pnpm test:agent:consumers`                                    |
| Framework/SSR integrations     | `pnpm test:framework:consumers`, `pnpm test:next-platform`                                             |
| Component docs or examples     | `pnpm test:catalog-examples`, `pnpm test:docs-artifact`, `pnpm test:docs-inventory`                    |
| `apps/site` (site, playground) | `pnpm site:build`, `pnpm site:test`                                                                    |
| Standalone MCP/BYOK example    | `pnpm test:local-agent`                                                                                |
| Visual changes                 | `pnpm test:visual` (Chromium, Firefox, WebKit at 360/768/1440 px)                                      |

`pnpm` scripts in [package.json](package.json) are the source of truth for the
exact commands.

## Code conventions

- Small modules with one clear responsibility. Prefer guard clauses,
  discriminated unions, exhaustive switches, dispatch tables, and pure
  functions for domain rules. Avoid nested conditionals and ternaries,
  catch-all managers/services, speculative abstraction, and duplicate sources
  of truth.
- Enforced limits ([.oxlintrc.json](.oxlintrc.json)): functions ≤ 80 lines,
  files ≤ 500 lines, cyclomatic complexity ≤ 12, nesting ≤ 3. Generated code
  and fixtures are excluded by path. No `as any` casts, import cycles, unused
  exports, unused dependencies, or unused locals.
- Dependency direction: `core → runtime → web → react`; `agent` may depend on
  `core` and `runtime`; `apps/site` may consume the public packages. No
  reverse dependencies. Keep I/O in adapters.
- Application code owns identity, permissions, routes, actions, and business
  effects. Treat all agent input as untrusted; never render agent-supplied
  HTML or execute agent-supplied code.

## Common changes

### Add or update a catalog component

1. Implement it under `packages/web` (and `packages/react` bindings if the
   family ships them).
2. Add or update its entry in [catalog/components.json](catalog/components.json).
3. Write its page at `docs/site/components/<catalog-id>.md` and a runnable
   example under [examples/catalog](examples/catalog/).
4. Verify with `pnpm test:catalog-examples` (typechecks, builds, mounts, and
   compares every copyable example with its catalog preview),
   `pnpm test:docs-inventory`, and `pnpm test:components:a11y`.

### Add or change a public package export

Public API changes require all of the following in the same change:

- the package `exports` map update,
- coverage in the matching clean tarball consumer under `tests/consumers/`,
- the matching package guide under [docs/packages](docs/packages/) (release
  staging generates each package `README.md` from these files),
- a release note in `docs/site/pages/release-notes.md`, and for breaking
  changes an entry in the current migration guide under `docs/site/pages/`.

### Update application composition

The application facade lives in `packages/web/src/app/`; Region publication and
trusted render preparation live in `packages/runtime/src/app/`. Keep the runtime
free of DOM access and use the existing Region transaction for publication.
The runnable component/workspace/page entry is `examples/vnext/page-goal/`, with
shared registered goals and page patterns in `examples/vnext/workspace/`.

Run `pnpm test:presentation-adaptation`, `pnpm test:presentation-adaptation:browser`,
and `pnpm test:presentation-adaptation:consumers` for changes to this contract.
These exercise semantic projection, actual browser publication/lifecycle, and
clean package entry points. The complete acceptance matrix still applies before
release.

### Update documentation

Authored public documentation lives in Markdown under `docs/site/`; edit the
canonical Markdown and the generators (`scripts/docs/build-public-docs.mjs`,
`apps/site/generate-pages.mjs`), never output under `artifacts/` or `dist/`.
Contributor-facing technical guides are indexed in [docs/README.md](docs/README.md).

## Commits and pull requests

Commit subjects follow `type(scope): subject`, for example `feat(site): …`,
`fix: …`, `docs(agent): …`, `refactor:`, `test(contracts):`, `chore(release):`,
`perf:`, `style:`, `security:`, `ci:`. Scope is optional; keep the subject in
the imperative mood.

Every new contribution commit must include a `Signed-off-by: Name <email>`
trailer matching its author's name and email under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```sh
git commit --signoff
```

Sign only contributions you can personally certify, including work prepared
with an AI assistant. Do not add another person's signoff for them. The `DCO`
pull request check and the `policy` main-push check validate every contribution
commit; a signed final commit does not cover earlier unsigned commits.

Merge commits contributed in a pull request require their author's signoff.
For a main push, only the exact integration head identified by that CI event is
exempt when it has multiple parents; its contributed parent commits are still
checked. This is an integration-record policy, not a claim about who created
the merge. When squashing, preserve the contributor's own trailer in the final
commit. Previously accepted history is not rewritten or retroactively certified;
the check examines commits not already reachable from the target revision.

The pull request check runs in a base-owned `pull_request_target` workflow with
read-only permissions. It fetches commit objects and executes only the checker
from the accepted base, so changes to the PR's checker or workflow cannot bypass
the check. It never installs dependencies or runs PR code. The first main-push
rollout has one explicit bootstrap base SHA and reviewed checker hash; missing
checkers outside that pinned rollout fail closed.

After this workflow first lands on `main`, the maintainer must add its `DCO`
status to the required branch-protection checks alongside `policy` and
`functional`. Repository source changes do not update those remote settings.

Open pull requests against `main` and fill in the
[pull request template](.github/pull_request_template.md): describe the
user-visible change, paste the exact commands and fresh output as evidence,
and complete the boundary checklist. UI changes should cover loading, empty,
error, disabled, focus, long-content, responsive, reduced-motion, and
right-to-left states that apply.

Contributions are accepted under [Apache License 2.0](LICENSE) unless the
maintainers agree to different terms before submission. Do not submit
third-party material without the right to redistribute it.

## Conduct and security

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Do not
open a public issue for a vulnerability — follow [SECURITY.md](SECURITY.md)
and use GitHub private vulnerability reporting. For non-sensitive defects,
see [SUPPORT.md](SUPPORT.md).

## Release boundary

Contributions are reviewed and verified before maintainers publish packages or
deploy the site. Package publication requires a successful **full matrix from a
push to main at the exact source SHA**. A manual diagnostic run does not replace
that push evidence. Keep package versions aligned and never reuse a published
version for changed package source. Maintainers then verify registry consumers,
publish the immutable image, promote the GitOps digest, and check public routes.

The public docs are the project's user-facing wiki. Propose documentation changes
through the same review flow as code; avoid maintaining a separate copy in a
personal wiki or tool-specific instruction file.
