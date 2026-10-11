/** Build the exact maintained sources and entry snippets exposed by the framework guide. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export async function stageAuthoredGuides(root, consumer, run) {
  const guide = await readFile(join(root, 'docs/site/pages/frameworks.md'), 'utf8');
  const blocks = [...guide.matchAll(/```(tsx|ts)\n([\s\S]*?)\n```/gu)];
  assert.deepEqual(
    blocks.map((block) => block[1]),
    ['tsx', 'ts', 'ts'],
  );
  const tutorial = await readFile(join(root, 'docs/site/pages/registered-app.md'), 'utf8');
  const paths = [...tutorial.matchAll(/<aeliqo-source data-label="([^"]+)" data-path="([^"]+)"/gu)];
  const entrypoints = [];
  for (const [index, host] of ['react', 'vanilla', 'vue'].entries()) {
    const dir = join(consumer, 'guides', host);
    await mkdir(join(dir, 'src'), { recursive: true });
    for (const [name, file] of [
      ['app.ts', 'examples/quickstart/src/app.ts'],
      ['PeopleTutorial.tsx', 'examples/quickstart/src/PeopleTutorial.tsx'],
    ]) {
      assert(paths.some((path) => path[1] === `src/${name}` && path[2] === file));
      await writeFile(join(dir, 'src', name), await readFile(join(root, file)));
    }
    const entry = host === 'react' ? 'main.tsx' : 'main.ts';
    await writeFile(join(dir, 'src', entry), `${blocks[index][2]}\n`);
    await writeFile(
      join(dir, 'index.html'),
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>${host} guide</title><div id="${host === 'react' ? 'root' : 'app'}"></div><script type="module" src="./src/${entry}"></script></html>`,
    );
    entrypoints.push(`guides/${host}/index.html`);
  }
  await writeFile(
    join(consumer, 'guides/tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        jsx: 'react-jsx',
        noEmit: true,
        types: ['vite/client', 'react'],
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      },
      include: ['./*/src/*.ts', './*/src/*.tsx'],
    }),
  );
  run([join(consumer, 'node_modules/.bin/tsc'), '-p', 'guides/tsconfig.json'], consumer);
  return entrypoints;
}

export async function verifyAuthoredGuides(page, origin, runDirectory) {
  for (const host of ['react', 'vanilla', 'vue']) {
    await page.goto(`${origin}/guides/${host}/index.html`);
    const region = page.locator('aeliqo-region');
    await expect(region).toContainText('Ada Chen');
    await expect(region).toContainText('Sam Rivera');
    if (host === 'react') {
      await page.getByRole('button', { name: 'Engineering', exact: true }).click();
      await expect(region).not.toContainText('Ada Chen');
      await expect(region).toContainText('Sam Rivera');
      await page.getByRole('button', { name: 'All employees', exact: true }).click();
      await expect(region).toContainText('Ada Chen');
    }
    if (host === 'vue') await expect(page.getByRole('status')).toHaveText('renderer-ready');
    await page.screenshot({ path: join(runDirectory, `authored-${host}.png`), fullPage: true });
  }
}
