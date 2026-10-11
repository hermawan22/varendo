import type { Experience, PresentationPlan, Result, VersionRef } from '@varendo/core';
import {
  createPresentationRegistry,
  resolvePresentation,
  type PresentationEnvironment,
  type PresentationManifest,
  type PresentationResolverInput,
} from '@varendo/core/presentation';
import type { SurfacePresentationEvidence } from '@varendo/runtime/surfaces';

export type LocalBrowseView = 'table' | 'cards';
export type ContainerSize = { readonly inline: number; readonly block: number };

const tableRef = { id: 'data.table', revision: '1' } as const;
const cardsRef = { id: 'data.card-collection', revision: '1' } as const;
const readRef = { id: 'data.read', revision: '1' } as const;

function manifest(ref: VersionRef, view: LocalBrowseView): PresentationManifest {
  return {
    ref,
    configSchema: { id: `${ref.id}.config`, revision: '1' },
    roles: ['browse'],
    operations: [readRef],
    result: 'required',
    children: { min: 0, max: 0 },
    visibility: 'leaf',
    extension: false,
    resolveConfig: (values, descriptor) =>
      descriptor === undefined
        ? { ok: false, diagnostics: [{ code: 'config.result', message: 'A result is required.', retryable: false }] }
        : { ok: true, value: { values, fields: descriptor.fields.map((field) => field.id), ports: [] } },
    assess: (_config, _result, environment) => {
      const narrow = environment.inlineSize.state === 'known' && environment.inlineSize.value < 560;
      return {
        ok: true,
        value: {
          taskFit: (view === 'cards') === narrow ? 90 : 70,
          informationDensity: 0,
          interactionEffort: 0,
          legibilityPenalty: 0,
        },
      };
    },
  };
}

const registered = createPresentationRegistry([manifest(tableRef, 'table'), manifest(cardsRef, 'cards')]);
if (!registered.ok) throw new Error(registered.diagnostics[0].message);
const registry = registered.value;

function environment(size: ContainerSize | undefined): PresentationEnvironment {
  const browser = typeof document !== 'undefined';
  const locale = browser
    ? document.documentElement.lang || (typeof navigator === 'undefined' ? '' : navigator.language) || 'en-US'
    : 'en-US';
  const direction =
    browser && typeof getComputedStyle === 'function' && getComputedStyle(document.documentElement).direction === 'rtl'
      ? 'rtl'
      : 'ltr';
  const media = (query: string) => browser && typeof matchMedia === 'function' && matchMedia(query).matches;
  return {
    inlineSize: size === undefined ? { state: 'unknown' } : { state: 'known', value: size.inline },
    blockSize: size === undefined ? { state: 'unknown' } : { state: 'known', value: size.block },
    textScale: { state: 'unknown' },
    pointer: 'unknown',
    hover: 'unknown',
    keyboard: 'unknown',
    locale,
    direction,
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    forcedColors: media('(forced-colors: active)'),
  };
}

function experience(evidence: SurfacePresentationEvidence): Experience {
  return {
    version: '1',
    id: 'react-local-browse',
    revision: evidence.current.experienceRevision,
    mode: 'adaptive',
    agentAllowed: false,
    allowedRepresentations: [tableRef.id, cardsRef.id],
    allowedPatterns: [],
    composition: { allowWithoutPreset: true, maxNodes: 1, maxExpansions: 8 },
    requiredOperations: [],
    tokenProfile: { id: 'tokens.default', revision: '1' },
    extensionAllowlist: [],
    transitionPolicy: 'stable',
  };
}

function candidate(
  ref: VersionRef,
  result: Result,
  evidence: SurfacePresentationEvidence,
): PresentationResolverInput['candidates'][number] {
  const nodeId = `${ref.id}-root`;
  const plan: PresentationPlan = {
    id: `${ref.id}-plan`,
    revision: evidence.task.revision,
    rootId: nodeId,
    preconditions: evidence.current,
    nodes: [
      {
        id: nodeId,
        role: 'browse',
        representation: ref,
        result: result.ref,
        config: { schema: { id: `${ref.id}.config`, revision: '1' }, values: {} },
        children: [],
      },
    ],
    links: [],
    coverage: evidence.task.needs.map((need) => ({
      needId: need.id,
      nodeIds: [nodeId],
      operations: [need.operation],
    })),
    stateTransfer: [],
    diagnostics: [],
  };
  return { id: ref.id, source: 'explicit', plan };
}

function browseResult(evidence: SurfacePresentationEvidence): Result | undefined {
  if (evidence.task.kind !== 'data' || evidence.task.needs.length !== 1 || evidence.results.length !== 1)
    return undefined;
  const operation = evidence.task.needs[0]?.operation;
  if (operation?.id !== readRef.id || operation.revision !== readRef.revision) return undefined;
  return evidence.results[0];
}

/** Selects only from the committed Task/Result; no row data becomes evidence. */
export function resolveLocalBrowse(
  evidence: SurfacePresentationEvidence,
  size: ContainerSize | undefined,
): LocalBrowseView | undefined {
  const result = browseResult(evidence);
  if (result === undefined) return undefined;
  const decision = resolvePresentation({
    id: 'react-local-browse',
    revision: evidence.task.revision,
    preconditions: evidence.current,
    context: {
      task: evidence.task,
      experience: experience(evidence),
      results: evidence.results,
      current: evidence.current,
      environment: environment(size),
      rendererCapabilities: [tableRef, cardsRef],
    },
    registry,
    target: evidence.target,
    candidates: [candidate(tableRef, result, evidence), candidate(cardsRef, result, evidence)],
  });
  if (decision.status !== 'ready') return undefined;
  const root = decision.plan.plan.nodes.find((node) => node.id === decision.plan.plan.rootId);
  if (root?.representation.id === tableRef.id) return 'table';
  if (root?.representation.id === cardsRef.id) return 'cards';
  return undefined;
}
