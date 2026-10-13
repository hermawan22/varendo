import { describe, expect, it } from 'vitest';
import type { Result, ResultRef, VisualizationSpec } from '../../packages/core/src/index.js';
import {
  VARENDO_VISUALIZATION_REFS,
  createVarendoVisualizationPresentationManifests,
  createVarendoVisualizationPresentationRegistry,
  type VarendoVisualizationBinding,
} from '../../packages/web/src/region/visualization-registry.js';

const ref = { id: 'semantic', revision: '1', outputId: 'rows', queryDigest: 'query', scopeDigest: 'scope' } as const;
const result: Result = {
  version: '1',
  ref,
  taskId: 'task',
  identity: ['id'],
  rowGrain: ['id'],
  fields: [
    { id: 'id', label: 'ID', role: 'identity', type: { value: 'text', nullable: false } },
    { id: 'amount', label: 'Amount', role: 'measure', type: { value: 'integer', nullable: false } },
  ],
  counts: { loaded: 2, population: { kind: 'unknown' } },
  precision: { kind: 'exact' },
  coverage: { kind: 'unknown', reason: 'Bounded supplied rows' },
  consistency: { kind: 'unknown', reason: 'Host snapshot' },
  evidence: { kind: 'computed', queryDigest: 'query', definitions: [] },
  filters: [],
  warnings: [],
  lineage: [],
};
const rows = [
  { id: 'a', amount: 1 },
  { id: 'b', amount: 2 },
];
const binding: VarendoVisualizationBinding = {
  result,
  context: { results: [result] },
  datasets: [{ result: ref, rows }],
};
const matrix: VisualizationSpec = { version: '1', view: 'matrix', result: ref, columns: ['id', 'amount'] };

const refKey = (value: ResultRef): string =>
  JSON.stringify([value.id, value.revision, value.outputId, value.queryDigest, value.scopeDigest]);

describe('semantic visualization registry', () => {
  it('installs all twelve typed manifests and binds exact materialization', () => {
    const manifests = createVarendoVisualizationPresentationManifests([binding]);
    expect(manifests.ok).toBe(true);
    if (!manifests.ok) return;
    expect(manifests.value).toHaveLength(12);
    expect(manifests.value.map((manifest) => manifest.ref)).toEqual(Object.values(VARENDO_VISUALIZATION_REFS));
    const matrixManifest = manifests.value.find((manifest) => manifest.ref.id === 'visualization.matrix')!;
    const resolved = matrixManifest.resolveConfig({ visualization: matrix }, result);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.fields).toEqual(['id', 'amount']);
    expect(resolved.value.ports).toEqual([]);
    expect(resolved.value.operations).toEqual([{ id: 'data.read', revision: '1' }]);
    expect(resolved.value.values).toEqual({ visualization: matrix });
    const barManifest = manifests.value.find((manifest) => manifest.ref.id === 'visualization.bar')!;
    const barResolved = barManifest.resolveConfig(
      {
        visualization: {
          version: '1',
          view: 'bar',
          plot: {
            version: '1',
            root: {
              kind: 'unit',
              mark: 'bar',
              result: ref,
              missing: 'gap',
              encoding: {
                x: { field: 'id', scale: 'ordinal' },
                y: { field: 'amount', scale: 'linear', zero: true },
              },
            },
          },
        },
      },
      result,
    );
    expect(barResolved.ok).toBe(true);
    if (barResolved.ok)
      expect(barResolved.value.operations).toEqual([
        { id: 'data.read', revision: '1' },
        { id: 'data.analyze', revision: '1' },
      ]);
  });

  it('derives a trusted selection port and rejects aliases or stale descriptors', () => {
    const registry = createVarendoVisualizationPresentationRegistry([binding], { resolveEntity: () => 'rows' });
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const matrixManifest = registry.value.manifests.find((manifest) => manifest.ref.id === 'visualization.matrix')!;
    const resolved = matrixManifest.resolveConfig({ visualization: matrix }, result);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.ports).toEqual([
        { id: 'selection', direction: 'inout', payload: 'selection', entity: 'rows', identity: ['id'], grain: ['id'] },
      ]);
      expect(resolved.value.operations).toEqual([
        { id: 'data.read', revision: '1' },
        { id: 'interaction.selection', revision: '1' },
      ]);
    }
    expect(createVarendoVisualizationPresentationRegistry({ alias: binding } as never).ok).toBe(false);
    expect(registry.value.bindingFor({ ...ref, queryDigest: 'revoked' }).ok).toBe(false);
    const current = registry.value.bindingFor(ref);
    expect(current.ok).toBe(true);
    if (current.ok) expect(refKey(current.value.result.ref)).toBe(refKey(ref));
  });

  it('fails closed when the primary descriptor is absent or rows are not exact', () => {
    const absent: VarendoVisualizationBinding = { result, context: { results: [] }, datasets: [{ result: ref, rows }] };
    expect(createVarendoVisualizationPresentationManifests([absent]).ok).toBe(false);
    const duplicate: VarendoVisualizationBinding = {
      result,
      context: { results: [result] },
      datasets: [
        { result: ref, rows },
        { result: ref, rows },
      ],
    };
    expect(createVarendoVisualizationPresentationManifests([duplicate]).ok).toBe(false);
    const malformed = {
      ...binding,
      datasets: [{ result: { ...ref, outputId: 'other' }, rows }],
    } as VarendoVisualizationBinding;
    expect(createVarendoVisualizationPresentationManifests([malformed]).ok).toBe(false);
  });

  it('accepts the runtime source-lineage pin while rejecting unknown ResultRef keys', () => {
    const lineageRef = { ...ref, sourceLineage: 'source-lineage-1' };
    const lineageResult: Result = { ...result, ref: lineageRef };
    const lineageBinding: VarendoVisualizationBinding = {
      result: lineageResult,
      context: { results: [lineageResult] },
      datasets: [{ result: lineageRef, rows }],
    };
    expect(createVarendoVisualizationPresentationManifests([lineageBinding]).ok).toBe(true);
    expect(
      createVarendoVisualizationPresentationManifests([
        {
          ...lineageBinding,
          datasets: [{ result: { ...lineageRef, untrusted: 'extra' } as never, rows }],
        } as VarendoVisualizationBinding,
      ]).ok,
    ).toBe(false);
  });

  it('rejects malformed materialization budgets', () => {
    for (const maxDatasets of [NaN, Infinity, -1, 0, 1.5, 65])
      expect(createVarendoVisualizationPresentationManifests([binding], { maxDatasets }).ok).toBe(false);
  });
});
