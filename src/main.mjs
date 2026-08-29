import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { join } from 'node:path';
import { clearOriginAccess, SESSION_CLOSED_CHANNEL } from './access-cleanup.mjs';
import { isAllowedNavigation } from './navigation-policy.mjs';
import { desktopPartition, loadRuntimeConfig, resolveEnvironment } from './runtime-config.mjs';

const offlineSmokeTest = process.argv.includes('--offline-smoke');
const accessCleanupSmokeTest = process.argv.includes('--access-cleanup-smoke');
const smokeTest = process.argv.includes('--smoke-test') || offlineSmokeTest || accessCleanupSmokeTest;
let mainWindow;
let smokeSettled = false;
let allowedOrigin;
let offlineSmokePhase = offlineSmokeTest ? 'PRIME' : 'DISABLED';

function failSmoke(message) {
  if (smokeSettled) return;
  smokeSettled = true;
  console.error(message);
  process.exitCode = 1;
  app.quit();
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
        mainWindow.webContents.session.enableNetworkEmulation({ offline: true });
        await mainWindow.webContents.session.closeAllConnections();
        await mainWindow.loadURL(`${config.webUrl}/app`);
        return;
      }

      if (offlineSmokePhase === 'OFFLINE') {
        const offline = await mainWindow.webContents.executeJavaScript('navigator.onLine === false', true);
        if (!offline) {
          failSmoke('Desktop smoke no confirmó el estado offline del renderer.');
          return;
        }
        offlineSmokePhase = 'RECONNECT';
        mainWindow.webContents.session.disableNetworkEmulation();
        await mainWindow.loadURL(config.webUrl);
        return;
      }

      if (offlineSmokePhase === 'RECONNECT') {
        const online = await mainWindow.webContents.executeJavaScript('navigator.onLine === true', true);
        if (!online) {
          failSmoke('Desktop smoke no recuperó la conexión del renderer.');
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
      Menu.setApplicationMenu(null);
      await createMainWindow();

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
