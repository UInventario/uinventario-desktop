import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_PERIPHERAL_CONFIG, peripheralContextKey, validatePeripheralConfig } from './peripheral-contract.mjs';

const STORE_VERSION = 1;
const MAX_COMPLETED_OPERATIONS = 1_000;

export class PeripheralStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = undefined;
    this.loadPromise = undefined;
    this.writeQueue = Promise.resolve();
  }

  async getConfig(context) {
    const state = await this.load();
    const key = peripheralContextKey(context);
    return state.profiles.find((profile) => profile.key === key)?.config ?? DEFAULT_PERIPHERAL_CONFIG;
  }

  async saveConfig(context, config) {
    const state = await this.load();
    const key = peripheralContextKey(context);
    const validated = validatePeripheralConfig(config);
    state.profiles = state.profiles.filter((profile) => profile.key !== key);
    state.profiles.push({ key, config: validated, updatedAt: new Date().toISOString() });
    await this.persist();
    return validated;
  }

  async hasCompletedOperation(context, operationId) {
    const state = await this.load();
    peripheralContextKey(context);
    return state.completedOperations.some((operation) => operation.id === operationId);
  }

  async markCompletedOperation(context, operationId) {
    const state = await this.load();
    const key = peripheralContextKey(context);
    state.completedOperations = state.completedOperations.filter((operation) => operation.id !== operationId);
    state.completedOperations.push({ key, id: operationId, completedAt: new Date().toISOString() });
    state.completedOperations = state.completedOperations.slice(-MAX_COMPLETED_OPERATIONS);
    await this.persist();
  }

  async load() {
    if (this.state) return this.state;
    this.loadPromise ??= this.readState();
    this.state = await this.loadPromise;
    return this.state;
  }

  async readState() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (
        parsed?.version !== STORE_VERSION ||
        !Array.isArray(parsed.profiles) ||
        !Array.isArray(parsed.completedOperations)
      ) {
        throw new Error('INVALID_PERIPHERAL_STORE');
      }
      return {
        version: STORE_VERSION,
        profiles: parsed.profiles.map((profile) => {
          if (typeof profile?.key !== 'string' || profile.key.length > 386) {
            throw new Error('INVALID_PERIPHERAL_STORE');
          }
          return {
            key: profile.key,
            config: validatePeripheralConfig(profile.config),
            updatedAt: String(profile.updatedAt ?? ''),
          };
        }),
        completedOperations: parsed.completedOperations.map((operation) => {
          if (
            typeof operation?.key !== 'string' ||
            operation.key.length > 386 ||
            typeof operation.id !== 'string' ||
            operation.id.length > 128
          ) {
            throw new Error('INVALID_PERIPHERAL_STORE');
          }
          return {
            key: operation.key,
            id: operation.id,
            completedAt: String(operation.completedAt ?? ''),
          };
        }),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return { version: STORE_VERSION, profiles: [], completedOperations: [] };
    }
  }

  async persist() {
    const snapshot = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.filePath);
    });
    await this.writeQueue;
  }
}
