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

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendStatus(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', msg);
  }
}

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => sendStatus('checking'));

  autoUpdater.on('update-available', (info) => {
    sendStatus('downloading');
    console.log(`[updater] Update ${info.version} found — downloading silently`);
  });

  autoUpdater.on('update-not-available', () => sendStatus('up-to-date'));

  autoUpdater.on('update-downloaded', (info) => {
    // Send countdown status to sidebar so user sees what's happening
    sendStatus('restarting');
    console.log(`[updater] Update ${info.version} ready — restarting in 5 seconds`);

    // Give user 5 seconds to see the notification, then restart automatically
    setTimeout(() => {
      // isSilent=true (no UAC prompt for per-user install)
      // isForceRunAfter=true (relaunch app after install)
      autoUpdater.quitAndInstall(true, true);
    }, 5000);
  });

  autoUpdater.on('error', (err) => {
    sendStatus('error');
    console.error('[updater] error:', err.message);
  });

  // Check immediately on startup, then every 2 minutes
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 1000);
}

// Manual "Check for Updates" triggered from the renderer via the button
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    sendStatus('dev-mode');
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendStatus('error');
  }
});

// ── App startup ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const isPackaged = app.isPackaged;

  const serverScript = isPackaged
    ? path.join(process.resourcesPath, 'server.js')
    : path.join(__dirname, '..', 'server.js');

  const distDir = isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(__dirname, '..', 'dist');

  const dataDir = path.join(app.getPath('userData'), 'projects');
  fs.mkdirSync(dataDir, { recursive: true });

  const { startServer } = require(serverScript);
  const server = startServer({ port: PORT, dataDir, distDir });

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const iconPath = isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', 'public', 'icon.ico');

  const preloadPath = path.join(__dirname, 'preload.js');

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
      preload: preloadPath,
    },
    backgroundColor: '#1a1f2e',
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
    if (isPackaged) setupAutoUpdater();
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  app.quit();
});
