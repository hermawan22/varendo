import { describe, expect, it } from 'vitest';
import { INTERACTION_GRAPH_LIMITS, validateInteractionGraph } from '../../packages/core/src/interaction/index.js';
import type {
  InteractionGraphInput,
  InteractionMappingManifest,
  InteractionPort,
  InteractionPortShape,
} from '../../packages/core/src/interaction/index.js';
import type { InteractionLink } from '../../packages/core/src/index.js';

const selection = { payload: 'selection', entity: 'employee', identity: ['id'], grain: ['id'] } as const;
const identity: InteractionMappingManifest = {
  ref: { id: 'selection.identity', revision: '1' },
  source: selection,
  target: selection,
  kind: 'identity',
};
const node = (
  id: string,
  shape: InteractionPortShape = selection,
  direction: InteractionPort['direction'] = 'inout',
) => ({ id, ports: [{ id: 'selection', direction, ...shape }] });
const link = (
  id: string,
  source: string,
  target: string,
  propagation: InteractionLink['propagation'] = 'identity-equivalence',
): InteractionLink => ({
  id,
  source: { node: source, port: 'selection' },
  target: { node: target, port: 'selection' },
  mapping: identity.ref,
  propagation,
});
const graph = (links: readonly InteractionLink[] = [link('ab', 'a', 'b')]): InteractionGraphInput => ({
  nodes: [node('a'), node('b'), node('c')],
  links,
});

describe('registered interaction graph semantics', () => {
  it('permits a bounded selection equivalence cycle and returns independent immutable manifests', () => {
    const original = JSON.parse(
      JSON.stringify(graph([link('ab', 'a', 'b'), link('bc', 'b', 'c'), link('ca', 'c', 'a')])),
    );
    const registry = JSON.parse(JSON.stringify([identity]));
    const result = validateInteractionGraph(original, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value.nodes[0]?.ports[0]?.identity)).toBe(true);
    expect(Object.isFrozen(result.value.mappings[0]?.source)).toBe(true);
    original.nodes[0]!.id = 'changed';
    registry[0]!.ref.revision = '2';
    expect(result.value.nodes[0]?.id).toBe('a');
    expect(result.value.mappings[0]?.ref.revision).toBe('1');
  });

  it('rejects arbitrary directed feedback, including feedback through equivalence classes', () => {
    expect(
      validateInteractionGraph(graph([link('ab', 'a', 'b', 'directed'), link('ba', 'b', 'a', 'directed')]), [identity]),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'interaction.feedback' }] });
    expect(
      validateInteractionGraph(
        graph([link('ab', 'a', 'b'), link('bc', 'b', 'c', 'directed'), link('ca', 'c', 'a', 'directed')]),
        [identity],
      ),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'interaction.feedback' }] });
    expect(
      validateInteractionGraph(graph([link('ab', 'a', 'b'), link('ba', 'b', 'a', 'directed')]), [identity]).ok,
    ).toBe(false);
    expect(validateInteractionGraph(graph([link('aa', 'a', 'a', 'directed')]), [identity]).ok).toBe(false);
    expect(
      validateInteractionGraph(graph([link('ab', 'a', 'b', 'directed'), link('bc', 'b', 'c', 'directed')]), [identity])
        .ok,
    ).toBe(true);
  });

  it('checks cycles between explicit ports without inventing intra-node feedback', () => {
    const separate = {
      nodes: [
        {
          id: 'a',
          ports: [
            { id: 'out', direction: 'output', ...selection },
            { id: 'in', direction: 'input', ...selection },
          ],
        },
      ],
      links: [
        {
          ...link('within-node', 'a', 'a', 'directed'),
          source: { node: 'a', port: 'out' },
          target: { node: 'a', port: 'in' },
        },
      ],
    };
    expect(validateInteractionGraph(separate, [identity]).ok).toBe(true);
  });

  it('rejects self-declared convergence and wrong identity semantics', () => {
    expect(validateInteractionGraph(graph(), [{ ...identity, kind: 'registered' }])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'interaction.nonconvergent' }],
    });
    expect(validateInteractionGraph(graph(), [{ ...identity, convergent: true }] as never).ok).toBe(false);
    expect(
      validateInteractionGraph(graph(), [{ ...identity, target: { ...selection, entity: 'customer' } }]),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'interaction.invalid-identity' }] });
    expect(validateInteractionGraph({ nodes: [node('a', { ...selection, identity: [] })], links: [] }, []).ok).toBe(
      false,
    );
    expect(
      validateInteractionGraph({ nodes: [node('a', { ...selection, identity: ['id', 'id'] })], links: [] }, []).ok,
    ).toBe(false);
  });

  it('binds exact versioned mappings, endpoints and port direction', () => {
    expect(validateInteractionGraph(graph(), []).ok).toBe(false);
    expect(validateInteractionGraph(graph(), [{ ...identity, ref: { ...identity.ref, revision: '2' } }])).toMatchObject(
      { ok: false, diagnostics: [{ code: 'interaction.unknown-mapping' }] },
    );
    expect(validateInteractionGraph(graph([link('missing', 'a', 'absent')]), [identity]).ok).toBe(false);
    expect(
      validateInteractionGraph({ ...graph(), nodes: [node('a', selection, 'input'), node('b')] }, [identity]).ok,
    ).toBe(false);
    expect(
      validateInteractionGraph({ ...graph(), nodes: [node('a'), node('b', selection, 'output')] }, [identity]).ok,
    ).toBe(false);
    expect(
      validateInteractionGraph({ ...graph(), nodes: [node('a', selection, 'output'), node('b', selection, 'input')] }, [
        identity,
      ]),
    ).toMatchObject({ ok: false, diagnostics: [{ code: 'interaction.nonconvergent' }] });
  });

  it('requires explicit registered conversions for different units, types and payloads', () => {
    const usd = {
      payload: 'group',
      grain: ['record'],
      type: { value: 'decimal', nullable: false, unit: { dimension: 'money', symbol: '$', currency: 'USD' } },
    } as const;
    const eur = { ...usd, type: { ...usd.type, unit: { ...usd.type.unit, symbol: '€', currency: 'EUR' } } } as const;
    const mapping: InteractionMappingManifest = { ref: identity.ref, source: usd, target: eur, kind: 'registered' };
    const typed = {
      nodes: [node('a', usd, 'output'), node('b', eur, 'input')],
      links: [link('ab', 'a', 'b', 'directed')],
    };
    expect(validateInteractionGraph(typed, [mapping]).ok).toBe(true);
    expect(validateInteractionGraph(typed, [{ ...mapping, target: usd }])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'interaction.port-mismatch' }],
    });
    expect(
      validateInteractionGraph(typed, [{ ...mapping, target: { ...eur, type: { ...eur.type, nullable: true } } }]).ok,
    ).toBe(false);
    expect(validateInteractionGraph(typed, [{ ...mapping, kind: 'identity' }]).ok).toBe(false);
    expect(validateInteractionGraph({ ...typed, links: [link('ab', 'a', 'b')] }, [mapping]).ok).toBe(false);
  });

  it('compares calendar/timezone and tuple identity while treating grain as a set', () => {
    const temporal = {
      payload: 'range',
      type: { value: 'date', nullable: false, temporal: { calendar: 'gregory', timezone: 'UTC' } },
    } as const;
    const rangeMapping: InteractionMappingManifest = {
      ref: identity.ref,
      source: temporal,
      target: temporal,
      kind: 'identity',
    };
    const rangeGraph = {
      nodes: [node('a', temporal, 'output'), node('b', temporal, 'input')],
      links: [link('ab', 'a', 'b', 'directed')],
    };
    expect(validateInteractionGraph(rangeGraph, [rangeMapping]).ok).toBe(true);
    expect(
      validateInteractionGraph(
        {
          ...rangeGraph,
          nodes: [
            node('a', temporal),
            node('b', {
              ...temporal,
              type: { ...temporal.type, temporal: { ...temporal.type.temporal, timezone: 'Asia/Jakarta' } },
            }),
          ],
        },
        [rangeMapping],
      ).ok,
    ).toBe(false);
    const composite = { ...selection, identity: ['company', 'id'], grain: ['company', 'id'] };
    const compositeMapping: InteractionMappingManifest = {
      ref: identity.ref,
      source: composite,
      target: { ...composite, grain: ['id', 'company'] },
      kind: 'identity',
    };
    expect(
      validateInteractionGraph({ nodes: [node('a', composite), node('b', composite)], links: [link('ab', 'a', 'b')] }, [
        compositeMapping,
      ]).ok,
    ).toBe(true);
    expect(
      validateInteractionGraph({ nodes: [], links: [] }, [
        { ...compositeMapping, target: { ...composite, identity: ['id', 'company'] } },
      ]).ok,
    ).toBe(false);
  });

  it('rejects duplicate identities, malformed ingress and unregistered extensions', () => {
    expect(validateInteractionGraph({ ...graph(), nodes: [node('a'), node('a')] }, [identity]).ok).toBe(false);
    expect(
      validateInteractionGraph(
        { nodes: [{ ...node('a'), ports: [node('a').ports[0]!, node('a').ports[0]!] }], links: [] },
        [],
      ).ok,
    ).toBe(false);
    expect(validateInteractionGraph(graph([link('ab', 'a', 'b'), link('ab', 'b', 'a')]), [identity]).ok).toBe(false);
    expect(validateInteractionGraph(graph(), [identity, identity]).ok).toBe(false);
    expect(validateInteractionGraph({ ...graph(), actor: 'human' }, [identity]).ok).toBe(false);
    expect(validateInteractionGraph({ nodes: [node('a', { payload: 'extension' })], links: [] }, []).ok).toBe(false);
    expect(
      validateInteractionGraph(
        { nodes: [node('a', { payload: 'extension', extension: { id: 'local.approved', revision: '1' } })], links: [] },
        [],
      ).ok,
    ).toBe(true);
    expect(
      validateInteractionGraph(
        { nodes: [node('a', { ...selection, extension: { id: 'bypass', revision: '1' } })], links: [] },
        [],
      ).ok,
    ).toBe(false);
    expect(validateInteractionGraph({ nodes: [node('a')], links: [], mapper: () => 'code' }, []).ok).toBe(false);
  });

  it('enforces the total port budget across otherwise valid nodes', () => {
    const ports = Array.from({ length: 128 }, (_, index) => ({
      id: `p${index}`,
      direction: 'inout' as const,
      ...selection,
    }));
    const nodes = Array.from({ length: INTERACTION_GRAPH_LIMITS.totalPorts / 128 + 1 }, (_, index) => ({
      id: `n${index}`,
      ports,
    }));
    expect(validateInteractionGraph({ nodes, links: [] }, [])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'interaction.graph-budget' }],
    });
    expect(validateInteractionGraph({ nodes: [], links: [] }, [])).toEqual({
      ok: true,
      value: { nodes: [], links: [], mappings: [] },
    });
  });
});
