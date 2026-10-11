import { describe, expect, it } from 'vitest';
import { resolveExperienceConstraints } from '../../packages/core/src/contracts/experience/index.js';
import { validateTaskStructure } from '../../packages/core/src/contracts/task/index.js';
import type { Outcome, Task } from '../../packages/core/src/contracts/types.js';
import { preparePresentationContext } from '../../packages/core/src/presentation/index.js';
import type { PresentationContext } from '../../packages/core/src/presentation/index.js';
import {
  environment,
  experience,
  formTask,
  presentationPlan,
  presentationTask,
  ref,
  result,
  task,
} from './fixtures.js';

function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.diagnostics));
  return outcome.value;
}

function context(input: Task = presentationTask): PresentationContext {
  return {
    task: input,
    experience,
    environment,
    current: presentationPlan.preconditions,
    rendererCapabilities: [{ id: 'data.table', revision: '1' }],
    results: [result],
  };
}

describe('owned presentation task structure', () => {
  it.each([task, presentationTask, formTask])(
    'shares one validated immutable $kind task within each context',
    (input) => {
      const prepared = unwrap(preparePresentationContext(context(input)));
      expect(prepared.taskStructure).toEqual(unwrap(validateTaskStructure(input)));
      expect(prepared.taskStructure.task).toBe(prepared.task);
      expect(prepared.constraints.task).toBe(prepared.task);
      expect(prepared.patternContext.task).toBe(prepared.task);
      expect(prepared.task).not.toBe(input);
      expect(Object.isFrozen(prepared.task)).toBe(true);
      expect(Object.isFrozen(prepared.task.needs)).toBe(true);
      expect(Object.isFrozen(prepared.taskStructure.resultReferences)).toBe(true);
      expect(Object.isFrozen(input)).toBe(false);
      const next = unwrap(preparePresentationContext(context(input)));
      expect(next.task).not.toBe(prepared.task);
      expect(next.taskStructure).not.toBe(prepared.taskStructure);
    },
  );

  it('keeps source lineage and topological output order from the validated task', () => {
    const nextRef = { ...ref, sourceLineage: 'next-source' };
    const input = {
      ...task,
      outputs: [
        { ...task.outputs[0], id: 'second', dependsOn: ['first'] },
        { id: 'first', kind: 'reuse', result: nextRef, dependsOn: [] },
      ],
    } as const;
    const prepared = unwrap(preparePresentationContext(context(input)));
    expect(prepared.taskStructure.outputOrder).toEqual(['first', 'second']);
    expect(prepared.taskStructure.resultReferences).toEqual([nextRef]);
    expect(prepared.taskStructure).toEqual(unwrap(validateTaskStructure(input)));
  });

  it('does not expose the owned task to restriction inspection or retain caller mutations', () => {
    const input = { ...presentationTask, goal: 'Original goal' };
    const restrictions = new Proxy([{ id: 'host' }], {
      ownKeys(target) {
        input.goal = 'Changed during restriction inspection';
        return Reflect.ownKeys(target);
      },
    });
    const prepared = unwrap(preparePresentationContext({ ...context(input), restrictions }));
    expect(input.goal).toBe('Changed during restriction inspection');
    expect(prepared.task.goal).toBe('Original goal');
    expect(prepared.taskStructure.task.goal).toBe('Original goal');
    expect(unwrap(preparePresentationContext(context(input))).task.goal).toBe(input.goal);
  });

  it('preserves the public constraints shape and fresh results', () => {
    const first = unwrap(resolveExperienceConstraints(experience, presentationTask));
    expect(Object.keys(first).sort()).toEqual([
      'agentAllowed',
      'allowWithoutPreset',
      'allowedOperations',
      'allowedPatterns',
      'allowedRepresentations',
      'appliedRestrictions',
      'compositionChangeAllowed',
      'experience',
      'extensionAllowlist',
      'maxExpansions',
      'maxNodes',
      'mode',
      'preferredRepresentation',
      'representationReplacementAllowed',
      'requiredOperationIds',
      'task',
      'taskNeeds',
      'transitionPolicy',
      'unavailableOptionalNeeds',
    ]);
    const next = unwrap(resolveExperienceConstraints(experience, presentationTask));
    expect(next).toEqual(first);
    expect(next).not.toBe(first);
    expect(next.task).not.toBe(first.task);
    expect(next.taskNeeds).toBe(next.task.needs);
  });

  it('keeps experience, task, then restriction failure precedence', () => {
    const invalidTask = { ...presentationTask, needs: [{ id: 'missing' }] };
    const restrictions = [{ id: 'host', maxNodes: 0 }];
    expect(resolveExperienceConstraints({}, invalidTask, restrictions)).toEqual(
      resolveExperienceConstraints({}, presentationTask),
    );
    expect(resolveExperienceConstraints(experience, invalidTask, restrictions)).toEqual(
      validateTaskStructure(invalidTask),
    );
    const bad = { ...context(), task: invalidTask } as unknown as PresentationContext;
    expect(preparePresentationContext({ ...bad, restrictions })).toEqual(validateTaskStructure(invalidTask));
    expect(resolveExperienceConstraints(experience, presentationTask, restrictions)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'experience.restriction-shape' }],
    });
  });

  it('rejects task accessors without invoking them before inspecting restrictions', () => {
    let reads = 0;
    let restrictionReads = 0;
    const input = {
      ...presentationTask,
      get goal() {
        reads += 1;
        return 'Unsafe';
      },
    };
    const restrictions = new Proxy([], {
      ownKeys(target) {
        restrictionReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const outcome = preparePresentationContext({ ...context(input), restrictions });
    expect(outcome).toMatchObject({ ok: false, diagnostics: [{ code: 'wire.accessor' }] });
    expect(reads).toBe(0);
    expect(restrictionReads).toBe(0);
  });
});
