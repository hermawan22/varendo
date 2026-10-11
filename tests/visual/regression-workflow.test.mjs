import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const workflow = await readFile(new URL('../../.github/workflows/quality.yml', import.meta.url), 'utf8');
const digest = 'sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7';
function job(name) {
  const block = workflow.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][a-z-]*:|(?![\\s\\S]))`, 'mu'))?.[0];
  assert.ok(block, `missing ${name} job`);
  return block;
}
function assertAdvisory(block) {
  assert.match(
    block,
    /\n    if: (always\(\) && )?github.event_name != 'pull_request'( && !\(github.event_name == 'workflow_dispatch' && inputs.visual_probe\))?\n    continue-on-error: true\n/u,
  );
}
test('advisory visual job probes only an unapproved baseline and otherwise keeps the strict gate', () => {
  const gate = job('visual-shards');
  assert.match(gate, /needs: policy/u);
  assertAdvisory(gate);
  assert.match(
    gate,
    /if: github.event_name != 'pull_request' && !\(github.event_name == 'workflow_dispatch' && inputs.visual_probe\)/u,
  );
  assert.ok(gate.includes(`image: mcr.microsoft.com/playwright@${digest}`));
  assert.ok(gate.includes(`AELIQO_VISUAL_CONTAINER_DIGEST: ${digest}`));
  assert.match(
    gate,
    /if \[ "\$\(node -p "require\('\.\/scripts\/visual\/baseline\.json'\)\.status"\)" = unapproved \]; then/u,
  );
  assert.match(gate, /node scripts\/visual\/run.mjs --probe --shard \$\{\{ matrix.browser \}\}/u);
  assert.match(gate, /else\n\s+node scripts\/visual\/run.mjs --shard \$\{\{ matrix.browser \}\}/u);
  assert.match(gate, /fetch-depth: 0/u);
  assert.match(gate, /if: always\(\)/u);
  assert.match(gate, /path: artifacts\/visual-regression/u);
  assert.doesNotMatch(gate, /playwright install|apt-get|update-snapshots/u);
});
test('owner-dispatched full probe uses one matrix and the same runner', () => {
  const probe = job('visual-probe-shards');
  assert.match(probe, /needs: policy/u);
  assert.match(probe, /if:.*github.event_name == 'workflow_dispatch'.*inputs.visual_probe/u);
  assert.ok(probe.includes(`image: mcr.microsoft.com/playwright@${digest}`));
  assert.ok(probe.includes(`AELIQO_VISUAL_CONTAINER_DIGEST: ${digest}`));
  assert.match(probe, /run: node scripts\/visual\/run.mjs --probe --shard/u);
  for (const field of [
    "node-version: '24.20.0'",
    'pnpm@11.24.0',
    'AELIQO_VISUAL_FONT_DIRS: /usr/share/fonts:/usr/local/share/fonts',
    'TZ: UTC',
    'LANG: C.UTF-8',
  ]) {
    assert.ok(probe.includes(field), field);
    assert.ok(job('visual-shards').includes(field), field);
  }
  assert.match(workflow, /visual_probe:[\s\S]*?type: boolean[\s\S]*?default: false/u);
});

test('advisory paired performance gate and same-source probe keep their evidence', () => {
  const gate = job('performance');
  const probe = job('performance-probe');
  assert.match(gate, /needs: policy/u);
  assertAdvisory(gate);
  assert.ok(gate.includes(`image: mcr.microsoft.com/playwright@${digest}`));
  assert.match(gate, /run: node scripts\/performance\/compare.mjs\n/u);
  assert.match(gate, /path: artifacts\/performance-paired/u);
  assert.match(probe, /if:.*github.event_name == 'workflow_dispatch'.*inputs.performance_probe/u);
  assert.ok(probe.includes(`image: mcr.microsoft.com/playwright@${digest}`));
  assert.ok(probe.includes('node scripts/performance/compare.mjs --probe --source "$SOURCE_SHA"'));
  assert.match(workflow, /performance_probe:[\s\S]*?type: boolean[\s\S]*?default: false/u);
});

test('container jobs trust only their exact checkout after checkout temporary HOME is gone', () => {
  for (const name of ['visual-shards', 'visual-probe-shards', 'performance', 'performance-probe']) {
    const block = job(name);
    assert.ok(block.includes('chown "$(id -u):$(id -g)" "$HOME"'));
    assert.ok(block.includes('git config --global --add safe.directory "$GITHUB_WORKSPACE"'));
    assert.doesNotMatch(block, /safe\.directory ['"]?\*/u);
  }
});

for (const name of ['visual-shards', 'visual-probe-shards'])
  test(`${name} captures all three browsers independently without early cancellation`, () => {
    const block = job(name);
    assert.match(block, /fail-fast: false/u);
    assert.match(block, /browser: \[chromium, firefox, webkit\]/u);
    assert.match(block, /timeout-minutes: 360/u);
    assert.match(block, /shard-report-\$\{\{ env.SOURCE_SHA \}\}-\$\{\{ matrix.browser \}\}/u);
    assert.doesNotMatch(block, /AELIQO_VISUAL_(PROJECT|BATCH|GREP):/u);
    if (name === 'visual-probe-shards') assert.doesNotMatch(block, /continue-on-error/u);
  });
for (const name of ['visual', 'visual-probe'])
  test(`${name} aggregate cannot accept a missing or unsuccessful shard matrix`, () => {
    const block = job(name);
    assert.ok(block.includes(`needs: [policy, ${name}-shards]`));
    assert.match(block, /if: always\(\)/u);
    assert.ok(block.includes(`VISUAL_SHARD_RESULT: \${{ needs.${name}-shards.result }}`));
    assert.match(block, /merge-multiple: false/u);
    assert.match(block, /if-no-files-found: error/u);
    assert.match(block, /run: test "\$POLICY_RESULT" = success/u);
    assert.ok(block.indexOf('Require authorized source policy') < block.indexOf('actions/checkout@'));
    if (name === 'visual') assertAdvisory(block);
    else assert.doesNotMatch(block, /continue-on-error/u);
    if (name === 'visual') {
      assert.match(
        block,
        /if: always\(\) && github.event_name != 'pull_request' && !\(github.event_name == 'workflow_dispatch' && inputs.visual_probe\)/u,
      );
      assert.match(
        block,
        /if \[ "\$\(node -p "require\('\.\/scripts\/visual\/baseline\.json'\)\.status"\)" = unapproved \]; then/u,
      );
      assert.match(block, /node scripts\/visual\/aggregate.mjs --probe/u);
      assert.match(block, /else\n\s+node scripts\/visual\/aggregate.mjs\n/u);
    } else {
      assert.ok(block.includes('run: node scripts/visual/aggregate.mjs --probe\n'));
    }
  });
