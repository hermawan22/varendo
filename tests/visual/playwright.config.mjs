import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { testPort } from '../shared/port.mjs';
const browsers = ['chromium', 'firefox', 'webkit'];
const selectedProject = process.env.AELIQO_VISUAL_PROJECT;
if (selectedProject !== undefined && !browsers.includes(selectedProject))
  throw new Error('Unknown AELIQO_VISUAL_PROJECT');
const selectedBatch = process.env.AELIQO_VISUAL_BATCH;
if (selectedBatch !== undefined && !/^[a-z0-9-]+$/u.test(selectedBatch)) throw new Error('Invalid AELIQO_VISUAL_BATCH');
const outputDirectory = `../../artifacts/visual-catalog/${selectedProject ?? 'all'}/${selectedBatch ?? 'full'}`;
const port = await testPort('AELIQO_VISUAL_PORT');
export default defineConfig({
  testDir: '.',
  testMatch: [
    'catalog.spec.ts',
    'field-states.spec.ts',
    'data-states.spec.ts',
    'structure-states.spec.ts',
    'data-interactions.spec.ts',
    'compound-interactions.spec.ts',
    'visualization-interactions.spec.ts',
  ],
  workers: 1,
  timeout: 60000,
  outputDir: outputDirectory,
  reporter: [
    ['list'],
    ['json', { outputFile: fileURLToPath(new URL(`${outputDirectory}/results.json`, import.meta.url)) }],
  ],
  projects: browsers
    .filter((name) => selectedProject === undefined || name === selectedProject)
    .map((name) => ({
      name,
      fullyParallel: false,
      use: {
        browserName: name,
        // Repaint complete tiles to avoid history-dependent rounded-edge antialiasing.
        ...(name === 'chromium'
          ? { launchOptions: { args: ['--disable-gpu', '--disable-skia-runtime-opts', '--disable-partial-raster'] } }
          : {}),
      },
    })),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
    deviceScaleFactor: 1,
  },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: `pnpm exec vite build --config tests/visual/vite.config.mjs && pnpm exec vite preview --config tests/visual/vite.config.mjs --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/tests/visual/index.html`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
