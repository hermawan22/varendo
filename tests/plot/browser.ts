import { AeliqoPlotElement } from '../../packages/web/src/plot/index.js';
import { result, ref } from '../contracts/fixtures.js';
customElements.define('aeliqo-plot', AeliqoPlotElement);
const plot = document.createElement('aeliqo-plot') as AeliqoPlotElement;
plot.label = 'Weekly amount';
plot.result = {
  ...result,
  identity: ['id'],
  counts: { loaded: 3, population: { kind: 'exact', value: 3, populationDigest: 'population-1' } },
  fields: [
    { id: 'id', label: 'Record', type: { value: 'text', nullable: false }, role: 'identity' },
    { id: 'x', label: 'Week', type: { value: 'integer', nullable: false }, role: 'dimension' },
    {
      id: 'y',
      label: 'Amount',
      type: { value: 'decimal', nullable: true, unit: { dimension: 'money', symbol: 'USD' } },
      role: 'measure',
    },
  ],
};
plot.unit = {
  kind: 'unit',
  result: ref,
  mark: 'line',
  missing: 'gap',
  encoding: { x: { field: 'x', scale: 'linear' }, y: { field: 'y', scale: 'linear' } },
};
plot.rows = [
  { id: 'a', x: 1, y: { decimal: '1.123456789012345678' } },
  { id: 'b', x: 2, y: null },
  { id: 'c', x: 3, y: { decimal: '3.123456789012345678' } },
];
document.body.append(plot);
Object.assign(window, { plot });
