import type { Catalog, Experience, Expression, QuerySpec, Result, Task } from '../../packages/core/src/index.js';

import { catalog, experience, expression, query, result, task } from './fixtures.js';

// Public declarations are generated from the same canonical schema as runtime
// ingress.  These assignments are intentionally invalid and must remain useful
// compiler errors for package consumers.

// @ts-expect-error contract versions are fixed and cannot be widened by callers
const badCatalogVersion: Catalog = { ...catalog, version: '2' };

// @ts-expect-error a data task cannot have an empty named-output list
const badTaskOutputs: Task = { ...task, outputs: [] };

// @ts-expect-error a result must carry the production wire version
const badResultVersion: Result = { ...result, version: '2' };

// @ts-expect-error experience mode is a closed, versioned vocabulary
const badExperienceMode: Experience = { ...experience, mode: 'fluid' };

const badExpressionFunction: Expression = {
  kind: 'call',
  // @ts-expect-error executable functions are version-bound references
  function: 'sum',
  arguments: [],
};

const badPopulation: QuerySpec = {
  ...query,
  // @ts-expect-error query population cannot invent an unregistered kind
  population: { kind: 'all-visible' },
};

const forgedActor: Task = {
  ...task,
  // @ts-expect-error arbitrary actor authority is not part of a Task contract
  actor: { authority: 'approved' },
};

void badCatalogVersion;
void badTaskOutputs;
void badResultVersion;
void badExperienceMode;
void badExpressionFunction;
void badPopulation;
void forgedActor;
