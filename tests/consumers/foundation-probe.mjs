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
import {${names.map((n) => 'Varendo' + n).join(',')}} from '@varendo/react/foundation';
import {VarendoButtonElement} from '@varendo/web/button';
import {VarendoScrollAreaElement} from '@varendo/web/scroll-area';
const content=<VarendoSurface><VarendoHeading text="Title"/><VarendoButton label="Save" onVarendoAction={e=>{const source:'user'=e.detail.source;void source;}}/><VarendoIconButton label="Options"/><VarendoLink label="Profile" href="/profile" onVarendoLink={e=>{const modified:boolean|undefined=e.detail.modified;void modified;}}/><VarendoText text="Copy"/><VarendoBadge text="Draft"/><VarendoAvatar name="Ada"/><VarendoSeparator/><VarendoStack/><VarendoGrid/><VarendoSplitPane onVarendoSplitChange={e=>{const position:number=e.detail.position;void position;}}/><VarendoScrollArea/></VarendoSurface>;
void [content,VarendoButtonElement,VarendoScrollAreaElement];
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
import {renderVarendo} from '@varendo/web/server';
import {html} from 'lit';
const rendered=await renderVarendo(html\`<varendo-surface><varendo-heading text="Settings"></varendo-heading><varendo-button label="Save"></varendo-button><varendo-icon-button label="Options"></varendo-icon-button><varendo-link label="Profile" href="/profile"></varendo-link><varendo-text text="Description"></varendo-text><varendo-badge text="Draft"></varendo-badge><varendo-avatar name="Ada Lovelace"></varendo-avatar><varendo-separator></varendo-separator><varendo-stack></varendo-stack><varendo-grid></varendo-grid><varendo-split-pane><span slot="start">One</span><span slot="end">Two</span></varendo-split-pane><varendo-scroll-area label="Details"></varendo-scroll-area></varendo-surface>\`);
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
import {VarendoButton,VarendoText,VarendoSurface,VarendoHeading,VarendoLink,VarendoIconButton,VarendoBadge,VarendoAvatar,VarendoSeparator,VarendoStack,VarendoGrid,VarendoSplitPane,VarendoScrollArea} from '@varendo/react/foundation';
import {registerVarendoElements} from '@varendo/web/register';
registerVarendoElements();let actions=0;
createRoot(document.querySelector('#root')).render(h(VarendoSurface,null,
 h(VarendoHeading,{text:'Installed preferences'}),h(VarendoButton,{label:'Save installed',onVarendoAction:event=>{event.preventDefault();actions++;document.querySelector('#counter').textContent=String(actions);}}),h('output',{id:'counter'},'0'),
 h(VarendoIconButton,{label:'More'}),h(VarendoLink,{label:'Profile',href:'#profile'}),h(VarendoText,{text:'Registered copy'}),h(VarendoBadge,{text:'Draft'}),h(VarendoAvatar,{name:'Ada Lovelace'}),h(VarendoSeparator),h(VarendoStack,null,h('span',null,'Stack content')),h(VarendoGrid,null,h('span',null,'Grid content')),h(VarendoSplitPane,{style:{height:'100px'}},h('span',{slot:'start'},'Start'),h('span',{slot:'end'},'End')),h(VarendoScrollArea,{label:'Details'},'Scrollable details')));
`,
  );
  run([join(consumer, 'node_modules/.bin/vite'), 'build'], consumer);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Save installed', exact: true }).waitFor();
  assert.equal(await page.locator('main varendo-surface').count(), 1);
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
    assert.equal(await page.locator('varendo-' + tag).count(), 1, tag);
  await page.getByRole('button', { name: 'Save installed', exact: true }).click();
  assert.equal(await page.locator('#counter').textContent(), '1');
  await page.screenshot({ path: join(runDirectory, 'installed-foundations.png') });
  // A separate leaf entry proves the direct button avoids React, core and region.
  await writeFile(
    join(consumer, 'browser.js'),
    `import {VarendoButtonElement} from '@varendo/web/button';customElements.define('varendo-button',VarendoButtonElement);const button=document.createElement('varendo-button');button.label='Direct installed';document.body.append(button);`,
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
