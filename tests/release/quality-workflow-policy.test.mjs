import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../../.github/workflows/quality.yml', import.meta.url);
const workflow = await readFile(workflowPath, 'utf8');
const releaseWorkflow = await readFile(new URL('../../.github/workflows/release-publish.yml', import.meta.url), 'utf8');
const qualityCommands = JSON.parse(await readFile(new URL('../../quality/commands.json', import.meta.url), 'utf8'));
const policyName = 'Enforce owner-dispatched main or exact candidate source';

function policyScript() {
  const start = workflow.indexOf(`- name: ${policyName}`);
  assert.notEqual(start, -1, 'quality workflow must contain the source policy step');
  const run = workflow.indexOf('      run: |\n', start);
  assert.notEqual(run, -1, 'source policy step must contain a shell script');
  const lines = workflow.slice(run + '      run: |\n'.length).split('\n');
  const body = [];
  for (const line of lines) {
    if (line && !line.startsWith('        ')) break;
    body.push(line.startsWith('        ') ? line.slice(8) : line);
  }
  return body.join('\n');
}

function runPolicy(overrides = {}) {
  return spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', policyScript()], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      EVENT_NAME: 'workflow_dispatch',
      REPOSITORY: 'hermawan22/varendo',
      ACTOR: 'hermawan22',
      TRIGGERING_ACTOR: 'hermawan22',
      SOURCE_REF: 'refs/heads/main',
      SOURCE_SHA: 'a'.repeat(40),
      EXPECTED_SOURCE_SHA: '',
      ...overrides,
    },
  });
}

test('quality policy accepts automatic main and pull-request checks plus an exact release candidate', () => {
  assert.equal(runPolicy({ EVENT_NAME: 'push' }).status, 0);
  assert.equal(
    runPolicy({
      EVENT_NAME: 'pull_request',
      SOURCE_REF: 'refs/pull/14/merge',
      SOURCE_SHA: 'b'.repeat(40),
      EXPECTED_SOURCE_SHA: '',
      ACTOR: 'contributor',
      TRIGGERING_ACTOR: 'contributor',
    }).status,
    0,
  );
  assert.equal(runPolicy().status, 0);
  assert.equal(
    runPolicy({
      SOURCE_REF: 'refs/heads/release/quality-candidate',
      SOURCE_SHA: 'b'.repeat(40),
      EXPECTED_SOURCE_SHA: 'b'.repeat(40),
    }).status,
    0,
  );
});

test('quality dispatch rejects a wrong actor and a fork', () => {
  assert.notEqual(runPolicy({ ACTOR: 'someone-else' }).status, 0);
  assert.notEqual(runPolicy({ TRIGGERING_ACTOR: 'someone-else' }).status, 0);
  assert.notEqual(runPolicy({ REPOSITORY: 'someone/varendo' }).status, 0);
});

test('quality dispatch rejects wrong and malformed candidate SHAs', () => {
  const candidate = { SOURCE_REF: 'refs/heads/release/candidate', SOURCE_SHA: 'c'.repeat(40) };
  assert.notEqual(runPolicy({ ...candidate, EXPECTED_SOURCE_SHA: 'd'.repeat(40) }).status, 0);
  assert.notEqual(runPolicy({ ...candidate, EXPECTED_SOURCE_SHA: 'not-a-sha' }).status, 0);
});

test('quality dispatch retains the workflow trust and release boundaries', () => {
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /ref: \$\{\{ env\.SOURCE_SHA \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /run: python3 scripts\/quality\.py --shard \$\{\{ matrix\.shard \}\} --shards 4/);
  assert.match(workflow, /shard: \[0, 1, 2, 3\]/);
  assert.match(
    workflow,
    /- name: Run required functional, security, browser, and package checks\n\s+if: needs\.scope\.outputs\.mode == 'full'\n\s+run: python3 scripts\/quality\.py --merge 4/,
  );
  assert.match(workflow, /name: varendo-quality-evidence-\$\{\{ env\.SOURCE_SHA \}\}/);
  assert.match(workflow, /artifacts\/product-ci/);
  assert.match(workflow, /artifacts\/performance-bundles/);
  assert.ok(
    qualityCommands.commands.some(
      ({ kind, argv }) => kind === 'performance' && argv.join(' ') === 'pnpm test:performance:bundles',
    ),
    'release quality must run the deterministic installed-tarball bundle budget gate',
  );
  assert.match(releaseWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(releaseWorkflow, /head_sha == \$sha/);
  assert.match(releaseWorkflow, /head_branch == "main"/);
  assert.match(releaseWorkflow, /conclusion == "success"/);
});

test('repository exposes quality, package publication, and site image lanes', async () => {
  const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual((await readdir(workflowDirectory)).sort(), [
    'contributor-policy.yml',
    'pages.yml',
    'quality.yml',
    'release-publish.yml',
    'site-release.yml',
  ]);
});

test('image publication preserves same-source quality evidence after checkout', async () => {
  const imageWorkflow = await readFile(new URL('../../.github/workflows/site-release.yml', import.meta.url), 'utf8');
  const imageScript = await readFile(
    new URL('../../apps/site/scripts/ci/publish-production-image.sh', import.meta.url),
    'utf8',
  );
  const checkout = imageWorkflow.indexOf('- uses: actions/checkout@');
  const policy = imageWorkflow.indexOf('- name: Require owner-dispatched current main');
  const stable = imageWorkflow.indexOf('- name: Verify matching stable registry packages');
  const publish = imageWorkflow.indexOf('- name: Publish, attest, and scan');
  assert.ok(checkout >= 0 && checkout < policy && policy < stable && stable < publish);
  assert.match(imageWorkflow, /artifacts\/site-release-policy/);
  assert.match(imageWorkflow, /verify-approved-stable\.mjs/);
  assert.match(imageWorkflow, /registry-consumer\.mjs --version "\$RELEASE_VERSION"/);
  assert.match(imageWorkflow, /verify-export-registry\.mjs/);
  assert.match(imageWorkflow, /VARENDO_EXPORT_VERIFIED_VERSION=\$RELEASE_VERSION/);
  assert.match(imageScript, /test "\$VARENDO_EXPORT_VERIFIED_VERSION" = "\$release_version"/);
  assert.match(imageScript, /--build-arg "VARENDO_EXPORT_VERIFIED_VERSION=\$VARENDO_EXPORT_VERIFIED_VERSION"/);
  assert.match(imageScript, /export-consumer\.json/);
  assert.match(releaseWorkflow, /-f event=push -f status=success/);
});

test('site redeploy permits visual baseline metadata while rejecting package-affecting paths', async () => {
  const imageWorkflow = await readFile(new URL('../../.github/workflows/site-release.yml', import.meta.url), 'utf8');
  const classifier = imageWorkflow.match(/case "\$path" in\n[\s\S]*?\n\s+esac/);
  assert.ok(classifier, 'site release must classify changed paths before reusing package publication evidence');
  function classify(path) {
    return spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', `path="$1"\n${classifier[0]}`, 'site-policy', path], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, PUBLISHED_SHA: 'a'.repeat(40) },
    });
  }
  for (const path of [
    'scripts/visual/baseline.json',
    'apps/site/src/styles/docs-reference.css',
    'docs/site/pages/quickstart.md',
  ]) {
    assert.equal(classify(path).status, 0, `${path} must permit a site-only redeploy`);
  }
  for (const path of [
    'packages/core/src/index.ts',
    'docs/packages/core.md',
    'pnpm-lock.yaml',
    'scripts/visual/run.mjs',
    'scripts/visual/baseline.json.backup',
    'scripts/release/candidate-lib.mjs',
  ]) {
    const result = classify(path);
    assert.notEqual(result.status, 0, `${path} must require fresh package publication evidence`);
    assert.match(result.stderr, /Package-affecting path changed/);
  }
});
