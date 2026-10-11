import { execFileSync } from 'node:child_process';
import { RELEASE_VERSION } from '../../../scripts/release/metadata.mjs';
import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? join(import.meta.dirname, '../dist'));
const base = '/varendo/';
// The self-hosted server mounts dist/docs on a separate host. Pages has one host,
// so expose those route directories beside the landing page, retaining /docs/.
for (const entry of await readdir(join(directory, 'docs'), { withFileTypes: true })) {
  if (entry.name === 'index.html') continue;
  await cp(join(directory, 'docs', entry.name), join(directory, entry.name), { recursive: true });
}
const mainMap = await readFile(join(directory, 'sitemap-main.xml'), 'utf8');
const docsMap = await readFile(join(directory, 'sitemap-docs.xml'), 'utf8');
await writeFile(
  join(directory, 'sitemap.xml'),
  docsMap.replace('</urlset>', `${mainMap.match(/<url>.*<\/url>/u)?.[0] ?? ''}</urlset>`),
);
await cp(join(directory, 'robots-docs.txt'), join(directory, 'robots.txt'));
await cp(join(directory, 'llms-docs.txt'), join(directory, 'llms.txt'));
const routeMap = JSON.parse(await readFile(join(directory, 'route-map.json'), 'utf8'));
for (const [alias, canonical] of Object.entries(routeMap.legacyDocs)) {
  const target = join(directory, alias, 'index.html');
  try {
    await access(target);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const destination = `${base}${canonical === '/' ? 'docs/' : canonical.slice(1)}`;
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(
    target,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Documentation moved — Varendo</title><meta http-equiv="refresh" content="0;url=${destination}"><link rel="canonical" href="https://hermawan22.github.io${destination}"></head><body><p><a href="${destination}">Continue to the documentation</a></p></body></html>`,
  );
}
const repository = resolve(import.meta.dirname, '../../..');
const git = (arguments_) => execFileSync('git', arguments_, { cwd: repository, encoding: 'utf8' }).trim();
await writeFile(
  join(directory, 'version'),
  `${JSON.stringify({
    product: 'varendo-docs',
    version: RELEASE_VERSION,
    sourceRevision: git(['rev-parse', 'HEAD']),
    sourceTree: git(['status', '--porcelain=v1', '--untracked-files=all']) === '' ? 'clean' : 'modified',
  })}\n`,
);
const entries = await readdir(directory, { recursive: true, withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
  const path = join(entry.parentPath, entry.name);
  const html = await readFile(path, 'utf8');
  const rewritten = html
    .replace(/(\b(?:href|src|action)=["'])\/(?!\/|varendo(?:\/|["']))/gu, `$1${base}`)
    .replace(/(content=["']\d+;\s*url=)\/(?!\/|varendo\/)/giu, `$1${base}`);
  await writeFile(path, rewritten);
}
await writeFile(join(directory, '.nojekyll'), '');
console.log(`Prepared GitHub Pages assets, documentation routes and crawlers under ${base}.`);
