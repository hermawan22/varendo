import { expect, it } from 'vitest';
import { type Catalog, type MeaningDefinition } from '../../../packages/core/dist/index.js';
import { createStandardFunctionRegistry } from '../../../packages/core/dist/expressions/index.js';
import { createLocalDataService } from '../../../packages/runtime/dist/data/index.js';
import { createResultStore } from '../../../packages/runtime/dist/results/index.js';
import { createNarrativeVerifier } from '../../../packages/agent/dist/narrative.js';

it('preserves exact metric versions from a real local analytical query into verified claims', async () => {
  const functions = createStandardFunctionRegistry();
  if (!functions.ok) throw Error('registry');
  const meaning: MeaningDefinition = {
    id: 'total',
    revision: '7',
    label: 'Total',
    explanation: 'Sum of amounts',
    output: { value: 'decimal', nullable: true },
    implementation: {
      kind: 'expression',
      expression: {
        kind: 'call',
        function: { id: 'core.aggregate.sum', revision: '1' },
        arguments: [{ kind: 'field', ref: 'amount' }],
      },
    },
    dependencies: [],
    functionRegistryDigest: functions.value.digest,
    origin: 'system',
    lifecycle: 'active',
    scope: 'workspace',
    authority: 'approved',
    aggregation: 'additive',
    aggregationDimensions: [],
    missingPolicy: 'exclude-pair',
  };
  const catalog: Catalog = {
    version: '1',
    revision: 'catalog',
    functionRegistryDigest: functions.value.digest,
    entities: [
      {
        id: 'rows',
        label: 'Rows',
        identity: ['id'],
        rowGrain: ['id'],
        fields: [
          { id: 'id', label: 'ID', type: { value: 'text', nullable: false }, role: 'identity' },
          { id: 'group', label: 'Group', type: { value: 'text', nullable: false }, role: 'dimension' },
          { id: 'amount', label: 'Amount', type: { value: 'decimal', nullable: false }, role: 'measure' },
        ],
      },
    ],
    relationships: [],
    meanings: [meaning],
    capabilities: [],
  };
  const data = createLocalDataService({
    snapshot: {
      catalog,
      sourceRevision: 'source',
      records: {
        rows: [
          { id: 'a', group: 'A', amount: { decimal: '9007199254740993.01' } },
          { id: 'b', group: 'A', amount: { decimal: '0.02' } },
        ],
      },
    },
  });
  const planned = await data.plan({
    version: '1',
    requestId: 'plan',
    catalogRevision: 'catalog',
    target: { taskId: 'task', outputId: 'total' },
    query: {
      entity: 'rows',
      fields: ['group'],
      groupBy: ['group'],
      measures: [{ id: 'total', revision: '7' }],
      relations: [],
      population: { kind: 'all-authorized' },
      order: [],
    },
    budget: { maxRows: 100, maxBytes: 500000, maxMessages: 8, maxMilliseconds: 10000, maxColumns: 20 },
  });
  if (!planned.ok) throw Error(planned.diagnostics[0].message);
  const accepted = planned.value;
  const store = createResultStore();
  const handle = store.begin({
    requestId: 'result',
    principalKey: 'principal',
    scopeDigest: accepted.scopeDigest,
    ...(accepted.policyRevision === undefined ? {} : { policyRevision: accepted.policyRevision }),
    catalogRevision: accepted.catalogRevision,
    functionRegistryDigest: accepted.functionRegistryDigest,
    sourceRevision: accepted.sourceRevision,
    queryDigest: accepted.queryDigest,
    outputId: 'total',
    taskId: 'task',
    populationDigest: accepted.populationDigest,
  });
  for await (const _ of handle.subscribe(data.execute(accepted))) {
  }
  const snapshot = handle.snapshot();
  expect(snapshot.status).toBe('ready');
  const result = snapshot.descriptor;
  if (result === undefined || result.coverage.kind !== 'complete') throw Error('result');
  const field = result.fields.find((field) => field.id === 'total')!;
  expect(field.derivation).toEqual({ id: 'total', revision: '7' });
  const verifier = createNarrativeVerifier({
    readContext: () => ({
      ok: true,
      value: {
        principalKey: 'principal',
        scopeDigest: accepted.scopeDigest,
        ...(accepted.policyRevision === undefined ? {} : { policyRevision: accepted.policyRevision }),
        catalogRevision: accepted.catalogRevision,
        functionRegistryDigest: accepted.functionRegistryDigest,
        grants: ['result.inspect'],
        resolveResult: () => handle,
      },
    }),
  });
  const claim = {
    version: '1',
    id: 'claim',
    kind: 'value',
    cell: {
      result: result.ref,
      field: 'total',
      identity: { group: 'A' },
      type: field.type,
      definition: field.derivation,
      populationDigest: result.coverage.populationDigest,
      filters: result.filters,
    },
    value: { decimal: '9007199254740993.03' },
  };
  const verified = verifier.verify(claim);
  expect(verified.ok && verified.value.state).toBe('verified');
  const { definition: _, ...withoutDefinition } = claim.cell;
  expect(verifier.verify({ ...claim, cell: withoutDefinition }).ok).toBe(false);
  expect(verifier.verify({ ...claim, cell: { ...claim.cell, definition: { id: 'total', revision: '6' } } }).ok).toBe(
    false,
  );
  const group = result.fields.find((field) => field.id === 'group')!;
  const dimension = verifier.verify({
    ...claim,
    cell: { ...withoutDefinition, field: 'group', type: group.type },
    value: 'A',
  });
  expect(dimension.ok && dimension.value.state).toBe('verified');
  store.dispose();
});
