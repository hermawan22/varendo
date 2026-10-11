import {
  AeliqoAvatarElement,
  AeliqoBadgeElement,
  AeliqoButtonElement,
  AeliqoGridElement,
  AeliqoHeadingElement,
  AeliqoIconButtonElement,
  AeliqoLinkElement,
  AeliqoScrollAreaElement,
  AeliqoSeparatorElement,
  AeliqoSplitPaneElement,
  AeliqoStackElement,
  AeliqoSurfaceElement,
  AeliqoTextElement,
} from '@varendo/web/foundation';
import { appendSlottedText, cleanupCatalogRoot, createCatalogElement, createCatalogRoot } from './fixture.js';
import { catalogMountSource, catalogSource } from './source.js';
import type { CatalogExampleDefinition, CatalogExampleId, CatalogExampleMetadata } from './types.js';

const sourceImports = `import {
  AeliqoAvatarElement,
  AeliqoBadgeElement,
  AeliqoButtonElement,
  AeliqoGridElement,
  AeliqoHeadingElement,
  AeliqoIconButtonElement,
  AeliqoLinkElement,
  AeliqoScrollAreaElement,
  AeliqoSeparatorElement,
  AeliqoSplitPaneElement,
  AeliqoStackElement,
  AeliqoSurfaceElement,
  AeliqoTextElement,
} from "@varendo/web/foundation";`;

type MetadataNotes = Pick<
  CatalogExampleMetadata,
  'fixture' | 'props' | 'propsNotes' | 'states' | 'keyboard' | 'events' | 'expectedOutcome'
>;
const componentNotes: Record<string, Partial<MetadataNotes>> = {
  button: {
    fixture: 'One primary action with a host-owned save request.',
    props: ['label', 'variant', 'size', 'type', 'disabled', 'pending'],
    propsNotes: 'The host chooses the action type and pending state; the component never performs persistence.',
    states: ['ready', 'disabled', 'pending'],
    keyboard: ['Tab', 'Enter', 'Space'],
    events: ['aeliqo-action'],
    expectedOutcome: 'A cancellable action proposal is emitted when the native button is activated.',
  },
  'icon-button': {
    fixture: 'One compact action with an accessible label and an icon slot.',
    props: ['label', 'size', 'type', 'disabled', 'pending'],
    propsNotes: 'The label is required for the icon-only affordance; the host owns the action.',
    states: ['ready', 'disabled', 'pending'],
    keyboard: ['Tab', 'Enter', 'Space'],
    events: ['aeliqo-action'],
    expectedOutcome: 'The icon action remains keyboard reachable and emits the typed action proposal.',
  },
  link: {
    fixture: 'One application-resolved same-origin report destination.',
    props: ['label', 'href', 'target', 'disabled'],
    propsNotes: 'The host supplies an approved href and target; arbitrary model URLs are not interpreted.',
    states: ['ready', 'disabled'],
    keyboard: ['Tab', 'Enter'],
    events: ['aeliqo-link'],
    expectedOutcome: 'The approved link is navigable and emits a cancellable link proposal.',
  },
  text: {
    fixture: 'One trusted text value rendered as a paragraph.',
    props: ['text', 'as', 'muted'],
    propsNotes: 'Text is inserted as text content and cannot introduce markup.',
    states: ['ready'],
    keyboard: ['Not focusable by default'],
    events: ['None; content-only primitive'],
    expectedOutcome: 'The value is rendered with the requested semantic element.',
  },
  heading: {
    fixture: 'One report heading at level 2 with an independent visual size.',
    props: ['text', 'level', 'size'],
    propsNotes: 'Document level and visual size are separate so hierarchy remains truthful.',
    states: ['ready'],
    keyboard: ['Not focusable by default'],
    events: ['None; content-only primitive'],
    expectedOutcome: 'The heading contributes the requested document outline level.',
  },
  badge: {
    fixture: 'One status/category marker whose text carries the meaning.',
    props: ['text', 'tone'],
    propsNotes: 'Tone is supplemental; the visible text remains the source of meaning.',
    states: ['ready'],
    keyboard: ['Not focusable by default'],
    events: ['None; status is expressed by text'],
    expectedOutcome: 'The marker communicates its text and optional visual tone.',
  },
  avatar: {
    fixture: 'One named person without a remote image, exercising initials fallback.',
    props: ['name', 'src', 'alt', 'size', 'decorative'],
    propsNotes: 'Use decorative only when adjacent content already supplies the person identity.',
    states: ['ready', 'error'],
    keyboard: ['Not focusable by default'],
    events: ['None; image failure becomes initials fallback'],
    expectedOutcome: 'The avatar exposes an accessible name or initials fallback without requiring a network request.',
  },
  separator: {
    fixture: 'One horizontal separator between report sections.',
    props: ['orientation', 'decorative'],
    propsNotes: 'Set decorative false when the boundary is meaningful to assistive technology.',
    states: ['ready'],
    keyboard: ['Not focusable by default'],
    events: ['None; structural primitive'],
    expectedOutcome: 'The boundary uses hr or separator semantics according to the host choice.',
  },
  surface: {
    fixture: 'One labelled section containing ordinary light-DOM content.',
    props: ['as', 'tone', 'label', 'labelledBy'],
    propsNotes: 'The host owns the section label and chooses canvas, surface, or raised treatment.',
    states: ['ready'],
    keyboard: ['Focus remains with child content'],
    events: ['None; container primitive'],
    expectedOutcome: 'Content is grouped without adding card interaction or data semantics.',
  },
  stack: {
    fixture: 'Two short labels arranged in a row with a bounded gap.',
    props: ['direction', 'gap', 'align', 'justify', 'wrap'],
    propsNotes: 'Layout props adapt the arrangement; children retain their own semantics.',
    states: ['ready'],
    keyboard: ['Focus order follows child order'],
    events: ['None; layout primitive'],
    expectedOutcome: 'Children are laid out with the declared flex behavior and no hidden focus changes.',
  },
  grid: {
    fixture: 'Two short labels arranged in a responsive two-column grid.',
    props: ['columns', 'gap', 'minItem'],
    propsNotes: 'minItem controls narrow-screen adaptation without removing content.',
    states: ['ready'],
    keyboard: ['Focus order follows child order'],
    events: ['None; layout primitive'],
    expectedOutcome: 'Items use the requested grid columns and remain available at small widths.',
  },
  'split-pane': {
    fixture: 'Two labelled panes with a keyboard-resizable divider.',
    props: [
      'orientation',
      'defaultPosition',
      'position',
      'min',
      'max',
      'step',
      'disabled',
      'primaryLabel',
      'secondaryLabel',
    ],
    propsNotes: 'Use position for controlled layout and defaultPosition for initial uncontrolled state.',
    states: ['ready', 'disabled'],
    keyboard: ['Tab', 'Arrow keys', 'Home', 'End'],
    events: ['aeliqo-split-change'],
    expectedOutcome: 'The divider exposes its range and emits a typed position proposal when adjusted.',
  },
  'scroll-area': {
    fixture: 'A labelled scroll region containing longer report content.',
    props: ['axis', 'label', 'tabIndex'],
    propsNotes: 'The host supplies an accessible label and controls whether the region participates in focus order.',
    states: ['ready'],
    keyboard: ['Tab', 'Arrow keys when focused'],
    events: ['None; native scrolling only'],
    expectedOutcome: 'Overflow remains scrollable and the region retains a discoverable focus boundary.',
  },
};

const mount = (id: CatalogExampleId, fn: (root: HTMLElement) => void): CatalogExampleDefinition => ({
  metadata: {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    family: 'foundation',
    description: 'A direct foundation primitive with native semantics and tokenized layout.',
    fixture: 'A fresh application-owned container with only the primitive and its direct content.',
    props: ['label or text', 'disabled', 'aria-label'],
    propsNotes:
      'Set the smallest semantic props needed by the host; content remains ordinary light-DOM children or slots.',
    states: ['ready', 'disabled', 'read-only'],
    keyboard: ['Tab', 'Enter or Space when actionable', 'native focus order'],
    events: ['aeliqo-action where the primitive is actionable'],
    expectedOutcome:
      'The primitive renders directly in the supplied host and preserves its native interaction boundary.',
    ...componentNotes[id],
    source: catalogSource({ imports: sourceImports, mount: catalogMountSource(id) }),
  },
  mount(container) {
    const root = createCatalogRoot(container);
    fn(root);
    return cleanupCatalogRoot(root);
  },
});

export const foundationExamples: readonly CatalogExampleDefinition[] = [
  mount('button', (root) => {
    const element = createCatalogElement<AeliqoButtonElement>('aeliqo-button', root, AeliqoButtonElement);
    element.label = 'Save report';
    element.variant = 'solid';
    element.type = 'button';
  }),
  mount('icon-button', (root) => {
    const element = createCatalogElement<AeliqoIconButtonElement>('aeliqo-icon-button', root, AeliqoIconButtonElement);
    element.label = 'Open details';
    appendSlottedText(element, 'icon', '⋯');
  }),
  mount('link', (root) => {
    const element = createCatalogElement<AeliqoLinkElement>('aeliqo-link', root, AeliqoLinkElement);
    element.label = 'View report';
    element.href = '/reports/weekly';
    element.target = '_self';
  }),
  mount('text', (root) => {
    const element = createCatalogElement<AeliqoTextElement>('aeliqo-text', root, AeliqoTextElement);
    element.text = 'A plain, trusted text value.';
    element.as = 'p';
  }),
  mount('heading', (root) => {
    const element = createCatalogElement<AeliqoHeadingElement>('aeliqo-heading', root, AeliqoHeadingElement);
    element.level = 2;
    element.size = 'heading';
    element.text = 'Weekly report';
  }),
  mount('badge', (root) => {
    const element = createCatalogElement<AeliqoBadgeElement>('aeliqo-badge', root, AeliqoBadgeElement);
    element.text = 'Ready';
    element.tone = 'success';
  }),
  mount('avatar', (root) => {
    const element = createCatalogElement<AeliqoAvatarElement>('aeliqo-avatar', root, AeliqoAvatarElement);
    element.name = 'Ada Lovelace';
    element.alt = 'Ada Lovelace';
    element.size = 'medium';
  }),
  mount('separator', (root) => {
    const element = createCatalogElement<AeliqoSeparatorElement>('aeliqo-separator', root, AeliqoSeparatorElement);
    element.orientation = 'horizontal';
  }),
  mount('surface', (root) => {
    const element = createCatalogElement<AeliqoSurfaceElement>('aeliqo-surface', root, AeliqoSurfaceElement);
    element.as = 'section';
    element.tone = 'surface';
    element.label = 'Report panel';
    element.textContent = 'Bounded surface content';
  }),
  mount('stack', (root) => {
    const element = createCatalogElement<AeliqoStackElement>('aeliqo-stack', root, AeliqoStackElement);
    element.direction = 'row';
    element.gap = 12;
    element.align = 'center';
    for (const text of ['First', 'Second']) {
      const item = document.createElement('span');
      item.textContent = text;
      element.append(item);
    }
  }),
  mount('grid', (root) => {
    const element = createCatalogElement<AeliqoGridElement>('aeliqo-grid', root, AeliqoGridElement);
    element.columns = 2;
    element.gap = 16;
    element.minItem = 'small';
    for (const text of ['Left', 'Right']) {
      const item = document.createElement('span');
      item.textContent = text;
      element.append(item);
    }
  }),
  mount('split-pane', (root) => {
    const element = createCatalogElement<AeliqoSplitPaneElement>('aeliqo-split-pane', root, AeliqoSplitPaneElement);
    element.defaultPosition = 42;
    element.min = 20;
    element.max = 80;
    element.primaryLabel = 'Primary panel';
    element.secondaryLabel = 'Secondary panel';
    appendSlottedText(element, 'start', 'Primary panel');
    appendSlottedText(element, 'end', 'Secondary panel');
  }),
  mount('scroll-area', (root) => {
    const element = createCatalogElement<AeliqoScrollAreaElement>('aeliqo-scroll-area', root, AeliqoScrollAreaElement);
    element.axis = 'y';
    element.label = 'Report rows';
    element.tabIndex = 0;
    const content = document.createElement('p');
    content.textContent = 'Scrollable report content that retains focus visibility.';
    element.append(content);
  }),
];
