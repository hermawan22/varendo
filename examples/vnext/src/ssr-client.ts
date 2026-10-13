import '@lit-labs/ssr-client/lit-element-hydrate-support.js';
import { registerVarendoElements } from '@varendo/web/register';

interface PublicTableState {
  readonly columns: readonly { readonly key: string; readonly label: string }[];
  readonly rows: readonly Record<string, string>[];
}

interface HydratableTable extends HTMLElement {
  columns: PublicTableState['columns'];
  rows: PublicTableState['rows'];
}

function hydrationDelay(): number {
  const value = new URLSearchParams(window.location.search).get('hydrationDelay');
  const parsed = value === null ? 0 : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 1_000) : 0;
}

async function hydrate(): Promise<void> {
  const delay = hydrationDelay();
  if (delay > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
  const table = document.querySelector<HydratableTable>('#ssr-people varendo-table');
  const state = document.querySelector<HTMLScriptElement>('#ssr-public-table-state')?.textContent;
  if (table === null || state === undefined || state === null) throw new Error('Missing public SSR table state.');
  const publicState = JSON.parse(state) as PublicTableState;
  table.columns = publicState.columns;
  table.rows = publicState.rows;
  registerVarendoElements();
  await customElements.whenDefined('varendo-table');
  const status = document.querySelector<HTMLElement>('#ssr-status');
  if (status !== null) status.textContent = 'Hydrated people table';
  document.documentElement.dataset.varendoHydrated = 'true';
}

void hydrate().catch((error: unknown) => {
  document.documentElement.dataset.varendoHydrationError = error instanceof Error ? error.message : String(error);
});
