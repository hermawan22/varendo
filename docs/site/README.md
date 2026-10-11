# Varendo site source

`apps/site` is the single public application. It serves the landing page,
documentation, the active component references and live previews, playground, and local
runner. The authored documentation is kept in this directory; package guides
are kept in `docs/packages/`.

The component catalog is the source for the public component routes. Each item in `catalog/components.json` has one authored page at `components/<catalog-id>.md` and one executable preview in `examples/catalog/`.

Keep frontmatter `component`, `title`, `family`, and `contract` aligned with the catalog entry. The docs build checks these values, required sections, generated directives, and exact set equality with the active catalog. Write guidance in the Markdown file; let the build supply facts from the executable example and generated TypeScript declaration.

Supported component page directives are `fixture`, `example`, `properties`, `events`, `states`, `outcome`, `keyboard`, `semantics`, `style-hooks`, `performance`, and `declaration`. The performance section appears only when a source-defined limit exists. Do not add a second copy of generated property, event, or example data to the prose.

Route metadata and the navigation groups live in `docs/public-site/routes.mjs`.
The generated docs artifact and the site build are checked against the same
component catalog and declarations.

## Build and verify

Use Node.js `24.20.0` and pnpm `11.24.0`, as declared by the repository
toolchain. Install with `pnpm install --frozen-lockfile`.

```sh
pnpm site:build
pnpm site:test
pnpm test:docs-inventory
pnpm test:docs-artifact
pnpm test:catalog-examples
```

`pnpm site:build` writes the static routes to `apps/site/dist`. The build uses
the public package builds and the authored pages above. `pnpm site:test` runs
the site, playground, docs navigation and layout, local-runner, static-server,
and provenance checks. `pnpm test:docs-artifact` validates the release docs
artifact, including active catalog set equality and mounted previews.
`pnpm test:catalog-examples` installs clean package tarballs, typechecks and
builds every active copyable example, mounts them in Chromium, and compares them
with the catalog previews.
The site check also captures SHA-256 indexed screenshot evidence for the
landing page, docs home, Table reference, and playground at 360, 768, and 1440
pixels. Component review captures for every active catalog entry are produced by
`pnpm test:visual`.

The production image is built from `apps/site/Dockerfile`. Its small Go server
provides `/healthz`, `/readyz`, and `/version`. The version response records
the site commit and SDK commit separately. The quality workflow builds and
smoke-tests this image before release; the release workflow publishes an
immutable image from the verified source revision. Production credentials are
not part of the site build.
