import { parseSchema } from '../parse-schema.js';
import { visualizationSpecSchema } from '../schemas-visualization.js';
import type { Contract, Outcome } from '../types.js';

export const parseVisualizationSpec = (input: unknown): Outcome<Contract<'visualization-spec'>> =>
  parseSchema(false, input, visualizationSpecSchema) as Outcome<Contract<'visualization-spec'>>;
