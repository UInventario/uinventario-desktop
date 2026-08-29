import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { PERIPHERAL_SCAN_CHANNEL } from './peripheral-ipc.mjs';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function receiptHtml(receipt) {
  const lines = receipt.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.name)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.total)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font: 12px ui-monospace, monospace; color: #111; margin: 0; }
    h1, p { text-align: center; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 3px 0; vertical-align: top; }
    td:nth-child(2), td:nth-child(3) { text-align: right; }
    footer { border-top: 1px dashed #111; margin-top: 8px; padding-top: 6px; text-align: right; font-weight: 700; }
  </style></head><body><h1>${escapeHtml(receipt.merchantName)}</h1><p>${escapeHtml(receipt.receiptNumber)}</p>
  <table><tbody>${lines}</tbody></table><footer>${escapeHtml(receipt.currency)} ${escapeHtml(receipt.total)}</footer></body></html>`;
}

export function createPeripheralAdapters({ appPath, getMainWindow }) {
  let displayWindow;

  return {
    async listPrinters() {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return [];
      const printers = await mainWindow.webContents.getPrintersAsync();
      return printers.slice(0, 100).map(({ name, displayName, status, isDefault }) => ({
        name,
        displayName,
        status,
        isDefault,
      }));
    },

    async emitScan(code) {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('MAIN_WINDOW_UNAVAILABLE');
      mainWindow.webContents.send(PERIPHERAL_SCAN_CHANNEL, code);
    },

    async print(receipt, printerName) {
      const printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(receipt))}`);
        await new Promise((resolve, reject) => {
          printWindow.webContents.print(
            { silent: true, printBackground: true, deviceName: printerName },
            (success, failureReason) => (success ? resolve() : reject(new Error(failureReason || 'PRINT_FAILED'))),
          );
        });
      } finally {
        if (!printWindow.isDestroyed()) printWindow.destroy();
      }
    },

    async updateDisplay(state) {
      if (!displayWindow || displayWindow.isDestroyed()) {
        const mainWindow = getMainWindow();
        const mainBounds = mainWindow?.getBounds();
        const target =
          screen
            .getAllDisplays()
            .find(({ bounds }) => !mainBounds || bounds.x !== mainBounds.x || bounds.y !== mainBounds.y) ??
          screen.getPrimaryDisplay();
        displayWindow = new BrowserWindow({
          x: target.workArea.x,
          y: target.workArea.y,
          width: Math.min(960, target.workArea.width),
          height: Math.min(640, target.workArea.height),
          show: false,
          title: 'UInventario · Pantalla cliente',
          autoHideMenuBar: true,
          webPreferences: {
            preload: join(appPath, 'src', 'customer-display-preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        await displayWindow.loadFile(join(appPath, 'src', 'customer-display.html'));
        displayWindow.on('closed', () => {
          displayWindow = undefined;
        });
        displayWindow.show();
      }
      displayWindow.webContents.send('uinventario:customer-display:update', state);
    },

    async recordSimulation() {
      // El simulador confirma sólo la operación; no persiste tickets ni datos del cliente.
    },

    clearDisplay() {
      if (displayWindow && !displayWindow.isDestroyed()) displayWindow.destroy();
      displayWindow = undefined;
    },
  };
}
