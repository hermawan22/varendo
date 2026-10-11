---
id: 'permissions'
path: '/guides/permissions/'
section: 'Guides'
title: 'Permissions and authority'
description: 'Provide one trusted host adapter for principal, scope, policy revision, grants, and query context.'
---

<p class="lead">The authority adapter tells Varendo who is signed in and what they may do. It runs right before each evaluation, commit, and action — and only the host calls it.</p>

## When you need this

- You mount a region or surface that reads app data.
- Grants or policy can change while work is running.
- You must prove a request can do only what the current user allows.

## 1. Implement `authority.read`

The adapter receives the resource, region, and effect being attempted. It returns the trusted context — or a denial.

**authority.ts**

```ts
const authority = {
  read: ({ resourceId, regionId, effect, signal }) => {
    const session = currentAuthenticatedSession(); // your app's session
    return session.canUse(resourceId, effect)
      ? {
          ok: true,
          value: {
            principalKey: session.principalKey,
            scopeDigest: session.scopeDigest,
            policyRevision: session.policyRevision,
            experienceRevision: 'web-1',
            grants: session.aeliqoGrants,
            readContext: { principal: session.principalKey },
          },
        }
      : denied(resourceId, regionId);
  },
};
```

`principalKey` is the signed-in user. `scopeDigest` identifies the authorized data partition. `grants` lists what the session may do, such as `task.evaluate`, `result.inspect`, or `experience.commit`. `readContext.principal` is the value your data services see in their own `authorize` checks.

Wire it into the app:

```ts
const app = createAeliqoApp({ resources, authority });
```

## 2. Deny cleanly

A denial is `{ ok: false, diagnostics: [...] }` — not an exception and not a shrunken context. The request fails closed and the region keeps its last authorized view.

## 3. Handle revocation

If the signed-in user, scope, or policy changes while work is running, the commit fails stale. With [application scopes](/guides/scopes/), call `invalidate('logout' | 'revoked' | 'expired' | 'external-switch')` when access is lost. That fences child surfaces at once, even during an open dirty-work guard. Without scopes, clear or unmount the region when access is removed. A failed update may keep only a previous result that is still authorized.

## What can go wrong

- Values carried by a request are data, not authority. Never read grants, user IDs, or policy from request input — derive them in the host.
- Browser checks improve UX and limit what an agent can do. They never replace server authorization on remote reads or business actions.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/concepts/safety/"><span>Safety infrastructure</span><small>See the checks that make invalid requests non-executable.</small><b aria-hidden="true">→</b></a><a href="/guides/actions/"><span>Business actions</span><small>Apply the same authority model to writes.</small><b aria-hidden="true">→</b></a></nav>
