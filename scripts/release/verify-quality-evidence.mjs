import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const evidencePath = resolve(root, process.env.AELIQO_CI_EVIDENCE_PATH ?? 'artifacts/product-ci/ci.json');
const expectedRevision = process.env.GITHUB_SHA;

if (!/^[a-f0-9]{40}$/u.test(expectedRevision ?? '')) {
  throw new Error('GITHUB_SHA must identify the exact release source revision');
}

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
if (evidence.schemaVersion !== 1 || evidence.sourceRevision !== expectedRevision) {
  throw new Error('Quality evidence does not match the exact release source revision');
}
if (evidence.status !== 'passed' || evidence.sourceChangedDuringRun !== false) {
  throw new Error('Quality evidence is incomplete, failed, or records source mutation');
}
if (!Array.isArray(evidence.results) || evidence.results.length === 0) {
  throw new Error('Quality evidence has no command results');
}
const kinds = new Set();
for (const result of evidence.results) {
  if (result?.exitCode !== 0 || typeof result.kind !== 'string') {
    throw new Error('Quality evidence contains a failed or malformed command result');
  }
  if (!/^[a-f0-9]{64}$/u.test(result.log?.sha256 ?? '')) {
    throw new Error('Quality evidence contains an invalid log digest');
  }
  kinds.add(result.kind);
}
for (const kind of ['typecheck', 'unit', 'browser', 'packages', 'performance', 'lint', 'security', 'boundaries']) {
  if (!kinds.has(kind)) throw new Error(`Quality evidence is missing the ${kind} boundary`);
}

console.log(JSON.stringify({ sourceRevision: evidence.sourceRevision, commands: evidence.results.length }));
