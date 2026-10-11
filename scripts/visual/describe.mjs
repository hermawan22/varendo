import { writeFile } from 'node:fs/promises';
import { environment, fixtureDigest } from './environment.mjs';
if (!process.argv[2]) throw Error('Expected metadata output path');
await writeFile(
  process.argv[2],
  JSON.stringify(
    {
      fixtureSHA: await fixtureDigest(process.cwd()),
      runner: await environment(process.cwd()),
    },
    null,
    2,
  ),
);
