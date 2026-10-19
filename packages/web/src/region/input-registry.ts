import type { Outcome, VersionRef } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { PresentationManifest, PresentationValues, ResolvedPresentationConfig } from '@varendo/core/presentation';
import { VARENDO_INPUT_REFS, type VarendoInputId, type VarendoInputRef } from '../input/manifest.js';
import { validateInputBinding } from './input-binding-validation.js';
import type { VarendoInputBinding, VarendoInputBindings, VarendoInputDraftBinding } from './input-registry-types.js';
import { boundedId, boundedText, clone, copyJson, exactKeys, fail, record } from './input-registry-support.js';

export type {
  VarendoInputActionBinding,
  VarendoInputBinding,
  VarendoInputBindings,
  VarendoInputDraftBinding,
  VarendoInputFileBinding,
} from './input-registry-types.js';

const CONFIG_SCHEMAS = Object.freeze(
  Object.fromEntries(
    Object.values(VARENDO_INPUT_REFS).map((ref) => [ref.id, { id: `${ref.id}.config`, revision: '1' }]),
  ),
) as Record<VarendoInputId, VersionRef>;

function copyBindings(input: VarendoInputBindings | undefined): Outcome<VarendoInputBindings> {
  if (input === undefined) return { ok: true, value: { revision: 'unconfigured', inputs: [] } };
  const copied = copyJson(input);
  const value = record(copied);
  if (
    value === undefined ||
    !boundedText(value.revision, 160, true) ||
    !Array.isArray(value.inputs) ||
    value.inputs.length > 128
  )
    return fail('binding', 'Input bindings require a bounded revision and input list.');
  const ids = new Set<string>();
  const entries: VarendoInputBinding[] = [];
  for (const item of value.inputs) {
    const candidate = record(item);
    if (candidate === undefined || ids.has(String(candidate.id)))
      return fail('binding', 'Input binding identifiers must be unique.');
    const checked = validateInputBinding(candidate as unknown as VarendoInputBinding);
    if (!checked.ok) return checked;
    ids.add(checked.value.id);
    entries.push(checked.value);
  }
  return { ok: true, value: clone({ revision: value.revision, inputs: entries }) };
}

function bindingValues(binding: VarendoInputBinding): Outcome<PresentationValues> {
  const config = record(binding.config)!;
  const output: Record<string, unknown> = { ...config, bindingRef: binding.id };
  if (binding.draft !== undefined) Object.assign(output, binding.draft);
  if (binding.range !== undefined) output.range = binding.range;
  if (binding.action !== undefined) {
    output.action = binding.action.action;
    output.actionInput = binding.action.input;
  }
  if (binding.file !== undefined) output.fileSchema = binding.file.schema;
  return { ok: true, value: output as PresentationValues };
}

function draftPort(binding: VarendoInputDraftBinding, id = 'draft'): InteractionPort {
  return { id, direction: 'output', payload: 'draft', entity: binding.entity, type: binding.type };
}

function portsFor(binding: VarendoInputBinding): readonly InteractionPort[] {
  if (binding.range !== undefined)
    return [draftPort(binding.range.start, 'start'), draftPort(binding.range.end, 'end')];
  if (binding.draft !== undefined) return [draftPort(binding.draft)];
  if (binding.action !== undefined) return [{ id: 'submit', direction: 'output', payload: 'action-request' }];
  if (binding.file !== undefined)
    return [{ id: 'files', direction: 'output', payload: 'extension', extension: binding.file.schema }];
  return [];
}

function resolveConfig(
  values: PresentationValues,
  entries: readonly VarendoInputBinding[],
  bindings: VarendoInputBindings,
): Outcome<ResolvedPresentationConfig> {
  const candidate = record(values);
  if (
    candidate === undefined ||
    !exactKeys(candidate, ['bindingRef', 'bindingRevision']) ||
    !boundedId(candidate.bindingRef) ||
    candidate.bindingRevision !== bindings.revision
  )
    return fail(
      'config',
      'Input nodes must reference the pinned host binding revision and a registered binding identifier.',
    );
  const binding = entries.find((entry) => entry.id === candidate.bindingRef);
  if (binding === undefined)
    return fail('binding', 'The requested input binding is not registered for this primitive.');
  const checked = validateInputBinding(binding);
  if (!checked.ok) return checked;
  const resolved = bindingValues(checked.value);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    value: {
      values: { ...resolved.value, bindingRevision: bindings.revision } as PresentationValues,
      fields: [],
      ports: portsFor(binding),
      operations: binding.action === undefined ? [] : [binding.action.action],
    },
  };
}

function buildManifest(ref: VarendoInputRef, bindings: VarendoInputBindings): PresentationManifest {
  const entries = bindings.inputs.filter((entry) => entry.ref.id === ref.id);
  const operations = entries.flatMap((entry) => {
    if (ref.id !== 'input.form' || entry.action === undefined) return [];
    return [entry.action.action];
  });
  const isContainer = ref.id === 'input.field-group' || ref.id === 'input.form';
  const children = isContainer ? { min: 0, max: 32 } : { min: 0, max: 0 };
  return {
    ref,
    configSchema: CONFIG_SCHEMAS[ref.id],
    roles: [isContainer ? 'structure' : 'input'],
    operations: [...new Map(operations.map((operation) => [JSON.stringify(operation), operation])).values()],
    result: 'none',
    children,
    visibility: isContainer ? 'simultaneous' : 'leaf',
    extension: false,
    resolveConfig: (values) => resolveConfig(values, entries, bindings),
  };
}

/** Build the registered semantic input manifests from an immutable host binding table. */
export function createInputPresentationManifests(
  input?: VarendoInputBindings,
): Outcome<readonly PresentationManifest[]> {
  const copied = copyBindings(input);
  if (!copied.ok) return copied;
  return {
    ok: true,
    value: Object.freeze(
      Object.values(VARENDO_INPUT_REFS).map((ref) => Object.freeze(buildManifest(ref, copied.value))),
    ),
  };
}
