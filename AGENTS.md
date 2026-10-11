# Varendo contributor guide

This file is the canonical contributor guide for humans and AI coding agents.
[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and the pull request flow;
this file covers repository boundaries, conventions, and verification. Every
path and command referenced here exists in the repository — follow them
instead of inventing alternatives.

## Start here

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) and install the pinned toolchain:
   Node.js `24.20.0`, pnpm `11.24.0`, then `pnpm install --frozen-lockfile`.
2. Find the area you are changing in the repository map below.
3. Make a focused change following "Code conventions" here and the recipes
   under "Common changes" in [CONTRIBUTING.md](CONTRIBUTING.md).
4. Run the focused checks listed in "Verification" and read their fresh
   output. `quality/commands.json` is the complete acceptance matrix; CI runs
   it on every pull request.

## Repository map

- `packages/core` owns schemas, contracts, query planning, and semantic validation. It is framework independent.
- `packages/runtime` owns data access, evaluation, regions, actions, results, and runtime state. It must not access the DOM.
- `packages/web` owns the shared Lit elements, renderers, and browser registration.
- `packages/react` provides React bindings over the web elements.
- `packages/agent` accepts bounded proposals through MCP, WebMCP, and model adapters. It must not grant permissions or produce executable UI.
- `apps/site` owns the public landing page, documentation shell, playground, static build, and production image. It consumes the packages; packages must not depend on the site.
- `examples/local-agent` owns the standalone MCP HTTP/stdio and optional BYOK host, runner, and browser UI. It uses public package exports and must work outside the monorepo.
- `catalog/components.json` defines the public component catalog. `examples/catalog` supplies runnable component examples.
- `docs/site/` is the authored public documentation source, including all 71 component pages and the other public routes.
- `docs/STATUS.md` is the single maintained status record: goal, published versions and site image, progress, and open items. Update it in the same change as a release or a closed item.
- `docs/packages/` is the canonical source for the five npm package guides. Release staging copies these guides into each tarball as `README.md`.
- `tests` contains contract, clean tarball consumer, browser, accessibility, and performance checks, organized by area (`tests/<area>/` with vitest and Playwright configs).
- `quality/commands.json` is the machine-readable acceptance matrix executed by `pnpm check`.
- `scripts/` holds build, docs, release, and quality tooling.

The allowed dependency direction is `core → runtime → web → react`; `agent` may depend on `core` and `runtime`; `site` may consume all public packages. Do not add reverse dependencies or cycles. Keep I/O in adapters and keep composition roots limited to wiring.

## How to find things

- A catalog component's behavior: `catalog/components.json` (id and contract) → `docs/site/components/<catalog-id>.md` (authored page) → `examples/catalog/` (runnable example) → `packages/web/src/` (implementation).
- A package's public API: `packages/<name>/package.json` export map → `docs/packages/<name>.md` (canonical guide) → `tests/consumers/` (clean tarball consumer that proves the export).
- Which check covers a change: match the test directory or `pnpm` script name to the area, or look it up in `quality/commands.json`.
- Design decisions: `docs/adr/` (append-only; supersede with a new ADR rather than rewriting one).

## Trust and behavior

- Application code owns identity, data permissions, routes, actions, and business effects.
- Treat all agent input as untrusted. Validate it against registered resources, meanings, actions, and views before evaluation.
- Never render agent supplied HTML or execute agent supplied code.
- Preserve deterministic behavior and explicit failure states. Do not silently widen access or discard a valid previous result after a failed update.
- Keep core and runtime usable without a browser, and the whole framework usable without a model. Add browser APIs only in web or site adapters.
- Keep feature definitions immutable and live surfaces scoped by explicit instance identity. Convenience and advanced paths must use the same runtime contracts.
- A client workspace ID is a selector, not permission. Guard voluntary draft exits, fence forced revocation, keep immutable target epochs, and reject stale work after a round trip through another scope. The optional agent adapter targets an explicit scope/surface allowlist and must reset scoped conversation continuity. Old controllers never retarget a different tenant.

## Code conventions

- Prefer small modules with one clear responsibility. Use guard clauses, discriminated unions, exhaustive switches, dispatch tables, and pure functions for domain rules.
- Avoid nested conditionals, nested ternaries, catch-all managers/services, speculative abstraction, and duplicate sources of truth. Do not implement a universal all-props component or a duplicate engine.
- `.oxlintrc.json` enforces on handwritten production code: functions within 80 lines, files within 500 lines, cyclomatic complexity within 12, and nesting within 3. Generated code and fixtures are excluded by explicit path.
- No `as any` casts, import cycles, unused production exports, unused dependencies, or unused locals/parameters. Do not add blanket lint waivers.
- Public API changes require package export-map updates, clean tarball consumer coverage, the matching `docs/packages/<package>.md` update, and a release note. A breaking change also belongs in the current migration guide under `docs/site/pages/`.
- Keep API and protocol version changes deliberate. Do not change serialized contracts as incidental cleanup.

## Component documentation

Write public documentation in English under `docs/site/`; do not place technical guides in package or application directories. Each catalog component has one authored file at `docs/site/components/<catalog-id>.md` and one runnable example. Explain the actual component behavior in plain language. Include purpose, when to use and avoid it, import, example, live preview, properties and defaults, events, states and failures, keyboard/focus/accessibility, responsive behavior, relevant performance limits, related components, and version notes. Generate API facts from declarations; do not invent defaults or emit generic filler such as “not declared.” Public page copy and navigation are authored in Markdown under `docs/site/pages/`.

Keep package guidance in `docs/packages/`. Release staging may generate the npm `README.md` files from those canonical documents. The root `README.md` is the repository overview and quickstart. Root Markdown is otherwise limited to `AGENTS.md` and required legal/community files.

## Generated files

- `design/generate-web-tokens.mjs` generates the web token output; edit its source tokens rather than generated CSS.
- `scripts/docs/build-public-docs.mjs` and `apps/site/generate-pages.mjs` produce public documentation and site artifacts. Edit canonical Markdown and generator code, not files under `artifacts/` or `dist/`.
- `packages/core/schemas` is generated from the core schema definitions during the core build.
- Do not commit local build output, caches, generated screenshots, or temporary consumer installations.

## Verification

- `quality/commands.json` is the complete acceptance matrix. Run `pnpm check` on a clean commit before release and read its fresh results.
- Pull requests and pushes to `main` run a lane matched to their changed paths: diffs confined to the site surface (`apps/site/`, `docs/site/`, `docs/public-site/`, `catalog/`, `examples/catalog/`, `scripts/docs/`) or to repository-only documentation (`docs/` outside `docs/packages/`, root Markdown) run the site gate (`pnpm format:check`, `pnpm lint`, `pnpm site:test`) plus the documentation artifact and image-contract steps; every other diff runs the full matrix in `quality/commands.json`. Owner dispatches always run the full matrix. CI runs the full matrix as four parallel shards (`python3 scripts/quality.py --shard N --shards 4`) and merges their evidence with `--merge 4`; `pnpm check` runs the same matrix serially. The container visual comparison and paired performance jobs run on pushes to `main` and owner dispatches as advisory evidence; they do not block merges or publication. Package publication requires a same-SHA full-matrix push success on `main`; a site redeploy after a site-surface-only push binds its registry checks to the earlier published source instead.
- Core and runtime changes need their package build, contract or lifecycle tests, type checks, and matching clean tarball consumer.
- Web components need family behavior tests, browser tests, keyboard checks, and `pnpm test:components:a11y`. Changes to public exports also need the matching package consumer.
- React, Vue, and Vanilla integrations are covered by `pnpm test:framework:consumers`; Next SSR and hydration are covered by `pnpm test:next-platform`.
- Component docs and previews need `pnpm test:docs-artifact` and `pnpm test:catalog-examples`; the latter typechecks, builds, mounts, and compares every copyable example with its catalog preview. Site or playground changes need `pnpm site:build`, `pnpm site:test`, and the affected browser checks.
- Run `pnpm test:visual` in Chromium, Firefox, and WebKit. Capture the affected routes at 360, 768, and 1440 pixels, then check keyboard and accessibility behavior.
- Prefer test-first changes and focused verification. Source existence, declaration-only compilation, or a mock-model success is not runtime or release evidence — show the real behavior.
- Before release, run `pnpm test:performance:bundles`, clean tarball consumers, release tooling, docs verification, and the production image smoke checks for `/healthz`, `/readyz`, `/version`, and representative routes.

## Working agreements

### Owner decision: planner timing, 1 October 2026

Presentation-planner latency is diagnostic data. No absolute planner-latency
threshold gates tests, CI, merges, package publication, or deployment. Keep raw
timings and traces; do not substitute a different planner timing threshold.
This decision supersedes the former planner p95 acceptance rule. See
[ADR 014](docs/adr/014-planner-timing-diagnostics.md).

- Keep diffs focused and preserve unrelated changes and other contributors' work. One writer per file scope when working in parallel.
- Do not weaken quality gates, invent supported frameworks, models, or scale claims, leak secrets, or bypass authorization. Paid calls, merges, package publication, and deployment each require their own explicit approval.
- Releases are maintainer-run: packages and the site image are published only from one fully verified source revision. Contributors do not publish versions or deploy.
- Preserve historical ADRs and release records; supersede decisions with a new ADR instead of rewriting history. Keep technical documentation under `docs/` and update it in the same change as behavior or API.
