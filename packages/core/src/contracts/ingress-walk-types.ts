export type WirePath = {
  readonly parent: WirePath | undefined;
  readonly key: string | number;
  readonly depth: number;
};

export type WireSummary = {
  readonly nodes: number;
  readonly bytes: number;
  readonly maxRelativeDepth: number;
};

export type SummaryScope = {
  readonly baseDepth: number;
  readonly startNodes: number;
  readonly startBytes: number;
  readonly parent: SummaryScope | undefined;
  maxRelativeDepth: number;
};

export type WireFrame =
  | {
      readonly kind: 'visit';
      readonly value: unknown;
      readonly path: WirePath | undefined;
      readonly scope: SummaryScope | undefined;
    }
  | { readonly kind: 'leave'; readonly value: object; readonly scope: SummaryScope };

export function pathParts(path: WirePath | undefined): (string | number)[] {
  const parts = new Array<string | number>(path?.depth ?? 0);
  for (let current = path; current !== undefined; current = current.parent) parts[current.depth - 1] = current.key;
  return parts;
}
