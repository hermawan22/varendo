import type { ToolModelLoopOptions, ToolModelLoopOutcome } from './types.js';
import { abort, createLoopState, finish, remainingRequired } from './loop-state.js';
import { fail, validLoopOptions } from './loop-validation.js';
import { runModelTurn } from './loop-turn.js';

/** A bounded I/O loop around the existing dispatcher, with no provider-specific semantics. */
export async function runToolModel(options: ToolModelLoopOptions): Promise<ToolModelLoopOutcome> {
  if (!validLoopOptions(options)) {
    return fail(
      'agent.model.invalid',
      'The model loop requires bounded input, a BYOK endpoint, and an application-owned model port.',
    );
  }
  const state = createLoopState(options);
  try {
    for (let turn = 0; turn < state.budget.maxTurns; turn++) {
      const decision = await runModelTurn(state);
      if (decision !== undefined) return finish(state, decision.stop, decision.textDraft);
    }
    const stop = remainingRequired(state).length === 0 ? 'budget' : 'required-sequence';
    return finish(state, stop);
  } catch {
    return finish(state, 'failed');
  } finally {
    abort(state);
  }
}
