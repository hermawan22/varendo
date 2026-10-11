import type { Intent, PresentationPlan, VersionRef } from '@varendo/core';
import type { PresentationPatternManifest, PresentationStateMappingManifest } from '@varendo/core/presentation';
import { defineView } from '@varendo/web/recipes';
import { html } from 'lit';
import { feature, GOAL, PATTERN, goalRegistry, overviewPattern } from './goal.js';

const PAGE_GOAL = { id: 'attendance.page', revision: '1' } as const;
const PAGE_PATTERN = { id: 'attendance.page-pattern', revision: '1' } as const;
const PAGE_TASK = 'attendance-page-task';
const SHELL = { id: 'demo.page-shell', revision: '1' } as const;
const HEADER = { id: 'demo.page-header', revision: '1' } as const;
const SIDEBAR = { id: 'demo.page-sidebar', revision: '1' } as const;
const BODY = { id: 'demo.page-body', revision: '1' } as const;

export const WORKSPACE_RESOURCE = feature.resource;
export const WORKSPACE_RECORDS = [
  { id: 'a', employee: 'Ada', day: '2026-09-01', team: 'Engineering', present: 1 },
  { id: 'b', employee: 'Sam', day: '2026-09-02', team: 'Engineering', present: 1 },
  { id: 'c', employee: 'Lee', day: '2026-09-02', team: 'Design', present: 1 },
];
const overviewGoal = goalRegistry().definitions[0]!;
export const LAYOUT_INTENTS = [
  overviewGoal,
  {
    ...overviewGoal,
    ref: PAGE_GOAL,
    compile(input: unknown, context: Parameters<typeof overviewGoal.compile>[1]) {
      const compiled = overviewGoal.compile(input, context);
      if (!compiled.ok) return compiled;
      return { ok: true as const, value: { ...compiled.value, id: PAGE_TASK, goal: 'Attendance overview page' } };
    },
  },
];

export function layoutIntent(kind: 'workspace' | 'page'): Intent {
  return {
    version: '1',
    id: `show-${kind}`,
    kind: 'custom',
    resource: feature.id,
    intent: kind === 'page' ? PAGE_GOAL : GOAL,
    input: { team: 'Engineering' },
  };
}

function structuralNode(id: string, ref: VersionRef, children: string[]): PresentationPlan['nodes'][number] {
  return {
    id,
    representation: ref,
    role: 'structure',
    children,
    config: { schema: { id: `${ref.id}.config`, revision: '1' }, values: {} },
  };
}

function pageStructure(): PresentationPlan['nodes'] {
  return [
    structuralNode('page', SHELL, ['page-header', 'page-body']),
    structuralNode('page-header', HEADER, []),
    structuralNode('page-body', BODY, ['page-sidebar', 'workspace']),
    structuralNode('page-sidebar', SIDEBAR, []),
  ];
}

function matchesStructure(
  actual: PresentationPlan['nodes'][number],
  expected: PresentationPlan['nodes'][number],
): boolean {
  return (
    actual.id === expected.id &&
    actual.role === 'structure' &&
    actual.result === undefined &&
    actual.representation.id === expected.representation.id &&
    actual.representation.revision === expected.representation.revision &&
    actual.config.schema.id === expected.config.schema.id &&
    actual.config.schema.revision === expected.config.schema.revision &&
    actual.children.length === expected.children.length &&
    actual.children.every((child, index) => child === expected.children[index])
  );
}

const baseOverview = overviewPattern();
const STRUCTURAL_REFS = [SHELL, HEADER, BODY, SIDEBAR];
export const LAYOUT_STATE_MAPPINGS: readonly PresentationStateMappingManifest[] = STRUCTURAL_REFS.map((from) => ({
  ref: { id: `${from.id}.archive`, revision: '1' },
  from,
  to: { id: 'layout.stack', revision: '1' },
  fromRole: 'structure',
  toRole: 'structure',
  kind: 'archive',
}));
function stateTransfers(
  previous: PresentationPlan | undefined,
  nodes: PresentationPlan['nodes'],
): PresentationPlan['stateTransfer'] {
  return (previous?.nodes ?? []).map((node) => {
    if (nodes.some((next) => next.id === node.id))
      return { fromNode: node.id, toNode: node.id, mapping: { id: 'aeliqo.state.identity', revision: '1' } };
    return {
      fromNode: node.id,
      toNode: 'workspace',
      mapping: { id: `${node.representation.id}.archive`, revision: '1' },
    };
  });
}
const overview: PresentationPatternManifest = {
  ...baseOverview,
  expand(request) {
    const expanded = baseOverview.expand(request);
    if (!expanded.ok) return expanded;
    const plan = expanded.value as PresentationPlan;
    return { ok: true, value: { ...plan, stateTransfer: stateTransfers(request.context.incumbent, plan.nodes) } };
  },
};
const pagePattern: PresentationPatternManifest = {
  ref: PAGE_PATTERN,
  expand(request) {
    if (request.context.task.id !== PAGE_TASK)
      return {
        ok: false,
        diagnostics: [{ code: 'demo.page-intent', message: 'This pattern requires the page goal.', retryable: false }],
      };
    const expanded = baseOverview.expand({
      ...request,
      context: {
        ...request.context,
        task: { ...request.context.task, id: 'attendance-overview-task' },
      },
    });
    if (!expanded.ok) return expanded;
    const plan = expanded.value as PresentationPlan;
    const nodes = [...pageStructure(), ...plan.nodes];
    return {
      ok: true,
      value: { ...plan, rootId: 'page', nodes, stateTransfer: stateTransfers(request.context.incumbent, nodes) },
    };
  },
  matches(plan, context) {
    if (context.task.id !== PAGE_TASK || plan.rootId !== 'page' || plan.nodes.length !== 8) return false;
    const structure = pageStructure();
    if (!structure.every((expected) => plan.nodes.filter((actual) => matchesStructure(actual, expected)).length === 1))
      return false;
    return baseOverview.matches(
      {
        ...plan,
        rootId: 'workspace',
        nodes: plan.nodes.filter((node) => !structure.some((item) => item.id === node.id)),
      },
      { ...context, task: { ...context.task, id: 'attendance-overview-task' } },
    );
  },
};
export const LAYOUT_PATTERNS = [overview, pagePattern];
export const LAYOUT_DISCOVERY = [
  { ref: PATTERN, intent: GOAL, outputs: ['summary', 'trend', 'breakdown'] },
  { ref: PAGE_PATTERN, intent: PAGE_GOAL, outputs: ['summary', 'trend', 'breakdown'] },
];

function structuralView(ref: VersionRef, children: number, render: Parameters<typeof defineView>[0]['render']) {
  return defineView({
    ref,
    render,
    manifest: {
      ref,
      configSchema: { id: `${ref.id}.config`, revision: '1' },
      roles: ['structure'],
      operations: [],
      result: 'none',
      children: { min: children, max: children },
      visibility: children === 0 ? 'leaf' : 'simultaneous',
      extension: true,
      resolveConfig: () => ({ ok: true, value: { values: {}, fields: [], ports: [], operations: [] } }),
    },
  });
}
export const LAYOUT_VIEWS = [
  structuralView(
    SHELL,
    2,
    ({ children }) =>
      html`<section class="demo-page" aria-label="Registered attendance page">
        <style>
          .demo-page {
            container-type: inline-size;
            min-width: 0;
          }
          .demo-page-header {
            padding: 1rem;
            border-bottom: 1px solid var(--aeliqo-color-border);
          }
          .demo-page-header h3 {
            margin: 0;
          }
          .demo-page-body {
            display: grid;
            grid-template-columns: minmax(8rem, 1fr) minmax(0, 4fr);
            gap: 1rem;
          }
          .demo-page-body > *,
          .demo-page-body [data-aeliqo-node-id] {
            min-width: 0;
          }
          .demo-page-nav {
            padding: 1rem;
          }
          .demo-page-nav a {
            display: block;
            padding: 0.75rem;
          }
          @container (max-width: 600px) {
            .demo-page-body {
              grid-template-columns: minmax(0, 1fr);
            }
            .demo-page-nav {
              display: flex;
              flex-wrap: wrap;
            }
          }</style
        >${children()}
      </section>`,
  ),
  structuralView(
    HEADER,
    0,
    () =>
      html`<header class="demo-page-header">
        <h3 id="attendance-overview">Attendance overview</h3>
        <p>Engineering · September 2026</p>
      </header>`,
  ),
  structuralView(BODY, 2, ({ children }) => html`<div class="demo-page-body">${children()}</div>`),
  structuralView(
    SIDEBAR,
    0,
    () =>
      html`<nav class="demo-page-nav" aria-label="Registered page navigation">
        <a href="#attendance-overview" aria-current="page">Overview</a
        ><a href="https://hermawan22.github.io/varendo/guides/workspace/">Workspace guide</a>
      </nav>`,
  ),
];
