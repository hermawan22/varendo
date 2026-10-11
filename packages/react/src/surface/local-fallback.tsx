import React from 'react';
import type { DataRecord, DataValue } from '@varendo/runtime/data';

function display(value: DataValue): string {
  if (value === null) return '—';
  if (typeof value === 'object') return value.decimal;
  return String(value);
}

export function DataRows({
  rows,
  fields,
}: {
  readonly rows: readonly DataRecord[];
  readonly fields: readonly string[];
}): React.JSX.Element {
  if (rows.length === 0) return <p role="status">No records to show.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {fields.map((field) => (
              <th scope="col" key={field}>
                {field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {fields.map((field) => (
                <td key={field}>{display(row[field] ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataCards({
  rows,
  fields,
}: {
  readonly rows: readonly DataRecord[];
  readonly fields: readonly string[];
}): React.JSX.Element {
  return (
    <ul aria-label="Records" style={{ display: 'grid', gap: '0.75rem', padding: 0, listStyle: 'none' }}>
      {rows.map((row, index) => (
        <li key={index} style={{ border: '1px solid currentColor', borderRadius: '0.5rem', padding: '0.75rem' }}>
          <dl style={{ margin: 0 }}>
            {fields.map((field) => (
              <React.Fragment key={field}>
                <dt style={{ fontWeight: 600 }}>{field}</dt>
                <dd style={{ margin: '0 0 0.5rem' }}>{display(row[field] ?? null)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
