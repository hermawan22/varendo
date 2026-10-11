import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import { output } from './process.mjs';

async function files(directory) {
  const result = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries) {
    if (['node_modules', 'dist', 'artifacts', '.git', '.DS_Store'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function digestFiles(paths, name) {
  const digest = createHash('sha256');
  for (const path of paths) {
    digest.update(name(path));
    digest.update('\0');
    digest.update(await readFile(path));
    digest.update('\0');
  }
  return digest.digest('hex');
}

export async function fixtureDigest(root) {
  const paths = [];
  for (const directory of ['tests/visual', 'tests/shared', 'examples/catalog', 'scripts/visual']) {
    paths.push(
      ...(await files(join(root, directory))).filter(
        (path) => !path.endsWith('.test.mjs') && path !== join(root, 'scripts/visual/baseline.json'),
      ),
    );
  }
  paths.push(join(root, 'catalog/components.json'));
  return digestFiles(paths.sort(), (path) => relative(root, path));
}

async function fonts() {
  const defaults =
    process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library/Fonts')]
      : [
          '/usr/share/fonts',
          '/usr/local/share/fonts',
          join(homedir(), '.fonts'),
          join(homedir(), '.local/share/fonts'),
        ];
  const directories = process.env.AELIQO_VISUAL_FONT_DIRS?.split(delimiter) ?? defaults;
  const paths = [];
  for (const directory of directories)
    paths.push(...(await files(directory)).filter((path) => /\.(ttf|otf|ttc|woff2?)$/iu.test(path)));
  if (!paths.length) throw Error('No font files inventoried');
  return { sha256: await digestFiles(paths.sort(), (path) => path), files: paths.length, directories };
}

export async function environment(root) {
  const browsers = {};
  for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await launcher.launch();
    try {
      browsers[name] = {
        version: browser.version(),
        executableSHA: await digestFiles([launcher.executablePath()], () => name),
      };
    } finally {
      await browser.close();
    }
  }
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return {
    ...runnerIdentity(process.env),
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    pnpm: output(root, 'pnpm', ['--version']),
    playwright: manifest.devDependencies['@playwright/test'],
    browsers,
    fonts: await fonts(),
    locale: 'en-US',
    timezone: 'UTC',
    deviceScaleFactor: 1,
    variants: ['1440x900/light/ltr', '768x900/light/ltr', '360x800/dark/rtl/200%-text'],
  };
}

export function runnerIdentity(env) {
  const container = env.AELIQO_VISUAL_CONTAINER_DIGEST ?? null;
  return {
    container,
    hostImage:
      !container && env.GITHUB_ACTIONS === 'true'
        ? { provider: 'github-actions', os: env.ImageOS ?? null, version: env.ImageVersion ?? null }
        : null,
  };
}
