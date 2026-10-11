export interface AeliqoOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export function validOptions(options: readonly AeliqoOption[]): boolean {
  if (options.length > 500) return false;
  const values = new Set<string>();
  for (const option of options) {
    if (option.value.length === 0 || option.value.length > 256 || option.label.length > 512 || values.has(option.value))
      return false;
    if (option.description !== undefined && option.description.length > 1024) return false;
    if (option.disabled !== undefined && typeof option.disabled !== 'boolean') return false;
    values.add(option.value);
  }
  return true;
}
