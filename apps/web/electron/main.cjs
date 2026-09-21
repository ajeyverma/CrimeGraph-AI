const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Completely disable default top menu bar (File, Edit, View, Window, Help)
Menu.setApplicationMenu(null);

try {
  fs.appendFileSync(path.join(__dirname, 'electron_debug.log'), `Started at ${new Date().toISOString()}\n`);
} catch (e) {}

let mainWindow = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function log(msg) {
  try {
    fs.appendFileSync(path.join(__dirname, 'electron_debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

function createWindow() {
  log('createWindow() called');
  try {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1080,
      minHeight: 700,
      title: 'CrimeGraph AI — Criminal Intelligence Platform',
      backgroundColor: '#0a0e1a',
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
      },
    });

    mainWindow.removeMenu();

    log(`BrowserWindow created successfully, id: ${mainWindow.id}`);

    mainWindow.webContents.on('did-start-loading', () => log('webContents: did-start-loading'));
    mainWindow.webContents.on('did-finish-load', () => log('webContents: did-finish-load'));
    mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => log(`webContents: did-fail-load: code=${code}, desc=${desc}, url=${url}`));

    mainWindow.once('ready-to-show', () => {
      log('window: ready-to-show');
      mainWindow.show();
      mainWindow.focus();
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    const distPath = path.join(__dirname, '../dist/index.html');
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';

    if (process.env.ELECTRON_LOAD_DIST === 'true') {
      log(`Loading dist directly: ${distPath}`);
      mainWindow.loadFile(distPath);
    } else if (isDev) {
      log(`Dev mode: attempting loadURL: ${devUrl}`);
      mainWindow.loadURL(devUrl).catch((err) => {
        log(`loadURL failed: ${err.message}. Falling back to dist: ${distPath}`);
        if (fs.existsSync(distPath)) {
          mainWindow.loadFile(distPath);
        }
      });
    } else {
      log(`Prod mode: loading ${distPath}`);
      mainWindow.loadFile(distPath);
    }

    mainWindow.on('closed', () => {
      log('mainWindow closed');
      mainWindow = null;
    });
  } catch (err) {
    log(`FATAL createWindow error: ${err.stack}`);
  }
}

// Window management IPC handlers
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:minimize', () => mainWindow?.minimize());
ipcMain.handle('app:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});
ipcMain.handle('app:close', () => mainWindow?.close());

app.whenReady().then(() => {
  log('app.whenReady resolved');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
