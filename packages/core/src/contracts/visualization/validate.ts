import type { Outcome } from '../types.js';
import { authorizeVisualizationContext } from './authorized-context.js';
import type { BoundVisualization, VisualizationBindingContext } from './binding-types.js';
import { bindPlotVisualization } from './plot-family.js';
import { bindResultVisualization } from './result-family.js';
import { parseVisualizationSpec } from './parse.js';

export type {
  BoundVisualization,
  VisualizationBindingContext,
  VisualizationHistogramBinding,
  VisualizationRelationshipBinding,
} from './binding-types.js';

/** Bind family meaning to authorized descriptors. This neither reads rows nor grants effects.
 * Row-level ordering, bins, hierarchy cycles and edge cardinality are checked by
 * the bounded geometry materializer before any marks or interactions are exposed.
 */
export function bindVisualizationSpec(
  input: unknown,
  context: VisualizationBindingContext,
): Outcome<BoundVisualization> {
  const parsed = parseVisualizationSpec(input);
  if (!parsed.ok) return parsed;

  const authorized = authorizeVisualizationContext(context);
  if (!authorized.ok) return authorized;

  if ('plot' in parsed.value)
    return bindPlotVisualization(parsed.value, authorized.value.results, context, authorized.value.catalog);
  return bindResultVisualization(parsed.value, authorized.value.results, context, authorized.value.catalog);
}
