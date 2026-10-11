import { parseCatalog } from '@varendo/core';

const input = {
  version: '1',
  revision: 'catalog-1',
  functionRegistryDigest: 'functions-1',
  entities: [
    {
      id: 'employees',
      label: 'Employees',
      identity: ['employee.id'],
      rowGrain: ['employee.id'],
      fields: [
        {
          id: 'employee.id',
          label: 'Employee ID',
          role: 'identity',
          type: { value: 'text', nullable: false },
        },
      ],
    },
  ],
  relationships: [],
  meanings: [],
  capabilities: [],
};

const parsed = parseCatalog(input);
if (!parsed.ok) throw new Error(`Catalog rejected: ${parsed.diagnostics[0].message}`);

console.log(
  JSON.stringify({
    ok: parsed.ok,
    revision: parsed.value.revision,
    entities: parsed.value.entities.map((entity) => entity.id),
  }),
);
