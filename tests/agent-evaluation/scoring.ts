import type { EvaluatedOutput } from './host.js';
interface ExpectedQuality {
  readonly identity: readonly string[];
  readonly populationCount: number;
  readonly precision: 'exact';
  readonly sourceRevisions: Readonly<Record<string, string>>;
  readonly evidenceKind: 'observed' | 'computed';
  readonly definitions: readonly { readonly id: string; readonly revision: string }[];
}
export interface ExpectedOutput {
  readonly id: string;
  readonly fields: readonly string[];
  readonly grain: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly orderMatters: boolean;
  readonly coverage: 'complete' | 'partial' | 'sample' | 'unknown';
  readonly quality: ExpectedQuality;
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  );
export function scoreData(
  outputs: readonly EvaluatedOutput[],
  expected: readonly ExpectedOutput[],
  scopeDigest: string,
  sourceRevision: string,
) {
  const findings: string[] = [];
  if (outputs.length !== expected.length) findings.push('output-count');
  if (new Set(outputs.map((output) => output.descriptor.ref.outputId)).size !== outputs.length)
    findings.push('duplicate-output-id');
  if (new Set(expected.map((output) => output.id)).size !== expected.length)
    findings.push('duplicate-expected-output-id');
  for (const wanted of expected) {
    const output = outputs.find((item) => item.descriptor.ref.outputId === wanted.id);
    if (!output) {
      findings.push(`${wanted.id}:missing-output`);
      continue;
    }
    if (output.descriptor.ref.scopeDigest !== scopeDigest) findings.push(`${wanted.id}:scope`);
    if (canonical([...output.descriptor.rowGrain].sort()) !== canonical([...wanted.grain].sort()))
      findings.push(`${wanted.id}:grain`);
    if (output.descriptor.coverage.kind !== wanted.coverage) findings.push(`${wanted.id}:coverage`);
    if (canonical(output.descriptor.fields.map((field) => field.id).sort()) !== canonical([...wanted.fields].sort()))
      findings.push(`${wanted.id}:fields`);
    if (output.rows.some((row) => canonical(Object.keys(row).sort()) !== canonical([...wanted.fields].sort())))
      findings.push(`${wanted.id}:row-fields`);
    const quality = wanted.quality;
    if (canonical([...output.descriptor.identity].sort()) !== canonical([...quality.identity].sort()))
      findings.push(`${wanted.id}:identity`);
    const counts = output.descriptor.counts;
    if (
      counts.loaded !== output.rows.length ||
      counts.loaded !== wanted.rows.length ||
      counts.population.kind !== 'exact' ||
      counts.population.value !== quality.populationCount
    )
      findings.push(`${wanted.id}:counts`);
    if (
      counts.population.kind === 'exact' &&
      'populationDigest' in output.descriptor.coverage &&
      counts.population.populationDigest !== output.descriptor.coverage.populationDigest
    )
      findings.push(`${wanted.id}:population-identity-consistency`);
    if (output.descriptor.precision.kind !== quality.precision) findings.push(`${wanted.id}:precision`);
    const consistency = output.descriptor.consistency;
    if (
      consistency.kind !== 'snapshot' ||
      consistency.snapshotId !== sourceRevision ||
      canonical(consistency.sourceRevisions) !== canonical(quality.sourceRevisions)
    )
      findings.push(`${wanted.id}:consistency`);
    const evidence = output.descriptor.evidence;
    if (
      evidence.kind !== quality.evidenceKind ||
      (evidence.kind === 'observed' &&
        (evidence.source.id !== 'local-source' || evidence.source.revision !== sourceRevision)) ||
      (evidence.kind === 'computed' &&
        (evidence.queryDigest !== output.descriptor.ref.queryDigest ||
          canonical(evidence.definitions.map(canonical).sort()) !==
            canonical(quality.definitions.map(canonical).sort())))
    )
      findings.push(`${wanted.id}:evidence`);
    const project = (row: Readonly<Record<string, unknown>>) =>
      Object.fromEntries(
        wanted.fields.map((field) => [field, Object.hasOwn(row, field) ? row[field] : { missing: true }]),
      );
    const actual = output.rows.map(project).map(canonical);
    const truth = wanted.rows.map(project).map(canonical);
    if (!wanted.orderMatters) {
      actual.sort();
      truth.sort();
    }
    if (canonical(actual) !== canonical(truth)) findings.push(`${wanted.id}:values-or-order`);
  }
  return { dataCorrect: findings.length === 0, findings, uiTaskCompletion: null, narrativeGrounding: null };
}
export function wilsonInterval(successes: number, trials: number) {
  if (
    !Number.isSafeInteger(trials) ||
    !Number.isSafeInteger(successes) ||
    trials < 0 ||
    successes < 0 ||
    successes > trials
  )
    throw Error('Invalid trial counts.');
  if (trials === 0) return null;
  const z = 1.959963984540054,
    p = successes / trials,
    denominator = 1 + (z * z) / trials,
    center = (p + (z * z) / (2 * trials)) / denominator,
    margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials)) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin), confidence: 0.95, trials };
}
