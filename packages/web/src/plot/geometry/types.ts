import type { Outcome, PlotUnit, Result, Scalar } from '@varendo/core';
import type { PlotScale, PlotTick } from '../scales.js';

export interface PlotRow {
  readonly [field: string]: Scalar;
}

export interface PlotDatum {
  readonly identity: string;
  readonly values: PlotRow;
}

export type PlotMark =
  | {
      readonly kind: 'point';
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly series: string;
      readonly identity: string;
      readonly color?: string;
    }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly series: string;
      readonly identity: string;
      readonly color?: string;
    }
  | {
      readonly kind: 'path';
      readonly path: string;
      readonly filled: boolean;
      readonly series: string;
      readonly identities: readonly string[];
      readonly color?: string;
    };

export interface PlotGeometry {
  readonly width: number;
  readonly height: number;
  readonly axisLeft?: number;
  readonly state: 'plot' | 'data-only';
  readonly reason?: string;
  readonly marks: readonly PlotMark[];
  readonly rows: readonly PlotDatum[];
  readonly axes?: { readonly x: PlotScale; readonly y: PlotScale; readonly xLabel: string; readonly yLabel: string };
  readonly colorField?: string;
  readonly colorTicks?: readonly PlotTick[];
  readonly series: readonly string[];
  readonly legend: readonly { readonly id: string; readonly label: string }[];
  readonly result: Result;
}

export interface PlotProjection {
  readonly identities?: readonly string[];
  readonly domains?: { readonly x: readonly Scalar[]; readonly y: readonly Scalar[] };
}

export interface PlotGeometryOptions {
  readonly width: number;
  readonly height: number;
  readonly maxRows: number;
  readonly maxMarks: number;
  /** Family-only geometry semantics. The ordinary plot surface leaves this unset. */
  readonly family?: 'area' | 'histogram' | 'heatmap' | 'trend' | 'bar' | 'scatter';
  readonly stack?: 'none' | 'zero';
}

type PlotField = Result['fields'][number];
export type PlotFields = ReadonlyMap<string, PlotField>;

export interface PlotSource {
  readonly unit: PlotUnit;
  readonly descriptor: Result;
  readonly data: readonly PlotDatum[];
  readonly displayed: readonly PlotDatum[];
  readonly fields: PlotFields;
  readonly options: PlotGeometryOptions;
}

export type GeometryCheck<T> =
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'data-only'; readonly reason: string }
  | { readonly kind: 'error'; readonly outcome: Outcome<never> };
