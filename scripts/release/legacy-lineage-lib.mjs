export const MIGRATION_URL = 'https://docs.aeliqo.com/ship/migration-0.3/';

export const LEGACY_LINEAGES = Object.freeze([
  {
    name: '@aeliqo/devtools',
    version: '0.3.0',
    replacement: 'the five current Aeliqo packages documented at https://docs.aeliqo.com/reference/packages/',
    reason: 'Aeliqo Studio and @aeliqo/devtools were removed in Aeliqo 0.4',
  },
]);

export function legacyDeprecationMessage(lineage) {
  if (!LEGACY_LINEAGES.includes(lineage)) throw new Error('Legacy lineage is not allowlisted');
  return `${lineage.reason}. Use ${lineage.replacement}. ${MIGRATION_URL}`;
}

function assertRegistryStatus(status, name, version) {
  if (status !== 200) throw new Error(`Registry returned HTTP ${status} for ${name}@${version}`);
}

function assertPackageIdentity(payload, name, version) {
  if (payload?.name !== name || payload?.version !== version)
    throw new Error(`Registry returned the wrong identity for ${name}@${version}`);
}

function assertExpectedIntegrity(integrity, expectedIntegrity, name, version) {
  if (expectedIntegrity && integrity !== expectedIntegrity)
    throw new Error(`${name}@${version} exists with bytes that differ from the verified candidate`);
}

export function classifyExactPackage(status, payload, name, version, expectedIntegrity) {
  if (status === 404) return { state: 'absent' };
  assertRegistryStatus(status, name, version);
  assertPackageIdentity(payload, name, version);
  const integrity = payload?.dist?.integrity ?? null;
  assertExpectedIntegrity(integrity, expectedIntegrity, name, version);
  return {
    state: 'visible',
    deprecated: typeof payload.deprecated === 'string' ? payload.deprecated : null,
    integrity,
  };
}
