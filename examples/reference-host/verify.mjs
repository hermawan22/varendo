import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHttpDataService } from '@varendo/runtime/data';
import { budget, commerceFixture, hrFixture } from './fixtures.mjs';
import { startReferenceHost } from './server.mjs';

const expected = JSON.parse(readFileSync(new URL('../../fixtures/hr/expected.json', import.meta.url), 'utf8'));
const mutations = JSON.parse(
  readFileSync(new URL('../../tests/query/oracle/hr-binding.json', import.meta.url), 'utf8'),
).mutations;
const unwrap = (outcome) => {
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics));
  return outcome.value;
};
async function evaluate(service, fixture, query = fixture.query) {
  const accepted = unwrap(
    await service.plan({
      version: '1',
      requestId: 'reference-query',
      catalogRevision: fixture.snapshot.catalog.revision,
      target: { taskId: 'reference-query', outputId: 'reference-output' },
      query,
      budget,
    }),
  );
  const events = [];
  for await (const event of service.execute(accepted)) events.push(event);
  assert.equal(events[0]?.kind, 'descriptor', JSON.stringify(events));
  assert.equal(events.at(-1)?.kind, 'complete', JSON.stringify(events));
  const descriptor = events[0].descriptor;
  assert.equal(descriptor.taskId, accepted.requestId);
  assert.equal(descriptor.ref.outputId, accepted.target.outputId);
  assert.equal(descriptor.ref.queryDigest, accepted.queryDigest);
  assert.equal(descriptor.ref.scopeDigest, accepted.scopeDigest);
  assert.equal(descriptor.ref.revision, accepted.sourceRevision);
  for (const event of events) if ('result' in event) assert.deepEqual(event.result, descriptor.ref);
  return {
    descriptor,
    rows: events.flatMap((event) => (event.kind === 'batch' ? event.rows : [])),
    terminal: events.at(-1),
  };
}
const semantic = (result) => ({
  rows: result.rows,
  taskId: result.descriptor.taskId,
  filters: result.descriptor.filters,
  warnings: result.descriptor.warnings,
  lineage: result.descriptor.lineage,
  period: result.descriptor.period,
  queryDigest: result.descriptor.ref.queryDigest,
  outputId: result.descriptor.ref.outputId,
  revision: result.descriptor.ref.revision,
  fields: result.descriptor.fields,
  identity: result.descriptor.identity,
  grain: result.descriptor.rowGrain,
  counts: result.descriptor.counts,
  precision: result.descriptor.precision,
  consistency: result.descriptor.consistency,
  evidence: result.descriptor.evidence,
  coverage: result.terminal.finalCoverage,
  scopeDigest: result.descriptor.ref.scopeDigest,
});
async function parity(fixture, check) {
  const host = await startReferenceHost({ fixture });
  try {
    const local = await evaluate(host.service, fixture);
    const remote = await evaluate(createHttpDataService({ baseUrl: host.url }), fixture);
    assert.deepEqual(semantic(remote), semantic(local));
    assert.equal(remote.descriptor.counts.loaded, remote.rows.length);
    assert.equal(remote.descriptor.counts.population.kind, 'exact');
    assert.equal(remote.descriptor.counts.population.value, remote.rows.length);
    assert.equal(remote.terminal.finalCoverage.kind, 'complete');
    assert.equal(remote.descriptor.evidence.kind, 'computed');
    check(remote);
  } finally {
    await host.close();
  }
  await assert.rejects(fetch(`${host.url}/adc/describe`));
}
const fraction = (text) => {
  const [a, b] = text.split('/').map(Number);
  return b === undefined ? a : a / b;
};
function checkHr(result, mutation) {
  assert.equal(result.descriptor.precision.kind, 'approximate');
  assert.deepEqual(result.descriptor.rowGrain, ['employee_id']);
  const changed = mutation?.expected.employee;
  for (const baseline of expected.employees) {
    const target = changed?.employee_id === baseline.employee_id ? changed : baseline;
    const row = result.rows.find((candidate) => candidate.employee_id === target.employee_id);
    assert.ok(row);
    for (const field of ['absent', 'expected', 'unknown']) assert.equal(row[`absence.${field}`], target[field]);
    if (target.rate === null) assert.equal(row['absence.rate'], null);
    else assert.ok(Math.abs(row['absence.rate'] - fraction(target.rate)) < 1e-12);
  }
  assert.equal(result.rows.length, expected.employees.length);
}

await parity(commerceFixture(), (result) => {
  assert.deepEqual(result.rows, [
    { customer: 'beta', 'sales.total': { decimal: '30.00' } },
    { customer: 'alpha', 'sales.total': { decimal: '20.03' } },
  ]);
  assert.equal(result.descriptor.precision.kind, 'exact');
});
await parity(hrFixture(), (result) => checkHr(result));
for (const mutation of mutations)
  await parity(hrFixture(mutation.removeObservation), (result) => checkHr(result, mutation));
console.log(
  'Actual local/HTTP reference parity passes: exact commerce totals, raw HR rates, both missing-observation mutations, scoped descriptors, and server cleanup.',
);
