import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({ ...base, testMatch: 'app-draft-exit.spec.ts', workers: 1 });
