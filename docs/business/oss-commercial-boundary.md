# OSS and commercial boundary

## Shipped as Apache-2.0 source

Varendo's core contracts, evaluator, runtime, HTTP and local data paths, complete
component catalog, React bindings, agent and protocol plumbing, security and
accessibility behavior, and internal testkit source are Apache-2.0. The five
public packages are `@varendo/core`, `@varendo/runtime`, `@varendo/web`,
`@varendo/react`, and `@varendo/agent`. The testkit stays a private workspace so
its release-only helpers are not mistaken for another public API.

These capabilities run without a license server, account callback, hosted
control plane, paid row limit, or mandatory model call. Applications may use
local records and the local evaluator entirely offline. HTTP data sources, MCP,
and BYOK providers are optional host-configured effects; their network use is a
property of that chosen integration, not a framework licensing dependency.

Security, authorization hooks, accessibility behavior, and the required
component families are not paid upgrades. A configured local application keeps
working when a future hosted service is unavailable.

`@varendo/runtime/audit` supplies the basic local audit export: a bounded,
in-memory collector for fixed plan, capability, cancellation, source, cache,
renderer, and resource event families. It rejects arbitrary messages, prompts,
records, identity fields, URLs, and unknown properties, and discloses when its
count or byte ceiling evicts older records. The application owns collector
scoping, persistence, transport, access control, and any longer retention. The
runtime performs no audit network or filesystem I/O.
