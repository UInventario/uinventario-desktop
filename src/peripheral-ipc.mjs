export const PERIPHERAL_CHANNEL = 'uinventario:peripherals:v1';
export const PERIPHERAL_SCAN_CHANNEL = 'uinventario:peripheral-scan:v1';

export function registerPeripheralIpc({ ipcMain, manager, isAllowedSender }) {
  ipcMain.handle(PERIPHERAL_CHANNEL, async (event, request) => {
    if (!isAllowedSender(event.sender.getURL())) {
      return { status: 'FAILED', errorCode: 'ORIGIN_NOT_ALLOWED' };
    }
    try {
      return await manager.handle(request);
    } catch {
      return { status: 'FAILED', errorCode: 'INVALID_REQUEST' };
    }
  });
}
