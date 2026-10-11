# Deterministic presentation compiler

The presentation compiler turns a bounded set of task needs, authorized result
descriptors, an Experience, and an installed renderer registry into a validated
`PresentationPlan`. It is a pure core pass. It does not read the DOM, call a
model, fetch data, or grant runtime effects.

## Registry entries

`createPresentationRegistry` installs versioned representation manifests,
interaction mappings, optional tested patterns, and exact state mappings. Registration is local trusted
code. Metadata is checked as bounded wire data, callbacks must be synchronous
functions, and the resulting registry is deeply frozen. Representation and
pattern identities are unique. Pattern IDs are unique even when their revisions
differ because Experience allowlists currently name pattern IDs.

A representation resolver receives the proposed bounded values, the exact
authorized result (when one is bound), and the parsed node. It returns the fields,
ports, and enabled operations that the configuration actually exposes. A
representation may also provide a bounded suggestion and an ordinal quality
assessor. Quality is an optional selection signal, not proof of business truth:
the four scores are integers from 0 through 100, and a measured cost includes a
versioned measurement reference.

## Validation

`validatePresentationPlan` parses and freezes the plan and host context, checks
current commit pins and result ownership, resolves every representation through
the registry, verifies the containment tree and interaction graph, and proves
task-operation and field coverage from resolved configuration. It also enforces
Experience restrictions, renderer capabilities, result grain bindings,
simultaneous visibility, and incumbent transition/state-transfer rules.

Pattern matching runs only after all ordinary feasibility checks. A match never
bypasses permissions, result binding, coverage, or transition checks. If
`allowWithoutPreset` is false, the final plan must match an allowed registered
pattern. Pattern callbacks receive a frozen context containing the parsed task,
Experience, current pins, authorized result descriptors, and environment. Async,
throwing, malformed, or otherwise unbounded callback results are rejected.

## Composition

`composePresentation` validates every incumbent and explicit candidate with the
same validator. Pattern candidates are expanded only through the matching
registered pattern, and the expanded plan is then normalized to the composition
request identity and current preconditions before validation. A generated
candidate uses only installed manifests and suggestions, satisfies all required
needs, and visits complete assignments lazily within the expansion budget without
materializing a Cartesian product. Node identities are retained
when an incumbent has a compatible view; new views use stable need-based IDs.

Search is bounded by the Experience expansion limit (capped by the core wire
limit). A complete generated candidate (suggestion, build and validation) consumes one
expansion, so a one-expansion budget can finish a feasible candidate. Explicit
validation and a registered pattern expansion plus validation each consume one
expansion. Callback payload/work limits remain in force. The compiler keeps the
best feasible candidate found so far, ranking task fit, information density,
interaction effort, legibility, measured cost, explicit preferences, optional
coverage, and change cost with deterministic tie-breaking. Reaching the bound is
reported as `search-exhausted`; when all generated assignments in the bounded installed registry are
checked without a feasible plan, the result is `conflict`. A rejected candidate
is retained in the result's diagnostics so the host can explain incompatibilities.

The composition result is an immutable value. Runtime code decides whether and
how to render or commit it after this pure feasibility pass.

State mappings are the optional fourth registry argument. A `transfer` maps the
same semantic view ID and role between registered representations. An `archive`
moves a removed view's state into a retained owner; it does not discard drafts,
selection or navigation. Both require exact from/to representations and roles,
and the host must list the renderer's implemented mapping refs in
`stateMappingCapabilities`. Unregistered, unadvertised or stale mappings fail.
The pure compiler validates declarations; transactional state application and
rollback belong to the runtime. Active focus/draft/IME blocking and explicit-only
transition policy still apply. Same-representation identity transfer uses the
existing `aeliqo.state.identity@1` mapping.

Operation restrictions apply to every enabled resolved operation, even if a
coverage annotation omits it. Queryless tasks with zero required needs can use a
registered no-result root suggestion. This does not invent form configuration:
the installed resolver remains authoritative about supported bounded values.
