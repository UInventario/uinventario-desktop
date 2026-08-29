const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRINTER_ADAPTERS = new Set(['SIMULATOR', 'SYSTEM']);
const DISPLAY_ADAPTERS = new Set(['SIMULATOR', 'WINDOW']);
const DIAGNOSTICS = new Set(['SCANNER', 'PRINTER', 'DRAWER', 'DISPLAY']);

function requiredIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} no es válido.`);
  }
  return value;
}

function optionalText(value, field, maxLength) {
  if (value === null || value === undefined || value === '') return null;
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    [...value].some((character) => character.charCodeAt(0) <= 31)
  ) {
    throw new Error(`${field} no es válido.`);
  }
  return value;
}

export const DEFAULT_PERIPHERAL_CONFIG = Object.freeze({
  scannerAdapter: 'HID_KEYBOARD',
  printerAdapter: 'SIMULATOR',
  printerName: null,
  drawerAdapter: 'SIMULATOR',
  displayAdapter: 'SIMULATOR',
  simulateDisconnected: false,
});

export function validatePeripheralContext(value) {
  if (!value || typeof value !== 'object') throw new Error('Falta el contexto del periférico.');
  return Object.freeze({
    tenantId: requiredIdentifier(value.tenantId, 'tenantId'),
    cashRegisterId: requiredIdentifier(value.cashRegisterId, 'cashRegisterId'),
    deviceId: requiredIdentifier(value.deviceId, 'deviceId'),
  });
}

export function peripheralContextKey(context) {
  const value = validatePeripheralContext(context);
  return `${value.tenantId}:${value.cashRegisterId}:${value.deviceId}`;
}

export function validatePeripheralConfig(value) {
  if (!value || typeof value !== 'object') throw new Error('Falta la configuración del periférico.');
  if (value.scannerAdapter !== 'HID_KEYBOARD') throw new Error('El lector debe usar HID_KEYBOARD.');
  if (!PRINTER_ADAPTERS.has(value.printerAdapter)) throw new Error('Adaptador de impresora inválido.');
  if (value.drawerAdapter !== 'SIMULATOR') throw new Error('Adaptador de cajón inválido.');
  if (!DISPLAY_ADAPTERS.has(value.displayAdapter)) throw new Error('Adaptador de pantalla inválido.');
  if (typeof value.simulateDisconnected !== 'boolean') throw new Error('Estado de simulación inválido.');
  const printerName = optionalText(value.printerName, 'printerName', 200);
  if (value.printerAdapter === 'SYSTEM' && !printerName) {
    throw new Error('Selecciona una impresora del sistema.');
  }
  return Object.freeze({
    scannerAdapter: 'HID_KEYBOARD',
    printerAdapter: value.printerAdapter,
    printerName,
    drawerAdapter: 'SIMULATOR',
    displayAdapter: value.displayAdapter,
    simulateDisconnected: value.simulateDisconnected,
  });
}

export function validatePeripheralRequest(value) {
  if (!value || typeof value !== 'object') throw new Error('Solicitud de periférico inválida.');
  const context = validatePeripheralContext(value.context);
  const action = value.action;
  if (
    !['GET_CONFIG', 'SAVE_CONFIG', 'LIST_PRINTERS', 'DIAGNOSE', 'PRINT_RECEIPT', 'OPEN_DRAWER', 'DISPLAY'].includes(
      action,
    )
  ) {
    throw new Error('Acción de periférico inválida.');
  }

  if (action === 'SAVE_CONFIG') return { action, context, config: validatePeripheralConfig(value.config) };
  if (action === 'DIAGNOSE') {
    if (!DIAGNOSTICS.has(value.capability)) throw new Error('Diagnóstico inválido.');
    return {
      action,
      context,
      capability: value.capability,
      sample: optionalText(value.sample, 'sample', 120),
    };
  }
  if (action === 'PRINT_RECEIPT') {
    return {
      action,
      context,
      operationId: requiredIdentifier(value.operationId, 'operationId'),
      receipt: validateReceipt(value.receipt),
    };
  }
  if (action === 'OPEN_DRAWER') {
    return {
      action,
      context,
      operationId: requiredIdentifier(value.operationId, 'operationId'),
      trigger: value.trigger === 'CASH_SALE_COMPLETED' ? value.trigger : 'MANUAL',
    };
  }
  if (action === 'DISPLAY') return { action, context, display: validateDisplay(value.display) };
  return { action, context };
}

function validateReceipt(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.lines) || value.lines.length > 250) {
    throw new Error('Ticket inválido.');
  }
  return {
    receiptNumber: optionalText(value.receiptNumber, 'receiptNumber', 80) ?? 'SIN-FOLIO',
    merchantName: optionalText(value.merchantName, 'merchantName', 160) ?? 'UInventario',
    currency: optionalText(value.currency, 'currency', 8) ?? '',
    total: optionalText(value.total, 'total', 40) ?? '',
    lines: value.lines.map((line) => ({
      name: optionalText(line?.name, 'line.name', 160) ?? 'Producto',
      quantity: optionalText(line?.quantity, 'line.quantity', 40) ?? '',
      total: optionalText(line?.total, 'line.total', 40) ?? '',
    })),
  };
}

function validateDisplay(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.lines) || value.lines.length > 100) {
    throw new Error('Estado de pantalla inválido.');
  }
  return {
    currency: optionalText(value.currency, 'currency', 8) ?? '',
    total: optionalText(value.total, 'total', 40) ?? '0.00',
    message: optionalText(value.message, 'message', 160) ?? 'Bienvenido',
    lines: value.lines.map((line) => ({
      name: optionalText(line?.name, 'line.name', 120) ?? 'Producto',
      quantity: optionalText(line?.quantity, 'line.quantity', 40) ?? '',
      total: optionalText(line?.total, 'line.total', 40) ?? '',
    })),
  };
}
