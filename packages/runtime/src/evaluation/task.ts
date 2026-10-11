import { TaskEvaluationSession } from './task-session.js';
import { failure } from './task-support.js';
import type { Outcome } from '@varendo/core';
import type { TaskEvaluation, TaskEvaluationInput, TaskEvaluatorOptions } from './types.js';

const DEFAULT_MAX_PENDING = 4;

export function createTaskEvaluator(options: TaskEvaluatorOptions): {
  evaluate(input: TaskEvaluationInput): Promise<Outcome<TaskEvaluation>>;
} {
  if (options.host === null || typeof options.host?.readContext !== 'function')
    throw new TypeError('A task evaluation host readContext callback is required.');
  let pending = 0;
  return {
    async evaluate(input) {
      if (pending >= DEFAULT_MAX_PENDING)
        return failure('runtime.evaluation-budget', 'The task evaluation queue is full.');
      pending += 1;
      const onFinished = (): void => {
        pending = Math.max(0, pending - 1);
      };
      const session = new TaskEvaluationSession(options, input, onFinished);
      return session.run();
    },
  };
}
