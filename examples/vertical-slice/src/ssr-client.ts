import '@lit-labs/ssr-client/lit-element-hydrate-support.js';
import { stableTableRowKey } from '@varendo/web/table';
import type { VarendoRegionElement, VarendoRegionSnapshot } from '@varendo/web/region';

const element = document.querySelector<VarendoRegionElement>('#ssr-region')!;
const initialState = JSON.parse(document.querySelector('#initial-state')!.textContent!) as VarendoRegionSnapshot;
const serverTable = element.shadowRoot?.querySelector('varendo-table');
element.presentation = initialState.presentation;
element.results = initialState.results;
element.onSemanticInteraction = (request) => {
  document.querySelector('#hydration-status')!.textContent =
    request.payload.kind === 'selection' && request.payload.selection.mode === 'ids'
      ? `Selected ${request.payload.selection.keys.map((key) => initialState.results.flatMap((result) => result.rows).find((row) => stableTableRowKey(row, ['employee_id']) === key)?.employee_id ?? 'Unknown employee').join(', ')} after hydration.`
      : 'Selection cleared after hydration.';
};
const { registerVarendoElements } = await import('@varendo/web');
registerVarendoElements();
element.removeAttribute('defer-hydration');
await element.updateComplete;
element.dataset.hydrated = 'true';
element.dataset.preserved = String(
  serverTable !== null && serverTable === element.shadowRoot?.querySelector('varendo-table'),
);
document.querySelector('#hydration-status')!.textContent = 'Hydrated from the server-rendered view.';
