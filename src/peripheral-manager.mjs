import { validatePeripheralRequest } from './peripheral-contract.mjs';

export class PeripheralManager {
  constructor({ store, adapters }) {
    this.store = store;
    this.adapters = adapters;
    this.operationQueue = new Map();
  }

  async handle(rawRequest) {
    const request = validatePeripheralRequest(rawRequest);
    const config = await this.store.getConfig(request.context);

    if (request.action === 'GET_CONFIG') return { status: 'COMPLETED', config };
    if (request.action === 'SAVE_CONFIG') {
      return { status: 'COMPLETED', config: await this.store.saveConfig(request.context, request.config) };
    }
    if (request.action === 'LIST_PRINTERS') {
      return { status: 'COMPLETED', printers: await this.adapters.listPrinters() };
    }
    if (config.simulateDisconnected) {
      return this.failed('DEVICE_DISCONNECTED', this.adapterForRequest(request, config));
    }

    if (request.action === 'DIAGNOSE') return this.diagnose(request, config);
    if (request.action === 'DISPLAY') return this.updateDisplay(request, config);
    return this.runConfirmedOperation(request, config);
  }

  async runConfirmedOperation(request, config) {
    const previous = this.operationQueue.get(request.operationId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        if (await this.store.hasCompletedOperation(request.context, request.operationId)) {
          return { status: 'COMPLETED', adapter: this.adapterFor(request.action, config), replayed: true };
        }

        const result =
          request.action === 'PRINT_RECEIPT' ? await this.printReceipt(request, config) : await this.openDrawer(config);
        if (result.status === 'COMPLETED') {
          await this.store.markCompletedOperation(request.context, request.operationId);
        }
        return { ...result, replayed: false };
      });
    this.operationQueue.set(request.operationId, operation);
    try {
      return await operation;
    } finally {
      if (this.operationQueue.get(request.operationId) === operation) {
        this.operationQueue.delete(request.operationId);
      }
    }
  }

  async diagnose(request, config) {
    if (request.capability === 'SCANNER') {
      await this.adapters.emitScan(request.sample ?? '7500000000001');
      return { status: 'COMPLETED', adapter: config.scannerAdapter };
    }
    if (request.capability === 'PRINTER') {
      return this.printReceipt(
        {
          receipt: {
            receiptNumber: 'DIAGNOSTICO',
            merchantName: 'UInventario',
            currency: '',
            total: '',
            lines: [{ name: 'Prueba controlada sin venta', quantity: '1', total: '' }],
          },
        },
        config,
      );
    }
    if (request.capability === 'DRAWER') return this.openDrawer(config);
    return this.updateDisplay(
      { display: { currency: '', total: '0.00', message: 'Diagnóstico UInventario', lines: [] } },
      config,
    );
  }

  async printReceipt(request, config) {
    if (config.printerAdapter === 'SIMULATOR') {
      await this.adapters.recordSimulation('PRINTER', request.receipt);
      return { status: 'COMPLETED', adapter: 'SIMULATOR' };
    }
    try {
      await this.adapters.print(request.receipt, config.printerName);
      return { status: 'COMPLETED', adapter: 'SYSTEM' };
    } catch {
      return this.failed('PRINTER_UNAVAILABLE', config.printerAdapter);
    }
  }

  async openDrawer(config) {
    await this.adapters.recordSimulation('DRAWER', { pulse: true });
    return { status: 'COMPLETED', adapter: config.drawerAdapter };
  }

  async updateDisplay(request, config) {
    if (config.displayAdapter === 'SIMULATOR') {
      await this.adapters.recordSimulation('DISPLAY', request.display);
      return { status: 'COMPLETED', adapter: 'SIMULATOR' };
    }
    try {
      await this.adapters.updateDisplay(request.display);
      return { status: 'COMPLETED', adapter: 'WINDOW' };
    } catch {
      return this.failed('DISPLAY_UNAVAILABLE', config.displayAdapter);
    }
  }

  adapterFor(action, config) {
    return action === 'PRINT_RECEIPT' ? config.printerAdapter : config.drawerAdapter;
  }

  adapterForRequest(request, config) {
    if (request.action === 'DIAGNOSE') {
      return {
        SCANNER: config.scannerAdapter,
        PRINTER: config.printerAdapter,
        DRAWER: config.drawerAdapter,
        DISPLAY: config.displayAdapter,
      }[request.capability];
    }
    if (request.action === 'DISPLAY') return config.displayAdapter;
    return this.adapterFor(request.action, config);
  }

  failed(errorCode, adapter) {
    return { status: 'FAILED', errorCode, adapter };
  }
}
