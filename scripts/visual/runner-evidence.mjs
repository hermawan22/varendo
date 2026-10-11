import assert from 'node:assert/strict';
function digest(value) {
  assert.match(value, /^[a-f0-9]{64}$/u, 'Missing executable/font digest');
}
export function validateRunner(runner) {
  assert.ok(runner && typeof runner === 'object', 'Missing runner evidence');
  if (runner.container) assert.match(runner.container, /^sha256:[a-f0-9]{64}$/u, 'Unpinned container');
  else {
    assert.equal(runner.hostImage?.provider, 'github-actions');
    assert.match(runner.hostImage?.os, /^ubuntu[0-9]+$/u);
    assert.match(runner.hostImage?.version, /^[0-9]{8}\.[0-9]+\.[0-9]+$/u);
  }
  assert.match(runner.platform, /^(linux|darwin|win32)\/(x64|arm64)$/u);
  assert.equal(runner.node, 'v24.20.0');
  assert.equal(runner.pnpm, '11.24.0');
  assert.equal(runner.playwright, '1.63.0');
  assert.deepEqual(Object.keys(runner.browsers).sort(), ['chromium', 'firefox', 'webkit']);
  for (const browser of Object.values(runner.browsers)) {
    assert.match(browser.version, /^[0-9]+(?:\.[0-9]+)+$/u);
    digest(browser.executableSHA);
  }
  digest(runner.fonts.sha256);
  assert.ok(Number.isSafeInteger(runner.fonts.files) && runner.fonts.files > 0, 'Empty font inventory');
  assert.ok(Array.isArray(runner.fonts.directories) && runner.fonts.directories.length > 0, 'Missing font directories');
  for (const directory of runner.fonts.directories) assert.ok(typeof directory === 'string' && directory.length > 0);
  assert.equal(runner.locale, 'en-US');
  assert.equal(runner.timezone, 'UTC');
  assert.equal(runner.deviceScaleFactor, 1);
  assert.deepEqual(runner.variants, ['1440x900/light/ltr', '768x900/light/ltr', '360x800/dark/rtl/200%-text']);
}
