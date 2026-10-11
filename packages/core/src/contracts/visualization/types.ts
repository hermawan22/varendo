import type * as z from 'zod/mini';
import type { visualizationSpecSchema } from '../schemas.js';
import type { Wire } from '../types.js';
import type { PlotSpec } from '../plot/types.js';

type Shape = Wire<z.infer<typeof visualizationSpecSchema>>;
type WithPlot<T> = T extends { readonly plot: unknown } ? Omit<T, 'plot'> & { readonly plot: PlotSpec } : T;

/** Data references and family semantics only; captions come from trusted host/Result metadata. */
export type VisualizationSpec = WithPlot<Shape>;
