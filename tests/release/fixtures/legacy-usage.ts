import { compileIntent, defineResource, parseCatalog } from '@varendo/core';
import { createVarendoRuntime } from '@varendo/runtime';
import { registerVarendoElements } from '@varendo/web';
import { VarendoProvider } from '@varendo/react';
import { createAppToolEndpoint } from '@varendo/agent';

export const legacyUsage = [
  compileIntent,
  defineResource,
  parseCatalog,
  createVarendoRuntime,
  registerVarendoElements,
  VarendoProvider,
  createAppToolEndpoint,
];
