import { classifyUpdateError, evaluateUpdate } from './update-policy.mjs';

export class DesktopUpdateCoordinator {
  constructor({ updater, getLocalState, currentVersion, channel, explicitRollback }) {
    this.updater = updater;
    this.getLocalState = getLocalState;
    this.currentVersion = currentVersion;
    this.channel = channel;
    this.explicitRollback = explicitRollback;
    this.prepared = false;
    this.preparedSchemaVersion = undefined;

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.channel = channel;
    // electron-updater habilita downgrade al cambiar el canal; se restablece de forma explícita.
    updater.allowDowngrade = explicitRollback;
    updater.disableWebInstaller = true;
  }

  async prepare() {
    this.prepared = false;
    this.preparedSchemaVersion = undefined;
    try {
      const before = await this.getLocalState();
      const result = await this.updater.checkForUpdates();
      const targetVersion = result?.updateInfo?.version;
      if (!targetVersion) return { status: 'NO_UPDATE' };

      const decision = evaluateUpdate({
        currentVersion: this.currentVersion,
        targetVersion,
        pendingOperations: before.pendingOperations,
        offlineSchemaVersion: before.offlineSchemaVersion,
        explicitRollback: this.explicitRollback,
      });
      if (!decision.allowed) return { status: 'BLOCKED', reason: decision.reason };

      await this.updater.downloadUpdate();
      const after = await this.getLocalState();
      if (after.pendingOperations > 0) return { status: 'BLOCKED', reason: 'PENDING_OUTBOX' };
      if (after.offlineSchemaVersion !== before.offlineSchemaVersion) {
        return { status: 'BLOCKED', reason: 'LOCAL_SCHEMA_CHANGED' };
      }

      this.prepared = true;
      this.preparedSchemaVersion = after.offlineSchemaVersion;
      return { status: 'READY', version: targetVersion, direction: decision.direction };
    } catch (error) {
      return { status: 'REJECTED', reason: classifyUpdateError(error) };
    }
  }

  async install() {
    if (!this.prepared) return { status: 'BLOCKED', reason: 'UPDATE_NOT_PREPARED' };
    try {
      const state = await this.getLocalState();
      if (state.pendingOperations > 0) return { status: 'BLOCKED', reason: 'PENDING_OUTBOX' };
      if (state.offlineSchemaVersion !== this.preparedSchemaVersion) {
        return { status: 'BLOCKED', reason: 'LOCAL_SCHEMA_CHANGED' };
      }
      this.updater.quitAndInstall(false, true);
      return { status: 'INSTALLING' };
    } catch {
      return { status: 'BLOCKED', reason: 'LOCAL_STATE_UNAVAILABLE' };
    }
  }
}
