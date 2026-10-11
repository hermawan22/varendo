/** Verify public package roots and every component subpath from clean local tarball consumers. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASE_VERSION } from '../../scripts/release/metadata.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidenceRoot = join(root, 'artifacts/export-consumers');
await mkdir(evidenceRoot, { recursive: true });
const evidenceDirectory = await mkdtemp(join(evidenceRoot, 'run-'));
const consumerRoot = await mkdtemp(join(tmpdir(), 'aeliqo-export-consumers-'));

function run(command, args, cwd, timeout = 300_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout;
}

const tarballs = {};
for (const name of ['core', 'runtime', 'web', 'react', 'agent']) {
  const packageDirectory = join(root, 'packages', name);
  run('pnpm', ['build'], packageDirectory);
  const tarball = join(evidenceDirectory, `aeliqo-${name}-${RELEASE_VERSION}.tgz`);
  run('pnpm', ['pack', '--out', tarball], packageDirectory);
  tarballs[`@varendo/${name}`] = tarball;
}

const catalog = JSON.parse(await readFile(join(root, 'catalog/components.json'), 'utf8')).components;
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const componentConsumer = join(consumerRoot, 'component-subpaths');
await mkdir(componentConsumer, { recursive: true });
const componentTypeImports = catalog.map((component) => {
  const className = `Aeliqo${component.name.replace(/[^A-Za-z0-9]+(.)/gu, (_match, letter) => letter.toUpperCase())}Element`;
  const subpath = component.id.slice(component.id.indexOf('.') + 1);
  return { className, subpath };
});
await writeFile(
  join(componentConsumer, 'package.json'),
  `${JSON.stringify(
    {
      name: 'aeliqo-component-subpath-consumer',
      private: true,
      type: 'module',
      dependencies: {
        ...Object.fromEntries(Object.entries(tarballs).map(([name, tarball]) => [name, `file:${tarball}`])),
        react: '19.2.8',
        'react-dom': '19.2.8',
        '@types/react': '19.2.18',
        '@types/react-dom': '19.2.7',
        typescript: rootManifest.devDependencies.typescript,
      },
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(componentConsumer, 'components.ts'),
  [
    `import { registerAeliqoElements } from '@varendo/web';`,
    ...componentTypeImports.map(
      ({ className, subpath }) => `import type { ${className} } from '@varendo/web/${subpath}';`,
    ),
    '',
    'export const register = registerAeliqoElements;',
    `export type DocumentedComponents = [${componentTypeImports.map(({ className }) => className).join(', ')}];`,
  ].join('\n'),
);
await writeFile(
  join(componentConsumer, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ['ES2022', 'DOM'],
      },
      include: ['components.ts'],
    },
    null,
    2,
  )}\n`,
);
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], componentConsumer);
run(
  process.execPath,
  [join(componentConsumer, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
  componentConsumer,
);

const rootApiConsumer = join(consumerRoot, 'public-root-api');
await mkdir(rootApiConsumer, { recursive: true });
await writeFile(
  join(rootApiConsumer, 'package.json'),
  `${JSON.stringify(
    {
      name: 'aeliqo-public-root-api-consumer',
      private: true,
      type: 'module',
      dependencies: {
        ...Object.fromEntries(Object.entries(tarballs).map(([name, tarball]) => [name, `file:${tarball}`])),
        react: '19.2.8',
        'react-dom': '19.2.8',
        '@types/react': '19.2.18',
        '@types/react-dom': '19.2.7',
        typescript: rootManifest.devDependencies.typescript,
      },
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(rootApiConsumer, 'public-api.ts'),
  `import { compileIntent, defineResource, parseCatalog } from '@varendo/core';
import type { Catalog, Intent, Task } from '@varendo/core';
import { createAeliqoRuntime } from '@varendo/runtime';
import type { AeliqoRuntimeOptions } from '@varendo/runtime';
import { createAeliqoApp } from '@varendo/web/app';
import { defineRecipe, registerAeliqoElements, standardDataRecipe } from '@varendo/web';
import type { AeliqoApp } from '@varendo/web/app';
import type { RecipeDefinition } from '@varendo/web';
import { AeliqoProvider, AeliqoRegion, registerAeliqoReactElements, useAeliqoApp, useAeliqoRegionState, useAeliqoRender } from '@varendo/react';
import type { AeliqoProviderProps, AeliqoRegionProps } from '@varendo/react';
import { createAppToolEndpoint } from '@varendo/agent';

export const publicApi = [
  compileIntent, defineResource, parseCatalog, createAeliqoRuntime,
  createAeliqoApp, defineRecipe, registerAeliqoElements, standardDataRecipe,
  AeliqoProvider, AeliqoRegion, registerAeliqoReactElements,
  useAeliqoApp, useAeliqoRegionState, useAeliqoRender, createAppToolEndpoint,
];

export type PublicApiContracts = [
  Catalog, Intent, Task, AeliqoRuntimeOptions, AeliqoApp, RecipeDefinition,
  AeliqoProviderProps, AeliqoRegionProps,
];
`,
);
await writeFile(
  join(rootApiConsumer, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: ['react', 'react-dom'],
      },
      files: ['public-api.ts'],
    },
    null,
    2,
  )}\n`,
);
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], rootApiConsumer);
run(
  process.execPath,
  [join(rootApiConsumer, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
  rootApiConsumer,
);
await writeFile(
  join(rootApiConsumer, 'public-api.mjs'),
  `import assert from 'node:assert/strict';
const [core, runtime, web, webApp, react, agent] = await Promise.all([
  import('@varendo/core'), import('@varendo/runtime'), import('@varendo/web'),
  import('@varendo/web/app'), import('@varendo/react'), import('@varendo/agent'),
]);
assert.equal(typeof core.defineResource, 'function');
assert.equal(typeof core.compileIntent, 'function');
assert.equal(typeof core.parseCatalog, 'function');
assert.equal(typeof runtime.createAeliqoRuntime, 'function');
assert.equal(typeof webApp.createAeliqoApp, 'function');
assert.equal(typeof web.defineRecipe, 'function');
assert.equal(typeof web.standardDataRecipe, 'object');
assert.equal(web.standardDataRecipe.ref.id, 'aeliqo.recipe.data');
assert.equal(typeof web.registerAeliqoElements, 'function');
assert.equal(typeof react.AeliqoProvider, 'function');
assert.equal(typeof react.AeliqoRegion, 'function');
assert.equal(typeof react.registerAeliqoReactElements, 'function');
assert.equal(typeof react.useAeliqoRender, 'function');
assert.equal(typeof agent.createAppToolEndpoint, 'function');
assert.equal('AeliqoInput' in react, false);
assert.equal('AeliqoChart' in react, false);
assert.equal('AeliqoTextField' in react, false);
assert.equal('AeliqoTable' in react, false);
assert.equal(typeof window, 'undefined');
process.stdout.write('All five clean tarball package roots import without a browser.\\n');
`,
);
run(process.execPath, ['public-api.mjs'], rootApiConsumer);

const templateModule = pathToFileURL(join(root, 'apps/site/src/playground/project-template.ts')).href;
const templateScript = `import(${JSON.stringify(templateModule)}).then(({projectFiles})=>process.stdout.write(JSON.stringify(Object.fromEntries(['people','products','support','knowledge'].map(id=>[id,projectFiles(id,${JSON.stringify(RELEASE_VERSION)})])))))`;
const projects = JSON.parse(
  run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', templateScript], root),
);
const reports = [];

for (const scenario of ['people', 'products', 'support', 'knowledge']) {
  const directory = join(consumerRoot, scenario);
  await mkdir(directory, { recursive: true });
  const files = projects[scenario];
  assert(Array.isArray(files) && files.length > 0, `Missing ${scenario} project files`);
  for (const file of files) {
    const path = join(directory, file.path);
    await mkdir(resolve(path, '..'), { recursive: true });
    if (file.path === 'package.json') {
      const manifest = JSON.parse(file.content);
      for (const name of Object.keys(manifest.dependencies)) {
        const tarball = tarballs[name];
        if (tarball !== undefined) manifest.dependencies[name] = `file:${tarball}`;
      }
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    } else await writeFile(path, file.content);
  }
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
  run('npm', ['run', 'build'], directory);
  const html = await readFile(join(directory, 'dist/index.html'), 'utf8');
  assert.match(html, /src="\/assets\/[^"/]+\.js"/u, `${scenario} export has no browser bundle`);
  reports.push({ scenario, files: files.length, built: true });
}

await writeFile(
  join(evidenceDirectory, 'report.json'),
  `${JSON.stringify({ version: RELEASE_VERSION, componentSubpaths: componentTypeImports.length, source: 'playground-project-template', reports }, null, 2)}\n`,
);
await rm(consumerRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ evidenceDirectory, reports })}\n`);
