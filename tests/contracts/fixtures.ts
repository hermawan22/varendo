/**
 * Small, representative wire fixtures for the canonical contract suite.
 *
 * These are deliberately plain values.  The production parser is the only
 * authority for their runtime types; keeping the fixtures untyped also makes
 * it possible for the negative tests to mutate them with unknown fields.
 */

export const ref = {
  id: 'result-1',
  revision: 'r1',
  sourceLineage: 'source-r1',
  outputId: 'rows',
  queryDigest: 'query-1',
  scopeDigest: 'scope-1',
} as const;

export const field = {
  id: 'employee.id',
  label: 'Employee ID',
  type: { value: 'text', nullable: false },
  role: 'identity',
} as const;

export const resultRef = {
  id: 'employees',
  revision: 'catalog-r1',
} as const;

export const catalog = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  entities: [
    {
      id: 'employees',
      label: 'Employees',
      identity: ['employee.id'],
      rowGrain: ['employee.id'],
      fields: [field],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
} as const;

export const query = {
  entity: 'employees',
  fields: ['employee.id'],
  measures: [],
  relations: [],
  groupBy: ['employee.id'],
  population: { kind: 'all-authorized' },
  order: [],
} as const;

export const task = {
  version: '1',
  id: 'task-1',
  revision: 'task-r1',
  catalogRevision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  regionId: 'region-1',
  goal: 'Browse employees',
  needs: [],
  assumptions: [],
  kind: 'data',
  outputs: [
    {
      id: 'rows',
      kind: 'query',
      query,
      dependsOn: [],
      delivery: 'eager',
    },
  ],
} as const;

export const presentationTask = {
  version: '1',
  id: 'task-presentation-1',
  revision: 'task-r1',
  catalogRevision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  regionId: 'region-1',
  goal: 'Show employees',
  needs: [],
  assumptions: [],
  kind: 'presentation',
  inputs: [ref],
} as const;

export const formTask = {
  version: '1',
  id: 'task-form-1',
  revision: 'task-r1',
  catalogRevision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  regionId: 'region-1',
  goal: 'Edit an employee',
  needs: [],
  assumptions: [],
  kind: 'form',
  schema: { id: 'employee.edit', revision: '1' },
  action: { id: 'employee.update', revision: '1' },
} as const;

export const result = {
  version: '1',
  ref,
  taskId: 'task-1',
  fields: [field],
  identity: ['employee.id'],
  rowGrain: ['employee.id'],
  counts: {
    loaded: 1,
    population: { kind: 'exact', value: 1, populationDigest: 'population-1' },
  },
  precision: { kind: 'exact' },
  coverage: { kind: 'complete', populationDigest: 'population-1' },
  consistency: {
    kind: 'snapshot',
    snapshotId: 'snapshot-1',
    sourceRevisions: { employees: 'source-r1' },
  },
  evidence: { kind: 'observed', source: { id: 'employees', revision: 'source-r1' } },
  filters: [],
  warnings: [],
  lineage: [],
} as const;

export const experience = {
  version: '1',
  id: 'experience-1',
  revision: 'experience-r1',
  mode: 'adaptive',
  agentAllowed: false,
  allowedRepresentations: ['data.table'],
  allowedPatterns: [],
  composition: { allowWithoutPreset: true, maxNodes: 8, maxExpansions: 16 },
  requiredOperations: [],
  tokenProfile: { id: 'tokens.default', revision: '1' },
  extensionAllowlist: [],
  transitionPolicy: 'stable',
} as const;

export const expression = {
  kind: 'literal',
  value: 3,
  type: { value: 'integer', nullable: false },
} as const;

export const environment = {
  inlineSize: { state: 'unknown' },
  blockSize: { state: 'unknown' },
  textScale: { state: 'unknown' },
  pointer: 'unknown',
  hover: 'unknown',
  keyboard: 'unknown',
  locale: 'en-US',
  direction: 'ltr',
  reducedMotion: false,
  forcedColors: false,
} as const;

export const interaction = {
  eventId: 'event-1',
  causationId: 'event-0',
  regionId: 'region-1',
  regionRevision: 'region-r1',
  originNodeId: 'table-1',
  payload: { kind: 'selection', selection: { mode: 'clear' } },
} as const;

const preconditions = {
  scopeDigest: 'scope-1',
  policyRevision: 'policy-1',
  taskRevision: 'task-r1',
  regionRevision: 'region-r1',
  catalogRevision: 'catalog-1',
  experienceRevision: 'experience-r1',
  functionRegistryDigest: 'functions-1',
  results: [ref],
} as const;

export const presentationPlan = {
  id: 'plan-1',
  revision: 'plan-r1',
  rootId: 'table-1',
  preconditions,
  nodes: [
    {
      id: 'table-1',
      role: 'table',
      representation: { id: 'data.table', revision: '1' },
      result: ref,
      config: { schema: { id: 'data.table.config', revision: '1' }, values: {} },
      children: [],
    },
  ],
  links: [],
  coverage: [],
  stateTransfer: [],
  diagnostics: [],
} as const;

export const taskProposal = {
  requestId: 'request-1',
  targetRegionId: 'region-1',
  effect: 'read',
  preconditions,
  value: task,
} as const;

export const meaningDraft = {
  id: 'meaning-1',
  revision: 'meaning-r1',
  label: 'Employee count',
  explanation: 'Count employees in the authorized population',
  output: { value: 'integer', nullable: false },
  implementation: { kind: 'expression', expression },
  dependencies: [],
  functionRegistryDigest: 'functions-1',
  origin: 'manual',
  lifecycle: 'draft',
  scope: 'workspace',
  aggregation: 'additive',
  aggregationDimensions: [],
  missingPolicy: 'reject',
} as const;

export const bindingOutcome = {
  state: 'bound',
  value: task,
  interpretation: 'The user requested the employee rows output',
  assumptions: [],
} as const;

export const modelEvaluation = {
  state: 'untested',
  reason: 'No evaluation has been run for this model snapshot',
} as const;

export const resultEvents = {
  descriptor: { kind: 'descriptor', descriptor: result },
  batch: { kind: 'batch', result: ref, sequence: 0, rows: [{ 'employee.id': 'e-1' }] },
  progress: { kind: 'progress', result: ref, completed: 1, total: 1, unit: 'rows' },
  complete: { kind: 'complete', result: ref, finalCoverage: result.coverage },
  error: {
    kind: 'error',
    requestId: 'request-1',
    error: { code: 'SOURCE_UNAVAILABLE', message: 'The source is unavailable', retryable: true },
  },
} as const;

export const familyFixtures = { catalog, task, result, experience } as const;
