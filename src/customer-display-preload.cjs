const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'uinventarioCustomerDisplay',
  Object.freeze({
    onUpdate(handler) {
      if (typeof handler !== 'function') return;
      ipcRenderer.on('uinventario:customer-display:update', (_event, state) => handler(state));
    },
  }),
);
