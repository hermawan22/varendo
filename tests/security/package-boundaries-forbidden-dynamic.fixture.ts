// @ts-nocheck
// This fixture intentionally uses non-literal runtime module edges.
export async function loadUntrustedModule() {
  const specifier = './untrusted-module.js';
  return [import(specifier), require(specifier)];
}
