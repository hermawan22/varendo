import { catalogSchema, expressionSchema, intentSchema, querySchema, taskSchema } from './schemas-base.js';
import {
  environmentSchema,
  experienceSchema,
  interactionSchema,
  presentationPlanSchema,
  resultEventSchema,
  resultSchema,
} from './schemas-outcomes.js';
import { parseSchema } from './parse-schema.js';
import type { Contract, Outcome } from './types.js';

export { canonicalJSON } from './parse-schema.js';

export const parseCatalog = (input: unknown): Outcome<Contract<'catalog'>> =>
  parseSchema(true, input, catalogSchema) as Outcome<Contract<'catalog'>>;
export const parseTask = (input: unknown): Outcome<Contract<'task'>> =>
  parseSchema(true, input, taskSchema) as Outcome<Contract<'task'>>;
export const parseResult = (input: unknown): Outcome<Contract<'result'>> =>
  parseSchema(true, input, resultSchema) as Outcome<Contract<'result'>>;
export const parseExperience = (input: unknown): Outcome<Contract<'experience'>> =>
  parseSchema(true, input, experienceSchema) as Outcome<Contract<'experience'>>;
export const parseIntent = (input: unknown): Outcome<Contract<'intent'>> =>
  parseSchema(false, input, intentSchema) as Outcome<Contract<'intent'>>;
export const parseInteraction = (input: unknown): Outcome<Contract<'interaction'>> =>
  parseSchema(false, input, interactionSchema) as Outcome<Contract<'interaction'>>;
export const parseExpression = (input: unknown): Outcome<Contract<'expression'>> =>
  parseSchema(false, input, expressionSchema) as Outcome<Contract<'expression'>>;
export const parseQuery = (input: unknown): Outcome<Contract<'query'>> =>
  parseSchema(false, input, querySchema) as Outcome<Contract<'query'>>;
export const parseResultEvent = (input: unknown): Outcome<Contract<'result-event'>> =>
  parseSchema(false, input, resultEventSchema) as Outcome<Contract<'result-event'>>;
export const parseEnvironment = (input: unknown): Outcome<Contract<'environment'>> =>
  parseSchema(false, input, environmentSchema) as Outcome<Contract<'environment'>>;
export const parsePresentationPlan = (input: unknown): Outcome<Contract<'presentation-plan'>> =>
  parseSchema(false, input, presentationPlanSchema) as Outcome<Contract<'presentation-plan'>>;
