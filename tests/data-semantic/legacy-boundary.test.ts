import { describe, expect, it } from 'vitest';
import { html } from 'lit';
import type { PresentationPlan, Result } from '../../packages/core/src/contracts/index.js';
import type { PresentationContext } from '../../packages/core/src/presentation/index.js';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { renderAeliqo } from '../../packages/web/src/server.js';
import { createAeliqoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import { dataPresentationContext, result as original } from './fixture.js';

describe('legacy region materialization boundary', () => {
  for (const representation of ['data.table', 'data.trend'])
    it(`${representation} validates current rows and rejects ambiguous materializations`, async () => {
      const result: Result = {
        ...original,
        fields: [
          { id: 'date', label: 'Date', type: { value: 'date', nullable: false }, role: 'identity' },
          original.fields.find((field) => field.id === 'amount')!,
        ],
        identity: ['date'],
        rowGrain: ['date'],
        counts: { loaded: 1, population: { kind: 'exact', value: 1, populationDigest: 'population-1' } },
        coverage: { kind: 'complete', populationDigest: 'population-1' },
      };
      const registry = createAeliqoPresentationRegistry();
      if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
      const manifest = registry.value.manifests.find((item) => item.ref.id === representation)!;
      const base = dataPresentationContext();
      const context: PresentationContext = {
        ...base,
        results: [result],
        task: {
          ...base.task,
          needs: [
            {
              id: 'read',
              operation: { id: 'data.read', revision: '1' },
              fields: ['amount'],
              outputId: 'people',
              required: true,
            },
          ],
        },
        experience: { ...base.experience, allowedRepresentations: [representation] },
        rendererCapabilities: [manifest.ref],
      };
      const plan: PresentationPlan = {
        id: 'legacy-boundary',
        revision: '1',
        rootId: 'view',
        preconditions: context.current,
        nodes: [
          {
            id: 'view',
            role: manifest.roles[0]!,
            representation: manifest.ref,
            result: result.ref,
            config: {
              schema: manifest.configSchema,
              values: representation === 'data.table' ? {} : { labelField: 'date', series: [{ field: 'amount' }] },
            },
            children: [],
          },
        ],
        links: [],
        coverage: [{ needId: 'read', nodeIds: ['view'], operations: [{ id: 'data.read', revision: '1' }] }],
        stateTransfer: [],
        diagnostics: [],
      };
      const checked = validatePresentationPlan(plan, context, registry.value);
      if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
      const good = { ref: result.ref, rows: [{ date: '2026-01-01', amount: { decimal: '12.50' } }] };
      const markup = await renderAeliqo(
        html`<aeliqo-region .presentation=${checked.value} .results=${[good]}></aeliqo-region>`,
      );
      expect(markup).toContain('2026-01-01');
      for (const rows of [[{ date: '2026-01-01', amount: 'malformed-private-value' }], [{ date: '2026-01-01' }]]) {
        const invalid = await renderAeliqo(
          html`<aeliqo-region .presentation=${checked.value} .results=${[{ ref: result.ref, rows }]}></aeliqo-region>`,
        );
        expect(invalid).toContain('Data unavailable.');
        expect(invalid).not.toContain('malformed-private-value');
      }
      const ambiguous = await renderAeliqo(
        html`<aeliqo-region .presentation=${checked.value} .results=${[good, good]}></aeliqo-region>`,
      );
      expect(ambiguous).toContain('Data unavailable.');
      for (const coverage of [
        { kind: 'unknown' as const, reason: 'Coverage not established' },
        { kind: 'sample' as const, populationDigest: 'population-1', method: 'Bounded sample' },
        { kind: 'partial' as const, populationDigest: 'population-1', reason: 'Delivery page' },
      ]) {
        const scopedResult: Result = {
          ...result,
          coverage,
          counts: { loaded: 1, population: { kind: 'exact', value: 2, populationDigest: 'population-1' } },
        };
        const scoped = validatePresentationPlan(plan, { ...context, results: [scopedResult] }, registry.value);
        if (!scoped.ok) throw new Error(JSON.stringify(scoped.diagnostics));
        const rendered = await renderAeliqo(
          html`<aeliqo-region .presentation=${scoped.value} .results=${[good]}></aeliqo-region>`,
        );
        expect(rendered).toContain('2026-01-01');
        expect(rendered).toContain('Showing 1 of 2 records');
        if (coverage.kind === 'unknown') expect(rendered).toContain('Scope unknown');
        if (coverage.kind === 'sample') expect(rendered).toContain('Bounded sample');
        if (coverage.kind !== 'unknown') expect(rendered).toContain('Showing a partial result.');
      }
    });
});
