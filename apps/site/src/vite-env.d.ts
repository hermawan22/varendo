declare module '@varendo/catalog-examples' {
  export const CATALOG_EXAMPLE_IDS: readonly string[];
  export function catalogExample(id: string, container: HTMLElement): () => void;
}
