import { parseWireValue, type Outcome } from '@varendo/core';
import type { ActionRequest } from '@varendo/runtime/actions';
import { bounded, failure, record } from './values.js';

interface ParsedActionPreview {
  readonly mode: 'preview';
  readonly action: ActionRequest['action'];
  readonly input: ActionRequest['input'];
  readonly entity?: ActionRequest['entity'];
  readonly idempotencyKey?: string;
}

interface ParsedActionExecute {
  readonly mode: 'execute';
  readonly previewId: string;
}

export type ParsedAction = ParsedActionPreview | ParsedActionExecute;

function onlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseExecute(value: Readonly<Record<string, unknown>>): Outcome<ParsedAction> {
  if (!onlyKeys(value, ['mode', 'previewId']) || !bounded(value.previewId))
    return failure('agent.app.action-input', 'Execute requires one bounded previewId.');
  return { ok: true, value: { mode: 'execute', previewId: value.previewId } };
}

function validActionReference(value: unknown): value is ActionRequest['action'] {
  return record(value) && bounded(value.id) && bounded(value.revision) && Object.keys(value).length === 2;
}

function parseEntity(value: unknown): Outcome<ActionRequest['entity'] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!record(value) || !bounded(value.key) || !bounded(value.revision) || Object.keys(value).length !== 2)
    return failure('agent.app.action-input', 'Action entity identity is malformed.');
  return { ok: true, value: { key: value.key, revision: value.revision } };
}

function parsePreview(value: Readonly<Record<string, unknown>>): Outcome<ParsedAction> {
  if (!onlyKeys(value, ['mode', 'action', 'input', 'entity', 'idempotencyKey']))
    return failure('agent.app.action-input', 'Preview contains an unknown field.');
  const action = value.action;
  if (!validActionReference(action) || !record(value.input))
    return failure('agent.app.action-input', 'Preview requires a registered action reference and object input.');
  const entity = parseEntity(value.entity);
  if (!entity.ok) return entity;
  if (value.idempotencyKey !== undefined && !bounded(value.idempotencyKey))
    return failure('agent.app.action-input', 'Idempotency key is malformed.');
  return {
    ok: true,
    value: {
      mode: 'preview',
      action: { id: action.id, revision: action.revision },
      input: value.input,
      ...(entity.value === undefined ? {} : { entity: entity.value }),
      ...(value.idempotencyKey === undefined ? {} : { idempotencyKey: value.idempotencyKey }),
    },
  };
}

export function parseAction(input: unknown): Outcome<ParsedAction> {
  const inspected = parseWireValue(input);
  if (!inspected.ok) return inspected;
  const value = inspected.value;
  if (!record(value) || (value.mode !== 'preview' && value.mode !== 'execute'))
    return failure('agent.app.action-input', 'Action input must request preview or execute.');
  return value.mode === 'execute' ? parseExecute(value) : parsePreview(value);
}
