import { describe, expect, it } from 'vitest';
import {
  AELIQO_PRESENTATION_REFS,
  AELIQO_OPERATION_REFS,
  createAeliqoPresentationRegistry,
  createSelectionIdentityMapping,
} from '../../../packages/web/src/region/index.js';
import type { PresentationPlan } from '../../../packages/core/src/contracts/index.js';
import type { PresentationContext } from '../../../packages/core/src/presentation/index.js';
import { validatePresentationPlan } from '../../../packages/core/src/presentation/index.js';
import { stableTableRowKey } from '../../../packages/web/src/elements/aeliqo-table.js';
import {
  alignAeliqoChartSeries,
  buildAeliqoChartDomain,
  buildAeliqoChartGeometry,
} from '../../../packages/web/src/elements/aeliqo-chart.js';
import { yAxisTicks } from '../../../packages/web/src/elements/aeliqo-chart-geometry.js';
import {
  environment,
  experience,
  field,
  presentationPlan,
  presentationTask,
  ref,
  result as baseResult,
} from '../../contracts/fixtures.js';

const result = {
  ...baseResult,
  rowGrain: ['employee.id', 'month'],
  fields: [
    field,
    { id: 'month', label: 'Month', type: { value: 'date', nullable: false }, role: 'time' as const },
    { id: 'amount', label: 'Amount', type: { value: 'decimal', nullable: true }, role: 'measure' as const },
  ],
} as const;

function registry() {
  const created = createAeliqoPresentationRegistry({
    resolveEntity: (authorizedResult) => (authorizedResult.ref.outputId === 'rows' ? 'employees' : undefined),
  });
  if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
  return created.value;
}

describe('registered web region', () => {
  it('exposes bounded stack, table, trend and filter manifests', () => {
    const refs = registry().manifests.map((manifest) => manifest.ref);
    expect(refs.slice(0, 4)).toEqual([
      AELIQO_PRESENTATION_REFS.stack,
      AELIQO_PRESENTATION_REFS.table,
      AELIQO_PRESENTATION_REFS.trend,
      AELIQO_PRESENTATION_REFS.filter,
    ]);
    expect(
      registry().manifests.find((manifest) => manifest.ref.id === AELIQO_PRESENTATION_REFS.table.id)?.operations,
    ).toContainEqual(AELIQO_OPERATION_REFS.selection);
  });

  it('derives table selection ports from the Result identity and rejects unknown config', () => {
    const manifest = registry().manifests.find((candidate) => candidate.ref.id === AELIQO_PRESENTATION_REFS.table.id)!;
    const configured = manifest.resolveConfig({ selection: 'multiple' }, result);
    expect(configured).toMatchObject({
      ok: true,
      value: {
        fields: ['employee.id', 'month', 'amount'],
        operations: [
          AELIQO_OPERATION_REFS.read,
          AELIQO_OPERATION_REFS.compare,
          AELIQO_OPERATION_REFS.analyze,
          AELIQO_OPERATION_REFS.selection,
        ],
        ports: [{ id: 'selection', payload: 'selection', entity: 'employees', identity: ['employee.id'] }],
      },
    });
    expect(manifest.resolveConfig({ html: '<script>bad</script>' }, result)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.config' }],
    });
    expect(manifest.resolveConfig({ columns: [{ key: 'amount', label: 'Absence' }] }, result)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.field' }],
    });
    expect(manifest.resolveConfig({ selection: 'multiple', identity: ['month'] }, result)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.identity' }],
    });
    expect(manifest.resolveConfig({ selection: 'multiple' }, result)).toMatchObject({
      ok: true,
      value: { ports: [{ entity: 'employees' }] },
    });
    const defaultRegistry = createAeliqoPresentationRegistry();
    expect(
      defaultRegistry.ok &&
        defaultRegistry.value.manifests
          .find((candidate) => candidate.ref.id === AELIQO_PRESENTATION_REFS.table.id)
          ?.resolveConfig({ selection: 'multiple' }, result),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.binding' }] });
    expect(
      manifest.suggestConfig?.(
        [{ id: 'select', operation: AELIQO_OPERATION_REFS.selection, fields: ['employee.id'], required: true }],
        result,
      ),
    ).toMatchObject({ ok: true, value: { selection: 'single' } });
  });

  it('passes a table plan through the core validator with resolved typed selection ports', () => {
    const tablePlan: PresentationPlan = {
      ...presentationPlan,
      rootId: 'table',
      nodes: [
        {
          id: 'table',
          role: 'table',
          representation: AELIQO_PRESENTATION_REFS.table,
          result: ref,
          config: { schema: { id: 'data.table.config', revision: '1' }, values: { selection: 'multiple' } },
          children: [],
        },
      ],
      coverage: [{ needId: 'browse', nodeIds: ['table'], operations: [AELIQO_OPERATION_REFS.read] }],
      links: [],
    };
    const context: PresentationContext = {
      task: {
        ...presentationTask,
        needs: [
          {
            id: 'browse',
            operation: AELIQO_OPERATION_REFS.read,
            fields: ['employee.id'],
            outputId: 'rows',
            required: true,
          },
        ],
      },
      experience: { ...experience, allowedRepresentations: [AELIQO_PRESENTATION_REFS.table.id] },
      results: [baseResult],
      current: presentationPlan.preconditions,
      environment,
      rendererCapabilities: [AELIQO_PRESENTATION_REFS.table],
    };
    const checked = validatePresentationPlan(tablePlan, context, registry());
    expect(checked).toMatchObject({
      ok: true,
      value: { nodes: [{ config: { ports: [{ id: 'selection', payload: 'selection' }] } }] },
    });
  });

  it('keeps trend series fields and filter semantics typed', () => {
    const manifests = registry().manifests;
    const trend = manifests.find((candidate) => candidate.ref.id === AELIQO_PRESENTATION_REFS.trend.id)!;
    expect(
      trend.resolveConfig({ labelField: 'month', series: [{ field: 'amount' }], seriesBy: ['employee.id'] }, result),
    ).toMatchObject({
      ok: true,
      value: {
        fields: ['month', 'employee.id', 'amount'],
        operations: [AELIQO_OPERATION_REFS.read, AELIQO_OPERATION_REFS.compare, AELIQO_OPERATION_REFS.analyze],
      },
    });
    expect(
      trend.resolveConfig({ labelField: 'month', series: [{ field: 'amount', label: 'Absence' }] }, result),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.field' }] });
    expect(trend.resolveConfig({ labelField: 'employee.id', series: [{ field: 'amount' }] }, result)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.field' }],
    });
    expect(trend.resolveConfig({ labelField: 'month', series: [{ field: 'month' }] }, result)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.field' }],
    });
    expect(
      trend.suggestConfig?.(
        [
          {
            id: 'trend',
            operation: AELIQO_OPERATION_REFS.compare,
            fields: ['employee.id', 'month', 'amount'],
            outputId: 'rows',
            required: true,
          },
        ],
        result,
      ),
    ).toMatchObject({
      ok: true,
      value: { labelField: 'month', series: [{ field: 'amount' }], seriesBy: ['employee.id'] },
    });
    const filter = manifests.find((candidate) => candidate.ref.id === AELIQO_PRESENTATION_REFS.filter.id)!;
    expect(filter.resolveConfig({ field: 'employee.id', outputId: 'rows' }, result)).toMatchObject({
      ok: true,
      value: { fields: ['employee.id'], operations: [AELIQO_OPERATION_REFS.filter], ports: [{ payload: 'filter' }] },
    });
    expect(
      filter.resolveConfig({ field: 'employee.id', outputId: 'rows', label: 'Untrusted claim' }, result),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'web.presentation.config' }] });
    expect(filter.resolveConfig({ field: 'month', outputId: 'rows' }, result)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.field' }],
    });
    expect(filter.resolveConfig({ field: 'employee.id', outputId: 'other' }, result)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.binding' }],
    });
    expect(
      filter.suggestConfig?.(
        [
          {
            id: 'filter',
            operation: AELIQO_OPERATION_REFS.filter,
            fields: ['employee.id'],
            outputId: 'rows',
            required: true,
          },
        ],
        result,
      ),
    ).toMatchObject({ ok: true, value: { field: 'employee.id', outputId: 'rows' } });
  });

  it('rejects mixed numeric units on a shared trend axis', () => {
    const trend = registry().manifests.find((candidate) => candidate.ref.id === AELIQO_PRESENTATION_REFS.trend.id)!;
    const mixed = {
      ...result,
      fields: [
        ...result.fields,
        {
          id: 'rate',
          label: 'Rate',
          type: { value: 'decimal' as const, nullable: true, unit: { dimension: 'ratio', symbol: '%' } },
          role: 'measure' as const,
        },
      ],
    } as const;
    expect(
      trend.resolveConfig({ labelField: 'month', series: [{ field: 'amount' }, { field: 'rate' }] }, mixed),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.presentation.field' }],
    });
  });

  it('uses stable identity tuples and registered identity mappings', () => {
    expect(stableTableRowKey({ 'employee.id': 'e1', month: 'Jan' }, ['employee.id'])).toBe('string:2:e1');
    expect(stableTableRowKey({ 'employee.id': 'e1', month: 'Jan' }, ['employee.id', 'month'])).toBe(
      JSON.stringify(['string:2:e1', 'string:3:Jan']),
    );
    expect(stableTableRowKey({ month: 'Jan' }, ['employee.id'])).toBeUndefined();
    expect(stableTableRowKey({ amount: { decimal: '1.0' } }, ['amount'])).toBe(
      stableTableRowKey({ amount: { decimal: '1' } }, ['amount']),
    );
    expect(stableTableRowKey({ value: null }, ['value'])).not.toBe(stableTableRowKey({ value: 'null' }, ['value']));
    expect(stableTableRowKey({ value: 1 }, ['value'])).not.toBe(stableTableRowKey({ value: '1' }, ['value']));
    expect(stableTableRowKey({ value: -0 }, ['value'])).toBe(stableTableRowKey({ value: 0 }, ['value']));
    expect(stableTableRowKey({ value: Number.NaN }, ['value'])).toBeUndefined();
    expect(stableTableRowKey({ value: Number.POSITIVE_INFINITY }, ['value'])).toBeUndefined();
    expect(createSelectionIdentityMapping('employees', ['employee.id'])).toEqual({
      ref: { id: 'selection.identity', revision: '1' },
      source: { payload: 'selection', entity: 'employees', identity: ['employee.id'], grain: ['employee.id'] },
      target: { payload: 'selection', entity: 'employees', identity: ['employee.id'], grain: ['employee.id'] },
      kind: 'identity',
    });
  });

  it('retains duplicate x rows and canonical sub-millisecond instants', () => {
    const duplicate = [
      {
        id: 'first',
        label: 'First',
        points: [
          { x: 1, label: 'one', value: 1 },
          { x: 1, label: 'one again', value: 2 },
        ],
      },
      { id: 'second', label: 'Second', points: [{ x: 1, label: 'one', value: 3 }] },
    ];
    const aligned = alignAeliqoChartSeries(duplicate);
    expect(buildAeliqoChartDomain(duplicate)).toHaveLength(2);
    expect(aligned[0]?.points.map((point) => point.value)).toEqual([1, 2]);
    expect(aligned[1]?.points.map((point) => point.value)).toEqual([3, null]);
    expect(new Set(buildAeliqoChartGeometry(duplicate).circles.map((circle) => circle.x))).toEqual(new Set([340]));

    const temporal = [
      {
        id: 'a',
        label: 'A',
        points: [
          { x: '2026-01-01T00:00:00.0001Z', label: 'early', value: 1 },
          { x: '2026-01-01T00:00:00.0009Z', label: 'late', value: 2 },
        ],
      },
      { id: 'b', label: 'B', points: [{ x: '2026-01-01T00:00:00.000100+00:00', label: 'same', value: 3 }] },
    ];
    expect(buildAeliqoChartDomain(temporal)).toHaveLength(2);
    expect(alignAeliqoChartSeries(temporal)[1]?.points.map((point) => point.value)).toEqual([3, null]);
    expect(buildAeliqoChartGeometry(temporal).circles).toHaveLength(3);

    const dates = [
      {
        id: 'a',
        label: 'A',
        points: [
          { x: '2026-01-01', label: 'Jan 1', value: 1 },
          { x: '2026-01-15', label: 'Jan 15', value: 3 },
        ],
      },
      { id: 'b', label: 'B', points: [{ x: '2026-01-08', label: 'Jan 8', value: 2 }] },
    ];
    expect(buildAeliqoChartDomain(dates).map((point) => point.x)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
    expect(alignAeliqoChartSeries(dates).map((series) => series.points.map((point) => point.value))).toEqual([
      [1, null, 3],
      [null, 2, null],
    ]);
    expect(
      new Set(
        buildAeliqoChartGeometry([
          {
            id: 'same-date',
            label: 'Same date',
            points: [
              { x: '2026-01-01', label: 'first', value: 1 },
              { x: '2026-01-01', label: 'second', value: 2 },
            ],
          },
        ]).circles.map((circle) => circle.x),
      ),
    ).toEqual(new Set([340]));

    const halfSecond = buildAeliqoChartGeometry([
      {
        id: 'timed',
        label: 'Timed',
        points: [
          { x: '2026-01-01T00:00:00.0Z', label: 'zero', value: 0 },
          { x: '2026-01-01T00:00:00.5Z', label: 'half', value: 1 },
          { x: '2026-01-01T00:00:01.0Z', label: 'one', value: 2 },
        ],
      },
    ]);
    expect(halfSecond.circles.map((circle) => circle.x)).toEqual([56, 340, 624]);
  });

  it('never labels a fractional midpoint on an integer y axis', () => {
    const series = (values: readonly number[]) => [
      { id: 'hires', label: 'Hires', points: values.map((value, index) => ({ label: String(index), value })) },
    ];
    expect(yAxisTicks(series([1, 2, 1])).map((tick) => tick.label)).toEqual(['1', '2']);
    expect(yAxisTicks(series([118, 130])).map((tick) => tick.label)).toEqual(['118', '124', '130']);
    expect(yAxisTicks(series([0.5, 1])).map((tick) => tick.label)).toEqual(['0.5', '0.75', '1']);
  });

  it('builds separate SVG segments for null gaps and keeps multiple series distinct', () => {
    const geometry = buildAeliqoChartGeometry([
      {
        id: 'actual',
        label: 'Actual',
        points: [
          { label: 'Jan', value: 1 },
          { label: 'Feb', value: null },
          { label: 'Mar', value: 3 },
        ],
      },
      {
        id: 'target',
        label: 'Target',
        points: [
          { label: 'Jan', value: 2 },
          { label: 'Feb', value: 2 },
          { label: 'Mar', value: 4 },
        ],
      },
    ]);
    expect(geometry.segments).toHaveLength(3);
    expect(geometry.segments.filter((segment) => segment.seriesIndex === 0)).toHaveLength(2);
    expect(geometry.segments.filter((segment) => segment.seriesIndex === 1)).toHaveLength(1);
    expect(geometry.circles).toHaveLength(5);
    expect(geometry.segments.every((segment) => segment.points.length > 0)).toBe(true);
  });

  it('aligns sparse and disjoint explicit x values to one shared domain', () => {
    const geometry = buildAeliqoChartGeometry([
      {
        id: 'actual',
        label: 'Actual',
        points: [
          { x: 1, label: 'Jan', value: 1 },
          { x: 3, label: 'Mar', value: 3 },
        ],
      },
      {
        id: 'target',
        label: 'Target',
        points: [
          { x: 2, label: 'Feb', value: 2 },
          { x: 4, label: 'Apr', value: 4 },
        ],
      },
    ]);
    expect(geometry.segments).toHaveLength(4);
    expect(geometry.circles).toHaveLength(4);
    const actualX = geometry.circles.filter((circle) => circle.seriesIndex === 0).map((circle) => circle.x);
    const targetX = geometry.circles.filter((circle) => circle.seriesIndex === 1).map((circle) => circle.x);
    expect(actualX[0]).toBe(56);
    expect(actualX[1]).toBeCloseTo(434.6666666666667, 8);
    expect(targetX[0]).toBeCloseTo(245.33333333333334, 8);
    expect(targetX[1]).toBe(624);
  });
});
