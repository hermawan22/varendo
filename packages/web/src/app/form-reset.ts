import type { InteractionPayload } from '@varendo/core';
import { AeliqoFieldElement } from '../input/base.js';
import type { WebRegion } from './context.js';

type Draft = Extract<InteractionPayload, { readonly kind: 'draft' }>;
type Binding = Readonly<Record<string, unknown>>;

function matches(binding: Binding, draft: Draft): boolean {
  return (
    binding.entity === draft.entity &&
    binding.key === draft.key &&
    binding.field === draft.field &&
    binding.entityRevision === draft.entityRevision
  );
}

function object(value: unknown): Binding | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Binding) : undefined;
}

function bindings(values: Binding): readonly Binding[] {
  const range = object(values.range);
  if (range === undefined) return [values];
  const start = object(range.start);
  const end = object(range.end);
  return start === undefined || end === undefined ? [] : [start, end];
}

/** Reset registered controls to trusted defaults without reading their live values. */
export function resetSavedFormControls(region: WebRegion, captured: ReadonlyMap<string, Draft>): ReadonlySet<string> {
  const retained = new Set<string>();
  const controls = [...(region.element.shadowRoot?.querySelectorAll('[data-aeliqo-node-id]') ?? [])];
  for (const node of region.element.presentation?.nodes ?? []) {
    if (!node.config.ports.some((port) => port.payload === 'draft')) continue;
    const targets = bindings(node.config.values);
    const entries = targets.map((target) => [...captured].find(([, draft]) => matches(target, draft)));
    if (entries.every((entry) => entry === undefined)) continue;
    // A multi-field control resets as one unit. A newer sibling draft owns it.
    const newer = targets.some((target, index) => {
      const entry = entries[index];
      return entry === undefined
        ? [...region.drafts.values()].some((draft) => matches(target, draft))
        : region.drafts.get(entry[0]) !== entry[1];
    });
    if (newer) {
      entries.forEach((entry) => {
        if (entry !== undefined) retained.add(entry[0]);
      });
      continue;
    }
    const control = controls.find(
      (candidate) => candidate instanceof AeliqoFieldElement && candidate.dataset.aeliqoNodeId === node.node.id,
    );
    if (control instanceof AeliqoFieldElement) control.reset();
  }
  return retained;
}
