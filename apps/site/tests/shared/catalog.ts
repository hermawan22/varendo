import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type CatalogEntry = { readonly id?: unknown; readonly name?: unknown };
type Catalog = { readonly components?: unknown };

const catalog = JSON.parse(readFileSync(resolve(process.cwd(), '../../catalog/components.json'), 'utf8')) as Catalog;

if (!Array.isArray(catalog.components)) throw new Error('Public component catalog is missing.');

export const componentCatalog = (catalog.components as readonly CatalogEntry[])
  .filter(
    (entry): entry is { readonly id: string; readonly name: string } =>
      typeof entry.id === 'string' && typeof entry.name === 'string',
  )
  .map(({ id, name }) => ({ id, name }));

if (componentCatalog.length !== 71) throw new Error('Public catalog does not contain all 71 components.');
