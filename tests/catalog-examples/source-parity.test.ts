import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { join, resolve } from 'node:path';
import { CATALOG_EXAMPLE_IDS } from '../../examples/catalog/index.js';
import { CATALOG_MOUNT_SOURCES } from '../../examples/catalog/source.js';
import { describe, expect, it } from 'vitest';

const FAMILY_FILES = [
  'compound.ts',
  'data.ts',
  'feedback.ts',
  'foundation.ts',
  'input.ts',
  'navigation.ts',
  'visualization.ts',
] as const;

/** Keep only lexical tokens so authored formatting cannot create false drift. */
function tokens(source: string): string[] {
  const result: string[] = [];
  let index = 0;
  const twoCharacter = new Set([
    '=>',
    '==',
    '!=',
    '<=',
    '>=',
    '&&',
    '||',
    '??',
    '?.',
    '++',
    '--',
    '+=',
    '-=',
    '*=',
    '/=',
    '**',
    '??',
  ]);
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      const literal = source.slice(index + 1, end - 1);
      result.push(quote === '`' ? source.slice(index, end) : JSON.stringify(literal));
      index = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_$]/.test(source[end]!)) end += 1;
      result.push(source.slice(index, end));
      index = end;
      continue;
    }
    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(source[index + 1] ?? ''))) {
      let end = index + 1;
      while (end < source.length && /[0-9A-Za-z._]/.test(source[end]!)) end += 1;
      const literal = (character === '.' ? `0${source.slice(index, end)}` : source.slice(index, end)).replaceAll(
        '_',
        '',
      );
      const numeric = Number(literal);
      result.push(Number.isFinite(numeric) ? String(numeric) : literal);
      index = end;
      continue;
    }
    const pair = source.slice(index, index + 2);
    result.push(twoCharacter.has(pair) ? pair : character);
    index += twoCharacter.has(pair) ? 2 : 1;
  }
  const withoutAnnotations: string[] = [];
  for (let index = 0; index < result.length; index += 1) {
    if (result[index] !== ':' || !/[A-Za-z_$]/.test(result[index - 1] ?? '')) {
      withoutAnnotations.push(result[index]!);
      continue;
    }
    let depth = 0;
    let end = index + 1;
    for (; end < result.length; end += 1) {
      const token = result[end]!;
      if (token === '[' || token === '{' || token === '(') depth += 1;
      else if (token === ']' || token === '}' || token === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (token === '=' && depth === 0) break;
      else if ((token === ',' || token === ';') && depth === 0) break;
    }
    if (result[end] === '=') {
      index = end - 1;
      continue;
    }
    withoutAnnotations.push(result[index]!);
  }
  return withoutAnnotations.filter(
    (token, index, values) => token !== ',' || ![values[index + 1]].some((next) => [']', '}', ')'].includes(next!)),
  );
}

function withoutOuterGrouping(source: string): string {
  const value = source.trim();
  if (!value.startsWith('(') || !value.endsWith(')')) return value;
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== undefined) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0 && index !== value.length - 1) return value;
    }
  }
  return value.slice(1, -1).trim();
}

/** The preview supplies a class constructor for lazy per-component registration. */
function withoutPreviewConstructor(source: string): string {
  return source.replace(
    /createCatalogElement<([A-Za-z_$][\w$]*)>\(\s*(['"][^'"]*['"])\s*,\s*root\s*,\s*\1\s*,?\s*\)/gs,
    (_match, type: string, tag: string) => `createCatalogElement<${type}>(${tag}, root)`,
  );
}

function extractAuthoredMounts(root: string): Map<string, string> {
  const api = new API({ cwd: root });
  try {
    const config = resolve(root, 'tests/catalog-examples/tsconfig.json');
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProject(config);
    if (project === undefined) throw new Error('Catalog TypeScript project is unavailable.');
    const mounts = new Map<string, string>();
    for (const fileName of FAMILY_FILES.map((file) => resolve(root, 'examples/catalog', file))) {
      const source = project.program.getSourceFile(fileName);
      if (source === undefined) throw new Error(`Catalog source file is unavailable: ${fileName}`);
      for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          if (initializer === undefined || !ts.isArrayLiteralExpression(initializer)) continue;
          for (const element of initializer.elements) {
            if (!ts.isCallExpression(element) || element.arguments.length < 2) continue;
            const idArgument = element.arguments[0];
            const mountArgument = element.arguments[1];
            if (
              idArgument === undefined ||
              mountArgument === undefined ||
              !ts.isStringLiteral(idArgument) ||
              !ts.isArrowFunction(mountArgument)
            )
              continue;
            const id = idArgument.text;
            if (mounts.has(id)) throw new Error(`Duplicate authored catalog mount: ${id}`);
            mounts.set(id, mountArgument.getText(source));
          }
        }
      }
    }
    return mounts;
  } finally {
    api.close();
  }
}

describe('catalog source parity', () => {
  it('keeps every preserved snippet aligned with its authored mount callback', () => {
    const root = resolve(import.meta.dirname, '../..');
    const authored = extractAuthoredMounts(root);
    expect([...authored.keys()].sort()).toEqual([...CATALOG_EXAMPLE_IDS].sort());
    expect(Object.keys(CATALOG_MOUNT_SOURCES).sort()).toEqual([...CATALOG_EXAMPLE_IDS].sort());
    for (const id of CATALOG_EXAMPLE_IDS) {
      const authoredTokens = tokens(withoutPreviewConstructor(authored.get(id)!));
      const preservedTokens = tokens(withoutOuterGrouping(CATALOG_MOUNT_SOURCES[id]));
      expect(preservedTokens, `source drift for ${id}`).toEqual(authoredTokens);
    }
  });
});
