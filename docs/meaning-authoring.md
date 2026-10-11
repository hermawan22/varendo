# Meaning authoring

Meaning authoring has one canonical definition and evaluator path. Developer
code and optional AI assistance produce a typed `MeaningDefinition`
validated against the application `Catalog` and versioned `FunctionRegistry`.
Authoring a meaning does not choose a component or grant an effect.

## Manual, code-owned definitions

The runtime builder reuses the existing catalog fields. It does not require a
second schema or a model/provider call:

```ts
import { createMeaningAuthoring, createMeaningRegistry } from '@varendo/runtime/meaning';

const authoring = createMeaningAuthoring({ catalog, registry });
if (!authoring.ok) throw new Error(authoring.diagnostics[0].code);

const amount = authoring.value.field('orders', 'amount');
if (!amount.ok) throw new Error(amount.diagnostics[0].code);
const total = authoring.value.defineMeaning({
  id: 'orders.total',
  label: 'Order total',
  description: 'The sum of authorized order amounts',
  expression: authoring.value.call({ id: 'core.aggregate.sum', revision: '1' }, [amount]),
});
if (!total.ok) throw new Error(total.diagnostics[0].code);

const meanings = createMeaningRegistry({ catalog, registry });
if (!meanings.ok) throw new Error(meanings.diagnostics[0].code);
meanings.value.register({ draft: total.value });
```

`field`, `call`, `defineMeaning`, and `bundle` all use the core expression and
semantic checks. Errors retain a stable code and path. A code-owned draft has a
stable ID, revision and digest. Re-registering identical canonical content is
idempotent; a different definition with the same ID and revision is a conflict.
The application bundle remains the source of truth.

## AI-assisted proposals

The optional agent package only adapts bounded AI input into the same runtime
builder. It has no model SDK and cannot activate a definition:

```ts
import { createAgentMeaningAuthoring } from '@varendo/agent';

const ai = createAgentMeaningAuthoring({ catalog, registry });
if (!ai.ok) throw new Error(ai.diagnostics[0].code);
const proposal = ai.value.propose({
  meaning: candidateMeaning,
  assumptions: ['The source relation is complete for this session.'],
});
```

The default AI proposal policy permits session and personal scopes, requires
`origin: 'ai-assisted'`, `lifecycle: 'draft'`, and `authority: 'hypothesis'`,
and preserves those labels in the returned draft. A host can narrow or widen
the scope policy explicitly, but proposal policy does not grant activation.
`meaning.propose` and `meaning.activate` are separate registered capability
operations; the dispatcher obtains their grants from trusted host context.

Code-owned definitions are read-only after registration. A review adapter or AI
proposal workflow may call `proposeDiff` to produce a candidate revision, but
no route silently overwrites the application bundle or shadows an immutable
ID/revision.

## Local evaluation and activation

`createMeaningEvaluator` lowers a meaning to the core query planner and local
evaluator. Manual and AI drafts therefore produce the same query/result shape.
It accepts an already-authorized bounded `QuerySource`, checks catalog/function
registry and optional scope/policy pins, and performs no source, network or
model effect. Host-backed meanings return an explicit unsupported diagnostic
until the application supplies their executor.

Activation is owned by the host. `createMeaningRegistry` requires a fresh
activation context with independent `meaning.activate` grant, exact
allowlisted canonical definition, scope and policy pins. The context is read
before and after authorization; changes, revocation or cancellation return a
stale/denied outcome and no active entry is published. Activation never
elevates an AI hypothesis or infers authority from its origin.

## Registry lifetime and immutable activation

Create a registry for one authorized catalog, principal and data scope. The first
successful activation pins its principal and scope digest; create another registry
when switching either. A definition's `scope` (`session`, `personal`, `workspace`
or `organization`) describes where the meaning is authored and reused. It is
separate from the authorization `scopeDigest`; a single authorized scope can
contain definitions from several authoring scopes.

Registration preserves the complete definition at an immutable ID and revision.
An allowlist cannot replace that content during activation. To review a draft,
create a new immutable revision carrying its reviewed lifecycle/authority, register
it, and activate that exact revision through the trusted host. This is a domain
review step, not a requirement for end users to approve built-in meanings per
question. Code-deployed catalog definitions remain available when an identical
local draft is registered, until explicitly revoked in that registry.

Bundles validate their entire dependency graph before registration changes any
entry. Activation requires active dependencies. Revoking a definition also revokes
registered dependents, and the registry's definition view excludes revoked catalog
entries and unavailable dependency closures. Scope revocation reports every newly
revoked entry, invalidates pending activation, and prevents later activation in
that scope. Locally registered draft bytes are bounded in aggregate, including revoked
entries. Scope revocation records are separately capped at `maxEntries`. Reauthorization
uses a new registry with a fresh authorized catalog/context.

A calling adapter can pass trusted `expectedAuthority` pins to activation. The
agent capability does this using its dispatcher's principal and optional read set;
these pins never come from a model proposal. Both authority reads are copied,
checked for matching policy/context pins, and compared before publication.

AI-assisted developer definitions may retain `origin: 'ai-assisted'` while their
source is code-owned and read-only. Exporting or reviewing a definition does not
automatically relabel its origin as manual. Authoring, evaluator and registry
construction take private snapshots; edits to the original catalog, definitions
or policies require a new instance.
