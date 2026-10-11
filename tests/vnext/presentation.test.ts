import { resolvePresentation, type PresentationResolverInput } from '../../packages/core/src/presentation/index.js';
import type { PresentationPlan } from '../../packages/core/src/contracts/types.js';
import { describe, expect, it } from 'vitest';
import { presentationPlan } from '../contracts/fixtures.js';
import {
  analyze,
  candidate,
  context,
  fixture,
  listRef,
  manifest,
  read,
  registry,
  tableRef,
  twoMetricTrendFixture,
} from './fixtures/presentation.js';

const splitRef = { id: 'foundation.split-pane', revision: '1' } as const;
const barRef = { id: 'visualization.bar', revision: '1' } as const;

function withoutClarification(input: PresentationResolverInput): Omit<PresentationResolverInput, 'clarification'> {
  const { clarification, ...rest } = input;
  void clarification;
  return rest;
}

function boundedComparisonInput(): PresentationResolverInput {
  const ordinary = context();
  const splitManifest = manifest(splitRef, 0, {
    roles: ['structure'],
    operations: [],
    result: 'none',
    children: { min: 2, max: 2 },
    visibility: 'simultaneous',
  });
  const comparisonContext = {
    ...ordinary,
    task: {
      ...ordinary.task,
      needs: [
        {
          id: 'left',
          operation: read,
          fields: ['employee.id'],
          outputId: 'rows',
          required: true,
          simultaneousGroup: 'comparison',
        },
        {
          id: 'right',
          operation: read,
          fields: ['employee.id'],
          outputId: 'rows',
          required: true,
          simultaneousGroup: 'comparison',
        },
      ],
    },
    experience: {
      ...ordinary.experience,
      allowedRepresentations: [splitRef.id, tableRef.id, listRef.id],
      composition: { ...ordinary.experience.composition, maxNodes: 4 },
    },
    rendererCapabilities: [splitRef, tableRef, listRef],
  };
  const plan: PresentationPlan = {
    ...presentationPlan,
    rootId: 'comparison-root',
    nodes: [
      {
        id: 'comparison-root',
        role: 'structure',
        representation: splitRef,
        config: { schema: { id: splitRef.id + '.config', revision: '1' }, values: {} },
        children: ['comparison-left', 'comparison-right'],
      },
      {
        id: 'comparison-left',
        role: 'browse',
        representation: tableRef,
        result: presentationPlan.nodes[0]!.result,
        config: { schema: { id: tableRef.id + '.config', revision: '1' }, values: {} },
        children: [],
      },
      {
        id: 'comparison-right',
        role: 'browse',
        representation: listRef,
        result: presentationPlan.nodes[0]!.result,
        config: { schema: { id: listRef.id + '.config', revision: '1' }, values: {} },
        children: [],
      },
    ],
    coverage: [
      { needId: 'left', nodeIds: ['comparison-left'], operations: [read] },
      { needId: 'right', nodeIds: ['comparison-right'], operations: [read] },
    ],
  };
  return {
    ...fixture({
      context: comparisonContext,
      registry: registry([splitManifest, manifest(tableRef), manifest(listRef)]),
      candidates: [{ id: 'comparison', source: 'explicit', plan }],
    }),
  };
}

describe('T08 presentation evidence', () => {
  it('returns bounded needs-input choices for an ambiguous two-metric trend', () => {
    const decision = resolvePresentation(twoMetricTrendFixture());

    expect(decision).toMatchObject({
      status: 'needs-input',
      choices: [
        { id: 'profit', label: 'profit' },
        { id: 'revenue', label: 'revenue' },
      ],
    });
  });

  it('distinguishes a missing registered candidate from an authorized clarification', () => {
    const ambiguous = resolvePresentation(twoMetricTrendFixture());
    const missing = resolvePresentation({
      ...withoutClarification(twoMetricTrendFixture()),
      candidates: [],
    });

    expect(ambiguous.status).toBe('needs-input');
    expect(missing).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.no-suggestion' },
    });
  });

  it('enforces hard pins while allowing a compatible preferred view to win', () => {
    const ordinary = context();
    const hardPinned = resolvePresentation(
      fixture({
        context: {
          ...ordinary,
          task: { ...ordinary.task, viewPreference: { representation: tableRef.id, strength: 'explicit' } },
        },
      }),
    );
    const softPreferred = resolvePresentation(
      fixture({
        context: {
          ...ordinary,
          task: { ...ordinary.task, viewPreference: { representation: listRef.id, strength: 'preferred' } },
        },
        registry: registry([manifest(tableRef, 100), manifest(listRef, 0)]),
      }),
    );
    const incompatible = resolvePresentation(
      fixture({
        context: {
          ...ordinary,
          task: { ...ordinary.task, viewPreference: { representation: 'missing.view', strength: 'explicit' } },
        },
      }),
    );

    expect(hardPinned).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'table' } });
    expect(softPreferred).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'list' } });
    expect(incompatible).toMatchObject({
      status: 'unsupported',
      reasons: expect.arrayContaining([{ code: 'presentation.pin-incompatible' }]),
    });
  });

  it('accepts a bounded simultaneous comparison split and rejects an over-capacity split', () => {
    const valid = resolvePresentation(boundedComparisonInput());
    const invalid = boundedComparisonInput();
    const root = invalid.candidates[0]!.plan.nodes[0]!;
    const oversizedNodes: PresentationPlan['nodes'] = [
      ...invalid.candidates[0]!.plan.nodes,
      {
        id: 'comparison-extra',
        role: 'browse',
        representation: tableRef,
        result: presentationPlan.nodes[0]!.result,
        config: { schema: { id: tableRef.id + '.config', revision: '1' }, values: {} },
        children: [],
      },
    ].map((node) => (node.id === root.id ? { ...node, children: [...node.children, 'comparison-extra'] } : node));
    const oversizedPlan: PresentationPlan = {
      ...invalid.candidates[0]!.plan,
      nodes: oversizedNodes,
    };
    const rejected = resolvePresentation({
      ...invalid,
      candidates: [{ id: 'oversized', source: 'explicit', plan: oversizedPlan }],
    });

    expect(valid).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'comparison' } });
    expect(valid.status === 'ready' && valid.plan.plan.nodes[0]?.children).toHaveLength(2);
    expect(rejected).toMatchObject({
      status: 'unsupported',
      diagnostic: { code: 'presentation.children' },
      rejections: [{ candidate: 'oversized', codes: ['presentation.children'] }],
    });
  });

  it('accepts a bounded bar candidate through the same resolver path as other views', () => {
    const trend = twoMetricTrendFixture();
    const { clarification, ...withoutChoice } = trend;
    void clarification;
    const bar = resolvePresentation({
      ...withoutChoice,
      context: {
        ...trend.context,
        task: {
          ...trend.context.task,
          needs: [{ ...trend.context.task.needs[0]!, fields: ['date', 'profit'] }],
        },
        experience: { ...trend.context.experience, allowedRepresentations: [barRef.id] },
        rendererCapabilities: [barRef],
      },
      registry: registry([manifest(barRef, 0, { roles: ['bar'], operations: [analyze] })]),
      candidates: [candidate('bar', barRef, { role: 'bar', operation: analyze, needId: 'trend' })],
    });

    expect(bar).toMatchObject({ status: 'ready', receipt: { selectedCandidate: 'bar' } });
    if (bar.status === 'ready') expect(bar.plan.nodes[0]?.config.fields).toEqual(['date', 'profit', 'revenue']);
  });
});
