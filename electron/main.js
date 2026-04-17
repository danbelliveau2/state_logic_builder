/**
 * Electron main process for SDC State Logic Builder.
 *
 * Runs the HTTP server directly in this process (no child process spawn).
 * In a packaged app, process.execPath is the Electron binary — NOT Node.js —
 * so spawning it as "node server.js" never worked. Running in-process fixes that.
 */
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');

const PORT = 3131;
let mainWindow;

// ── Auto-updater configuration ──────────────────────────────────────────────

autoUpdater.autoDownload = true;       // download in background automatically
autoUpdater.autoInstallOnAppQuit = true; // install when the user closes the app

function setupAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available and downloading in the background.`,
      detail: 'The update will be installed automatically when you close the app.',
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'A new version has been downloaded.',
      detail: 'Restart the app now to apply the update, or it will install automatically on next close.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    // Silently log — don't bother the user with update errors
    console.error('[updater] error:', err.message);
  });

  // Check immediately, then every 4 hours
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

// ── App startup ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const isPackaged = app.isPackaged;

  // In packaged mode, extraResources places server.js at resources/server.js
  // and the built React app at resources/dist/
  const serverScript = isPackaged
    ? path.join(process.resourcesPath, 'server.js')
    : path.join(__dirname, '..', 'server.js');

  const distDir = isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(__dirname, '..', 'dist');

  // Store projects in user data so they survive app updates
  const dataDir = path.join(app.getPath('userData'), 'projects');
  fs.mkdirSync(dataDir, { recursive: true });

  // Start the HTTP server in-process — no spawn, no child process
  const { startServer } = require(serverScript);
  const server = startServer({ port: PORT, dataDir, distDir });

  // Wait until the server is actually listening before opening the window
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const iconPath = isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', 'public', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 650,
    title: 'SDC State Logic Builder',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#1a1f2e',
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();

    // Only check for updates in the packaged app, not during development
    if (isPackaged) setupAutoUpdater();
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  app.quit();
});
