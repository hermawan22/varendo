import { describe, expect, it } from 'vitest';
import type { Result } from '@varendo/core';
import { createAeliqoDataRegistry } from '../../packages/web/src/region/data-registry.js';
import { renderAeliqoDataNode, type AeliqoDataHostRequest } from '../../packages/web/src/region/data-renderer.js';

const ref = {
  id: 'result',
  revision: '1',
  outputId: 'people',
  queryDigest: 'query',
  scopeDigest: 'scope',
} as const;
const result: Result = {
  version: '1',
  ref,
  taskId: 'task',
  fields: [
    {
      id: 'id',
      label: 'ID',
      type: { value: 'text', nullable: false },
      role: 'identity',
    },
    {
      id: 'name',
      label: 'Name',
      type: { value: 'text', nullable: false },
      role: 'attribute',
    },
    {
      id: 'amount',
      label: 'Amount',
      type: {
        value: 'decimal',
        nullable: false,
        unit: { dimension: 'currency', symbol: 'USD' },
      },
      role: 'measure',
    },
  ],
  identity: ['id'],
  rowGrain: ['id'],
  counts: {
    loaded: 1,
    population: { kind: 'exact', value: 1, populationDigest: 'population' },
  },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: 'population' },
  consistency: {
    kind: 'snapshot',
    snapshotId: 'snapshot',
    sourceRevisions: { source: '1' },
  },
  evidence: { kind: 'observed', source: { id: 'source', revision: '1' } },
  filters: [],
  warnings: [],
  lineage: [],
};
const rows = [{ id: 'a', name: 'Ada', amount: { decimal: '12.50' } }];
const registry = createAeliqoDataRegistry({ resolveEntity: () => 'person' });
function node(component: Parameters<typeof registry.resolve>[0]['component'], config: Record<string, unknown> = {}) {
  const resolved = registry.resolve(
    {
      id: `node-${String(typeof component === 'string' ? component : component.id)}`,
      component,
      config,
    },
    { result, rows },
  );
  if (!resolved.ok) throw new Error(resolved.diagnostics[0]?.message);
  return resolved.value;
}
function source(template: unknown): string {
  return Array.isArray(template)
    ? template.join('')
    : String((template as { strings?: readonly string[] }).strings?.join('') ?? template);
}

describe('data renderer projection', () => {
  it('projects every validated data node to its shared owned element', () => {
    const tags = {
      metric: 'aeliqo-metric',
      delta: 'aeliqo-delta',
      keyValue: 'aeliqo-key-value',
      detail: 'aeliqo-detail',
      recordList: 'aeliqo-record-list',
      cardCollection: 'aeliqo-card-collection',
      table: 'aeliqo-table',
      filterBuilder: 'aeliqo-filter-builder',
      selectionSummary: 'aeliqo-selection-summary',
    };
    const configs: Record<string, Record<string, unknown>> = {
      metric: { field: 'amount' },
      delta: { currentField: 'amount', baselineField: 'amount' },
      keyValue: { items: [{ field: 'name' }] },
      detail: { fields: ['id', 'name'] },
      recordList: {},
      cardCollection: {},
      table: {},
      filterBuilder: { field: 'name', outputId: 'people' },
      selectionSummary: { selection: 'multiple' },
    };
    for (const component of Object.keys(tags) as (keyof typeof tags)[]) {
      const template = renderAeliqoDataNode(node(component, configs[component]));
      expect(source(template)).toContain(`<${tags[component]}`);
    }
  });

  it('emits canonical selection and filter payloads only through registered ports', () => {
    const requests: AeliqoDataHostRequest[] = [];
    const table = node('table', { selection: 'single' });
    const tableTemplate = renderAeliqoDataNode(table, {
      onRequest: (request) => requests.push(request),
    });
    const selectionEvent = new CustomEvent('aeliqo-table-selection', {
      detail: {
        mode: 'ids',
        entity: 'person',
        keys: ['string:1:a'],
        result: ref,
      },
    });
    for (const value of (tableTemplate as { values: readonly unknown[] }).values)
      if (typeof value === 'function') (value as (event: Event) => void)(selectionEvent);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: 'selection',
      payload: { kind: 'selection', selection: { mode: 'ids', result: ref } },
    });

    const filter = node('filterBuilder', { field: 'name', outputId: 'people' });
    const filterTemplate = renderAeliqoDataNode(filter, {
      onRequest: (request) => requests.push(request),
    });
    const filterEvent = new CustomEvent('aeliqo-filter-change', {
      detail: {
        applied: true,
        predicate: {
          op: 'compare',
          field: 'name',
          comparison: 'eq',
          value: 'Ada',
        },
      },
    });
    for (const value of (filterTemplate as { values: readonly unknown[] }).values)
      if (typeof value === 'function') (value as (event: Event) => void)(filterEvent);
    expect(requests[1]).toMatchObject({
      kind: 'filter',
      payload: { kind: 'filter', outputId: 'people' },
    });
  });

  it('passes host-controlled keyboard windows with exact result identity', () => {
    const requests: AeliqoDataHostRequest[] = [];
    const table = node('table', { mode: 'grid', virtualized: true });
    const template = renderAeliqoDataNode(table, {
      onRequest: (request) => requests.push(request),
    });
    const event = new CustomEvent('aeliqo-table-window', {
      detail: {
        start: 1,
        count: 5,
        overscan: 2,
        row: 1,
        column: 0,
        reason: 'keyboard',
        result: ref,
      },
    });
    for (const value of (template as { values: readonly unknown[] }).values)
      if (typeof value === 'function') (value as (event: Event) => void)(event);
    expect(requests).toContainEqual({
      kind: 'window',
      nodeId: 'node-table',
      portId: 'window',
      request: { ...event.detail, result: ref },
    });
  });
});
