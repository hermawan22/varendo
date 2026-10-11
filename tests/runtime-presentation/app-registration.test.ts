import { describe, expect, it } from 'vitest';
import type { PresentationStateMappingManifest } from '@varendo/core/presentation';
import { overviewPattern, PATTERN } from '../../examples/vnext/workspace/goal.js';
import { experience, registryFor } from '../../packages/web/src/app/context.js';

const mapping: PresentationStateMappingManifest = {
  ref: { id: 'example.table-detail', revision: '1' },
  from: { id: 'data.table', revision: '1' },
  to: { id: 'data.detail', revision: '1' },
  fromRole: 'table',
  toRole: 'detail',
  kind: 'transfer',
};

describe('app presentation registrations', () => {
  it('registers host patterns and state mappings with the shared validator', () => {
    const registry = registryFor([], [], [], 'attendance', undefined, {
      patterns: [overviewPattern()],
      stateMappings: [mapping],
    });
    expect(registry?.patterns?.map((pattern) => pattern.ref)).toContainEqual(PATTERN);
    expect(registry?.stateMappings).toContainEqual(mapping);
    expect(experience(registry!, '1').allowedPatterns).toEqual([PATTERN.id]);
  });

  it('fails closed on duplicate patterns and unknown state mapping targets', () => {
    expect(
      registryFor([], [], [], 'attendance', undefined, {
        patterns: [overviewPattern(), overviewPattern()],
      }),
    ).toBeUndefined();
    expect(
      registryFor([], [], [], 'attendance', undefined, {
        stateMappings: [{ ...mapping, to: { id: 'unknown.view', revision: '1' } }],
      }),
    ).toBeUndefined();
  });
});
