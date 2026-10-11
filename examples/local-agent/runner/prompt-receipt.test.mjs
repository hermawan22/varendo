import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicPromptReceipt } from './prompt-receipt.mjs';

test('returns bounded loop and usage evidence without forwarding provider payloads', () => {
  const receipt = publicPromptReceipt({
    stop: 'renderer-ready',
    modelRequests: 3,
    toolCalls: 2,
    inputTokens: 810,
    outputTokens: 92,
    textDraft: 'Done',
    receipts: [{ state: 'renderer-ready', input: { secret: 'must-not-leak' } }],
  });
  assert.deepEqual(receipt, {
    stop: 'renderer-ready',
    modelRequests: 3,
    toolCalls: 2,
    message: 'Done',
    usage: { inputTokens: 810, outputTokens: 92 },
  });
});
