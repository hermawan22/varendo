import { AeliqoAvatarElement } from '../../packages/web/src/foundation/avatar.js';
import { AeliqoBadgeElement } from '../../packages/web/src/foundation/badge.js';
import { AeliqoButtonElement } from '../../packages/web/src/foundation/button.js';
import { AeliqoGridElement } from '../../packages/web/src/foundation/grid.js';
import { AeliqoHeadingElement } from '../../packages/web/src/foundation/heading.js';
import { AeliqoIconButtonElement } from '../../packages/web/src/foundation/icon-button.js';
import { AeliqoLinkElement } from '../../packages/web/src/foundation/link.js';
import { AeliqoScrollAreaElement } from '../../packages/web/src/foundation/scroll-area.js';
import { AeliqoSeparatorElement } from '../../packages/web/src/foundation/separator.js';
import { AeliqoSplitPaneElement } from '../../packages/web/src/foundation/split-pane.js';
import { AeliqoStackElement } from '../../packages/web/src/foundation/stack.js';
import { AeliqoSurfaceElement } from '../../packages/web/src/foundation/surface.js';
import { AeliqoTextElement } from '../../packages/web/src/foundation/text.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['aeliqo-avatar', AeliqoAvatarElement],
  ['aeliqo-badge', AeliqoBadgeElement],
  ['aeliqo-button', AeliqoButtonElement],
  ['aeliqo-grid', AeliqoGridElement],
  ['aeliqo-heading', AeliqoHeadingElement],
  ['aeliqo-icon-button', AeliqoIconButtonElement],
  ['aeliqo-link', AeliqoLinkElement],
  ['aeliqo-scroll-area', AeliqoScrollAreaElement],
  ['aeliqo-separator', AeliqoSeparatorElement],
  ['aeliqo-split-pane', AeliqoSplitPaneElement],
  ['aeliqo-stack', AeliqoStackElement],
  ['aeliqo-surface', AeliqoSurfaceElement],
  ['aeliqo-text', AeliqoTextElement],
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Foundation fixture root is missing.');
const events: unknown[] = [];

const form = document.createElement('form');
form.id = 'action-form';
form.innerHTML = `
  <input id="draft" name="draft" value="initial" />
  <aeliqo-button id="submit" type="submit" name="intent" value="save" label="Save"></aeliqo-button>
  <aeliqo-button id="reset" type="reset" label="Reset"></aeliqo-button>
  <aeliqo-button id="cancelled" type="submit" label="Cancelled"></aeliqo-button>
  <aeliqo-icon-button id="icon" label="Open details"><span slot="icon">+</span></aeliqo-icon-button>
</form>`;
fixture.append(form);

const content = document.createElement('aeliqo-surface');
content.id = 'composition';
content.innerHTML = `
  <aeliqo-heading id="heading" level="3" size="display">A very long heading that remains readable when text is zoomed.</aeliqo-heading>
  <aeliqo-stack direction="row" gap="8"><aeliqo-text text="Plain text"></aeliqo-text><aeliqo-badge tone="success" text="Ready"></aeliqo-badge></aeliqo-stack>
  <aeliqo-grid columns="3" min-item="small"><aeliqo-text text="One"></aeliqo-text><aeliqo-text text="Two"></aeliqo-text></aeliqo-grid>
  <aeliqo-separator></aeliqo-separator>
  <aeliqo-avatar id="avatar" name="Ada Lovelace" src="javascript:alert(1)"></aeliqo-avatar>
  <aeliqo-link id="unsafe-link" href="javascript:alert(1)" label="Unsafe"></aeliqo-link>
  <aeliqo-link id="external-link" href="/approved" target="_blank" label="Open approved"></aeliqo-link>
  <aeliqo-scroll-area id="scroll" label="Results"><p>Scrollable content</p></aeliqo-scroll-area>
  <aeliqo-scroll-area id="constrained-scroll" label="Constrained results" style="block-size: 100px; inline-size: 240px"><div style="block-size: 400px">Tall scroll content</div></aeliqo-scroll-area>
  <aeliqo-separator id="vertical-separator" style="block-size: 100px; inline-size: 20px"></aeliqo-separator>
  <aeliqo-split-pane id="split" style="block-size: 120px; inline-size: 320px"><span slot="start">Start</span><span slot="end">End</span></aeliqo-split-pane>
  <aeliqo-split-pane id="vertical-split" orientation="vertical" style="block-size: 240px; inline-size: 320px"><span slot="start">Top</span><span slot="end">Bottom</span></aeliqo-split-pane>`;
fixture.append(content);
const surfaceLabel = document.createElement('h2');
surfaceLabel.id = 'surface-label';
surfaceLabel.textContent = 'Panel title';
fixture.prepend(surfaceLabel);
const labelledSurface = document.createElement('aeliqo-surface');
labelledSurface.id = 'labelled-surface';
labelledSurface.setAttribute('labelled-by', surfaceLabel.id);
labelledSurface.textContent = 'Panel content';
fixture.prepend(labelledSurface);
content.addEventListener('aeliqo-split-change', (event) => events.push({ kind: 'split', event }));

form.addEventListener('aeliqo-action', (event) => events.push({ kind: 'action', event }));
form.querySelector('#cancelled')?.addEventListener('aeliqo-action', (event) => event.preventDefault());
let submits = 0;
let resets = 0;
let submittedEntries: readonly [string, FormDataEntryValue][] = [];
form.addEventListener('submit', (event) => {
  event.preventDefault();
  submits += 1;
  submittedEntries = [...new FormData(form).entries()];
});
form.addEventListener('reset', () => {
  resets += 1;
});

Object.assign(window, {
  aeliqoFoundationReady: true,
  aeliqoFoundationEvents: events,
  aeliqoFoundationForm: form,
  aeliqoFoundationStats: () => ({ submits, resets, submittedEntries }),
});
