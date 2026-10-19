import { parseWireValue, type InteractionPayload } from '@varendo/core';
import {
  bounded,
  boundedStep,
  exactKeys,
  record,
  sameSemanticType,
  scalar,
  scalarType,
  validRef,
} from './input-interaction-values.js';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import {
  VarendoFileChangeEvent,
  VarendoFormSubmitEvent,
  VarendoInputChangeEvent,
  VarendoInputCommitEvent,
  VarendoSearchEvent,
  type VarendoFileChangeDetail,
  type VarendoFormSubmitDetail,
  type VarendoInputChangeDetail,
  type VarendoInputCommitDetail,
} from '../input/events.js';

type Node = ValidatedPresentation['nodes'][number];
type DraftPayload = Extract<InteractionPayload, { readonly kind: 'draft' }>;
type ActionPayload = Extract<InteractionPayload, { readonly kind: 'action-request' }>;
type ExtensionPayload = Extract<InteractionPayload, { readonly kind: 'extension' }>;

export type VarendoInputEmit = (node: Node, portId: string, payload: InteractionPayload) => void;

export interface VarendoInputInteraction {
  readonly portId: string;
  readonly payload: InteractionPayload;
}

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

function eventBoundary(event: Event, constructor: Function, type: string): boolean {
  return (
    event.type === type &&
    event instanceof (constructor as { new (...args: never[]): Event }) &&
    event.bubbles &&
    event.composed
  );
}

function changeDetail(event: Event): VarendoInputChangeDetail<unknown> | undefined {
  if (!eventBoundary(event, VarendoInputChangeEvent, 'varendo-input-change')) return undefined;
  const detail = (event as VarendoInputChangeEvent<unknown>).detail;
  if (
    record(detail) === undefined ||
    !exactKeys(detail as unknown as Record<string, unknown>, ['source', 'value', 'composing']) ||
    detail.source !== 'user' ||
    detail.composing === true
  )
    return undefined;
  return detail;
}

function commitDetail(event: Event): VarendoInputCommitDetail<unknown> | undefined {
  if (!eventBoundary(event, VarendoInputCommitEvent, 'varendo-input-commit')) return undefined;
  const detail = (event as VarendoInputCommitEvent<unknown>).detail;
  if (
    record(detail) === undefined ||
    !exactKeys(detail as unknown as Record<string, unknown>, ['source', 'value']) ||
    detail.source !== 'user'
  )
    return undefined;
  return detail;
}

function searchDetail(event: Event): string | undefined {
  if (!eventBoundary(event, VarendoSearchEvent, 'varendo-search')) return undefined;
  const detail = (event as VarendoSearchEvent).detail;
  if (
    record(detail) === undefined ||
    !exactKeys(detail as unknown as Record<string, unknown>, ['source', 'query']) ||
    detail.source !== 'user' ||
    !bounded(detail.query, 16_384, false)
  )
    return undefined;
  return detail.query;
}

function submitDetail(event: Event): VarendoFormSubmitDetail | undefined {
  if (!eventBoundary(event, VarendoFormSubmitEvent, 'varendo-form-submit')) return undefined;
  const detail = (event as VarendoFormSubmitEvent).detail;
  if (
    record(detail) === undefined ||
    !exactKeys(detail as unknown as Record<string, unknown>, ['source', 'submitter']) ||
    detail.source !== 'user' ||
    (detail.submitter !== undefined && !bounded(detail.submitter, 256))
  )
    return undefined;
  return detail;
}

function validFileMetadata(value: unknown): boolean {
  const file = record(value);
  if (file === undefined || !exactKeys(file, ['name', 'size', 'type', 'lastModified'])) return false;
  if (!bounded(file.name, 512) || !bounded(file.type, 256, false)) return false;
  if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) return false;
  return typeof file.lastModified === 'number' && Number.isSafeInteger(file.lastModified) && file.lastModified >= 0;
}

function fileDetail(event: Event): VarendoFileChangeDetail | undefined {
  if (!eventBoundary(event, VarendoFileChangeEvent, 'varendo-file-change')) return undefined;
  const detail = (event as VarendoFileChangeEvent).detail;
  if (
    record(detail) === undefined ||
    !exactKeys(detail as unknown as Record<string, unknown>, ['source', 'files']) ||
    detail.source !== 'user' ||
    !Array.isArray(detail.files) ||
    detail.files.length > 500
  )
    return undefined;
  if (!detail.files.every(validFileMetadata)) return undefined;
  return detail;
}

function port(node: Node, id: string, payload: InteractionPayload['kind']): boolean {
  return node.config.ports.some((candidate) => candidate.id === id && candidate.payload === payload);
}

function draftFrom(
  node: Node,
  binding: Record<string, unknown>,
  raw: unknown,
  numericText = false,
  portId = 'draft',
): DraftPayload | undefined {
  const entity = text(binding.entity);
  const key = text(binding.key);
  const field = text(binding.field);
  const entityRevision = text(binding.entityRevision);
  const type = scalarType(binding.type);
  if (
    !bounded(entity, 160) ||
    !bounded(key, 512) ||
    !bounded(field, 160) ||
    !bounded(entityRevision, 160) ||
    type === undefined
  )
    return undefined;
  const declaredPort = node.config.ports.find((candidate) => candidate.id === portId && candidate.payload === 'draft');
  if (declaredPort?.type === undefined || !sameSemanticType(declaredPort.type, type)) return undefined;
  const value = scalar(raw, type, numericText);
  return value === undefined ? undefined : { kind: 'draft', entity, key, field, value, entityRevision };
}

interface DraftEventValue {
  readonly raw: unknown;
  readonly numericText?: boolean;
}

function numberEventValue(event: Event, values: Record<string, unknown>): DraftEventValue | undefined {
  const candidate = record(commitDetail(event)?.value);
  if (candidate === undefined || !exactKeys(candidate, ['text', 'value', 'valid'])) return undefined;
  if (candidate.valid !== true || typeof candidate.value !== 'string') return undefined;
  if (!boundedStep(candidate.value, values.min, values.max, values.step)) return undefined;
  return { raw: candidate.value, numericText: true };
}

function sliderUnitMatches(candidate: Record<string, unknown>, values: Record<string, unknown>): boolean {
  const registeredUnit = scalarType(values.type)?.unit?.symbol;
  if (candidate.unit !== text(values.unit)) return false;
  if (registeredUnit !== undefined) return registeredUnit === candidate.unit;
  return candidate.unit === '';
}

function sliderEventValue(event: Event, values: Record<string, unknown>): DraftEventValue | undefined {
  const candidate = record(commitDetail(event)?.value);
  if (candidate === undefined || !exactKeys(candidate, ['value', 'unit'])) return undefined;
  if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) return undefined;
  if (!sliderUnitMatches(candidate, values)) return undefined;
  const minimum = values.min === undefined ? 0 : values.min;
  const maximum = values.max === undefined ? 100 : values.max;
  const step = values.step === undefined ? 1 : values.step;
  if (!boundedStep(candidate.value, minimum, maximum, step)) return undefined;
  return { raw: candidate.value };
}

function commitEventValue(event: Event): DraftEventValue | undefined {
  const commit = commitDetail(event);
  return commit === undefined ? undefined : { raw: commit.value };
}

function changeEventValue(event: Event, requireText: boolean): DraftEventValue | undefined {
  const change = changeDetail(event);
  if (change === undefined) return undefined;
  if (requireText && (typeof change.value !== 'string' || change.value.length === 0)) return undefined;
  return { raw: change.value };
}

function draftEventValue(ref: string, values: Record<string, unknown>, event: Event): DraftEventValue | undefined {
  switch (ref) {
    case 'input.number-field':
      return numberEventValue(event, values);
    case 'input.slider':
      return sliderEventValue(event, values);
    case 'input.search-field': {
      const query = searchDetail(event);
      if (query !== undefined) return { raw: query };
      break;
    }
    case 'input.text-field':
    case 'input.text-area':
    case 'input.date-field':
      return commitEventValue(event);
  }
  return changeEventValue(event, ref === 'input.combobox');
}

function interactionForDraft(node: Node, event: Event): readonly VarendoInputInteraction[] {
  const values = node.config.values as Record<string, unknown>;
  const value = draftEventValue(node.manifest.id, values, event);
  if (value === undefined || !port(node, 'draft', 'draft')) return [];
  const payload = draftFrom(node, values, value.raw, value.numericText === true);
  return payload === undefined ? [] : [{ portId: 'draft', payload }];
}

function rangeDetail(event: Event): Record<string, unknown> | undefined {
  const candidate = record(commitDetail(event)?.value);
  if (candidate === undefined || !exactKeys(candidate, ['start', 'end', 'boundary', 'timezone', 'calendar', 'valid']))
    return undefined;
  if (candidate.valid !== true || typeof candidate.start !== 'string' || typeof candidate.end !== 'string')
    return undefined;
  return candidate;
}

function rangeSettingsMatch(candidate: Record<string, unknown>, values: Record<string, unknown>): boolean {
  return (
    candidate.boundary === (values.boundary ?? 'inclusive') &&
    candidate.timezone === (values.timezone ?? 'calendar') &&
    candidate.calendar === (values.calendar ?? 'gregory')
  );
}

function rangeBindings(
  values: Record<string, unknown>,
): readonly [Record<string, unknown>, Record<string, unknown>] | undefined {
  const range = record(values.range);
  const start = range === undefined ? undefined : record(range.start);
  const end = range === undefined ? undefined : record(range.end);
  if (start === undefined || end === undefined) return undefined;
  return [start, end];
}

function rangeInteractions(
  node: Node,
  candidate: Record<string, unknown>,
  bindings: readonly [Record<string, unknown>, Record<string, unknown>],
): readonly VarendoInputInteraction[] {
  const startPayload = draftFrom(node, bindings[0], candidate.start, false, 'start');
  const endPayload = draftFrom(node, bindings[1], candidate.end, false, 'end');
  if (startPayload === undefined || endPayload === undefined) return [];
  if (!port(node, 'start', 'draft') || !port(node, 'end', 'draft')) return [];
  return [
    { portId: 'start', payload: startPayload },
    { portId: 'end', payload: endPayload },
  ];
}

function interactionForRange(node: Node, event: Event): readonly VarendoInputInteraction[] {
  const candidate = rangeDetail(event);
  if (candidate === undefined) return [];
  const values = node.config.values as Record<string, unknown>;
  if (!rangeSettingsMatch(candidate, values)) return [];
  const bindings = rangeBindings(values);
  if (bindings === undefined) return [];
  return rangeInteractions(node, candidate, bindings);
}

function interactionForForm(node: Node, event: Event): readonly VarendoInputInteraction[] {
  if (submitDetail(event) === undefined || !port(node, 'submit', 'action-request')) return [];
  const values = node.config.values as Record<string, unknown>;
  const action = values.action;
  if (!validRef(action)) return [];
  const operations = node.config.operations;
  if (
    !Array.isArray(operations) ||
    !operations.some(
      (operation) => validRef(operation) && operation.id === action.id && operation.revision === action.revision,
    )
  )
    return [];
  const actionInput = record(values.actionInput);
  if (actionInput === undefined) return [];
  if (Object.keys(actionInput).length > 128 || !Object.keys(actionInput).every((key) => bounded(key, 160))) return [];
  const input = parseWireValue(actionInput);
  if (!input.ok || record(input.value) === undefined) return [];
  const payload: ActionPayload = { kind: 'action-request', action, input: input.value as ActionPayload['input'] };
  return [{ portId: 'submit', payload }];
}

function interactionForFile(node: Node, event: Event): readonly VarendoInputInteraction[] {
  const detail = fileDetail(event);
  const values = node.config.values as Record<string, unknown>;
  const schema = values.fileSchema;
  if (detail === undefined || !validRef(schema) || !port(node, 'files', 'extension')) return [];
  const extension = node.config.ports.find(
    (candidate) => candidate.id === 'files' && candidate.payload === 'extension',
  )?.extension;
  if (extension === undefined || extension.id !== schema.id || extension.revision !== schema.revision) return [];
  const files = detail.files.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  }));
  const payload: ExtensionPayload = { kind: 'extension', schema, value: { files } };
  return [{ portId: 'files', payload }];
}

/** Validate a typed input event against the registered node binding. No model or host effect is invoked. */
export function resolveInputInteraction(node: Node, event: Event): readonly VarendoInputInteraction[] {
  switch (node.manifest.id) {
    case 'input.date-range':
      return interactionForRange(node, event);
    case 'input.form':
      return interactionForForm(node, event);
    case 'input.file-input':
      return interactionForFile(node, event);
    case 'input.field-group':
      return [];
    default:
      return interactionForDraft(node, event);
  }
}
