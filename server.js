/**
 * SDC State Logic Builder — Project Server
 * No npm dependencies needed — uses only Node.js built-ins.
 *
 * Usage:
 *   node server.js        (port 3131)
 *   PORT=8080 node server.js
 *
 * API:
 *   GET    /api/projects              list all projects
 *   GET    /api/projects/:filename    load a project
 *   POST   /api/projects/:filename    save / overwrite a project
 *   DELETE /api/projects/:filename    delete a project
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const os   = require('os');

const PORT     = Number(process.env.PORT) || 3131;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'projects');
const DIST_DIR = process.env.DIST_DIR || path.join(__dirname, 'dist');

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function safeFilename(f) {
  return /^[a-zA-Z0-9_\- .]+\.json$/.test(f) ? f : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function handleList(res) {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const list = files.map(filename => {
    try {
      const fp   = path.join(DATA_DIR, filename);
      const stat = fs.statSync(fp);
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      return {
        filename,
        name: data.name || filename.replace('.json',''),
        lastModified: stat.mtimeMs,
        smCount: Array.isArray(data.stateMachines) ? data.stateMachines.length : 0,
      };
    } catch { return { filename, name: filename, lastModified: 0, smCount: 0 }; }
  });
  sendJson(res, 200, list);
}

function handleLoad(res, filename) {
  const safe = safeFilename(filename);
  if (!safe) return sendJson(res, 400, { error: 'Invalid filename' });
  const fp = path.join(DATA_DIR, safe);
  if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Not found' });
  try { sendJson(res, 200, JSON.parse(fs.readFileSync(fp, 'utf8'))); }
  catch (e) { sendJson(res, 500, { error: e.message }); }
}

async function handleSave(req, res, filename) {
  const safe = safeFilename(filename);
  if (!safe) return sendJson(res, 400, { error: 'Invalid filename' });
  try {
    const body = await readBody(req);
    JSON.parse(body); // validate JSON

    const filePath = path.join(DATA_DIR, safe);

    // Auto-backup: keep last 5 versions before overwriting
    if (fs.existsSync(filePath)) {
      const backupDir = path.join(DATA_DIR, '_backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = safe.replace('.json', `__${ts}.json`);
      fs.copyFileSync(filePath, path.join(backupDir, backupName));

      // Prune old backups — keep only last 5 per project
      const prefix = safe.replace('.json', '__');
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(prefix))
        .sort()
        .reverse();
      for (const old of backups.slice(5)) {
        fs.unlinkSync(path.join(backupDir, old));
      }
    }

    fs.writeFileSync(filePath, body, 'utf8');
    sendJson(res, 200, { ok: true, filename: safe });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
}

function handleDelete(res, filename) {
  const safe = safeFilename(filename);
  if (!safe) return sendJson(res, 400, { error: 'Invalid filename' });
  const fp = path.join(DATA_DIR, safe);
  if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Not found' });
  try { fs.unlinkSync(fp); sendJson(res, 200, { ok: true }); }
  catch (e) { sendJson(res, 500, { error: e.message }); }
}

function serveStatic(res, reqPath) {
  let fp = path.join(DIST_DIR, reqPath === '/' ? 'index.html' : reqPath);
  if (!path.extname(fp) || !fs.existsSync(fp)) fp = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
}

const server = http.createServer(async (req, res) => {
  const { pathname = '/' } = url.parse(req.url || '/');
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (pathname.startsWith('/api/projects')) {
    const rest     = pathname.slice('/api/projects'.length);
    const filename = rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : null;
    if (!filename && method === 'GET')    return handleList(res);
    if (filename  && method === 'GET')    return handleLoad(res, filename);
    if (filename  && method === 'POST')   return handleSave(req, res, filename);
    if (filename  && method === 'DELETE') return handleDelete(res, filename);
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (fs.existsSync(DIST_DIR)) return serveStatic(res, pathname);

  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee"><h2 style="color:#f59e0b">App not built yet</h2><p>Run <b>BUILD_AND_RUN.bat</b> to build and start the server.</p></body></html>');
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n' + '='.repeat(56));
  console.log('  SDC State Logic Builder - Project Server');
  console.log('='.repeat(56));
  console.log('  Local:    http://localhost:' + PORT);
  ips.forEach(ip => console.log('  Network:  http://' + ip + ':' + PORT + '  <- share with team'));
  console.log('  Projects: ' + DATA_DIR);
  console.log('='.repeat(56) + '\n  Press Ctrl+C to stop.\n');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error('\nPort ' + PORT + ' is already in use.\n');
  else console.error('Server error:', err);
  process.exit(1);
});
