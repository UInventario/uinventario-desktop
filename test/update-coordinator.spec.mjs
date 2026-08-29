import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopUpdateCoordinator } from '../src/update-coordinator.mjs';

function createUpdater({ version = '0.2.0', downloadError } = {}) {
  const calls = { check: 0, download: 0, install: 0 };
  return {
    calls,
    set channel(value) {
      this.selectedChannel = value;
      this.allowDowngrade = true;
    },
    async checkForUpdates() {
      calls.check += 1;
      return { updateInfo: { version } };
    },
    async downloadUpdate() {
      calls.download += 1;
      if (downloadError) throw downloadError;
      return ['installer.exe'];
    },
    quitAndInstall() {
      calls.install += 1;
    },
  };
}

function createCoordinator({ updater, states, explicitRollback = false }) {
  let index = 0;
  return new DesktopUpdateCoordinator({
    updater,
    getLocalState: async () => states[Math.min(index++, states.length - 1)],
    currentVersion: '0.1.0',
    channel: explicitRollback ? 'rollback-0.1' : 'dev',
    explicitRollback,
  });
}

const clean = { offlineSchemaVersion: 4, pendingOperations: 0 };

test('prepares and installs an upgrade only after two clean outbox checks', async () => {
  const updater = createUpdater();
  const coordinator = createCoordinator({ updater, states: [clean, clean, clean] });

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.disableWebInstaller, true);
  assert.equal(updater.allowDowngrade, false);
  assert.deepEqual(await coordinator.prepare(), {
    status: 'READY',
    version: '0.2.0',
    direction: 'UPGRADE',
  });
  assert.deepEqual(await coordinator.install(), { status: 'INSTALLING' });
  assert.deepEqual(updater.calls, { check: 1, download: 1, install: 1 });
});

test('does not download when the outbox is pending', async () => {
  const updater = createUpdater();
  const coordinator = createCoordinator({
    updater,
    states: [{ offlineSchemaVersion: 4, pendingOperations: 2 }],
  });

  assert.deepEqual(await coordinator.prepare(), { status: 'BLOCKED', reason: 'PENDING_OUTBOX' });
  assert.equal(updater.calls.download, 0);
});

test('does not install when an operation appears during download', async () => {
  const updater = createUpdater();
  const coordinator = createCoordinator({
    updater,
    states: [clean, { offlineSchemaVersion: 4, pendingOperations: 1 }],
  });

  assert.deepEqual(await coordinator.prepare(), { status: 'BLOCKED', reason: 'PENDING_OUTBOX' });
  assert.deepEqual(await coordinator.install(), { status: 'BLOCKED', reason: 'UPDATE_NOT_PREPARED' });
  assert.equal(updater.calls.install, 0);
});

test('does not install when the local schema changes after preparation', async () => {
  const updater = createUpdater();
  const coordinator = createCoordinator({
    updater,
    states: [clean, clean, { offlineSchemaVersion: 5, pendingOperations: 0 }],
  });

  assert.equal((await coordinator.prepare()).status, 'READY');
  assert.deepEqual(await coordinator.install(), { status: 'BLOCKED', reason: 'LOCAL_SCHEMA_CHANGED' });
  assert.equal(updater.calls.install, 0);
});

test('rejects an invalid publisher signature and never installs it', async () => {
  const updater = createUpdater({ downloadError: new Error('Authenticode publisher signature mismatch') });
  const coordinator = createCoordinator({ updater, states: [clean] });

  assert.deepEqual(await coordinator.prepare(), { status: 'REJECTED', reason: 'INVALID_SIGNATURE' });
  assert.deepEqual(await coordinator.install(), { status: 'BLOCKED', reason: 'UPDATE_NOT_PREPARED' });
  assert.equal(updater.calls.install, 0);
});

test('allows a controlled downgrade only when rollback is explicit', async () => {
  const updater = createUpdater({ version: '0.0.9' });
  const coordinator = createCoordinator({ updater, states: [clean, clean], explicitRollback: true });
  assert.deepEqual(await coordinator.prepare(), {
    status: 'READY',
    version: '0.0.9',
    direction: 'ROLLBACK',
  });
  assert.equal(updater.allowDowngrade, true);
});
