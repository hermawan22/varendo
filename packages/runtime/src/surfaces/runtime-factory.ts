import type { Intent, Outcome } from '@varendo/core';
import type {
  RuntimeRegionState,
  RuntimeRenderInput,
  RuntimeRenderReceipt,
  RuntimeResourceBinding,
} from '../app/types.js';
import type { MaterializedTaskOutput } from '../evaluation/types.js';
import type { RuntimeRenderPrepare } from '../app/runtime-render.js';
import type { ResultEvent } from '../results/types.js';
import { readSourceRevisionPin } from '../data/local/source-pin.js';
import { SurfaceControllerImpl } from './controller.js';
import { SurfaceRegistry } from './registration.js';
import { createLocalSurfaceScope } from './scope.js';
import type {
  CapabilitySurfaceBindings,
  CreateCapabilitySurfaceInput,
  CreateDataSurfaceInput,
  CreateLocalSurfaceScopeInput,
  DataSurfaceBindings,
  LocalSurfaceScope,
  SurfaceController,
  SurfaceOwnership,
} from './types.js';

type SurfaceInput = CreateDataSurfaceInput<unknown> | CreateCapabilitySurfaceInput<unknown, unknown>;

interface RuntimeSurfacePorts {
  readonly runtimeId: string;
  readonly mount: (
    input: { readonly regionId: string; readonly resourceId: string },
    binding: RuntimeResourceBinding,
  ) => Outcome<RuntimeRegionState>;
  readonly render: (input: RuntimeRenderInput, prepare?: RuntimeRenderPrepare) => Promise<RuntimeRenderReceipt>;
  readonly unmount: (regionId: string) => boolean;
}

export class RuntimeSurfaceFactory {
  private readonly registry: SurfaceRegistry;
  private readonly surfaces = new Set<SurfaceController<unknown, unknown>>();
  private sequence = 0;
  private disposed = false;

  constructor(private readonly ports: RuntimeSurfacePorts) {
    this.registry = new SurfaceRegistry(ports.runtimeId);
  }

  get runtimeId(): string {
    return this.ports.runtimeId;
  }

  createLocalScope(input?: CreateLocalSurfaceScopeInput): LocalSurfaceScope {
    if (this.disposed) throw new TypeError('The Varendo runtime is disposed.');
    return createLocalSurfaceScope(this.ports.runtimeId, input);
  }

  create(input: SurfaceInput): SurfaceController<unknown, unknown> {
    if (this.disposed) throw new TypeError('The Varendo runtime is disposed.');
    const registration = this.registry.acquire(input.scope.getSnapshot(), input.id, input.feature);
    const regionId = `surface-${++this.sequence}`;
    let mounted = false;
    try {
      if (input.feature.kind === 'data') {
        const binding = input.bindings as DataSurfaceBindings<unknown>;
        const result = this.ports.mount(
          { regionId, resourceId: input.feature.id },
          { resource: input.feature.resource, data: binding.source.service },
        );
        if (!result.ok) throw new TypeError(result.diagnostics[0].message);
        mounted = true;
      }
      const ownership = (input.ownership ?? { mode: 'internal' }) as SurfaceOwnership<unknown, unknown>;
      let controller!: SurfaceControllerImpl<unknown, unknown>;
      controller = new SurfaceControllerImpl({
        id: input.id,
        scope: input.scope,
        feature: input.feature,
        bindings: input.bindings as DataSurfaceBindings<unknown> | CapabilitySurfaceBindings<unknown, unknown>,
        ownership,
        registration,
        initialIntent: initialIntent(input, ownership),
        initialState: input.bindings.initialState,
        ...(input.feature.kind === 'data' ? { runData: this.dataRunner(input, regionId) } : {}),
        teardown: () => {
          if (mounted) this.ports.unmount(regionId);
          this.surfaces.delete(controller);
        },
      });
      this.surfaces.add(controller);
      return controller;
    } catch (error) {
      if (mounted) this.ports.unmount(regionId);
      registration.release();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const surface of [...this.surfaces]) surface.dispose();
    this.surfaces.clear();
  }

  private dataRunner(input: SurfaceInput, regionId: string) {
    return async (intent: Intent, signal: AbortSignal) => {
      const binding = input.bindings as DataSurfaceBindings<unknown>;
      let state: unknown;
      const receipt = await this.ports.render({ regionId, intent, signal }, async ({ outputs }) => {
        try {
          state = await binding.source.normalize(resultEvents(outputs), {
            scope: input.scope.getSnapshot(),
            signal,
          });
        } catch {
          return {
            ok: false,
            diagnostics: [
              {
                code: 'runtime.render-failed',
                message: 'The local result could not be normalized safely.',
                retryable: false,
              },
            ],
          };
        }
        const publicationDiagnostic = sourcePublicationDiagnostic(outputs, binding.source.service);
        if (publicationDiagnostic !== undefined)
          return {
            ok: false,
            diagnostics: [
              {
                code: publicationDiagnostic,
                message: 'The local source changed before Region publication.',
                retryable: false,
              },
            ],
          };
        return { ok: true, value: undefined };
      });
      if (receipt.status !== 'committed') return { receipt };
      return { receipt, state };
    };
  }
}

function sourcePublicationDiagnostic(
  outputs: readonly MaterializedTaskOutput[],
  service: DataSurfaceBindings<unknown>['source']['service'],
): string | undefined {
  const sourcePin = readSourceRevisionPin(service);
  if (sourcePin.kind === 'invalid') return 'runtime.render-stale';
  if (sourcePin.kind === 'current' && outputs.some((output) => output.handle.key.sourceRevision !== sourcePin.value))
    return 'runtime.render-stale';
  return undefined;
}

function initialIntent(input: SurfaceInput, ownership: SurfaceOwnership<unknown, unknown>): unknown {
  if (input.feature.kind === 'feature') {
    const binding = input.bindings as CapabilitySurfaceBindings<unknown, unknown>;
    if (!('initialIntent' in binding) || binding.initialIntent === undefined)
      throw new TypeError('Capability surface bindings require an initial intent.');
    return binding.initialIntent;
  }
  if (ownership.mode === 'internal' && ownership.defaultIntent !== undefined) return ownership.defaultIntent;
  return { version: '1', id: 'surface-request-0', resource: input.feature.id, kind: 'browse' } satisfies Intent;
}

async function* resultEvents(outputs: readonly MaterializedTaskOutput[]): AsyncIterable<ResultEvent> {
  for (const output of outputs) {
    const snapshot = output.handle.snapshot();
    if (snapshot.descriptor !== undefined) yield { kind: 'descriptor', descriptor: snapshot.descriptor };
    for (const batch of snapshot.batches) yield batch;
    if (
      snapshot.lastEvent !== undefined &&
      snapshot.lastEvent.kind !== 'batch' &&
      snapshot.lastEvent.kind !== 'descriptor'
    )
      yield snapshot.lastEvent;
  }
}
