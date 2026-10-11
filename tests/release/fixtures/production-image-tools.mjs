import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const mode = process.env.IMAGE_TEST_MODE;
const digest = 'sha256:' + 'a'.repeat(64);
const mediaType = 'application/vnd.oci.image.index.v1+json';
const index = {
  schemaVersion: 2,
  mediaType,
  digest,
  manifests: [
    { digest: 'sha256:' + 'b'.repeat(64), platform: { os: 'linux', architecture: 'amd64' } },
    { digest: 'sha256:' + 'c'.repeat(64), annotations: { 'vnd.docker.reference.type': 'attestation-manifest' } },
  ],
};
appendFileSync(process.env.IMAGE_TEST_LOG, JSON.stringify({ command, args }) + '\n');
const option = (name) => args[args.indexOf(name) + 1];
const json = (path, value) => writeFileSync(path, JSON.stringify(value));
const fail = (message, status = 1) => {
  process.stderr.write(message + '\n');
  process.exit(status);
};
const registry = () => JSON.parse(readFileSync(process.env.IMAGE_TEST_REGISTRY, 'utf8'));
function push(reference, manifest) {
  const state = registry();
  state.tags[reference] = manifest;
  json(process.env.IMAGE_TEST_REGISTRY, state);
}

if (command === 'docker') {
  if (args[0] !== 'buildx') fail('Unexpected Docker command.');
  if (['create', 'rm'].includes(args[1])) process.exit(0);
  if (args[1] === 'build') {
    const reference = option('--output').match(/(?:^|,)name=([^,]+)/u)?.[1];
    if (!reference) fail('Build image name missing.');
    push(reference, index);
    json(option('--metadata-file'), {
      'containerimage.digest': digest,
      'containerimage.descriptor': { digest, mediaType },
    });
    process.exit(0);
  }
  if (args[1] === 'imagetools' && args[2] === 'create') {
    if (args.at(-1) !== `ghcr.io/hermawan22/varendo-web@${digest}`) fail('Promotion did not use the scanned digest.');
    const reference = option('--tag');
    const copied = mode === 'copy-digest-mismatch' ? { ...index, digest: 'sha256:' + 'e'.repeat(64) } : index;
    push(reference, copied);
    json(option('--metadata-file'), {
      'containerimage.descriptor': { digest: copied.digest, mediaType },
      'image.name': 'ghcr.io/hermawan22/varendo-web',
    });
    process.exit(0);
  }
  if (args[1] === 'imagetools' && args[2] === 'inspect') {
    const manifest = registry().tags[args[3]];
    if (!manifest) fail('Final tag is unavailable.');
    process.stdout.write(
      JSON.stringify(
        mode === 'registry-digest-mismatch' ? { ...manifest, digest: 'sha256:' + 'f'.repeat(64) } : manifest,
      ),
    );
    process.exit(0);
  }
  fail('Unexpected Docker subcommand.');
}

if (command === 'curl') {
  if (args.some((value) => value === 'https://api.github.com/repos/hermawan22/varendo/branches/main')) {
    const state = registry();
    const advanced = mode === 'main-advanced' && state.branchChecks > 0;
    state.branchChecks = (state.branchChecks ?? 0) + 1;
    json(process.env.IMAGE_TEST_REGISTRY, state);
    process.stdout.write(
      JSON.stringify({
        commit: { sha: mode === 'main-mismatch' || advanced ? 'f'.repeat(40) : process.env.SOURCE_SHA },
      }),
    );
    process.exit(0);
  }
  if (args.some((value) => value.startsWith('https://github.com/aquasecurity/trivy/releases/download/'))) {
    writeFileSync(option('--output'), 'bounded fake Trivy archive');
    process.exit(0);
  }
  fail('Unexpected network request.');
}

if (command === 'python3') {
  if (args[0] === '-') {
    const result = spawnSync(process.env.IMAGE_TEST_PYTHON, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
  if (args[0] !== 'apps/site/scripts/ci/verify-buildkit-provenance.py') fail('Unexpected Python program.');
  if (mode === 'provenance-failure') fail('Remote provenance rejected.', 31);
  json(option('--statement-output'), { subject: [{ digest: { sha256: 'b'.repeat(64) } }] });
  json(option('--summary-output'), {
    imageConfigDigest: 'sha256:' + 'd'.repeat(64),
    subjectDigest: 'sha256:' + 'b'.repeat(64),
    statementDigest: 'sha256:' + 'c'.repeat(64),
  });
  process.exit(0);
}

if (command === 'sha256sum') {
  if (args[0] === '-c') {
    readFileSync(0, 'utf8');
    process.exit(0);
  }
  const result = spawnSync(process.env.IMAGE_TEST_SHA256, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

if (command === 'tar') {
  writeFileSync(join(option('-C'), 'trivy'), '#!/usr/bin/env node\nimport ' + JSON.stringify(import.meta.url) + ';\n', {
    mode: 0o755,
  });
  process.exit(0);
}

if (command === 'trivy') {
  if (args.at(-1) !== `ghcr.io/hermawan22/varendo-web@${digest}`) fail('Scan did not use the built digest.');
  if (option('--format') === 'cyclonedx') {
    if (mode === 'sbom-failure') fail('SBOM generation rejected.', 32);
    json(option('--output'), { bomFormat: 'CycloneDX' });
    process.exit(0);
  }
  json(option('--output'), { Results: mode === 'scan-failure' ? [{ Vulnerabilities: [{ Severity: 'HIGH' }] }] : [] });
  process.exit(mode === 'scan-failure' ? 1 : 0);
}

fail('Unknown bounded tool fake.');
