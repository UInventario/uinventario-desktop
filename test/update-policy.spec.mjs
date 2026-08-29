import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyUpdateError, evaluateUpdate, resolveUpdateOptions } from '../src/update-policy.mjs';

const safeState = {
  currentVersion: '0.1.0',
  targetVersion: '0.2.0',
  pendingOperations: 0,
  offlineSchemaVersion: 4,
  explicitRollback: false,
};

test('keeps Dev and Prod channels separate and requires an explicit rollback channel', () => {
  assert.deepEqual(resolveUpdateOptions({ environment: 'dev', configuredChannel: 'dev', argv: [] }), {
    channel: 'dev',
    explicitRollback: false,
  });
  assert.deepEqual(resolveUpdateOptions({ environment: 'prod', configuredChannel: 'latest', argv: [] }), {
    channel: 'latest',
    explicitRollback: false,
  });
  assert.throws(() => resolveUpdateOptions({ environment: 'prod', configuredChannel: 'dev', argv: [] }));
  assert.throws(() =>
    resolveUpdateOptions({
      environment: 'prod',
      configuredChannel: 'latest',
      argv: ['--update-channel=rollback-0.1'],
    }),
  );
  assert.throws(() =>
    resolveUpdateOptions({
      environment: 'prod',
      configuredChannel: 'latest',
      argv: ['--allow-update-rollback'],
    }),
  );
  assert.deepEqual(
    resolveUpdateOptions({
      environment: 'prod',
      configuredChannel: 'latest',
      argv: ['--allow-update-rollback', '--update-channel=rollback-0.1'],
    }),
    { channel: 'rollback-0.1', explicitRollback: true },
  );
});

test('allows a clean upgrade and rejects pending operations or a newer local schema', () => {
  assert.deepEqual(evaluateUpdate(safeState), { allowed: true, direction: 'UPGRADE' });
  assert.deepEqual(evaluateUpdate({ ...safeState, pendingOperations: 1 }), {
    allowed: false,
    reason: 'PENDING_OUTBOX',
  });
  assert.deepEqual(evaluateUpdate({ ...safeState, offlineSchemaVersion: 5 }), {
    allowed: false,
    reason: 'UNSUPPORTED_LOCAL_SCHEMA',
  });
});

test('supports downgrade only through the explicit rollback path', () => {
  const downgrade = { ...safeState, currentVersion: '0.2.0', targetVersion: '0.1.0' };
  assert.deepEqual(evaluateUpdate(downgrade), {
    allowed: false,
    reason: 'ROLLBACK_NOT_EXPLICIT',
  });
  assert.deepEqual(evaluateUpdate({ ...downgrade, explicitRollback: true }), {
    allowed: true,
    direction: 'ROLLBACK',
  });
});

test('classifies signature and checksum failures as security rejections', () => {
  assert.equal(classifyUpdateError(new Error('publisher signature mismatch')), 'INVALID_SIGNATURE');
  assert.equal(classifyUpdateError(new Error('sha512 checksum mismatch')), 'INVALID_CHECKSUM');
  assert.equal(classifyUpdateError(new Error('network unavailable')), 'UPDATE_FAILED');
});
