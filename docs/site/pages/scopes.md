---
id: 'scopes'
path: '/guides/scopes/'
section: 'Guides'
title: 'Application scopes'
description: 'Bind surfaces to a host-authorized workspace and fence stale work across voluntary switches and revocation.'
---

<p class="lead">A scope binds each surface and its work to one authorized target, such as a workspace. A workspace ID selects a candidate — it never grants permission.</p>

## When you need this

- Users switch workspaces, projects, or tenants inside your app.
- A dirty draft must be saved or discarded before a switch.
- Lost access must clear every child surface at once.

## 1. Implement the binding

Create the scope at your app's composition root. The binding resolves the selector and authorizes the target using current host state. Every `host.*` callback is your code, so the selector alone grants nothing.

**scope.ts**

```ts
import type { ScopeBinding } from '@varendo/runtime/scopes';

const binding: ScopeBinding = {
  resolve: (selector) => host.resolveWorkspace(selector),
  authorize: (resolution) => host.authorizeWorkspace(resolution),
  prepareActivation: (target, context) => host.acceptWorkspaceActivation(target, context),
  activate: (target, context) => host.commitWorkspaceActivation(target, context),
  deactivate: (active, reason) => host.releaseWorkspaceActivation(active, reason),
};
```

`resolve` maps the selector to a target. `authorize` re-checks permission. `prepareActivation` synchronously rechecks the target and captured revisions before acceptance. `activate` commits your side effects; `deactivate` reverses them. The full lifecycle is in the [runtime package guide](/reference/packages/).

## 2. Create and attach the scope

`attach` starts the scope in its initial state.

```ts
const workspace = runtime.createScope({ initial: { kind: 'workspace', id: 'acme' }, binding });
const detach = workspace.attach();
```

Every child result, cursor, proposal, action, subscription, and renderer address carries the activation it started under. A later activation with the same workspace ID is a new session. Work started under the old one cannot commit after a detour through another workspace.

## 3. Switch voluntarily

For a user-requested switch, call `requestChange(selector)`.

```ts
const result = await workspace.requestChange({ kind: 'workspace', id: 'acme-labs' });
```

If a form is dirty, the result is `needs-input` with `save`, `discard`, and `stay` choices. Your `readLeaveState` and `beforeLeave` callbacks drive that decision. While it is pending, the old authorized subtree stays labeled with its old workspace. A failed save or denied target leaves it in place. Once acceptance succeeds, the old activation is fenced before the new one starts effects.

## 4. Revoke forcibly

Call `invalidate` when access is lost:

```ts
workspace.invalidate('logout'); // or 'revoked' | 'expired' | 'external-switch'
```

Invalidation masks the scope and fences children synchronously — even while a dirty-work guard is open. A recovery hook may navigate afterward but cannot delay the fence. Never show cached rows from the revoked activation as a failure fallback.

## Keep layout inside one scope

Switching a workspace from single to split or compare changes presentation, not tenancy. Child surfaces keep stable identities and one owner each. A proposed composition with a cross-scope child, a cycle, a duplicate owner, or a stale child revision must be rejected. The same applies when depth or fan-out exceeds its limits. See [workspace composition](/guides/workspace/) for the presentation side and [permissions](/guides/permissions/) for the authority boundary.

## What can go wrong

- A selector from the client is never trustworthy on its own — the host resolves and authorizes it on every request.
- The scope API does not replace host authentication or server authorization.
- Late work from a previous activation session is fenced; it cannot overwrite the new workspace.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/workspace/"><span>Workspace composition</span><small>Compose several results under one presentation plan.</small><b aria-hidden="true">→</b></a><a href="/guides/permissions/"><span>Permissions</span><small>Supply the trusted context every scope check needs.</small><b aria-hidden="true">→</b></a></nav>
