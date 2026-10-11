import { WIRE_LIMITS } from '@varendo/core';
import type { RegionContent } from '../tasks/types.js';
import type { ResultHandle } from '../results/types.js';
import { failure, validText } from './controller-common.js';
import type { InteractionFailure, InteractionMaterialization, InteractionOutcome } from './types.js';

function validDiagnostic(value: unknown): value is InteractionFailure {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return validText(candidate.code) && validText(candidate.message) && typeof candidate.retryable === 'boolean';
}

function invalidCallbackDiagnostic(): InteractionOutcome<void> {
  return failure('runtime.interaction-denied', 'A host interaction callback returned an invalid diagnostic.');
}

function parseCallbackFailure(diagnostics: unknown[]): InteractionOutcome<void> {
  if (diagnostics.length === 0) return invalidCallbackOutcome();
  const checked: InteractionFailure[] = [];
  for (const diagnostic of diagnostics) {
    if (!validDiagnostic(diagnostic)) return invalidCallbackDiagnostic();
    checked.push(
      Object.freeze({
        code: diagnostic.code,
        message: diagnostic.message,
        retryable: diagnostic.retryable,
      }),
    );
  }
  return { ok: false, diagnostics: checked as [InteractionFailure, ...InteractionFailure[]] };
}

function invalidCallbackOutcome(): InteractionOutcome<void> {
  return failure('runtime.interaction-denied', 'A host interaction callback returned an invalid outcome.');
}

export function callbackOutcome(value: unknown): InteractionOutcome<void> {
  if (value === null || typeof value !== 'object') return invalidCallbackOutcome();
  const record = value as Record<string, unknown>;
  if (isEmptySuccess(record)) return { ok: true, value: undefined };
  if (record.ok === false && Array.isArray(record.diagnostics)) return parseCallbackFailure(record.diagnostics);
  return invalidCallbackOutcome();
}

function isEmptySuccess(record: Record<string, unknown>): boolean {
  return (
    record.ok === true &&
    Object.keys(record).length === 2 &&
    Object.hasOwn(record, 'value') &&
    record.value === undefined
  );
}

function isMaterializationContainer(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).every((key) => key === 'state' || key === 'resultHandles') &&
    Object.hasOwn(candidate, 'state') &&
    candidate.state !== null &&
    typeof candidate.state === 'object' &&
    !Array.isArray(candidate.state)
  );
}

function validResultHandles(value: unknown): value is readonly ResultHandle[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= WIRE_LIMITS.array);
}

function invalidMaterialization(): InteractionOutcome<InteractionMaterialization> {
  return failure('runtime.interaction-denied', 'The host materializer returned an invalid outcome.');
}

export function materializationOutcome(value: unknown): InteractionOutcome<InteractionMaterialization> {
  if (value === null || typeof value !== 'object') return invalidMaterialization();
  const record = value as Record<string, unknown>;
  if (record.ok === false) return materializerFailure(value);
  if (!isMaterializationSuccess(record)) return invalidMaterialization();
  const candidate = record.value;
  if (!isMaterializationContainer(candidate))
    return failure('runtime.interaction-denied', 'The host materializer returned an invalid region candidate.');
  if (!validResultHandles(candidate.resultHandles))
    return failure('runtime.interaction-budget', 'The host materializer returned too many result handles.');
  return { ok: true, value: normalizeMaterialization(candidate) };
}

function isMaterializationSuccess(record: Record<string, unknown>): boolean {
  return record.ok === true && Object.keys(record).length === 2 && Object.hasOwn(record, 'value');
}

function materializerFailure(value: unknown): InteractionOutcome<InteractionMaterialization> {
  const checked = callbackOutcome(value);
  if (checked.ok) return invalidMaterialization();
  return checked as InteractionOutcome<InteractionMaterialization>;
}

function normalizeMaterialization(candidate: Record<string, unknown>): InteractionMaterialization {
  // Handles are live leases: freeze the array but leave each capability mutable.
  const resultHandles =
    candidate.resultHandles === undefined
      ? undefined
      : Object.freeze([...(candidate.resultHandles as readonly ResultHandle[])]);
  return Object.freeze({
    state: candidate.state as RegionContent,
    ...(resultHandles === undefined ? {} : { resultHandles }),
  });
}
