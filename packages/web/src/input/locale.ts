export interface AeliqoLocalizedDecimal {
  readonly canonical: string | undefined;
  readonly valid: boolean;
}

/** Keep parsing/formatting work bounded even when values come from a host. */
const MAX_LOCALIZED_DECIMAL_LENGTH = 4096;

interface LocaleSymbols {
  readonly group: string | undefined;
  readonly decimal: string;
  readonly minus: string;
  readonly literals: ReadonlySet<string>;
  readonly digits: ReadonlyMap<string, string>;
}

interface GroupingPattern {
  readonly group: string | undefined;
  readonly rightSize: number;
  readonly repeatingSize: number;
  readonly firstMaximum: number;
}

interface DecimalParts {
  readonly sign: string;
  readonly integer: string;
  readonly fraction: string | undefined;
}

function numberFormat(locale: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale || 'en-US');
  } catch {
    return new Intl.NumberFormat('en-US');
  }
}

function digitMap(formatter: Intl.NumberFormat): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (let digit = 0; digit <= 9; digit += 1) {
    const part = formatter.formatToParts(digit).find((candidate) => candidate.type === 'integer');
    if (part !== undefined) map.set(part.value, String(digit));
  }
  return map;
}

function localeSymbols(formatter: Intl.NumberFormat): LocaleSymbols {
  const parts = formatter.formatToParts(-12345.6);
  return {
    group: parts.find((part) => part.type === 'group')?.value,
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    minus: parts.find((part) => part.type === 'minusSign')?.value ?? '-',
    literals: new Set(parts.filter((part) => part.type === 'literal').map((part) => part.value)),
    digits: digitMap(formatter),
  };
}

function normalizeCharacter(character: string, symbols: LocaleSymbols): string {
  const digit = symbols.digits.get(character);
  if (digit !== undefined) return digit;
  if (symbols.group !== undefined && character === symbols.group) return '|';
  if (character === symbols.decimal) return '.';
  if (character === symbols.minus || character === '−') return '-';
  if (character === '+') return '+';
  if (symbols.literals.has(character)) return '';
  return character;
}

function normalizeText(text: string, symbols: LocaleSymbols): string {
  let normalized = '';
  for (const character of text) normalized += normalizeCharacter(character, symbols);
  return normalized;
}

function canonicalDecimal(
  normalized: string,
  symbols: LocaleSymbols,
  formatter: Intl.NumberFormat,
): AeliqoLocalizedDecimal {
  const parts = decimalParts(normalized);
  if (parts === undefined) return { canonical: undefined, valid: false };
  if (!validFraction(parts.fraction)) return { canonical: undefined, valid: false };
  if (!validInteger(parts.integer, symbols.group, formatter)) return { canonical: undefined, valid: false };
  if (parts.integer.length === 0 && parts.fraction === undefined) return { canonical: undefined, valid: false };
  const canonicalInteger = (parts.integer.replaceAll('|', '') || '0').replace(/^0+(?=\d)/u, '');
  const decimalPart = parts.fraction === undefined ? '' : `.${parts.fraction}`;
  const signPart = parts.sign === '-' ? '-' : '';
  return { canonical: `${signPart}${canonicalInteger}${decimalPart}`, valid: true };
}

function decimalParts(normalized: string): DecimalParts | undefined {
  const sign = normalized.startsWith('-') || normalized.startsWith('+') ? normalized.slice(0, 1) : '';
  const unsigned = sign.length > 0 ? normalized.slice(1) : normalized;
  const parts = unsigned.split('.');
  if (parts.length > 2) return undefined;
  return { sign, integer: parts[0] ?? '', fraction: parts.length === 2 ? parts[1] : undefined };
}

function validFraction(fraction: string | undefined): boolean {
  return fraction === undefined || /^\d+$/u.test(fraction);
}

function validInteger(integer: string, group: string | undefined, formatter: Intl.NumberFormat): boolean {
  if (integer.includes('|')) return group !== undefined && validGrouping(integer, formatter);
  return integer.length === 0 || /^\d+$/u.test(integer);
}

/** Parse a locale-formatted decimal without converting through IEEE-754. */
export function parseLocalizedDecimal(text: string, locale = 'en-US'): AeliqoLocalizedDecimal {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { canonical: undefined, valid: true };
  if (trimmed.length > MAX_LOCALIZED_DECIMAL_LENGTH) return { canonical: undefined, valid: false };
  const formatter = numberFormat(locale);
  const symbols = localeSymbols(formatter);
  return canonicalDecimal(normalizeText(trimmed, symbols), symbols, formatter);
}

function groupingPattern(formatter: Intl.NumberFormat): GroupingPattern | undefined {
  const sample = formatter.formatToParts(1234567890123);
  const chunks = sample.filter((part) => part.type === 'integer').map((part) => part.value);
  if (chunks.length < 2) return undefined;
  const rightSize = chunks.at(-1)?.length ?? 0;
  const repeatingSize = chunks.at(-2)?.length ?? rightSize;
  const firstMaximum = Math.max(repeatingSize, chunks[0]?.length ?? repeatingSize);
  return { group: sample.find((part) => part.type === 'group')?.value, rightSize, repeatingSize, firstMaximum };
}

function groupInteger(integer: string, pattern: GroupingPattern): string {
  const separator = pattern.group;
  if (separator === undefined || integer.length <= pattern.rightSize) return integer;
  const chunks: string[] = [];
  let remaining = integer;
  let size = pattern.rightSize;
  while (remaining.length > size) {
    const split = remaining.length - size;
    chunks.unshift(remaining.slice(split));
    remaining = remaining.slice(0, split);
    size = pattern.repeatingSize;
  }
  if (remaining.length > 0) chunks.unshift(remaining);
  return chunks.join(separator);
}

export function formatLocalizedDecimal(canonical: string, locale = 'en-US'): string {
  if (canonical.length > MAX_LOCALIZED_DECIMAL_LENGTH) return canonical;
  const parsed = parseLocalizedDecimal(canonical, 'en-US');
  if (!parsed.valid || parsed.canonical === undefined) return canonical;
  const formatter = numberFormat(locale);
  return formatParsedDecimal(parsed.canonical, formatter);
}

function formatParsedDecimal(canonical: string, formatter: Intl.NumberFormat): string {
  const pattern = groupingPattern(formatter);
  const negative = canonical.startsWith('-');
  const unsigned = canonical.replace(/^[+-]/u, '');
  const [integer = '0', fraction] = unsigned.split('.');
  const localizedInteger = pattern === undefined ? integer : groupInteger(integer, pattern);
  const decimal = formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const minus = formatter.formatToParts(-1).find((part) => part.type === 'minusSign')?.value ?? '-';
  const sign = negative ? minus : '';
  const decimalPart = fraction === undefined ? '' : `${decimal}${fraction}`;
  return `${sign}${localizedInteger}${decimalPart}`;
}

function validGrouping(integerWithGroups: string, formatter: Intl.NumberFormat): boolean {
  const pattern = groupingPattern(formatter);
  if (pattern === undefined) return false;
  const groups = integerWithGroups.split('|');
  if (!validGroupSegments(groups)) return false;
  if (groups.at(-1)?.length !== pattern.rightSize) return false;
  if (!validMiddleGroups(groups, pattern.repeatingSize)) return false;
  const firstLength = groups[0]?.length ?? 0;
  return firstLength >= 1 && firstLength <= pattern.firstMaximum;
}

function validGroupSegments(groups: readonly string[]): boolean {
  return groups.length >= 2 && groups.every((chunk) => chunk.length > 0 && /^\d+$/u.test(chunk));
}

function validMiddleGroups(groups: readonly string[], size: number): boolean {
  for (let index = groups.length - 2; index > 0; index -= 1) {
    if (groups[index]?.length !== size) return false;
  }
  return true;
}

export function dateOnly(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const [yearText = '', monthText = '', dayText = ''] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return value;
}

export function compareDateOnly(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left < right ? -1 : 1;
}
