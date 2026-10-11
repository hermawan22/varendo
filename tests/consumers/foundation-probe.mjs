/** Executed against the installed tarballs by platform-tarballs.mjs. */
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function foundationProbe({ consumer, runDirectory, run, page, origin }) {
  const names = [
    'Button',
    'IconButton',
    'Link',
    'Text',
    'Heading',
    'Badge',
    'Avatar',
    'Separator',
    'Surface',
    'Stack',
    'Grid',
    'SplitPane',
    'ScrollArea',
  ];
  await writeFile(
    join(consumer, 'foundation.tsx'),
    `
import {${names.map((n) => 'Aeliqo' + n).join(',')}} from '@varendo/react/foundation';
import {AeliqoButtonElement} from '@varendo/web/button';
import {AeliqoScrollAreaElement} from '@varendo/web/scroll-area';
const content=<AeliqoSurface><AeliqoHeading text="Title"/><AeliqoButton label="Save" onAeliqoAction={e=>{const source:'user'=e.detail.source;void source;}}/><AeliqoIconButton label="Options"/><AeliqoLink label="Profile" href="/profile" onAeliqoLink={e=>{const modified:boolean|undefined=e.detail.modified;void modified;}}/><AeliqoText text="Copy"/><AeliqoBadge text="Draft"/><AeliqoAvatar name="Ada"/><AeliqoSeparator/><AeliqoStack/><AeliqoGrid/><AeliqoSplitPane onAeliqoSplitChange={e=>{const position:number=e.detail.position;void position;}}/><AeliqoScrollArea/></AeliqoSurface>;
void [content,AeliqoButtonElement,AeliqoScrollAreaElement];
`,
  );
  const config = JSON.parse(await readFile(join(consumer, 'tsconfig.json'), 'utf8'));
  config.files = ['foundation.tsx'];
  await writeFile(join(consumer, 'foundation-tsconfig.json'), JSON.stringify(config));
  run([join(consumer, 'node_modules/.bin/tsc'), '-p', 'foundation-tsconfig.json'], consumer);
  await writeFile(
    join(consumer, 'foundation-ssr.mjs'),
    `
import assert from 'node:assert/strict';
import {renderAeliqo} from '@varendo/web/server';
import {html} from 'lit';
const rendered=await renderAeliqo(html\`<aeliqo-surface><aeliqo-heading text="Settings"></aeliqo-heading><aeliqo-button label="Save"></aeliqo-button><aeliqo-icon-button label="Options"></aeliqo-icon-button><aeliqo-link label="Profile" href="/profile"></aeliqo-link><aeliqo-text text="Description"></aeliqo-text><aeliqo-badge text="Draft"></aeliqo-badge><aeliqo-avatar name="Ada Lovelace"></aeliqo-avatar><aeliqo-separator></aeliqo-separator><aeliqo-stack></aeliqo-stack><aeliqo-grid></aeliqo-grid><aeliqo-split-pane><span slot="start">One</span><span slot="end">Two</span></aeliqo-split-pane><aeliqo-scroll-area label="Details"></aeliqo-scroll-area></aeliqo-surface>\`);
assert.equal((rendered.match(/shadowrootmode="open"/g)||[]).length,13);
for(const text of ['Settings','Save','Options','Profile','Description','Draft','AL','Resize panes','Details'])assert(rendered.includes(text),text);
console.log('All thirteen installed foundation elements rendered with Lit SSR.');
`,
  );
  const ssr = run(['node', 'foundation-ssr.mjs'], consumer);
  await writeFile(
    join(consumer, 'index.html'),
    '<!doctype html><html lang="en"><title>Installed foundations</title><body><main id="root"></main><script type="module" src="/browser.js"></script></body></html>',
  );
  await writeFile(
    join(consumer, 'browser.js'),
    `
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {AeliqoButton,AeliqoText,AeliqoSurface,AeliqoHeading,AeliqoLink,AeliqoIconButton,AeliqoBadge,AeliqoAvatar,AeliqoSeparator,AeliqoStack,AeliqoGrid,AeliqoSplitPane,AeliqoScrollArea} from '@varendo/react/foundation';
import {registerAeliqoElements} from '@varendo/web/register';
registerAeliqoElements();let actions=0;
createRoot(document.querySelector('#root')).render(h(AeliqoSurface,null,
 h(AeliqoHeading,{text:'Installed preferences'}),h(AeliqoButton,{label:'Save installed',onAeliqoAction:event=>{event.preventDefault();actions++;document.querySelector('#counter').textContent=String(actions);}}),h('output',{id:'counter'},'0'),
 h(AeliqoIconButton,{label:'More'}),h(AeliqoLink,{label:'Profile',href:'#profile'}),h(AeliqoText,{text:'Registered copy'}),h(AeliqoBadge,{text:'Draft'}),h(AeliqoAvatar,{name:'Ada Lovelace'}),h(AeliqoSeparator),h(AeliqoStack,null,h('span',null,'Stack content')),h(AeliqoGrid,null,h('span',null,'Grid content')),h(AeliqoSplitPane,{style:{height:'100px'}},h('span',{slot:'start'},'Start'),h('span',{slot:'end'},'End')),h(AeliqoScrollArea,{label:'Details'},'Scrollable details')));
`,
  );
  run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Save installed', exact: true }).waitFor();
  assert.equal(await page.locator('main aeliqo-surface').count(), 1);
  for (const tag of [
    'button',
    'icon-button',
    'link',
    'text',
    'heading',
    'badge',
    'avatar',
    'separator',
    'surface',
    'stack',
    'grid',
    'split-pane',
    'scroll-area',
  ])
    assert.equal(await page.locator('aeliqo-' + tag).count(), 1, tag);
  await page.getByRole('button', { name: 'Save installed', exact: true }).click();
  assert.equal(await page.locator('#counter').textContent(), '1');
  await page.screenshot({ path: join(runDirectory, 'installed-foundations.png') });
  // A separate leaf entry proves the direct button avoids React, core and region.
  await writeFile(
    join(consumer, 'browser.js'),
    `import {AeliqoButtonElement} from '@varendo/web/button';customElements.define('aeliqo-button',AeliqoButtonElement);const button=document.createElement('aeliqo-button');button.label='Direct installed';document.body.append(button);`,
  );
  run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);
  const modules = JSON.parse(await readFile(join(consumer, 'dist/modules.json'), 'utf8'));
  assert.deepEqual(
    modules.filter((id) => /\/(?:core|runtime|agent|react|region|chart)\//.test(id) || /react-dom/.test(id)),
    [],
  );
  await page.goto(origin);
  await page.getByRole('button', { name: 'Direct installed' }).waitFor();
  return {
    ssr,
    components: names,
    standaloneButtonModules: modules,
    screenshot: join(runDirectory, 'installed-foundations.png'),
  };
}
