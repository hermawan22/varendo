import { describe, expect, it } from 'vitest';
import { html } from 'lit';
import { validatePresentationPlan } from '../../packages/core/src/presentation/index.js';
import { renderVarendo } from '../../packages/web/src/server.js';
import { createVarendoPresentationRegistry } from '../../packages/web/src/region/registry.js';
import {
  binding,
  result as fixtureResult,
  dataPresentationContext,
  dataPresentationPlan,
  registryOptions,
} from './fixture.js';

describe('data semantic region SSR', () => {
  it('renders all eight canonical data views through the public registry', async () => {
    const registry = createVarendoPresentationRegistry(registryOptions);
    if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
    const checked = validatePresentationPlan(dataPresentationPlan(), dataPresentationContext(), registry.value);
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const markup = await renderVarendo(
      html`<varendo-region
        .presentation=${checked.value}
        .results=${[{ ref: binding.result.ref, rows: binding.rows }]}
      ></varendo-region>`,
    );
    for (const tag of [
      'varendo-metric',
      'varendo-delta',
      'varendo-key-value',
      'varendo-detail',
      'varendo-record-list',
      'varendo-card-collection',
      'varendo-filter-builder',
      'varendo-selection-summary',
    ])
      expect(markup).toContain(`<${tag}`);
    expect(markup).toContain('12.50');
    expect(markup).toContain('Ada');
    expect(markup).toContain('shadowrootmode="open"');
  });

  it('retains exact observed deltas with partial or stale scope and keeps relative units dimensionless', async () => {
    for (const status of ['partial', 'stale']) {
      const markup = await renderVarendo(
        html`<varendo-delta
          .current=${{ decimal: '12.50' }}
          .baseline=${{ decimal: '10.00' }}
          .status=${status}
          unit="USD"
        ></varendo-delta>`,
      );
      expect(markup).toContain('+2.5');
      expect(markup).toContain(status === 'partial' ? 'Showing a partial result.' : 'This result may be out of date.');
      expect(markup).toContain(`data-status="${status}"`);
      expect(markup).toMatch(/<span[^>]*part="unit"[^>]*>[\s\S]*?USD/);
    }
    const relative = await renderVarendo(
      html`<varendo-delta
        .current=${{ decimal: '12.50' }}
        .baseline=${{ decimal: '10.00' }}
        mode="relative"
        unit="USD"
      ></varendo-delta>`,
    );
    expect(relative).toContain('+25%');
    expect(relative).not.toMatch(/<span[^>]*part="unit"/);
    const missing = await renderVarendo(
      html`<varendo-delta .current=${{ decimal: '12.50' }} status="partial"></varendo-delta>`,
    );
    expect(missing).toContain('Value unavailable.');
  });

  it('keeps metric units attached only to a displayed value', async () => {
    const zero = await renderVarendo(html`<varendo-metric .value=${0} unit="records"></varendo-metric>`);
    expect(zero).toMatch(/<span[^>]*part="unit"[\s\S]*?records/);
    const empty = await renderVarendo(
      html`<varendo-metric .value=${undefined} status="empty" unit="records"></varendo-metric>`,
    );
    expect(empty).toContain('No data to display.');
    expect(empty).not.toMatch(/<span[^>]*part="unit"[\s\S]*?records/);
    const unavailable = await renderVarendo(
      html`<varendo-metric .value=${3} status="unavailable" unit="records"></varendo-metric>`,
    );
    expect(unavailable).toContain('Value unavailable.');
    expect(unavailable).not.toMatch(/<span[^>]*part="unit"[\s\S]*?records/);
    const error = await renderVarendo(
      html`<varendo-metric .value=${3} status="error" unit="records"></varendo-metric>`,
    );
    expect(error).toContain('data-status="error"');
    expect(error).toContain('The data could not be loaded.');
    expect(error).not.toMatch(/<span[^>]*part="unit"[\s\S]*?records/);
    const nullable = await renderVarendo(html`<varendo-metric .value=${null} unit="records"></varendo-metric>`);
    expect(nullable).toContain('data-status="ready"');
    expect(nullable).toContain('—');
    expect(nullable).not.toMatch(/<span[^>]*part="unit"[\s\S]*?records/);
  });

  it('preserves registered host scope annotations alongside the current materialization', async () => {
    const scope = {
      kind: 'loaded' as const,
      loaded: 2,
      populationTotal: 3,
      populationDigest: 'population-1',
      label: 'Active people',
    };
    const registry = createVarendoPresentationRegistry({ ...registryOptions, data: [{ ...binding, scope }] });
    if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
    const checked = validatePresentationPlan(dataPresentationPlan(), dataPresentationContext(), registry.value);
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const markup = await renderVarendo(
      html`<varendo-region
        .presentation=${checked.value}
        .results=${[{ ref: binding.result.ref, rows: binding.rows, scope }]}
      ></varendo-region>`,
    );
    expect(markup).toContain('<varendo-filter-builder');
    expect(markup).toContain('Active people; Showing 2 of 3 records');
    expect(markup).not.toContain('Data unavailable.');
  });

  it('keeps observed values readable while population coverage is unknown', async () => {
    const unknownResult = {
      ...fixtureResult,
      coverage: { kind: 'unknown' as const, reason: 'Population membership has not been established' },
    };
    const registry = createVarendoPresentationRegistry({
      ...registryOptions,
      data: [{ ...binding, result: unknownResult }],
    });
    if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
    const checked = validatePresentationPlan(
      dataPresentationPlan(),
      { ...dataPresentationContext(), results: [unknownResult] },
      registry.value,
    );
    if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
    const markup = await renderVarendo(
      html`<varendo-region
        .presentation=${checked.value}
        .results=${[{ ref: unknownResult.ref, rows: binding.rows }]}
      ></varendo-region>`,
    );
    expect(markup).toContain('12.50');
    expect(markup).toContain('+2.5');
    expect(markup).toContain('Scope unknown; Showing 2 of 3 records');
    expect(markup).not.toContain('Value unavailable.');
  });
});
