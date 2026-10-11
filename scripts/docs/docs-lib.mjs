/** Shared helpers for the public documentation build and audit tooling. */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function escape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function filesAt(directory, predicate = () => true) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesAt(path, predicate)));
    else if (predicate(path)) files.push(path);
  }
  return files.sort();
}

export function hasExactKeys(value, expected) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
