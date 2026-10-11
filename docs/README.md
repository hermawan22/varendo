# Varendo technical guides

The public website at [Varendo documentation](https://hermawan22.github.io/varendo/) is the primary adoption guide and generated component reference. The files here explain implementation details for contributors and teams integrating advanced Varendo boundaries.

[Project status](STATUS.md) records the goal, the published versions, and open items.

## Start integrating

- [Package guides](packages/README.md): canonical usage, root APIs, and subpaths for the five published packages.
- [Framework integration](framework-integration.md): Vanilla, React, Vue, SSR, hydration, and package boundaries.
- [Meaning authoring](meaning-authoring.md): define, register, review, and activate versioned business meaning.
- [Presentation adaptation](presentation-adaptation.md): bind Results to responsive presentations without changing their claim.
- [Aeliqo to Varendo migration](site/pages/migration-varendo.md): package scope, compatibility, deployment boundaries and rollback.
- [Migration from 0.6 to 0.7](site/pages/migration-0.6.md): the current upgrade guide.
- [OSS boundary](business/oss-commercial-boundary.md): what ships under Apache-2.0 and runs without a hosted service.

## Components and composition

- [Foundation components](foundation/README.md)
- [Inputs and semantic fields](input/README.md)
- [Navigation](navigation/index.md)
- [Feedback](feedback/index.md)
- [Data components](data-components/README.md)
- [Plots](plot/README.md)
- [Visualization](visualization/README.md)
- [Semantic compounds](compounds.md)
- [Compound validation](compound-semantic-validation.md)
- [Navigation and feedback regions](navigation-feedback-region.md)

## Runtime and tools

- [Agent protocol overview](agent-protocols/compatibility.md)
- [MCP integration](agent-protocols/mcp.md)
- [Bring your own model](agent-protocols/byok.md)
- [WebMCP boundary](agent-protocols/webmcp.md)
- [Basic monitoring](basic-monitoring.md)

## Design and verification

- [Public-site and component visual contract](design/visual-contract.md)
- [Token ownership and component theming](design/owned-baseline.md)
- [Synthetic HR oracle fixture](fixtures/hr.md)
- [Deterministic public API scenarios](fixtures/scenarios.md)
- [Independent query oracle](testing/query-oracle.md)
- [End-to-end scenarios](testing/scenarios.md)
- [Security package boundary test](testing/security.md)
- [Internal test helpers](testing/testkit.md)
- [Component review captures](testing/visual-review.md)
- [0.6.3 visual reference review](testing/0.6.3-visual-reference.md)
- [Paired performance procedure](testing/paired-performance.md)
- [0.6.3 performance reference review](testing/0.6.3-performance-reference.md)

Agent documentation describes the optional `@varendo/agent` product package. It is unrelated to repository automation or contributor tooling.

## Architecture decisions

The [architecture decision index](adr/README.md) records stable choices, including the 0.4 site, package, and component tooling decisions in [ADR 011](adr/011-aeliqo-0.4-product-boundaries.md).

## Public documentation source

Authored public pages and component guidance live in [`site/`](site/). The route manifest and package declarations supply navigation and generated API facts; component prose stays in the Markdown source. Release artifacts are generated under the ignored `artifacts/public-docs` directory and must not be committed.

The [site source and verification guide](site/README.md) covers the single
public application, authored content, local build, and production image checks.

## Repository examples

- [Vanilla, React, and Vue hosts](examples/platform.md)
- [Next.js SSR and hydration](examples/next-platform.md)
- [HR runtime vertical slice](examples/vertical-slice.md)
- [Synthetic HTTP reference host](examples/reference-host.md)
