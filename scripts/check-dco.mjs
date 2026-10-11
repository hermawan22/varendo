import { execFileSync } from 'node:child_process';

function git(args, input) {
  return execFileSync('git', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function hasAuthorSignoff(message, authorName, authorEmail) {
  const trailers = git(['interpret-trailers', '--parse'], message);
  return [...trailers.matchAll(/^Signed-off-by:\s*(.*?)\s*<([^<>]+)>$/gimu)].some(
    ([, name, email]) => name.trim() === authorName && email.trim().toLowerCase() === authorEmail.toLowerCase(),
  );
}

try {
  const [base, head, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || ![base, head].every((revision) => /^[a-f0-9]{40}$/iu.test(revision ?? ''))) {
    throw new Error('DCO requires the base and head full source SHAs.');
  }
  const integrationHead = process.env.AELIQO_DCO_INTEGRATION_HEAD ?? '';
  if (integrationHead !== '' && integrationHead !== head) {
    throw new Error('The DCO integration head must match the exact checked head SHA.');
  }
  const initialPush = base === '0'.repeat(40);
  if (!initialPush) git(['cat-file', '-e', `${base}^{commit}`]);
  git(['cat-file', '-e', `${head}^{commit}`]);
  const commits = git(initialPush ? ['rev-list', '--reverse', head] : ['rev-list', '--reverse', head, '--not', base])
    .split('\n')
    .filter(Boolean);
  const failures = [];
  let checked = 0;
  for (const revision of commits) {
    const [parents, authorName, authorEmail, message] = git([
      'show',
      '--no-patch',
      '--format=%P%x00%an%x00%ae%x00%B',
      revision,
    ]).split('\0');
    if (revision === integrationHead && parents.split(' ').length > 1) continue;
    checked += 1;
    if (!hasAuthorSignoff(message, authorName, authorEmail)) {
      failures.push(`${revision.slice(0, 12)}: missing matching author signoff`);
    }
  }
  if (failures.length > 0) throw new Error(`DCO rejected contribution commits:\n${failures.join('\n')}`);
  console.log(`DCO verified ${checked} contribution commit${checked === 1 ? '' : 's'}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
