import { describe, expect, it } from 'vitest';
import type { PresentationPlan } from '@varendo/core';
import type { PresentationPatternContext, PresentationPatternManifest } from '@varendo/core/presentation';
import { overviewPattern, ROLES } from '../../examples/vnext/workspace/goal.js';
import { LAYOUT_PATTERNS } from '../../examples/vnext/workspace/page.js';
import { result } from '../contracts/fixtures.js';
import { context as baseContext } from './fixtures/presentation.js';

type Node = PresentationPlan['nodes'][number];
function fixture(page: boolean) {
  const base = baseContext();
  const context: PresentationPatternContext = {
    ...base,
    task: {
      ...base.task,
      id: page ? 'attendance-page-task' : 'attendance-overview-task',
      needs: ROLES.map((role) => ({ ...base.task.needs[0]!, id: role, outputId: role, required: true })),
    },
    results: ROLES.map((role) => ({ ...result, ref: { ...result.ref, id: `result-${role}`, outputId: role } })),
  };
  const pattern: PresentationPatternManifest = page ? LAYOUT_PATTERNS[1]! : overviewPattern();
  const expanded = pattern.expand({ id: 'pattern-proof', revision: '1', preconditions: context.current, context });
  if (!expanded.ok) throw new Error(JSON.stringify(expanded.diagnostics));
  return { pattern, context, plan: expanded.value };
}
function replaceNode(plan: PresentationPlan, id: string, replace: (node: Node) => Node): PresentationPlan {
  return { ...plan, nodes: plan.nodes.map((node) => (node.id === id ? replace(node) : node)) };
}

for (const page of [false, true])
  describe(page ? 'registered page match' : 'registered workspace match', () => {
    it('accepts its expansion and compatible incumbent state transfers', () => {
      const { pattern, context, plan } = fixture(page);
      expect(pattern.matches(plan, context)).toBe(true);
      const incumbent = { ...context, incumbent: plan };
      const next = pattern.expand({ id: 'next', revision: '2', preconditions: context.current, context: incumbent });
      expect(next.ok).toBe(true);
      if (next.ok) expect(pattern.matches(next.value, incumbent)).toBe(true);
    });
    for (const [name, id, mutate] of [
      [
        'workspace representation',
        'workspace',
        (node: Node) => ({ ...node, representation: { id: 'layout.tabs', revision: '1' } }),
      ],
      ['workspace edges', 'workspace', (node: Node) => ({ ...node, children: ['trend', 'summary', 'breakdown'] })],
      ['output node identity', 'summary', (node: Node) => ({ ...node, id: 'forged-summary' })],
      [
        'output representation revision',
        'trend',
        (node: Node) => ({ ...node, representation: { ...node.representation, revision: '2' } }),
      ],
      ['output child edge', 'summary', (node: Node) => ({ ...node, children: ['trend'] })],
      ['output role', 'summary', (node: Node) => ({ ...node, role: 'structure' })],
      [
        'output schema revision',
        'summary',
        (node: Node) => ({ ...node, config: { ...node.config, schema: { ...node.config.schema, revision: '2' } } }),
      ],
    ] as const)
      it(`rejects forged ${name}`, () => {
        const { pattern, context, plan } = fixture(page);
        expect(pattern.matches(replaceNode(plan, id, mutate), context)).toBe(false);
      });
    for (const key of ['id', 'revision', 'outputId', 'queryDigest', 'scopeDigest', 'sourceLineage'] as const)
      it(`rejects a forged output result ${key}`, () => {
        const { pattern, context, plan } = fixture(page);
        const forged = replaceNode(plan, 'summary', (node) => ({
          ...node,
          result: { ...node.result!, [key]: 'forged' },
        }));
        expect(pattern.matches(forged, context)).toBe(false);
      });
  });

describe('registered page structure', () => {
  for (const id of ['page', 'page-header', 'page-body', 'page-sidebar']) {
    for (const field of ['id', 'revision'])
      it(`rejects ${id} representation ${field}`, () => {
        const { pattern, context, plan } = fixture(true);
        const forged = replaceNode(plan, id, (node) => ({
          ...node,
          representation: { ...node.representation, [field]: 'forged' },
        }));
        expect(pattern.matches(forged, context)).toBe(false);
      });
    it(`rejects ${id} child edges`, () => {
      const { pattern, context, plan } = fixture(true);
      expect(
        pattern.matches(
          replaceNode(plan, id, (node) => ({ ...node, children: ['summary'] })),
          context,
        ),
      ).toBe(false);
    });
  }
  it('rejects a renamed header while preserving the node count', () => {
    const { pattern, context, plan } = fixture(true);
    expect(
      pattern.matches(
        replaceNode(plan, 'page-header', (node) => ({ ...node, id: 'forged-header' })),
        context,
      ),
    ).toBe(false);
  });
});

it('preserves registered identity and archive transfers across page/workspace round trips', () => {
  const page = fixture(true);
  const workspace = fixture(false);
  const overview = LAYOUT_PATTERNS[0]!;
  const context = { ...workspace.context, incumbent: page.plan };
  const returned = overview.expand({ id: 'return', revision: '2', preconditions: context.current, context });
  expect(returned.ok).toBe(true);
  if (!returned.ok) return;
  expect(overview.matches(returned.value, context)).toBe(true);
  expect(returned.value.stateTransfer).toHaveLength(8);
  expect(returned.value.stateTransfer.filter((transfer) => transfer.mapping.id.endsWith('.archive'))).toHaveLength(4);
  const nextContext = { ...page.context, incumbent: returned.value };
  const next = page.pattern.expand({
    id: 'again',
    revision: '3',
    preconditions: context.current,
    context: nextContext,
  });
  expect(next.ok).toBe(true);
  if (!next.ok) return;
  expect(page.pattern.matches(next.value, nextContext)).toBe(true);
  expect(next.value.stateTransfer).toHaveLength(4);
  expect(next.value.stateTransfer.every((transfer) => transfer.mapping.id === 'aeliqo.state.identity')).toBe(true);
});
