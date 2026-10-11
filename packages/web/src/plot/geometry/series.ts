import { scalarIdentity } from '@varendo/core';
import type { Outcome } from '@varendo/core';
import { exactLabel } from '../scales.js';
import { fail } from './shared.js';
import type { PlotDatum, PlotFields, PlotSource } from './types.js';

export interface PlotSeries {
  readonly groups: ReadonlyMap<string, readonly PlotDatum[]>;
  readonly legend: ReadonlyMap<string, string>;
  readonly reason?: string;
}

function seriesEncodings(unit: PlotSource['unit']): NonNullable<PlotSource['unit']['encoding']['series']>[] {
  const { series, color } = unit.encoding;
  if (color?.scale !== 'ordinal') return series ? [series] : [];
  return series ? [series, color] : [color];
}

function seriesIdentity(
  datum: PlotDatum,
  fields: PlotFields,
  encodings: ReturnType<typeof seriesEncodings>,
): Outcome<string> {
  const parts: string[] = [];
  for (const encoding of encodings) {
    const field = fields.get(encoding.field);
    if (field === undefined) return fail('series', 'A series field is missing from the authorized descriptor.');
    const identity = scalarIdentity(datum.values[encoding.field]!, field.type);
    if (!identity.ok) return identity;
    parts.push(identity.value);
  }
  return { ok: true, value: JSON.stringify(parts) };
}

/** One series encoding shows just its value; several keep their field labels so series stay distinguishable. */
function legendLabel(datum: PlotDatum, fields: PlotFields, encodings: ReturnType<typeof seriesEncodings>): string {
  if (encodings.length === 1) return exactLabel(datum.values[encodings[0]!.field]!);
  return encodings
    .map((encoding) => {
      const field = fields.get(encoding.field)!;
      return `${field.label}: ${exactLabel(datum.values[encoding.field]!)}`;
    })
    .join(', ');
}

export function groupSeries(source: PlotSource): Outcome<PlotSeries> {
  const groups = new Map<string, PlotDatum[]>();
  const legend = new Map<string, string>();
  const encodings = seriesEncodings(source.unit);
  for (const datum of source.displayed) {
    const identity = seriesIdentity(datum, source.fields, encodings);
    if (!identity.ok) return identity;
    legend.set(identity.value, legendLabel(datum, source.fields, encodings));
    const group = groups.get(identity.value) ?? [];
    group.push(datum);
    groups.set(identity.value, group);
  }
  if (groups.size > 12)
    return {
      ok: true,
      value: { groups: new Map(), legend, reason: 'The plot exceeds 12 distinguishable series; use the data view.' },
    };
  return { ok: true, value: { groups, legend } };
}

export function seriesFailure(series: PlotSeries): string | undefined {
  return series.reason;
}
