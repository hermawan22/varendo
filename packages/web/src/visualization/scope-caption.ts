import type { Result } from '@varendo/core';

function rows(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`;
}

/** One plain-language line about what a chart shows; only incomplete coverage explains itself. */
export function resultCaption(result: Result, count: number): string {
  switch (result.coverage.kind) {
    case 'complete':
      return rows(count);
    case 'sample':
      return `Sample (${result.coverage.method}): ${rows(count)} shown`;
    case 'partial':
      return `Partial result (${result.coverage.reason}): ${rows(count)} shown`;
    case 'unknown':
      return `Coverage unknown (${result.coverage.reason}): ${rows(count)} shown`;
  }
}
