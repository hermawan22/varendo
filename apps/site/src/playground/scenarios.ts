import { defineResource, type Intent } from '@varendo/core';
import * as z from 'zod';
import { HEADCOUNT_RECORDS, HEADCOUNT_RESOURCE } from './workforce-scenario.js';

import { WORKSPACE_RESOURCE, WORKSPACE_RECORDS } from '../../../../examples/vnext/workspace/page.js';

import { resource as dailyAttendance, records as dailyRecords } from '../../../../examples/vnext/attendance/data.js';

export type ScenarioId = 'people' | 'products' | 'support' | 'knowledge';

interface PlaygroundStep {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly definition?: string;
  intent(): Intent;
}

export interface PlaygroundScenario {
  readonly id: ScenarioId;
  readonly label: string;
  readonly description: string;
  readonly steps: readonly PlaygroundStep[];
}

const people = defineResource({
  id: 'people',
  revision: 'people-1',
  label: 'People',
  identity: ['id'],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    team: z.enum(['Design', 'Engineering', 'Operations']),
    location: z.string(),
  }),
  fields: {
    id: { label: 'Person ID' },
    name: { label: 'Name' },
    team: { label: 'Team', role: 'dimension' },
    location: { label: 'Location' },
  },
  presentation: { allowedViews: ['table', 'cards', 'detail'] },
});

const absences = defineResource({
  id: 'absences',
  revision: 'absences-1',
  label: 'Absence history',
  identity: ['id'],
  rowGrain: ['person', 'week'],
  schema: z.object({ id: z.string(), week: z.iso.date(), person: z.string(), absence_days: z.number().int() }),
  fields: {
    id: { label: 'Record ID', hidden: true },
    week: { label: 'Week', role: 'time' },
    person: { label: 'Person', role: 'dimension' },
    absence_days: { label: 'Absence days', role: 'measure' },
  },
  meanings: [
    {
      id: 'absence-days-total',
      revision: '1',
      label: 'Total absence days',
      explanation: 'Sum of recorded absence days in the selected period.',
      output: { value: 'integer', nullable: false },
      implementation: {
        kind: 'expression',
        expression: {
          kind: 'call',
          function: { id: 'core.aggregate.sum', revision: '1' },
          arguments: [{ kind: 'field', ref: 'absence_days' }],
        },
      },
      dependencies: [],
      functionRegistryDigest: 'core-query-2',
      origin: 'manual',
      lifecycle: 'active',
      scope: 'workspace',
      authority: 'approved',
      aggregation: 'additive',
      aggregationDimensions: [],
      missingPolicy: 'reject',
    },
  ],
  presentation: { allowedViews: ['table', 'trend'], preferred: { browse: 'trend' } },
});

const products = defineResource({
  id: 'products',
  revision: 'products-1',
  label: 'Products',
  identity: ['id'],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    category: z.enum(['Stationery', 'Workspace']),
    price: z.number(),
    stock: z.number().int(),
  }),
  fields: {
    id: { label: 'Product ID' },
    name: { label: 'Name' },
    category: { label: 'Category', role: 'dimension' },
    price: {
      label: 'Price',
      role: 'measure',
      type: { value: 'float', nullable: false, unit: { dimension: 'currency', symbol: 'USD', currency: 'USD' } },
    },
    stock: { label: 'Stock', role: 'measure' },
  },
  presentation: { allowedViews: ['table', 'cards', 'detail'], preferred: { browse: 'cards' } },
  forms: {
    create: {
      schema: { id: 'products.create.input', revision: '1' },
      action: { id: 'products.create', revision: '1' },
    },
    edit: { schema: { id: 'products.update.input', revision: '1' }, action: { id: 'products.update', revision: '1' } },
  },
});

const tickets = defineResource({
  id: 'tickets',
  revision: 'tickets-1',
  label: 'Support tickets',
  identity: ['id'],
  schema: z.object({
    id: z.string(),
    subject: z.string(),
    customer: z.string(),
    status: z.enum(['Open', 'Pending', 'Resolved']),
    priority: z.enum(['High', 'Medium', 'Low']),
  }),
  fields: {
    id: { label: 'Ticket ID' },
    subject: { label: 'Subject' },
    customer: { label: 'Customer' },
    status: { label: 'Status', role: 'dimension' },
    priority: { label: 'Priority', role: 'dimension' },
  },
  presentation: { allowedViews: ['table', 'cards', 'detail'] },
  forms: {
    edit: { schema: { id: 'tickets.update.input', revision: '1' }, action: { id: 'tickets.update', revision: '1' } },
  },
});

const articles = defineResource({
  id: 'articles',
  revision: 'articles-1',
  label: 'Knowledge articles',
  identity: ['id'],
  schema: z.object({ id: z.string(), title: z.string(), topic: z.string(), excerpt: z.string(), content: z.string() }),
  fields: {
    id: { label: 'Article ID' },
    title: { label: 'Title' },
    topic: { label: 'Topic', role: 'dimension' },
    excerpt: { label: 'Summary' },
    content: { label: 'Article' },
  },
  presentation: { allowedViews: ['table', 'cards', 'detail', 'demo.knowledge-article'] },
});

export const PLAYGROUND_RESOURCES = Object.freeze({
  attendance: WORKSPACE_RESOURCE,
  dailyAttendance,
  people,
  absences,
  headcount: HEADCOUNT_RESOURCE,
  products,
  tickets,
  articles,
});

export const PLAYGROUND_RECORDS = Object.freeze({
  attendance: WORKSPACE_RECORDS,
  'daily-attendance': dailyRecords,
  people: [
    { id: 'p-1', name: 'Ada Chen', team: 'Design', location: 'Jakarta' },
    { id: 'p-2', name: 'Sam Rivera', team: 'Engineering', location: 'Lisbon' },
    { id: 'p-3', name: 'Iman Putra', team: 'Engineering', location: 'Bandung' },
    { id: 'p-4', name: 'Lee Morgan', team: 'Operations', location: 'London' },
  ],
  absences: [
    { id: 'a-1', week: '2026-08-03', person: 'Ada Chen', absence_days: 1 },
    { id: 'a-2', week: '2026-08-10', person: 'Ada Chen', absence_days: 0 },
    { id: 'a-3', week: '2026-08-17', person: 'Ada Chen', absence_days: 2 },
    { id: 'a-4', week: '2026-08-24', person: 'Ada Chen', absence_days: 0 },
  ],
  'workforce-headcount': HEADCOUNT_RECORDS,
  products: [
    { id: 'pr-1', name: 'Field notebook', category: 'Stationery', price: 12, stock: 18 },
    { id: 'pr-2', name: 'Graphite pencils', category: 'Stationery', price: 8.5, stock: 32 },
    { id: 'pr-3', name: 'Desk lamp', category: 'Workspace', price: 48, stock: 7 },
    { id: 'pr-4', name: 'Laptop stand', category: 'Workspace', price: 64, stock: 11 },
  ],
  tickets: [
    { id: 't-1042', subject: 'Invoice PDF is unavailable', customer: 'Northstar', status: 'Open', priority: 'High' },
    { id: 't-1043', subject: 'Update workspace owner', customer: 'Acme', status: 'Pending', priority: 'Medium' },
    { id: 't-1044', subject: 'API token rotation', customer: 'Kite Labs', status: 'Resolved', priority: 'Low' },
  ],
  articles: [
    {
      id: 'kb-1',
      title: 'Rotate an API token safely',
      topic: 'Security',
      excerpt: 'Create, verify, and revoke credentials without interrupting clients.',
      content:
        'Create a replacement token, deploy it to every active client, verify traffic, then revoke the previous token. Never place a token in a URL or playground export.',
    },
    {
      id: 'kb-2',
      title: 'Understand workspace roles',
      topic: 'Access',
      excerpt: 'A practical guide to owner, editor, and viewer capabilities.',
      content:
        'Assign the smallest role that supports the user task. Recheck permissions on the server before every write and when a session changes principal.',
    },
    {
      id: 'kb-3',
      title: 'Recover a failed import',
      topic: 'Data',
      excerpt: 'Inspect errors, correct source rows, and retry a bounded import.',
      content:
        'Download the rejected-row report, correct only the invalid records, and retry with the same idempotency key. Keep the successful rows unchanged.',
    },
  ],
});

const intent = <T extends Intent>(value: T): T => value;
export const jakartaPeopleIntent = (): Intent =>
  intent({
    version: '1',
    id: 'people-jakarta',
    kind: 'browse',
    resource: 'people',
    fields: ['name', 'team', 'location'],
    filter: { op: 'compare', field: 'location', comparison: 'eq', value: 'Jakarta' },
  });
const scenarios: readonly PlaygroundScenario[] = [
  {
    id: 'people',
    label: 'People',
    description: 'Browse employees, filter a team, inspect one person, and compare month end workforce headcount.',
    steps: [
      {
        id: 'people-browse',
        label: 'Browse people',
        description: 'Table on wide containers; cards on narrow containers.',
        intent: () =>
          intent({
            version: '1',
            id: 'people-browse',
            kind: 'browse',
            resource: 'people',
            fields: ['name', 'team', 'location'],
          }),
      },
      {
        id: 'people-filter',
        label: 'Engineering only',
        description: 'The filter is compiled and evaluated, not applied by a mock view.',
        intent: () =>
          intent({
            version: '1',
            id: 'people-filter',
            kind: 'browse',
            resource: 'people',
            fields: ['name', 'team', 'location'],
            filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
          }),
      },
      {
        id: 'people-detail',
        label: 'Open Ada',
        description: 'A detail request keeps stable identity.',
        intent: () =>
          intent({ version: '1', id: 'people-detail', kind: 'detail', resource: 'people', identity: { id: 'p-1' } }),
      },
      {
        id: 'people-trend',
        label: 'Monthly headcount',
        description: 'Month end employee counts are compared over time and are never added across months.',
        definition:
          'Month end headcount: employees active at the end of each month. Values are never summed across months.',
        intent: () =>
          intent({
            version: '1',
            id: 'people-trend',
            kind: 'analyze',
            resource: 'workforce-headcount',
            measures: [{ id: 'month-end-headcount', revision: '1' }],
            time: { field: 'month', grain: 'month', calendar: 'gregorian', timezone: 'UTC' },
            preferredView: 'trend',
            sort: [{ field: 'month', direction: 'asc' }],
          }),
      },
    ],
  },
  {
    id: 'products',
    label: 'Products',
    description: 'Use cards, detail, comparison, and a schema-derived create form.',
    steps: [
      {
        id: 'products-browse',
        label: 'Browse products',
        description: 'A semantic preference selects the registered card collection.',
        intent: () =>
          intent({
            version: '1',
            id: 'products-browse',
            kind: 'browse',
            resource: 'products',
            fields: ['name', 'category', 'price', 'stock'],
            preferredView: 'cards',
          }),
      },
      {
        id: 'products-compare',
        label: 'Compare products',
        description: 'Comparison remains column-preserving on mobile.',
        intent: () =>
          intent({
            version: '1',
            id: 'products-compare',
            kind: 'compare',
            resource: 'products',
            identities: [{ id: 'pr-3' }, { id: 'pr-4' }],
            fields: ['name', 'price', 'stock'],
          }),
      },
      {
        id: 'products-detail',
        label: 'Open desk lamp',
        description: 'Detail uses the same result and presentation pipeline.',
        intent: () =>
          intent({
            version: '1',
            id: 'products-detail',
            kind: 'detail',
            resource: 'products',
            identity: { id: 'pr-3' },
          }),
      },
      {
        id: 'products-create',
        label: 'Create product',
        description: 'The form comes from the registered runtime schema; submit produces a preview.',
        intent: () => intent({ version: '1', id: 'products-create', kind: 'create', resource: 'products' }),
      },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    description: 'Search tickets, inspect details, and edit through a confirmed action.',
    steps: [
      {
        id: 'support-search',
        label: 'Search tickets',
        description: 'Search is part of browse and lowers to a registered function.',
        intent: () =>
          intent({
            version: '1',
            id: 'support-search',
            kind: 'browse',
            resource: 'tickets',
            fields: ['subject', 'customer', 'status', 'priority'],
            search: { text: 'API', fields: ['subject'] },
          }),
      },
      {
        id: 'support-browse',
        label: 'Browse open',
        description: 'Filter and adaptive layout remain available without an agent.',
        intent: () =>
          intent({
            version: '1',
            id: 'support-browse',
            kind: 'browse',
            resource: 'tickets',
            fields: ['subject', 'customer', 'status', 'priority'],
            filter: { op: 'compare', field: 'status', comparison: 'eq', value: 'Open' },
          }),
      },
      {
        id: 'support-detail',
        label: 'Open ticket',
        description: 'The current identity is visible before an action.',
        intent: () =>
          intent({
            version: '1',
            id: 'support-detail',
            kind: 'detail',
            resource: 'tickets',
            identity: { id: 't-1042' },
          }),
      },
      {
        id: 'support-edit',
        label: 'Edit ticket',
        description: 'Current values and entity revision come from the trusted local host.',
        intent: () =>
          intent({ version: '1', id: 'support-edit', kind: 'edit', resource: 'tickets', identity: { id: 't-1042' } }),
      },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    description: 'Search content, open a reading view, and run a consumer-defined request.',
    steps: [
      {
        id: 'knowledge-search',
        label: 'Search articles',
        description: 'Search matches article content through the bounded query contract.',
        intent: () =>
          intent({
            version: '1',
            id: 'knowledge-search',
            kind: 'browse',
            resource: 'articles',
            fields: ['title', 'topic', 'excerpt'],
            search: { text: 'token', fields: ['title', 'excerpt', 'content'] },
          }),
      },
      {
        id: 'knowledge-detail',
        label: 'Read article',
        description: 'A consumer-owned renderer presents registered fields; no HTML comes from AI.',
        intent: () =>
          intent({
            version: '1',
            id: 'knowledge-detail',
            kind: 'detail',
            resource: 'articles',
            identity: { id: 'kb-1' },
            fields: ['title', 'topic', 'excerpt', 'content'],
            preferredView: 'demo.knowledge-article',
          }),
      },
      {
        id: 'knowledge-related',
        label: 'Security topic',
        description: 'A namespaced custom request compiles outside core and uses the same validator.',
        intent: () =>
          intent({
            version: '1',
            id: 'knowledge-related',
            kind: 'custom',
            resource: 'articles',
            intent: { id: 'demo.knowledge.by-topic', revision: '1' },
            input: { topic: 'Security' },
            preferredView: 'cards',
          }),
      },
    ],
  },
];

export const PLAYGROUND_SCENARIOS = Object.freeze(scenarios);

export { knowledgeArticleView } from './scenario-view.js';
export { customIntentRecipe, PLAYGROUND_INTENTS } from './scenario-intents.js';
