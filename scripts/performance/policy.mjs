export const PAIR_ORDER = Object.freeze([
  ['baseline', 'candidate'],
  ['candidate', 'baseline'],
  ['baseline', 'candidate'],
]);
const METRICS = ['layoutEventP95Ms', 'visualizationMutationLayoutP95Ms'];

export function validateBudget(budget) {
  if (budget.status !== 'approved') throw Error('Performance comparison budget has not been approved');
  if (!/^[a-f0-9]{40}$/u.test(budget.baselineSHA ?? '')) throw Error('Expected immutable performance baseline SHA');
  if (!/^[a-f0-9]{64}$/u.test(budget.workloadSHA ?? '')) throw Error('Expected performance workload SHA');
  if (typeof budget.review !== 'string' || !budget.review.trim()) throw Error('Expected performance review record');
  if (!/^sha256:[a-f0-9]{64}$/u.test(budget.runner?.container ?? ''))
    throw Error('Expected reviewed immutable performance container identity');
  validatePolicy(budget);
}

function validatePolicy(budget) {
  if (budget.pairs !== 3 || budget.relative?.fraction !== 0.2 || budget.relative?.milliseconds !== 2)
    throw Error('Expected reviewed three-pair 20% AND 2ms candidate policy');
  const actual = budget.absolute;
  if (actual?.reducerP95Ms !== 4 || actual?.mountedRows !== 100)
    throw Error('Existing absolute performance budgets must be preserved');
}

function summary(samples, metric) {
  if (samples.length !== 3) throw Error('Expected three complete workload samples per source');
  const values = samples.map((sample) => sample[metric]);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0))
    throw Error(`Missing or invalid measurement: ${metric}`);
  const sorted = [...values].sort((a, b) => a - b);
  return { values, minimum: sorted[0], median: sorted[1], maximum: sorted[2] };
}

export function compareMeasurements(baseline, candidate, budget) {
  validatePolicy(budget);
  const metrics = {};
  for (const metric of METRICS) {
    const before = summary(baseline, metric);
    const after = summary(candidate, metric);
    const deltaMs = after.median - before.median;
    metrics[metric] = {
      baseline: before,
      candidate: after,
      deltaMs,
      deltaFraction: before.median === 0 ? null : deltaMs / before.median,
      regression: deltaMs > budget.relative.milliseconds && deltaMs > before.median * budget.relative.fraction,
    };
  }
  return { passed: Object.values(metrics).every((metric) => !metric.regression), metrics };
}
