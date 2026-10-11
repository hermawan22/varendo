# Canonical contract schema source

Status: accepted, 8 September 2026.
independent core review approved by preflight_diagnosis. This record follows chapter 31.

Aeliqo currently has executable reference types and partial guards, not a
production core package. Four document families must have types, strict wire
validation and JSON Schema generated from one source. Core cannot import a
renderer, provider, DOM, database, filesystem, or ambient clock. Input must be
bounded before recursive schema evaluation, and successful shape validation must
not grant authority or claim semantic correctness.

Use the functional `zod/mini` API from exactly Zod 4.5.4 (MIT). Core declares Zod as a production
dependency; Zod has no transitive production package dependencies. Define strict schemas once in the core package, infer
public TypeScript types from them, emit declarations with TypeScript, and export
JSON Schema at build time with Zod's native converter. Keep the JSON Schema
converter in a build script, outside the browser runtime entry. Use tagged unions,
without coercion, defaults, transformations, arbitrary refinements or executable
extensions in wire schemas. Registry-approved semantics remain separate passes.

The current alternative, handwritten interfaces plus guards, has already drifted
and is rejected. JSON Schema plus a separate TS generator and Ajv is viable but
adds another generator and compilation boundary. A custom general validator or
schema generator would enlarge the trusted code surface without a product need.
Full Zod is viable, but the functional Mini entry permits a smaller lazy core
bundle. No evaluation compiler or runtime-generated code is required.

A local bounded spike verified a recursive discriminated shape, rejection of
unknown fields, inferred negative TypeScript fixtures, and JSON Schema recursive
references. An illustrative Mini validator bundled with the pinned Vite produced
26,016 JavaScript bytes / 7,191 gzip bytes. This measures only that small schema,
not the complete core or the 70 KiB planner/validation budget. The production
schema and final planner require their own measurements.

Ingress first rejects oversized text, non-JSON values, accessors, cycles,
excessive depth/nodes and unsafe object keys. Schema diagnostics expose bounded
paths and stable codes, not submitted values. Shape-only success is explicitly
separate from catalog binding, effect grants, temporal/grain math, DAG validation,
sequence state and business truth. Tests cover both layers as each is delivered.

Contract version `1` is independent of package `0.1.0`. The unpublished reference
Result descriptor omitted an envelope version despite the four-versioned-document
rule; the production Result document includes `version: '1'`. No published saved
contract is silently migrated. Unknown versions produce an unsupported-version
diagnostic; any future migration must be explicit and tested. Historical probes
remain labeled references and are never imported by production packages.

Revisit if the actual complete validation/planner entry breaches its existing
budget, JSON Schema cannot represent a required wire field, an interoperability
consumer fails, or measured parse costs exceed bounded runtime requirements.
Replacing the schema engine may retain the same generated wire contract, but
requires fixture parity and independent review.

Sources: [Zod JSON Schema](https://zod.dev/json-schema),
[Zod Mini](https://zod.dev/packages/mini), and the locally installed 4.5.4 package.

The package compiles without the DOM library. Development-only Node types supply
the standard URL declaration referenced by Zod metadata types; they do not
authorize Node imports in core. The installed consumer graph must separately
verify that the runtime contains no Node, renderer, provider or effect modules.

Independent Ajv 8.20.0 validation of generated draft-2020-12 schemas found that
Zod emits an invalid empty `prefixItems` array for an empty tuple. The generator
removes only that empty keyword; `maxItems: 0` and `items: false` preserve the
empty-array contract. Ajv and ajv-formats are development-only conformance tools.
Generated object/string/array limits mirror the ingress bounds, including property
name bounds; byte, node and depth bounds remain explicit ingress requirements.

No-code-generation acceptance means parser execution succeeds under enforced
string-code-generation prohibition. Zod's dependency source contains an unused
lazy compiler; this is not a static ban on those source tokens. The public parser
and schema exports do not expose that compiler. JSON text rejects duplicate keys
(including escaped-equivalent spellings) after native syntax validation, avoiding
last-value disagreement across consumers. Ordinary `constructor`/`prototype`
keys remain data; no prototype assignment or merge is authorized by parsing.

A follow-up review found that entity-local field IDs could silently rebind after builder
serialization. Field expressions now accept an optional explicit `entity` ID;
typed authoring emits it and semantic binding must preserve it. Existing ref-only
expressions remain wire-compatible and require unambiguous/context-bound semantic
resolution. This additive change is within the unreleased version1 contract;
there is no migration of published or saved customer data. No parallel field AST
or guessed first-entity lowering is permitted.
