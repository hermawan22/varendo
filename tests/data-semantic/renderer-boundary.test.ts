import { describe, expect, it } from 'vitest';
import type { InteractionState, Result } from '../../packages/core/src/index.js';
import { createAeliqoDataRegistry } from '../../packages/web/src/region/data-registry.js';
import { renderAeliqoDataNode, type AeliqoDataHostRequest } from '../../packages/web/src/region/data-renderer.js';

const ref = {
  id: 'result',
  revision: '1',
  outputId: 'people',
  queryDigest: 'query',
  scopeDigest: 'scope',
} as const;
const baseResult: Result = {
  version: '1',
  ref,
  taskId: 'task',
  fields: [
    { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'name', label: 'Name', type: { value: 'text', nullable: false }, role: 'attribute' },
    {
      id: 'amount',
      label: 'Amount',
      type: { value: 'decimal', nullable: false, unit: { dimension: 'currency', symbol: 'USD' } },
      role: 'measure',
    },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: { loaded: 1, population: { kind: 'exact', value: 1, populationDigest: 'population' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: 'population' },
  consistency: { kind: 'snapshot', snapshotId: 'snapshot', sourceRevisions: { source: '1' } },
  evidence: { kind: 'observed', source: { id: 'source', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
};
const rows = [{ id: 'a', name: 'Ada', amount: { decimal: '12.50' } }];
const registry = createAeliqoDataRegistry({ resolveEntity: () => 'person' });

function node(
  component: Parameters<typeof registry.resolve>[0]['component'],
  config: Record<string, unknown> = {},
  result: Result = baseResult,
) {
  const resolved = registry.resolve(
    { id: `boundary-${String(typeof component === 'string' ? component : component.id)}`, component, config },
    { result, rows },
  );
  if (!resolved.ok) throw new Error(resolved.diagnostics[0]?.message);
  return resolved.value;
}

function values(template: unknown): readonly unknown[] {
  return (template as { values: readonly unknown[] }).values;
}

function emit(template: unknown, event: Event): void {
  for (const value of values(template)) if (typeof value === 'function') (value as (event: Event) => void)(event);
}

function selectionState(selection: unknown, nodeId: string): InteractionState {
  return {
    version: '1',
    values: [{ nodeId, portId: 'selection', payload: { kind: 'selection', selection } as never }],
    drafts: [],
  };
}

function filterState(predicates: unknown[], nodeId: string): InteractionState {
  return {
    version: '1',
    values: [{ nodeId, portId: 'filter', payload: { kind: 'filter', predicates, outputId: 'people' } as never }],
    drafts: [],
  };
}

describe('data renderer interaction boundary', () => {
  it('fails closed for accessor-backed or extra event details', () => {
    const requests: AeliqoDataHostRequest[] = [];
    const table = node('table', { page: true });
    const template = renderAeliqoDataNode(table, { onRequest: (request) => requests.push(request) });

    const throwing = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(throwing, 'page', {
      get: () => {
        throw new Error('hostile getter');
      },
    });
    expect(() => emit(template, new CustomEvent('aeliqo-table-page', { detail: throwing }))).not.toThrow();
    emit(template, new CustomEvent('aeliqo-table-page', { detail: { page: 1, pageSize: 10, evil: true } }));
    expect(requests).toEqual([]);
  });

  it('requires the checked component capability for page, sort and virtual windows', () => {
    const requests: AeliqoDataHostRequest[] = [];
    const page = renderAeliqoDataNode(node('table', { page: true }), {
      onRequest: (request) => requests.push(request),
    });
    emit(page, new CustomEvent('aeliqo-table-page', { detail: { page: 2, pageSize: 10, result: ref } }));
    const noPage = renderAeliqoDataNode(node('table'), { onRequest: (request) => requests.push(request) });
    emit(noPage, new CustomEvent('aeliqo-table-page', { detail: { page: 2, pageSize: 10, result: ref } }));

    const sortable = renderAeliqoDataNode(
      node('table', { columns: [{ key: 'id', sortable: true }, { key: 'name' }] }),
      { onRequest: (request) => requests.push(request) },
    );
    emit(sortable, new CustomEvent('aeliqo-table-sort', { detail: { sort: { field: 'id', direction: 'asc' } } }));
    emit(sortable, new CustomEvent('aeliqo-table-sort', { detail: {} }));

    const windowed = renderAeliqoDataNode(node('table', { mode: 'grid', virtualized: true }), {
      onRequest: (request) => requests.push(request),
    });
    emit(
      windowed,
      new CustomEvent('aeliqo-table-window', {
        detail: { start: 0, count: 5, overscan: 1, row: 0, column: 0, reason: 'keyboard', result: ref, evil: true },
      }),
    );
    emit(
      windowed,
      new CustomEvent('aeliqo-table-window', {
        detail: { start: 0, count: 5, overscan: 1, row: 0, column: 0, reason: 'keyboard', result: ref },
      }),
    );

    expect(requests).toEqual([
      { kind: 'page', nodeId: 'boundary-table', portId: 'page', request: { page: 2, pageSize: 10, result: ref } },
      { kind: 'sort', nodeId: 'boundary-table', portId: 'sort', request: { field: 'id', direction: 'asc' } },
      {
        kind: 'window',
        nodeId: 'boundary-table',
        portId: 'window',
        request: { start: 0, count: 5, overscan: 1, row: 0, column: 0, reason: 'keyboard', result: ref },
      },
    ]);
  });

  it('requires a real load-more event and a known remaining population', () => {
    const result: Result = {
      ...baseResult,
      counts: { loaded: 1, population: { kind: 'exact', value: 2, populationDigest: 'population' } },
      coverage: { kind: 'partial', populationDigest: 'population', reason: 'Delivery page' },
    };
    const requests: AeliqoDataHostRequest[] = [];
    const template = renderAeliqoDataNode(node('cardCollection', {}, result), {
      onRequest: (request) => requests.push(request),
    });
    emit(template, new Event('aeliqo-data-load-more'));
    emit(template, new CustomEvent('aeliqo-data-load-more', { detail: { requested: true, evil: true } }));
    emit(template, new CustomEvent('aeliqo-data-load-more', { detail: { requested: true } }));
    expect(requests).toEqual([{ kind: 'load-more', nodeId: 'boundary-cardCollection', portId: 'load-more' }]);
  });

  it('keeps authorized unloaded selections while requiring loaded membership for new keys', () => {
    const table = node('table', { selection: 'multiple' });
    const retained = 'string:1:unloaded';
    const current = selectionState({ mode: 'ids', entity: 'person', keys: [retained], result: ref }, table.id);
    const rendered = renderAeliqoDataNode(table, { interaction: current });
    expect(values(rendered)).toContainEqual([retained]);

    const requests: AeliqoDataHostRequest[] = [];
    const interactive = renderAeliqoDataNode(table, {
      interaction: current,
      onRequest: (request) => requests.push(request),
    });
    emit(
      interactive,
      new CustomEvent('aeliqo-table-selection', {
        detail: { mode: 'ids', entity: 'person', keys: [retained, 'string:1:a'], result: ref },
      }),
    );
    emit(
      interactive,
      new CustomEvent('aeliqo-table-selection', {
        detail: { mode: 'ids', entity: 'person', keys: ['string:1:untrusted'], result: ref },
      }),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: 'selection',
      payload: { selection: { keys: [retained, 'string:1:a'] } },
    });
  });

  it('requires selection and filter lineage before presenting or forwarding state', () => {
    const summaryNode = node('selectionSummary', { selection: 'multiple' });
    const predicate = { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' };
    const valid = selectionState(
      { mode: 'predicate', entity: 'person', predicate, queryDigest: 'query', populationDigest: 'population' },
      summaryNode.id,
    );
    expect(values(renderAeliqoDataNode(summaryNode, { interaction: valid }))).toContainEqual({
      kind: 'predicate',
      label: 'All matching records in the active server filter',
    });
    const stale = selectionState(
      { mode: 'predicate', entity: 'person', predicate, queryDigest: 'old-query', populationDigest: 'population' },
      summaryNode.id,
    );
    expect(
      values(renderAeliqoDataNode(summaryNode, { interaction: stale })).some(
        (value) => value?.constructor === Object && (value as { kind?: string }).kind === 'predicate',
      ),
    ).toBe(false);

    const filterNode = node('filterBuilder', { field: 'name', outputId: 'people' });
    const filterTemplate = renderAeliqoDataNode(filterNode, {
      interaction: filterState([{ op: 'compare', field: 'unknown', comparison: 'eq', value: 'Ada' }], filterNode.id),
    });
    expect(values(filterTemplate)).not.toContainEqual(expect.objectContaining({ field: 'unknown' }));
  });

  it('projects validated initial and inherited predicates without resurrecting a clear', () => {
    const initial = { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' } as const;
    const inherited = { op: 'is-null', field: 'name', negate: true } as const;
    const filterNode = node('filterBuilder', {
      field: 'name',
      outputId: 'people',
      predicate: initial,
      inherited,
    });

    expect(values(renderAeliqoDataNode(filterNode))).toContainEqual(initial);
    expect(values(renderAeliqoDataNode(filterNode))).toContainEqual(inherited);

    const cleared = renderAeliqoDataNode(filterNode, {
      interaction: filterState([], filterNode.id),
    });
    expect(values(cleared)).not.toContainEqual(initial);
    expect(values(cleared)).toContainEqual(inherited);

    const active = { op: 'compare', field: 'name', comparison: 'eq', value: 'Grace' } as const;
    const current = renderAeliqoDataNode(filterNode, {
      interaction: filterState([active], filterNode.id),
    });
    expect(values(current)).toContainEqual(active);
    expect(values(current)).not.toContainEqual(initial);

    const malformed = {
      ...filterNode,
      config: {
        ...filterNode.config,
        values: {
          ...filterNode.config.values,
          predicate: { op: 'compare', field: 'not-authorized', comparison: 'eq', value: 'Ada' },
          inherited: { op: 'is-null', field: 'not-authorized', negate: true },
        },
      },
    };
    const malformedValues = values(renderAeliqoDataNode(malformed));
    expect(malformedValues).not.toContainEqual(expect.objectContaining({ field: 'not-authorized' }));
  });

  it('keeps inherited filter request merging and its canonical payload shape', () => {
    const inherited = { op: 'is-null', field: 'name', negate: true } as const;
    const predicate = { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' } as const;
    const filterNode = node('filterBuilder', { field: 'name', outputId: 'people', inherited });
    const requests: AeliqoDataHostRequest[] = [];
    const template = renderAeliqoDataNode(filterNode, {
      onRequest: (request) => requests.push(request),
    });
    emit(
      template,
      new CustomEvent('aeliqo-filter-change', {
        detail: { applied: true, predicate, inherited },
      }),
    );
    expect(requests).toEqual([
      {
        kind: 'filter',
        nodeId: filterNode.id,
        portId: 'filter',
        payload: {
          kind: 'filter',
          predicates: [{ op: 'and', predicates: [inherited, predicate] }],
          outputId: 'people',
        },
      },
    ]);
  });
});
