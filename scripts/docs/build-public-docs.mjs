#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  DOC_ROUTES,
  canonicalDocsPath,
  canonicalizeDocsMarkup,
  docsArtifactPath,
} from '../../docs/public-site/routes.mjs';
import { componentPage, parseAuthoredPage, parseComponentDocument } from './component-documents.mjs';
import { escape, filesAt } from './docs-lib.mjs';
import {
  auditCatalogInventory,
  formatCatalogInventoryReport,
  readCatalogInventoryInputs,
} from './catalog-inventory.mjs';
import { componentApi, loadComponentSources } from './component-api.mjs';
import {
  PUBLIC_DOCS_MANIFEST_SCHEMA,
  PUBLIC_DOCS_SCHEMA,
  assertPublicDocsArtifact,
  assertPublicDocsManifest,
  sha256,
} from './public-docs-contract.mjs';
import { isReleaseVersion, RELEASE_VERSION } from '../release/metadata.mjs';
import { RELEASE_SOURCE_STATUS_ARGS, isReleaseSourceClean } from '../release/source-state.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const arguments_ = process.argv.slice(2);
const outputIndex = arguments_.indexOf('--output');
const revisionIndex = arguments_.indexOf('--source-revision');
const versionIndex = arguments_.indexOf('--version');
const outputRoot = resolve(root, outputIndex === -1 ? 'artifacts/public-docs' : (arguments_[outputIndex + 1] ?? ''));

function command(commandName, args) {
  return execFileAsync(commandName, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const sourceMarker = /<aeliqo-source data-label="([^"]+)" data-path="([^"]+)"><\/aeliqo-source>/gu;
const projectMarker = /<aeliqo-project data-scenario="([^"]+)"><\/aeliqo-project>/gu;

async function hydrateSourceMarkup(markup) {
  const matches = [...markup.matchAll(sourceMarker)];
  if (matches.length === 0) return markup;
  let hydrated = '';
  let cursor = 0;
  for (const match of matches) {
    const [marker, label, path] = match;
    if (match.index === undefined || label === undefined || path === undefined)
      throw new Error('Malformed source marker.');
    if (path.startsWith('/') || path.split('/').includes('..') || !/\.(?:json|mjs|ts|tsx)$/u.test(path))
      throw new Error(`Documentation source path is unsafe: ${path}`);
    const absolute = resolve(root, path);
    const source = await readFile(absolute, 'utf8');
    hydrated += `${markup.slice(cursor, match.index)}<figure class="doc-code" data-source-path="${escape(path)}"><figcaption>${escape(label)} · compiled source</figcaption><pre tabindex="0"><code>${escape(source.trimEnd())}</code></pre></figure>`;
    cursor = match.index + marker.length;
  }
  return hydrated + markup.slice(cursor);
}

async function loadProjectTemplates() {
  const moduleUrl = pathToFileURL(resolve(root, 'apps/site/src/playground/project-template.ts')).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then(({projectFiles})=>process.stdout.write(JSON.stringify(Object.fromEntries(['people','products','support','knowledge'].map(id=>[id,projectFiles(id,${JSON.stringify(RELEASE_VERSION)})])))))`;
  const { stdout } = await command(process.execPath, [
    '--experimental-strip-types',
    '--input-type=module',
    '-e',
    script,
  ]);
  const value = JSON.parse(stdout);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Runnable project templates are unavailable.');
  return value;
}

function hydrateProjectMarkup(markup, projects) {
  return markup.replace(projectMarker, (_marker, scenario) => {
    const files = projects[scenario];
    if (!Array.isArray(files) || files.length === 0)
      throw new Error(`Unknown runnable documentation project ${scenario}.`);
    return files
      .map(({ path, content }) => {
        if (typeof path !== 'string' || typeof content !== 'string')
          throw new Error(`Malformed runnable documentation project ${scenario}.`);
        return `<figure class="doc-code" data-project-scenario="${escape(scenario)}" data-source-path="${escape(path)}"><figcaption>${escape(path)} · compiled export source</figcaption><pre tabindex="0"><code>${escape(content.trimEnd())}</code></pre></figure>`;
      })
      .join('');
  });
}

function classDeclaration(text, name) {
  const start = text.indexOf(`export declare class ${name} `);
  if (start < 0) return undefined;
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`Unclosed declaration ${name}`);
}

export async function loadCanonicalExamples() {
  const moduleUrl = pathToFileURL(resolve(root, 'examples/catalog/index.ts')).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then(({catalogExamples})=>process.stdout.write(JSON.stringify(catalogExamples)))`;
  const loaderDirectory = await mkdtemp(join(tmpdir(), 'aeliqo-catalog-loader-'));
  const loaderPath = join(loaderDirectory, 'loader.mjs');
  try {
    await writeFile(
      loaderPath,
      "export async function resolve(specifier,context,nextResolve){if(context.parentURL?.includes('/examples/catalog/')&&specifier.startsWith('.')&&specifier.endsWith('.js'))return nextResolve(specifier.slice(0,-3)+'.ts',context);return nextResolve(specifier,context);}\n",
      'utf8',
    );
    const { stdout } = await command(process.execPath, [
      '--experimental-strip-types',
      '--experimental-loader',
      loaderPath,
      '--input-type=module',
      '-e',
      script,
    ]);
    const value = JSON.parse(stdout);
    if (
      !Array.isArray(value) ||
      value.some(
        (entry) =>
          entry === null ||
          typeof entry !== 'object' ||
          typeof entry.id !== 'string' ||
          typeof entry.source !== 'string',
      )
    ) {
      throw new Error('Canonical catalog example metadata is unavailable.');
    }
    return value;
  } finally {
    await rm(loaderDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function loadAuthoredPages() {
  const pageFiles = await filesAt(resolve(root, 'docs/site/pages'), (path) => path.endsWith('.md'));
  return Promise.all(
    pageFiles.map(async (path) => parseAuthoredPage(await readFile(path, 'utf8'), relative(root, path))),
  );
}

async function packageVersions(targetVersion) {
  const result = {};
  for (const name of ['agent', 'core', 'react', 'runtime', 'web']) {
    const value = JSON.parse(await readFile(resolve(root, `packages/${name}/package.json`), 'utf8'));
    if (value.version !== RELEASE_VERSION)
      throw new Error(
        `${value.name} source manifest must match release metadata ${RELEASE_VERSION} before release staging.`,
      );
    result[value.name] = targetVersion;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function assertAuthoredPageParity(authoredPages) {
  const generatedRouteIds = new Set(['components', 'search']);
  const expectedPageIds = DOC_ROUTES.filter((route) => !generatedRouteIds.has(route.id))
    .map((route) => route.id)
    .sort();
  const authoredPageIds = authoredPages.map((page) => page.id).sort();
  if (JSON.stringify(authoredPageIds) !== JSON.stringify(expectedPageIds))
    throw new Error('Authored documentation pages and the canonical route manifest are out of sync.');
}

async function loadPublicComponents() {
  const components = JSON.parse(await readFile(resolve(root, 'catalog/components.json'), 'utf8')).components;
  if (!Array.isArray(components) || components.length === 0)
    throw new Error('The public catalog must contain at least one component.');
  return components;
}

async function loadComponentGenerationData() {
  const declarations = await Promise.all(
    (await filesAt(resolve(root, 'packages/web/dist'), (path) => path.endsWith('.d.ts'))).map(async (path) => ({
      path,
      text: await readFile(path, 'utf8'),
    })),
  );
  const componentSources = await loadComponentSources(resolve(root, 'packages/web/src'));
  const canonicalExamples = await loadCanonicalExamples();
  const canonicalById = new Map(canonicalExamples.map((example) => [`${example.family}.${example.id}`, example]));
  const projectTemplates = await loadProjectTemplates();
  return { declarations, componentSources, canonicalById, canonicalExamples, projectTemplates };
}

const releaseStatusMarker = '<aeliqo-release-status></aeliqo-release-status>';

function renderReleaseStatus(body, releaseStatus) {
  const message =
    releaseStatus === 'stable'
      ? `Varendo ${RELEASE_VERSION} is the published stable release. Install all Varendo packages at the same exact version.`
      : `Varendo ${RELEASE_VERSION} is a source candidate. Install the ${RELEASE_VERSION} packages only after registry publication.`;
  return body.replaceAll(releaseStatusMarker, `<p class="release-status-note">${message}</p>`);
}

async function buildAuthoredPageEntries(authoredPages, projectTemplates, releaseStatus) {
  const pages = [];
  for (const page of authoredPages) {
    const path = canonicalDocsPath(page.path);
    if (path === undefined) throw new Error(`Authored documentation page has no canonical route: ${page.path}`);
    const markup = canonicalizeDocsMarkup(page.body);
    pages.push({
      ...page,
      path,
      body: renderReleaseStatus(
        hydrateProjectMarkup(await hydrateSourceMarkup(markup), projectTemplates),
        releaseStatus,
      ),
    });
  }
  return pages;
}

function componentLevel(component) {
  if (component.surfaces.includes('adaptive')) return 'Standard adaptive recipe';
  if (component.surfaces.includes('semantic')) return 'Semantic binding';
  return 'No built-in semantic binding';
}

function componentTag(component) {
  if (component.surfaces.includes('adaptive')) return 'adaptive';
  if (component.surfaces.includes('semantic')) return 'semantic';
  return 'standalone';
}

function componentCatalogPage(components) {
  return {
    id: 'components',
    path: '/components/',
    title: 'Component catalog',
    section: 'Components',
    description: `${components.length} owned components, grouped by purpose.`,
    body: `<p class="lead">Start with the component that serves the task. Every catalog entry works as a standalone web element. Semantic binding is available where the host has a registered adapter; automatic adaptation is limited to standard recipes with compatible task, data, bindings, and policy.</p><p>Each component page shows these three integration levels alongside its live example and generated API facts.</p>${[
      ...new Set(components.map((component) => component.family)),
    ]
      .map(
        (family) =>
          `<h2 id="${family}">${family[0].toUpperCase() + family.slice(1)}</h2><ul class="component-links">${components
            .filter((component) => component.family === family)
            .map(
              (component) =>
                `<li><a href="/components/${component.id}/"><strong>${escape(component.name)}</strong><span class="component-contract">${escape(component.contract)}</span><small data-level="${componentTag(component)}">${componentLevel(component)}</small></a></li>`,
            )
            .join('')}</ul>`,
      )
      .join('')}`,
  };
}

async function buildComponentPages(components, { declarations, componentSources, canonicalById }) {
  const pages = [];
  for (const component of components) {
    const className = `Aeliqo${component.name}Element`;
    const api = declarations.map((source) => classDeclaration(source.text, className)).find(Boolean);
    if (!api) throw new Error(`Missing built public declaration ${className}`);
    const metadata = componentApi(componentSources, className);
    if (!metadata.properties.length) throw new Error(`Missing component source ${className}`);
    const example = canonicalById.get(component.id);
    if (example === undefined) throw new Error(`Missing canonical catalog example ${component.id}`);
    const document = await readFile(resolve(root, 'docs/site/components', `${component.id}.md`), 'utf8');
    const authoredContent = parseComponentDocument(document, component);
    pages.push(componentPage(component, example, metadata, api, authoredContent));
  }
  return pages;
}

function searchPage(searchable) {
  return {
    id: 'search',
    path: '/search/',
    title: 'Search documentation',
    section: 'Documentation',
    description: 'Search Varendo documentation by title, heading, body, API, or diagnostic.',
    body: `<p class="lead">Search is progressively enhanced when JavaScript is available and indexes page body plus headings. Without it, this page remains a browsable list of documentation routes.</p><form class="docs-search-fallback" action="/search/" method="get"><label for="docs-search-fallback-query">Search documentation</label><input id="docs-search-fallback-query" name="q" type="text" inputmode="search" placeholder="API, diagnostic, concept, or integration"><button type="submit">Search</button></form><p class="caption">With JavaScript disabled, use your browser’s Find command on this route list.</p><nav aria-label="Documentation search fallback"><ul class="search-fallback-links">${searchable.map((page) => `<li><a href="${page.path}">${escape(page.title)}</a><span>${escape(page.description)}</span></li>`).join('')}</ul></nav>`,
  };
}

export async function buildPublicPages({ releaseStatus = 'candidate' } = {}) {
  if (releaseStatus !== 'candidate' && releaseStatus !== 'stable')
    throw new Error('Public documentation release status must be candidate or stable.');
  const authoredPages = await loadAuthoredPages();
  assertAuthoredPageParity(authoredPages);
  const components = await loadPublicComponents();
  const generationData = await loadComponentGenerationData();
  const inventoryInputs = await readCatalogInventoryInputs(root);
  const inventory = auditCatalogInventory({
    ...inventoryInputs,
    components,
    examples: generationData.canonicalExamples,
    declarations: generationData.declarations,
  });
  if (!inventory.ok) throw new Error(formatCatalogInventoryReport(inventory));
  const pages = await buildAuthoredPageEntries(authoredPages, generationData.projectTemplates, releaseStatus);
  pages.push(componentCatalogPage(components));
  pages.push(...(await buildComponentPages(components, generationData)));
  pages.push(searchPage(pages));
  return pages;
}

async function sourceInputs() {
  const paths = [
    'docs/public-site/routes.mjs',
    'catalog/components.json',
    'scripts/docs/build-public-docs.mjs',
    'scripts/docs/catalog-inventory.mjs',
    'scripts/docs/check-catalog-inventory.mjs',
    'scripts/docs/component-documents.mjs',
    'scripts/docs/component-api.mjs',
    'scripts/docs/public-docs-contract.mjs',
    'scripts/release/source-state.mjs',
    'apps/site/src/playground/project-template.ts',
  ];
  for (const directory of ['docs/site/pages', 'docs/site/components']) {
    for (const path of await filesAt(resolve(root, directory), (path) => path.endsWith('.md')))
      paths.push(relative(root, path));
  }
  for (const directory of ['examples/quickstart']) {
    for (const path of await filesAt(resolve(root, directory), (path) => /\.(?:json|ts)$/u.test(path)))
      paths.push(relative(root, path));
  }
  for (const name of ['agent', 'core', 'react', 'runtime', 'web']) paths.push(`docs/packages/${name}.md`);
  for (const directory of ['examples/catalog', 'packages/web/src', 'packages/web/dist']) {
    for (const path of await filesAt(resolve(root, directory), (path) => /\.(?:json|ts)$/u.test(path)))
      paths.push(relative(root, path));
  }
  for (const name of ['agent', 'core', 'react', 'runtime', 'web']) paths.push(`packages/${name}/package.json`);
  const unique = [...new Set(paths)].sort();
  return Promise.all(
    unique.map(async (path) => {
      const bytes = await readFile(resolve(root, path));
      return { path, sha256: sha256(bytes), bytes: bytes.byteLength };
    }),
  );
}

async function catalogArtifactFiles() {
  const sourceDirectory = resolve(root, 'examples/catalog');
  const files = await filesAt(sourceDirectory, (path) => path.endsWith('.ts'));
  return Promise.all(
    files.map(async (sourcePath) => {
      const bytes = await readFile(sourcePath);
      return {
        sourcePath,
        path: `catalog-examples/${basename(sourcePath)}`,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      };
    }),
  );
}

async function sourceIdentity() {
  const checkedOutRevision = (await command('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const revision = revisionIndex === -1 ? checkedOutRevision : (arguments_[revisionIndex + 1] ?? '');
  if (!/^[a-f0-9]{40}$/u.test(revision))
    throw new Error('The public docs artifact requires an exact 40-character source revision.');
  try {
    await command('git', ['cat-file', '-e', `${revision}^{commit}`]);
  } catch {
    throw new Error('The public docs artifact source revision must identify a commit in this repository.');
  }
  if (revision !== checkedOutRevision)
    throw new Error('The public docs artifact source revision must match the checked-out HEAD commit.');
  const sourceTree = isReleaseSourceClean((await command('git', RELEASE_SOURCE_STATUS_ARGS)).stdout)
    ? 'clean'
    : 'modified';
  return { source: { repository: 'https://github.com/hermawan22/varendo', revision }, sourceTree };
}

async function main() {
  if (
    (outputIndex !== -1 && !arguments_[outputIndex + 1]) ||
    (revisionIndex !== -1 && !arguments_[revisionIndex + 1]) ||
    (versionIndex !== -1 && !arguments_[versionIndex + 1])
  )
    throw new Error('Missing option value.');
  const unexpected = arguments_.filter(
    (value, index) =>
      !['--output', '--source-revision', '--version'].includes(value) &&
      !['--output', '--source-revision', '--version'].includes(arguments_[index - 1]),
  );
  if (unexpected.length) throw new Error(`Unexpected arguments: ${unexpected.join(', ')}`);
  const docsVersion = versionIndex === -1 ? RELEASE_VERSION : arguments_[versionIndex + 1];
  if (!isReleaseVersion(docsVersion))
    throw new Error(`The public docs artifact must use the ${RELEASE_VERSION} release lineage.`);
  const versions = await packageVersions(docsVersion);
  const { source, sourceTree } = await sourceIdentity();
  const artifact = assertPublicDocsArtifact({
    schema: PUBLIC_DOCS_SCHEMA,
    docsVersion,
    source,
    packageVersions: versions,
    pages: (await buildPublicPages()).map((page) => ({ ...page, path: docsArtifactPath(page.path) })),
  });
  const artifactName = `aeliqo-public-docs-${docsVersion}.json`;
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const catalogFiles = await catalogArtifactFiles();
  const manifest = assertPublicDocsManifest({
    schema: PUBLIC_DOCS_MANIFEST_SCHEMA,
    docsVersion,
    source,
    sourceTree,
    packageVersions: versions,
    artifact: { file: artifactName, sha256: sha256(artifactBytes), bytes: artifactBytes.byteLength },
    catalogFiles: catalogFiles.map(({ path, sha256: digest, bytes }) => ({ path, sha256: digest, bytes })),
    inputs: await sourceInputs(),
  });
  const directory = resolve(outputRoot, docsVersion);
  await mkdir(directory, { recursive: true });
  await mkdir(join(directory, 'catalog-examples'), { recursive: true });
  for (const file of catalogFiles) await copyFile(file.sourcePath, join(directory, file.path));
  await writeFile(join(directory, artifactName), artifactBytes);
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = [
    manifest.artifact,
    ...manifest.catalogFiles.map((file) => ({ file: file.path, sha256: file.sha256 })),
  ]
    .map((file) => `${file.sha256}  ${file.file ?? file.path}`)
    .join('\n');
  await writeFile(join(directory, 'SHA256SUMS'), `${checksums}\n`);
  process.stdout.write(
    `${JSON.stringify({ directory: relative(root, directory), artifact: artifactName, sha256: manifest.artifact.sha256, pages: artifact.pages.length, sourceRevision: source.revision, sourceTree })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
