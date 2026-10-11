/** Resource limits for one wire document, independent of commercial entitlement. */
export const WIRE_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  depth: 64,
  nodes: 100_000,
  properties: 256,
  array: 10_000,
  id: 160,
  text: 16_384,
  label: 4_096,
  arguments: 32,
  outputs: 128,
  presentationNodes: 512,
  links: 2_048,
  diagnostics: 16,
} as const);
export const CONTRACT_VERSION = '1' as const;
