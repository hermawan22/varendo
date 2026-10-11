import * as z from 'zod';
import type { Intent, Outcome } from '@varendo/core';
import { defineDataFeature, inferLocalDataShape } from '@varendo/core/features';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import type { DataFeatureDefinition, LocalDataShape, LocalDataShapeField } from '@varendo/core/features';
import { createAeliqoRuntime } from '../app/runtime.js';
import type { AeliqoRuntime } from '../app/types.js';
import type { DataRecord, ResultEvent } from '../data/types.js';
import { createLocalDataBinding } from './local-data.js';
import type { LocalDataSurfaceBinding } from './local-data.js';
import type { SurfaceController } from './types.js';

export interface LocalBrowseState {
  readonly rows: readonly DataRecord[];
}

export interface LocalDataSurfaceInput<Row extends DataRecord> {
  readonly id?: string;
  readonly data: readonly Row[];
  readonly getRowId: (row: Row) => unknown;
  readonly schema?: z.ZodObject;
  /** Required with an empty initial array, where a callback cannot reveal its field. */
  readonly identity?: string;
}

export interface OwnedLocalDataSurface<Row extends DataRecord> {
  readonly surface: SurfaceController<Intent, LocalBrowseState>;
  replaceData(data: readonly Row[]): Outcome<void>;
  dispose(): void;
}

let nextLocalSurfaceId = 1;

function fieldSchema(field: LocalDataShapeField): z.ZodType {
  let schema: z.ZodType;
  switch (field.kind) {
    case 'text':
    case 'date':
    case 'instant':
      schema = z.string();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'integer':
      schema = z.number().int();
      break;
    case 'float':
      schema = z.number();
      break;
    default:
      throw new TypeError(`data.shape-unsupported: Field ${field.id} needs an explicit typed binding.`);
  }
  return field.nullable ? schema.nullable() : schema;
}

function schemaFor(shape: LocalDataShape, declared?: z.ZodObject): z.ZodObject {
  if (declared !== undefined) return declared;
  const fields: Record<string, z.ZodType> = {};
  for (const field of shape.fields) fields[field.id] = fieldSchema(field);
  return z.object(fields);
}

function inspect<Row extends DataRecord>(
  id: string,
  data: readonly Row[],
  getRowId: (row: Row) => unknown,
  schema?: z.ZodObject,
  emptyIdentity?: string,
): LocalDataShape {
  const shape =
    data.length === 0 && emptyIdentity !== undefined
      ? inferLocalDataShape({ id, rows: data, identity: [emptyIdentity], ...(schema === undefined ? {} : { schema }) })
      : inferLocalDataShape({
          id,
          rows: data,
          getRowId: getRowId as (row: unknown) => unknown,
          ...(schema === undefined ? {} : { schema }),
        });
  if (!shape.ok) throw new TypeError(`${shape.diagnostics[0].code}: ${shape.diagnostics[0].message}`);
  if (shape.value.identity.length !== 1)
    throw new TypeError('data.identity-ambiguous: A local data surface needs one real scalar identity field.');
  return shape.value;
}

async function normalizeRows(events: AsyncIterable<ResultEvent>): Promise<LocalBrowseState> {
  const rows: DataRecord[] = [];
  for await (const event of events) {
    if (event.kind === 'error') throw new TypeError(event.error.message);
    if (event.kind !== 'batch') continue;
    rows.push(...event.rows);
  }
  return Object.freeze({ rows: Object.freeze(rows) });
}

function createBindings<Row extends DataRecord>(
  id: string,
  data: readonly Row[],
  shape: LocalDataShape,
  feature: DataFeatureDefinition,
): LocalDataSurfaceBinding<LocalBrowseState> {
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new TypeError(functions.diagnostics[0].message);
  return createLocalDataBinding({
    feature,
    snapshot: { catalog: feature.catalog, sourceRevision: 'local-source-1', records: { [id]: data } },
    initialState: Object.freeze({ rows: Object.freeze([]) }),
    coverage: {
      fields: shape.fields.map((field) => field.id),
      operators: ['eq', 'contains'],
      pagination: 'snapshot',
      stableOrder: [shape.identity[0]!],
      sorting: 'stable-fields-only',
      aggregation: 'unsupported',
      streaming: 'finite',
      updates: 'snapshot-replace',
      unsupported: ['aggregation', 'streaming', 'live-updates'],
    },
    normalize: normalizeRows,
    serviceOptions: {
      functionRegistry: functions.value,
      revisionMode: { kind: 'monotonic', prefix: 'local-source-' },
      authorize: ({ context }) => {
        if (context.principal === id) return { ok: true, value: { scopeDigest: `local:${id}`, policyRevision: '1' } };
        return {
          ok: false,
          diagnostics: [
            { code: 'data.denied', message: 'This local source is scoped to its owner.', retryable: false },
          ],
        };
      },
    },
  });
}

function createLocalRuntime(
  id: string,
  feature: DataFeatureDefinition,
  bindings: LocalDataSurfaceBinding<LocalBrowseState>,
): AeliqoRuntime {
  return createAeliqoRuntime({
    resources: [{ resource: feature.resource, data: bindings.service }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: id,
          scopeDigest: `local:${id}`,
          policyRevision: '1',
          experienceRevision: '1',
          grants: ['catalog.read', 'task.evaluate', 'result.inspect'],
          readContext: { principal: id },
        },
      }),
    },
  });
}

function replacement<Row extends DataRecord>(
  input: LocalDataSurfaceInput<Row>,
  id: string,
  identity: string,
  schema: z.ZodObject,
  feature: DataFeatureDefinition,
  bindings: LocalDataSurfaceBinding<LocalBrowseState>,
  isDisposed: () => boolean,
): (data: readonly Row[]) => Outcome<void> {
  let revision = 1;
  return (data) => {
    if (isDisposed())
      return {
        ok: false,
        diagnostics: [
          { code: 'data.source-disposed', message: 'The local data surface is disposed.', retryable: false },
        ],
      };
    let nextShape: LocalDataShape;
    try {
      nextShape = inspect(id, data, input.getRowId, schema, identity);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid local rows.';
      const code = message.split(':', 1)[0] ?? 'data.shape-inconsistent';
      return { ok: false, diagnostics: [{ code, message, retryable: false }] };
    }
    if (nextShape.identity[0] !== identity)
      return {
        ok: false,
        diagnostics: [{ code: 'data.identity-ambiguous', message: 'The identity field changed.', retryable: false }],
      };
    const next = bindings.service.replaceSnapshot({
      catalog: feature.catalog,
      sourceRevision: `local-source-${revision + 1}`,
      records: { [id]: data },
    });
    if (next.ok) revision += 1;
    return next;
  };
}

/** Owns an isolated local runtime and a single controller; call from committed UI lifecycle. */
export function createLocalDataSurface<Row extends DataRecord>(
  input: LocalDataSurfaceInput<Row>,
): OwnedLocalDataSurface<Row> {
  const id = input.id ?? `local-data-${nextLocalSurfaceId++}`;
  const shape = inspect(id, input.data, input.getRowId, input.schema, input.identity);
  if (input.identity !== undefined && shape.identity[0] !== input.identity)
    throw new TypeError('data.identity-ambiguous: The declared identity does not match getRowId.');
  const schema = schemaFor(shape, input.schema);
  const identity = shape.identity[0];
  if (identity === undefined) throw new TypeError('data.identity-ambiguous: A local identity field is required.');
  const feature = defineDataFeature({ id, schema, identity: [identity] });
  const bindings = createBindings(id, input.data, shape, feature);
  const runtime = createLocalRuntime(id, feature, bindings);
  const scope = runtime.createLocalSurfaceScope({ allowedFeatures: [id] });
  let surface: SurfaceController<Intent, LocalBrowseState>;
  try {
    surface = runtime.createSurface({ scope, id, feature, bindings });
  } catch (error) {
    scope.dispose();
    runtime.dispose();
    throw error;
  }
  let disposed = false;
  return {
    surface,
    replaceData: replacement(input, id, identity, schema, feature, bindings, () => disposed),
    dispose() {
      if (disposed) return;
      disposed = true;
      surface.dispose();
      scope.dispose();
      runtime.dispose();
    },
  };
}
