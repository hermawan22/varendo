import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';
/** Installed-tarball byte/graph gate only. This is not a timing or full performance qualification. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { tmpdir, platform, release, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
const root = resolve(import.meta.dirname, '../..');
function run(argv, cwd = root) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw Error(`${argv.join(' ')} failed: ${r.error ?? ''}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = () => run(['node', 'scripts/source-digest.mjs']).trim();
const before = digest();
const sourceCommit = run(['git', 'rev-parse', 'HEAD']).trim();
await mkdir(join(root, 'artifacts/performance-bundles'), { recursive: true });
const output = await mkdtemp(join(root, 'artifacts/performance-bundles/run-'));
const consumer = await mkdtemp(join(tmpdir(), 'varendo-performance-consumer-'));
const packages = [];
for (const name of ['core', 'runtime', 'web', 'react']) {
  const cwd = join(root, 'packages', name);
  run(['pnpm', 'build'], cwd);
  const tarball = join(output, `varendo-${name}-${RELEASE_VERSION}.tgz`);
  run(['pnpm', 'pack', '--out', tarball], cwd);
  const manifest = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json']));
  assert.equal(manifest.version, RELEASE_VERSION);
  assert.equal(manifest.name, `@varendo/${name}`);
  packages.push({ name: manifest.name, path: tarball, sha256: hash(await readFile(tarball)) });
}
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(
  join(consumer, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      ...Object.fromEntries(packages.map((p) => [p.name, `file:${p.path}`])),
      ...Object.fromEntries(['react', 'react-dom', 'zod'].map((name) => [name, rootManifest.devDependencies[name]])),
    },
  }),
);
run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
for (const p of packages) assert.equal((await lstat(join(consumer, 'node_modules', p.name))).isSymbolicLink(), false);
const lock = await readFile(join(consumer, 'package-lock.json'));
await writeFile(join(output, 'consumer-package-lock.json'), lock);
const quickstartPath = 'docs/site/pages/quickstart.md';
const quickstartSource = await readFile(join(root, quickstartPath), 'utf8');
function sourceBlock(language) {
  const matches = [...quickstartSource.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))];
  assert.equal(matches.length, 1, `Expected one complete ${language} quickstart source`);
  return matches[0][1];
}
await writeFile(join(consumer, 'people.ts'), sourceBlock('ts'));
await writeFile(join(consumer, 'people.css'), sourceBlock('css'));
const workloads = [
  {
    id: 'button',
    code: "import {VarendoButtonElement} from '@varendo/web/button'; customElements.define('perf-button',VarendoButtonElement);",
    budget: 15 * 1024,
    incremental: true,
    direct: true,
  },
  {
    id: 'input',
    code: "import {VarendoTextFieldElement} from '@varendo/web/inputs'; customElements.define('perf-input',VarendoTextFieldElement);",
    budget: 15 * 1024,
    incremental: true,
    direct: true,
  },
  {
    id: 'metric',
    code: "import {VarendoMetricElement} from '@varendo/web/metric'; customElements.define('perf-metric',VarendoMetricElement);",
    budget: 15 * 1024,
    incremental: true,
    direct: true,
  },
  {
    id: 'table',
    code: "import {VarendoTableElement} from '@varendo/web/table'; customElements.define('perf-table',VarendoTableElement);",
    budget: 40 * 1024,
    incremental: true,
    direct: true,
  },
  {
    id: 'core-planner-validation',
    code: "import {parseCatalog,parseTask,parseExperience} from '@varendo/core'; import {validatePresentationPlan,composePresentation} from '@varendo/core/presentation'; import {createQueryPlanner} from '@varendo/core/query'; globalThis.varendoPerformance={parseCatalog,parseTask,parseExperience,createQueryPlanner,validatePresentationPlan,composePresentation};",
    budget: 70 * 1024,
  },
  // Plan validation has its own budget above; this row measures the mounted region and runtime data path.
  {
    id: 'region-table',
    code: "import {VarendoRegionElement,createVarendoPresentationRegistry} from '@varendo/web/region'; import {createLocalDataService} from '@varendo/runtime/data'; import {createResultStore} from '@varendo/runtime/results'; import {parseTask} from '@varendo/core'; import {createStandardFunctionRegistry} from '@varendo/core/expressions'; import {VarendoTableElement} from '@varendo/web/table'; import {createRegionStore} from '@varendo/runtime/regions'; import {createTaskEvaluator} from '@varendo/runtime/evaluation'; customElements.define('perf-region',VarendoRegionElement); customElements.define('varendo-table',VarendoTableElement); globalThis.varendoPerformance={createRegionStore,createTaskEvaluator,createLocalDataService,createResultStore,createVarendoPresentationRegistry,parseTask,createStandardFunctionRegistry};",
    // Raised from 160 KiB in 0.6.0 (owner decision): workspace layouts, chart-first analysis, and
    // fitted chart widths grew the mounted region; it had stayed within 160 KiB since 0.3.
    budget: 168 * 1024,
    absentStyleRules: [
      ":is(button, input, select, [part='number'])",
      ":where([data-varendo-theme]:not([data-varendo-theme='inherit']))",
    ],
  },
  {
    id: 'react-quickstart',
    code: sourceBlock('tsx'),
    extension: 'tsx',
    diagnostic: true,
    source: { path: quickstartPath, sha256: hash(quickstartSource) },
  },
];
const rows = [];
for (const workload of workloads) {
  const entry = join(consumer, `${workload.id}.${workload.extension ?? 'js'}`);
  await writeFile(entry, workload.code);
  const modes = workload.incremental ? ['total', 'excluding-lit'] : ['total'];
  const measurements = [];
  for (const mode of modes) {
    const bundled = await build({
      configFile: false,
      root: consumer,
      logLevel: 'error',
      oxc: { jsx: { runtime: 'automatic' } },
      build: {
        write: false,
        minify: true,
        target: 'es2022',
        sourcemap: false,
        rolldownOptions: {
          input: entry,
          external:
            mode === 'excluding-lit'
              ? (id) =>
                  id === 'lit' ||
                  id.startsWith('lit/') ||
                  id.startsWith('@lit/') ||
                  id === 'lit-html' ||
                  id.startsWith('lit-html/') ||
                  id === 'lit-element' ||
                  id.startsWith('lit-element/')
              : undefined,
          output: { format: 'es' },
        },
      },
    });
    const outputs = Array.isArray(bundled) ? bundled.flatMap((x) => x.output) : bundled.output;
    const chunks = [];
    const moduleSet = new Set();
    const unusedStyleRules = new Set();
    for (const chunk of outputs) {
      const bytes = Buffer.from(chunk.type === 'chunk' ? chunk.code : chunk.source);
      const path = `${workload.id}-${mode}-${chunk.fileName.replaceAll('/', '_')}`;
      await writeFile(join(output, path), bytes);
      if (chunk.type === 'chunk') {
        Object.keys(chunk.modules).forEach((id) => moduleSet.add(id));
        for (const rule of workload.absentStyleRules ?? []) if (chunk.code.includes(rule)) unusedStyleRules.add(rule);
      }
      chunks.push({
        path,
        fileName: chunk.fileName,
        kind: chunk.type,
        ...(chunk.type === 'chunk'
          ? { entry: chunk.isEntry, imports: chunk.imports, dynamicImports: chunk.dynamicImports }
          : {}),
        bytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
        sha256: hash(bytes),
      });
    }
    const modules = [...moduleSet].sort().map((id) => (id.startsWith(consumer) ? id.slice(consumer.length + 1) : id));
    const forbidden = modules.filter(
      (id) =>
        id.includes('@varendo/agent/') ||
        id.startsWith('node:') ||
        id.includes('__vite-browser-external') ||
        (workload.direct &&
          (id.includes('@varendo/runtime/') ||
            id.includes('@varendo/core/dist/query/') ||
            id.includes('@varendo/core/dist/presentation/') ||
            id.includes('@varendo/web/dist/visualization/'))),
    );
    const initialFiles = new Set();
    function includeInitial(fileName) {
      if (initialFiles.has(fileName)) return;
      initialFiles.add(fileName);
      const chunk = chunks.find((item) => item.fileName === fileName);
      for (const imported of chunk?.imports ?? []) includeInitial(imported);
    }
    for (const chunk of chunks) if (chunk.entry) includeInitial(chunk.fileName);
    const initialJsGzipBytes = chunks
      .filter((c) => c.kind === 'chunk' && initialFiles.has(c.fileName))
      .reduce((sum, c) => sum + c.gzipBytes, 0);
    const deferredJsGzipBytes = chunks
      .filter((c) => c.kind === 'chunk' && !initialFiles.has(c.fileName))
      .reduce((sum, c) => sum + c.gzipBytes, 0);
    measurements.push({
      mode,
      chunks,
      modules,
      forbidden,
      unusedStyleRules: [...unusedStyleRules],
      jsGzipBytes: chunks.filter((c) => c.kind === 'chunk').reduce((sum, c) => sum + c.gzipBytes, 0),
      initialJsGzipBytes,
      deferredJsGzipBytes,
      cssBytes: chunks.filter((c) => c.path.endsWith('.css')).reduce((sum, c) => sum + c.bytes, 0),
    });
  }
  const measured = measurements.find((m) => m.mode === (workload.incremental ? 'excluding-lit' : 'total'));
  rows.push({
    id: workload.id,
    entry: workload.code,
    ...(workload.source ? { source: workload.source } : {}),
    diagnostic: workload.diagnostic ?? false,
    budgetBytes: workload.budget ?? null,
    budgetMetric: workload.diagnostic
      ? 'diagnostic only: initial static JS graph and deferred chunks'
      : workload.incremental
        ? 'JS gzip with only Lit packages external'
        : 'total JS gzip',
    passed:
      (workload.diagnostic || measured.jsGzipBytes <= workload.budget) &&
      measurements.every((m) => m.forbidden.length === 0 && m.unusedStyleRules.length === 0),
    measurements,
  });
}
const deferred = process.env.VARENDO_DEFER_PERFORMANCE === '1';
const functionalPassed = rows.every((row) =>
  row.measurements.every(
    (measurement) => measurement.forbidden.length === 0 && measurement.unusedStyleRules.length === 0,
  ),
);
if (deferred)
  for (const row of rows) {
    row.passed = null;
    row.qualificationStatus = 'deferred';
  }
const after = digest();
assert.equal(after, before, 'Source changed during bundle measurement');
const report = {
  sourceCommit,
  sourceDigest: before,
  sourceChangedDuringRun: false,
  environment: {
    node: process.version,
    vite: '8.2.2',
    os: platform(),
    release: release(),
    arch: arch(),
    target: 'es2022',
    minified: true,
    gzip: 'node:zlib default',
  },
  packages,
  consumerLockSha256: hash(lock),
  consumerDirectory: consumer,
  rows,
  bundleGate: deferred ? 'deferred' : rows.every((r) => r.passed) ? 'pass' : 'fail',
  functionalPassed,
  performanceQualification: deferred ? 'deferred' : 'blocked',
  limits: [
    'This proves selected browser export byte sizes and bundle module graphs, not actual interaction correctness or execution/parse latency.',
    'The promoted React quickstart is copied from public documentation and measured diagnostically with installed core/runtime/web/react tarballs and React included. Initial bytes follow static imports; all deferred bytes are also retained. No new byte budget is imposed.',
    'Incremental builds externalize only Lit and retain all Varendo shared platform code; total builds include Lit.',
    'Timing, browser traces, large workloads, cleanup/heap and real mobile hardware remain required.',
  ],
};
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      report: join(output, 'report.json'),
      gate: report.bundleGate,
      rows: rows.map((r) => ({
        id: r.id,
        passed: r.passed,
        budget: r.budgetBytes,
        diagnostic: r.diagnostic,
        measurements: r.measurements.map((m) => ({
          mode: m.mode,
          gzip: m.jsGzipBytes,
          initialGzip: m.initialJsGzipBytes,
          deferredGzip: m.deferredJsGzipBytes,
          forbidden: m.forbidden,
        })),
      })),
    },
    null,
    2,
  ),
);
if (!functionalPassed || report.bundleGate === 'fail') process.exitCode = 1;
