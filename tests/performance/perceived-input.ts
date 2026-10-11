import { AeliqoTextFieldElement } from '@varendo/web/inputs';
import { AeliqoTableElement } from '@varendo/web/table';
import type { AeliqoTableColumn, AeliqoTableRow } from '@varendo/web/data';

type TimingStatus = 'observed' | 'missing-or-threshold-censored';

type RawEventTiming = {
  readonly entryType: string;
  readonly name: string;
  readonly startTime: number | null;
  readonly duration: number | null;
  readonly processingStart: number | null;
  readonly processingEnd: number | null;
  readonly inputDelayMs: number | null;
  readonly processingDurationMs: number | null;
  readonly interactionId: number | null;
};

type VisibleUpdate = {
  readonly atMs: number | null;
  readonly delayMs: number | null;
  readonly revision: number;
  readonly rowCount: number;
  readonly rowIds: readonly string[];
  readonly text: string;
};

type InteractionCapture = {
  readonly sequence: number;
  readonly key: string;
  readonly trustedKeyboard: boolean;
  readonly keydownObservedAtMs: number | null;
  readonly keydownEventTimestampMs: number | null;
  readonly keyupEventTimestampMs: number | null;
  readonly queryBefore: string;
  readonly queryAfter: string;
  readonly visibleUpdate: VisibleUpdate | null;
  readonly eventTiming: {
    readonly status: TimingStatus;
    readonly observationThresholdMs: number | null;
    readonly interactionId: number | null;
    readonly entries: readonly RawEventTiming[];
  };
};

type InteractionState = {
  readonly sequence: number;
  readonly key: string;
  readonly trustedKeyboard: boolean;
  readonly keydownObservedAtMs: number;
  readonly keydownEventTimestampMs: number | null;
  keyupEventTimestampMs: number | null;
  readonly queryBefore: string;
  queryAfter: string;
  outputMutationAtMs: number | null;
  tableMutationAtMs: number | null;
  visibleUpdate: VisibleUpdate | null;
};

type PerceivedInputApi = {
  readonly ready: boolean;
  readonly fixture: {
    readonly rowCount: number;
    readonly directInput: boolean;
    readonly tableRows: number;
    readonly retainedModuleGraphPath: string;
    readonly eventTimingObserverAvailable: boolean;
    readonly eventTimingThresholdMs: number;
  };
  readonly armCalibrationHandler: () => { readonly handlerMs: number };
  readonly beginInteraction: () => { readonly sequence: number; readonly queryBefore: string };
  readonly resetFixture: () => { readonly revision: number };
  readonly completeInteraction: () => InteractionCapture;
  readonly eventTimingEntryCount: () => number;
  readonly visibleRevision: () => number;
  readonly visibleUpdateReady: () => boolean;
};

declare global {
  interface Window {
    aeliqoPerceivedInput?: PerceivedInputApi;
  }
}

const input = document.querySelector<AeliqoTextFieldElement>('#query');
const table = document.querySelector<AeliqoTableElement>('#records');
const visibleResult = document.querySelector<HTMLOutputElement>('#visible-result');
if (input === null || table === null || visibleResult === null)
  throw new Error('Perceived input fixture is incomplete.');

if (!customElements.get('aeliqo-text-field')) customElements.define('aeliqo-text-field', AeliqoTextFieldElement);
if (!customElements.get('aeliqo-table')) customElements.define('aeliqo-table', AeliqoTableElement);

const columns: readonly AeliqoTableColumn[] = [
  { key: 'id', label: 'ID' },
  { key: 'label', label: 'Label' },
  { key: 'value', label: 'Value', align: 'end' },
];

function makeRows(): readonly AeliqoTableRow[] {
  return Array.from({ length: 100 }, (_, index) => ({
    id: `row-${index + 1}`,
    label: `Local row ${index + 1}`,
    value: index + 1,
  }));
}

const allRows = makeRows();
let activeInteraction: InteractionState | undefined;
let sequence = 0;
let revision = 0;
const eventTimingEntries: RawEventTiming[] = [];
const eventTimingThresholdMs = 16;
const calibrationHandlerMs = 60;
let calibrationArmed = false;

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function eventTimestamp(value: unknown): number | null {
  const timestamp = finiteOrNull(value);
  if (timestamp === null) return null;
  const origin = finiteOrNull(performance.timeOrigin);
  return origin !== null && timestamp > 1_000_000_000 ? timestamp - origin : timestamp;
}

function runCalibrationHandler(): void {
  const deadline = performance.now() + calibrationHandlerMs;
  while (performance.now() < deadline) {
    // Deliberately occupy the main thread to force a measurable Event Timing entry.
  }
}

function rawEventTiming(entry: PerformanceEntry): RawEventTiming {
  const candidate = entry as PerformanceEntry & {
    readonly processingStart?: unknown;
    readonly processingEnd?: unknown;
    readonly interactionId?: unknown;
  };
  const startTime = finiteOrNull(entry.startTime);
  const duration = finiteOrNull(entry.duration);
  const processingStart = finiteOrNull(candidate.processingStart);
  const processingEnd = finiteOrNull(candidate.processingEnd);
  return {
    entryType: entry.entryType,
    name: entry.name,
    startTime,
    duration,
    processingStart,
    processingEnd,
    inputDelayMs: startTime === null || processingStart === null ? null : processingStart - startTime,
    processingDurationMs: processingStart === null || processingEnd === null ? null : processingEnd - processingStart,
    interactionId: finiteOrNull(candidate.interactionId),
  };
}

function collectEventTimingEntries(): readonly RawEventTiming[] {
  const entries = [...eventTimingEntries];
  for (const type of ['event', 'first-input'] as const) {
    try {
      for (const entry of performance.getEntriesByType(type)) entries.push(rawEventTiming(entry));
    } catch {
      // An unsupported entry type is represented by an empty observation, never 0.
    }
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.entryType}|${entry.name}|${entry.startTime}|${entry.duration}|${entry.processingStart}|${entry.processingEnd}|${entry.interactionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventTimingForInteraction(state: InteractionState): {
  readonly status: TimingStatus;
  readonly observationThresholdMs: number | null;
  readonly interactionId: number | null;
  readonly entries: readonly RawEventTiming[];
} {
  const timestamps = [state.keydownEventTimestampMs, state.keyupEventTimestampMs].filter(
    (value): value is number => value !== null,
  );
  const matching = collectEventTimingEntries().filter(
    (entry) =>
      (entry.name === 'keydown' || entry.name === 'keyup') &&
      entry.startTime !== null &&
      timestamps.some((timestamp) => entry.startTime === timestamp),
  );
  const interactionIds = new Set(
    matching.map((entry) => entry.interactionId).filter((value): value is number => value !== null && value > 0),
  );
  const candidates =
    interactionIds.size === 0
      ? matching
      : collectEventTimingEntries().filter(
          (entry) =>
            (entry.name === 'keydown' || entry.name === 'keyup') &&
            entry.interactionId !== null &&
            interactionIds.has(entry.interactionId),
        );
  const interactionId = [...interactionIds][0] ?? null;
  return {
    status: candidates.length === 0 ? 'missing-or-threshold-censored' : 'observed',
    observationThresholdMs: eventTimingThresholdMs,
    interactionId,
    entries: candidates,
  };
}

function visibleRowCount(): number {
  return table!.shadowRoot?.querySelectorAll('tbody tr').length ?? 0;
}

function visibleText(): string {
  return table!.shadowRoot?.querySelector('tbody')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
}

function recordVisibleUpdate(state: InteractionState): void {
  if (state.visibleUpdate !== null || state.outputMutationAtMs === null || state.tableMutationAtMs === null) return;
  const atMs = Math.max(state.outputMutationAtMs, state.tableMutationAtMs);
  state.visibleUpdate = {
    atMs,
    delayMs: state.keydownEventTimestampMs === null ? null : atMs - state.keydownEventTimestampMs,
    revision,
    rowCount: visibleRowCount(),
    rowIds: [...(table!.shadowRoot?.querySelectorAll('tbody tr td:first-child') ?? [])].map(
      (cell) => cell.textContent?.trim() ?? '',
    ),
    text: visibleText(),
  };
}

const outputObserver = new MutationObserver(() => {
  const state = activeInteraction;
  if (state === undefined || state.visibleUpdate !== null) return;
  state.outputMutationAtMs ??= performance.now();
  recordVisibleUpdate(state);
});
outputObserver.observe(visibleResult, { subtree: true, childList: true, characterData: true, attributes: true });

const tableObserver = new MutationObserver(() => {
  const state = activeInteraction;
  if (state === undefined || state.visibleUpdate !== null) return;
  state.tableMutationAtMs ??= performance.now();
  recordVisibleUpdate(state);
});
if (table.shadowRoot !== null)
  tableObserver.observe(table.shadowRoot, { subtree: true, childList: true, characterData: true, attributes: true });

input.addEventListener('keydown', (event) => {
  if (!event.isTrusted || event.key.length === 0 || event.key === 'Tab') return;
  const runCalibration = calibrationArmed;
  calibrationArmed = false;
  const queryBefore = input!.shadowRoot?.querySelector<HTMLInputElement>('[part=input]')?.value ?? input!.value;
  activeInteraction = {
    sequence: sequence + 1,
    key: event.key,
    trustedKeyboard: event.isTrusted,
    keydownObservedAtMs: performance.now(),
    keydownEventTimestampMs: eventTimestamp(event.timeStamp),
    keyupEventTimestampMs: null,
    queryBefore,
    queryAfter: queryBefore,
    outputMutationAtMs: null,
    tableMutationAtMs: null,
    visibleUpdate: null,
  };
  if (runCalibration) runCalibrationHandler();
});

input.addEventListener('keyup', (event) => {
  const state = activeInteraction;
  if (state !== undefined && event.isTrusted && event.key === state.key)
    state.keyupEventTimestampMs = eventTimestamp(event.timeStamp);
});

input.addEventListener('aeliqo-input-change', (event) => {
  const state = activeInteraction;
  if (state === undefined) return;
  const detail = (event as CustomEvent<{ readonly value?: unknown }>).detail;
  const query = typeof detail?.value === 'string' ? detail.value : '';
  const normalized = query.toLocaleLowerCase();
  const rows = allRows.filter((row) =>
    `${String(row.id)} ${String(row.label)} ${String(row.value)}`.toLocaleLowerCase().includes(normalized),
  );
  state.queryAfter = query;
  input.value = query;
  table.rows = rows;
  visibleResult.textContent = `${rows.length} matching rows for ${query.length === 0 ? 'all records' : `“${query}”`}`;
  revision += 1;
  visibleResult.dataset.visibleRevision = String(revision);
});

table.caption = 'Local records';
table.columns = columns;
table.identity = ['id'];
table.rows = allRows;
input.label = 'Filter local rows';
input.description = 'Type a character to update the visible row summary.';
input.value = '';

function resetFixture(): { readonly revision: number } {
  activeInteraction = undefined;
  calibrationArmed = false;
  input!.value = '';
  table!.rows = allRows;
  visibleResult!.textContent = '100 matching rows for all records';
  revision += 1;
  visibleResult!.dataset.visibleRevision = String(revision);
  return { revision };
}

function armCalibrationHandler(): { readonly handlerMs: number } {
  calibrationArmed = true;
  return { handlerMs: calibrationHandlerMs };
}

function beginInteraction(): { readonly sequence: number; readonly queryBefore: string } {
  activeInteraction = undefined;
  const queryBefore = input!.shadowRoot?.querySelector<HTMLInputElement>('[part=input]')?.value ?? input!.value;
  return { sequence: sequence + 1, queryBefore };
}

function completeInteraction(): InteractionCapture {
  const state = activeInteraction;
  if (state === undefined) throw new Error('No trusted keyboard interaction is active.');
  sequence = state.sequence;
  const capture: InteractionCapture = {
    sequence: state.sequence,
    key: state.key,
    trustedKeyboard: state.trustedKeyboard,
    keydownObservedAtMs: finiteOrNull(state.keydownObservedAtMs),
    keydownEventTimestampMs: state.keydownEventTimestampMs,
    keyupEventTimestampMs: state.keyupEventTimestampMs,
    queryBefore: state.queryBefore,
    queryAfter: state.queryAfter,
    visibleUpdate: state.visibleUpdate,
    eventTiming: eventTimingForInteraction(state),
  };
  activeInteraction = undefined;
  return capture;
}

let observerAvailable = false;
if (typeof PerformanceObserver !== 'undefined') {
  const supported = PerformanceObserver.supportedEntryTypes?.includes('event') ?? false;
  if (supported) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) eventTimingEntries.push(rawEventTiming(entry));
      });
      observer.observe({
        type: 'event',
        buffered: true,
        durationThreshold: eventTimingThresholdMs,
      } as PerformanceObserverInit & { durationThreshold: number });
      observerAvailable = true;
    } catch {
      observerAvailable = false;
    }
  }
}

window.aeliqoPerceivedInput = {
  ready: true,
  fixture: {
    rowCount: allRows.length,
    directInput: true,
    tableRows: table.rows.length,
    retainedModuleGraphPath: '/retained-modules.json',
    eventTimingObserverAvailable: observerAvailable,
    eventTimingThresholdMs,
  },
  armCalibrationHandler,
  beginInteraction,
  resetFixture,
  completeInteraction,
  eventTimingEntryCount: () => eventTimingEntries.length,
  visibleRevision: () => revision,
  visibleUpdateReady: () => activeInteraction !== undefined && activeInteraction.visibleUpdate !== null,
};
