import type { SurfaceAddress } from '../surfaces/types.js';
import type { ScopeSnapshot } from './types.js';

export class ScopeTargetRegistry {
  private readonly targets = new Map<number, Set<() => void>>();

  register(address: SurfaceAddress, current: ScopeSnapshot, fence: () => void): () => void {
    if (
      !current.active ||
      address.runtimeId !== current.runtimeId ||
      address.scopeInstanceId !== current.scopeInstanceId ||
      address.activationEpoch !== current.activationEpoch
    )
      throw new TypeError('A surface target must belong to the current active scope activation.');
    const targets = this.targets.get(address.activationEpoch) ?? new Set<() => void>();
    targets.add(fence);
    this.targets.set(address.activationEpoch, targets);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      targets.delete(fence);
      if (targets.size === 0) this.targets.delete(address.activationEpoch);
    };
  }

  fence(epoch: number): void {
    const targets = this.targets.get(epoch);
    if (targets === undefined) return;
    this.targets.delete(epoch);
    for (const fence of [...targets]) {
      try {
        fence();
      } catch {
        // One target cannot prevent the remaining activation from being fenced.
      }
    }
  }
}
