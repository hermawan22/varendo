import {
  AeliqoAlertElement,
  AeliqoDialogElement,
  AeliqoDrawerElement,
  AeliqoEmptyStateElement,
  AeliqoPopoverElement,
  AeliqoProgressElement,
  AeliqoSkeletonElement,
  AeliqoToastElement,
  AeliqoTooltipElement,
} from '@varendo/web/feedback';
import { cleanupCatalogRoot, createCatalogElement, createCatalogRoot } from './fixture.js';
import { catalogMountSource, catalogSource } from './source.js';
import type { CatalogExampleDefinition, CatalogExampleId, CatalogExampleMetadata } from './types.js';

const sourceImports = `import {
  AeliqoAlertElement,
  AeliqoDialogElement,
  AeliqoDrawerElement,
  AeliqoEmptyStateElement,
  AeliqoPopoverElement,
  AeliqoProgressElement,
  AeliqoSkeletonElement,
  AeliqoToastElement,
  AeliqoTooltipElement,
} from "@varendo/web/feedback";`;

type MetadataNotes = Pick<
  CatalogExampleMetadata,
  'fixture' | 'props' | 'propsNotes' | 'states' | 'keyboard' | 'events' | 'expectedOutcome'
>;
const componentNotes: Record<string, Partial<MetadataNotes>> = {
  tooltip: {
    fixture: 'One focused report-details trigger with a short explanatory tooltip.',
    props: ['label', 'content', 'open'],
    propsNotes:
      'The label names the trigger; content supplements it and is not the only place to put essential meaning.',
    states: ['ready'],
    keyboard: ['Tab', 'Enter or Space where trigger semantics apply', 'Escape dismisses the tooltip'],
    events: ['None; visibility follows focus/hover'],
    expectedOutcome: 'The explanation appears on focus or hover without stealing focus from the trigger.',
  },
  popover: {
    fixture: 'One non-modal report-details popover opened beside its trigger.',
    props: ['label', 'content', 'open', 'modal', 'closeOnOutside'],
    propsNotes: 'The host controls open state and chooses modal behavior; the popover does not execute actions itself.',
    states: ['ready'],
    keyboard: ['Tab', 'Enter or Space', 'Escape', 'focus returns to trigger'],
    events: ['aeliqo-popover-close'],
    expectedOutcome: 'The bounded surface exposes a labelled dialog boundary and emits a close request when dismissed.',
  },
  dialog: {
    fixture: 'One replayable modal archive confirmation with a host-owned trigger and action.',
    props: ['heading', 'open', 'modal', 'closeOnEscape'],
    propsNotes:
      'The host decides when to open and what the slotted action means; the dialog only owns focus and dismissal mechanics.',
    states: ['ready'],
    keyboard: ['Tab focus trap', 'Escape', 'Enter on slotted action', 'focus returns to trigger'],
    events: ['aeliqo-dialog-close'],
    expectedOutcome: 'The modal announces its heading, traps focus while open, and emits a cancellable close request.',
  },
  drawer: {
    fixture: 'One inline end-side report detail drawer that keeps surrounding context visible.',
    props: ['heading', 'open', 'mode', 'side'],
    propsNotes:
      'Inline mode participates in layout; modal mode is chosen by the host when a separate focus boundary is needed.',
    states: ['ready'],
    keyboard: ['Tab', 'Escape where modal', 'focus returns to trigger'],
    events: ['aeliqo-drawer-close'],
    expectedOutcome: 'The detail surface adapts to inline or overlay mode and emits a close request.',
  },
  toast: {
    fixture: 'One persistent success toast with an explicit dismiss button.',
    props: ['message', 'tone', 'open', 'duration', 'dismissible'],
    propsNotes:
      'Keep essential information outside transient notifications; duration zero makes this fixture reviewable.',
    states: ['ready'],
    keyboard: ['Tab to dismiss', 'Enter or Space', 'Escape where host handles it'],
    events: ['aeliqo-toast-dismiss'],
    expectedOutcome: 'The status is announced as transient feedback and can be dismissed by the user.',
  },
  alert: {
    fixture: 'One warning alert with an inspect action and optional dismissal.',
    props: ['heading', 'message', 'tone', 'actionLabel', 'dismissible', 'open'],
    propsNotes: 'The message remains visible; action and dismiss requests are handed to the host.',
    states: ['ready'],
    keyboard: ['Tab', 'Enter or Space on action', 'Escape where host handles it'],
    events: ['aeliqo-alert-action', 'aeliqo-alert-dismiss'],
    expectedOutcome: 'The warning is exposed as an alert with separately typed action and dismissal requests.',
  },
  progress: {
    fixture: 'One determinate report-loading progress bar at 62 percent.',
    props: ['label', 'value', 'max'],
    propsNotes:
      'Leave value absent for an indeterminate operation; the host owns the operation and completion meaning.',
    states: ['ready', 'pending'],
    keyboard: ['Not focusable by default'],
    events: ['None; status is conveyed by progress semantics'],
    expectedOutcome: 'Progress exposes the current bounded value and accessible label without claiming completion.',
  },
  skeleton: {
    fixture: 'Three static loading lines representing report rows.',
    props: ['label', 'lines', 'variant', 'animated'],
    propsNotes:
      'Skeleton is a temporary visual placeholder; it must be replaced by an explicit ready, empty, or error result.',
    states: ['loading'],
    keyboard: ['Not focusable'],
    events: ['None; placeholder has no action'],
    expectedOutcome: 'The loading placeholder communicates pending content without inventing data.',
  },
  'empty-state': {
    fixture: 'A no-matches result with a clear-filters action.',
    props: ['kind', 'heading', 'message', 'actionLabel'],
    propsNotes: 'The kind describes the honest empty condition; the action is a host request to change filters.',
    states: ['empty', 'loading', 'error'],
    keyboard: ['Tab', 'Enter', 'Space'],
    events: ['aeliqo-empty-state-action'],
    expectedOutcome: 'The absence of matching data is explicit and the host can receive a typed recovery request.',
  },
};

const mount = (id: CatalogExampleId, fn: (root: HTMLElement) => void): CatalogExampleDefinition => ({
  metadata: {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    family: 'feedback',
    description: 'A feedback primitive that makes status, focus, dismissal, and recovery explicit.',
    fixture: 'A visible status surface with a host-approved message and an optional action or dismissal boundary.',
    props: ['open', 'heading or message', 'tone', 'status'],
    propsNotes: 'Tone supplements text and role; open/close state is controlled by the host where effects matter.',
    states: ['ready', 'loading', 'pending', 'error', 'empty', 'disabled'],
    keyboard: [
      'Tab',
      'Enter or Space',
      'Escape dismisses transient surfaces when enabled',
      'focus returns to the trigger',
    ],
    events: [
      'aeliqo-dialog-close',
      'aeliqo-drawer-close',
      'aeliqo-popover-close',
      'aeliqo-toast-dismiss',
      'aeliqo-alert-action',
    ],
    expectedOutcome: 'The feedback state is visible and announced with an explicit recovery or dismissal boundary.',
    ...componentNotes[id],
    source: catalogSource({ imports: sourceImports, mount: catalogMountSource(id) }),
  },
  mount(container) {
    const root = createCatalogRoot(container);
    fn(root);
    return cleanupCatalogRoot(root);
  },
});

export const feedbackExamples: readonly CatalogExampleDefinition[] = [
  mount('tooltip', (root) => {
    const element = createCatalogElement<AeliqoTooltipElement>('aeliqo-tooltip', root, AeliqoTooltipElement);
    element.label = 'More information';
    element.content = 'Values are scoped to the current report.';
    element.open = true;
  }),
  mount('popover', (root) => {
    const element = createCatalogElement<AeliqoPopoverElement>('aeliqo-popover', root, AeliqoPopoverElement);
    element.label = 'Report details';
    element.content = 'The report includes the authorized current scope.';
    element.open = true;
    element.modal = false;
  }),
  mount('dialog', (root) => {
    const element = createCatalogElement<AeliqoDialogElement>('aeliqo-dialog', root, AeliqoDialogElement);
    element.heading = 'Confirm archive';
    element.open = false;
    element.modal = true;
    element.closeOnEscape = true;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = 'Open confirmation';
    trigger.addEventListener('click', () => {
      element.open = true;
    });
    const close = async (): Promise<void> => {
      element.open = false;
      await element.updateComplete;
      trigger.focus();
    };
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = 'Archive report';
    action.addEventListener('click', () => void close());
    element.append(action);
    element.addEventListener('aeliqo-dialog-close', () => void close());
    root.append(trigger);
  }),
  mount('drawer', (root) => {
    const element = createCatalogElement<AeliqoDrawerElement>('aeliqo-drawer', root, AeliqoDrawerElement);
    element.heading = 'Report details';
    element.mode = 'inline';
    element.side = 'end';
    element.open = true;
    element.textContent = 'Inline detail content keeps the surrounding task visible.';
  }),
  mount('toast', (root) => {
    const element = createCatalogElement<AeliqoToastElement>('aeliqo-toast', root, AeliqoToastElement);
    element.message = 'Report saved';
    element.tone = 'success';
    element.open = true;
    element.duration = 0;
    element.dismissible = true;
  }),
  mount('alert', (root) => {
    const element = createCatalogElement<AeliqoAlertElement>('aeliqo-alert', root, AeliqoAlertElement);
    element.heading = 'Review scope';
    element.message = 'This page contains the first authorized result window.';
    element.tone = 'warning';
    element.actionLabel = 'Inspect';
    element.dismissible = true;
    element.open = true;
  }),
  mount('progress', (root) => {
    const element = createCatalogElement<AeliqoProgressElement>('aeliqo-progress', root, AeliqoProgressElement);
    element.label = 'Loading report';
    element.value = 62;
    element.max = 100;
  }),
  mount('skeleton', (root) => {
    const element = createCatalogElement<AeliqoSkeletonElement>('aeliqo-skeleton', root, AeliqoSkeletonElement);
    element.label = 'Loading report rows';
    element.lines = 3;
    element.variant = 'text';
    element.animated = false;
  }),
  mount('empty-state', (root) => {
    const element = createCatalogElement<AeliqoEmptyStateElement>('aeliqo-empty-state', root, AeliqoEmptyStateElement);
    element.kind = 'no-matches';
    element.heading = 'No matching reports';
    element.message = 'Try a broader team or date filter.';
    element.actionLabel = 'Clear filters';
  }),
];
