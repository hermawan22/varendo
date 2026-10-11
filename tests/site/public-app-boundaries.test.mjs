import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');

test('one public site owns the complete static route set', async () => {
  const { generatePages, generatedRoot } = await import('../../apps/site/generate-pages.mjs');
  const inputs = await generatePages();
  const relativeInputs = inputs.map((path) => path.slice(generatedRoot.length));

  assert.ok(relativeInputs.includes('/index.html'), 'site owns the public root');
  assert.ok(relativeInputs.includes('/docs/index.html'), 'site owns the documentation root');
  assert.ok(relativeInputs.includes('/playground/index.html'), 'site owns the playground route');
  assert.ok(
    relativeInputs.includes('/docs/components/data.table/index.html'),
    'generated component docs remain complete',
  );
  const componentPages = relativeInputs.filter(
    (path) =>
      path.startsWith('/docs/components/') && path.endsWith('/index.html') && path !== '/docs/components/index.html',
  );
  assert.equal(componentPages.length, 71);
  assert.equal(new Set(relativeInputs).size, relativeInputs.length);

  await access(resolve(root, 'apps/site/index.html'));
  await access(resolve(root, 'apps/site/src/docs.ts'));
  await access(resolve(root, 'apps/site/src/playground/playground.ts'));
  await access(resolve(root, 'apps/site/runner/server.mjs'));
  const assembly = JSON.parse(await readFile(resolve(root, 'apps/site/package.json'), 'utf8'));
  assert.equal(assembly.name, '@varendo/site');
});

test('the deployable site mounts docs and playground as internal routes', async () => {
  const source = await readFile(resolve(root, 'apps/site/src/site.ts'), 'utf8');
  assert.match(source, /\/docs-src\/docs\.js/);
  assert.match(source, /\/playground-src\/playground\.js/);
});
