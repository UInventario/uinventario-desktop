import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { join } from 'node:path';
import { clearOriginAccess, SESSION_CLOSED_CHANNEL } from './access-cleanup.mjs';
import { readOfflineUpdateState } from './offline-update-state.mjs';
import { isAllowedNavigation } from './navigation-policy.mjs';
import { desktopPartition, loadRuntimeConfig, resolveEnvironment } from './runtime-config.mjs';
import { DesktopUpdateCoordinator } from './update-coordinator.mjs';
import { resolveUpdateOptions } from './update-policy.mjs';

const offlineSmokeTest = process.argv.includes('--offline-smoke');
const accessCleanupSmokeTest = process.argv.includes('--access-cleanup-smoke');
const smokeTest = process.argv.includes('--smoke-test') || offlineSmokeTest || accessCleanupSmokeTest;
let mainWindow;
let smokeSettled = false;
let allowedOrigin;
let offlineSmokePhase = offlineSmokeTest ? 'PRIME' : 'DISABLED';

const UPDATE_MESSAGES = {
  CURRENT_VERSION: 'Ya tienes la versión disponible en este canal.',
  INVALID_CHECKSUM: 'El instalador descargado no coincide con su hash publicado y fue rechazado.',
  INVALID_SIGNATURE: 'La firma del instalador no corresponde al editor esperado y fue rechazada.',
  INVALID_VERSION: 'El canal publicó una versión inválida.',
  LOCAL_SCHEMA_CHANGED: 'El esquema local cambió durante la descarga. Reinicia y vuelve a intentarlo.',
  LOCAL_STATE_UNAVAILABLE: 'No fue posible verificar el estado local. La actualización no se instalará.',
  PENDING_OUTBOX: 'Sincroniza las operaciones pendientes antes de actualizar.',
  ROLLBACK_NOT_EXPLICIT: 'Un downgrade requiere el canal y la opción explícita de rollback.',
  UNSUPPORTED_LOCAL_SCHEMA: 'Esta versión no puede validar el esquema local actual.',
  UPDATE_FAILED: 'No fue posible comprobar o descargar la actualización.',
  UPDATE_NOT_PREPARED: 'La actualización aún no está preparada.',
};

function failSmoke(message) {
  if (smokeSettled) return;
  smokeSettled = true;
  console.error(message);
  app.exit(1);
}

async function waitForRenderedShell(webContents) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const rendered = await webContents.executeJavaScript(
      "Boolean(document.querySelector('app-root')?.textContent?.trim())",
      true,
    );
    if (rendered) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}

async function waitForServiceWorker(webContents) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const ready = await webContents.executeJavaScript(
      '(async () => Boolean(navigator.serviceWorker?.controller) || Boolean(await Promise.race([navigator.serviceWorker?.ready?.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 500))])))()',
      true,
    );
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}

async function waitForNetworkAvailability(webContents, origin, expectedAvailable) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const healthUrl = `${origin}/health?ngsw-bypass=true&desktop-smoke=${Date.now()}`;
    const available = await webContents.executeJavaScript(
      `fetch(${JSON.stringify(healthUrl)}, { cache: 'no-store' }).then((response) => response.ok).catch(() => false)`,
      true,
    );
    if (available === expectedAvailable) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

async function emulateRendererOffline(webContents, offline) {
  if (!webContents.debugger.isAttached()) {
    webContents.debugger.attach('1.3');
    await webContents.debugger.sendCommand('Network.enable');
  }

  await webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: offline ? 'none' : 'wifi',
  });
}

async function verifyAccessCleanup(webContents, origin) {
  const cookieName = 'uinventario_desktop_smoke';
  await webContents.session.cookies.set({
    url: origin,
    name: cookieName,
    value: 'remove-me',
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  });
  await webContents.executeJavaScript("window.dispatchEvent(new Event('uinventario:session-closed'))", true);

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const remaining = await webContents.session.cookies.get({ url: origin, name: cookieName });
    if (!remaining.length) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function configureApplicationMenu(config) {
  if (smokeTest || !app.isPackaged) {
    Menu.setApplicationMenu(null);
    return;
  }

  const updaterModule = await import('electron-updater');
  const updater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;
  if (!updater) throw new Error('No fue posible iniciar el actualizador Desktop.');

  const updateOptions = resolveUpdateOptions({
    environment: config.environment,
    configuredChannel: config.updateChannel,
    argv: process.argv,
  });
  const coordinator = new DesktopUpdateCoordinator({
    updater,
    getLocalState: () => readOfflineUpdateState(mainWindow.webContents),
    currentVersion: app.getVersion(),
    ...updateOptions,
  });
  let checking = false;

  const checkForUpdates = async () => {
    if (checking) return;
    checking = true;
    try {
      const result = await coordinator.prepare();
      if (result.status === 'NO_UPDATE') {
        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Actualizaciones',
          message: 'UInventario está actualizado.',
        });
        return;
      }
      if (result.status !== 'READY') {
        await dialog.showMessageBox(mainWindow, {
          type: result.status === 'REJECTED' ? 'error' : 'warning',
          title: 'Actualización detenida',
          message: UPDATE_MESSAGES[result.reason] ?? UPDATE_MESSAGES.UPDATE_FAILED,
        });
        return;
      }

      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Actualización verificada',
        message: `UInventario ${result.version} está listo para instalar.`,
        detail:
          result.direction === 'ROLLBACK'
            ? 'Se aplicará el rollback explícito al reiniciar.'
            : 'El instalador pasó la verificación de integridad y firma configurada para este canal.',
        buttons: ['Instalar y reiniciar', 'Después'],
        defaultId: 0,
        cancelId: 1,
      });
      if (confirmation.response !== 0) return;

      const installation = await coordinator.install();
      if (installation.status !== 'INSTALLING') {
        await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Actualización detenida',
          message: UPDATE_MESSAGES[installation.reason] ?? UPDATE_MESSAGES.UPDATE_FAILED,
        });
      }
    } finally {
      checking = false;
    }
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'UInventario',
        submenu: [
          { label: `Buscar actualizaciones (${updateOptions.channel})`, click: checkForUpdates },
          { type: 'separator' },
          { role: 'quit', label: 'Salir' },
        ],
      },
    ]),
  );
}

ipcMain.on(SESSION_CLOSED_CHANNEL, (event) => {
  if (!allowedOrigin || !isAllowedNavigation(event.sender.getURL(), allowedOrigin)) return;
  void clearOriginAccess(event.sender.session, allowedOrigin).catch((error) => {
    console.error(error instanceof Error ? error.message : 'No fue posible limpiar el acceso Desktop.');
  });
});

async function createMainWindow() {
  const environment = resolveEnvironment({
    argv: process.argv,
    env: process.env,
    isPackaged: app.isPackaged,
  });
  const config = await loadRuntimeConfig(app.getAppPath(), environment);
  allowedOrigin = config.webUrl;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: !smokeTest,
    backgroundColor: '#f4f7fb',
    title: `UInventario · ${environment === 'prod' ? 'Producción' : 'Dev'}`,
    webPreferences: {
      partition: desktopPartition(environment),
      preload: join(app.getAppPath(), 'src', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  const guardNavigation = (event, target) => {
    if (!isAllowedNavigation(target, config.webUrl)) {
      event.preventDefault();
    }
  };

  mainWindow.webContents.on('will-navigate', guardNavigation);
  mainWindow.webContents.on('will-redirect', guardNavigation);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const smokeTimeout = smokeTest
    ? setTimeout(() => failSmoke('Desktop smoke agotó el tiempo de carga.'), offlineSmokeTest ? 60_000 : 30_000)
    : undefined;

  mainWindow.webContents.on('did-finish-load', async () => {
    if (!smokeTest || !isAllowedNavigation(mainWindow.webContents.getURL(), config.webUrl)) {
      return;
    }

    try {
      if (!(await waitForRenderedShell(mainWindow.webContents))) {
        failSmoke('Desktop smoke recibió la página, pero Angular no renderizó el shell.');
        return;
      }

      if (offlineSmokePhase === 'PRIME') {
        if (!(await waitForServiceWorker(mainWindow.webContents))) {
          failSmoke('Desktop smoke no pudo preparar el Service Worker.');
          return;
        }
        offlineSmokePhase = 'ACTIVATE';
        mainWindow.reload();
        return;
      }

      if (offlineSmokePhase === 'ACTIVATE') {
        const controlled = await mainWindow.webContents.executeJavaScript(
          'Boolean(navigator.serviceWorker?.controller)',
          true,
        );
        if (!controlled) {
          failSmoke('Desktop smoke no quedó controlado por el Service Worker.');
          return;
        }
        offlineSmokePhase = 'OFFLINE';
        await emulateRendererOffline(mainWindow.webContents, true);
        await mainWindow.webContents.session.closeAllConnections();
        await mainWindow.loadURL(`${config.webUrl}/app`);
        return;
      }

      if (offlineSmokePhase === 'OFFLINE') {
        if (!(await waitForNetworkAvailability(mainWindow.webContents, config.webUrl, false))) {
          failSmoke('Desktop smoke no confirmó el corte real de red del renderer.');
          return;
        }
        offlineSmokePhase = 'RECONNECT';
        await emulateRendererOffline(mainWindow.webContents, false);
        await mainWindow.loadURL(config.webUrl);
        return;
      }

      if (offlineSmokePhase === 'RECONNECT') {
        if (!(await waitForNetworkAvailability(mainWindow.webContents, config.webUrl, true))) {
          failSmoke('Desktop smoke no recuperó una petición real tras reconectar.');
          return;
        }
      }

      if (accessCleanupSmokeTest && !(await verifyAccessCleanup(mainWindow.webContents, config.webUrl))) {
        failSmoke('Desktop smoke no eliminó la cookie de acceso al cerrar sesión.');
        return;
      }

      if (smokeSettled) return;
      smokeSettled = true;
      clearTimeout(smokeTimeout);
      if (mainWindow.webContents.debugger.isAttached()) {
        mainWindow.webContents.debugger.detach();
      }
      console.log(`Desktop smoke OK: ${environment} ${config.webUrl}`);
      app.quit();
    } catch (error) {
      clearTimeout(smokeTimeout);
      failSmoke(error instanceof Error ? error.message : 'Desktop smoke no pudo verificar el shell.');
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, target, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isAllowedNavigation(target, config.webUrl)) {
      return;
    }

    if (smokeTest) {
      clearTimeout(smokeTimeout);
      failSmoke(`Desktop smoke no pudo cargar ${config.webUrl}: ${description} (${code}).`);
      return;
    }

    void mainWindow.loadFile(join(app.getAppPath(), 'src', 'unavailable.html'), {
      query: { environment },
    });
  });

  try {
    await mainWindow.loadURL(config.webUrl);
  } catch (error) {
    if (smokeTest) {
      clearTimeout(smokeTimeout);
      failSmoke(error instanceof Error ? error.message : 'Desktop smoke falló.');
    }
  }

  return config;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(async () => {
      const config = await createMainWindow();
      await configureApplicationMenu(config);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
      });
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Desktop no pudo iniciar.');
      process.exitCode = 1;
      app.quit();
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
