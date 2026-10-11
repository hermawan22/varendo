// Native Request stress regression for authentication signal retention.
// Run after build:runtime; no Request shims or artificial signal listeners.
import { createDataHttpHandler } from '../../packages/runtime/dist/data/http.js';
const budget = { maxRows: 10, maxBytes: 100000, maxMessages: 10, maxMilliseconds: 1000, maxColumns: 10 };
const discovery = { version: '1', requestId: 'request-1', catalogRevision: null, target: { kind: 'catalog' }, budget };
const request = () =>
  new Request('https://app.test/adc/describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(discovery),
  });
const service = {
  describe: async () => ({ ok: true, value: {} }),
  plan: async () => ({ ok: true, value: {} }),
  execute: async function* () {},
};
let signal;
let called;
const handler = createDataHttpHandler({
  service,
  maxRequestMilliseconds: 25,
  maxConcurrentRequests: 1,
  authenticate: (req) => {
    signal = req.signal;
    called++;
    return new Promise(() => {});
  },
});
const failures = [];
for (let i = 0; i < 1000; i++) {
  signal = undefined;
  called = 0;
  const response = await handler(request());
  const ok = response.status === 408 && called === 1 && signal?.aborted === true;
  if (!ok) failures.push({ i, status: response.status, called, aborted: signal?.aborted });
}
console.log(JSON.stringify({ iterations: 1000, failures, passed: 1000 - failures.length }));
if (failures.length) process.exitCode = 1;
