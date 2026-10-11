import type { Outcome, QuerySpec, ResultRef } from '@varendo/core';
import type { CohortMembership, CohortRequest, CohortResolverContext } from '../../evaluation/types.js';
import { lowerCohortQuery } from '../../evaluation/cohort.js';
import type { QueryBudget, ReadContext, ReadGrant } from '../types.js';
import type { LocalDataServiceState } from './service-state.js';
import { failure, policyContext, unsupported } from './shared.js';

export interface ResolvedPopulation {
  readonly query: QuerySpec;
  readonly membership?: CohortMembership;
  readonly lineage: readonly ResultRef[];
}

interface CohortSetup {
  readonly resolver: NonNullable<LocalDataServiceState['options']['cohortResolver']>;
  readonly resolverContext: CohortResolverContext;
  readonly request: CohortRequest;
}

export async function resolvePopulation(
  state: LocalDataServiceState,
  query: QuerySpec,
  grant: ReadGrant,
  context: ReadContext,
  budget: QueryBudget,
  startedAt: number,
): Promise<Outcome<ResolvedPopulation>> {
  if (query.population.kind === 'all-authorized') return { ok: true, value: { query, lineage: [] } };
  if (query.population.kind === 'live-output') return unsupportedLivePopulation();
  const setup = createCohortSetup(state, query, grant, context, budget, startedAt);
  if (!setup.ok) return setup;
  const resolved = await resolveMembership(setup.value);
  if (!resolved.ok) return resolved;
  if (resolved.value.tupleDigest !== query.population.cohortDigest)
    return failure(
      'data.stale-cohort',
      'The fixed population digest does not match the host-owned cohort membership.',
      ['query', 'population', 'cohortDigest'],
    );
  const lowered = lowerCohortQuery(query, resolved.value, state.currentCatalog);
  if (!lowered.ok) return lowered;
  return {
    ok: true,
    value: { query: lowered.value, membership: resolved.value, lineage: resolved.value.lineage },
  };
}

function unsupportedLivePopulation(): Outcome<ResolvedPopulation> {
  return unsupported(
    {
      kind: 'source',
      id: 'population',
      reason: 'Live named-output population binding belongs to the trusted task evaluator.',
      alternatives: ['Bind the live output to a complete fixed cohort before calling this data service service.'],
    },
    ['query', 'population'],
  );
}

function createCohortSetup(
  state: LocalDataServiceState,
  query: QuerySpec,
  grant: ReadGrant,
  context: ReadContext,
  budget: QueryBudget,
  startedAt: number,
): Outcome<CohortSetup> {
  const resolver = context.cohort?.resolver ?? state.options.cohortResolver;
  const contextFactory = state.options.cohortContext;
  if (resolver === undefined || (context.cohort === undefined && contextFactory === undefined))
    return unsupportedFixedPopulation();
  const remaining = budget.maxMilliseconds - (state.workNow() - startedAt);
  if (remaining <= 0)
    return failure('data.budget', 'Cohort resolution exceeded the effective time budget.', ['budget']);
  if (context.cohort === undefined && hasStructuredPrincipal(context.principal))
    return failure('data.authorization', 'A structured principal requires a host-owned cohort principal key.');
  const principalKey = cohortPrincipalKey(context);
  const handles = cohortHandles(state, context, grant, principalKey);
  if (!handles.ok) return handles;
  const catalog = state.currentCatalog;
  return {
    ok: true,
    value: {
      resolver,
      resolverContext: buildResolverContext(catalog, grant, context, principalKey, handles.value, state.now),
      request: buildCohortRequest(query, catalog, grant, context, remaining, state.now),
    },
  };
}

function unsupportedFixedPopulation<T>(): Outcome<T> {
  return unsupported(
    {
      kind: 'source',
      id: 'population',
      reason: 'A fixed population requires a host-owned complete cohort resolver and result handle context.',
      alternatives: ['Configure cohortResolver and cohortContext on the host service.'],
    },
    ['query', 'population'],
  );
}

function hasStructuredPrincipal(principal: unknown): boolean {
  return principal !== undefined && (typeof principal !== 'string' || principal.length === 0);
}

function cohortPrincipalKey(context: ReadContext): string {
  return (
    context.cohort?.principalKey ?? (typeof context.principal === 'string' ? context.principal : 'local-principal')
  );
}

function cohortHandles(
  state: LocalDataServiceState,
  context: ReadContext,
  grant: ReadGrant,
  principalKey: string,
): Outcome<Pick<CohortResolverContext, 'resultStore' | 'resolveResult'>> {
  if (context.cohort !== undefined) {
    return {
      ok: true,
      value: { resultStore: context.cohort.resultStore, resolveResult: context.cohort.resolveResult },
    };
  }
  const factory = state.options.cohortContext;
  if (factory === undefined) return unsupportedFixedPopulation();
  const catalog = state.currentCatalog;
  try {
    return {
      ok: true,
      value: factory({
        readContext: context,
        principalKey,
        scopeDigest: grant.scopeDigest,
        ...(grant.policyRevision === undefined ? {} : { policyRevision: grant.policyRevision }),
        catalogRevision: catalog.revision,
        functionRegistryDigest: catalog.functionRegistryDigest,
        catalog,
        now: state.now,
      }),
    };
  } catch {
    return failure('data.authorization', 'The host cohort context could not be initialized.');
  }
}

function buildResolverContext(
  catalog: LocalDataServiceState['currentCatalog'],
  grant: ReadGrant,
  context: ReadContext,
  principalKey: string,
  handles: Pick<CohortResolverContext, 'resultStore' | 'resolveResult'>,
  now: () => number,
): CohortResolverContext {
  return {
    readContext: policyContext(context),
    principalKey,
    scopeDigest: grant.scopeDigest,
    ...(grant.policyRevision === undefined ? {} : { policyRevision: grant.policyRevision }),
    catalogRevision: catalog.revision,
    functionRegistryDigest: catalog.functionRegistryDigest,
    catalog,
    grants: ['result.inspect'],
    ...handles,
    now,
  };
}

function buildCohortRequest(
  query: QuerySpec,
  catalog: LocalDataServiceState['currentCatalog'],
  grant: ReadGrant,
  context: ReadContext,
  remaining: number,
  now: () => number,
): CohortRequest {
  const population = query.population;
  if (population.kind !== 'fixed') throw new TypeError('A cohort request requires a fixed population.');
  const entity = catalog.entities.find((candidate) => candidate.id === query.entity);
  return {
    source: population.source,
    identityKeys: population.identityKeys,
    ...(entity === undefined ? {} : { targetGrain: entity.rowGrain }),
    scopeDigest: grant.scopeDigest,
    ...(grant.policyRevision === undefined ? {} : { policyRevision: grant.policyRevision }),
    catalogRevision: catalog.revision,
    sourceRevision: population.source.revision,
    deadlineAt: now() + remaining,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  };
}

async function resolveMembership(setup: CohortSetup): Promise<Outcome<CohortMembership>> {
  try {
    return await setup.resolver.resolve(setup.request, setup.resolverContext);
  } catch {
    return failure('data.authorization', 'The host cohort resolver failed.');
  }
}
