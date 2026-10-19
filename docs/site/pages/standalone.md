---
id: "standalone"
path: "/start/standalone-components/"
section: "Get started"
title: "Standalone web components"
description: "Use a published component directly when the application already owns rows and interaction state."
---

<p class="lead">A region is optional. Use a standalone component when your screen already owns the rows and state and only needs a table, form control, or chart.</p>
## Create a small host

Use Node.js 24 and create a Vite TypeScript project:

```bash
npm create vite@latest people-list -- --template vanilla-ts
cd people-list
npm install --save-exact @varendo/web@0.2.0
```

Keep Vite's `#app` container. Replace `src/main.ts` with:

```ts
import { VarendoRecordListElement } from '@varendo/web/record-list';

if (!customElements.get('varendo-record-list')) {
  customElements.define('varendo-record-list', VarendoRecordListElement);
}
const target = document.querySelector<HTMLElement>('#app');
if (!target) throw new Error('Missing app container.');
const list = new VarendoRecordListElement();
list.identity = ['id'];
list.columns = [{ key: 'name', label: 'Name' }];
list.rows = [{ id: 'ada', name: 'Ada Chen' }];
target.append(list);
```

Run `npm run dev` and open the printed URL. You should see Ada Chen in a record
list. This component displays the rows you assign; it does not fetch records or
authorize them. If nothing appears, check the browser console, the `#app`
container, and the import path. Do not assign the rows as an HTML attribute.

<h2>Follow the boundary rules</h2><div class="doc-checklist"><ul><li>Pass arrays and objects as properties, not serialized attributes.</li><li>Treat event detail as untrusted input. Recheck permissions before any side effect.</li><li>Exercise the loading, empty, partial, denied, and error states that apply.</li><li>Style with public theme tokens and shadow parts. Do not depend on internal markup.</li></ul></div>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/components/"><span>Component catalog</span><small>Inspect props, states, examples, and styling hooks.</small><b aria-hidden="true">→</b></a><a href="/guides/adaptive-region/"><span>Upgrade to a region</span><small>Add typed requests and adaptive view selection.</small><b aria-hidden="true">→</b></a></nav>
