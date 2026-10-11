import { parseWireValue, type Outcome, type VersionRef } from '@varendo/core';
import type { InteractionPort } from '@varendo/core/interaction';
import type { AeliqoDataColumn } from '../data/index.js';
import { createDataManifests } from './data-registry-manifests.js';
import type {
  AeliqoDataBinding,
  AeliqoDataComponentId,
  AeliqoDataManifest,
  AeliqoDataNodeInput,
  AeliqoDataRegistry,
  AeliqoDataRegistryOptions,
  AeliqoDataResolvedConfig,
  AeliqoDataResolvedNode,
  AeliqoValidatedBinding,
} from './data-registry-types.js';
import { AELIQO_DATA_REFS } from './data-registry-types.js';
import { validateAeliqoDataBinding } from './data-registry-validation.js';
import { failure } from './data-registry-common.js';

export { AELIQO_DATA_CONFIG_SCHEMAS, AELIQO_DATA_REFS } from './data-registry-types.js';
export type {
  AeliqoDataBinding,
  AeliqoDataComponentId,
  AeliqoDataRegistry,
  AeliqoDataRegistryOptions,
  AeliqoDataResolvedNode,
  AeliqoValidatedBinding,
} from './data-registry-types.js';
export { validateAeliqoDataBinding } from './data-registry-validation.js';

const MAX_NODE_ID = 128;
const MAX_VALUE_KEYS = 256;

interface ResolvedNodeInput {
  readonly id: string;
  readonly component: AeliqoDataComponentId;
  readonly manifest: AeliqoDataManifest;
}

function componentFor(component: AeliqoDataNodeInput['component']): AeliqoDataComponentId | undefined {
  if (typeof component === 'string') {
    return Object.hasOwn(AELIQO_DATA_REFS, component) ? (component as AeliqoDataComponentId) : undefined;
  }
  return (Object.keys(AELIQO_DATA_REFS) as AeliqoDataComponentId[]).find((key) => {
    const ref = AELIQO_DATA_REFS[key];
    return ref.id === component.id && ref.revision === component.revision;
  });
}

function refKey(ref: VersionRef): string {
  return `${ref.id}@${ref.revision}`;
}

function validateNodeInput(
  input: AeliqoDataNodeInput,
  manifestsByRef: ReadonlyMap<string, AeliqoDataManifest>,
): Outcome<ResolvedNodeInput> {
  if (
    input === null ||
    typeof input !== 'object' ||
    typeof input.id !== 'string' ||
    input.id.length === 0 ||
    input.id.length > MAX_NODE_ID
  ) {
    return failure('config', 'A data node requires a bounded ID.');
  }
  const component = componentFor(input.component);
  if (component === undefined) return failure('config', 'The data node representation is not registered.');
  const manifest = manifestsByRef.get(refKey(AELIQO_DATA_REFS[component]));
  if (manifest === undefined) return failure('config', 'The data node representation is not registered.');
  return { ok: true, value: { id: input.id, component, manifest } };
}

function parseNodeConfig(input: AeliqoDataNodeInput): Outcome<Readonly<Record<string, unknown>>> {
  const values = input.config ?? {};
  if (
    values === null ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.keys(values).length > MAX_VALUE_KEYS
  ) {
    return failure('config', 'Data configuration must be a bounded object.');
  }
  const parsed = parseWireValue(values);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return failure('config', 'Data configuration must contain only bounded JSON values.');
  }
  return { ok: true, value: parsed.value as Readonly<Record<string, unknown>> };
}

function freezePort(port: InteractionPort): InteractionPort {
  return Object.freeze({
    ...port,
    ...(port.identity === undefined ? {} : { identity: Object.freeze([...port.identity]) }),
    ...(port.grain === undefined ? {} : { grain: Object.freeze([...port.grain]) }),
  });
}

function freezeConfig(
  config: AeliqoDataResolvedConfig,
  selectedColumns: readonly AeliqoDataColumn[],
): AeliqoDataResolvedConfig {
  return Object.freeze({
    ...config,
    values: Object.freeze({ ...config.values }),
    columns: Object.freeze(selectedColumns.map((column) => Object.freeze({ ...column }))),
    fields: Object.freeze([...config.fields]),
    identity: Object.freeze([...config.identity]),
    ports: Object.freeze(config.ports.map(freezePort)),
  });
}

function materializeNode(
  input: ResolvedNodeInput,
  binding: AeliqoValidatedBinding,
  config: AeliqoDataResolvedConfig,
): AeliqoDataResolvedNode {
  const nodeColumns = config.columns.length === 0 ? binding.columns : config.columns;
  return Object.freeze({
    id: input.id,
    component: input.component,
    ref: input.manifest.ref,
    result: binding.result,
    rows: binding.rows,
    columns: nodeColumns,
    scope: binding.scope,
    config: freezeConfig(config, nodeColumns),
  });
}

function resolveNode(
  input: AeliqoDataNodeInput,
  binding: AeliqoDataBinding,
  options: AeliqoDataRegistryOptions,
  manifestsByRef: ReadonlyMap<string, AeliqoDataManifest>,
): Outcome<AeliqoDataResolvedNode> {
  try {
    const node = validateNodeInput(input, manifestsByRef);
    if (!node.ok) return node;
    const checkedBinding = validateAeliqoDataBinding(binding, options);
    if (!checkedBinding.ok) return checkedBinding;
    const values = parseNodeConfig(input);
    if (!values.ok) return values;
    const config = node.value.manifest.resolveConfig(values.value, checkedBinding.value, options);
    if (!config.ok) return config;
    return { ok: true, value: materializeNode(node.value, checkedBinding.value, config.value) };
  } catch {
    return failure('config', 'The data node could not be validated.');
  }
}

export function createAeliqoDataRegistry(options: AeliqoDataRegistryOptions = {}): AeliqoDataRegistry {
  const entries = createDataManifests();
  const manifestsByRef = new Map(entries.map((entry) => [refKey(entry.ref), entry]));
  const resolve = (input: AeliqoDataNodeInput, binding: AeliqoDataBinding) =>
    resolveNode(input, binding, options, manifestsByRef);
  return Object.freeze({ manifests: entries, resolve });
}
