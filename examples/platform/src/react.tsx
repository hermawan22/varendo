import './csp-bootstrap.js';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VarendoTextField } from '@varendo/react/inputs';
import { VarendoTable } from '@varendo/react/data';
import { registerVarendoReactElements } from '@varendo/react';

registerVarendoReactElements();

function ReactFixture(): React.JSX.Element {
  const [value, setValue] = useState('React');
  return (
    <main>
      <h1>React platform fixture</h1>
      <p id="react-value" role="status">
        {value}
      </p>
      <form id="react-form">
        <VarendoTextField
          label="React name"
          value={value}
          name="person"
          onValueChange={(event) => setValue(event.detail.value)}
        />
        <button type="submit">Submit</button>
      </form>
      <VarendoTable
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
