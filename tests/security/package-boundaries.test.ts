import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { API, type Snapshot } from 'typescript/unstable/sync';
import type { Node, SourceFile as TsSourceFile } from 'typescript/unstable/ast';
import {
  SyntaxKind,
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isIdentifier,
  isNewExpression,
  isPropertyAccessExpression,
  isStringLiteralLikeNode,
} from 'typescript/unstable/ast';

const root = resolve(import.meta.dirname, '../..');
const packageNames = ['core', 'runtime', 'web'] as const;
type PackageName = (typeof packageNames)[number];
type SourceNode = Node;
type SourceFile = TsSourceFile;
type Finding = { file: string; message: string };
type ModuleEdge = { specifier: string; file: string; dynamic?: 'import' | 'require'; node: SourceNode };

const packageRoot = (name: PackageName): string => join(root, 'packages', name);
const sourceRoot = (name: PackageName): string => join(packageRoot(name), 'src');
const fixtureRoot = join(root, 'tests/security');
const presentationLoader = join(sourceRoot('web'), 'app/presentation-elements.ts');
const presentationImports = new Set([
  '../register-foundation.js',
  '../register-input.js',
  '../register-navigation.js',
  '../register-feedback.js',
  '../register-data.js',
  '../register-cartesian.js',
  '../register-temporal.js',
  '../register-hierarchy.js',
  '../register.js',
]);

function reviewedPresentationImport(name: PackageName, edge: ModuleEdge): boolean {
  return (
    name === 'web' &&
    resolve(edge.file) === presentationLoader &&
    edge.dynamic === 'import' &&
    presentationImports.has(edge.specifier)
  );
}

function sourceText(node: SourceNode, sourceFile: SourceFile): string {
  return node.getText(sourceFile);
}

function staticSpecifier(node: SourceNode): string | undefined {
  if (isImportDeclaration(node) || isExportDeclaration(node)) {
    const moduleSpecifier = node.moduleSpecifier;
    return moduleSpecifier && isStringLiteralLikeNode(moduleSpecifier) ? moduleSpecifier.text : undefined;
  }
  if (isImportEqualsDeclaration(node)) {
    const reference = node.moduleReference as any;
    if (reference && reference.expression && isStringLiteralLikeNode(reference.expression))
      return reference.expression.text;
  }
  return undefined;
}

function collectEdges(sourceFile: SourceFile): ModuleEdge[] {
  const edges: ModuleEdge[] = [];
  const visit = (node: SourceNode): void => {
    const specifier = staticSpecifier(node);
    if (specifier !== undefined) edges.push({ specifier, file: sourceFile.fileName, node });
    if (isCallExpression(node)) {
      const expression = node.expression;
      if (expression.kind === SyntaxKind.ImportKeyword) {
        const first = node.arguments[0];
        edges.push({
          specifier: first && isStringLiteralLikeNode(first) ? first.text : '<non-literal>',
          file: sourceFile.fileName,
          dynamic: 'import',
          node,
        });
      } else if (isIdentifier(expression) && expression.text === 'require') {
        const first = node.arguments[0];
        edges.push({
          specifier: first && isStringLiteralLikeNode(first) ? first.text : '<non-literal>',
          file: sourceFile.fileName,
          dynamic: 'require',
          node,
        });
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return edges;
}

function resolveRelativeModule(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
  const candidates = [
    base,
    stem,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    `${stem}.js`,
    `${stem}.jsx`,
    join(stem, 'index.ts'),
    join(stem, 'index.tsx'),
    join(stem, 'index.js'),
  ];
  return candidates.find((path) => sourcePathExists(path));
}

function sourcePathExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function packageExportSource(name: PackageName, target: string): string {
  const relativeTarget = target
    .replace(/^\.\/dist\//, '')
    .replace(/\.d\.ts$/, '.ts')
    .replace(/\.js$/, '.ts');
  const direct = join(sourceRoot(name), relativeTarget);
  return direct;
}

function flattenedExportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return Object.values(record).flatMap(flattenedExportTargets);
}

function exportedSourceEntries(name: PackageName, manifest: Record<string, unknown>): string[] {
  const exports = manifest.exports;
  if (!exports || typeof exports !== 'object') throw new Error(`@varendo/${name} has no exports map`);
  const entries: string[] = [];
  for (const [key, value] of Object.entries(exports as Record<string, unknown>)) {
    if (key.includes('*')) continue;
    const targets = flattenedExportTargets(value);
    const imports = targets.filter((target) => target.includes('/dist/') && target.endsWith('.js'));
    if (imports.length === 0) continue;
    const source = packageExportSource(name, imports[0]!);
    entries.push(source);
  }
  return entries;
}

function isWithin(path: string, directory: string): boolean {
  const rel = relative(directory, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${'/'}`) && !isAbsolute(rel));
}

function memberText(node: SourceNode, sourceFile: SourceFile): string {
  return sourceText(node, sourceFile).replace(/\s+/g, '');
}

function ambientEffectFindings(sourceFile: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: SourceNode): void => {
    if (isPropertyAccessExpression(node)) {
      const text = memberText(node, sourceFile);
      if (
        /^(?:globalThis\.)?(?:Date\.now|Math\.random|performance\.now|crypto\.randomUUID|crypto\.getRandomValues)$/.test(
          text,
        )
      ) {
        findings.push({ file: sourceFile.fileName, message: `ambient clock/random read ${text}` });
      }
      if (/^(?:globalThis\.)?(?:fetch|XMLHttpRequest|WebSocket|EventSource)$/.test(text)) {
        findings.push({ file: sourceFile.fileName, message: `ambient network/platform effect ${text}` });
      }
    }
    if (
      isNewExpression(node) &&
      isIdentifier(node.expression) &&
      node.expression.text === 'Date' &&
      (node.arguments ?? []).length === 0
    ) {
      findings.push({ file: sourceFile.fileName, message: 'ambient clock read new Date()' });
    }
    if (
      isIdentifier(node) &&
      ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator'].includes(node.text) &&
      node.parent &&
      node.parent.kind !== SyntaxKind.PropertyAccessExpression
    ) {
      findings.push({ file: sourceFile.fileName, message: `ambient platform access ${node.text}` });
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return findings;
}

function parseProjects(overrides: Record<string, string> = {}): {
  api: API;
  snapshot: Snapshot;
  files: Map<string, SourceFile>;
} {
  const api = new API({ cwd: root, fs: { readFile: (file) => overrides[resolve(file)] } });
  const projectConfigs = packageNames.map((name) => join(packageRoot(name), 'tsconfig.json'));
  const fixtureFiles = [
    join(fixtureRoot, 'package-boundaries-forbidden-relative.fixture.ts'),
    join(fixtureRoot, 'package-boundaries-forbidden-dynamic.fixture.ts'),
    join(fixtureRoot, 'package-boundaries-forbidden-ambient.fixture.ts'),
    join(fixtureRoot, 'package-boundaries-allowed-date.fixture.ts'),
  ];
  const snapshot = api.updateSnapshot({ openProjects: projectConfigs, openFiles: fixtureFiles });
  const files = new Map<string, SourceFile>();
  for (const project of snapshot.getProjects()) {
    for (const file of project.program.getSourceFileNames()) {
      const source = project.program.getSourceFile(file);
      if (source) files.set(resolve(file), source);
    }
  }
  return { api, snapshot, files };
}

function reachableEntries(
  name: PackageName,
  entries: readonly string[],
  files: Map<string, SourceFile>,
): { files: Set<string>; external: Map<string, Set<string>>; findings: Finding[] } {
  const seen = new Set<string>();
  const external = new Map<string, Set<string>>();
  const findings: Finding[] = [];
  const visitFile = (file: string): void => {
    const absolute = resolve(file);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const source = files.get(absolute);
    if (!source) {
      findings.push({
        file: absolute,
        message: 'declared export or relative import does not resolve to a TS source file',
      });
      return;
    }
    for (const edge of collectEdges(source)) {
      if (edge.dynamic && !reviewedPresentationImport(name, edge)) {
        findings.push({ file: edge.file, message: `dynamic module edge ${edge.specifier}` });
        continue;
      }
      if (edge.specifier.startsWith('.')) {
        const target = resolveRelativeModule(absolute, edge.specifier);
        if (!target || !isWithin(target, sourceRoot(name))) {
          findings.push({ file: absolute, message: `relative import escapes ${name}: ${edge.specifier}` });
        } else visitFile(target);
      } else {
        const imported = external.get(absolute) ?? new Set<string>();
        imported.add(edge.specifier);
        external.set(absolute, imported);
      }
    }
  };
  for (const entry of entries) visitFile(entry);
  return { files: seen, external, findings };
}

function readManifest(name: PackageName): Promise<Record<string, unknown>> {
  return readFile(join(packageRoot(name), 'package.json'), 'utf8').then(
    (text) => JSON.parse(text) as Record<string, unknown>,
  );
}

function externalImports(graph: ReturnType<typeof reachableEntries>): string[] {
  return [...graph.external.values()].flatMap((set) => [...set]).sort();
}

function assertNoAmbientEffects(files: Iterable<string>, sourceMap: Map<string, SourceFile>): Finding[] {
  return [...files].flatMap((file) => ambientEffectFindings(sourceMap.get(file)!));
}

describe('package boundary graph', () => {
  it('follows every reviewed presentation import into its implementation and external dependency graph', () => {
    const loader = join(sourceRoot('web'), 'app/presentation-elements.ts');
    const input = join(sourceRoot('web'), 'register-input.ts');
    const { api, snapshot, files } = parseProjects({
      [input]: "import '../../runtime/src/index.js'; import '@varendo/agent';",
    });
    try {
      const graph = reachableEntries('web', [loader], files);
      const imports = collectEdges(files.get(loader)!).filter((edge) => edge.dynamic);
      expect(imports).toHaveLength(9);
      for (const edge of imports) expect(graph.files.has(resolveRelativeModule(loader, edge.specifier)!)).toBe(true);
      expect(graph.findings).toEqual([
        { file: input, message: 'relative import escapes web: ../../runtime/src/index.js' },
      ]);
      expect(externalImports(graph)).toContain('@varendo/agent');
      expect(graph.files.has(join(sourceRoot('web'), 'foundation/button.ts'))).toBe(true);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });

  it('rejects unreviewed, nonliteral, external and require edges in the presentation loader', () => {
    const loader = join(sourceRoot('web'), 'app/presentation-elements.ts');
    const { api, snapshot, files } = parseProjects({
      [loader]: `const selected = '../register-input.js';
        import('../register-base.js'); import(selected); import('@varendo/agent'); require('../register-input.js');`,
    });
    try {
      const graph = reachableEntries('web', [loader], files);
      expect(graph.findings.map((finding) => finding.message)).toEqual([
        'dynamic module edge ../register-base.js',
        'dynamic module edge <non-literal>',
        'dynamic module edge @varendo/agent',
        'dynamic module edge ../register-input.js',
      ]);
      expect([...graph.files]).toEqual([loader]);
      expect(externalImports(graph)).toEqual([]);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });

  it.each(packageNames)('rejects the same literal dynamic edge outside the reviewed web loader in %s', (name) => {
    const entry = join(sourceRoot(name), 'index.ts');
    const { api, snapshot, files } = parseProjects({ [entry]: "import('../register-input.js');" });
    try {
      const graph = reachableEntries(name, [entry], files);
      expect(graph.findings).toEqual([{ file: entry, message: 'dynamic module edge ../register-input.js' }]);
      expect([...graph.files]).toEqual([entry]);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });

  it('uses TS7 ASTs to resolve every declared source export and local edge', async () => {
    const manifests = await Promise.all(packageNames.map(readManifest));
    const { api, snapshot, files } = parseProjects();
    try {
      for (let i = 0; i < packageNames.length; i += 1) {
        const name = packageNames[i]!;
        const exports = manifests[i]!.exports as Record<string, unknown>;
        for (const [key, value] of Object.entries(exports)) {
          if (key.includes('*') || typeof value === 'string') continue;
          expect(value, `@varendo/${name} ${key} export descriptor`).toMatchObject({
            types: expect.stringMatching(/^\.\/dist\/.+\.d\.ts$/),
            import: expect.stringMatching(/^\.\/dist\/.+\.js$/),
          });
        }
        const entries = exportedSourceEntries(name, manifests[i]!);
        expect(entries.length, `@varendo/${name} should declare source exports`).toBeGreaterThan(0);
        const graph = reachableEntries(name, entries, files);
        expect(graph.findings, `@varendo/${name} export/local graph`).toEqual([]);
        expect(graph.files.size, `@varendo/${name} graph should contain implementation`).toBeGreaterThan(0);
      }
    } finally {
      snapshot.dispose();
      api.close();
    }
  });

  it('keeps core imports pure and runtime away from renderer, agents, providers and host I/O', async () => {
    const manifests = await Promise.all(packageNames.map(readManifest));
    const { api, snapshot, files } = parseProjects();
    try {
      const core = reachableEntries('core', exportedSourceEntries('core', manifests[0]!), files);
      const runtime = reachableEntries('runtime', exportedSourceEntries('runtime', manifests[1]!), files);
      expect(externalImports(core).filter((name) => name !== 'zod/mini' && name !== 'zod')).toEqual([]);
      expect(
        externalImports(runtime).filter(
          (name) => !name.startsWith('@varendo/core') && name !== 'zod/mini' && name !== 'zod',
        ),
      ).toEqual([]);
      expect(
        externalImports(runtime).filter((name) =>
          /(?:web|react|agent|devtools|lit|d3|provider|mcp|openai|node:|fs|http)/i.test(name),
        ),
      ).toEqual([]);
      expect(assertNoAmbientEffects(core.files, files)).toEqual([]);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });

  it('keeps direct web controls independent from runtime/planner/provider graphs while allowing explicit region and SSR edges', async () => {
    const manifest = await readManifest('web');
    const { api, snapshot, files } = parseProjects();
    try {
      const allExports = (manifest.exports ?? {}) as Record<string, unknown>;
      const compositionKeys = new Set([
        './recipes',
        './compound',
        './explorer',
        './comparison',
        './breakdown',
        './investigation',
        './search-results',
        './record-editor',
        './form-flow',
        './quality-panel',
      ]);
      const directKeys = Object.keys(allExports).filter(
        (key) =>
          !['.', './app', './register', './server', './region', './region/adaptation'].includes(key) &&
          !compositionKeys.has(key) &&
          !key.includes('*'),
      );
      expect(directKeys.length).toBeGreaterThan(40);
      for (const key of directKeys) {
        const target = flattenedExportTargets(allExports[key]).find(
          (value) => value.includes('/dist/') && value.endsWith('.js'),
        );
        expect(target, `@varendo/web ${key} import target`).toBeDefined();
        const graph = reachableEntries('web', [packageExportSource('web', target!)], files);
        expect(graph.findings, `@varendo/web ${key} graph`).toEqual([]);
        const external = externalImports(graph);
        expect(
          external.filter((name) => /@varendo\/(?:runtime|agent|devtools)|(?:provider|mcp|openai)/i.test(name)),
          `${key} must stay direct-control`,
        ).toEqual([]);
        expect(
          external.filter(
            (name) => name.startsWith('@varendo/core/query') || name.startsWith('@varendo/core/presentation'),
          ),
          `${key} must not depend on query planning or presentation composition`,
        ).toEqual([]);
      }
      const regionTarget = packageExportSource('web', flattenedExportTargets(allExports['./region'])[0]!);
      const region = reachableEntries('web', [regionTarget], files);
      expect(region.findings).toEqual([]);
      const adaptationTarget = packageExportSource(
        'web',
        flattenedExportTargets(allExports['./region/adaptation'])[0]!,
      );
      const adaptation = reachableEntries('web', [adaptationTarget], files);
      expect(externalImports(adaptation).some((name) => name.startsWith('@varendo/runtime/'))).toBe(true);
      const appTarget = packageExportSource('web', flattenedExportTargets(allExports['./app'])[0]!);
      const app = reachableEntries('web', [appTarget], files);
      const appExternal = externalImports(app);
      expect(app.findings).toEqual([]);
      expect(appExternal.some((name) => name.startsWith('@varendo/runtime/'))).toBe(true);
      expect(appExternal.filter((name) => /@varendo\/(?:agent|devtools)|(?:provider|mcp|openai)/i.test(name))).toEqual(
        [],
      );
      const serverTarget = packageExportSource('web', flattenedExportTargets(allExports['./server'])[0]!);
      const server = reachableEntries('web', [serverTarget], files);
      expect(externalImports(server).some((name) => name.startsWith('@lit-labs/ssr'))).toBe(true);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });

  it('rejects traversal, dynamic imports and ambient effects while allowing explicit input dates', async () => {
    const { api, snapshot, files } = parseProjects();
    try {
      const fixture = (name: string): SourceFile => {
        const path = resolve(fixtureRoot, name);
        const source = files.get(path);
        if (!source) throw new Error(`fixture was not parsed: ${path}`);
        return source;
      };
      const relativeFixture = fixture('package-boundaries-forbidden-relative.fixture.ts');
      const relativeEdge = collectEdges(relativeFixture).find((edge) => edge.specifier.startsWith('.'))!;
      const relativeTarget = resolveRelativeModule(relativeFixture.fileName, relativeEdge.specifier);
      expect(relativeTarget).toBeDefined();
      expect(isWithin(relativeTarget!, fixtureRoot)).toBe(false);
      const relativeGraph = reachableEntries('core', [relativeFixture.fileName], files);
      expect(relativeGraph.findings).toEqual(
        expect.arrayContaining([
          { file: relativeFixture.fileName, message: 'relative import escapes core: ../../package.json' },
        ]),
      );
      const dynamicFixture = fixture('package-boundaries-forbidden-dynamic.fixture.ts');
      const dynamicEdges = collectEdges(dynamicFixture).filter((edge) => edge.dynamic);
      expect(dynamicEdges.length).toBeGreaterThanOrEqual(2);
      expect(dynamicEdges.some((edge) => edge.specifier === '<non-literal>')).toBe(true);
      const dynamicGraph = reachableEntries('core', [dynamicFixture.fileName], files);
      expect(dynamicGraph.findings.some((item) => item.message === 'dynamic module edge <non-literal>')).toBe(true);
      expect(
        ambientEffectFindings(fixture('package-boundaries-forbidden-ambient.fixture.ts')).map((item) => item.message),
      ).toEqual(
        expect.arrayContaining([
          'ambient clock/random read Date.now',
          'ambient clock/random read Math.random',
          'ambient clock read new Date()',
          'ambient platform access fetch',
        ]),
      );
      expect(ambientEffectFindings(fixture('package-boundaries-allowed-date.fixture.ts'))).toEqual([]);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });
});
