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

// Native save-file dialog — avoids showSaveFilePicker createWritable() bug in Electron.
// Returns the chosen filePath so the renderer can cache it for direct saves next time.
ipcMain.handle('save-file', async (_, { fileName, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: fileName,
    filters: [{ name: 'JSON File', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { success: false };
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Direct overwrite — no dialog, no "replace?" prompt.
// Called on subsequent saves once the renderer has cached the file path.
ipcMain.handle('save-file-direct', async (_, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Native open-file dialog — returns file content AND the actual disk path
// so the renderer can cache it and Save can overwrite directly next time.
ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON File', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { success: false };
  try {
    const content = fs.readFileSync(filePaths[0], 'utf8');
    return { success: true, filePath: filePaths[0], content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

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

  // Standards library is TEAM-SHARED by default — points at the N:\ network
  // drive so every engineer running the app sees the same library in real
  // time. If the share is unreachable (laptop off-network, path not mapped),
  // fall back to the user's local AppData so the app still runs — it just
  // won't sync until they reconnect and restart.
  const SHARED_STANDARDS_DIR = 'N:\\AI Folder\\State Logic Diagrams\\standards';
  const LOCAL_STANDARDS_DIR  = path.join(app.getPath('userData'), 'standards');
  let standardsDir = SHARED_STANDARDS_DIR;
  try {
    fs.mkdirSync(SHARED_STANDARDS_DIR, { recursive: true });
    // Touch-test write access so we fail fast now, not on first save.
    fs.accessSync(SHARED_STANDARDS_DIR, fs.constants.W_OK);
    console.log('[standards] Using shared library at', SHARED_STANDARDS_DIR);
  } catch (err) {
    console.warn('[standards] Shared path unreachable —', err.message, '— falling back to local');
    standardsDir = LOCAL_STANDARDS_DIR;
    fs.mkdirSync(LOCAL_STANDARDS_DIR, { recursive: true });
  }

  const { startServer } = require(serverScript);
  const server = startServer({ port: PORT, dataDir, standardsDir, distDir });

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

  // ── Unsaved-changes guard (Word/Excel behaviour) ─────────────────────────
  let forceClose = false;
  mainWindow.on('close', async (e) => {
    if (forceClose) return; // already confirmed — let it close

    // Read unsaved state + project data from renderer in one call
    let state;
    try {
      state = JSON.parse(await mainWindow.webContents.executeJavaScript(`
        (() => {
          const p = window.__currentProject__;
          const cacheKey = p ? ('savePath_' + (p.id || p.name)) : null;
          return JSON.stringify({
            hasUnsaved:  window.__unsavedChanges__ || false,
            projectName: p ? (p.name || 'project') : 'project',
            savePath:    cacheKey ? localStorage.getItem(cacheKey) : null,
            projectJson: (window.__unsavedChanges__ && p) ? JSON.stringify(p) : null,
          });
        })()
      `));
    } catch (_) {
      return; // renderer not ready — allow close
    }

    if (!state.hasUnsaved) return; // nothing unsaved — close normally

    e.preventDefault(); // block close until user decides

    const { response } = await dialog.showMessageBox(mainWindow, {
      type:      'question',
      buttons:   ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId:  2,
      title:     'Unsaved Changes',
      message:   `Do you want to save changes to "${state.projectName}"?`,
      detail:    'Your changes will be lost if you close without saving.',
    });

    if (response === 2) return; // Cancel — keep app open

    if (response === 0 && state.projectJson) {
      // Save — write directly if path known, else ask once
      let savePath = state.savePath;
      if (!savePath) {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
          defaultPath: `${state.projectName}.json`,
          filters: [{ name: 'JSON File', extensions: ['json'] }],
        });
        if (canceled) return; // user cancelled save dialog — keep app open
        savePath = filePath;
      }
      try { fs.writeFileSync(savePath, state.projectJson, 'utf8'); } catch (_) {}
    }

    // "Don't Save" or save completed — close for real
    forceClose = true;
    mainWindow.close();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  app.quit();
});
