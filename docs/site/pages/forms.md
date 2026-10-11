---
id: 'forms'
path: '/guides/forms/'
section: 'Guides'
title: 'Create and edit forms'
description: 'Generate registered form recipes from schemas while preserving draft ownership, validation, and the action boundary.'
---

<p class="lead">A create or edit request opens a form. It never writes. Submitting produces an action preview that follows your confirmation policy.</p>

## When you need this

- Users add or edit records.
- You want schema-checked drafts without building form state yourself.
- Every write must go through a registered action.

## 1. Allow create and edit on the resource

List `create` and `edit` in the resource's `intents`, then bind each to a form schema and a registered action.

**resource.ts**

```ts
const people = defineResource({
  // schema, identity, fields…
  intents: ['browse', 'detail', 'create', 'edit'],
  forms: {
    create: { schema: { id: 'people-form', revision: '1' }, action: { id: 'people.create', revision: '1' } },
    edit: { schema: { id: 'people-form', revision: '1' }, action: { id: 'people.update', revision: '1' } },
  },
  presentation: { allowedViews: ['table', 'cards', 'form'] },
});
```

The `form` view must be in `allowedViews` for the standard form recipe to be eligible.

You should see: a `create` request opens an empty form; an `edit` request loads the record's current values.

## 2. Supply edit values yourself

Register a `formState` adapter so an edit form can load current values and the entity revision. Varendo never invents existing field values.

```ts
const app = createAeliqoApp({
  resources,
  authority,
  formState: {
    read: ({ intent }) => {
      const record = loadCurrentRecord(intent); // your store
      return { ok: true, value: { values: record.values, entityRevision: record.revision } };
    },
  },
});
```

For `create`, a missing adapter means an empty draft. For `edit`, the request fails — inventing values would risk writing stale data.

## 3. Review before the write

A submitted form produces an action preview, not a write. The registered action's confirmation policy decides what happens next — see [business actions](/guides/actions/).

After a successful confirmed action, unchanged submitted fields return to the
registered form defaults. A new create form is empty unless your `formState`
adapter supplied defaults. Edits made while the action was running remain
dirty; failed or ambiguous actions retain their drafts. To show freshly saved
edit values and their current entity revision, the host requests the edit form
again through its trusted `formState` adapter.

## Know the standard labels

The standard form treats `resource.label` as the collection name. Its heading reads `Create a record in People` or `Edit a record in People`. Its submit button reads `Create record` or `Save changes`. A collection label may already be plural, so the form never guesses a singular noun. A custom host form can supply its own copy.

## Check the form contract

<div class="doc-checklist"><ul><li>Visible labels, helper text, inline errors, and a validation summary.</li><li>A dirty draft survives valid responsive adaptation.</li><li>Reset and cancel are explicit and restore focus.</li><li>Nested groups, repeaters, and multiselect use limited JSON schemas.</li><li>Submission status distinguishes pending, failed, executed, and ambiguous.</li></ul></div>

## What can go wrong

- `edit` without a `formState` adapter fails with `web.form-state.required`.
- A returned value for a field the schema does not declare fails with `web.form-state.field`.
- A missing current value fails with `web.form-state.missing`. A malformed entity revision fails with `web.form-state.revision`.
- A throwing adapter fails safely with `web.form-state.failed`.

<nav class="doc-next" aria-label="Continue reading"><p>Next</p><a href="/guides/actions/"><span>Action boundary</span><small>Implement confirmation and idempotency correctly.</small><b aria-hidden="true">→</b></a><a href="/concepts/state-ownership/"><span>Draft ownership</span><small>Prevent state loss during adaptation.</small><b aria-hidden="true">→</b></a></nav>
