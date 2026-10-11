import { describe, expect, it } from 'vitest';
import { html } from 'lit';
import { renderAeliqo } from '../../packages/web/src/server.js';
import { type PresentationPlan } from '../../packages/core/src/index.js';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import {
  comparisonPresentationRecipe,
  breakdownPresentationRecipe,
  explorerPresentationRecipe,
  formFlowPresentationRecipe,
  investigationPresentationRecipe,
  qualityPanelPresentationRecipe,
  recordEditorPresentationRecipe,
  searchResultsPresentationRecipe,
} from '../../packages/web/src/compound/recipes.js';
import { AELIQO_OPERATION_REFS, AELIQO_PRESENTATION_REFS } from '../../packages/web/src/region/registry.js';
import { AELIQO_DATA_REFS } from '../../packages/web/src/region/data-registry.js';
import { AELIQO_INPUT_REFS } from '../../packages/web/src/input/manifest.js';
import { AELIQO_VISUALIZATION_REFS } from '../../packages/web/src/region/visualization-registry.js';
import {
  dataNode,
  explorerInput,
  formContext,
  inputBindings,
  inputNode,
  matrixSpec,
  peopleRef,
  peopleResult,
  presentationContext,
  recipeInput,
  saveAction,
  selectionMapping,
  temporalReadNeed,
  temporalRef,
  temporalResult,
  timelineSpec,
  trendSpec,
  visualizationNode,
  readNeed,
} from './fixtures.js';

const read = AELIQO_OPERATION_REFS.read;
const selection = AELIQO_OPERATION_REFS.selection;
const filter = AELIQO_OPERATION_REFS.filter;

// Explorer is shared with the browser fixture so both paths validate the same wire input.

function comparisonInput() {
  const needs = [readNeed(['id', 'name', 'amount'])] as const;
  const allowed = [AELIQO_PRESENTATION_REFS.stack, AELIQO_VISUALIZATION_REFS.matrix];
  const context = presentationContext([peopleResult], needs, allowed);
  return recipeInput(
    'comparison',
    [visualizationNode('matrix', AELIQO_VISUALIZATION_REFS.matrix, matrixSpec)],
    context,
    [{ needId: 'read', nodeIds: ['matrix'], operations: [read] }],
  );
}

function breakdownInput() {
  const needs = [readNeed()] as const;
  const context = presentationContext([peopleResult], needs, [
    AELIQO_PRESENTATION_REFS.stack,
    AELIQO_DATA_REFS.metric,
    AELIQO_DATA_REFS.recordList,
  ]);
  const parts = [
    dataNode('metric', AELIQO_DATA_REFS.metric, 'metric', { field: 'amount', identityValues: { id: 'a' } }),
    dataNode('record-list', AELIQO_DATA_REFS.recordList, 'recordList', { selection: 'none' }),
  ];
  return recipeInput('breakdown', parts, context, [
    { needId: 'read', nodeIds: ['metric', 'record-list'], operations: [read] },
  ]);
}

export function investigationInput() {
  const needs = [temporalReadNeed()] as const;
  const context = presentationContext([temporalResult], needs, [
    AELIQO_PRESENTATION_REFS.stack,
    AELIQO_VISUALIZATION_REFS.trend,
    AELIQO_VISUALIZATION_REFS.timeline,
    AELIQO_DATA_REFS.detail,
  ]);
  const parts = [
    visualizationNode('trend', AELIQO_VISUALIZATION_REFS.trend, trendSpec, temporalRef),
    visualizationNode('timeline', AELIQO_VISUALIZATION_REFS.timeline, timelineSpec, temporalRef),
    dataNode(
      'detail',
      AELIQO_DATA_REFS.detail,
      'detail',
      { fields: ['id', 'date', 'amount'], identityValues: { id: 'a' } },
      temporalRef,
    ),
  ];
  return recipeInput('investigation', parts, context, [
    { needId: 'read', nodeIds: ['trend', 'timeline', 'detail'], operations: [read] },
  ]);
}

function searchInput() {
  const needs = [readNeed()] as const;
  const context = presentationContext([peopleResult], needs, [
    AELIQO_PRESENTATION_REFS.stack,
    AELIQO_INPUT_REFS.searchField,
    AELIQO_DATA_REFS.recordList,
  ]);
  const parts = [
    inputNode('search', AELIQO_INPUT_REFS.searchField, 'input'),
    dataNode('record-list', AELIQO_DATA_REFS.recordList, 'recordList', { selection: 'none' }),
  ];
  return recipeInput('search-results', parts, context, [
    { needId: 'read', nodeIds: ['record-list'], operations: [read] },
  ]);
}

function formInput(id: 'record-editor' | 'form-flow') {
  const context = formContext();
  const parts = [inputNode('form', AELIQO_INPUT_REFS.form, 'structure')];
  return recipeInput(id, parts, context, [{ needId: 'save', nodeIds: ['form'], operations: [saveAction] }]);
}

function qualityPanelInput() {
  const needs = [readNeed(['id', 'name', 'amount'])] as const;
  const context = presentationContext([peopleResult], needs, [AELIQO_PRESENTATION_REFS.stack, AELIQO_DATA_REFS.detail]);
  const parts = [
    dataNode('detail', AELIQO_DATA_REFS.detail, 'detail', {
      fields: ['id', 'name', 'amount'],
      identityValues: { id: 'a' },
    }),
  ];
  return recipeInput('quality-panel', parts, context, [{ needId: 'read', nodeIds: ['detail'], operations: [read] }]);
}

const cases = [
  ['explorer', explorerPresentationRecipe, explorerInput],
  ['comparison', comparisonPresentationRecipe, comparisonInput],
  ['breakdown', breakdownPresentationRecipe, breakdownInput],
  ['investigation', investigationPresentationRecipe, investigationInput],
  ['searchResults', searchResultsPresentationRecipe, searchInput],
  ['recordEditor', recordEditorPresentationRecipe, () => formInput('record-editor')],
  ['formFlow', formFlowPresentationRecipe, () => formInput('form-flow')],
  ['qualityPanel', qualityPanelPresentationRecipe, qualityPanelInput],
] as const;

describe('canonical compound recipes over the production primitive registry', () => {
  it.each(cases)('builds %s from configured bindings and validates its expanded plan', (_name, make, input) => {
    const supplied = input();
    const result = make(supplied as any);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.nodes[0]?.representation).toEqual(AELIQO_PRESENTATION_REFS.stack);
    expect(result.value.plan.rootId).toBe(`${supplied.id}:compound-root`);
    expect(result.value.plan.nodes.length).toBe(supplied.parts.length + 1);
    expect(
      validatePresentationPlan(
        result.value.plan,
        supplied.validation.context as any,
        supplied.validation.registry as any,
      ).ok,
    ).toBe(true);
    expect(result.value.childIds).toEqual(supplied.parts.map((part) => part.id));
  });

  it('retains a typed identity-equivalence link and rejects forged links', () => {
    const supplied = explorerInput();
    const result = explorerPresentationRecipe(supplied as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.links).toEqual(supplied.links);
    expect(result.value.plan.links[0]?.mapping).toEqual(selectionMapping.ref);
    expect(
      explorerPresentationRecipe({
        ...supplied,
        links: supplied.links?.map((link) => ({ ...link, mapping: { id: 'forged', revision: '1' } })),
      } as any).ok,
    ).toBe(false);
    expect(
      explorerPresentationRecipe({
        ...supplied,
        links: supplied.links?.map((link) => ({ ...link, target: { node: 'detail', port: 'selection' } })),
      } as any).ok,
    ).toBe(false);
  });

  it('fails closed on missing coverage and stale scope identity', () => {
    const supplied = explorerInput();
    expect(explorerPresentationRecipe({ ...supplied, coverage: [] } as any).ok).toBe(false);
    const staleParts = supplied.parts.map((part) =>
      part.id === 'record-list' ? { ...part, result: { ...peopleRef, scopeDigest: 'revoked-scope' } } : part,
    );
    expect(explorerPresentationRecipe({ ...supplied, parts: staleParts } as any).ok).toBe(false);
    const wrongOutputCoverage = supplied.coverage?.map((entry) =>
      entry.needId === 'read' ? { ...entry, nodeIds: ['filter'] } : entry,
    );
    expect(explorerPresentationRecipe({ ...supplied, coverage: wrongOutputCoverage } as any).ok).toBe(false);
  });

  it('does not let an input macro invent an unregistered binding or action', () => {
    const supplied = formInput('record-editor');
    const forged = supplied.parts.map((part) => ({
      ...part,
      config: { ...part.config, values: { bindingRef: 'forged', bindingRevision: inputBindings.revision } },
    }));
    expect(recordEditorPresentationRecipe({ ...supplied, parts: forged } as any).ok).toBe(false);
    const wrongAction = {
      ...supplied,
      coverage: [{ needId: 'save', nodeIds: ['form'], operations: [{ id: 'admin.delete', revision: '1' }] }],
    };
    expect(recordEditorPresentationRecipe(wrongAction as any).ok).toBe(false);
  });
});

describe('canonical plans render through AeliqoRegion SSR', () => {
  it('renders the expanded explorer primitives and materialized rows', async () => {
    const supplied = explorerInput();
    const result = explorerPresentationRecipe(supplied as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checked = validatePresentationPlan(
      result.value.plan,
      supplied.validation.context as any,
      supplied.validation.registry as any,
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const markup = await renderAeliqo(
      html`<aeliqo-region
        .presentation=${checked.value}
        .results=${[
          {
            ref: peopleRef,
            rows: [
              { id: 'a', name: 'Ada', amount: { decimal: '12.50' }, department: 'Sales' },
              { id: 'b', name: 'Bea', amount: { decimal: '7.00' }, department: 'Design' },
            ],
          },
        ]}
      ></aeliqo-region>`,
    );
    expect(markup).toContain('aeliqo-filter-builder');
    expect(markup).toContain('aeliqo-record-list');
    expect(markup).toContain('aeliqo-detail');
    expect(markup).toContain('Ada');
    expect(markup).toContain('shadowrootmode="open"');
  });

  it('renders the investigation visualization nodes from the validated plan', async () => {
    const supplied = investigationInput();
    const result = investigationPresentationRecipe(supplied as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checked = validatePresentationPlan(
      result.value.plan,
      supplied.validation.context as any,
      supplied.validation.registry as any,
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const markup = await renderAeliqo(
      html`<aeliqo-region
        .presentation=${checked.value}
        .results=${[
          {
            ref: temporalRef,
            rows: [
              { id: 'a', date: '2026-09-08', amount: { decimal: '12.50' } },
              { id: 'b', date: '2026-09-09', amount: { decimal: '7.00' } },
            ],
          },
        ]}
      ></aeliqo-region>`,
    );
    expect(markup).toContain('aeliqo-trend');
    expect(markup).toContain('aeliqo-timeline');
    expect(markup).toContain('aeliqo-detail');
    expect(markup).toContain('2026-09-08');
  });
});
