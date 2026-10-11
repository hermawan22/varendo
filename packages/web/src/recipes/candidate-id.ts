const MAX_CANDIDATE_ID = 160;

function normalizedSource(source: string): string {
  return source.replace(/[^A-Za-z0-9._-]/gu, '-').replace(/[^A-Za-z0-9]+$/u, '') || 'candidate';
}

/** Build a deterministic resolver label without widening the core wire contract. */
export function resolverCandidateId(prefix: 'custom' | 'recipe', source: string): string {
  const normalized = normalizedSource(source);
  const value = `${prefix}.${normalized}`;
  if (value.length <= MAX_CANDIDATE_ID) return value;
  return value.slice(0, MAX_CANDIDATE_ID - 1) + normalized.at(-1)!;
}
