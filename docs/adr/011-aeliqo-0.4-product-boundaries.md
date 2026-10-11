# Aeliqo 0.4 product boundaries

Status: accepted for the 0.4 release.

## Context

The 0.3 workspace had separate applications for the public site, docs,
playground, and Studio. Their navigation and presentation drifted, while
component guidance was split between generated pages and package directories.
The release also needs a smaller, stable public package surface and a clear
source of truth for contributors.

## Decisions

- `apps/site` owns the landing page, documentation, component previews,
  playground, and local runner. The public site uses one fixed editorial
  palette: off-white reading surfaces, graphite product surfaces, and limited
  indigo accents. The site has no theme selector or system-theme switching.
- `docs/site/` is the authored Markdown source for public pages and all 71
  component guides. Component examples are executable catalog entries; API
  properties and signatures come from package declarations.
- The public package set is `@aeliqo/core`, `@aeliqo/runtime`, `@aeliqo/web`,
  `@aeliqo/react`, and `@aeliqo/agent`. Common use is available from package
  roots; specialized APIs use explicit subpaths.
- The Studio application and `@aeliqo/devtools` workspace package are removed.
  Their 0.3 npm artifacts and historical Git tags remain available. The
  devtools package receives a deprecation notice only after the 0.4 packages
  and site have passed release verification.
- `docs/packages/` is the canonical package-guide source. Release staging
  builds each npm `README.md` from that source.
- One release commit produces both the package set and the immutable site
  image. Production switches directly after acceptance gates pass; the prior
  image remains available for site rollback.

## Consequences

The old application trees and public-page implementation are deleted after
their routes and examples move to `apps/site`. The 0.3 to 0.4 migration guide
is the only migration guide in the public navigation. The component library
continues to support host-provided theme tokens even though the Aeliqo site
uses one fixed palette.

## Supersedes

This decision updates the site and package boundaries described by ADRs 001,
003, 006, and 008 for the 0.4 product. Those records remain unchanged as
history.
