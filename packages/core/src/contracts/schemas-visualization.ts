import * as z from 'zod/mini';
import { nonEmpty, object, optional } from './schema-kit.js';
import { canonicalVersion as version } from './schema-primitives.js';
import { idSchema, resultRefSchema, versionRefSchema } from './schemas-base.js';

/** Plot shape only. Fields, scales, result scope and renderer support bind separately. */
export const plotEncodingSchema = object({
  field: idSchema,
  scale: z.enum(['ordinal', 'linear', 'log', 'temporal']),
  zero: optional(z.boolean()),
});
export const plotNodeSchema = z.discriminatedUnion('kind', [
  object({
    kind: z.literal('unit'),
    mark: z.enum(['point', 'line', 'bar', 'area', 'cell', 'link', 'rect']),
    result: resultRefSchema,
    encoding: object({
      x: plotEncodingSchema,
      y: plotEncodingSchema,
      x2: optional(plotEncodingSchema),
      y2: optional(plotEncodingSchema),
      color: optional(plotEncodingSchema),
      size: optional(plotEncodingSchema),
      series: optional(plotEncodingSchema),
    }),
    missing: z.literal('gap'),
  }),
  object({
    kind: z.literal('layer'),
    scales: z.enum(['shared-compatible', 'independent']),
    get children() {
      return nonEmpty(plotNodeSchema, 32);
    },
  }),
  object({
    kind: z.literal('facet'),
    field: idSchema,
    scales: z.enum(['shared-compatible', 'independent']),
    get child() {
      return plotNodeSchema;
    },
  }),
  object({
    kind: z.literal('concat'),
    direction: z.enum(['inline', 'block']),
    get children() {
      return nonEmpty(plotNodeSchema, 32);
    },
  }),
]);

/** Named schema boundary avoids repeatedly expanding the recursive plot shape. */
export type PlotSpecSchema = z.ZodMiniObject<{ version: typeof version; root: typeof plotNodeSchema }, z.core.$strict>;
export const plotSpecSchema: PlotSpecSchema = object({ version, root: plotNodeSchema });

/** Family semantics extend PlotSpec without adding DOM or arbitrary layout options. */
const visualizationBase = { version };
export const histogramBinsSchema = object({
  start: idSchema,
  end: idSchema,
  value: idSchema,
  measure: z.enum(['count', 'density']),
  boundary: z.literal('start-inclusive-end-exclusive'),
});
export const visualizationSpecSchema = z.discriminatedUnion('view', [
  object({ ...visualizationBase, view: z.literal('trend'), plot: plotSpecSchema }),
  object({ ...visualizationBase, view: z.literal('bar'), plot: plotSpecSchema }),
  object({ ...visualizationBase, view: z.literal('scatter'), plot: plotSpecSchema }),
  object({
    ...visualizationBase,
    view: z.literal('area'),
    plot: plotSpecSchema,
    meaning: versionRefSchema,
    stack: z.enum(['none', 'zero']),
  }),
  object({ ...visualizationBase, view: z.literal('histogram'), plot: plotSpecSchema, bins: histogramBinsSchema }),
  object({ ...visualizationBase, view: z.literal('heatmap'), plot: plotSpecSchema }),
  object({
    ...visualizationBase,
    view: z.literal('matrix'),
    result: resultRefSchema,
    columns: nonEmpty(idSchema, 128),
  }),
  object({
    ...visualizationBase,
    view: z.literal('tree'),
    result: resultRefSchema,
    node: nonEmpty(idSchema, 16),
    parent: nonEmpty(idSchema, 16),
    label: optional(idSchema),
  }),
  object({
    ...visualizationBase,
    view: z.literal('treemap'),
    result: resultRefSchema,
    node: nonEmpty(idSchema, 16),
    parent: nonEmpty(idSchema, 16),
    label: optional(idSchema),
    value: idSchema,
    meaning: versionRefSchema,
  }),
  object({
    ...visualizationBase,
    view: z.literal('relationship'),
    result: resultRefSchema,
    relationship: versionRefSchema,
    source: nonEmpty(idSchema, 16),
    target: nonEmpty(idSchema, 16),
    label: optional(idSchema),
  }),
  object({
    ...visualizationBase,
    view: z.literal('timeline'),
    result: resultRefSchema,
    start: idSchema,
    end: optional(idSchema),
    label: optional(idSchema),
  }),
  object({
    ...visualizationBase,
    view: z.literal('calendar-grid'),
    result: resultRefSchema,
    date: idSchema,
    value: optional(idSchema),
    label: optional(idSchema),
    weekStartsOn: optional(z.literal([0, 1, 2, 3, 4, 5, 6])),
  }),
]);
