import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { environment } from '../visual/environment.mjs';

const root = process.cwd();
const digest = createHash('sha256');
const paths = [];
for (const directory of ['tests/performance', 'tests/shared', 'scripts/performance', 'scripts/visual']) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name.endsWith('.test.mjs') || ['budget.json', 'baseline.json'].includes(entry.name))
      continue;
    paths.push(join(entry.parentPath, entry.name));
  }
}
for (const path of paths.sort())
  digest
    .update(relative(root, path))
    .update('\0')
    .update(await readFile(path))
    .update('\0');
const { variants: _variants, locale: _locale, timezone: _timezone, ...runner } = await environment(root);
runner.workloads = {
  layout: { locale: 'en-US', timezone: 'UTC', viewport: '1280x720', deviceScaleFactor: 1 },
  visualization: { locale: 'de-DE', timezone: 'Europe/Berlin', viewport: '1440x900', deviceScaleFactor: 1 },
};
if (!process.argv[2]) throw Error('Expected metadata output path');
await writeFile(process.argv[2], JSON.stringify({ workloadSHA: digest.digest('hex'), runner }, null, 2));
