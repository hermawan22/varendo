import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = await readFile(new URL('../../.github/workflows/pages.yml', import.meta.url), 'utf8');
const stepName = 'Verify published packages and exported projects';

function exportGateScript() {
  const start = workflow.indexOf(`- name: ${stepName}`);
  assert.notEqual(start, -1, 'Pages must verify registry exports before enabling downloads');
  const run = workflow.indexOf('        run: |\n', start);
  assert.notEqual(run, -1, 'The Pages export gate must execute a shell script');
  const body = [];
  for (const line of workflow.slice(run + '        run: |\n'.length).split('\n')) {
    if (line && !line.startsWith('          ')) break;
    body.push(line.startsWith('          ') ? line.slice(10) : line);
  }
  return body.join('\n');
}

async function runExportGate(metadata, verifierExit = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'varendo-pages-policy-'));
  try {
    const environmentPath = join(directory, 'github-env');
    const invocationPath = join(directory, 'invocation.json');
    const nodePath = join(directory, 'node');
    await writeFile(join(directory, 'release-metadata.json'), JSON.stringify(metadata));
    await writeFile(environmentPath, '');
    await writeFile(
      nodePath,
      `#!${process.execPath}\n` +
        `const fs = require('node:fs');\n` +
        `if (fs.readFileSync(process.env.GITHUB_ENV, 'utf8').includes('AELIQO_EXPORT_VERIFIED_VERSION=')) process.exit(86);\n` +
        `fs.writeFileSync(process.env.INVOCATION_PATH, JSON.stringify(process.argv.slice(2)));\n` +
        `process.exit(Number(process.env.VERIFIER_EXIT));\n`,
    );
    await chmod(nodePath, 0o700);
    const result = spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', exportGateScript()], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_ENV: environmentPath,
        SOURCE_SHA: 'b'.repeat(40),
        INVOCATION_PATH: invocationPath,
        VERIFIER_EXIT: String(verifierExit),
      },
    });
    const invocation = await readFile(invocationPath, 'utf8')
      .then(JSON.parse)
      .catch(() => undefined);
    return { ...result, invocation, environment: await readFile(environmentPath, 'utf8') };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('candidate Pages builds keep downloads disabled without registry verification', async () => {
  const result = await runExportGate({ version: '0.1.0', status: 'candidate' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.invocation, undefined);
  assert.equal(result.environment, '');
});

test('stable Pages enables downloads only after verifying the selected checkout', async () => {
  const result = await runExportGate({ version: '0.1.0', status: 'stable' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.invocation, [
    '--experimental-strip-types',
    'scripts/release/verify-export-registry.mjs',
    '--version',
    '0.1.0',
    '--source',
    'b'.repeat(40),
    '--output',
    'artifacts/pages-release-policy/export-consumer.json',
  ]);
  assert.equal(result.environment, 'AELIQO_EXPORT_VERIFIED_VERSION=0.1.0\n');
});

test('a failed registry export verifier cannot enable Pages downloads', async () => {
  const result = await runExportGate({ version: '0.1.0', status: 'stable' }, 1);
  assert.notEqual(result.status, 0);
  assert.ok(result.invocation);
  assert.equal(result.environment, '');
});

test('malformed release metadata fails before verification or enabling downloads', async () => {
  for (const metadata of [
    { version: '0.1.0-rc.2', status: 'stable' },
    { version: '0.1.0', status: 'published-maybe' },
    { version: '0.1.0' },
    { status: 'stable' },
  ]) {
    const result = await runExportGate(metadata);
    assert.notEqual(result.status, 0, JSON.stringify(metadata));
    assert.equal(result.invocation, undefined);
    assert.equal(result.environment, '');
  }
});

test('Pages verification stays bound to the checked-out source and gates artifact deployment', () => {
  const gate = workflow.indexOf(`- name: ${stepName}`);
  const build = workflow.indexOf('- name: Build Pages');
  const upload = workflow.indexOf('- uses: actions/upload-pages-artifact@');
  assert.ok(gate >= 0 && gate < build && build < upload);
  assert.match(workflow.slice(gate, build), /SOURCE_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
  assert.doesNotMatch(workflow.slice(gate, upload), /continue-on-error:|if: always\(\)/);
  assert.match(workflow, /^permissions:\n  contents: read\n  actions: read$/m);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\n  deploy:')), /id-token: write|secrets\./);
});
