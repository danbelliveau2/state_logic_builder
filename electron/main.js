/**
 * Electron main process for SDC State Logic Builder
 * Starts the embedded server.js then opens a BrowserWindow.
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 3131;
let mainWindow;
let serverProcess;

function waitForServer(retries = 30, delay = 200) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const req = http.get(`http://localhost:${PORT}/api/projects`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (n <= 0) return reject(new Error('Server did not start in time'));
        setTimeout(() => attempt(n - 1), delay);
      });
      req.setTimeout(500, () => { req.destroy(); });
    }
    attempt(retries);
  });
}

app.whenReady().then(async () => {
  const isPackaged = app.isPackaged;

  // Paths differ between dev and packaged
  const serverScript = isPackaged
    ? path.join(process.resourcesPath, 'server.js')
    : path.join(__dirname, '..', 'server.js');

  const distDir = isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(__dirname, '..', 'dist');

  // Store projects in user data so they persist across updates
  const dataDir = path.join(app.getPath('userData'), 'projects');
  fs.mkdirSync(dataDir, { recursive: true });

  // Start embedded server
  serverProcess = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      DIST_DIR: distDir,
    },
    stdio: 'pipe',
  });

  serverProcess.stdout?.on('data', d => process.stdout.write('[server] ' + d));
  serverProcess.stderr?.on('data', d => process.stderr.write('[server] ' + d));

  serverProcess.on('exit', (code) => {
    console.log('[server] exited with code', code);
  });

  // Wait for the server HTTP endpoint to respond
  try {
    await waitForServer();
  } catch (err) {
    console.error('WARNING: Server health check timed out. Loading anyway.', err.message);
  }

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 650,
    title: 'SDC State Logic Builder',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#1a1f2e',
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Show once page is ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
  }
});
