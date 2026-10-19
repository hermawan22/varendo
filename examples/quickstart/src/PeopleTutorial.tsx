import { useState } from 'react';
import type { Intent } from '@varendo/core';
import { VarendoProvider, VarendoRegion } from '@varendo/react/app';
import { VarendoForm, VarendoSelect, VarendoTextField } from '@varendo/react/inputs';
import type { createTutorialApp } from './app.js';

type TutorialApp = ReturnType<typeof createTutorialApp>;
type ViewKey = 'table' | 'engineering' | 'headcount';

const INTENTS: Readonly<Record<ViewKey, Intent>> = {
  table: {
    version: '1',
    id: 'browse-people',
    kind: 'browse',
    resource: 'people',
    fields: ['name', 'team'],
    preferredView: 'table',
  },
  engineering: {
    version: '1',
    id: 'browse-engineering',
    kind: 'browse',
    resource: 'people',
    fields: ['name', 'team'],
    filter: { op: 'compare', field: 'team', comparison: 'eq', value: 'Engineering' },
    preferredView: 'table',
  },
  headcount: {
    version: '1',
    id: 'monthly-headcount',
    kind: 'analyze',
    resource: 'workforce-headcount',
    measures: [{ id: 'month-end-headcount', revision: '1' }],
    time: { field: 'month', grain: 'month', calendar: 'gregorian', timezone: 'UTC' },
    preferredView: 'trend',
    sort: [{ field: 'month', direction: 'asc' }],
  },
};

export interface PeopleTutorialProps {
  readonly app: TutorialApp;
}

export function PeopleTutorial({ app }: PeopleTutorialProps) {
  const [view, setView] = useState<ViewKey>('table');
  const [name, setName] = useState('');
  const [team, setTeam] = useState('Engineering');
  const [formStatus, setFormStatus] = useState('No draft submitted.');
  const intent = INTENTS[view];

  return (
    <VarendoProvider app={app}>
      <nav aria-label="People views">
        <button type="button" onClick={() => setView('table')}>
          All employees
        </button>
        <button type="button" onClick={() => setView('engineering')}>
          Engineering
        </button>
        <button type="button" onClick={() => setView('headcount')}>
          Monthly headcount
        </button>
      </nav>

      <VarendoRegion
        key={intent.resource}
        regionId="people-main"
        resourceId={intent.resource}
        intent={intent}
        onReceipt={(receipt) => {
          if (receipt.status !== 'renderer-ready') console.error(receipt.diagnostics);
        }}
      />

      <VarendoForm
        label="Add employee draft"
        onSubmit={(event) => {
          event.preventDefault();
          setFormStatus(`Review ${name || 'unnamed employee'} for ${team} before executing an action.`);
        }}
      >
        <VarendoTextField
          label="Name"
          name="name"
          value={name}
          required
          onValueChange={(event) => setName(event.detail.value)}
        />
        <VarendoSelect
          label="Team"
          name="team"
          value={team}
          options={[
            { value: 'Design', label: 'Design' },
            { value: 'Engineering', label: 'Engineering' },
          ]}
          onValueChange={(event) => setTeam(event.detail.value)}
        />
        <button type="submit">Review employee</button>
      </VarendoForm>
      <p role="status">{formStatus}</p>
    </VarendoProvider>
  );
}
