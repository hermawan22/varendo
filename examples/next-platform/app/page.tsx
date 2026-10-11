import { html } from 'lit';
import { renderAeliqo } from '@varendo/web/server';
import { HydrateAeliqo } from './hydrate';
import { AdaptivePeople } from './adaptive-people';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const markup = await renderAeliqo(
    html`<form><aeliqo-text-field label="Next person" name="person" value="Ada"></aeliqo-text-field></form>`,
  );
  return (
    <main>
      <h1>Varendo in Next.js</h1>
      <div id="aeliqo-server-proof" dangerouslySetInnerHTML={{ __html: markup }} />
      <HydrateAeliqo />
      <AdaptivePeople />
    </main>
  );
}
