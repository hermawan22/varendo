import type { FeatureDefinition } from '@varendo/core/features';
import { freezeAddress } from './state.js';
import type { SurfaceAddress, SurfaceScopeSnapshot } from './types.js';

interface FeatureRegistration {
  readonly kind: FeatureDefinition['kind'];
  readonly revision: string;
  readonly definition: FeatureDefinition;
  references: number;
}

export interface SurfaceRegistration {
  readonly address: SurfaceAddress;
  release(): void;
}

export class SurfaceRegistry {
  private readonly active = new Set<string>();
  private readonly features = new Map<string, FeatureRegistration>();
  private generation = 0;

  constructor(private readonly runtimeId: string) {}

  acquire(scope: SurfaceScopeSnapshot, surfaceId: string, feature: FeatureDefinition): SurfaceRegistration {
    this.validateScope(scope);
    const targetKey = JSON.stringify([scope.scopeInstanceId, scope.activationEpoch, surfaceId]);
    if (this.active.has(targetKey)) throw new TypeError(`Surface ${surfaceId} is already registered in this scope.`);
    const featureKey = JSON.stringify([scope.scopeInstanceId, scope.activationEpoch, feature.id]);
    const existing = this.features.get(featureKey);
    if (
      existing !== undefined &&
      (existing.revision !== feature.definitionRevision ||
        existing.kind !== feature.kind ||
        existing.definition !== feature)
    )
      throw new TypeError(`Feature ${feature.id} has an incompatible revision while registered surfaces are active.`);
    if (existing === undefined)
      this.features.set(featureKey, {
        kind: feature.kind,
        revision: feature.definitionRevision,
        definition: feature,
        references: 1,
      });
    else existing.references += 1;
    if (this.generation >= Number.MAX_SAFE_INTEGER) throw new TypeError('The surface generation limit was reached.');
    const generation = ++this.generation;
    this.active.add(targetKey);
    const address = freezeAddress({
      runtimeId: this.runtimeId,
      scopeInstanceId: scope.scopeInstanceId,
      activationEpoch: scope.activationEpoch,
      surfaceId,
      surfaceGeneration: generation,
    });
    let released = false;
    return {
      address,
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(targetKey);
        const registration = this.features.get(featureKey);
        if (registration === undefined) return;
        registration.references -= 1;
        if (registration.references === 0) this.features.delete(featureKey);
      },
    };
  }

  private validateScope(scope: SurfaceScopeSnapshot): void {
    if (!scope.active) throw new TypeError('Surface creation requires an active scope.');
    if (scope.runtimeId !== this.runtimeId) throw new TypeError('The surface scope belongs to another runtime.');
  }
}
