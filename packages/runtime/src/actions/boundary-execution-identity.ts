import { canonical } from './boundary-common.js';
import type { ReceiptRecord } from './boundary-common.js';
import type { TrustedActionContext } from './types.js';

export function entityCurrent(record: ReceiptRecord, current: TrustedActionContext): boolean {
  if (record.registration.descriptor.entityRevision === 'none') return true;
  if (record.entity === undefined || current.entityRevisions === undefined) return false;
  return current.entityRevisions[record.entity.key] === record.entity.revision;
}

export function idempotencyKey(context: TrustedActionContext, key: string): string {
  return canonical({
    principalKey: context.principalKey,
    actorKey: context.actorKey,
    scopeDigest: context.scopeDigest,
    policyRevision: context.policyRevision,
    domainRevision: context.domainRevision,
    key,
  });
}
