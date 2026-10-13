'use client';
import { useEffect, useState } from 'react';
import { defineResource } from '@varendo/core';
import { createQueryFunctionRegistry } from '@varendo/core/expressions';
import { VarendoProvider, VarendoRegion } from '@varendo/react/app';
import { createLocalDataService } from '@varendo/runtime/data';
import type { VarendoApp } from '@varendo/web/app';
import { z } from 'zod';

const people = defineResource({
  id: 'people',
  revision: 'people-1',
  label: 'People',
  identity: ['id'],
  schema: z.object({ id: z.string(), name: z.string(), team: z.string() }),
  fields: { name: { label: 'Name' }, team: { label: 'Team', role: 'dimension' } },
  presentation: { allowedViews: ['table', 'cards'] },
});

function createPeopleApp(createVarendoApp: (typeof import('@varendo/web/app'))['createVarendoApp']) {
  const functions = createQueryFunctionRegistry({ version: '2' });
  if (!functions.ok) throw new Error(functions.diagnostics[0].message);
  const data = createLocalDataService({
    snapshot: {
      catalog: people.catalog,
      sourceRevision: 'next-people-1',
      records: { people: [{ id: 'ada', name: 'Ada Chen', team: 'Design' }] },
    },
    functionRegistry: functions.value,
    sourceLimits: { rows: 100, bytes: 100_000 },
    authorize: () => ({ ok: true, value: { scopeDigest: 'next-scope', policyRevision: 'next-policy-1' } }),
  });
  return createVarendoApp({
    resources: [{ resource: people, data }],
    authority: {
      read: () => ({
        ok: true,
        value: {
          principalKey: 'next-user',
          scopeDigest: 'next-scope',
          policyRevision: 'next-policy-1',
          experienceRevision: 'next-web-1',
          grants: ['task.evaluate', 'result.inspect', 'experience.commit'],
          readContext: { principal: 'next-user' },
        },
      }),
    },
  });
}

const browsePeople = Object.freeze({
  version: '1',
  id: 'next-browse-people',
  kind: 'browse',
  resource: 'people',
  fields: ['name', 'team'],
});

export function AdaptivePeople() {
  const [app, setApp] = useState<VarendoApp>();
  const [status, setStatus] = useState('Preparing browser runtime');
  useEffect(() => {
    let active = true;
    let instance: VarendoApp | undefined;
    void (async () => {
      await import('@lit-labs/ssr-client/lit-element-hydrate-support.js');
      const { createVarendoApp } = await import('@varendo/web/app');
      instance = createPeopleApp(createVarendoApp);
      if (active) setApp(instance);
      else instance.dispose();
    })().catch((error) => {
      if (active) setStatus(error instanceof Error ? error.message : 'Browser runtime failed');
    });
    return () => {
      active = false;
      instance?.dispose();
    };
  }, []);
  return (
    <section aria-labelledby="adaptive-people-title">
      <h2 id="adaptive-people-title">Adaptive People Region</h2>
      <p id="adaptive-people-status" role="status">
        {status}
      </p>
      {app === undefined ? null : (
        <VarendoProvider app={app}>
          <VarendoRegion
            regionId="next-people"
            resourceId="people"
            intent={browsePeople}
            onReceipt={(receipt) => setStatus(receipt.status)}
          />
        </VarendoProvider>
      )}
    </section>
  );
}
