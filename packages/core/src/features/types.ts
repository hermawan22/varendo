import type * as z from 'zod';
import type { Catalog, Diagnostic, Intent, MeaningDefinition, Outcome, VersionRef } from '../contracts/types.js';
import type { ResourceDefinition, ResourceFieldMetadata, ResourcePresentationDefaults } from '../app/types.js';

export const DATA_FEATURE_VIEW_ALIASES = Object.freeze(['table', 'cards', 'list', 'detail', 'trend'] as const);

export type DataFeatureViewAlias = (typeof DATA_FEATURE_VIEW_ALIASES)[number];

export interface FeatureDefinition<I = unknown> {
  readonly kind: 'data' | 'feature';
  readonly id: string;
  readonly label: string;
  readonly definitionRevision: string;
  parseIntent(value: unknown): Outcome<I>;
}

export interface DataFeatureInput<Schema extends z.ZodObject> {
  readonly id: string;
  readonly schema: Schema;
  readonly identity: readonly [Extract<keyof z.output<Schema>, string>, ...Extract<keyof z.output<Schema>, string>[]];
  readonly label?: string;
  readonly revision?: string;
  readonly presentation?: ResourcePresentationDefaults;
  readonly fields?: Readonly<Record<string, ResourceFieldMetadata>>;
  readonly meanings?: readonly MeaningDefinition[];
}

export interface DataFeatureDefinition<Schema extends z.ZodObject = z.ZodObject> extends FeatureDefinition<Intent> {
  readonly kind: 'data';
  readonly schema: Schema;
  readonly identity: readonly [string, ...string[]];
  readonly presentation: ResourcePresentationDefaults;
  readonly resource: ResourceDefinition<Schema>;
  readonly catalog: Catalog;
  readonly entity: Catalog['entities'][number];
  readonly parseRecord: ResourceDefinition<Schema>['parseRecord'];
}

export type FeatureCapabilityKind = 'read' | 'status' | 'command' | 'cancel' | 'output';

export interface FeatureCapabilityDefinition<Schema extends z.ZodType = z.ZodType> {
  readonly ref: VersionRef;
  /** Declares the capability's effect semantics; schema shape alone never implies permission. */
  readonly kind: FeatureCapabilityKind;
  readonly schema: Schema;
}

export interface FeatureViewDefinition {
  readonly ref: VersionRef;
  readonly capabilities: readonly VersionRef[];
}

export interface FeatureIntentDefinition<Schema extends z.ZodType = z.ZodType> {
  readonly ref: VersionRef;
  readonly schema: Schema;
  readonly capabilities: readonly VersionRef[];
  readonly views?: readonly VersionRef[];
}

export type FeatureIntentValue<Definitions extends readonly FeatureIntentDefinition[]> = {
  readonly [Key in keyof Definitions]: Definitions[Key] extends FeatureIntentDefinition<infer Schema>
    ? { readonly intent: Definitions[Key]['ref']; readonly input: z.output<Schema> }
    : never;
}[number];

export interface NonDataFeatureInput<Definitions extends readonly FeatureIntentDefinition[]> {
  readonly id: string;
  readonly label?: string;
  readonly revision?: string;
  readonly capabilities: readonly [FeatureCapabilityDefinition, ...FeatureCapabilityDefinition[]];
  readonly intents: Definitions;
  readonly views?: readonly FeatureViewDefinition[];
}

export interface NonDataFeatureDefinition<
  Definitions extends readonly FeatureIntentDefinition[],
> extends FeatureDefinition<FeatureIntentValue<Definitions>> {
  readonly kind: 'feature';
  readonly capabilities: readonly FeatureCapabilityDefinition[];
  readonly intents: Definitions;
  readonly views: readonly FeatureViewDefinition[];
}

export class FeatureDefinitionError extends Error {
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];

  constructor(diagnostics: readonly [Diagnostic, ...Diagnostic[]]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join(' '));
    this.name = 'FeatureDefinitionError';
    this.diagnostics = diagnostics;
  }
}
