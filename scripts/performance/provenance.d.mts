export interface SourceGuard {
  readonly commit: string;
  current(): Promise<boolean>;
}
export function createSourceGuard(
  root: string,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<SourceGuard>;
