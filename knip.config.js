import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(repositoryRoot, 'packages');

function exportTargets(value, targets = []) {
  if (typeof value === 'string') {
    if (value.startsWith('./dist/')) targets.push(value);
    return targets;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) exportTargets(item, targets);
  }
  return targets;
}

function sourceEntry(target, packageDirectory) {
  const declaration = target.endsWith('.d.ts');
  const javascript = target.endsWith('.js');
  if (!declaration && !javascript) return undefined;

  const stem = target.slice('./dist/'.length, declaration ? -'.d.ts'.length : -'.js'.length);
  const candidates = ['.ts', '.tsx', '.mts', '.js', '.mjs'].map((extension) => `src/${stem}${extension}`);
  const source = candidates.find((candidate) => existsSync(join(packageDirectory, candidate)));
  if (source === undefined) throw new Error(`Public export ${target} has no source file in ${packageDirectory}.`);
  return source;
}

function packageWorkspace(directoryName) {
  const directory = join(packageRoot, directoryName);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  for (const target of exportTargets(manifest.exports)) sourceEntry(target, directory);
  return [relative(repositoryRoot, directory), { project: ['src/**/*.{ts,tsx,js,mjs}'] }];
}

const packageWorkspaces = Object.fromEntries(
  readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packageRoot, entry.name, 'package.json')))
    .map((entry) => packageWorkspace(entry.name)),
);

export default {
  treatConfigHintsAsErrors: true,
  ignoreBinaries: ['go', 'build'],
  // These files are copied into isolated tarball consumers by executable tests;
  // they are intentionally not imported by the workspace source graph.
  ignoreFiles: [
    '**/*.fixture.*',
    'tests/release/fixtures/legacy-usage.ts',
    'tests/release/fixtures/no-agent-forbidden.mjs',
    'tests/release/fixtures/vnext-entries.tsx',
    'tests/consumers/adaptation-registered-bar.mjs',
  ],
  ignoreIssues: {
    // T01 intentionally freezes a declaration-only public surface and complete
    // consumer probes before the matching production modules land.
    'tests/vnext/api-contract.ts': ['exports', 'types'],
    'tests/vnext/types/advanced.tsx': ['exports', 'types'],
    'tests/**/fixtures/**': ['exports', 'types'],
    'tests/**/fixtures.{ts,tsx,js,mjs}': ['exports', 'types'],
    'tests/**/fixture.{ts,tsx,js,mjs}': ['exports', 'types'],
    'tests/**/*-fixture.{ts,tsx,js,mjs}': ['exports', 'types'],
    'tests/**/*fixture.{ts,tsx,js,mjs}': ['exports', 'types'],
    'fixtures/**/*.ts': ['exports', 'types'],
  },
  workspaces: {
    '.': {
      entry: [
        'scripts/check-dco.mjs',
        'scripts/source-digest.mjs',
        'docs/public-site/routes.mjs',
        'examples/framework-recipes.ts',
        'examples/quickstart.mjs',
        'tests/**/browser.ts',
        'tests/vertical-slice/web/app-lifecycle.ts',
        'tests/**/semantic-browser.ts',
        'tests/**/cartesian-browser.ts',
        'tests/**/temporal-browser.ts',
        'tests/**/negative-types.ts',
        'tests/**/vitest.config.mjs',
        'tests/**/playwright.config.mjs',
        'tests/**/*.playwright.config.mjs',
        'tests/**/vite.config.mjs',
        'tests/**/*.vite.config.mjs',
        'tests/**/server.mjs',
        'tests/**/*-child.mjs',
        'tests/agent-evaluation/runner.ts',
        'tests/agent-evaluation/live-browser/browser.mjs',
        'tests/agent-evaluation/ui-development/host.ts',
        'tests/performance/adverse-visualization.ts',
        'tests/performance/perceived-input.ts',
        'tests/performance/standalone.ts',
        'tests/security/testkit-consumer.mjs',
        'tests/visual/catalog.ts',
        'tests/design/controls.ts',
        'tests/runtime-presentation/browser/app-resize.ts',
        'tests/runtime-presentation/browser/app-draft-exit.ts',
        'tests/runtime-presentation/browser/app-transaction.ts',
        'tests/runtime-presentation/browser/app-registration.ts',
        'tests/runtime-presentation/browser/app-continuity.ts',
        'tests/runtime-presentation/browser/atomic-review.ts',
        'scripts/visual/describe.mjs',
        'scripts/performance/describe.mjs',
        'tests/runtime-presentation/browser/layout-review.ts',
        'tests/**/*.spec.{ts,tsx,js,mjs}',
        'tests/**/*.test.{ts,tsx,js,mjs}',
      ],
      project: ['scripts/**/*.{mjs,js,ts}', 'tests/**/*.{ts,tsx,mjs}', 'docs/public-site/**/*.mjs'],
    },
    ...packageWorkspaces,
    'apps/site': {
      entry: [
        'src/playground/playground.ts',
        'tests/**/*.spec.{ts,tsx,js,mjs}',
        'tests/**/*.test.{ts,tsx,js,mjs}',
        'tests/**/*.playwright.config.mjs',
        'tests/**/vitest.config.mjs',
      ],
      project: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx,mjs}'],
    },
    'examples/catalog': {
      entry: ['index.ts'],
      project: ['**/*.ts'],
    },
    'examples/platform': {
      entry: ['src/design.ts', 'src/react.tsx', 'src/vue.ts', 'src/hydrate.ts'],
      project: ['src/**/*.{ts,tsx}', '*.mjs'],
      vue: false,
    },
    'examples/quickstart': {
      entry: ['src/app.ts', 'src/PeopleTutorial.tsx', 'src/agent.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'examples/vertical-slice': {
      entry: ['src/ssr.ts', 'src/ssr-client.ts'],
      project: ['src/**/*.{ts,tsx,mjs}'],
    },
    'examples/next-platform': {
      entry: ['app/adaptive-people.tsx', 'app/hydrate.tsx'],
      project: ['app/**/*.{ts,tsx}', '*.mjs'],
    },
    'examples/reference-host': {
      project: ['*.mjs'],
    },
  },
};
