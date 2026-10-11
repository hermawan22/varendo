---
id: "diagnostics"
path: "/reference/diagnostics/"
section: "Reference"
title: "Outcomes and diagnostics"
description: "Stable machine codes, bounded human messages, paths, retryability, and recovery behavior."
---

<p class="lead">User-facing recovery follows receipt status first, then diagnostic code. Do not branch application logic on a human message.</p>
<h2>Diagnostic shape</h2>

**Type**

```ts
interface Diagnostic {
  code: string;
  message: string;
  path?: readonly (string | number)[];
  retryable: boolean;
  remedies?: readonly string[];
}
```

<h2>Recovery map</h2><div class="doc-table"><table><thead><tr><th>Status</th><th>UI behavior</th><th>Automatic retry?</th></tr></thead><tbody><tr><th><code>needs-input</code></th><td>Show the bounded choices or missing form field.</td><td>No; wait for user input.</td></tr><tr><th><code>denied</code></th><td>Remove no-longer-authorized data and explain the access boundary.</td><td>No.</td></tr><tr><th><code>cancelled</code></th><td>Usually remain quiet when superseded; preserve current work.</td><td>No.</td></tr><tr><th><code>unsupported</code></th><td>Keep the previous valid UI and show a supported alternative.</td><td>No.</td></tr><tr><th><code>failed</code></th><td>Show an actionable recovery near the affected Region.</td><td>Only when <code>retryable</code> and host policy allow it.</td></tr><tr><th>Ambiguous action</th><td>Show uncertainty and a reconciliation control.</td><td>Never retry blindly.</td></tr></tbody></table></div>
<h2>Privacy</h2><p>Diagnostics and audit events use fixed codes and bounded metadata. Keep credentials, row payloads, prompts, URLs with secrets, free-form identity, and private reasoning out of logs and inspectors.</p>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/agents/recovery/"><span>Agent recovery</span><small>Apply outcomes to language-driven UI.</small><b aria-hidden="true">→</b></a><a href="/ship/"><span>Production acceptance</span><small>Exercise every applicable state before release.</small><b aria-hidden="true">→</b></a></nav>
