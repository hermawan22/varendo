import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectFiles } from '../../src/playground/project-template.js';
import { zipProject } from '../../src/playground/zip.js';

const releaseVersion = (
  JSON.parse(readFileSync(new URL('../../../../release-metadata.json', import.meta.url), 'utf8')) as { version: string }
).version;

describe('playground project export', () => {
  it.each(['people', 'products', 'support', 'knowledge'] as const)(
    'builds a bounded %s source project without credentials',
    async (scenario) => {
      const files = projectFiles(scenario, releaseVersion);
      expect(files.map((file) => file.path)).toEqual([
        'package.json',
        'tsconfig.json',
        'index.html',
        'src/main.ts',
        'src/style.css',
        'README.md',
      ]);
      expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
      const manifest = JSON.parse(files[0]!.content) as {
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      expect(manifest.dependencies).toMatchObject({
        '@varendo/core': releaseVersion,
        '@varendo/runtime': releaseVersion,
        '@varendo/web': releaseVersion,
      });
      expect(manifest.scripts).toEqual({ dev: 'vite', build: 'tsc --noEmit && vite build' });
      const source = files.map((file) => file.content).join('\n');
      expect(source).toContain('createAeliqoApp');
      expect(files.find((file) => file.path === 'README.md')?.content).toContain(
        `Install requires the pinned ${releaseVersion} packages to be published to npm`,
      );
      expect(source).not.toMatch(/api[_-]?key|bearer\s+[a-z0-9]/iu);
      const archive = new Uint8Array(await zipProject(files).arrayBuffer());
      expect(new DataView(archive.buffer).getUint32(0, true)).toBe(0x04034b50);
      expect(new TextDecoder().decode(archive)).toContain('src/main.ts');
      expect(new DataView(archive.buffer).getUint32(archive.byteLength - 22, true)).toBe(0x06054b50);
    },
  );
});
