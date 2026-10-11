import type {
  Catalog,
  FieldDefinition,
  MeaningDefinition,
  Outcome,
  SemanticType,
  VersionRef,
} from '../contracts/types.js';
import type { FunctionRegistry } from '../expressions/types.js';

export type PrimitiveType = SemanticType['value'];
export type MeaningScope = MeaningDefinition['scope'];
export type MeaningOrigin = MeaningDefinition['origin'];
export type MeaningLifecycle = MeaningDefinition['lifecycle'];
export type MeaningAuthority = MeaningDefinition['authority'];
export type AggregationKind = MeaningDefinition['aggregation'];
export type ZeroDenominatorPolicy = 'null' | 'unknown' | 'error';
export type EvaluationContext = 'row' | 'group' | 'window' | 'aggregate-of-aggregates';

export type CatalogEntity = Catalog['entities'][number];
export type CatalogRelationship = Catalog['relationships'][number];

export interface FieldBinding {
  readonly entityId: string;
  readonly entity: CatalogEntity;
  readonly field: FieldDefinition;
  /** Field grain defaults to the containing entity row grain when omitted on wire. */
  readonly type: SemanticType;
}

export interface CatalogIndex {
  readonly catalog: Catalog;
  readonly entities: ReadonlyMap<string, CatalogEntity>;
  readonly fieldsByEntity: ReadonlyMap<string, ReadonlyMap<string, FieldBinding>>;
  readonly fieldsById: ReadonlyMap<string, readonly FieldBinding[]>;
  readonly meanings: ReadonlyMap<string, MeaningDefinition>;
  readonly capabilities: ReadonlyMap<string, Catalog['capabilities'][number]>;
  resolveField(entityId: string | undefined, fieldId: string): Outcome<FieldBinding>;
  resolveMeaning(ref: VersionRef): MeaningDefinition | undefined;
  resolveCapability(ref: VersionRef): Catalog['capabilities'][number] | undefined;
}

export interface SemanticPolicy {
  readonly allowedScopes?: readonly MeaningScope[];
  /** A label-quality check only; it never grants activation. */
  readonly minAuthorityForActive?: MeaningAuthority;
  readonly allowHostCapabilities?: boolean;
}

/** Host-owned immutable activation allowlist. Pure meaning validation does not consult it. */
export interface MeaningActivationPolicy {
  readonly policyRevision: string;
  /** Host-owned canonical definitions; a ref alone is not sufficient evidence. */
  readonly allowlistedDefinitions: readonly MeaningDefinition[];
  readonly allowlistedRefs?: readonly VersionRef[];
  readonly minAuthority?: MeaningAuthority;
}

/** Evidence that a trusted host policy authorized one exact immutable meaning ref. */
export interface MeaningActivationReceipt {
  readonly state: 'authorized';
  readonly meaning: VersionRef;
  readonly policyRevision: string;
}

export interface SemanticContext {
  readonly catalog: Catalog;
  readonly index: CatalogIndex;
  readonly registry: FunctionRegistry;
  readonly definitions: readonly MeaningDefinition[];
  readonly policy?: SemanticPolicy;
  readonly evaluationContext?: EvaluationContext;
  readonly entityId?: string;
}

export interface MeaningBundle {
  readonly catalogRevision: string;
  readonly functionRegistryDigest: string;
  readonly meanings: readonly MeaningDefinition[];
}

export interface MeaningBundleContext {
  readonly catalog: Catalog;
  readonly registry: FunctionRegistry;
  readonly definitions?: readonly MeaningDefinition[];
  readonly policy?: SemanticPolicy;
}
