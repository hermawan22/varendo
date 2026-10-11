import { describe, expect, it } from 'vitest';
import { nothing } from 'lit';
import type { PresentationPlan, Result, ResultRef } from '../../packages/core/src/contracts/index.js';
import type { PresentationContext, PresentationValues } from '../../packages/core/src/presentation/index.js';
import { validatePresentationPlan, createPresentationRegistry } from '../../packages/core/src/presentation/index.js';
import { AELIQO_DATA_REFS, type AeliqoDataBinding } from '../../packages/web/src/region/data-registry.js';
import {
  AELIQO_DATA_PRESENTATION_OPERATIONS,
  createAeliqoDataPresentationManifests,
  createAeliqoDataPresentationRegistry,
  renderAeliqoDataPresentationNode,
} from '../../packages/web/src/region/data-presentation.js';

const ref = {
  id: 'result',
  revision: '1',
  outputId: 'people',
  queryDigest: 'query',
  scopeDigest: 'scope',
} as const satisfies ResultRef;

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
    {
      id: 'baseline',
      label: 'Baseline',
      type: {
        value: 'decimal',
        nullable: false,
        unit: { dimension: 'currency', symbol: 'USD' },
      },
      role: 'measure',
    },
    {
      id: 'department',
      label: 'Department',
      type: { value: 'text', nullable: false },
      role: 'dimension',
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

const rows = [
  {
    id: 'a',
    name: 'Ada',
    amount: { decimal: '12.50' },
    baseline: { decimal: '10.00' },
    department: 'Sales',
  },
] as const;

const binding: AeliqoDataBinding = { result, rows };
const entityOptions = { resolveEntity: () => 'person' } as const;

function refKey(value: ResultRef): string {
  return JSON.stringify([
    value.id,
    value.revision,
    value.sourceLineage ?? null,
    value.outputId,
    value.queryDigest,
    value.scopeDigest,
  ]);
}

function source(template: unknown): string {
  return Array.isArray(template)
    ? template.join('')
    : String((template as { strings?: readonly string[] }).strings?.join('') ?? template);
}

function contextFor(
  representation: { id: string; revision: string },
  role: string,
  schema: { id: string; revision: string },
  operation = AELIQO_DATA_PRESENTATION_OPERATIONS.read,
): PresentationContext {
  return {
    task: {
      version: '1',
      id: 'task-presentation',
      revision: 'task-revision',
      catalogRevision: 'catalog',
      functionRegistryDigest: 'functions',
      regionId: 'region',
      goal: 'Present people',
      needs: [
        {
          id: 'read',
          operation,
          fields: ['amount'],
          outputId: 'people',
          required: true,
        },
      ],
      assumptions: [],
      kind: 'presentation',
      inputs: [ref],
    },
    experience: {
      version: '1',
      id: 'experience',
      revision: 'experience-revision',
      mode: 'adaptive',
      agentAllowed: false,
      allowedRepresentations: [representation.id],
      allowedPatterns: [],
      composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 16 },
      requiredOperations: [],
      tokenProfile: { id: 'tokens', revision: '1' },
      extensionAllowlist: [],
      transitionPolicy: 'stable',
    },
    results: [result],
    current: {
      scopeDigest: 'scope',
      policyRevision: 'policy',
      taskRevision: 'task-revision',
      regionRevision: 'region-revision',
      catalogRevision: 'catalog',
      experienceRevision: 'experience-revision',
      functionRegistryDigest: 'functions',
      results: [ref],
    },
    environment: {
      inlineSize: { state: 'unknown' },
      blockSize: { state: 'unknown' },
      textScale: { state: 'unknown' },
      pointer: 'unknown',
      hover: 'unknown',
      keyboard: 'unknown',
      locale: 'en-US',
      direction: 'ltr',
      reducedMotion: false,
      forcedColors: false,
    },
    rendererCapabilities: [representation],
  };
}

function planFor(
  representation: { id: string; revision: string },
  role: string,
  schema: { id: string; revision: string },
  values: PresentationValues,
  operation = AELIQO_DATA_PRESENTATION_OPERATIONS.read,
): PresentationPlan {
  return {
    id: 'plan',
    revision: 'plan-revision',
    rootId: 'view',
    preconditions: {
      scopeDigest: 'scope',
      policyRevision: 'policy',
      taskRevision: 'task-revision',
      regionRevision: 'region-revision',
      catalogRevision: 'catalog',
      experienceRevision: 'experience-revision',
      functionRegistryDigest: 'functions',
      results: [ref],
    },
    nodes: [
      {
        id: 'view',
        role,
        representation,
        result: ref,
        config: { schema, values },
        children: [],
      },
    ],
    links: [],
    coverage: [{ needId: 'read', nodeIds: ['view'], operations: [operation] }],
    stateTransfer: [],
    diagnostics: [],
  };
}

describe('data presentation bridge', () => {
  it('registers eight non-table manifests and accepts only exact authorized binding keys', () => {
    const created = createAeliqoDataPresentationManifests([binding], entityOptions);
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    expect(created.value).toHaveLength(8);
    expect(created.value.map((manifest) => manifest.ref)).toEqual([
      AELIQO_DATA_REFS.metric,
      AELIQO_DATA_REFS.delta,
      AELIQO_DATA_REFS.keyValue,
      AELIQO_DATA_REFS.detail,
      AELIQO_DATA_REFS.recordList,
      AELIQO_DATA_REFS.cardCollection,
      AELIQO_DATA_REFS.filterBuilder,
      AELIQO_DATA_REFS.selectionSummary,
    ]);

    const invalidKey = createAeliqoDataPresentationManifests(new Map([['people', binding]]), entityOptions);
    expect(invalidKey).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.data.presentation.binding' }],
    });
    const duplicate = createAeliqoDataPresentationManifests([binding, binding], entityOptions);
    expect(duplicate).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.data.presentation.binding' }],
    });
    expect(createAeliqoDataPresentationManifests([undefined as never], entityOptions)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.data.presentation.binding' }],
    });
  });

  it('resolves every manifest through the existing semantic data helper', () => {
    const created = createAeliqoDataPresentationManifests([binding], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const configs: Record<string, PresentationValues> = {
      'data.metric': { field: 'amount', identityValues: { id: 'a' } },
      'data.delta': {
        currentField: 'amount',
        baselineField: 'baseline',
        identityValues: { id: 'a' },
      },
      'data.key-value': {
        items: [{ field: 'name' }],
        identityValues: { id: 'a' },
      },
      'data.detail': {
        fields: ['id', 'name', 'amount'],
        identityValues: { id: 'a' },
      },
      'data.record-list': {},
      'data.card-collection': {},
      'control.filter-builder': {
        field: 'department',
        outputId: 'people',
      },
      'data.selection-summary': { selection: 'multiple' },
    };
    for (const manifest of created.value) {
      const resolved = manifest.resolveConfig(configs[manifest.ref.id]!, result);
      expect(resolved.ok, manifest.ref.id).toBe(true);
      if (!resolved.ok) continue;
      expect(resolved.value.values).not.toHaveProperty('rows');
      expect(resolved.value.fields.every((field) => result.fields.some((descriptor) => descriptor.id === field))).toBe(
        true,
      );
      expect(Object.isFrozen(resolved.value.values)).toBe(true);
      const registry = createPresentationRegistry(created.value);
      if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
      const operation =
        manifest.ref.id === 'control.filter-builder'
          ? AELIQO_DATA_PRESENTATION_OPERATIONS.filter
          : AELIQO_DATA_PRESENTATION_OPERATIONS.read;
      const context = contextFor(manifest.ref, manifest.roles[0]!, manifest.configSchema, operation);
      const actualContext = {
        ...context,
        task: {
          ...context.task,
          needs: context.task.needs.map((need) => ({ ...need, fields: resolved.value.fields })),
        },
      };
      const plan = planFor(
        manifest.ref,
        manifest.roles[0]!,
        manifest.configSchema,
        configs[manifest.ref.id]!,
        operation,
      );
      expect(validatePresentationPlan(plan, actualContext, registry.value).ok, manifest.ref.id).toBe(true);
    }
  });

  it('passes a bound metric through validatePresentationPlan without copying rows into the plan', () => {
    const created = createAeliqoDataPresentationRegistry([binding], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const manifest = created.value.manifests.find((candidate) => candidate.ref.id === AELIQO_DATA_REFS.metric.id)!;
    const plan = planFor(manifest.ref, 'metric', manifest.configSchema, {
      field: 'amount',
      identityValues: { id: 'a' },
    });
    const checked = validatePresentationPlan(plan, contextFor(manifest.ref, 'metric', manifest.configSchema), {
      manifests: created.value.manifests,
      mappings: [],
    });
    expect(checked).toMatchObject({
      ok: true,
      value: { nodes: [{ config: { fields: ['amount'] } }] },
    });
    if (!checked.ok) return;
    expect(checked.value.nodes[0]!.config.values).not.toHaveProperty('rows');
    expect(checked.value.nodes[0]!.config.values).not.toHaveProperty('data');
    expect(checked.value.nodes[0]!.result?.ref).toEqual(ref);
    expect(created.value.bindingFor(ref)).toMatchObject({ ok: true, value: { rows } });
  });

  it('renders only an exact current ResultRef and rejects stale or malformed materializations', () => {
    const created = createAeliqoDataPresentationRegistry([binding], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const manifest = created.value.manifests.find((candidate) => candidate.ref.id === AELIQO_DATA_REFS.metric.id)!;
    const checked = validatePresentationPlan(
      planFor(manifest.ref, 'metric', manifest.configSchema, { field: 'amount', identityValues: { id: 'a' } }),
      contextFor(manifest.ref, 'metric', manifest.configSchema),
      { manifests: created.value.manifests, mappings: [] },
    );
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const node = checked.value.nodes[0]!;
    expect(source(created.value.render(node, binding))).toContain('<aeliqo-metric');

    const changedRef = {
      ...ref,
      scopeDigest: 'revoked-scope',
    } as const;
    const stale = created.value.render(node, {
      result: { ...result, ref: changedRef },
      rows,
    });
    expect(stale).toBe(nothing);
    expect(created.value.render(node, { result, rows: [] })).toBe(nothing);
    expect(
      renderAeliqoDataPresentationNode(node, {
        result: { ...result, ref: changedRef },
        rows,
      }),
    ).toBe(nothing);
    expect(created.value.bindingFor(changedRef)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.data.presentation.stale' }],
    });
    expect(created.value.render(node, { result, rows: [{ ...rows[0], amount: { decimal: '999' } }] })).toBe(nothing);
  });

  it('does not let current column materialization reduce validated detail coverage', () => {
    const created = createAeliqoDataPresentationRegistry([binding], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const manifest = created.value.manifests.find((m) => m.ref.id === AELIQO_DATA_REFS.detail.id)!;
    const checked = validatePresentationPlan(
      planFor(manifest.ref, 'detail', manifest.configSchema, {}),
      contextFor(manifest.ref, 'detail', manifest.configSchema),
      { manifests: created.value.manifests, mappings: [] },
    );
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const node = checked.value.nodes[0]!;
    expect(renderAeliqoDataPresentationNode(node, binding)).not.toBe(nothing);
    expect(renderAeliqoDataPresentationNode(node, { ...binding, columns: [{ key: 'name', label: 'Name' }] })).toBe(
      nothing,
    );
  });

  it('allows ordering changes within the retained authorized snapshot', () => {
    const materializedResult: Result = {
      ...result,
      counts: { loaded: 2, population: { kind: 'exact', value: 2, populationDigest: 'population' } },
    };
    const materialized = { result: materializedResult, rows: [rows[0], { ...rows[0], id: 'b', name: 'Bea' }] };
    const created = createAeliqoDataPresentationRegistry([materialized], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const manifest = created.value.manifests.find((m) => m.ref.id === AELIQO_DATA_REFS.metric.id)!;
    const checked = validatePresentationPlan(
      planFor(manifest.ref, 'metric', manifest.configSchema, { field: 'amount', identityValues: { id: 'a' } }),
      { ...contextFor(manifest.ref, 'metric', manifest.configSchema), results: [materializedResult] },
      { manifests: created.value.manifests, mappings: [] },
    );
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    expect(
      created.value.render(checked.value.nodes[0]!, { ...materialized, rows: [...materialized.rows].reverse() }),
    ).not.toBe(nothing);
  });

  it('keeps operation declarations bounded to the helper-derived capabilities', () => {
    const created = createAeliqoDataPresentationRegistry([binding], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const filter = created.value.manifests.find((candidate) => candidate.ref.id === AELIQO_DATA_REFS.filterBuilder.id)!;
    expect(filter.operations).toEqual([AELIQO_DATA_PRESENTATION_OPERATIONS.filter]);
    const summary = created.value.manifests.find(
      (candidate) => candidate.ref.id === AELIQO_DATA_REFS.selectionSummary.id,
    )!;
    const resolved = summary.resolveConfig({ selection: 'none' }, result);
    expect(resolved).toMatchObject({ ok: true, value: { fields: [], ports: [] } });
    if (resolved.ok) expect(resolved.value.operations).toEqual([]);
  });

  it('does not rely on caller supplied map ordering for ResultRef identity', () => {
    const key = refKey(ref);
    const created = createAeliqoDataPresentationRegistry({ [key]: binding }, entityOptions);
    expect(created.ok).toBe(true);
  });

  it('keeps authorized materializations isolated by exact source lineage', () => {
    const sourceA = { ...ref, sourceLineage: 'source-a' } as const satisfies ResultRef;
    const sourceB = { ...ref, sourceLineage: 'source-b' } as const satisfies ResultRef;
    const sourceABinding = { result: { ...result, ref: sourceA }, rows };
    const sourceBBinding = {
      result: { ...result, ref: sourceB },
      rows: [{ ...rows[0], id: 'b', name: 'Bea' }],
    };
    const created = createAeliqoDataPresentationRegistry([sourceABinding, sourceBBinding], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));

    expect(created.value.bindingFor(sourceA)).toMatchObject({
      ok: true,
      value: { rows: [{ id: 'a', name: 'Ada' }] },
    });
    expect(created.value.bindingFor(sourceB)).toMatchObject({
      ok: true,
      value: { rows: [{ id: 'b', name: 'Bea' }] },
    });
  });

  it('rejects a current materialization from a different source lineage', () => {
    const sourceA = { ...ref, sourceLineage: 'source-a' } as const satisfies ResultRef;
    const sourceB = { ...ref, sourceLineage: 'source-b' } as const satisfies ResultRef;
    const sourceABinding = { result: { ...result, ref: sourceA }, rows };
    const created = createAeliqoDataPresentationRegistry([sourceABinding], entityOptions);
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    const manifest = created.value.manifests.find((candidate) => candidate.ref.id === AELIQO_DATA_REFS.metric.id)!;
    const context = contextFor(manifest.ref, 'metric', manifest.configSchema);
    const plan = planFor(manifest.ref, 'metric', manifest.configSchema, {
      field: 'amount',
      identityValues: { id: 'a' },
    });
    if (context.task.kind !== 'presentation') throw new Error('Expected a presentation task fixture.');
    const checked = validatePresentationPlan(
      {
        ...plan,
        preconditions: { ...plan.preconditions, results: [sourceA] },
        nodes: plan.nodes.map((node) => ({ ...node, result: sourceA })),
      },
      {
        ...context,
        task: { ...context.task, inputs: [sourceA] },
        current: { ...context.current, results: [sourceA] },
        results: [sourceABinding.result],
      },
      { manifests: created.value.manifests, mappings: [] },
    );
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));

    expect(
      created.value.render(checked.value.nodes[0]!, {
        result: { ...result, ref: sourceB },
        rows,
      }),
    ).toBe(nothing);
    expect(created.value.bindingFor(sourceB)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'web.data.presentation.stale' }],
    });
  });
});
