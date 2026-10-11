---
id: 'state-ownership'
path: '/concepts/state-ownership/'
section: 'Reference'
title: 'Selection, draft, and focus ownership'
description: 'Preserve user work during adaptation by assigning each piece of interaction state one clear owner.'
---

<p class="lead">A view change is safe only when it preserves the user's work. Give each piece of interaction state exactly one owner, and define how it transfers.</p>
<h2>Assign each state one owner</h2><div class="doc-table"><table><thead><tr><th>State</th><th>Default owner</th><th>Transfer rule</th></tr></thead><tbody><tr><th>Filters and sort</th><td>Intent/application</td><td>Persist across equivalent browse views.</td></tr><tr><th>Selection</th><td>Region using stable identity</td><td>Transfer only when the next view supports equivalent identity.</td></tr><tr><th>Form draft</th><td>Form recipe or host, never both</td><td>Block or map transitions that would lose dirty values.</td></tr><tr><th>Focus</th><td>Active renderer</td><td>Restore the logical control after commit; do not steal focus during typing.</td></tr><tr><th>Navigation context</th><td>Host router plus Region</td><td>Retain back context when master-detail becomes stacked navigation.</td></tr></tbody></table></div>
<h2>Follow one transition</h2><p>You filter the ticket list to your team and select ticket <code>t-17</code>. You type half a reply in the wide master-detail layout. Then the container narrows. The filter stays on the intent. Selection survives because both views understand the same stable identity. The dirty draft keeps the wide form's owner, or the transition waits. Focus lands on the same logical field. Back still returns to the filtered list. If any piece cannot map, the narrow switch is deferred rather than destroying work.</p>
<h2>Guard risky transitions</h2><p>Coalesce resize changes. Defer adaptation during IME composition, active typing, drag, confirmation, or unsafe dirty-draft transitions. If mapping fails, keep the current valid view.</p>
<nav class="doc-next" aria-label="Continue reading"><p>Continue reading</p><a href="/guides/responsive-behavior/"><span>Responsive policy</span><small>See view choices by task and container.</small><b aria-hidden="true">→</b></a><a href="/guides/forms/"><span>Form UX</span><small>Keep draft and validation ownership explicit.</small><b aria-hidden="true">→</b></a></nav>
