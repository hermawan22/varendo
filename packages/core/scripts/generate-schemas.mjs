import { mkdir, writeFile } from 'node:fs/promises';
import * as z from 'zod/mini';
import { contractSchemas } from '../dist/contracts/schemas-registry.js';
import { WIRE_LIMITS, CONTRACT_VERSION } from '../dist/contracts/limits.js';
const directory = new URL('../schemas/', import.meta.url);
await mkdir(directory, { recursive: true });
function addObjectBounds(value) {
  value.maxProperties ??= WIRE_LIMITS.properties;
  const keyBounds = { maxLength: WIRE_LIMITS.id, not: { const: '__proto__' } };
  value.propertyNames = value.propertyNames ? { allOf: [value.propertyNames, keyBounds] } : keyBounds;
}
function addTypeBounds(value) {
  if (value.type === 'object') addObjectBounds(value);
  if (value.type === 'array') value.maxItems ??= WIRE_LIMITS.array;
  if (value.type === 'string') value.maxLength ??= WIRE_LIMITS.text;
}
function addResourceBounds(value) {
  if (!value || typeof value !== 'object') return;
  // Zod emits prefixItems:[] for an empty tuple; draft 2020-12 forbids it.
  // maxItems:0/items:false retain the exact empty-array contract.
  if (Array.isArray(value.prefixItems) && value.prefixItems.length === 0) delete value.prefixItems;
  addTypeBounds(value);
  for (const item of Object.values(value)) addResourceBounds(item);
}
for (const [kind, schema] of Object.entries(contractSchemas)) {
  const document = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  addResourceBounds(document);
  document.$id = `https://hermawan22.github.io/varendo/schemas/${CONTRACT_VERSION}/${kind}.schema.json`;
  document.$comment =
    'Shape contract only. Apply documented byte/depth/node/JSON-object ingress limits before recursive validation; binding and authority are separate.';
  await writeFile(new URL(`${kind}.schema.json`, directory), JSON.stringify(document, null, 2) + '\n');
}
