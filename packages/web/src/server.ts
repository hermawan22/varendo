import { renderThunked } from '@lit-labs/ssr';
import { collectResult } from '@lit-labs/ssr/lib/render-result.js';
import type { TemplateResult } from 'lit';
import { registerVarendoElements } from './register.js';

/** Render a trusted, pre-resolved Lit template through the isolated SSR entry. */
export async function renderVarendo(template: TemplateResult): Promise<string> {
  registerVarendoElements();
  return collectResult(renderThunked(template));
}
