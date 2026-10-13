import { SITE_BASE } from '../base.js';
import type { Intent } from '@varendo/core';
import type { WebRenderReceipt } from '@varendo/web/app';
import { dailyAttendanceIntent } from '../../../../examples/vnext/attendance/data.js';
import { layoutIntent } from '../../../../examples/vnext/workspace/page.js';
import { createActionReviewController } from './action-review.js';
import { createConnectionFlow } from './connection-flow.js';
import { evidenceFor, selectedView, viewLabel, type InspectorSection, type PlaygroundEvidence } from './inspect.js';
import { createJourneyTracker } from './journey.js';
import { jakartaPeopleIntent, PLAYGROUND_SCENARIOS, type PlaygroundScenario } from './scenarios.js';
import { findScenario, labelIntent, renderScenarioControls } from './scenario-controls.js';
import { createPlaygroundSession, type PlaygroundSession } from './session.js';

type Mode = 'without-ai' | 'connected';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Playground element ${selector} is missing.`);
  return element;
}

const scenarioSelect = required<HTMLSelectElement>('#pg-scenario');
const appRoot = required<HTMLElement>('.pg-app');
const bootState = required<HTMLElement>('#pg-boot');
const bootControls = document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-playground-boot-control]');
const requestRail = required<HTMLDetailsElement>('#pg-request');
const scenarioDescription = required<HTMLElement>('#pg-scenario-description');
const stepsHost = required<HTMLElement>('#pg-steps');
const guidedPanel = required<HTMLElement>('#pg-guided');
const connectedPanel = required<HTMLElement>('#pg-connected');
const regionHost = required<HTMLElement>('#pg-region');
const status = required<HTMLElement>('#pg-status');
const resultDefinition = required<HTMLElement>('#pg-result-definition');
const committedFilter = required<HTMLElement>('#pg-committed-filter');
const error = required<HTMLElement>('#pg-error');
const viewBadge = required<HTMLElement>('#pg-view-badge');
const resultTitle = required<HTMLElement>('#pg-result-title');
const receiptState = required<HTMLElement>('#pg-receipt-state');
const journeyIntent = required<HTMLElement>('#pg-journey-intent');
const intentPanel = required<HTMLDetailsElement>('#pg-intent');
const intentJson = required<HTMLElement>('#pg-intent-json');
const journeyResult = required<HTMLElement>('#pg-journey-result');
const journeyView = required<HTMLElement>('#pg-journey-view');
const setJourney = createJourneyTracker(document.querySelectorAll<HTMLElement>('.pg-journey li'), viewBadge).set;
const inspector = required<HTMLDialogElement>('#pg-inspector');
const inspectorSummary = required<HTMLElement>('#pg-inspector-summary');
const inspectorContent = required<HTMLElement>('#pg-inspector-content');
const actionDialog = required<HTMLDialogElement>('#pg-action');
const actionContent = required<HTMLElement>('#pg-action-content');
const actionStatus = required<HTMLElement>('#pg-action-status');
const actionCancel = required<HTMLButtonElement>('#pg-action-cancel');
const actionConfirm = required<HTMLButtonElement>('#pg-action-confirm');
const connectButton = required<HTMLButtonElement>('#pg-connect');
const connectionStatus = required<HTMLElement>('#pg-connect-status');
const connectionLabel = required<HTMLElement>('#pg-connection-label');
const connectionDot = required<HTMLElement>('#pg-connection-dot');
const copyStatus = required<HTMLElement>('#pg-copy-status');
const exportButton = required<HTMLButtonElement>('#pg-export');
const exportNote = required<HTMLElement>('#pg-export-note');
const actionsMenu = required<HTMLDetailsElement>('#pg-menu');
const modeButtons = document.querySelectorAll<HTMLButtonElement>('[data-mode]');
const inspectorButtons = document.querySelectorAll<HTMLButtonElement>('[data-inspector]');
const requestedScenario = new URLSearchParams(window.location.search).get('scenario') ?? '';
let mode: Mode = 'without-ai';
let scenario: PlaygroundScenario = findScenario(requestedScenario);
let activeRequest: AbortController | undefined;
let session: PlaygroundSession;
let last: PlaygroundEvidence = {};
let inspectorSection: InspectorSection = 'intent';

const connectionFlow = createConnectionFlow(
  {
    status: connectionStatus,
    label: connectionLabel,
    dot: connectionDot,
    connectButton,
    webmcpNote: required<HTMLElement>('#pg-webmcp-note'),
  },
  () => session,
);

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{"error":"Value could not be serialized."}';
  }
}

function setError(message?: string): void {
  error.hidden = message === undefined;
  error.textContent = message ?? '';
}

function setExportAvailability(publicJourney: boolean): void {
  const published = typeof __VARENDO_EXPORT_AVAILABLE__ !== 'undefined' && __VARENDO_EXPORT_AVAILABLE__;
  exportButton.disabled = !published || publicJourney;
  exportNote.hidden = published && !publicJourney;
  if (exportNote.hidden) {
    exportButton.removeAttribute('aria-describedby');
    return;
  }
  exportButton.setAttribute('aria-describedby', 'pg-export-note');
  const link = document.createElement('a');
  link.href = `${SITE_BASE}examples/`;
  if (!published) {
    link.textContent = 'the source examples from the matching checkout';
    exportNote.replaceChildren(
      'Export is unavailable until the matching Varendo packages are verified in the registry. Run ',
      link,
      ' instead.',
    );
    return;
  }
  link.textContent = 'Run the matching source fixture';
  exportNote.replaceChildren('This guided demo has no matching project ZIP. ', link, ' instead.');
}

const actionReview = createActionReviewController({
  dialog: actionDialog,
  content: actionContent,
  cancelButton: actionCancel,
  confirmButton: actionConfirm,
  status: actionStatus,
  pageStatus: status,
  receiptState,
  stringify,
  setError,
});

function renderInspector(): void {
  const section = evidenceFor(last, inspectorSection);
  inspectorSummary.textContent = section.summary;
  inspectorContent.textContent = stringify(section.value);
}

/** Shows the exact bounded request, which is the same shape an agent tool sends. */
function showIntent(intent: Intent | undefined): void {
  intentPanel.hidden = intent === undefined;
  const lines = Object.entries(intent ?? {}).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  intentJson.textContent = intent === undefined ? '' : `{\n${lines.join(',\n')}\n}`;
}

function resetSession(): void {
  activeRequest?.abort();
  session?.dispose();
  regionHost.replaceChildren();
  session = createPlaygroundSession(actionReview.handle, applyAgentReceipt, applyAdaptedPresentation);
  last = {};
  actionReview.reset();
  connectionFlow.reset();
  setExportAvailability(false);
  setError();
  status.textContent = 'Session reset. Choose a task.';
  journeyIntent.textContent = 'Choose a task';
  showIntent(undefined);
  journeyResult.textContent = 'Waiting';
  journeyView.textContent = 'Waiting';
  setJourney('pending', 'pending', 'pending');
  viewBadge.textContent = 'Waiting for a request';
  resultTitle.textContent = 'Employees';
  resultDefinition.hidden = true;
  resultDefinition.textContent = '';
  committedFilter.hidden = true;
  committedFilter.textContent = '';
  receiptState.textContent = 'None';
  renderInspector();
}

function renderScenario(): void {
  renderScenarioControls(scenario, scenarioDescription, stepsHost, runIntent);
}

function applyAdaptedPresentation(receipt: WebRenderReceipt): void {
  if (receipt.status !== 'renderer-ready' || last.intent === undefined || last.receipt?.status !== 'renderer-ready')
    return;
  if (
    receipt.runtime.task.id !== last.receipt.runtime.task.id ||
    receipt.runtime.task.revision !== last.receipt.runtime.task.revision
  )
    return;
  last = { ...last, receipt };
  viewBadge.textContent = selectedView(receipt);
  journeyView.textContent = viewLabel(selectedView(receipt));
  renderInspector();
}

async function applyReceipt(intent: Intent, receipt: WebRenderReceipt): Promise<void> {
  last = { intent, receipt };
  receiptState.textContent = receipt.status;
  viewBadge.textContent = selectedView(receipt);
  journeyIntent.textContent = labelIntent(scenario, intent);
  showIntent(intent);
  const activeStep = scenario.steps.find((step) => step.id === intent.id);
  resultTitle.textContent = activeStep?.label ?? labelIntent(scenario, intent);
  resultDefinition.textContent = activeStep?.definition ?? '';
  resultDefinition.hidden = activeStep?.definition === undefined;
  switch (receipt.status) {
    case 'renderer-ready':
      applyReadyReceipt(intent, receipt);
      break;
    default:
      applyFailedReceipt(receipt);
  }
  renderInspector();
}

function applyReadyReceipt(intent: Intent, receipt: WebRenderReceipt): void {
  committedFilter.hidden = intent.id !== 'people-jakarta';
  committedFilter.textContent =
    intent.id === 'people-jakarta' ? 'Committed filter · Location: Jakarta · Scope: synthetic People' : '';
  journeyResult.textContent = 'Evaluated';
  journeyView.textContent = viewLabel(selectedView(receipt));
  setJourney('done', 'done', 'done');
  status.textContent = `${resultTitle.textContent} is ready. Open the request details or Inspect to see how this view was chosen.`;
}

function applyFailedReceipt(receipt: WebRenderReceipt): void {
  const message = receipt.diagnostics[0]?.message ?? `The request ended as ${receipt.status}.`;
  journeyResult.textContent = 'Could not complete';
  journeyView.textContent = 'No new view';
  setJourney('done', 'failed', 'pending');
  status.textContent = message;
  setError(message);
}

async function applyAgentReceipt(intent: Intent, receipt: WebRenderReceipt): Promise<void> {
  setError();
  await applyReceipt(intent, receipt);
}

async function runIntent(intent: Intent, trigger?: HTMLButtonElement, publicJourney = false): Promise<void> {
  setExportAvailability(publicJourney);
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  setError();
  receiptState.textContent = 'checking';
  journeyIntent.textContent = labelIntent(scenario, intent);
  showIntent(intent);
  journeyResult.textContent = 'Checking…';
  journeyView.textContent = 'Waiting';
  setJourney('done', 'active', 'pending');
  status.textContent = 'Checking the request and evaluating the result…';
  trigger?.setAttribute('aria-busy', 'true');
  try {
    const receipt = await session.render(regionHost, intent, controller.signal);
    if (activeRequest !== controller) return;
    await applyReceipt(intent, receipt);
  } catch {
    if (!controller.signal.aborted) {
      journeyResult.textContent = 'Could not complete';
      journeyView.textContent = 'No new view';
      setJourney('done', 'failed', 'pending');
      setError('The playground request failed safely. Reset the session and try again.');
    }
  } finally {
    trigger?.removeAttribute('aria-busy');
    if (activeRequest === controller) activeRequest = undefined;
  }
}

function setMode(next: Mode): void {
  mode = next;
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  guidedPanel.hidden = mode !== 'without-ai';
  connectedPanel.hidden = mode !== 'connected';
  if (mode === 'connected') {
    requestRail.open = true;
    void connectionFlow.prepare();
  }
}

const MODES = ['without-ai', 'connected'] as const satisfies readonly Mode[];
const INSPECTOR_SECTIONS = [
  'intent',
  'task',
  'result',
  'presentation',
  'diagnostics',
] as const satisfies readonly InspectorSection[];

function modeFrom(value: string | undefined): Mode | undefined {
  return MODES.find((candidate) => candidate === value);
}

function inspectorFrom(value: string | undefined): InspectorSection | undefined {
  return INSPECTOR_SECTIONS.find((candidate) => candidate === value);
}

for (const item of PLAYGROUND_SCENARIOS) {
  const option = document.createElement('option');
  option.value = item.id;
  option.textContent = item.label;
  scenarioSelect.append(option);
}
scenarioSelect.value = scenario.id;
scenarioSelect.addEventListener('change', () => {
  scenario = findScenario(scenarioSelect.value);
  const url = new URL(window.location.href);
  url.searchParams.set('scenario', scenario.id);
  window.history.replaceState(null, '', url);
  renderScenario();
  void runIntent(scenario.steps[0]!.intent());
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-journey]'))
  button.addEventListener('click', () => {
    if (button.dataset.journey === 'jakarta') {
      scenario = findScenario('people');
      scenarioSelect.value = 'people';
      renderScenario();
      void runIntent(jakartaPeopleIntent(), undefined, true);
      return;
    }
    if (button.dataset.journey === 'page') {
      void runIntent(layoutIntent('page'), undefined, true);
      return;
    }
    if (button.dataset.journey === 'workspace') void runIntent(layoutIntent('workspace'), undefined, true);
    if (button.dataset.journey === 'attendance') void runIntent(dailyAttendanceIntent(), undefined, true);
  });
for (const button of modeButtons)
  button.addEventListener('click', () => {
    const next = modeFrom(button.dataset.mode);
    if (next !== undefined) setMode(next);
  });
required<HTMLButtonElement>('#pg-reset').addEventListener('click', () => {
  actionsMenu.open = false;
  resetSession();
});
exportButton.addEventListener('click', async () => {
  actionsMenu.open = false;
  const [{ projectFiles }, { zipProject }] = await Promise.all([import('./project-template.js'), import('./zip.js')]);
  const blob = zipProject(projectFiles(scenario.id, __VARENDO_RELEASE_VERSION__));
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `varendo-${scenario.id}-example.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  status.textContent = `Exported the ${scenario.label} source project with synthetic data and no credentials. Install after its pinned package version is published.`;
});
const inspectButton = required<HTMLButtonElement>('#pg-inspect');
inspectButton.addEventListener('click', () => {
  renderInspector();
  inspector.showModal();
});
inspector.addEventListener('close', () => inspectButton.focus());
required<HTMLButtonElement>('#pg-inspector-close').addEventListener('click', () => inspector.close());
for (const button of inspectorButtons)
  button.addEventListener('click', () => {
    const next = inspectorFrom(button.dataset.inspector);
    if (next === undefined) return;
    inspectorSection = next;
    for (const candidate of inspectorButtons) candidate.setAttribute('aria-pressed', String(candidate === button));
    renderInspector();
  });
connectButton.addEventListener('click', () => void connectionFlow.connect());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-prompt]'))
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.textContent?.trim() ?? '');
      copyStatus.textContent = 'Prompt copied. Paste it into your browser agent.';
    } catch {
      copyStatus.textContent = 'Select and copy the prompt text.';
    }
  });

const narrowRail = window.matchMedia('(max-width: 800px)');
const syncRequestRail = () => {
  requestRail.open = !narrowRail.matches;
};
syncRequestRail();
narrowRail.addEventListener('change', syncRequestRail);

resetSession();
renderScenario();
for (const control of bootControls) control.disabled = false;
setExportAvailability(false);
bootState.hidden = true;
appRoot.removeAttribute('aria-busy');
void runIntent(scenario.steps[0]!.intent());
window.addEventListener('pagehide', () => {
  activeRequest?.abort();
  connectionFlow.close();
  session.dispose();
});
