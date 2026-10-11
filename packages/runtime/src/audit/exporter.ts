import type { Diagnostic } from '@varendo/core';
import type {
  AuditCache,
  AuditOperation,
  AuditPlanPhase,
  AuditRenderer,
  AuditResource,
  AuditSourceTransport,
  CapabilityAuditCode,
  LocalAuditEvent,
  LocalAuditExport,
  LocalAuditExporter,
  LocalAuditOptions,
  LocalAuditOutcome,
  LocalAuditRecord,
  SourceAuditCode,
} from './types.js';

const DEFAULT_MAX_EVENTS = 256;
const MAX_EVENTS = 4096;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MIN_BYTES = 256;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_MS = 86_400_000;

const plans = new Set<AuditPlanPhase>(['validate', 'query', 'present']);
const operations = new Set<AuditOperation>(['read', 'evaluate', 'present', 'meaning', 'action', 'model-egress']);
const sources = new Set<AuditSourceTransport>(['local', 'http']);
const caches = new Set<AuditCache>(['catalog', 'result', 'presentation', 'meaning']);
const renderers = new Set<AuditRenderer>(['component', 'plot', 'compound']);
const resources = new Set<AuditResource>(['rows', 'bytes', 'nodes', 'regions', 'results']);
const planStatuses: ReadonlySet<string> = new Set(['completed', 'rejected', 'cancelled', 'failed']);
const capabilityStatuses: ReadonlySet<string> = new Set(['accepted', 'rejected', 'cancelled']);
const rendererStatuses: ReadonlySet<string> = new Set(['ready', 'partial', 'empty', 'error']);
const capabilityCodes = new Set<CapabilityAuditCode>([
  'policy.denied',
  'renderer.unsupported',
  'runtime.invalid',
  'runtime.stale',
  'runtime.failed',
  'action.ambiguous',
]);
const sourceCodes = new Set<SourceAuditCode>([
  'source.denied',
  'source.timeout',
  'source.unavailable',
  'source.invalid',
]);

type RecordValue = Readonly<Record<string, unknown>>;

function diagnostic(code: string, message: string, path: readonly (string | number)[] = []): Diagnostic {
  return { code, message, path, retryable: false };
}

function failure<T>(code: string, message: string, path: readonly (string | number)[] = []): LocalAuditOutcome<T> {
  return { ok: false, diagnostics: [diagnostic(code, message, path)] };
}

function frozen<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) frozen(child);
    return Object.freeze(value);
  }
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  return Object.freeze(value);
}

function exactKeys(record: RecordValue, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(record);
  return (
    required.every((key) => Object.hasOwn(record, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function parsePlanEvent(record: RecordValue): LocalAuditOutcome<LocalAuditEvent> {
  const valid =
    exactKeys(record, ['kind', 'phase', 'status', 'durationMs']) &&
    plans.has(record.phase as AuditPlanPhase) &&
    planStatuses.has(record.status as string) &&
    integer(record.durationMs, MAX_DURATION_MS);
  if (!valid) return failure('audit.invalid', 'The plan event contains an unknown field or invalid bounded value.');
  return {
    ok: true,
    value: frozen({
      kind: 'plan',
      phase: record.phase as AuditPlanPhase,
      status: record.status as 'completed' | 'rejected' | 'cancelled' | 'failed',
      durationMs: record.durationMs as number,
    }),
  };
}

function parseCapabilityEvent(record: RecordValue): LocalAuditOutcome<LocalAuditEvent> {
  const valid =
    exactKeys(record, ['kind', 'operation', 'status'], ['code']) &&
    operations.has(record.operation as AuditOperation) &&
    capabilityStatuses.has(record.status as string) &&
    !(record.status === 'accepted' && record.code !== undefined) &&
    !(record.status === 'rejected' && !capabilityCodes.has(record.code as CapabilityAuditCode)) &&
    !(record.status === 'cancelled' && record.code !== undefined && record.code !== 'host.cancelled');
  if (!valid)
    return failure('audit.invalid', 'The capability event contains an unknown field or invalid low-cardinality value.');
  return {
    ok: true,
    value: frozen({
      kind: 'capability',
      operation: record.operation as AuditOperation,
      status: record.status as 'accepted' | 'rejected' | 'cancelled',
      ...(record.code === undefined ? {} : { code: record.code as CapabilityAuditCode | 'host.cancelled' }),
    }) as LocalAuditEvent,
  };
}

function parseCancellationEvent(record: RecordValue): LocalAuditOutcome<LocalAuditEvent> {
  const valid =
    exactKeys(record, ['kind', 'operation'], ['code']) &&
    operations.has(record.operation as AuditOperation) &&
    (record.code === undefined || record.code === 'host.cancelled');
  if (!valid)
    return failure(
      'audit.invalid',
      'The cancellation event contains an unknown field or invalid low-cardinality value.',
    );
  return {
    ok: true,
    value: frozen({
      kind: 'cancellation',
      operation: record.operation as AuditOperation,
      ...(record.code === undefined ? {} : { code: 'host.cancelled' as const }),
    }),
  };
}

function parseSourceEvent(record: RecordValue): LocalAuditOutcome<LocalAuditEvent> {
  const valid =
    exactKeys(record, ['kind', 'transport', 'status', 'code']) &&
    sources.has(record.transport as AuditSourceTransport) &&
    record.status === 'error' &&
    sourceCodes.has(record.code as SourceAuditCode);
  if (!valid)
    return failure('audit.invalid', 'The source event contains an unknown field or invalid low-cardinality value.');
  return {
    ok: true,
    value: frozen({
      kind: 'source',
      transport: record.transport as AuditSourceTransport,
      status: 'error',
      code: record.code as SourceAuditCode,
    }),
  };
}

function parseCacheEvent(record: RecordValue): LocalAuditOutcome<LocalAuditEvent> {
  const valid =
    exactKeys(record, ['kind', 'cache', 'status']) &&
    caches.has(record.cache as AuditCache) &&
    ['hit', 'miss'].includes(record.status as string);
  if (!valid)
    return failure('audit.invalid', 'The cache event contains an unknown field or invalid low-cardinality value.');
  return {
    ok: true,
    value: frozen({ kind: 'cache', cache: record.cache as AuditCache, status: record.status as 'hit' | 'miss' }),
  };
}

function parseRendererEvent(record: RecordValue): LocalAuditOutcome<LocalAuditEvent> {
  const valid =
    exactKeys(record, ['kind', 'renderer', 'status'], ['resourceCount']) &&
    renderers.has(record.renderer as AuditRenderer) &&
    rendererStatuses.has(record.status as string) &&
    (record.resourceCount === undefined || integer(record.resourceCount));
  if (!valid) return failure('audit.invalid', 'The renderer event contains an unknown field or invalid bounded value.');
  return {
    ok: true,
    value: frozen({
      kind: 'renderer',
      renderer: record.renderer as AuditRenderer,
      status: record.status as 'ready' | 'partial' | 'empty' | 'error',
      ...(record.resourceCount === undefined ? {} : { resourceCount: record.resourceCount as number }),
    }),
  };
}

function validResourceCounts(record: RecordValue): boolean {
  if (!integer(record.count) || (record.limit !== undefined && !integer(record.limit))) return false;
  if (record.status === 'within-budget')
    return record.limit === undefined || (record.count as number) <= (record.limit as number);
  return (
    record.status === 'exhausted' && record.limit !== undefined && (record.count as number) > (record.limit as number)
  );
}

function parseResourceEvent(record: RecordValue): LocalAuditOutcome<LocalAuditEvent> {
  const valid =
    exactKeys(record, ['kind', 'resource', 'status', 'count'], ['limit']) &&
    resources.has(record.resource as AuditResource) &&
    ['within-budget', 'exhausted'].includes(record.status as string) &&
    validResourceCounts(record);
  if (!valid) return failure('audit.invalid', 'The resource event contains an unknown field or invalid bounded value.');
  return {
    ok: true,
    value: frozen({
      kind: 'resource',
      resource: record.resource as AuditResource,
      status: record.status as 'within-budget' | 'exhausted',
      count: record.count as number,
      ...(record.limit === undefined ? {} : { limit: record.limit as number }),
    }) as LocalAuditEvent,
  };
}

function parseEvent(value: unknown): LocalAuditOutcome<LocalAuditEvent> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return failure('audit.invalid', 'A local audit event must be an object.');
  const record = value as RecordValue;
  switch (record.kind) {
    case 'plan':
      return parsePlanEvent(record);
    case 'capability':
      return parseCapabilityEvent(record);
    case 'cancellation':
      return parseCancellationEvent(record);
    case 'source':
      return parseSourceEvent(record);
    case 'cache':
      return parseCacheEvent(record);
    case 'renderer':
      return parseRendererEvent(record);
    case 'resource':
      return parseResourceEvent(record);
    default:
      return failure('audit.invalid', 'The local audit event kind is unsupported.', ['kind']);
  }
}

function option(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  const current = value ?? fallback;
  if (!Number.isSafeInteger(current) || current < minimum || current > maximum)
    throw new TypeError(`${name} must be a bounded positive safe integer.`);
  return current;
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

class LocalAuditExporterImpl implements LocalAuditExporter {
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private now: (() => number) | undefined;
  private records: { readonly value: LocalAuditRecord; readonly bytes: number }[] = [];
  private bytes = 0;
  private dropped = 0;
  private sequence = 0;
  private live = true;

  constructor(options: LocalAuditOptions) {
    this.maxEvents = option(options.maxEvents, DEFAULT_MAX_EVENTS, 1, MAX_EVENTS, 'maxEvents');
    this.maxBytes = option(options.maxBytes, DEFAULT_MAX_BYTES, MIN_BYTES, MAX_BYTES, 'maxBytes');
    if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('now must be a function.');
    this.now = options.now ?? Date.now;
  }

  record(event: LocalAuditEvent): LocalAuditOutcome<LocalAuditRecord> {
    if (!this.live) return failure('audit.disposed', 'The local audit exporter is disposed.');
    const parsed = parseEvent(event);
    if (!parsed.ok) return parsed;
    let at: number;
    try {
      at = this.now!();
    } catch {
      return failure('audit.clock', 'The local audit clock failed.');
    }
    if (!integer(at)) return failure('audit.clock', 'The local audit clock returned an invalid timestamp.');
    if (!integer(this.sequence + 1)) return failure('audit.budget', 'The local audit sequence budget is exhausted.');
    const value = frozen({
      version: '1' as const,
      sequence: this.sequence + 1,
      at,
      ...parsed.value,
    }) as LocalAuditRecord;
    const size = utf8Bytes(value);
    if (size > this.maxBytes)
      return failure('audit.budget', 'The local audit event exceeds the configured byte budget.');
    this.sequence++;
    while (this.records.length >= this.maxEvents || this.bytes + size > this.maxBytes) {
      const removed = this.records.shift();
      if (removed === undefined) break;
      this.bytes -= removed.bytes;
      this.dropped++;
    }
    this.records.push({ value, bytes: size });
    this.bytes += size;
    return { ok: true, value };
  }

  exportSnapshot(): LocalAuditOutcome<LocalAuditExport> {
    if (!this.live) return failure('audit.disposed', 'The local audit exporter is disposed.');
    return {
      ok: true,
      value: frozen({
        version: '1' as const,
        records: this.records.map(({ value }) => value),
        dropped: this.dropped,
        complete: this.dropped === 0,
        retainedBytes: this.bytes,
      }),
    };
  }

  clear(): boolean {
    if (!this.live) return false;
    this.records = [];
    this.bytes = 0;
    this.dropped = 0;
    return true;
  }

  dispose(): void {
    if (!this.live) return;
    this.records = [];
    this.bytes = 0;
    this.dropped = 0;
    this.now = undefined;
    this.live = false;
  }
}

export function createLocalAuditExporter(options: LocalAuditOptions = {}): LocalAuditExporter {
  return new LocalAuditExporterImpl(options);
}
