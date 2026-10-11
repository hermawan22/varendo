import * as agent from './schemas-agent.js';
import * as base from './schemas-base.js';
import * as outcomes from './schemas-outcomes.js';
import * as visualization from './schemas-visualization.js';

export const contractSchemas: Readonly<{
  'plot-spec': typeof visualization.plotSpecSchema;
  'visualization-spec': typeof visualization.visualizationSpecSchema;
  catalog: typeof base.catalogSchema;
  task: typeof base.taskSchema;
  result: typeof outcomes.resultSchema;
  experience: typeof outcomes.experienceSchema;
  expression: typeof base.expressionSchema;
  query: typeof base.querySchema;
  intent: typeof base.intentSchema;
  interaction: typeof outcomes.interactionSchema;
  'result-event': typeof outcomes.resultEventSchema;
  environment: typeof outcomes.environmentSchema;
  'presentation-plan': typeof outcomes.presentationPlanSchema;
  'task-proposal': typeof agent.taskProposalSchema;
  'meaning-draft': typeof agent.meaningDraftSchema;
  'binding-outcome': typeof agent.bindingOutcomeSchema;
  'operation-grant': typeof agent.operationGrantSchema;
  'agent-loop-budget': typeof agent.agentLoopBudgetSchema;
  'agent-stop-reason': typeof agent.agentStopReasonSchema;
  'narrative-claim': typeof agent.narrativeClaimSchema;
  'model-evaluation': typeof agent.modelEvaluationSchema;
}> = Object.freeze({
  'plot-spec': visualization.plotSpecSchema,
  'visualization-spec': visualization.visualizationSpecSchema,
  catalog: base.catalogSchema,
  task: base.taskSchema,
  result: outcomes.resultSchema,
  experience: outcomes.experienceSchema,
  expression: base.expressionSchema,
  query: base.querySchema,
  intent: base.intentSchema,
  interaction: outcomes.interactionSchema,
  'result-event': outcomes.resultEventSchema,
  environment: outcomes.environmentSchema,
  'presentation-plan': outcomes.presentationPlanSchema,
  'task-proposal': agent.taskProposalSchema,
  'meaning-draft': agent.meaningDraftSchema,
  'binding-outcome': agent.bindingOutcomeSchema,
  'operation-grant': agent.operationGrantSchema,
  'agent-loop-budget': agent.agentLoopBudgetSchema,
  'agent-stop-reason': agent.agentStopReasonSchema,
  'narrative-claim': agent.narrativeClaimSchema,
  'model-evaluation': agent.modelEvaluationSchema,
});
