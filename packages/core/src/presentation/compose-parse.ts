import * as z from 'zod/mini';
import { parseInspectedSchema } from '../contracts/parse-schema.js';
import { inspectWire } from '../contracts/ingress.js';
import {
  commitPreconditionsSchema,
  diagnosticSchema,
  idSchema,
  interactionLinkSchema,
  presentationCoverageSchema,
  presentationNodeSchema,
  presentationPlanSchema,
  presentationStateTransferSchema,
  revisionSchema,
} from '../contracts/schemas.js';
import { WIRE_LIMITS } from '../contracts/limits.js';
import type { Outcome, PresentationPlan } from '../contracts/types.js';
import { freezePresentation, freezePresentationContainer, presentationFailure as fail } from './registry.js';

const inspectedPlanIdentitySchema = z.tuple([idSchema, revisionSchema, idSchema]);
const planKeys = new Set([
  'id',
  'revision',
  'rootId',
  'preconditions',
  'nodes',
  'links',
  'coverage',
  'stateTransfer',
  'diagnostics',
]);

export interface PresentationParseCache {
  readonly preconditions: WeakMap<object, z.infer<typeof commitPreconditionsSchema>>;
  readonly nodes: WeakMap<object, z.infer<typeof presentationNodeSchema>>;
  readonly links: WeakMap<object, z.infer<typeof interactionLinkSchema>>;
  readonly coverage: WeakMap<object, z.infer<typeof presentationCoverageSchema>>;
  readonly stateTransfer: WeakMap<object, z.infer<typeof presentationStateTransferSchema>>;
  readonly diagnostics: WeakMap<object, z.infer<typeof diagnosticSchema>>;
  readonly nodeChildren: WeakMap<object, string[]>;
  readonly nodeArrays: WeakMap<object, readonly z.infer<typeof presentationNodeSchema>[]>;
  readonly linkArrays: WeakMap<object, readonly z.infer<typeof interactionLinkSchema>[]>;
  readonly coverageArrays: WeakMap<object, readonly z.infer<typeof presentationCoverageSchema>[]>;
  readonly stateTransferArrays: WeakMap<object, readonly z.infer<typeof presentationStateTransferSchema>[]>;
  readonly diagnosticArrays: WeakMap<object, readonly z.infer<typeof diagnosticSchema>[]>;
}

export function createPresentationParseCache(): PresentationParseCache {
  return {
    preconditions: new WeakMap(),
    nodes: new WeakMap(),
    links: new WeakMap(),
    coverage: new WeakMap(),
    stateTransfer: new WeakMap(),
    diagnostics: new WeakMap(),
    nodeChildren: new WeakMap(),
    nodeArrays: new WeakMap(),
    linkArrays: new WeakMap(),
    coverageArrays: new WeakMap(),
    stateTransferArrays: new WeakMap(),
    diagnosticArrays: new WeakMap(),
  };
}

function parseCachedObject<S extends z.ZodMiniType>(
  input: unknown,
  schema: S,
  cache: WeakMap<object, z.infer<S>>,
): z.infer<S> | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const cached = cache.get(input);
  if (cached !== undefined) return cached;
  const parsed = z.safeParse(schema, input);
  if (!parsed.success) return undefined;
  const value = freezePresentation(parsed.data);
  cache.set(input, value);
  return value;
}

function reusableChildren(rawChildren: unknown, cache: PresentationParseCache): string[] | undefined {
  if (!Array.isArray(rawChildren)) return undefined;
  const cached = cache.nodeChildren.get(rawChildren);
  if (cached === undefined || cached.length !== rawChildren.length) return undefined;
  return cached.every((child, index) => child === rawChildren[index]) ? cached : undefined;
}

function parseCachedNode(
  input: unknown,
  cache: PresentationParseCache,
): z.infer<typeof presentationNodeSchema> | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const cached = cache.nodes.get(input);
  if (cached !== undefined) return cached;
  const rawChildren = (input as { children?: unknown }).children;
  // Reuse only the exact child sequence from an already inspected wire plan.
  const reused = reusableChildren(rawChildren, cache);
  const candidate = reused === undefined ? input : { ...input, children: [] };
  const parsed = z.safeParse(presentationNodeSchema, candidate);
  if (!parsed.success) return undefined;
  const parsedNode = reused === undefined ? parsed.data : { ...parsed.data, children: reused };
  const value = freezePresentation(parsedNode);
  cache.nodes.set(input, value);
  if (reused === undefined && rawChildren !== null && typeof rawChildren === 'object')
    cache.nodeChildren.set(rawChildren, value.children);
  return value;
}

function parseCachedArray<S extends z.ZodMiniType>(
  input: unknown,
  schema: S,
  maximum: number,
  cache: WeakMap<object, z.infer<S>>,
  arrayCache: WeakMap<object, readonly z.infer<S>[]>,
): readonly z.infer<S>[] | undefined {
  if (!Array.isArray(input) || input.length > maximum) return undefined;
  const cached = arrayCache.get(input);
  if (cached !== undefined) return cached;
  const output: z.infer<S>[] = [];
  for (const item of input) {
    const parsed = parseCachedObject(item, schema, cache);
    if (parsed === undefined) return undefined;
    output.push(parsed);
  }
  const value = freezePresentationContainer(output) as readonly z.infer<S>[];
  arrayCache.set(input, value);
  return value;
}

function parseCachedNodes(
  input: unknown,
  cache: PresentationParseCache,
): readonly z.infer<typeof presentationNodeSchema>[] | undefined {
  if (!Array.isArray(input) || input.length > WIRE_LIMITS.presentationNodes) return undefined;
  const cached = cache.nodeArrays.get(input);
  if (cached !== undefined) return cached;
  const output: z.infer<typeof presentationNodeSchema>[] = [];
  for (const item of input) {
    const parsed = parseCachedNode(item, cache);
    if (parsed === undefined) return undefined;
    output.push(parsed);
  }
  const value = freezePresentationContainer(output) as readonly z.infer<typeof presentationNodeSchema>[];
  cache.nodeArrays.set(input, value);
  return value;
}

function expectedPlanKeys(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw);
  return keys.length === planKeys.size && keys.every((key) => planKeys.has(key));
}

function planArraysAreBounded(raw: Record<string, unknown>): boolean {
  return (
    boundedArray(raw.nodes, WIRE_LIMITS.presentationNodes) &&
    boundedArray(raw.links, WIRE_LIMITS.links) &&
    boundedArray(raw.coverage, WIRE_LIMITS.array) &&
    boundedArray(raw.stateTransfer, WIRE_LIMITS.array) &&
    boundedArray(raw.diagnostics, WIRE_LIMITS.diagnostics)
  );
}

function boundedArray(value: unknown, maximum: number): boolean {
  return Array.isArray(value) && value.length <= maximum;
}

function fallbackPlan(input: unknown): Outcome<PresentationPlan> {
  const fallback = parseInspectedSchema(false, input, presentationPlanSchema) as Outcome<PresentationPlan>;
  if (!fallback.ok) return fallback;
  return { ok: true, value: freezePresentation(fallback.value) };
}

function parsePlanParts(raw: Record<string, unknown>, cache: PresentationParseCache) {
  return {
    preconditions: parseCachedObject(raw.preconditions, commitPreconditionsSchema, cache.preconditions),
    nodes: parseCachedNodes(raw.nodes, cache),
    links: parseCachedArray(raw.links, interactionLinkSchema, WIRE_LIMITS.links, cache.links, cache.linkArrays),
    coverage: parseCachedArray(
      raw.coverage,
      presentationCoverageSchema,
      WIRE_LIMITS.array,
      cache.coverage,
      cache.coverageArrays,
    ),
    stateTransfer: parseCachedArray(
      raw.stateTransfer,
      presentationStateTransferSchema,
      WIRE_LIMITS.array,
      cache.stateTransfer,
      cache.stateTransferArrays,
    ),
    diagnostics: parseCachedArray(
      raw.diagnostics,
      diagnosticSchema,
      WIRE_LIMITS.diagnostics,
      cache.diagnostics,
      cache.diagnosticArrays,
    ),
  };
}

type ParsedPlanParts = ReturnType<typeof parsePlanParts>;
type CompletePlanParts = { readonly [Key in keyof ParsedPlanParts]-?: Exclude<ParsedPlanParts[Key], undefined> };

function isCompletePlanParts(parts: ParsedPlanParts): parts is CompletePlanParts {
  return (
    parts.preconditions !== undefined &&
    parts.nodes !== undefined &&
    parts.links !== undefined &&
    parts.coverage !== undefined &&
    parts.stateTransfer !== undefined &&
    parts.diagnostics !== undefined
  );
}

/** Parse a plan only after its enclosing candidate data passed inspectWire. */
function parseInspectedPresentationPlan(input: unknown, cache: PresentationParseCache): Outcome<PresentationPlan> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fallbackPlan(input);
  const raw = input as Record<string, unknown>;
  const identity = z.safeParse(inspectedPlanIdentitySchema, [raw.id, raw.revision, raw.rootId]);
  if (!expectedPlanKeys(raw) || !planArraysAreBounded(raw) || !identity.success) return fallbackPlan(input);
  const parts = parsePlanParts(raw, cache);
  if (!isCompletePlanParts(parts)) return fallbackPlan(input);
  return {
    ok: true,
    value: freezePresentationContainer({
      id: identity.data[0],
      revision: identity.data[1],
      rootId: identity.data[2],
      ...parts,
    }) as PresentationPlan,
  };
}

export function normalizePlan(
  input: unknown,
  id: string,
  revision: string,
  preconditions: unknown,
  alreadyInspected: boolean,
  cache: PresentationParseCache,
): Outcome<PresentationPlan> {
  const wire = alreadyInspected ? { ok: true as const, value: input } : inspectWire(input);
  if (!wire.ok) return wire;
  if (wire.value === null || typeof wire.value !== 'object' || Array.isArray(wire.value))
    return fail('candidate', 'A presentation candidate must be a plan object.');
  const normalized = { ...(wire.value as Record<string, unknown>), id, revision, preconditions };
  return parseInspectedPresentationPlan(normalized, cache);
}
