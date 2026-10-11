import type { ExperienceRestriction, ExperienceConstraints, TaskStructure } from '../../packages/core/src/index.js';
// @ts-expect-error no actor/grant field in a restriction
const actor: ExperienceRestriction = { id: 'x', actor: 'approved' };
// @ts-expect-error operation refs require pinned revisions
const revision: ExperienceRestriction = { id: 'x', allowedOperations: [{ id: 'compare' }] };
// @ts-expect-error arbitrary CSS is outside the restriction contract
const css: ExperienceRestriction = { id: 'x', css: 'color:red' };
declare const constraints: ExperienceConstraints;
// @ts-expect-error compiled constraints are readonly
constraints.allowedRepresentations.push('anything');
declare const structure: TaskStructure;
// @ts-expect-error shape/structure analysis grants no authorization
structure.authorized;
void [actor, revision, css];
