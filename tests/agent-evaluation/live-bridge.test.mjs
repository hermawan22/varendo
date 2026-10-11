import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bridge } from './live-browser/driver.mjs';

test('live bridge retains the exact rejected proposal and diagnostic without a provider call', async () => {
  const proposal = { version: '1', kind: 'analyze', resource: 'attendance', period: { toExclusive: '2026-09-07' } };
  const page = {
    async evaluate(_callback, operation) {
      assert.equal(operation.operation, 'invoke');
      assert.deepEqual(operation.args, ['aeliqo_render', proposal, 'j2-invalid']);
      return { ok: true, value: { state: 'failed', diagnostics: [{ code: 'live.j2-invalid' }] } };
    },
  };
  const trace = [];
  const result = await bridge(page, 'J2', trace).invoke('aeliqo_render', proposal, { requestId: 'j2-invalid' });
  assert.equal(result.value.state, 'failed');
  assert.deepEqual(trace, [
    {
      operation: 'aeliqo_render',
      requestId: 'j2-invalid',
      input: proposal,
      state: 'failed',
      diagnosticCodes: ['live.j2-invalid'],
    },
  ]);
});
