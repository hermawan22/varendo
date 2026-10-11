import type { ExperienceConstraints } from '../../contracts/experience/index.js';
import type {
  CommitPreconditions,
  Experience,
  Outcome,
  Result,
  ResultRef,
  Task,
  VersionRef,
} from '../../contracts/types.js';
import type { TaskStructure } from '../../contracts/task/index.js';
import type { InteractionGraph } from '../../interaction/graph.js';
import type {
  PresentationEnvironment,
  PresentationPatternContext,
  PresentationPatternManifest,
  PresentationRegistry,
  ResolvedPresentationConfig,
  ResolvedPresentationNode,
  ValidatedPresentation,
} from '../types.js';

export type PresentationPlanLike = ValidatedPresentation['plan'];

/** Parsed and recursively owned values shared with trusted local callbacks. */
export interface PreparedPresentationContext {
  readonly constraints: ExperienceConstraints;
  readonly task: Task;
  readonly experience: Experience;
  readonly results: readonly Result[];
  readonly current: CommitPreconditions;
  readonly environment: PresentationEnvironment;
  readonly rendererCapabilities: readonly VersionRef[];
  readonly taskStructure: TaskStructure;
  readonly patternContext: PresentationPatternContext;
}

export interface PresentationValidationOptions {
  readonly requiredPattern?: PresentationPatternManifest;
}

export interface PresentationValidationCache {
  readonly preparedContext: PreparedPresentationContext;
  readonly registry: PresentationRegistry;
  readonly manifests: ReadonlyMap<string, PresentationRegistry['manifests'][number]>;
  readonly renderer: ReadonlySet<string>;
  readonly extensions: ReadonlySet<string>;
  readonly allowedRepresentations: ReadonlySet<string>;
  readonly allowedOperations: ReadonlySet<string> | undefined;
  readonly requiredOperations: ReadonlySet<string>;
  readonly resultFields: ReadonlyMap<Result, ReadonlySet<string>>;
  readonly resultsByRef: ReadonlyMap<string, Result>;
  readonly taskInputs: ReadonlySet<string>;
  readonly taskNeeds: ReadonlyMap<string, Task['needs'][number]>;
  readonly taskOutputs: ReadonlyMap<string, Extract<Task, { kind: 'data' }>['outputs'][number]>;
  readonly nodeGraphs: Map<string, Outcome<InteractionGraph>>;
  readonly presentationGraphs: Map<string, Outcome<InteractionGraph>>;
  readonly emptyGraphs: Map<PresentationTreeCacheEntry, EmptyPresentationGraphCacheEntry[]>;
  readonly coverageAnalyses: WeakMap<object, CoverageCacheEntry[]>;
  readonly readSetOutcomes: WeakMap<object, ReadSetCacheEntry[]>;
  readonly resolvedConfigs: WeakMap<object, ResolvedPresentationConfig>;
  readonly checkedConfigs: WeakMap<ResolvedPresentationConfig, ResolvedConfigCheck[]>;
  readonly treeEntries: PresentationTreeCacheEntry[];
}

type ResolvedConfigCheck = readonly [
  operations: readonly VersionRef[],
  resultFields: ReadonlySet<string> | undefined,
  enabled: readonly VersionRef[],
];

export interface PresentationCoverageAnalysis {
  readonly coverage: ReadonlyMap<string, PresentationPlanLike['coverage'][number]>;
  readonly operations: ReadonlySet<string>;
}

export interface CoverageCacheEntry {
  readonly nodes: readonly (ResolvedPresentationNode | undefined)[];
  readonly outcome: Outcome<PresentationCoverageAnalysis>;
}

interface ReadSetCacheEntry {
  readonly references: readonly ResultRef[];
  readonly outcome: Outcome<CommitPreconditions>;
}

export interface PresentationTreeCacheEntry {
  readonly rootId: string;
  readonly nodeIds: readonly string[];
  readonly nodeIndexes: ReadonlyMap<string, number>;
  readonly children: readonly (readonly string[])[];
  readonly childrenById: ReadonlyMap<string, readonly string[]>;
  readonly parents: ReadonlyMap<string, string>;
}

interface EmptyPresentationGraphCacheEntry {
  readonly ports: readonly object[];
  readonly graph: InteractionGraph;
}

export interface PresentationNodeResolutionInput {
  readonly plan: PresentationPlanLike;
  readonly prepared: PreparedPresentationContext;
  readonly registry: PresentationRegistry;
  readonly cache: PresentationValidationCache;
  readonly nodeMemo?: Map<string, ResolvedPresentationNode>;
  readonly nodeIdentityMemo?: WeakMap<object, ResolvedPresentationNode>;
}
