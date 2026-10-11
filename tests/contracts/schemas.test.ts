import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const kinds = [
  'catalog',
  'task',
  'result',
  'experience',
  'expression',
  'query',
  'interaction',
  'result-event',
  'environment',
  'presentation-plan',
  'task-proposal',
  'meaning-draft',
  'binding-outcome',
  'model-evaluation',
  'operation-grant',
  'agent-loop-budget',
  'agent-stop-reason',
  'narrative-claim',
  'intent',
  'plot-spec',
  'visualization-spec',
] as const;

type Schema = {
  $id?: unknown;
  $schema?: unknown;
  $comment?: unknown;
  type?: unknown;
  additionalProperties?: unknown;
  properties?: Record<string, unknown>;
  oneOf?: Schema[];
  enum?: unknown[];
};

function readSchema(kind: string): Schema {
  const path = fileURLToPath(new URL(`../../packages/core/schemas/${kind}.schema.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Schema;
}

describe('generated JSON Schema artifacts', () => {
  it('contains one strict schema for every public wire kind', () => {
    for (const kind of kinds) {
      const schema = readSchema(kind);
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$id).toBe(`https://hermawan22.github.io/varendo/schemas/1/${kind}.schema.json`);
      expect(schema.$comment).toMatch(/Shape contract only/);
      const roots = schema.oneOf ?? [schema];
      expect(roots.length).toBeGreaterThan(0);
      for (const root of roots) {
        if (kind === 'operation-grant' || kind === 'agent-stop-reason') {
          expect(root.type).toBe('string');
          expect(root.enum?.length).toBeGreaterThan(0);
        } else {
          expect(root.type).toBe('object');
          expect(root.additionalProperties).toBe(false);
        }
      }
    }
  });

  it('pins the document version const in all four public families', () => {
    for (const kind of ['catalog', 'task', 'result', 'experience']) {
      const schema = readSchema(kind);
      const roots = schema.oneOf ?? [schema];
      const versionSchema =
        roots.length === 1 ? roots[0]?.properties?.version : roots.map((root) => root.properties?.version);
      expect(versionSchema).toEqual(
        roots.length === 1
          ? { type: 'string', const: '1', maxLength: 16_384 }
          : roots.map(() => ({ type: 'string', const: '1', maxLength: 16_384 })),
      );
    }
  });
});
