import type { QuerySpec } from '@varendo/core';

type Period = NonNullable<QuerySpec['period']>;

/** Project this fixture's fixed Jakarta midnight instants onto its civil-day field. */
export function attendanceDayFilter(period: Period, asOfExclusiveDay: string) {
  const midnight = /^(\d{4}-\d{2}-\d{2})T00:00:00\+07:00$/u;
  const from = midnight.exec(period.from)?.[1];
  const to = midnight.exec(period.toExclusive)?.[1];
  if (
    period.calendar !== 'gregorian' ||
    period.timezone !== 'Asia/Jakarta' ||
    from === undefined ||
    to === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(asOfExclusiveDay) ||
    from >= to ||
    asOfExclusiveDay <= from
  )
    throw new Error('The attendance fixture requires a supported Jakarta civil-day period and as-of day.');
  const upper = asOfExclusiveDay < to ? asOfExclusiveDay : to;
  return {
    op: 'and' as const,
    predicates: [
      { op: 'compare' as const, field: 'day', comparison: 'gte' as const, value: from },
      { op: 'compare' as const, field: 'day', comparison: 'lt' as const, value: upper },
    ],
  };
}
