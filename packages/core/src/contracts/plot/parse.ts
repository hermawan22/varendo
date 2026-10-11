import { parseSchema } from '../parse-schema.js';
import { plotSpecSchema } from '../schemas-visualization.js';
import type { Contract, Outcome } from '../types.js';

export const parsePlotSpec = (input: unknown): Outcome<Contract<'plot-spec'>> =>
  parseSchema(false, input, plotSpecSchema) as Outcome<Contract<'plot-spec'>>;
