import { html, render as renderTemplate, nothing } from 'lit';
import { MovableNodeParts, movableNode } from '../../../packages/web/src/region/movable-node-parts.js';
import { AsyncDirective, directive } from 'lit/async-directive.js';
import { Directive } from 'lit/directive.js';
import { ref } from 'lit/directives/ref.js';
import type { PresentationPlan } from '@varendo/core';
import { createIntentCompilerRegistry } from '@varendo/core/app';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { createLocalDataService } from '@varendo/runtime/data';
import { createVarendoApp } from '../../../packages/web/src/app/app.js';
import {
  WORKSPACE_RESOURCE,
  WORKSPACE_RECORDS,
  LAYOUT_INTENTS,
  LAYOUT_VIEWS,
  LAYOUT_PATTERNS,
  LAYOUT_STATE_MAPPINGS,
  layoutIntent,
} from '../../../examples/vnext/workspace/page.js';

const functions = createQueryFunctionRegistry({ version: '2' });
const intents = createIntentCompilerRegistry(LAYOUT_INTENTS);
if (!functions.ok || !intents.ok) throw Error('registries');
const data = createLocalDataService({
  snapshot: { catalog: WORKSPACE_RESOURCE.catalog, sourceRevision: '1', records: { attendance: WORKSPACE_RECORDS } },
  functionRegistry: functions.value,
  authorize: () => ({ ok: true, value: { scopeDigest: 'scope', policyRevision: '1' } }),
});
let failPage = false;
let alternateShape = false;
let authorized = true;
const lifecycle = { created: 0, active: 0, disconnected: 0, reconnected: 0 };
class Lifecycle extends AsyncDirective {
  private counted = false;
  override render() {
    if (!this.counted) {
      this.counted = true;
      lifecycle.created++;
      lifecycle.active++;
    }
    return html`<span data-lifecycle>Registered header owner</span>`;
  }
  override disconnected() {
    lifecycle.disconnected++;
    lifecycle.active--;
  }
  override reconnected() {
    lifecycle.reconnected++;
    lifecycle.active++;
  }
}
const tracked = directive(Lifecycle);
class FailAfterChildren extends Directive {
  override render(fail: boolean) {
    if (fail) throw Error('synthetic post-move renderer failure');
    return '';
  }
}
const fault = directive(FailAfterChildren);
const views = LAYOUT_VIEWS.map((view) => ({
  ...view,
  render(context: Parameters<typeof view.render>[0]) {
    const content = view.render(context);
    if (view.ref.id === 'demo.page-body' && context.node.node.config.values.branch === 'alternate')
      return html`<article data-conditional-wrapper>${context.children()}</article>`;
    if (view.ref.id === 'demo.page-shell') return html`${content}${fault(failPage)}`;
    if (view.ref.id === 'demo.page-header') return html`${tracked()}${content}`;
    return content;
  },
}));
const app = createVarendoApp({
  resources: [{ resource: WORKSPACE_RESOURCE, data }],
  intents: intents.value,
  views,
  patterns: LAYOUT_PATTERNS.map((pattern) => ({
    ...pattern,
    expand(request) {
      const expanded = pattern.expand(request);
      if (!expanded.ok) return expanded;
      const plan = expanded.value as PresentationPlan;
      return {
        ok: true,
        value: {
          ...plan,
          nodes: plan.nodes.map((node) =>
            node.id === 'page-body' && alternateShape
              ? { ...node, config: { ...node.config, values: { branch: 'alternate' } } }
              : node,
          ),
        },
      };
    },
  })),
  stateMappings: LAYOUT_STATE_MAPPINGS,
  authority: {
    read: () =>
      authorized
        ? {
            ok: true,
            value: {
              principalKey: 'user',
              scopeDigest: 'scope',
              policyRevision: '1',
              experienceRevision: '1',
              grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
              readContext: { principal: 'user' },
            },
          }
        : { ok: false, diagnostics: [{ code: 'runtime.authority-denied', message: 'revoked', retryable: false }] },
  },
});
const mounted = app.mount({
  target: document.querySelector<HTMLElement>('#target')!,
  regionId: 'main',
  resourceId: WORKSPACE_RESOURCE.id,
});
if (!mounted.ok) throw Error('mount');
const region = mounted.value;
async function render(kind: 'workspace' | 'page') {
  const receipt = await app.render({ regionId: 'main', intent: layoutIntent(kind) });
  document.querySelector('#status')!.textContent = receipt.status;
  return receipt;
}
const first = await render('workspace');
if (first.status !== 'renderer-ready') throw Error(JSON.stringify(first));
await region.updateComplete;
const table = region.shadowRoot!.querySelector('varendo-table');
function initialPartsBeforeCompletion() {
  return [false, true].map((fail) => {
    const host = document.createElement('div');
    document.body.append(host);
    const owner = new MovableNodeParts();
    const captured: { input?: HTMLInputElement } = {};
    const capture = (element?: Element) => {
      if (element instanceof HTMLInputElement) captured.input ??= element;
    };
    const leaf = () => html`${movableNode(owner, 'input', html`<input ${ref(capture)} aria-label="Initial draft" />`)}`;
    owner.begin('first');
    let rejected = false;
    try {
      renderTemplate(html`${leaf()}${fault(fail)}`, host);
    } catch {
      rejected = true;
    }
    const original = captured.input!;
    original.value = 'uncommitted draft';
    // Recover/move before complete(), without yielding to a microtask.
    owner.begin('wrapped');
    renderTemplate(html`<section>${leaf()}</section>`, host);
    owner.complete();
    const preserved = host.querySelector('input') === original && original.value === 'uncommitted draft';
    owner.clear();
    renderTemplate(nothing, host);
    const cleared = !original.isConnected && host.querySelector('input') === null;
    host.remove();
    return { rejected, preserved, cleared };
  });
}

function reversedParts() {
  const host = document.createElement('div');
  document.body.append(host);
  const owner = new MovableNodeParts();
  const leaf = () => html`${movableNode(owner, 'input', html`<input aria-label="Movable draft" />`)}`;
  const node = (key: string, child: unknown) =>
    html`${movableNode(owner, key, html`<section data-part-owner=${key}>${child}</section>`)}`;
  let firstInput: HTMLInputElement | null = null;
  for (let cycle = 0; cycle < 6; cycle++) {
    owner.begin(String(cycle));
    const tree = cycle % 2 === 0 ? node('a', node('b', leaf())) : node('b', node('a', leaf()));
    renderTemplate(tree, host);
    owner.complete();
    const input = host.querySelector('input')!;
    if (firstInput === null) {
      firstInput = input;
      input.value = 'Retained draft';
    }
    if (input !== firstInput || input.value !== 'Retained draft') throw Error('Reversed ancestor ownership changed');
  }
  owner.clear();
  renderTemplate(nothing, host);
  const cleared = host.querySelector('input') === null;
  host.remove();
  return { sameInput: true, cleared };
}
Object.assign(window, {
  layoutFixture: {
    render,
    reversedParts,
    initialPartsBeforeCompletion,
    async changeParentShape(fail: boolean) {
      alternateShape = true;
      failPage = fail;
      try {
        return await render('page');
      } finally {
        failPage = false;
      }
    },
    async failAfterMove() {
      failPage = true;
      try {
        return await render('page');
      } finally {
        failPage = false;
      }
    },
    dispose: () => app.dispose(),
    async revoke() {
      authorized = false;
      return render('page');
    },
    lifecycle: () => ({ ...lifecycle }),
    async interact() {
      region.interaction = { version: '1', values: [], drafts: [] };
      await region.updateComplete;
    },
    focusTable: () => {
      table?.setAttribute('tabindex', '0');
      (table as HTMLElement | null)?.focus();
    },
    snapshot: () => ({
      taskId: app.snapshot('main')?.task?.id,
      root: region.presentation?.plan.rootId,
      pins: app.snapshot('main')?.region?.readSet?.results.length,
      outputIds: region.results.map((result) => result.ref.outputId).sort(),
      tableFocused: region.shadowRoot?.activeElement === table,
      sameTable: table === region.shadowRoot?.querySelector('varendo-table'),
    }),
  },
});
