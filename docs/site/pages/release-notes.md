---
id: 'release-notes'
path: '/ship/release-notes/'
section: 'Releases'
title: 'Release notes'
description: 'The Varendo 0.1.0 stable release and preserved source-bound records for earlier Aeliqo framework releases.'
---

<p class="lead">Read the changes and acceptance evidence for each version. Publication is verified separately from source changes.</p>
<aeliqo-release-status></aeliqo-release-status>

## Varendo 0.1.0

Published 12 October 2026: the first independent stable framework release under `hermawan22/varendo` and `@varendo/*`, based on Aeliqo 0.7.1 implementation and subsequent source fixes. The package scope changes; exported identifiers, element tags and serialized protocols stay compatible. Follow the [Aeliqo to Varendo migration guide](/ship/migration-varendo/).

All five 0.1.0 packages were published from `53406eeab85103fd0b1159e765ee3996e2b4ab70`. Its [full main-push quality run](https://github.com/hermawan22/varendo/actions/runs/38203288539) passed all 93 acceptance commands. The [canonical RC](https://github.com/hermawan22/varendo/actions/runs/38209749684) and [stable publication](https://github.com/hermawan22/varendo/actions/runs/38210717157) passed installed registry consumers and provenance verification at that same source. The stable consumer verified 166 exports; registry `latest` tags and tarball integrity were checked for all five packages. [Project status](https://github.com/hermawan22/varendo/blob/main/docs/STATUS.md) separates npm evidence from Pages deployment, the unpublished container image and advisory qualifications.

The Aeliqo release records below are preserved as historical evidence. Their package names, versions, source revisions and deployment claims describe the original project, not Varendo publication.

<span id="unreleased-launch-audit-corrections"></span>

## Aeliqo 0.7.1

This patch preserves the 0.7 API and serialized contract. Upgrade all Aeliqo
packages together. The [0.6 to 0.7 migration guide](/ship/migration-0.6/)
continues to apply when upgrading from 0.6.

- Keep temporary evaluation results out of the initial Region read set.
  Aborting or superseding the first data render no longer leaves an unavailable
  result reference that cancels a subsequent create form.
- Preserve accepted semantic interaction while an automatic layout prepares
  its renderer. Cancel stale preparation instead of overwriting the newer state.
- Show a pending receipt while the playground evaluates a new request.
- Keep quickstart question labels readable at narrow viewport widths.

## Aeliqo 0.7.0

These changes belong to Aeliqo 0.7.0. Upgrade all Aeliqo packages together and
follow the [0.6 to 0.7 migration guide](/ship/migration-0.6/) for the breaking OAuth
requirement. The serialized contract version remains `1`.

- Update the SSR/hydration fixture to Next.js 16.3.8 and the affected build
  dependencies to sharp 0.35.5, source-map-js 1.2.2, smol-toml 1.9.0
  and fast-uri 3.1.8.
  These updates address the dependency advisories reported before publication.
- Build the static server with Go 1.27.2 and keep the production image in
  quarantine until provenance and security scans pass. Promote the same
  immutable image digest only after those gates succeed.
- OAuth HTTP clients use the patched MCP client and require an explicit
  expected issuer. Existing OAuth client information and tokens must carry
  the matching issuer stamp; legacy storage must be migrated from a trusted
  issuer or cleared. Static bearer authentication remains available.
- A host-owned application tool session preserves action previews across
  freshly authenticated MCP calls. Each request still owns and closes its
  endpoint; the session owns confirmation, expiry, revocation, and single-use
  execution within a fixed principal and scope.
- Capability admission captures immutable input and metadata before awaiting
  authorization, preserving the admitted contents and byte limits.
- Form submission includes DateRange endpoints, honors the disabled-fieldset
  first-legend exception, and focuses its error summary after invalid slotted
  submissions. Input controls reject stale asynchronous validation without
  erasing independent host errors. NumberField treats signed zero equally at
  numeric bounds.
- Application mounting registers its base elements first, then loads the
  required component families before publishing a validated presentation.
  Custom extension renderers retain the full-registration fallback. Loading
  failure preserves the previous authorized result; cancellation and authority
  changes are checked again after loading. Bundle diagnostics now include the
  actual React quickstart and separate initial from deferred JavaScript.
- The site adopts a quieter editorial layout. Documentation reduces repeated
  introductory copy, and the playground shows its result before optional
  request details while retaining its existing scenarios and inspector.
- Contributor setup points to the complete prerequisites. The contribution
  policy checks new author signoffs and documents integration commits and
  accepted historical commits separately.

## Aeliqo 0.6.3

- The Next.js SSR/hydration example uses Next.js 16.3.6, which fixes the
  critical Node `next/og` ImageResponse vulnerability in earlier 16.3 releases.
  The example does not use ImageResponse; its dependency is updated so copied
  setups start from the patched version.
- Package versions, peer dependencies, examples and installation guidance move
  together to 0.6.3. Public APIs and runtime/wire contracts remain compatible
  with 0.6.2.
- The HTTP cancellation test now holds its fixture stream until transport
  cancellation, removing a fixed-timer race while preserving the server's
  cancellation assertion.
- Closing the playground action review with a double click preserves focus on
  the original trigger. The second mouse press is blocked before it can move
  focus to the page behind the dialog; deliberate later clicks still work.
- Successful standard form actions reset unchanged saved fields to their
  registered defaults, so visible values match the next action input. New
  edits made during the save and failed or ambiguous drafts are retained.
  Responsive presentation updates wait for the pending action to settle.
- Presentation-planner timing is diagnostic only. Its raw observations and
  traces remain available, with no absolute planner latency acceptance budget.
- Visual and paired layout/visualization references use reviewed source and
  runner evidence. Coverage, pixel rules, reducer/row budgets and relative
  comparison policies remain unchanged; this does not claim a speedup over an
  earlier version.

## Aeliqo 0.6.2

### Site update, 30 September 2026

- The quickstart results table fits narrow screens, keeps intent identifiers
  intact, and remains keyboard accessible with or without JavaScript.
- The playground task chooser precedes the result on narrow screens, matching
  its keyboard order.
- Introductory guides distinguish standalone components, the local React
  surface, and the registered-resource quickstart so you can choose a smaller
  setup for your first screen. npm packages remain at 0.6.2.

### Package release

- Tightens source-bound agent diagnostics and fixes the stalled row-policy test
  fixture so its real timeout is checked independently of CI planning load.
- Keeps package, examples, and public installation guidance on one exact
  version. Runtime and wire contracts remain compatible with 0.6.1.

## Aeliqo 0.6.1

- Agent tools are easier for models to use: `aeliqo_context` returns ready-to-send
  `examples`, a `viewGuide`, and `timeGrains`; `aeliqo_render` documents every
  property and fills `version`, `id`, and a unique measure `revision` when omitted.
  `AELIQO_AGENT_INSTRUCTIONS` exports a recommended model prompt.
- Analyze intents take a trend's calendar and timezone from the time field's
  declared policy when the intent omits them. A week start is never assumed.
- Linear chart axes are labeled with round steps from a zero baseline, cartesian
  charts draw the same gridlines as trend charts, and a single-series legend
  shows only the value.
- Counts use plain language: "4 records", "Showing 4 of 120 records", and "3 rows"
  for charts. Partial, sampled, and unknown coverage is still stated explicitly.
- The playground offers three copyable WebMCP prompts that each produce a
  different view, and the landing page is redesigned around asking a question
  and getting a fitting view.

## Aeliqo 0.6.0

Aeliqo 0.6.0 adds registered workspace and page layouts to the same
`createAeliqoApp` facade used for components. The host owns the data, permitted
views, header/sidebar structure, and business actions.

- `defineResource` accepts `measures` for counts, distinct counts, and sums.
  Each expands into a reviewed meaning, replacing about twenty lines of meaning
  metadata for the common case.
- A local data service resolves the built-in `core-query-2` and
  `core-standard-1` function registries from the catalog digest, so a resource
  with the default registry renders without host registry wiring.
- An analyze intent without a view preference now renders an eligible bar or
  trend chart; the table remains the fallback and can still be requested with
  `preferredView: 'table'`. Region charts are named after their result, such
  as "New hires by Team".
- The quickstart shows one resource answering browse, filtered, monthly trend,
  and per-team intents. The playground shows the exact intent behind each view.
- Cartesian charts fold their exact-values table into "View data table", keep
  x-axis labels on one row when they fit, follow the width of their region, and
  never label a fractional midpoint on an integer axis. Region trends are titled
  after their measure, such as "New hires".
- The mounted region bundle budget is 168 KiB gzip (previously 160 KiB since
  0.3) to cover workspace layouts and the chart improvements above.
- Visual comparison and paired performance CI jobs are advisory; the functional
  matrix remains required for merges and publication.

- Register `patterns` and `stateMappings` in `AeliqoAppOptions`. Recipes receive
  every result through `RecipeContext.results`; `result` remains the primary
  result for existing recipes.
- Container width and height changes re-resolve the presentation using existing
  results. Compatible state mappings project selection and filters. Layout
  changes remain subject to current authority and registered capabilities.
- `onDraftExit` lets the host choose Save/Discard/Stay before replacing a dirty
  form. Without a decision, replacement returns `needs-input`. Successful form
  actions clear only the unchanged drafts captured for that exact action.
- `onPresentation` observes successful renderer updates, including responsive
  adaptations. Runtime subscriptions keep their existing runtime-state role.
- Result bindings retain their complete identity, including `sourceLineage`,
  when candidates share otherwise identical nodes. Unavailable lineages remain
  rejected before a representation callback runs.
- The planner reuses successful field and operation checks within one
  composition for owned immutable configurations and validated registry
  declarations. Host-created structural registries and changes to data or
  permissions still require validation.
- Hierarchy data pagination keeps its buttons and row count grouped at narrow
  widths, including RTL and enlarged text.
- Factory-owned presentation registries can reuse bounded port checks for
  equivalent nodes within one composition. Structural host registries retain
  full validation, while public graph IDs and wire-size bounds stay unchanged.
- The public Playground offers manual tasks and experimental native WebMCP.
  Component, workspace, and page demos share the connection. Hosted MCP relay
  and in-page model setup are removed from this public surface.
- MCP HTTP/stdio and optional BYOK move to `examples/local-agent/`, a standalone
  app using public package exports. The model port remains provider independent;
  supplied protocol adapters document their wire-format requirements.
- Documentation starts with Get started, Components, and Advanced. Existing
  routes remain available. Component prose and copyable examples are maintained
  against the implementation.
- The docs reading column reflows when text is enlarged. Timeline previews
  reserve space for their responsive data table, and temporal selection buttons
  keep their labels on one line in narrow containers.
- Select chevrons, logical padding, focus, touch targets, form alignment, and
  token consistency are corrected while preserving public token names.
- Reduced-motion preferences apply to explicit dark themes, system themes,
  and inherited themes, including controls with custom inherited motion tokens.
- Dialog headings and close controls reflow at enlarged text sizes. Popover
  close controls follow the active theme, and RTL investigation cautions keep
  text inside their logical border and padding.
- Chart marks and numeric color keys share theme tokens in SVG and Canvas.
  Enlarged hierarchy/timeline labels remain visible, RTL switch thumbs stay
  within their tracks, and split-pane handles reserve their own touch area.

### Transactional rendering and narrow visualizations

Aeliqo 0.6 prepares and applies a presentation before publishing its task. Unsupported targets retain the previous authorized UI and state. Supported renderers restore the previous presentation after a synchronous rendering failure. Custom renderers must keep previous templates replayable; if restoration fails, the region is cleared and the candidate remains unpublished. Revocation clears private content and retains the host denial reason. Repeated comparison requests use fresh results with explicit child-state transfers. Standard data views preserve the existing 24px resize hysteresis band; registered layout patterns still receive every measured container size. Hierarchy and temporal exact-data tables adapt to their container width; their scrollable graphics retain readable label sizes.

Follow the [0.5 to 0.6 migration guide](/ship/migration-0.5/) when upgrading.
Use all packages at the same exact version. The new registrations and callbacks
are additive. A dirty form now blocks replacement until the host supplies an
exit decision; integrate `onDraftExit` if your application previously replaced
forms while edits were pending. Browser WebMCP remains experimental and requires
a supported, enabled configuration; it is not a requirement for manual use.

Use the [0.6.0 release record](https://github.com/Arconath/aeliqo/releases/tag/v0.6.0)
for source-bound quality, registry, image, and deployment receipts when published.
The publication banner above follows registry verification. The
[support matrix](/ship/support-matrix/) describes the maintained profiles and
recorded source checks; local or simulated results do not establish hosted-model quality.

## Aeliqo 0.5.2

This patch release keeps the 0.5 API and runtime contract intact. It ships the
clearer local React quickstart, the registered People app tutorial, and the
public 0.5 playground journeys. The documentation shell is polished and the
playground journey surface redesigned. The public component catalog gains
contract summaries and integration-level chips.

Two boundary corrections ship in this patch:

- Scoped agent endpoints now mint only the intersection of the host grant
  ceiling and the operations their tools require. A broader request is clamped
  rather than unioned, so `manual` pairings no longer carry the unused
  `model.egress` grant.
- Modal drawers now trap keyboard focus like dialogs and popovers.

There is no `0.5.1`; this release supersedes that version number. Install all
five packages at exactly `0.5.2` when using this release.

## Aeliqo 0.5.0

All five `0.5.0-rc.2` packages and matching stable `0.5.0` packages were
published from accepted source `4e8b0395b92eee699da4e25c3cd4991bc50b4a5e`.
The [Quality run](https://github.com/Arconath/aeliqo/actions/runs/35974446712),
[RC publication run](https://github.com/Arconath/aeliqo/actions/runs/35985377354),
and [stable publication run](https://github.com/Arconath/aeliqo/actions/runs/35988121627)
succeeded. The [site image run](https://github.com/Arconath/aeliqo/actions/runs/35988444181)
also succeeded. At image publication, production cutover and public live checks
had not yet been verified.
Production was subsequently accepted at 2026-09-24 11:17 UTC in the
[platform deployment evidence](https://github.com/Arconath/platform-apps/commit/1ffebc47de046c17f1d8b9fba4b059a5cf8fe94a) (internal repository).
The apex, www, and docs sites reported 0.5.0 at that source revision. The
[stable GitHub release](https://github.com/Arconath/aeliqo/releases/tag/v0.5.0)
was published after live verification.
The [platform cutover receipt](https://github.com/Arconath/workspace/blob/c35cb83c60e276a21f7500fa39a497db17e000a6/docs/platform/cutover.json) (internal repository)
records reviewed promotion gates plus Flux and pod readback. It also records a
qualified route back to the retained 0.4.2 image. No production rollback was
executed.

This is a breaking successor to `0.4.2`. The historical `0.5.0-rc.1` was
published from an earlier source revision that lacks the local React path
described below. Do not use that RC as evidence for this source.

DeepSeek `deepseek-flash` passed the bounded 12-case synthetic J1–J3 live
browser/provider/renderer corpus on tree-equivalent PR head `21afcca` (tree
`955a7d1`). The [sanitized 12-case receipt](https://github.com/Arconath/aeliqo/blob/main/docs/releases/0.5.0/evidence/deepseek-flash-j1-j3-21afcca.json)
records each result. This is model- and corpus-specific evidence; it does not qualify
other hosted models or production workloads.

The [public 0.5.0 browser receipt](https://github.com/Arconath/aeliqo/blob/main/docs/releases/0.5.0/evidence/public-acceptance-4e8b039.json)
records docs navigation/search, the no-AI People Jakarta, Daily attendance,
and Analytical workspace journeys, and a downloadable ZIP. The separate
[clean consumer receipt](https://github.com/Arconath/aeliqo/blob/main/docs/releases/0.5.0/evidence/live-export-consumer-4e8b039.json)
records installation of the exact 0.5.0 packages from npm. It also records a
successful build and browser rendering of the ZIP's synthetic products.

The items in this section describe the 0.5.0 source. For an existing
0.4.2 integration, use the compatibility app/Region path described in
the [registered-app tutorial](/start/registered-app/). The providerless local surface
and scoped APIs below require matching 0.5 packages. Follow the
[0.4.2 to 0.5 migration guide](/ship/migration-0.4/) for adoption boundaries.

The agent context can expose host-registered custom intents, presentation
patterns, and time-window constraints for a paired Region. The host remains
the authority for compilation, query bounds, and rendering.

- `@aeliqo/core/features` introduces immutable data and non-data feature
  definitions. Data features lower through the existing resource/catalog path.
  Non-data features declare versioned intents, views, and bounded capability
  schemas without fabricating relational data.
- `@aeliqo/runtime` adds scoped surface controllers with immutable
  instance addresses and per-runtime reference-counted registration. Ownership
  stays internal or explicitly host-controlled, with real
  `DataService`/Region/Result integration. Capability bindings carry an
  address-independent typed initial intent, and permission changes fence
  pending host proposals. The new host-resolved scope controller adds inert
  attachment, guarded Save/Discard/Stay workspace transitions, forced
  revocation, and monotonic activation epochs. It fences child surfaces without
  treating a client workspace ID as authority. Its required synchronous,
  side-effect-free preparation hook atomically revalidates captured old-scope
  and target authority before fencing. A separate commit hook starts target
  effects only after the old activation is fenced.
  Existing app/Region APIs remain the compatibility path.
- Local implementation and acceptance evidence cover runtime, React, migration,
  compatibility, browser, documentation, performance, and packed-consumer
  gates. Production workload behavior needs separate environment evidence.
- The runtime now exposes one canonical
  `createLocalDataBinding` adapter under `@aeliqo/runtime/surfaces`. It lowers
  through the existing `LocalDataService`, ResultStore, and Region paths. It
  validates bounded local shape and identity diagnostics. It preserves
  controller addresses across explicit source revisions and rejects
  same-revision or catalog conflicts atomically.
- The local React path can now use `useDataSurface({ data, getRowId })` with an
  owned providerless local controller. Its runtime source can accept an
  opt-in monotonic revision sequence for long-lived updates. It rejects stale
  or changed-content replay; identical current-revision content remains
  a no-op. The default arbitrary-revision cap is unchanged. Native React
  adaptive selection requires trusted presentation evidence and uses the
  shared resolver. Standalone view registration alone is not automatic
  eligibility.
- Native React registrations now accept a trusted `load` function for a
  route-split view. The adapter retains an authorized previous view during
  loading and failure, exposes retry, and clears old content on target loss.
- The optional model adapter restricts unauthenticated profiles to explicitly
  allowlisted loopback origins. Remote hosted connections require a
  server-owned credential profile.
- The trusted local Playground runner rejects cross-site browser requests to
  session bootstrap, including requests that omit `Origin`. The public
  attendance and workspace journeys show a readable status while retaining
  machine receipts in Inspect.
- Remote data now uses the same validated `DataService`, ResultStore, and
  Region path as local data. Catalog capabilities declare metrics and stable
  snapshot or keyset pagination. Cursors are partitioned by authority and pin
  target, query, ordering, semantic revisions, consistency, and expiry.
  Expiry uses a wall clock while request work retains a separate monotonic
  budget clock. Local continuation metadata is kept in a bounded host registry.
  An accepted continuation plan pins its validated offset, so registry eviction
  cannot restart the query from the first page.
  Partial pages preserve unknown or estimated population metadata, and only a
  server-proven aggregate may claim complete global coverage. The localhost
  protocol fixtures remain synthetic and do not prove a production backend.
- Semantic aggregate plans now retain and revalidate their registered meaning
  binding. Semi-additive period-end selection is deterministic. Ratios and
  variadic means keep their registered behavior. Nested/count aggregates apply
  the meaning's missing-value policy instead of silently weakening it.
- `@aeliqo/core` now provides bounded `inferLocalDataShape` diagnostics for
  declared or structurally inferred scalar fields. It does not infer authority,
  coverage, relationships, or business identity. The two helpers remain part
  of the 0.5 source.
- `@aeliqo/core/presentation` now exposes the pure `resolvePresentation`
  decision facade. It returns a validated `ready` plan, structured
  `needs-input` choices, or bounded `unsupported` reasons from supplied
  evidence only. Target evidence is not authority, explicit view pins do not
  silently fall back, and preferred pins only influence deterministic ranking.
- The advanced React path accepts `useSurface(feature, { id, bindings })`
  under the nearest `AeliqoProvider` and active `AeliqoScope`. Controller
  creation and the first request occur after React commit. `AeliqoScope`
  gates children by the committed activation. A voluntary Save / Discard /
  Stay transition keeps the old authorized subtree mounted while access
  remains valid. Accepted A→B→A activations create new controllers, and old
  callbacks retain their old address. Initial, denied, invalidated, and
  disposed scopes show safe states. The factory and providerless local paths
  remain available.
- Registered presentation patterns can be discovered from the active
  experience without an application-supplied placeholder plan. The synthetic
  attendance workspace uses this path for its summary, daily trend, and
  employee breakdown. The attendance example derives its civil-day query
  bounds from the period shown to the user. It explicitly rejects unsupported
  timezone projections.
- The paired agent context can expose host-registered custom intent schemas
  and presentation pattern references for a routable resource. The live
  attendance workspace publishes these refs from the compiler and pattern
  used by its render path.
- The public playground adds People Jakarta, Daily attendance, and Analytical
  workspace journeys alongside People, Products, Support, and Knowledge.
  Manual operation remains available without a model. Model prompts use a
  configured same-origin local runner. The site no longer accepts a provider
  key in the browser or sends browser requests directly to the provider.
  Exported 0.5 source projects require a site image whose matching packages
  passed an exact-version registry install and build check.
- Region trend charts pass the validated presentation locale to their chart.
  The low-level chart uses Indonesian controls, scope text, and accessible
  labels when its host sets `lang="id"` or `lang="id-ID"`. Application titles
  and series names remain host-owned.

## 0.4.2

- Adaptive data recipes now obey each resource's allowed views during selection
  and final plan validation.
- Preferred trends bind requested semantic time and measure fields. Ambiguous
  time or measure choices return a needs-input diagnostic.
- `RecipePresentationPolicy` is exported from `@aeliqo/web` and
  `@aeliqo/web/recipes` for direct recipe integrations.
- Trend charts measure their container instead of stretching fixed SVG
  geometry, including narrow labels and constant-value series.
- The People playground now proves employee browse, team filtering, detail,
  and semantic monthly headcount. The same Without AI and connected agent
  paths cover them.
- The site and components share one generated token source with system, light,
  and dark themes. Theme choice persists without changing application data.
- The React-first tutorial now covers a complete table, filter, semantic chart,
  controlled form, and bounded agent endpoint. Component reference pages add
  property ownership, event payloads and timing, listener examples, states,
  accessibility, responsive behavior, and performance limits.
- DeepSeek BYOK distinguishes configured, connecting, verified, failed, and
  disconnected states. Simulated and native WebMCP evidence are reported
  separately, with an opt-in native lifecycle probe.

## Product

- Landing page, documentation, component reference, and playground run from the
  single `apps/site` application.
- The site shares one token system across light, dark, and system modes.
  Component consumers can still supply their own design tokens.
- Every catalog component has an authored reference page and runnable preview.

## Packages

The public workspace contains `@aeliqo/core`, `@aeliqo/runtime`,
`@aeliqo/web`, `@aeliqo/react`, and `@aeliqo/agent`. Root imports cover common
flows; specialized APIs use explicit subpaths. See [packages and entry
points](/reference/packages/) for the supported map.

The core root includes typed parsers for queries, interactions, presentation
plans, and result events. Use these when the contract kind is known; use
`parseContract` for dynamically selected kinds.

## Breaking changes

The 0.4 release removes the Studio app and `@aeliqo/devtools`. It narrows
package root exports and removes legacy input names and MCP request forms. A
`taskId` is required for task-scoped data requests. The web application facade
is imported from `@aeliqo/web/app`; the package root remains usable without the
optional runtime peer. `@aeliqo/react` declares `@aeliqo/runtime` as a required
peer for its app and region state API. Follow the
[0.3 to 0.4 migration guide](/ship/migration-0.3/) when upgrading an existing
integration.

## Runtime contract

The serialized wire version remains `1`. Manual code and connected agents use
the same validated intent path. Application code retains authority over
identity, data access, actions, and business effects.
