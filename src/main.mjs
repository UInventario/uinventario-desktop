import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';
import { isAllowedNavigation } from './navigation-policy.mjs';
import { loadRuntimeConfig, resolveEnvironment } from './runtime-config.mjs';

const smokeTest = process.argv.includes('--smoke-test');
let mainWindow;
let smokeSettled = false;

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

async function createMainWindow() {
  const environment = resolveEnvironment({
    argv: process.argv,
    env: process.env,
    isPackaged: app.isPackaged,
  });
  const config = await loadRuntimeConfig(app.getAppPath(), environment);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: !smokeTest,
    backgroundColor: '#f4f7fb',
    title: `UInventario · ${environment === 'prod' ? 'Producción' : 'Dev'}`,
    webPreferences: {
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
    ? setTimeout(() => failSmoke('Desktop smoke agotó el tiempo de carga.'), 30_000)
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
