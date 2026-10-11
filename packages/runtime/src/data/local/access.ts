import type { Catalog } from '@varendo/core';
import type { CatalogEntity } from '@varendo/core/semantics';
import type { CatalogTarget, ReadGrant } from '../types.js';
import { canonical } from './shared.js';
import { issueCursor, type CursorStore, type CursorValue } from './cursor.js';

export function getEntity(catalog: Catalog, entityId: string): CatalogEntity | undefined {
  return catalog.entities.find((entity) => entity.id === entityId);
}

export function allowedEntity(grant: ReadGrant, entityId: string): boolean {
  return grant.entities === undefined || grant.entities.includes(entityId);
}

export function allowedField(grant: ReadGrant, entityId: string, fieldId: string): boolean {
  if (grant.fields === undefined) return true;
  return grant.fields[entityId]?.includes(fieldId) ?? false;
}

export function allowedIdentity(grant: ReadGrant, entity: CatalogEntity): boolean {
  return entity.identity.every((field) => allowedField(grant, entity.id, field));
}

export function allowedTarget(target: CatalogTarget, catalog: Catalog, grant: ReadGrant): boolean {
  if (target.kind === 'catalog') return true;
  const entity = getEntity(catalog, target.entity);
  if (entity === undefined || !allowedEntity(grant, target.entity) || !allowedIdentity(grant, entity)) return false;
  return entity.rowGrain.every((field) => allowedField(grant, entity.id, field));
}

export function mergeCatalogPage(
  catalog: Catalog,
  target: CatalogTarget,
  grant: ReadGrant,
  offset: number,
  pageSize: number,
  sourceRevision: string,
  scopeDigest: string,
  expiresAt: number,
  cursorPartition: string,
  cursorStore: CursorStore,
  cursorNow: number,
  maxCursorEntries: number,
): { catalog: Catalog; nextCursor?: string } {
  let visibleEntities = catalog.entities.filter((entity) => isEntityVisible(entity, grant));
  if (target.kind === 'entity') visibleEntities = visibleEntities.filter((entity) => entity.id === target.entity);
  const page = visibleEntities.slice(offset, offset + pageSize);
  const pageEntityIds = new Set(page.map((entity) => entity.id));
  const relationships = catalog.relationships.filter((relationship) =>
    isRelationshipVisible(relationship, pageEntityIds, grant),
  );
  const visibleRelationshipRefs = new Set(
    relationships.map((relationship) => `${relationship.id}@${relationship.revision}`),
  );
  const capabilities = catalog.capabilities.filter((capability) =>
    isCapabilityVisible(capability, pageEntityIds, visibleRelationshipRefs, grant),
  );
  const entities = page.map((entity) => visibleEntityFields(entity, grant));
  const nextOffset = offset + page.length;
  const cursorValue: CursorValue = {
    version: 1,
    mode: 'snapshot',
    kind: 'catalog',
    catalogRevision: catalog.revision,
    target: canonical(target),
    sourceRevision,
    snapshotId: sourceRevision,
    scopeDigest,
    offset: nextOffset,
    ...(grant.policyRevision === undefined ? {} : { policyRevision: grant.policyRevision }),
    expiresAt,
  };
  return {
    catalog: {
      ...catalog,
      entities,
      relationships,
      capabilities,
      meanings: grant.fields !== undefined || grant.entities !== undefined ? [] : catalog.meanings,
    },
    ...(nextOffset < visibleEntities.length
      ? {
          nextCursor: issueCursor(cursorValue, cursorPartition, cursorStore, cursorNow, maxCursorEntries),
        }
      : {}),
  };
}

function isEntityVisible(entity: CatalogEntity, grant: ReadGrant): boolean {
  if (!allowedEntity(grant, entity.id) || !allowedIdentity(grant, entity)) return false;
  return entity.rowGrain.every((field) => allowedField(grant, entity.id, field));
}

function isRelationshipVisible(
  relationship: Catalog['relationships'][number],
  pageEntityIds: ReadonlySet<string>,
  grant: ReadGrant,
): boolean {
  if (!pageEntityIds.has(relationship.sourceEntity) || !pageEntityIds.has(relationship.targetEntity)) return false;
  return relationship.keys.every(
    (key) =>
      allowedField(grant, relationship.sourceEntity, key.sourceField) &&
      allowedField(grant, relationship.targetEntity, key.targetField),
  );
}

function isCapabilityVisible(
  capability: Catalog['capabilities'][number],
  pageEntityIds: ReadonlySet<string>,
  relationshipRefs: ReadonlySet<string>,
  grant: ReadGrant,
): boolean {
  if (!pageEntityIds.has(capability.entity)) return false;
  if (!capability.fields.every((field) => allowedField(grant, capability.entity, field))) return false;
  return capability.relations.every((relation) => relationshipRefs.has(`${relation.id}@${relation.revision}`));
}

function visibleEntityFields(entity: CatalogEntity, grant: ReadGrant): CatalogEntity {
  if (grant.fields === undefined) return entity;
  return {
    ...entity,
    fields: entity.fields.filter((field) => allowedField(grant, entity.id, field.id)),
  };
}
