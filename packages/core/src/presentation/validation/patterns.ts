import type { PresentationRegistry, PresentationPatternManifest } from '../types.js';
import { isThenable, versionKey } from '../registry.js';
import type { PreparedPresentationContext, PresentationPlanLike } from './types.js';

export function patternIsAllowed(pattern: PresentationPatternManifest, prepared: PreparedPresentationContext): boolean {
  return prepared.constraints.allowedPatterns.includes(pattern.ref.id);
}

function samePattern(left: PresentationPatternManifest, right: PresentationPatternManifest): boolean {
  return versionKey(left.ref) === versionKey(right.ref);
}

function applicablePatterns(
  registry: PresentationRegistry,
  prepared: PreparedPresentationContext,
  requiredPattern: PresentationPatternManifest | undefined,
): readonly PresentationPatternManifest[] {
  const patterns = registry.patterns ?? [];
  if (requiredPattern === undefined) return patterns.filter((pattern) => patternIsAllowed(pattern, prepared));
  return patterns.filter((pattern) => samePattern(pattern, requiredPattern) && patternIsAllowed(pattern, prepared));
}

export function matchesPattern(
  plan: PresentationPlanLike,
  prepared: PreparedPresentationContext,
  registry: PresentationRegistry,
  requiredPattern?: PresentationPatternManifest,
): boolean {
  for (const pattern of applicablePatterns(registry, prepared, requiredPattern)) {
    try {
      const matched = pattern.matches(plan, prepared.patternContext);
      if (isThenable(matched) || typeof matched !== 'boolean') continue;
      if (matched) return true;
    } catch {
      // A local pattern failure makes the pattern inapplicable; it never grants validity.
    }
  }
  return false;
}
