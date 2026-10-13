import { VarendoAvatarElement } from '../../packages/web/src/foundation/avatar.js';
import { VarendoBadgeElement } from '../../packages/web/src/foundation/badge.js';
import { VarendoButtonElement } from '../../packages/web/src/foundation/button.js';
import { VarendoGridElement } from '../../packages/web/src/foundation/grid.js';
import { VarendoHeadingElement } from '../../packages/web/src/foundation/heading.js';
import { VarendoIconButtonElement } from '../../packages/web/src/foundation/icon-button.js';
import { VarendoLinkElement } from '../../packages/web/src/foundation/link.js';
import { VarendoScrollAreaElement } from '../../packages/web/src/foundation/scroll-area.js';
import { VarendoSeparatorElement } from '../../packages/web/src/foundation/separator.js';
import { VarendoSplitPaneElement } from '../../packages/web/src/foundation/split-pane.js';
import { VarendoStackElement } from '../../packages/web/src/foundation/stack.js';
import { VarendoSurfaceElement } from '../../packages/web/src/foundation/surface.js';
import { VarendoTextElement } from '../../packages/web/src/foundation/text.js';

const registrations: readonly [string, CustomElementConstructor][] = [
  ['varendo-avatar', VarendoAvatarElement],
  ['varendo-badge', VarendoBadgeElement],
  ['varendo-button', VarendoButtonElement],
  ['varendo-grid', VarendoGridElement],
  ['varendo-heading', VarendoHeadingElement],
  ['varendo-icon-button', VarendoIconButtonElement],
  ['varendo-link', VarendoLinkElement],
  ['varendo-scroll-area', VarendoScrollAreaElement],
  ['varendo-separator', VarendoSeparatorElement],
  ['varendo-split-pane', VarendoSplitPaneElement],
  ['varendo-stack', VarendoStackElement],
  ['varendo-surface', VarendoSurfaceElement],
  ['varendo-text', VarendoTextElement],
];
for (const [name, constructor] of registrations) customElements.define(name, constructor);

const fixture = document.querySelector<HTMLElement>('#fixture');
if (fixture === null) throw new Error('Foundation fixture root is missing.');
const events: unknown[] = [];

const form = document.createElement('form');
form.id = 'action-form';
form.innerHTML = `
  <input id="draft" name="draft" value="initial" />
  <varendo-button id="submit" type="submit" name="intent" value="save" label="Save"></varendo-button>
  <varendo-button id="reset" type="reset" label="Reset"></varendo-button>
  <varendo-button id="cancelled" type="submit" label="Cancelled"></varendo-button>
  <varendo-icon-button id="icon" label="Open details"><span slot="icon">+</span></varendo-icon-button>
</form>`;
fixture.append(form);

const content = document.createElement('varendo-surface');
content.id = 'composition';
content.innerHTML = `
  <varendo-heading id="heading" level="3" size="display">A very long heading that remains readable when text is zoomed.</varendo-heading>
  <varendo-stack direction="row" gap="8"><varendo-text text="Plain text"></varendo-text><varendo-badge tone="success" text="Ready"></varendo-badge></varendo-stack>
  <varendo-grid columns="3" min-item="small"><varendo-text text="One"></varendo-text><varendo-text text="Two"></varendo-text></varendo-grid>
  <varendo-separator></varendo-separator>
  <varendo-avatar id="avatar" name="Ada Lovelace" src="javascript:alert(1)"></varendo-avatar>
  <varendo-link id="unsafe-link" href="javascript:alert(1)" label="Unsafe"></varendo-link>
  <varendo-link id="external-link" href="/approved" target="_blank" label="Open approved"></varendo-link>
  <varendo-scroll-area id="scroll" label="Results"><p>Scrollable content</p></varendo-scroll-area>
  <varendo-scroll-area id="constrained-scroll" label="Constrained results" style="block-size: 100px; inline-size: 240px"><div style="block-size: 400px">Tall scroll content</div></varendo-scroll-area>
  <varendo-separator id="vertical-separator" style="block-size: 100px; inline-size: 20px"></varendo-separator>
  <varendo-split-pane id="split" style="block-size: 120px; inline-size: 320px"><span slot="start">Start</span><span slot="end">End</span></varendo-split-pane>
  <varendo-split-pane id="vertical-split" orientation="vertical" style="block-size: 240px; inline-size: 320px"><span slot="start">Top</span><span slot="end">Bottom</span></varendo-split-pane>`;
fixture.append(content);
const surfaceLabel = document.createElement('h2');
surfaceLabel.id = 'surface-label';
surfaceLabel.textContent = 'Panel title';
fixture.prepend(surfaceLabel);
const labelledSurface = document.createElement('varendo-surface');
labelledSurface.id = 'labelled-surface';
labelledSurface.setAttribute('labelled-by', surfaceLabel.id);
labelledSurface.textContent = 'Panel content';
fixture.prepend(labelledSurface);
content.addEventListener('varendo-split-change', (event) => events.push({ kind: 'split', event }));

form.addEventListener('varendo-action', (event) => events.push({ kind: 'action', event }));
form.querySelector('#cancelled')?.addEventListener('varendo-action', (event) => event.preventDefault());
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
  varendoFoundationReady: true,
  varendoFoundationEvents: events,
  varendoFoundationForm: form,
  varendoFoundationStats: () => ({ submits, resets, submittedEntries }),
});
