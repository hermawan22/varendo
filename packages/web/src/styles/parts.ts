/** Named parts shared by the initial owned web elements. */
export const AELIQO_NAMED_PARTS = {
  input: ['field', 'label', 'input', 'description', 'error'],
  table: ['scroll', 'table'],
  chart: ['figure', 'summary', 'unit', 'scope', 'plot', 'line', 'point', 'error', 'data'],
} as const;

export type AeliqoElementName = keyof typeof AELIQO_NAMED_PARTS;
export type AeliqoNamedPart = (typeof AELIQO_NAMED_PARTS)[AeliqoElementName][number];
