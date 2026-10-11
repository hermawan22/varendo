import type * as z from 'zod/mini';
import type { plotEncodingSchema, plotNodeSchema, plotSpecSchema } from '../schemas.js';
import type { Wire } from '../types.js';

type Shape = z.infer<typeof plotNodeSchema>;

/** Named recursive boundaries keep generated consumer declarations finite; all fields derive from the schema. */
export type PlotUnit = Wire<Extract<Shape, { kind: 'unit' }>>;
type Layer = Omit<Wire<Extract<Shape, { kind: 'layer' }>>, 'children'>;
type Facet = Omit<Wire<Extract<Shape, { kind: 'facet' }>>, 'child'>;
type Concat = Omit<Wire<Extract<Shape, { kind: 'concat' }>>, 'children'>;

export type PlotNode =
  | PlotUnit
  | (Layer & { readonly children: readonly [PlotNode, ...PlotNode[]] })
  | (Facet & { readonly child: PlotNode })
  | (Concat & { readonly children: readonly [PlotNode, ...PlotNode[]] });

/** Declarative plotting contains no execution authority or arbitrary rendering code. */
export type PlotSpec = Omit<Wire<z.infer<typeof plotSpecSchema>>, 'root'> & { readonly root: PlotNode };
export type PlotEncoding = Wire<z.infer<typeof plotEncodingSchema>>;
