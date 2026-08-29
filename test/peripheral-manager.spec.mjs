import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_PERIPHERAL_CONFIG, validatePeripheralRequest } from '../src/peripheral-contract.mjs';
import { PeripheralManager } from '../src/peripheral-manager.mjs';
import { PeripheralStore } from '../src/peripheral-store.mjs';

const context = { tenantId: 'tenant-1', cashRegisterId: 'cash-1', deviceId: 'device-1' };

async function createHarness(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'uinventario-peripherals-'));
  const calls = { print: 0, drawer: 0, display: 0, scans: [] };
  const adapters = {
    listPrinters: async () => [{ name: 'printer-1', displayName: 'Printer 1', status: 0, isDefault: true }],
    emitScan: async (code) => calls.scans.push(code),
    print: async () => {
      calls.print += 1;
      if (overrides.print) await overrides.print(calls.print);
    },
    updateDisplay: async () => {
      calls.display += 1;
    },
    recordSimulation: async (capability) => {
      if (capability === 'DRAWER') calls.drawer += 1;
    },
  };
  const store = new PeripheralStore(join(root, 'peripherals.json'));
  return { calls, store, manager: new PeripheralManager({ store, adapters }) };
}

test('persists profiles independently per tenant, cash register and device', async () => {
  const { store } = await createHarness();
  const configured = { ...DEFAULT_PERIPHERAL_CONFIG, displayAdapter: 'WINDOW' };
  await store.saveConfig(context, configured);
  await store.saveConfig({ ...context, deviceId: 'device-2' }, DEFAULT_PERIPHERAL_CONFIG);

  assert.deepEqual(await store.getConfig(context), configured);
  assert.deepEqual(await store.getConfig({ ...context, tenantId: 'tenant-2' }), DEFAULT_PERIPHERAL_CONFIG);
  assert.deepEqual(await new PeripheralStore(store.filePath).getConfig(context), configured);
  assert.deepEqual(
    await new PeripheralStore(store.filePath).getConfig({ ...context, deviceId: 'device-2' }),
    DEFAULT_PERIPHERAL_CONFIG,
  );
});

test('rejects unknown actions, unsafe identifiers and a system printer without device name', () => {
  assert.throws(() => validatePeripheralRequest({ action: 'EXEC', context }));
  assert.throws(() =>
    validatePeripheralRequest({ action: 'GET_CONFIG', context: { ...context, tenantId: '../tenant' } }),
  );
  assert.throws(() =>
    validatePeripheralRequest({
      action: 'SAVE_CONFIG',
      context,
      config: { ...DEFAULT_PERIPHERAL_CONFIG, printerAdapter: 'SYSTEM' },
    }),
  );
});

test('runs controlled diagnostics without a sale and reports simulated disconnection', async () => {
  const { manager, calls } = await createHarness();
  assert.deepEqual(await manager.handle({ action: 'DIAGNOSE', context, capability: 'SCANNER', sample: '7501' }), {
    status: 'COMPLETED',
    adapter: 'HID_KEYBOARD',
  });
  assert.deepEqual(calls.scans, ['7501']);

  await manager.handle({
    action: 'SAVE_CONFIG',
    context,
    config: { ...DEFAULT_PERIPHERAL_CONFIG, simulateDisconnected: true },
  });
  assert.equal(
    (await manager.handle({ action: 'DIAGNOSE', context, capability: 'DRAWER' })).errorCode,
    'DEVICE_DISCONNECTED',
  );
  assert.equal((await manager.handle({ action: 'DIAGNOSE', context, capability: 'DRAWER' })).adapter, 'SIMULATOR');
});

test('executes a confirmed operation once and replays it without touching the device', async () => {
  const { manager, calls } = await createHarness();
  const request = { action: 'OPEN_DRAWER', context, operationId: 'operation-1', trigger: 'MANUAL' };

  assert.equal((await manager.handle(request)).replayed, false);
  assert.equal((await manager.handle(request)).replayed, true);
  assert.equal(calls.drawer, 1);
});

test('serializes concurrent retries and keeps operation ids idempotent across contexts', async () => {
  const { manager, calls } = await createHarness();
  const request = { action: 'OPEN_DRAWER', context, operationId: 'operation-concurrent', trigger: 'MANUAL' };

  const [first, second] = await Promise.all([
    manager.handle(request),
    manager.handle({ ...request, context: { ...context, tenantId: 'tenant-2' } }),
  ]);

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(calls.drawer, 1);
});

test('does not mark a failed printer operation and permits a controlled retry', async () => {
  const { manager, calls } = await createHarness({
    print: async (attempt) => {
      if (attempt === 1) throw new Error('DISCONNECTED');
    },
  });
  await manager.handle({
    action: 'SAVE_CONFIG',
    context,
    config: { ...DEFAULT_PERIPHERAL_CONFIG, printerAdapter: 'SYSTEM', printerName: 'printer-1' },
  });
  const request = {
    action: 'PRINT_RECEIPT',
    context,
    operationId: 'operation-2',
    receipt: {
      receiptNumber: 'V-1',
      merchantName: 'Demo',
      currency: 'MXN',
      total: '10.00',
      lines: [{ name: 'Producto', quantity: '1', total: '10.00' }],
    },
  };

  assert.equal((await manager.handle(request)).status, 'FAILED');
  assert.equal((await manager.handle(request)).status, 'COMPLETED');
  assert.equal(calls.print, 2);
});
