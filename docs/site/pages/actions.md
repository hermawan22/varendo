---
id: 'actions'
path: '/guides/actions/'
section: 'Guides'
title: 'Business actions'
description: 'Register schema-validated commands with permission, confirmation, revision, idempotency, and ambiguous-completion handling.'
---

<p class="lead">An action is trusted application code behind an Varendo boundary. An agent or form may propose limited JSON input; only the host can confirm and dispatch a registered command.</p>

## When you need this

- A request should change data, not only read it — close a ticket, publish an article.
- Writes need confirmation, idempotent retries, or stale-record protection.
- An agent or form must propose a change without performing it.

## Know the lifecycle

<ol class="concept-flow"><li><span>01</span><div><h3>Preview</h3><p>Validate action identity, input schema, permission, entity revision, size, and idempotency policy.</p></div></li><li><span>02</span><div><h3>Confirm</h3><p>The trusted host or a user interaction confirms. An agent cannot confirm itself.</p></div></li><li><span>03</span><div><h3>Execute</h3><p>Recheck current authority and revision, then dispatch once through the registered command.</p></div></li><li><span>04</span><div><h3>Reconcile</h3><p>Show executed, rejected, or ambiguous completion. Cancellation after a remote write is not a rollback.</p></div></li></ol>

## 1. Register the action

Register each command with a versioned descriptor and schema-checked input and output. Its dispatch function may be called only through the runtime boundary.

**actions.ts**

```ts
import { ActionRegistry } from '@varendo/runtime/actions';
import { z } from 'zod';

const input = z.object({ ticketId: z.string(), status: z.enum(['open', 'resolved']) });
const output = z.object({ ticketId: z.string(), revision: z.string() });

export const actions = new ActionRegistry();
actions.register({
  descriptor: {
    ref: { id: 'support.set-status', revision: '1' },
    input: { id: 'support.set-status-input', revision: '1' },
    output: { id: 'support.set-status-output', revision: '1' },
    sideEffect: 'domain-write',
    confirmation: 'required', // a trusted host or user confirms; an agent cannot
    idempotency: 'required', // retries carry one stable key
    entityRevision: 'required', // refuse to write over a stale ticket
  },
  inputSchema: {
    ref: { id: 'support.set-status-input', revision: '1' },
    parse: (value) => {
      const parsed = input.safeParse(value);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            diagnostics: [
              { code: 'support.set-status.input', message: 'The status update input is invalid.', retryable: false },
            ],
          };
    },
  },
  outputSchema: {
    ref: { id: 'support.set-status-output', revision: '1' },
    // A completed dispatch returns an Outcome; validate its payload the same way.
    parse: (value) => {
      const parsed = z.object({ ok: z.literal(true), value: output }).safeParse(value);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            diagnostics: [
              { code: 'support.set-status.output', message: 'The status update output is invalid.', retryable: false },
            ],
          };
    },
  },
  dispatch: ({ input: proposal, context, idempotencyKey, signal }) =>
    tickets.setStatus(proposal, { context, idempotencyKey, signal }), // completed, rejected, or ambiguous
});
```

`tickets.setStatus` is ordinary application code on your backend. The registry returns an `Outcome` — a bad descriptor or schema mismatch fails with `action.invalid`, never a half-registered action.

## 2. Preview and confirm

The app emits an action event when a proposal is ready. Your UI reviews it and calls `confirm()` — or `cancel()`.

```ts
const app = createVarendoApp({
  resources,
  authority,
  onActionEvent: async (event) => {
    if (event.state !== 'preview') return;
    const accepted = await reviewDialog.open(event.preview); // your UI
    if (accepted) await event.confirm();
    else event.cancel();
  },
});
```

You should see: a preview event for each proposed action, then `executed` or `failed` after your decision.

## 3. Execute once and reconcile

Dispatch returns `completed`, `rejected`, or `ambiguous`. With `idempotency: 'required'`, a retry carries the same stable key, so a safe resend cannot duplicate the write. With `entityRevision: 'required'`, a stale record revision refuses the write.

## Keep payloads limited

Inputs and outputs are schema-validated JSON with size limits — including nested form groups, repeaters, and multiselect values. Files travel as host-owned upload references; arbitrary bytes never move through an agent's argument.

<aside class="doc-callout" data-tone="warning"><strong>Do not auto-retry uncertainty</strong><p>If the remote system may have completed the write, return an ambiguous result and offer a reconciliation path. Retrying can duplicate the command.</p></aside>

## What can go wrong

- A descriptor missing required fields, or schema refs that do not match the descriptor, fails registration with `action.invalid`.
- A stale entity revision refuses the write — reload the record and let the user retry.
- Cancellation after a remote write is not a rollback; reconcile `ambiguous` outcomes explicitly.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/forms/"><span>Forms</span><small>Bind create and edit recipes to registered actions.</small><b aria-hidden="true">→</b></a><a href="/agents/quickstart/"><span>Agent actions</span><small>Expose preview and execution through the limited tool endpoint.</small><b aria-hidden="true">→</b></a></nav>
