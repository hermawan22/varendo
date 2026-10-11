/**
 * The single canonical JSON serializer for the runtime. Object keys are
 * sorted, `-0` keeps its sign, and non-JSON primitives encode as `undefined`,
 * so every byte of output is deterministic for a given value graph. Persisted
 * region documents, evidence digests, and all in-memory identity keys derive
 * from this form; do not fork it per call site.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  if (typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'undefined' : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

/** Bounded non-cryptographic digest for metadata and history identity. */
export function canonicalDigest(value: unknown): string {
  let hash = 2166136261;
  for (const character of canonicalJson(value)) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
