import type { ToolModelProviderErrorKind } from './connection-types.js';

export class ToolModelProviderError extends Error {
  readonly kind: ToolModelProviderErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    kind: ToolModelProviderErrorKind,
    message: string,
    options?: { readonly retryable?: boolean; readonly status?: number; readonly providerCode?: string },
  ) {
    super(message);
    this.name = 'ToolModelProviderError';
    this.kind = kind;
    this.retryable = options?.retryable ?? false;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.providerCode !== undefined && /^[A-Za-z0-9_.-]{1,128}$/u.test(options.providerCode))
      this.providerCode = options.providerCode;
  }
}

export function isToolModelProviderError(value: unknown): value is ToolModelProviderError {
  return value instanceof ToolModelProviderError;
}

export function configuration(message: string): never {
  throw new ToolModelProviderError('configuration', message);
}
