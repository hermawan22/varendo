/** Named parts shared by the initial owned web elements. */
export const VARENDO_NAMED_PARTS = {
  input: ['field', 'label', 'input', 'description', 'error'],
  table: ['scroll', 'table'],
  chart: ['figure', 'summary', 'unit', 'scope', 'plot', 'line', 'point', 'error', 'data'],
} as const;

export type VarendoElementName = keyof typeof VARENDO_NAMED_PARTS;
export type VarendoNamedPart = (typeof VARENDO_NAMED_PARTS)[VarendoElementName][number];
