import type { ScenarioId } from './scenarios.js';

export interface ProjectFile {
  readonly path: string;
  readonly content: string;
}

interface TemplateResource {
  readonly id: string;
  readonly label: string;
  readonly shape: string;
  readonly fields: string;
  readonly views: readonly string[];
  readonly records: readonly Readonly<Record<string, string | number>>[];
  readonly intentFields: readonly string[];
}

const resources: Readonly<Record<ScenarioId, TemplateResource>> = Object.freeze({
  people: {
    id: 'people',
    label: 'People',
    shape: 'id: z.string(), name: z.string(), team: z.string(), location: z.string()',
    fields: "name: {label: 'Name'}, team: {label: 'Team', role: 'dimension'}, location: {label: 'Location'}",
    views: ['table', 'cards'],
    intentFields: ['name', 'team', 'location'],
    records: [
      { id: 'p-1', name: 'Ada Chen', team: 'Design', location: 'Jakarta' },
      { id: 'p-2', name: 'Sam Rivera', team: 'Engineering', location: 'Lisbon' },
    ],
  },
  products: {
    id: 'products',
    label: 'Products',
    shape: 'id: z.string(), name: z.string(), category: z.string(), price: z.number(), stock: z.number().int()',
    fields:
      "name: {label: 'Name'}, category: {label: 'Category', role: 'dimension'}, price: {label: 'Price', role: 'measure'}, stock: {label: 'Stock'}",
    views: ['table', 'cards'],
    intentFields: ['name', 'category', 'price', 'stock'],
    records: [
      { id: 'pr-1', name: 'Field notebook', category: 'Stationery', price: 12, stock: 18 },
      { id: 'pr-2', name: 'Desk lamp', category: 'Workspace', price: 48, stock: 7 },
    ],
  },
  support: {
    id: 'tickets',
    label: 'Support tickets',
    shape: 'id: z.string(), subject: z.string(), customer: z.string(), status: z.string(), priority: z.string()',
    fields:
      "subject: {label: 'Subject'}, customer: {label: 'Customer'}, status: {label: 'Status', role: 'dimension'}, priority: {label: 'Priority'}",
    views: ['table', 'cards'],
    intentFields: ['subject', 'customer', 'status', 'priority'],
    records: [
      { id: 't-1', subject: 'Invoice PDF unavailable', customer: 'Northstar', status: 'Open', priority: 'High' },
      { id: 't-2', subject: 'Rotate API token', customer: 'Kite Labs', status: 'Resolved', priority: 'Low' },
    ],
  },
  knowledge: {
    id: 'articles',
    label: 'Knowledge articles',
    shape: 'id: z.string(), title: z.string(), topic: z.string(), excerpt: z.string()',
    fields: "title: {label: 'Title'}, topic: {label: 'Topic', role: 'dimension'}, excerpt: {label: 'Summary'}",
    views: ['table', 'cards'],
    intentFields: ['title', 'topic', 'excerpt'],
    records: [
      {
        id: 'kb-1',
        title: 'Rotate an API token safely',
        topic: 'Security',
        excerpt: 'Replace and revoke credentials safely.',
      },
      { id: 'kb-2', title: 'Understand workspace roles', topic: 'Access', excerpt: 'Assign the smallest useful role.' },
    ],
  },
});

function application(resource: TemplateResource): string {
  const rows = JSON.stringify(resource.records, null, 2);
  return `import {defineResource} from '@varendo/core';
import {createQueryFunctionRegistry} from '@varendo/core/expressions';
import {createLocalDataService} from '@varendo/runtime/data';
import {createVarendoApp} from '@varendo/web/app';
import {z} from 'zod';
import './style.css';

const resource = defineResource({
  id: '${resource.id}', revision: '${resource.id}-1', label: '${resource.label}', identity: ['id'],
  schema: z.object({${resource.shape}}),
  fields: {${resource.fields}},
  presentation: {allowedViews: ${JSON.stringify(resource.views)}},
});

const functions = createQueryFunctionRegistry({version: '2'});
if (!functions.ok) throw new Error(functions.diagnostics[0].message);
const data = createLocalDataService({
  snapshot: {catalog: resource.catalog, sourceRevision: 'synthetic-1', records: {${resource.id}: ${rows}}},
  functionRegistry: functions.value,
  sourceLimits: {rows: 1_000, bytes: 1_000_000},
  authorize: () => ({ok: true, value: {scopeDigest: 'local-demo', policyRevision: 'policy-1'}}),
});

const app = createVarendoApp({
  resources: [{resource, data}],
  authority: {read: () => ({ok: true, value: {
    principalKey: 'local-user', scopeDigest: 'local-demo', policyRevision: 'policy-1',
    experienceRevision: 'web-1', grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
    readContext: {principal: 'local-user'},
  }})},
});

const target = document.querySelector<HTMLElement>('#app');
if (target === null) throw new Error('The app target is missing.');
const mounted = app.mount({target, regionId: 'main', resourceId: resource.id});
if (!mounted.ok) throw new Error(mounted.diagnostics[0].message);
const receipt = await app.render({regionId: 'main', intent: {
  version: '1', id: '${resource.id}-browse', kind: 'browse', resource: resource.id,
  fields: ${JSON.stringify(resource.intentFields)},
}});
document.querySelector('#status')!.textContent = receipt.status;
window.addEventListener('pagehide', () => app.dispose(), {once: true});
`;
}

export function projectFiles(scenario: ScenarioId, releaseVersion: string): readonly ProjectFile[] {
  if (!/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/u.test(releaseVersion)) {
    throw new TypeError('Project export requires a valid Varendo release version.');
  }
  const resource = resources[scenario];
  const packages = Object.fromEntries(
    ['@varendo/core', '@varendo/runtime', '@varendo/web'].map((name) => [name, releaseVersion]),
  );
  return Object.freeze([
    {
      path: 'package.json',
      content: `${JSON.stringify({ name: `varendo-${scenario}-example`, private: true, type: 'module', scripts: { dev: 'vite', build: 'tsc --noEmit && vite build' }, dependencies: { ...packages, zod: '4.5.4' }, devDependencies: { typescript: '7.0.2', vite: '8.2.2' } }, null, 2)}\n`,
    },
    {
      path: 'tsconfig.json',
      content: `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: ['vite/client'], strict: true, noEmit: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    },
    {
      path: 'index.html',
      content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${resource.label} · Varendo</title></head><body><main><h1>${resource.label}</h1><p id="status" role="status">Loading…</p><div id="app"></div></main><script type="module" src="/src/main.ts"></script></body></html>\n`,
    },
    { path: 'src/main.ts', content: application(resource) },
    {
      path: 'src/style.css',
      content: `:root{font-family:Inter,ui-sans-serif,system-ui;color:#202033;background:#f7f7fb}body{margin:0}main{inline-size:min(72rem,calc(100% - 2rem));margin:3rem auto}#app{container-type:inline-size;min-block-size:20rem}\n`,
    },
    {
      path: 'README.md',
      content: `# ${resource.label} · Varendo ${releaseVersion}\n\nSynthetic source project exported from the Varendo playground. Install requires the pinned ${releaseVersion} packages to be published to npm.\n\n\`\`\`sh\npnpm install\npnpm dev\n\`\`\`\n\nThe application works without an AI provider. Replace the local snapshot and authority adapter with application-owned implementations before using real data.\n`,
    },
  ]);
}
