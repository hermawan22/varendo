/** Shared scaffolding for the clean installed-package release consumers. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PUBLIC_PACKAGE_NAMES } from './candidate-lib.mjs';

export const CONSUMER_TOOL_VERSIONS = Object.freeze({
  typescript: '7.0.2',
  '@types/node': '24.13.3',
  '@types/react': '19.2.18',
  '@types/react-dom': '19.2.7',
});

export const CONSUMER_TOOL_SPECS = Object.freeze(
  Object.entries(CONSUMER_TOOL_VERSIONS).map(([name, version]) => `${name}@${version}`),
);

export function exportImportStatement(specifier, index) {
  return specifier.endsWith('.json')
    ? `import Export${index} from ${JSON.stringify(specifier)} with { type: "json" }; export type ExportCheck${index} = typeof Export${index};`
    : `import * as Export${index} from ${JSON.stringify(specifier)}; export type ExportCheck${index} = typeof Export${index};`;
}

export async function writeConsumerTsconfig(directory) {
  await writeFile(
    join(directory, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          resolveJsonModule: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: ['node', 'react', 'react-dom'],
        },
        include: ['exports.ts'],
      },
      null,
      2,
    ) + '\n',
  );
}

export function externalPeerNames(manifest) {
  return Object.keys(manifest.peerDependencies ?? {}).filter((name) => !PUBLIC_PACKAGE_NAMES.includes(name));
}

export function recordLockedPeer(peers, name, version, describeConflict) {
  const previous = peers.get(name);
  if (previous && previous !== version) throw new Error(describeConflict(previous, version));
  peers.set(name, version);
}

export function sortedPeerEntries(peers) {
  return [...peers].sort(([left], [right]) => left.localeCompare(right));
}
