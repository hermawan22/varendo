# Protocol compatibility

Varendo pins the official MCP TypeScript packages
`@modelcontextprotocol/server` and `@modelcontextprotocol/node` at 2.0.0,
and the patched `@modelcontextprotocol/client` at 2.2.0. These SDK packages implement the 2026-07-28 protocol;
its modern discovery exchange differs from the earlier `initialize` handshake.
Tests must report the negotiated era rather than assume the client supports it.
See the [official SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
and [protocol-version guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).

Chrome's current imperative WebMCP API is `document.modelContext`. Registration
accepts an abort signal; execution receives a separate signal. Since Chrome 153,
unregistering a tool need not cancel an already running invocation. Varendo's own
closed endpoint must still prevent late effects. Feature absence, simulated
registration and real native execution are separate evidence states. See the
[Chrome imperative API documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

The optional OpenAI reference uses the official `openai` SDK, pinned to 7.10.0
from its current npm tag. Responses function calls are proposals returned to the
application, which must execute permitted tools and return correlated tool
outputs. The SDK also exposes input-token counting. See
[function calling](https://developers.openai.com/api/docs/guides/function-calling)
and [input-token counting](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens).

No provider API key is configured in this task environment. Installing an SDK,
using a local protocol fixture, or running a synthetic model port does not prove
live provider access or reasoning quality. Real provider evaluation remains a
separate required gate.
