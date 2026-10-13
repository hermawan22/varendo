import { html, type TemplateResult } from 'lit';
import type { Result } from '@varendo/core';
import type { ValidatedPresentation } from '@varendo/core/presentation';
import { dataStatusMessage, materializedDataStatus, scopeText } from '../data/shared.js';
import type { VarendoChartSeries, VarendoTableRow } from '../types.js';
import {
  decimalText,
  numericValue,
  record,
  temporalLabel,
  temporalTime,
  text,
  trendSummary,
} from './element-helpers.js';
import type { VarendoRegionResult } from './types.js';

type ResolvedNode = ValidatedPresentation['nodes'][number];

function localizedTrendSummary(
  bound: VarendoRegionResult | undefined,
  result: Result | undefined,
  locale: string | undefined,
): string {
  if (!/^id(?:-|$)/i.test(locale ?? '')) return trendSummary(bound, result);
  if (bound === undefined) return 'Data tidak tersedia.';
  if (result === undefined) return '';
  return dataStatusMessage(materializedDataStatus(result), undefined, locale) ?? '';
}

/** Names the chart after its measure, for example "New hires", unless the config sets a title. */
function trendTitle(values: Record<string, unknown>, locale: string | undefined): string {
  const measure = text(record((values.series as readonly unknown[] | undefined)?.[0])?.label);
  return text(values.title, measure || (/^id(?:-|$)/i.test(locale ?? '') ? 'Tren' : 'Trend'));
}

export function renderTrendNode(
  resolved: ResolvedNode,
  values: Record<string, unknown>,
  bound: VarendoRegionResult | undefined,
  locale: string | undefined,
): TemplateResult {
  const labelField = text(values.labelField);
  const seriesBy = Array.isArray(values.seriesBy)
    ? values.seriesBy.flatMap((value) => (typeof value === 'string' ? [value] : []))
    : [];
  const rawSeries = Array.isArray(values.series) ? values.series : [];
  const rows = bound?.rows ?? [];
  const series: VarendoChartSeries[] = rawSeries.flatMap((item) => {
    const candidate = record(item);
    if (candidate === undefined) return [];
    const field = text(candidate.field);
    if (field.length === 0) return [];
    const label = text(candidate.label, field);
    const unit = text(candidate.unit);
    const groups = new Map<
      string,
      {
        readonly values: readonly unknown[];
        readonly rows: { readonly row: VarendoTableRow; readonly index: number; readonly time: number }[];
      }
    >();
    rows.forEach((row, index) => {
      const values = seriesBy.map((groupField) => row[groupField]);
      const key = JSON.stringify(values);
      const group = groups.get(key);
      const time = temporalTime(row[labelField]);
      if (group === undefined) groups.set(key, { values, rows: [{ row, index, time: time ?? Number.NaN }] });
      else group.rows.push({ row, index, time: time ?? Number.NaN });
    });
    return [...groups.entries()].map(([groupKey, group]) => {
      const ordered = [...group.rows].sort((left, right) =>
        Number.isNaN(left.time) || Number.isNaN(right.time)
          ? left.index - right.index
          : left.time - right.time || left.index - right.index,
      );
      const suffix =
        group.values.length === 0
          ? ''
          : ` · ${group.values.map((value) => (value === null || value === undefined ? '—' : String(value))).join(' · ')}`;
      const points = ordered.map(({ row, time }) => {
        const sourceValue = row[field];
        const value = Number.isNaN(time) ? Number.NaN : numericValue(sourceValue);
        const displayValue = decimalText(sourceValue);
        const sourceTime = row[labelField];
        return {
          label: temporalLabel(row[labelField]),
          // Keep the source instant text so the chart can retain canonical
          // sub-millisecond identity; Date.parse is only used for ordering.
          ...(Number.isNaN(time) ? {} : { x: typeof sourceTime === 'string' ? sourceTime : time }),
          value,
          ...(displayValue === undefined ? {} : { displayValue }),
        };
      });
      return {
        id: `${field}:${groupKey}`,
        label: `${label}${suffix}`,
        ...(unit.length === 0 ? {} : { unit }),
        points,
      };
    });
  });
  return html`<varendo-chart
    data-varendo-node-id=${resolved.node.id}
    data-varendo-theme="inherit"
    lang=${locale ?? ''}
    .title=${trendTitle(values, locale)}
    .summary=${localizedTrendSummary(bound, resolved.result, locale)}
    .scope=${scopeText(bound?.scope, locale) ?? ''}
    .series=${series}
    .points=${series[0]?.points ?? []}
  ></varendo-chart>`;
}
