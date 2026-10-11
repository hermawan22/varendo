import { describe, expect, it } from 'vitest';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import type { AeliqoPresentationRegistryOptions } from '../../packages/web/src/region/registry.js';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import type { PresentationPlan } from '../../packages/core/src/contracts/index.js';
import type { PresentationContext, ValidatedPresentation } from '../../packages/core/src/presentation/index.js';
import { visualizationContext, visualizationPlan, visualizationRegistryOptions } from './fixtures.mjs';

function checked(readOnly = false): ValidatedPresentation {
  const options = visualizationRegistryOptions(readOnly) as AeliqoPresentationRegistryOptions;
  const registry = createAeliqoPresentationRegistry(options);
  if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
  const result = validatePresentationPlan(
    visualizationPlan() as PresentationPlan,
    visualizationContext() as PresentationContext,
    registry.value,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe('canonical semantic visualization presentation', () => {
  it('validates one core plan containing all twelve visualization families', () => {
    const presentation = checked();
    expect(presentation.nodes).toHaveLength(13);
    const visualizationNodes = presentation.nodes.filter((node) => node.node.id !== 'root');
    expect(visualizationNodes.map((node) => node.manifest.id)).toEqual([
      'visualization.trend',
      'visualization.bar',
      'visualization.area',
      'visualization.scatter',
      'visualization.histogram',
      'visualization.heatmap',
      'visualization.matrix',
      'visualization.timeline',
      'visualization.calendar-grid',
      'visualization.tree',
      'visualization.treemap',
      'visualization.relationship',
    ]);
    expect(visualizationNodes.every((node) => node.node.result !== undefined)).toBe(true);
    expect(visualizationNodes.every((node) => node.config.values.visualization !== undefined)).toBe(true);

    const matrix = visualizationNodes.find((node) => node.manifest.id === 'visualization.matrix');
    expect(matrix?.config.fields).toEqual(['id', 'date']);
    expect(matrix?.node.result).toEqual({
      id: 'semantic-temporal',
      revision: '1',
      sourceLineage: 'fixture-source',
      outputId: 'rows',
      queryDigest: 'query',
      scopeDigest: 'scope',
    });
    expect(matrix?.config.operations).toEqual([
      { id: 'data.read', revision: '1' },
      { id: 'interaction.selection', revision: '1' },
    ]);
  });

  it('derives a no-selection configuration while retaining the registered bar analysis operation', () => {
    const presentation = checked(true);
    const visualizationNodes = presentation.nodes.filter((node) => node.node.id !== 'root');
    expect(visualizationNodes.every((node) => node.config.ports.length === 0)).toBe(true);
    for (const node of visualizationNodes) {
      expect(node.config.operations?.map((operation) => operation.id)).toEqual(
        node.manifest.id === 'visualization.bar' ? ['data.read', 'data.analyze'] : ['data.read'],
      );
    }
  });
});

it('cannot claim required matrix fields that its selected columns omit', () => {
  const registry = createAeliqoPresentationRegistry(
    visualizationRegistryOptions() as AeliqoPresentationRegistryOptions,
  );
  if (!registry.ok) throw Error('registry');
  const context = visualizationContext() as PresentationContext;
  const temporal = context.results.find((result) => result.ref.id === 'semantic-temporal')!;
  const constrained = {
    ...context,
    results: [temporal],
    task: {
      ...context.task,
      kind: 'presentation' as const,
      inputs: [temporal.ref],
      needs: [
        {
          id: 'required-date',
          operation: { id: 'data.read', revision: '1' },
          outputId: 'rows',
          fields: ['date'],
          required: true,
        },
      ],
    },
  };
  const source = visualizationPlan() as PresentationPlan;
  const covered = {
    ...source,
    rootId: 'visualization-matrix',
    nodes: source.nodes.filter((node) => node.id === 'visualization-matrix'),
    coverage: [
      { needId: 'required-date', nodeIds: ['visualization-matrix'], operations: [{ id: 'data.read', revision: '1' }] },
    ],
  };
  expect(validatePresentationPlan(covered, constrained, registry.value).ok).toBe(true);
  const omitted = {
    ...covered,
    nodes: covered.nodes.map((node) =>
      node.id !== 'visualization-matrix'
        ? node
        : {
            ...node,
            config: {
              ...node.config,
              values: { visualization: { version: '1', view: 'matrix', result: node.result!, columns: ['id'] } },
            },
          },
    ),
  };
  expect(validatePresentationPlan(omitted, constrained, registry.value).ok).toBe(false);
});
