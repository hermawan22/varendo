import './csp-bootstrap.js';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AeliqoTextField } from '@varendo/react/inputs';
import { AeliqoTable } from '@varendo/react/data';
import { registerAeliqoReactElements } from '@varendo/react';

registerAeliqoReactElements();

function ReactFixture(): React.JSX.Element {
  const [value, setValue] = useState('React');
  return (
    <main>
      <h1>React platform fixture</h1>
      <p id="react-value" role="status">
        {value}
      </p>
      <form id="react-form">
        <AeliqoTextField
          label="React name"
          value={value}
          name="person"
          onValueChange={(event) => setValue(event.detail.value)}
        />
        <button type="submit">Submit</button>
      </form>
      <AeliqoTable
        caption="People"
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'role', label: 'Role' },
        ]}
        rows={[
          { name: 'Ada', role: 'Engineer' },
          { name: 'Grace', role: 'Researcher' },
        ]}
      />
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>('#react-root');
if (root === null) {
  throw new Error('The React platform fixture root is missing.');
}
createRoot(root).render(<ReactFixture />);
