# WebMCP adapter

`@varendo/agent/webmcp` is an optional browser projection of one
host-owned `AgentToolEndpoint`. It does not contain a capability dispatcher,
model planner, browser automation fallback, or authority grant logic. The
endpoint remains the single executor for discovery and invocation.

```ts
import { createWebMcpAdapter, detectWebMcp } from '@varendo/agent/webmcp';

const hostDocument = document;
const capability = detectWebMcp({ document: hostDocument, evidence: 'native' });
const adapter = createWebMcpAdapter({ endpoint, document: hostDocument, evidence: 'native' });
const registration = await adapter.register();
if (!registration.ok) {
  // Keep the ordinary/manual path available.
}

// Dispose when the paired region is gone.
adapter.close();
```

The agent package never reads a global document. A browser composition root
passes its host document explicitly to `detectWebMcp` and the adapter; a supplied
model context is labeled `simulated` unless the host integration provides
`evidence: 'native'`. Importing the optional entry point is safe in SSR and Node.
`registerTool` receives a fresh `AbortSignal` for every tool;
disposing the adapter aborts those signals and closes the paired endpoint.
Chrome can leave a previously running native invocation alive after a tool is
unregistered, so the adapter's execute closure also checks its registration and
adapter lifecycle before and after the endpoint call. A late result is
discarded after disposal or cancellation.

The host endpoint must have `transport: 'webmcp'`. Its `discover()` result is
validated before registration: names are unique, ASCII `A-Z`/`a-z`/`0-9` plus
`_`/`-`/`.` and at most 64 characters, descriptions and schemas are bounded
wire data, and no external schema reference is introduced by this adapter.
Each native `execute` call receives a fresh opaque request ID and forwards the
browser cancellation signal to `endpoint.invoke`.

Each registered tool includes native WebMCP safety annotations derived from its
canonical operation grant. `catalog.read`, `result.inspect`, and
`task.evaluate` are marked `readOnlyHint`; `experience.commit`,
`meaning.activate`, `action.execute`, and `model.egress` are marked
`consequentialHint`. Every operation is marked `untrustedContentHint` because
an endpoint receipt can carry application or source data. These are browser
hints only: the paired endpoint still rechecks grants, scope, confirmation,
egress and lifecycle before doing any work.

`detectWebMcp({ document, evidence })` reports three evidence labels. Calling it
without a document returns `unavailable`, even in a browser, because the agent
package does not inspect ambient DOM globals:

- `native`: the browser integration supplied a detected native host document;
- `simulated`: an explicit document or model context was supplied without native evidence;
- `unavailable`: no supported host was supplied.

The adapter does not create a polyfill when the surface is absent. Native
support remains experimental and requires a real supported browser/version run;
simulated adapter tests prove the contract and lifecycle only.

The focused suite covers absent-host detection, simulated registration and
shared execution, native-versus-simulated labeling, operation-derived
annotations, native name validation, malformed discovery, native cancellation,
late rejection classification, and disposal/registration races. On 18 September
2026, the isolated headed Chrome for Testing 153.0.8010.12 probe reported the
API unavailable in its default state and passed with Chrome's local
`WebMCPTesting` feature enabled. The enabled run proved native registration,
discovery, invocation, cancellation propagation, unregistration, and late-call
denial. This is local experimental evidence, not a cross-browser support claim.
