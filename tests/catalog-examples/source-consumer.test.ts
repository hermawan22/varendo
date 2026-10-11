import { chromium, type Page } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { copyFile, mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { CATALOG_EXAMPLE_IDS } from '../../examples/catalog/index.js';

const mimeTypes: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
};

function run(argv: readonly string[], cwd: string): string {
  try {
    return execFileSync(argv[0]!, argv.slice(1), { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`${failure.message ?? 'Command failed'}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`);
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function hashFile(file: string): Promise<{ sha256: string; bytes: number }> {
  const bytes = await readFile(file);
  return { sha256: hashBytes(bytes), bytes: bytes.byteLength };
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

interface CatalogFingerprint {
  readonly hostTag: string;
  readonly lightText: string;
  readonly hostSemantics: readonly string[];
  readonly shadow: {
    readonly present: boolean;
    readonly tags: readonly string[];
    readonly text: string;
    readonly semantics: readonly string[];
  };
}

async function fingerprints(page: Page, selector: string): Promise<readonly CatalogFingerprint[]> {
  return page.evaluate((selector) => {
    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();
    const stableValue = (value: string): string =>
      value
        .replace(/\b(?:aeliqo|lit)-[a-z0-9_-]+-\d+\b/gi, '<generated-id>')
        .replace(/\b[0-9a-f]{8,}\b/gi, '<generated-id>');
    const semantics = (scope: ParentNode): string[] =>
      Array.from(scope.querySelectorAll('*'), (element) => {
        const interesting = [
          'role',
          'type',
          'name',
          'aria-label',
          'aria-labelledby',
          'aria-describedby',
          'aria-valuemin',
          'aria-valuemax',
          'aria-valuenow',
          'aria-checked',
          'aria-selected',
          'aria-expanded',
          'aria-current',
          'tabindex',
        ];
        const values = interesting.flatMap((name) => {
          const value = element.getAttribute(name);
          return value === null ? [] : [name + '=' + stableValue(value)];
        });
        const tag = element.tagName.toLowerCase();
        return values.length > 0 ||
          /^(a|button|caption|fieldset|h[1-6]|img|input|label|li|ol|select|table|td|textarea|th|tr|ul)$/.test(tag)
          ? tag + (values.length === 0 ? '' : '[' + values.join(';') + ']')
          : null;
      }).filter((value): value is string => value !== null);
    const fingerprint = (container: Element): CatalogFingerprint => {
      const root = container.matches('[data-catalog-example-root], [data-catalog-source-root]')
        ? container
        : container.querySelector(':scope > [data-catalog-example-root], :scope > [data-catalog-source-root]');
      const host = root?.firstElementChild;
      if (!(host instanceof HTMLElement)) throw new Error('Catalog root did not contain a custom element host.');
      const shadow = host.shadowRoot;
      return {
        hostTag: host.tagName.toLowerCase(),
        lightText: stableValue(normalizeText(host.textContent ?? '')),
        hostSemantics: semantics(host),
        shadow: {
          present: shadow !== null,
          tags:
            shadow === null ? [] : Array.from(shadow.querySelectorAll('*'), (element) => element.tagName.toLowerCase()),
          text: shadow === null ? '' : stableValue(normalizeText(shadow.textContent ?? '')),
          semantics: shadow === null ? [] : semantics(shadow),
        },
      };
    };
    return Array.from(document.querySelectorAll(selector), (container) => fingerprint(container));
  }, selector);
}

async function serve(directory: string): Promise<{ server: Server; port: number }> {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = resolve(directory, relative);
      if (!file.startsWith(`${directory}/`)) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader('content-type', mimeTypes[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveServer());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Static test server did not expose a port.');
  return { server, port: address.port };
}

async function close(server: Server | undefined): Promise<void> {
  await new Promise<void>((resolveServer) => server?.close(() => resolveServer()) ?? resolveServer());
}

describe('catalog source snippets', () => {
  it('extracts from a minified catalog bundle and runs against real packed packages', async () => {
    const workspace = resolve(import.meta.dirname, '../..');
    const releaseMetadata: unknown = JSON.parse(await readFile(join(workspace, 'release-metadata.json'), 'utf8'));
    if (
      typeof releaseMetadata !== 'object' ||
      releaseMetadata === null ||
      !('version' in releaseMetadata) ||
      typeof releaseMetadata.version !== 'string' ||
      !/^\d+\.\d+\.\d+$/u.test(releaseMetadata.version)
    ) {
      throw new Error('release-metadata.json has an invalid version.');
    }
    const releaseVersion = releaseMetadata.version;
    const evidenceRoot = join(workspace, 'artifacts', 'catalog-source-consumers');
    await mkdir(evidenceRoot, { recursive: true });
    const runDirectory = await mkdtemp(join(evidenceRoot, 'run-'));
    const consumer = await mkdtemp(join(tmpdir(), 'aeliqo-catalog-source-consumer-'));
    const manifestRoot = await mkdtemp(join(tmpdir(), 'aeliqo-catalog-source-manifest-'));
    let manifestServer: Server | undefined;
    let consumerServer: Server | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let manifestFailures: string[] = [];
    let consumerFailures: string[] = [];
    let mismatchCount = 0;
    let failure: string | undefined;
    let passed = false;
    const candidatePaths = [
      ...(await filesUnder(join(workspace, 'examples/catalog'))).filter((file) => file.endsWith('.ts')),
      ...(await filesUnder(join(workspace, 'tests/catalog-examples'))).filter((file) => file.endsWith('.ts')),
    ].sort();
    const candidateBefore = await Promise.all(
      candidatePaths.map(async (file) => ({
        path: file.slice(workspace.length + 1),
        ...(await hashFile(file)),
      })),
    );
    const candidateDigestBefore = run(['node', 'scripts/source-digest.mjs'], workspace).trim();
    const tarballArtifacts: Array<Record<string, unknown>> = [];
    const extractedSourceArtifacts: Array<Record<string, unknown>> = [];
    let lockArtifact: Record<string, unknown> | undefined;
    let counts: Record<string, number> = { catalogExamples: CATALOG_EXAMPLE_IDS.length };
    let environment: Record<string, unknown> = {
      node: process.version,
      os: platform(),
      release: release(),
      arch: arch(),
    };

    try {
      const manifestDist = join(manifestRoot, 'dist');
      const catalogEntry = JSON.stringify(resolve(workspace, 'examples/catalog/index.ts'));
      await writeFile(
        join(manifestRoot, 'index.html'),
        '<!doctype html><html lang="en"><body><main id="sources"></main><script type="module" src="/entry.ts"></script></body></html>\n',
      );
      await writeFile(
        join(manifestRoot, 'entry.ts'),
        `import {CATALOG_EXAMPLE_IDS, catalogExample, catalogExamples} from ${catalogEntry};
const target = document.querySelector<HTMLElement>("#sources")!;
for (const id of CATALOG_EXAMPLE_IDS) {
  const preview = document.createElement("div");
  preview.dataset.previewId = id;
  target.append(preview);
  catalogExample(id, preview);
}
const sourceTarget = document.createElement("section");
sourceTarget.id = "source-manifest";
target.append(sourceTarget);
for (const example of catalogExamples) {
  const node = document.createElement("pre");
  node.dataset.example = example.id;
  node.textContent = example.source;
  sourceTarget.append(node);
}
`,
      );
      await build({
        root: manifestRoot,
        configFile: false,
        logLevel: 'error',
        build: {
          outDir: manifestDist,
          emptyOutDir: true,
          minify: 'oxc',
          rollupOptions: { input: join(manifestRoot, 'index.html') },
        },
      });
      ({ server: manifestServer } = await serve(manifestDist));

      browser = await chromium.launch();
      const manifestPage = await browser.newPage();
      manifestPage.on('pageerror', (error) => manifestFailures.push(error.stack ?? error.message));
      manifestPage.on('console', (message) => {
        if (message.type() === 'error') manifestFailures.push(message.text());
      });
      const manifestAddress = manifestServer.address();
      if (manifestAddress === null || typeof manifestAddress === 'string')
        throw new Error('Manifest server did not expose a port.');
      await manifestPage.goto(`http://127.0.0.1:${manifestAddress.port}/`, { waitUntil: 'networkidle' });
      await manifestPage.waitForFunction(
        (count) =>
          document.querySelectorAll('[data-preview-id] > [data-catalog-example-root]').length === count &&
          [...document.querySelectorAll('[data-preview-id] > [data-catalog-example-root]')].every(
            (root) => root.firstElementChild !== null,
          ),
        CATALOG_EXAMPLE_IDS.length,
      );
      const previewFingerprints = await fingerprints(manifestPage, '[data-preview-id]');
      counts.previews = previewFingerprints.length;
      const builtSources = await manifestPage
        .locator('[data-example]')
        .evaluateAll((nodes) =>
          Object.fromEntries(nodes.map((node) => [node.getAttribute('data-example')!, node.textContent ?? ''])),
        );
      expect(Object.keys(builtSources).sort()).toEqual([...CATALOG_EXAMPLE_IDS].sort());
      expect(builtSources.button).toContain('createCatalogElement<AeliqoButtonElement>');
      expect(Object.values(builtSources).every((source) => !/\bany\b/.test(source))).toBe(true);
      expect(manifestFailures).toEqual([]);

      const tarballs: string[] = [];
      for (const packageName of ['core', 'web'] as const) {
        const packageDirectory = join(workspace, 'packages', packageName);
        const tarball = join(runDirectory, `aeliqo-${packageName}-${releaseVersion}.tgz`);
        run(['pnpm', 'pack', '--out', tarball], packageDirectory);
        const packedManifest = JSON.parse(run(['tar', '-xOf', tarball, 'package/package.json'], workspace)) as {
          name?: string;
          version?: string;
          private?: boolean;
          dependencies?: Record<string, string>;
        };
        expect(packedManifest.name).toBe(`@varendo/${packageName}`);
        expect(packedManifest.version).toBe(releaseVersion);
        expect(packedManifest.private).not.toBe(true);
        expect(JSON.stringify(packedManifest.dependencies ?? {})).not.toContain('workspace:');
        const artifact = await hashFile(tarball);
        tarballArtifacts.push({
          name: packedManifest.name,
          version: packedManifest.version,
          path: tarball.slice(workspace.length + 1),
          ...artifact,
        });
        tarballs.push(tarball);
      }

      await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
      run(
        [
          'npm',
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--save-exact',
          ...tarballs,
          'typescript@7.0.2',
          'vite@8.2.2',
        ],
        consumer,
      );
      const lockPath = join(consumer, 'package-lock.json');
      const lockCopy = join(runDirectory, 'consumer-package-lock.json');
      await copyFile(lockPath, lockCopy);
      lockArtifact = { path: lockCopy.slice(workspace.length + 1), ...(await hashFile(lockCopy)) };
      for (const packageName of ['core', 'web'] as const) {
        const installed = join(consumer, 'node_modules', '@varendo', packageName);
        expect((await lstat(installed)).isSymbolicLink()).toBe(false);
        expect(await realpath(installed)).not.toBe(await realpath(join(workspace, 'packages', packageName)));
      }

      const sourceDirectory = join(consumer, 'src');
      const sourceEvidenceDirectory = join(runDirectory, 'sources');
      await mkdir(sourceDirectory, { recursive: true });
      await mkdir(sourceEvidenceDirectory, { recursive: true });
      const sourceFiles = CATALOG_EXAMPLE_IDS.map((id) => ({ id, file: `${id}.ts` }));
      for (const { id, file } of sourceFiles) {
        const source = `${builtSources[id] ?? ''}\n`;
        await writeFile(join(sourceDirectory, file), source);
        await writeFile(join(sourceEvidenceDirectory, file), source);
        extractedSourceArtifacts.push({
          id,
          path: join(runDirectory, 'sources', file).slice(workspace.length + 1),
          ...(await hashFile(join(sourceEvidenceDirectory, file))),
        });
      }
      counts.manifestSources = Object.keys(builtSources).length;
      await writeFile(
        join(sourceDirectory, 'main.ts'),
        `${sourceFiles.map(({ file }) => `import "./${file}";`).join('\n')}\n`,
      );
      await writeFile(
        join(consumer, 'index.html'),
        '<!doctype html><html lang="en"><body><div id="aeliqo-example"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
      );
      await writeFile(
        join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            skipLibCheck: false,
            noEmit: true,
            lib: ['ES2022', 'DOM'],
          },
          include: ['src/*.ts'],
        }) + '\n',
      );
      run([join(consumer, 'node_modules', '.bin', 'tsc'), '--project', 'tsconfig.json'], consumer);
      run([join(consumer, 'node_modules', '.bin', 'vite'), 'build'], consumer);
      environment = {
        ...environment,
        npm: run(['npm', '--version'], consumer).trim(),
        typescript: run([join(consumer, 'node_modules', '.bin', 'tsc'), '--version'], consumer).trim(),
        vite: run([join(consumer, 'node_modules', '.bin', 'vite'), '--version'], consumer).trim(),
        playwright: JSON.parse(await readFile(join(workspace, 'node_modules/@playwright/test/package.json'), 'utf8'))
          .version,
      };

      const output = join(consumer, 'dist');
      ({ server: consumerServer } = await serve(output));
      const consumerAddress = consumerServer.address();
      if (consumerAddress === null || typeof consumerAddress === 'string')
        throw new Error('Source consumer server did not expose a port.');
      const page = await browser.newPage();
      page.on('pageerror', (error) => consumerFailures.push(error.stack ?? error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consumerFailures.push(message.text());
      });
      await page.goto(`http://127.0.0.1:${consumerAddress.port}/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll('[data-catalog-source-root]').length === count &&
          [...document.querySelectorAll('[data-catalog-source-root]')].every((root) => root.firstElementChild !== null),
        CATALOG_EXAMPLE_IDS.length,
      );
      await page.waitForTimeout(250);
      const sourceFingerprints = await fingerprints(page, '[data-catalog-source-root]');
      counts.sourceRoots = sourceFingerprints.length;
      const mismatches: Array<{
        id: string;
        preview: CatalogFingerprint | undefined;
        source: CatalogFingerprint | undefined;
      }> = [];
      for (const [index, id] of CATALOG_EXAMPLE_IDS.entries()) {
        const preview = previewFingerprints[index];
        const source = sourceFingerprints[index];
        if (JSON.stringify(preview) !== JSON.stringify(source)) mismatches.push({ id, preview, source });
      }
      mismatchCount = mismatches.length;
      expect({ roots: sourceFingerprints.length, failures: consumerFailures, mismatches }).toEqual({
        roots: CATALOG_EXAMPLE_IDS.length,
        failures: [],
        mismatches: [],
      });
      counts.fingerprintsCompared = CATALOG_EXAMPLE_IDS.length;
      counts.tarballs = tarballArtifacts.length;
      counts.extractedSources = extractedSourceArtifacts.length;
      environment = { ...environment, chromium: browser.version() };
      passed = true;
    } catch (error) {
      failure = errorText(error);
      throw error;
    } finally {
      await browser?.close();
      await close(manifestServer);
      await close(consumerServer);
      const candidateAfter = await Promise.all(
        candidatePaths.map(async (file) => ({
          path: file.slice(workspace.length + 1),
          ...(await hashFile(file)),
        })),
      );
      let candidateDigestAfter: string | undefined;
      try {
        candidateDigestAfter = run(['node', 'scripts/source-digest.mjs'], workspace).trim();
      } catch (error) {
        failure ??= `Unable to compute candidate digest after consumer proof: ${errorText(error)}`;
      }
      const beforeByPath = new Map(candidateBefore.map((file) => [file.path, file]));
      const candidateFiles = candidateAfter.map((file) => ({
        ...file,
        beforeSha256: beforeByPath.get(file.path)?.sha256,
        changed: beforeByPath.get(file.path)?.sha256 !== file.sha256,
      }));
      const report = {
        scope:
          'Minified source extraction plus installed @varendo/core and @varendo/web tarballs; strict TypeScript with skipLibCheck false; Chromium mounts all 71 source roots and compares host tag, text, shadow DOM tags, and accessibility semantics against actual catalog previews.',
        candidateDigest: {
          before: candidateDigestBefore,
          after: candidateDigestAfter,
          unchanged: candidateDigestBefore === candidateDigestAfter,
        },
        candidateFiles,
        artifacts: { tarballs: tarballArtifacts, lock: lockArtifact, extractedSources: extractedSourceArtifacts },
        counts: {
          ...counts,
          mismatches: mismatchCount,
          manifestErrors: manifestFailures.length,
          consumerErrors: consumerFailures.length,
        },
        environment,
        passed:
          passed && failure === undefined && candidateDigestBefore === candidateDigestAfter && mismatchCount === 0,
        error: failure,
      };
      await writeFile(join(runDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      await rm(manifestRoot, { recursive: true, force: true });
      await rm(consumer, { recursive: true, force: true });
    }
  }, 180_000);
});
