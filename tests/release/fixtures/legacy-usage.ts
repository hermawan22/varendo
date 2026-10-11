import { compileIntent, defineResource, parseCatalog } from '@varendo/core';
import { createAeliqoRuntime } from '@varendo/runtime';
import { registerAeliqoElements } from '@varendo/web';
import { AeliqoProvider } from '@varendo/react';
import { createAppToolEndpoint } from '@varendo/agent';

export const legacyUsage = [
  compileIntent,
  defineResource,
  parseCatalog,
  createAeliqoRuntime,
  registerAeliqoElements,
  AeliqoProvider,
  createAppToolEndpoint,
];
