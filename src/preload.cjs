const { contextBridge, ipcRenderer } = require('electron');

const PERIPHERAL_CHANNEL = 'uinventario:peripherals:v1';
const PERIPHERAL_SCAN_CHANNEL = 'uinventario:peripheral-scan:v1';

window.addEventListener('uinventario:session-closed', () => {
  ipcRenderer.send('uinventario:session-closed');
});

contextBridge.exposeInMainWorld(
  'uinventarioDesktop',
  Object.freeze({
    version: 1,
    getPeripheralConfig: (context) => ipcRenderer.invoke(PERIPHERAL_CHANNEL, { action: 'GET_CONFIG', context }),
    savePeripheralConfig: (context, config) =>
      ipcRenderer.invoke(PERIPHERAL_CHANNEL, { action: 'SAVE_CONFIG', context, config }),
    listPrinters: (context) => ipcRenderer.invoke(PERIPHERAL_CHANNEL, { action: 'LIST_PRINTERS', context }),
    diagnose: (context, capability, sample) =>
      ipcRenderer.invoke(PERIPHERAL_CHANNEL, { action: 'DIAGNOSE', context, capability, sample }),
    printReceipt: (context, operationId, receipt) =>
      ipcRenderer.invoke(PERIPHERAL_CHANNEL, {
        action: 'PRINT_RECEIPT',
        context,
        operationId,
        receipt,
      }),
    openDrawer: (context, operationId, trigger) =>
      ipcRenderer.invoke(PERIPHERAL_CHANNEL, {
        action: 'OPEN_DRAWER',
        context,
        operationId,
        trigger,
      }),
    updateDisplay: (context, display) =>
      ipcRenderer.invoke(PERIPHERAL_CHANNEL, { action: 'DISPLAY', context, display }),
    onScan(handler) {
      if (typeof handler !== 'function') return () => undefined;
      const listener = (_event, code) => handler(code);
      ipcRenderer.on(PERIPHERAL_SCAN_CHANNEL, listener);
      return () => ipcRenderer.removeListener(PERIPHERAL_SCAN_CHANNEL, listener);
    },
  }),
);
