import { join } from 'node:path';
import { execute, output } from './process.mjs';
import { captureFamilies } from './families.mjs';

export function selection() {
  return {
    project: process.env.AELIQO_VISUAL_PROJECT ?? null,
    batch: process.env.AELIQO_VISUAL_BATCH ?? null,
    grep: process.env.AELIQO_VISUAL_GREP ?? null,
  };
}

export function captureArguments(project, selected) {
  const args = ['exec', 'playwright', 'test', '--config', 'tests/visual/regression.capture.playwright.config.mjs'];
  if (project) args.push(`--project=${project}`);
  if (selected.batch) args.push(`tests/visual/${selected.batch}.spec.ts`);
  if (selected.grep) args.push('--grep', selected.grep);
  return args;
}

export async function capture(root, destination, project) {
  const selected = selection();
  const args = captureArguments(project, selected);
  const plan = JSON.parse(
    output(root, 'pnpm', [...args, '--list', '--reporter=json'], { AELIQO_VISUAL_CAPTURE: destination }),
  );
  await captureFamilies(destination, plan, (file, directory) => {
    // The original selection is already reflected in the plan. Keep grep for
    // selected local runs; each release family still executes its full plan.
    const familyArgs = args.filter((arg) => arg !== `tests/visual/${selected.batch}.spec.ts`);
    execute(root, 'pnpm', [...familyArgs, `tests/visual/${file}`], { AELIQO_VISUAL_CAPTURE: directory });
  });
  return destination;
}

export function compare(root, baseline, candidate, destination) {
  execute(
    root,
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'tests/visual/regression.compare.playwright.config.mjs'],
    {
      AELIQO_VISUAL_BASELINE: baseline,
      AELIQO_VISUAL_CANDIDATE: candidate,
      AELIQO_VISUAL_DIFF: join(destination, 'diff'),
    },
  );
}
