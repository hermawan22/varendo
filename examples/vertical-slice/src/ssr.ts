import { html } from 'lit';
import { renderAeliqo } from '@varendo/web/server';
import { aeliqoStandaloneThemeStyles } from '@varendo/web/styles';
import { createHrViewSession } from './view-session.js';

/** Server-side public synthetic fixture: the same raw source, evaluator and composition pass. */
export async function renderHrPage(): Promise<string> {
  const session = await createHrViewSession();
  try {
    const state = { presentation: session.presentation, results: session.results };
    const markup = await renderAeliqo(
      html`<aeliqo-region
        id="ssr-region"
        data-aeliqo-theme="inherit"
        defer-hydration
        .presentation=${state.presentation}
        .results=${state.results}
      ></aeliqo-region>`,
    );
    const serialized = JSON.stringify(state).replaceAll('<', '\\u003c');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Server-rendered absence overview</title><link rel="stylesheet" href="/src/styles.css"><style>${aeliqoStandaloneThemeStyles.cssText}</style></head><body><main data-aeliqo-theme="light"><h1>Absence overview</h1><p>Synthetic records · Server-rendered with unknown viewport measurements.</p>${markup}<p id="hydration-status" role="status">Server-rendered view.</p></main><script id="initial-state" type="application/json">${serialized}</script><script type="module" src="/src/ssr-client.ts"></script></body></html>`;
  } finally {
    session.dispose();
  }
}
