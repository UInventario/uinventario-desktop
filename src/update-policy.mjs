import { compare, valid } from 'semver';

export const SUPPORTED_OFFLINE_SCHEMA_VERSION = 4;

export function resolveUpdateOptions({ environment, configuredChannel, argv }) {
  const defaultChannel = environment === 'dev' ? 'dev' : 'latest';
  if (configuredChannel !== defaultChannel) {
    throw new Error(`El canal ${configuredChannel} no corresponde al ambiente ${environment}.`);
  }

  const rollbackChannel = argv
    .find((argument) => argument.startsWith('--update-channel='))
    ?.slice('--update-channel='.length);
  const explicitRollback = argv.includes('--allow-update-rollback');

  if (
    Boolean(rollbackChannel) !== explicitRollback ||
    (rollbackChannel && !/^rollback-[a-z0-9][a-z0-9.-]*$/.test(rollbackChannel))
  ) {
    throw new Error('Un canal de rollback exige --allow-update-rollback y el prefijo rollback-.');
  }

  return {
    channel: rollbackChannel || configuredChannel,
    explicitRollback,
  };
}

export function evaluateUpdate({
  currentVersion,
  targetVersion,
  pendingOperations,
  offlineSchemaVersion,
  explicitRollback,
}) {
  if (!valid(currentVersion) || !valid(targetVersion)) {
    return { allowed: false, reason: 'INVALID_VERSION' };
  }
  if (!Number.isSafeInteger(pendingOperations) || pendingOperations < 0) {
    return { allowed: false, reason: 'LOCAL_STATE_UNAVAILABLE' };
  }
  if (!Number.isSafeInteger(offlineSchemaVersion) || offlineSchemaVersion < 0) {
    return { allowed: false, reason: 'LOCAL_STATE_UNAVAILABLE' };
  }
  if (pendingOperations > 0) return { allowed: false, reason: 'PENDING_OUTBOX' };
  if (offlineSchemaVersion > SUPPORTED_OFFLINE_SCHEMA_VERSION) {
    return { allowed: false, reason: 'UNSUPPORTED_LOCAL_SCHEMA' };
  }

  const direction = compare(targetVersion, currentVersion);
  if (direction === 0) return { allowed: false, reason: 'CURRENT_VERSION' };
  if (direction < 0 && !explicitRollback) return { allowed: false, reason: 'ROLLBACK_NOT_EXPLICIT' };

  return { allowed: true, direction: direction > 0 ? 'UPGRADE' : 'ROLLBACK' };
}

export function classifyUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/signature|publisher|authenticode/i.test(message)) return 'INVALID_SIGNATURE';
  if (/sha512|checksum|hash/i.test(message)) return 'INVALID_CHECKSUM';
  return 'UPDATE_FAILED';
}
