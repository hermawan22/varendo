---
id: 'agent-recovery'
path: '/agents/recovery/'
section: 'AI agents'
title: 'Agent recovery'
description: 'Keep the application understandable when language is ambiguous, the provider fails, the session expires, or an action outcome is uncertain.'
---

<p class="lead">Agent sessions fail in ordinary ways: vague requests, dead providers, expired pairings, uncertain writes. Show each state honestly and keep the user's last good screen.</p>

<h2>Ask when the request is ambiguous</h2><p>Return <code>needs-input</code> with bounded choices such as the intended period, resource, or action. Show the proposed filters and target view so you can inspect the interpretation.</p>

<p>For example, a trend request that leaves two eligible measures unresolved comes back as a receipt like:</p>

**needs-input receipt**

```json
{
  "status": "needs-input",
  "requestId": "req-42",
  "regionId": "people-main",
  "diagnostics": [
    {
      "code": "web.recipe.needs-input.measure",
      "message": "Choose one requested measure before rendering a trend: Present employees, Absence days.",
      "retryable": false
    }
  ]
}
```

<p>The honest response is a visible choice between the eligible measures — not a guessed chart.</p>
<h2>Survive provider and transport failure</h2><p>Keep the last still-authorized UI, say that the connection failed, and leave manual controls available. Stop repeated failures that provide no new information.</p>
<h2>Re-pair after expiry or revocation</h2><p>Reject the call, cancel in-flight work, clear any now-unauthorized Region data, and have the trusted host pair again.</p>
<h2>Treat uncertain writes honestly</h2><p>A remote write may have happened even when its answer is lost. Show an ambiguous receipt plus a host-defined reconciliation action. Never report cancellation as rollback, and never auto-retry a non-idempotent write.</p>
<h2>Write truthful copy</h2><div class="doc-checklist"><ul><li>“UI updated” appears only after the matching runtime/renderer receipt.</li><li>Displayed numeric summaries are derived from Result evidence.</li><li>Model prose is not promoted to application fact.</li><li>The inspector shows intent, compiled Task, Result descriptor, selected view, and diagnostics — not chain-of-thought.</li></ul></div>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/reference/diagnostics/"><span>Diagnostics</span><small>Map outcomes to actionable recovery.</small><b aria-hidden="true">→</b></a><a href="/ship/"><span>Ship checklist</span><small>Verify manual and connected journeys together.</small><b aria-hidden="true">→</b></a></nav>
