import { html } from 'lit';
import { renderVarendo } from '@varendo/web/server';
import { HydrateVarendo } from './hydrate';
import { AdaptivePeople } from './adaptive-people';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const markup = await renderVarendo(
    html`<form><varendo-text-field label="Next person" name="person" value="Ada"></varendo-text-field></form>`,
  );
  return (
    <main>
      <h1>Varendo in Next.js</h1>
      <div id="varendo-server-proof" dangerouslySetInnerHTML={{ __html: markup }} />
      <HydrateVarendo />
      <AdaptivePeople />
    </main>
  );
}
