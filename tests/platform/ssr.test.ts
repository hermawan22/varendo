import { describe, expect, it } from 'vitest';
import { html } from 'lit';
import { renderVarendo } from '../../packages/web/src/server.js';
import { scopeText } from '../../packages/web/src/data/shared.js';

describe('SSR boundary', () => {
  it('keeps browser-free imports and renders declarative shadow roots', async () => {
    expect(globalThis.window).toBeUndefined();
    const escapedValue = '<script>window.serverSecret = true</script>';

    const output = await renderVarendo(html`
      <main>
        <varendo-text-field label="Name" value=${escapedValue} name="person"></varendo-text-field>
        <varendo-table
          caption="People"
          .columns=${[
            { key: 'name', label: 'Name' },
            { key: 'role', label: 'Role' },
          ]}
          .rows=${[{ name: 'Ada', role: 'Engineer' }]}
        ></varendo-table>
        <varendo-chart
          title="Activity"
          summary="A trend with an accessible data table."
          unit="events"
          .points=${[
            { label: 'Mon', value: 3 },
            { label: 'Tue', value: 5 },
          ]}
        ></varendo-chart>
      </main>
    `);

    expect(output).toContain('<varendo-text-field');
    expect(output).toContain('shadowrootmode="open"');
    expect(output).toContain('<table');
    expect(output).toContain('<svg');
    expect(output).toContain('View data table');
    expect(output).toContain('&lt;script&gt;window.serverSecret = true&lt;/script&gt;');
    expect(output).not.toContain('<script>window.serverSecret');
  });

  it('reports non-finite chart values without emitting invalid SVG geometry', async () => {
    const output = await renderVarendo(html`
      <varendo-chart title="Invalid activity" .points=${[{ label: 'Bad', value: Number.NaN }]}></varendo-chart>
    `);

    expect(output).toContain('Chart unavailable: values must be finite.');
    expect(output).not.toContain('points="NaN');
    expect(output).not.toContain('cx="NaN"');
  });

  it('keeps SVG geometry finite for finite extreme values', async () => {
    const output = await renderVarendo(html`
      <varendo-chart
        title="Extreme activity"
        .points=${[
          { label: 'Low', value: -Number.MAX_VALUE },
          { label: 'High', value: Number.MAX_VALUE },
        ]}
      ></varendo-chart>
    `);

    expect(output).not.toContain('NaN');
    expect(output).not.toContain('Infinity');
    expect(output).toContain('points="56,150 624,18"');
  });

  it('renders Indonesian chart chrome and accessible text for an Indonesian host locale', async () => {
    const output = await renderVarendo(html`
      <varendo-chart
        lang="id-ID"
        scope="Menampilkan 2 dari 3 rekaman"
        .points=${[
          { label: 'Jan', value: 4 },
          { label: 'Feb', value: null },
        ]}
      ></varendo-chart>
    `);

    const visible = output.replace(/<!--.*?-->/gs, '');
    expect(visible).toContain('<strong>Grafik</strong>');
    expect(visible).toContain('Cakupan: Menampilkan 2 dari 3 rekaman');
    expect(visible).toContain('Lihat tabel data');
    expect(visible).toContain('Nilai');
    expect(visible).toContain('Data yang hilang ditampilkan sebagai celah.');
    expect(visible).toContain('<title>Grafik data</title>');
    expect(visible).not.toContain('View data table');
  });

  it('localizes scope metadata while preserving the host scope label', () => {
    const scope = { kind: 'sample' as const, label: 'Wilayah Barat', loaded: 2, filteredTotal: 3 };
    expect(scopeText(scope, 'id-ID')).toBe('Wilayah Barat; Sampel terbatas; Menampilkan 2 dari 3 rekaman yang cocok');
    expect(scopeText(scope)).toBe('Wilayah Barat; Bounded sample; Showing 2 of 3 matching records');
  });
});
