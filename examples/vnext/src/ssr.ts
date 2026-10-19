import { html } from 'lit';
import { renderVarendo } from '@varendo/web/server';

type Direction = 'ltr' | 'rtl';
type Theme = 'light' | 'dark';

export interface SsrPeopleRequest {
  readonly principal: string | undefined;
  readonly direction: string | undefined;
  readonly theme: string | undefined;
}

interface PublicPeopleSnapshot {
  readonly id: 'alpha' | 'beta';
  readonly snapshotId: string;
  readonly rows: readonly { readonly name: string; readonly team: string }[];
}

const columns = Object.freeze([
  { key: 'name', label: 'Name' },
  { key: 'team', label: 'Team' },
]);

/**
 * Maps a host-authenticated synthetic principal to the small public snapshot
 * for this request. Nothing request-specific is retained at module scope.
 */
function createPublicPeopleSnapshot(principal: string | undefined): PublicPeopleSnapshot {
  if (principal === 'beta') {
    return {
      id: 'beta',
      snapshotId: 'people-beta-v1',
      rows: [{ name: 'Bela Rossi', team: 'Operations' }],
    };
  }
  return {
    id: 'alpha',
    snapshotId: 'people-alpha-v1',
    rows: [{ name: 'Ada Chen', team: 'Design' }],
  };
}

function directionFor(value: string | undefined): Direction {
  return value === 'rtl' ? 'rtl' : 'ltr';
}

function themeFor(value: string | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

/** Renders useful, public DOM before client code is loaded. */
export async function renderSsrPeoplePage(request: SsrPeopleRequest): Promise<string> {
  const snapshot = createPublicPeopleSnapshot(request.principal);
  const direction = directionFor(request.direction);
  const theme = themeFor(request.theme);
  const table = await renderVarendo(html`
    <varendo-table caption="People visible to this request" .columns=${columns} .rows=${snapshot.rows}></varendo-table>
  `);
  const publicState = JSON.stringify({ columns, rows: snapshot.rows }).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en" dir="${direction}" data-theme="${theme}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Request-scoped people</title>
    <style>
      :root { color-scheme: ${theme}; font: 16px/1.4 system-ui, sans-serif; }
      body { margin: 0; padding: 2rem; background: ${theme === 'dark' ? '#111827' : '#f8fafc'}; color: ${theme === 'dark' ? '#f8fafc' : '#172033'}; }
      main { max-width: 48rem; margin: 0 auto; }
    </style>
  </head>
  <body>
    <main>
      <h1>People</h1>
      <p id="ssr-status" role="status">Server-rendered people table</p>
      <section id="ssr-people" data-snapshot-id="${snapshot.snapshotId}" aria-labelledby="people-heading">
        <h2 id="people-heading">Request-scoped people</h2>
        ${table}
      </section>
    </main>
    <script id="ssr-public-table-state" type="application/json">${publicState}</script>
    <script type="module" src="/src/ssr-client.ts"></script>
  </body>
</html>`;
}
