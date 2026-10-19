import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('Pages preparation scopes navigation, assets and redirects without doubling the Vite base', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'varendo-pages-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'index.html'),
    '<a href="/start/">Start</a><a href="//example.com">External</a><img src="/varendo/assets/icon.png"><meta http-equiv="refresh" content="0;url=/start/">',
  );
  await mkdir(join(directory, 'docs/start'), { recursive: true });
  await writeFile(join(directory, 'docs/index.html'), '<h1>Docs</h1>');
  await writeFile(join(directory, 'docs/start/index.html'), '<a href="/start/">Start docs</a>');
  await writeFile(join(directory, 'sitemap-main.xml'), '<urlset><url><loc>home</loc></url></urlset>');
  await writeFile(join(directory, 'sitemap-docs.xml'), '<urlset><url><loc>docs</loc></url></urlset>');
  await writeFile(join(directory, 'robots-docs.txt'), 'Sitemap: sitemap.xml');
  await writeFile(join(directory, 'llms-docs.txt'), '# Docs');
  await writeFile(
    join(directory, 'route-map.json'),
    JSON.stringify({ legacyDocs: { '/connect/mcp/': '/agents/mcp/', '/connect/webmcp/': '/agents/webmcp/' } }),
  );
  execFileSync(process.execPath, [resolve('apps/site/scripts/prepare-pages.mjs'), directory]);
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  assert.match(html, /href="\/varendo\/start\/"/u);
  assert.match(html, /href="\/\/example.com"/u);
  assert.match(html, /src="\/varendo\/assets\/icon.png"/u);
  assert.match(html, /content="0;url=\/varendo\/start\/"/u);
  assert.equal(await readFile(join(directory, '.nojekyll'), 'utf8'), '');
  assert.match(await readFile(join(directory, 'start/index.html'), 'utf8'), /href="\/varendo\/start\/"/u);
  assert.equal(await readFile(join(directory, 'docs/index.html'), 'utf8'), '<h1>Docs</h1>');
  assert.match(await readFile(join(directory, 'index.html'), 'utf8'), /Start<\/a>/u);
  assert.equal(
    await readFile(join(directory, 'sitemap.xml'), 'utf8'),
    '<urlset><url><loc>docs</loc></url><url><loc>home</loc></url></urlset>',
  );
  assert.equal(await readFile(join(directory, 'llms.txt'), 'utf8'), '# Docs');
  assert.match(await readFile(join(directory, 'connect/mcp/index.html'), 'utf8'), /url=\/varendo\/agents\/mcp\//u);
  assert.match(
    await readFile(join(directory, 'connect/webmcp/index.html'), 'utf8'),
    /href="\/varendo\/agents\/webmcp\/"/u,
  );
  const version = JSON.parse(await readFile(join(directory, 'version'), 'utf8'));
  assert.equal(version.product, 'varendo-docs');
  assert.equal(version.version, '0.2.0');
  assert.match(version.sourceRevision, /^[a-f0-9]{40}$/u);
});
