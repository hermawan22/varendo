import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { COMPONENT_DIRECTIVES, COMPONENT_HEADINGS, parseComponentDocument } from './component-documents.mjs';
import { filesAt } from './docs-lib.mjs';

const componentClass = (component) => `Aeliqo${component.name}Element`;

function unique(values) {
  return [...new Set(values)];
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function declarationMatches(declarations, name) {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`(?:export\\s+)?declare\\s+class\\s+${escaped}\\b`, 'u');
  return declarations.some(({ text }) => pattern.test(text));
}

function headingSet(source) {
  return new Set([...source.matchAll(/^## (.+)$/gmu)].map((match) => match[1]));
}

function repeatsCatalogContract(source, contract) {
  const purpose = source.split(/^## Purpose\r?\n\r?\n/mu)[1]?.split(/^## /mu)[0];
  if (purpose === undefined) return false;
  const normalized = (value) => value.replace(/\s+/gu, ' ').trim();
  return normalized(purpose) === normalized(contract);
}

function auditComponentPage(source, component) {
  const missingSections = [];
  const missingDirectives = [];
  if (source === undefined) {
    return { missingSections, missingDirectives, documentError: undefined, issues: ['missing authored page'] };
  }

  const headings = headingSet(source);
  for (const heading of COMPONENT_HEADINGS) {
    if (!headings.has(heading)) missingSections.push(heading);
  }
  for (const directive of COMPONENT_DIRECTIVES) {
    if (!source.includes(`{{aeliqo:${directive}}}`)) missingDirectives.push(directive);
  }
  let documentError;
  try {
    parseComponentDocument(source, component);
  } catch (error) {
    documentError = error instanceof Error ? error.message : String(error);
  }
  const issues = [];
  if (documentError !== undefined) issues.push(`documentation parser error: ${documentError}`);
  if (missingSections.length > 0) issues.push(`missing sections: ${missingSections.join(', ')}`);
  if (missingDirectives.length > 0) issues.push(`missing directives: ${missingDirectives.join(', ')}`);
  if (repeatsCatalogContract(source, component.contract)) issues.push('Purpose repeats catalog contract');
  return { missingSections, missingDirectives, documentError, issues };
}

function auditComponentExample(example, component) {
  if (example === undefined) return { example: undefined, issues: ['missing runnable example'] };
  const issues = [];
  if (example.family !== component.family)
    issues.push(`example family is ${example.family}, expected ${component.family}`);
  if (typeof example.source !== 'string' || example.source.trim() === '') issues.push('example source is empty');
  return { example: `${example.family}.${example.id}`, issues };
}

function hasPublicExport(exports, id) {
  if (exports === undefined) return false;
  const subpath = id.slice(id.indexOf('.') + 1);
  return Object.hasOwn(exports, `./${subpath}`);
}

function issuesForComponent({ component, pageContents, exampleById, declarations, exports }) {
  const id = component.id;
  const pageName = `${id}.md`;
  const page = auditComponentPage(pageContents.get(pageName), component);
  const example = auditComponentExample(exampleById.get(id), component);
  const issues = [...page.issues, ...example.issues];
  const api = declarationMatches(declarations, componentClass(component));
  if (!api) issues.push(`missing generated declaration ${componentClass(component)}`);
  const publicExport = hasPublicExport(exports, id);
  if (exports !== undefined && !publicExport) issues.push(`missing public export ./${id.slice(id.indexOf('.') + 1)}`);

  return {
    id,
    page: pageName,
    example: example.example,
    api,
    publicExport,
    missingSections: page.missingSections,
    missingDirectives: page.missingDirectives,
    documentError: page.documentError,
    issues,
  };
}

function indexExamples(examples) {
  const exampleEntries = Array.isArray(examples) ? examples : [];
  const exampleIds = exampleEntries
    .map((example) => `${example?.family ?? ''}.${example?.id ?? ''}`)
    .filter((id) => !id.endsWith('.'));
  const exampleById = new Map();
  for (const example of exampleEntries) {
    if (typeof example?.family !== 'string' || typeof example?.id !== 'string') continue;
    exampleById.set(`${example.family}.${example.id}`, example);
  }
  return { exampleIds, exampleById };
}

function inventoryRows(catalogComponents, pageContents, exampleById, declarations, exports) {
  return catalogComponents
    .filter((component) => component !== null && typeof component === 'object' && typeof component.id === 'string')
    .map((component) => issuesForComponent({ component, pageContents, exampleById, declarations, exports }));
}

function globalInventoryIssues({
  components,
  catalogIds,
  duplicateCatalogIds,
  missingPages,
  extraPages,
  duplicateExampleIds,
  missingExamples,
  extraExamples,
}) {
  const issues = [];
  if (!Array.isArray(components)) issues.push('catalog components must be an array');
  if (catalogIds.length === 0) issues.push('catalog contains no active component IDs');
  if (duplicateCatalogIds.length > 0) issues.push(`duplicate catalog IDs: ${duplicateCatalogIds.join(', ')}`);
  if (missingPages.length > 0) issues.push(`missing authored pages: ${missingPages.join(', ')}`);
  if (extraPages.length > 0) issues.push(`stale authored pages: ${extraPages.join(', ')}`);
  if (duplicateExampleIds.length > 0) issues.push(`duplicate runnable examples: ${duplicateExampleIds.join(', ')}`);
  if (missingExamples.length > 0) issues.push(`missing runnable examples: ${missingExamples.join(', ')}`);
  if (extraExamples.length > 0) issues.push(`stale runnable examples: ${extraExamples.join(', ')}`);
  return issues;
}

/**
 * Audit the current catalog against authored pages, executable examples, and built declarations.
 * The returned rows are deliberately machine-readable so docs tests can report one exact component
 * and section instead of reducing the gate to a total count.
 */
export function auditCatalogInventory({ components, pageFiles, pageContents, examples, declarations, exports }) {
  const catalogComponents = Array.isArray(components) ? components : [];
  const catalogIds = catalogComponents.map((component) => component?.id).filter((id) => typeof id === 'string');
  const expectedPageFiles = catalogIds.map((id) => `${id}.md`).sort();
  const actualPageFiles = [...pageFiles].filter((file) => file.endsWith('.md')).sort();
  const expectedExampleIds = catalogIds.slice().sort();
  const { exampleIds, exampleById } = indexExamples(examples);
  const pageSet = new Set(actualPageFiles);
  const safeContents = pageContents instanceof Map ? pageContents : new Map();
  const safeDeclarations = Array.isArray(declarations) ? declarations : [];
  const duplicateCatalogIds = duplicateValues(catalogIds);
  const duplicateExampleIds = duplicateValues(exampleIds);
  const missingPages = expectedPageFiles.filter((file) => !pageSet.has(file));
  const extraPages = actualPageFiles.filter((file) => !expectedPageFiles.includes(file));
  const missingExamples = expectedExampleIds.filter((id) => !exampleById.has(id));
  const extraExamples = exampleIds.filter((id) => !expectedExampleIds.includes(id));
  const rows = inventoryRows(catalogComponents, safeContents, exampleById, safeDeclarations, exports);
  const globalIssues = globalInventoryIssues({
    components,
    catalogIds,
    duplicateCatalogIds,
    missingPages,
    extraPages,
    duplicateExampleIds,
    missingExamples,
    extraExamples,
  });
  const rowIssues = rows.flatMap((row) => row.issues.map((issue) => `${row.id}: ${issue}`));
  return {
    ok: globalIssues.length === 0 && rowIssues.length === 0,
    activeCount: catalogIds.length,
    catalogIds: unique(catalogIds).sort(),
    expectedPageFiles,
    actualPageFiles,
    expectedExampleIds,
    actualExampleIds: unique(exampleIds).sort(),
    missingPages,
    extraPages,
    missingExamples,
    extraExamples,
    duplicateCatalogIds,
    duplicateExampleIds,
    rows,
    issues: [...globalIssues, ...rowIssues],
  };
}

export function formatCatalogInventoryReport(audit) {
  const lines = [
    `Catalog inventory: ${audit.ok ? 'PASS' : 'FAIL'}`,
    `Active catalog IDs: ${audit.activeCount}`,
    `Authored pages: ${audit.actualPageFiles.length}/${audit.expectedPageFiles.length}`,
    `Runnable examples: ${audit.actualExampleIds.length}/${audit.expectedExampleIds.length}`,
    `Per-ID API, section, and directive checks: ${audit.rows.filter((row) => row.issues.length === 0).length}/${audit.rows.length}`,
  ];
  if (audit.issues.length > 0) {
    lines.push('Issues:');
    for (const issue of audit.issues) lines.push(`- ${issue}`);
  } else {
    lines.push(
      'Every active catalog ID has one current page, runnable example, generated declaration, and required documentation coverage.',
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function readCatalogInventoryInputs(rootDirectory) {
  const root = resolve(rootDirectory);
  const catalog = JSON.parse(await readFile(join(root, 'catalog/components.json'), 'utf8'));
  const componentDirectory = join(root, 'docs/site/components');
  const pagePaths = await filesAt(componentDirectory, (path) => path.endsWith('.md'));
  const pageFiles = pagePaths.map((path) => basename(path));
  const pageContents = new Map(
    await Promise.all(pagePaths.map(async (path) => [basename(path), await readFile(path, 'utf8')])),
  );
  const declarationPaths = await filesAt(join(root, 'packages/web/dist'), (path) => path.endsWith('.d.ts')).catch(
    () => [],
  );
  const declarations = await Promise.all(
    declarationPaths.map(async (path) => ({ path, text: await readFile(path, 'utf8') })),
  );
  const webPackage = JSON.parse(await readFile(join(root, 'packages/web/package.json'), 'utf8'));
  return { components: catalog.components, pageFiles, pageContents, declarations, exports: webPackage.exports };
}
