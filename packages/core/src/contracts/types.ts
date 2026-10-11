import type { VisualizationSpec } from './visualization/index.js';
import type { PlotSpec } from './plot/index.js';
import type * as z from 'zod/mini';
import type {
  commitPreconditionsSchema,
  diagnosticSchema,
  expressionSchema,
  fieldSchema,
  interactionStateSchema,
  intentSchema,
  meaningSchema,
  querySchema,
  resultRefSchema,
  semanticTypeSchema,
  valueSchema,
  versionRefSchema,
} from './schemas.js';
import type { contractSchemas } from './schemas-registry.js';
/** JSON optional members may be absent; present `undefined` is not wire data. */
export type ReadonlyJsonValue =
  null | boolean | number | string | readonly ReadonlyJsonValue[] | { readonly [key: string]: ReadonlyJsonValue };
type WireMember<T> = T extends object ? { readonly [K in keyof T]: Wire<Exclude<T[K], undefined>> } : T;
/** Keep recursive JSON as a named recursive type; expanding its schema recursively exhausts consumer type checking. */
export type Wire<T> = [z.JSONType] extends [T]
  ? [T] extends [z.JSONType]
    ? ReadonlyJsonValue
    : WireMember<T>
  : WireMember<T>;
export type CommitPreconditions = Wire<z.infer<typeof commitPreconditionsSchema>>;
export type PresentationPlan = Contract<'presentation-plan'>;
export type Interaction = Contract<'interaction'>;
export type InteractionPayload = Interaction['payload'];
export type InteractionSelection = Extract<InteractionPayload, { readonly kind: 'selection' }>['selection'];
export type InteractionLink = PresentationPlan['links'][number];
export type InteractionState = Wire<z.infer<typeof interactionStateSchema>>;
export type RetainedInteractionPayload = InteractionState['values'][number]['payload'];
export type InteractionDraft = InteractionState['drafts'][number];
export type ContractKind = keyof typeof contractSchemas;
export type Contract<K extends ContractKind> = K extends 'plot-spec'
  ? PlotSpec
  : K extends 'visualization-spec'
    ? VisualizationSpec
    : Wire<z.infer<(typeof contractSchemas)[K]>>;
export type Catalog = Contract<'catalog'>;
export type Task = Contract<'task'>;
export type Result = Contract<'result'>;
export type Experience = Contract<'experience'>;
export type Diagnostic = Wire<z.infer<typeof diagnosticSchema>>;
export type Expression = Wire<z.infer<typeof expressionSchema>>;
export type FieldDefinition = Wire<z.infer<typeof fieldSchema>>;
export type MeaningDefinition = Wire<z.infer<typeof meaningSchema>>;
export type QuerySpec = Wire<z.infer<typeof querySchema>>;
export type Intent = Wire<z.infer<typeof intentSchema>>;
export type ResultRef = Wire<z.infer<typeof resultRefSchema>>;
export type SemanticType = Wire<z.infer<typeof semanticTypeSchema>>;
export type Scalar = Wire<z.infer<typeof valueSchema>>;
export type VersionRef = Wire<z.infer<typeof versionRefSchema>>;
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]] };
