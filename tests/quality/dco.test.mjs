import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, '../../scripts/check-dco.mjs');
const signoff = 'Signed-off-by: Contributor <contributor@example.invalid>';

function git(directory, args, environment = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

async function repository(t) {
  const directory = await mkdtemp(join(tmpdir(), 'varendo-dco-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  git(directory, ['config', 'user.name', 'Contributor']);
  git(directory, ['config', 'user.email', 'contributor@example.invalid']);
  git(directory, ['config', 'commit.gpgsign', 'false']);
  git(directory, ['commit', '--quiet', '--allow-empty', '-m', 'Historical unsigned commit']);
  return { directory, base: git(directory, ['rev-parse', 'HEAD']) };
}

function commit(directory, message, environment) {
  git(directory, ['commit', '--quiet', '--allow-empty', '-m', message], environment);
  return git(directory, ['rev-parse', 'HEAD']);
}

function check(directory, base, head, environment = {}) {
  return spawnSync(process.execPath, [script, base, head], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, VARENDO_DCO_INTEGRATION_HEAD: '', ...environment },
  });
}

test('DCO accepts signed new commits without demanding signoff for accepted history', async (t) => {
  const { directory, base } = await repository(t);
  const head = commit(directory, `New contribution\n\n${signoff}`);
  const result = check(directory, base, head);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 contribution commit/u);
});

test('DCO checks every contribution in the range rather than only the signed head', async (t) => {
  const { directory, base } = await repository(t);
  const unsigned = commit(directory, 'Unsigned contribution');
  const head = commit(directory, `Signed follow-up\n\n${signoff}`);
  const result = check(directory, base, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(unsigned.slice(0, 12), 'u'));
  assert.match(result.stderr, /matching author signoff/u);
});

test('DCO rejects an unrelated signer and a signoff embedded in prose', async (t) => {
  const { directory, base } = await repository(t);
  for (const message of [
    'Wrong signer\n\nSigned-off-by: Other <other@example.invalid>',
    'Wrong name\n\nSigned-off-by: Other <contributor@example.invalid>',
    `Explains the command\n\n${signoff}\n\nThis is example prose, not a trailer.`,
  ]) {
    git(directory, ['reset', '--quiet', '--hard', base]);
    const result = check(directory, base, commit(directory, message));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /matching author signoff/u);
  }
});

async function merge(directory, base, subject, environment = {}, signedFeature = true) {
  git(directory, ['checkout', '--quiet', '-b', 'feature', base]);
  await writeFile(join(directory, 'feature.txt'), 'Feature\n');
  git(directory, ['add', 'feature.txt']);
  commit(directory, `Feature${signedFeature ? `\n\n${signoff}` : ''}`);
  git(directory, ['checkout', '--quiet', 'main']);
  await writeFile(join(directory, 'main.txt'), 'Main\n');
  git(directory, ['add', 'main.txt']);
  commit(directory, `Main contribution\n\n${signoff}`);
  git(directory, ['merge', '--quiet', '--no-ff', '--no-commit', 'feature']);
  return commit(directory, subject, environment);
}

test('DCO exempts only the exact main-push integration head and checks its parents', async (t) => {
  const { directory, base } = await repository(t);
  const head = await merge(directory, base, 'Merge pull request #42 from contributor/feature', {
    GIT_COMMITTER_NAME: 'GitHub',
    GIT_COMMITTER_EMAIL: 'noreply@github.com',
  });
  const result = check(directory, base, head, { VARENDO_DCO_INTEGRATION_HEAD: head });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 contribution commits/u);
});

test('DCO does not let the integration head hide an unsigned contribution', async (t) => {
  const { directory, base } = await repository(t);
  const head = await merge(
    directory,
    base,
    'Merge pull request #42 from contributor/feature',
    { GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' },
    false,
  );
  const result = check(directory, base, head, { VARENDO_DCO_INTEGRATION_HEAD: head });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /matching author signoff/u);
});

test('DCO requires signoff for contributor-created merge commits', async (t) => {
  const { directory, base } = await repository(t);
  const head = await merge(directory, base, 'Merge pull request #42 from contributor/feature');
  const result = check(directory, base, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(head.slice(0, 12), 'u'));
});

test('DCO rejects spoofed GitHub merge metadata in a pull request', async (t) => {
  const { directory, base } = await repository(t);
  const head = await merge(directory, base, 'Merge pull request #42 from contributor/feature', {
    GIT_COMMITTER_NAME: 'GitHub',
    GIT_COMMITTER_EMAIL: 'noreply@github.com',
  });
  const result = check(directory, base, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(head.slice(0, 12), 'u'));
});

test('DCO cannot exempt a non-merge contribution or a different integration SHA', async (t) => {
  const { directory, base } = await repository(t);
  const head = commit(directory, 'Unsigned contribution');
  const result = check(directory, base, head, { VARENDO_DCO_INTEGRATION_HEAD: head });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /matching author signoff/u);
  const wrong = check(directory, base, head, { VARENDO_DCO_INTEGRATION_HEAD: base });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /integration head must match/u);
});

test('DCO rejects malformed revisions before passing them to Git', async (t) => {
  const { directory, base } = await repository(t);
  const result = check(directory, '--all', base);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full source SHAs/u);
});

async function workflowCommand(name = 'quality.yml') {
  const workflow = await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
  const step = workflow.match(/- name: Verify contributor commit signoffs\n([\s\S]*?)(?=\n  [a-z]|\n      - |$)/u);
  assert.ok(step, 'required policy workflow must verify contributor signoffs');
  const body = step[1].match(/        run: \|\n((?:          .*\n?)+)/u);
  assert.ok(body, 'DCO workflow step must have an executable command');
  return body[1].replace(/^ {10}/gmu, '');
}

function runWorkflow(command, directory, base, head, environment = {}) {
  return spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', command], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      BASE_SHA: base,
      HEAD_SHA: head,
      RUNNER_TEMP: directory,
      VARENDO_DCO_INTEGRATION_HEAD: '',
      ...environment,
    },
  });
}

test('the required workflow rejects unsigned commits using its trusted base checker', async (t) => {
  const { directory } = await repository(t);
  await mkdir(join(directory, 'scripts'));
  await copyFile(script, join(directory, 'scripts/check-dco.mjs'));
  git(directory, ['add', 'scripts']);
  const base = commit(directory, 'Previously reviewed checker');
  await writeFile(join(directory, 'scripts/check-dco.mjs'), 'process.exit(0);\n');
  git(directory, ['add', 'scripts']);
  const head = commit(directory, 'Unsigned contribution bypasses its own checker');
  const result = runWorkflow(await workflowCommand(), directory, base, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /matching author signoff/u);
});

test('an amended root fetches the trusted base checker without trusting unsigned head code', async (t) => {
  const { directory: origin } = await repository(t);
  await mkdir(join(origin, 'scripts'));
  await copyFile(script, join(origin, 'scripts/check-dco.mjs'));
  git(origin, ['add', 'scripts']);
  const base = commit(origin, 'Previously reviewed checker');
  git(origin, ['checkout', '--quiet', '--orphan', 'snapshot']);
  await writeFile(join(origin, 'scripts/check-dco.mjs'), 'process.exit(0);\n');
  git(origin, ['add', 'scripts']);
  const unsigned = commit(origin, 'Unsigned Initialize');
  const { directory } = await repository(t);
  git(directory, ['remote', 'add', 'origin', origin]);
  git(directory, ['fetch', '--quiet', '--depth=1', 'origin', unsigned]);
  git(directory, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  assert.throws(() => git(directory, ['cat-file', '-e', `${base}^{commit}`]));
  const rejected = runWorkflow(await workflowCommand(), directory, base, unsigned);
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.match(rejected.stderr, /matching author signoff/u);
  git(origin, ['commit', '--quiet', '--amend', '-m', `Initialize\n\n${signoff}`]);
  const signed = git(origin, ['rev-parse', 'HEAD']);
  git(directory, ['fetch', '--quiet', '--depth=1', 'origin', signed]);
  const accepted = runWorkflow(await workflowCommand(), directory, base, signed);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /1 contribution commit/u);
});

test('PR contributor workflow trusts only base policy and never checks out or executes PR code', async (t) => {
  const workflow = await readFile(new URL('../../.github/workflows/contributor-policy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/u);
  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /node-version: 24\.20\.0/u);
  assert.match(workflow, /name: DCO/u);
  assert.doesNotMatch(workflow, /pnpm|npm |secrets\.|BOOTSTRAP|INTEGRATION_HEAD: \$|checkout.*head/u);
  for (const action of workflow.matchAll(/uses: [^@\n]+@([^\n]+)/gu)) assert.match(action[1], /^[a-f0-9]{40}$/u);
  const { directory } = await repository(t);
  await mkdir(join(directory, 'scripts'));
  await copyFile(script, join(directory, 'scripts/check-dco.mjs'));
  await mkdir(join(directory, '.github/workflows'), { recursive: true });
  await writeFile(join(directory, '.github/workflows/contributor-policy.yml'), workflow);
  git(directory, ['add', '.']);
  const base = commit(directory, 'Trusted policy and checker');
  await writeFile(join(directory, 'scripts/check-dco.mjs'), 'process.exit(0);\n');
  await writeFile(join(directory, '.github/workflows/contributor-policy.yml'), 'name: DCO\njobs: {}\n');
  git(directory, ['add', '.']);
  const head = commit(directory, 'Unsigned contribution tampers with checker and workflow');
  git(directory, ['reset', '--quiet', '--hard', base]);
  git(directory, ['remote', 'add', 'origin', directory]);
  const result = runWorkflow(await workflowCommand('contributor-policy.yml'), directory, base, head);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /matching author signoff/u);
  assert.equal(git(directory, ['rev-parse', 'HEAD']), base);
  assert.equal(await readFile(join(directory, '.github/workflows/contributor-policy.yml'), 'utf8'), workflow);
  const signedHead = commit(directory, `Signed contribution\n\n${signoff}`);
  git(directory, ['reset', '--quiet', '--hard', base]);
  const accepted = runWorkflow(await workflowCommand('contributor-policy.yml'), directory, base, signedHead);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /1 contribution commit/u);
});

test('PR contributor workflow fails closed without an accepted checker', async (t) => {
  const { directory, base } = await repository(t);
  await mkdir(join(directory, 'scripts'));
  await copyFile(script, join(directory, 'scripts/check-dco.mjs'));
  git(directory, ['add', '.']);
  const head = commit(directory, `Head introduces a checker\n\n${signoff}`);
  git(directory, ['reset', '--quiet', '--hard', base]);
  git(directory, ['remote', 'add', 'origin', directory]);
  const result = runWorkflow(await workflowCommand('contributor-policy.yml'), directory, base, head);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not exist/u);
});

test('initial DCO rollout accepts only the explicitly pinned base and checker bytes', async (t) => {
  const { directory, base } = await repository(t);
  await mkdir(join(directory, 'scripts'));
  await copyFile(script, join(directory, 'scripts/check-dco.mjs'));
  git(directory, ['add', 'scripts']);
  const head = commit(directory, `Reviewed checker introduction\n\n${signoff}`);
  const command = await workflowCommand();
  const bootstrap = {
    BOOTSTRAP_BASE_SHA: base,
    BOOTSTRAP_CHECKER_SHA256: createHash('sha256')
      .update(await readFile(script))
      .digest('hex'),
  };
  assert.equal(runWorkflow(command, directory, base, head, bootstrap).status, 0);
  assert.equal(runWorkflow(command, directory, base, head, { ...bootstrap, BOOTSTRAP_BASE_SHA: head }).status, 1);
  assert.equal(
    runWorkflow(command, directory, base, head, { ...bootstrap, BOOTSTRAP_CHECKER_SHA256: '0'.repeat(64) }).status,
    1,
  );
});

test('a zero-base initial push checks the signed root and rejects an unsigned contribution', async (t) => {
  const { directory } = await repository(t);
  git(directory, ['checkout', '--quiet', '--orphan', 'clean-history']);
  const root = commit(directory, `Initialize\n\n${signoff}`);
  const accepted = check(directory, '0'.repeat(40), root);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /1 contribution commit/u);
  const unsigned = commit(directory, 'Unsigned follow-up');
  const rejected = check(directory, '0'.repeat(40), unsigned);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /missing matching author signoff/u);
});
