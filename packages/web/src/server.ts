import { renderThunked } from '@lit-labs/ssr';
import { collectResult } from '@lit-labs/ssr/lib/render-result.js';
import type { TemplateResult } from 'lit';
import { registerAeliqoElements } from './register.js';

/** Render a trusted, pre-resolved Lit template through the isolated SSR entry. */
export async function renderAeliqo(template: TemplateResult): Promise<string> {
  registerAeliqoElements();
  return collectResult(renderThunked(template));
}
