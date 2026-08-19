/**
 * SDC State Logic Builder — Project Server
 * No npm dependencies needed — uses only Node.js built-ins.
 *
 * Standalone:  node server.js           (port 3131)
 *              PORT=8080 node server.js
 *
 * Embedded:    const { startServer } = require('./server.js')
 *              startServer({ port, dataDir, standardsDir, distDir })
 *
 * API:
 *   GET    /api/projects              list all projects
 *   GET    /api/projects/:filename    load a project
 *   POST   /api/projects/:filename    save / overwrite a project
 *   DELETE /api/projects/:filename    delete a project
 *
 *   POST   /api/generate              AI L5X generation: { filename | projectJson, smId }
 *                                     -> { ok, l5x, validation, reviewNotes, meta }
 *                                     503 when ANTHROPIC_API_KEY is not configured
 *   GET    /api/generate/stream       Same pipeline with LIVE PROGRESS over SSE.
 *                                     ?filename=<project.json>&smId=<sm id>
 *                                     Events: progress {pct,stage,detail},
 *                                     done {result..., savedPath}, error {error}.
 *                                     Closing the connection cancels the model stream.
 *                                     On success the L5X is also saved to
 *                                     generated/<project>/<sm>__jarvis_v<ver>__<date>.L5X
 *   POST   /api/jarvis/diagram        Describe-your-station -> project draft:
 *                                     { description, images:[{name,base64,mediaType}] }
 *                                     -> { ok, filename, summary, openQuestions, fixups, meta }
 *                                     Draft saved to projects/<name>_draft.json
 *   POST   /api/jarvis/spec           Explain-this-station -> machineSpec extraction:
 *                                     { description, images, sm:{id,name,displayName,devices,drawnSteps},
 *                                       otherSms:[{id,name,displayName}], existingSpec }
 *                                     -> { ok, spec, proposedDevices, unmentionedDeviceIds,
 *                                          questions, fixups, meta }. Stateless — nothing saved.
 *   POST   /api/jarvis/summarize      "Done explaining" -> cleaned restatement:
 *                                     { description, images, checklist, sm, otherSms,
 *                                       priorSummary, corrections }
 *                                     -> { ok, summary, coverage, questions, meta }. Stateless.
 *
 *   GET    /api/standards             get the entire shared standards library (array)
 *   POST   /api/standards             replace the entire library with the POST body
 *   POST   /api/standards/:id         upsert a single standard by id
 *   DELETE /api/standards/:id         remove a single standard by id
 *
 * The standards endpoints back a single shared JSON file at
 * `<standardsDir>/standards.json` so every client hitting this server
 * sees the same library. Auto-backs up the last 5 versions before each
 * write — same pattern as projects.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const os   = require('os');

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

function startServer({ port, dataDir, standardsDir, distDir } = {}) {
  const PORT_          = port         || Number(process.env.PORT)      || 3131;
  const DATA_DIR_      = dataDir      || process.env.DATA_DIR          || path.join(__dirname, 'projects');
  // Standards library lives in its own dir so the projects listing isn't
  // polluted with standards.json. Default sits next to the projects dir —
  // either both are on local AppData (single-user) or both are on the
  // shared network drive (team).
  const STANDARDS_DIR_ = standardsDir || process.env.STANDARDS_DIR     || path.join(path.dirname(DATA_DIR_), 'standards');
  const STANDARDS_FILE_ = path.join(STANDARDS_DIR_, 'standards.json');
  const DIST_DIR_      = distDir      || process.env.DIST_DIR          || path.join(__dirname, 'dist');

  fs.mkdirSync(DATA_DIR_, { recursive: true });
  // Best-effort — if this path is a network share that's currently
  // unreachable, don't crash the whole server. The route handlers will
  // surface a clear 5xx when they actually try to read/write.
  try { fs.mkdirSync(STANDARDS_DIR_, { recursive: true }); } catch (e) {
    console.warn('[standards] Could not create', STANDARDS_DIR_, '—', e.message);
  }

  function handleList(res) {
    const files = fs.readdirSync(DATA_DIR_).filter(f => f.endsWith('.json'));
    const list = files.map(filename => {
      try {
        const fp   = path.join(DATA_DIR_, filename);
        const stat = fs.statSync(fp);
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return {
          filename,
          name: data.name || filename.replace('.json', ''),
          lastModified: stat.mtimeMs,
          smCount: Array.isArray(data.stateMachines) ? data.stateMachines.length : 0,
        };
      } catch (e) { console.warn('[projects] Parse failed for', filename, ':', e.message); return { filename, name: filename, lastModified: 0, smCount: 0 }; }
    });
    sendJson(res, 200, list);
  }

  function handleLoad(res, filename) {
    const safe = safeFilename(filename);
    if (!safe) return sendJson(res, 400, { error: 'Invalid filename' });
    const fp = path.join(DATA_DIR_, safe);
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

      const filePath = path.join(DATA_DIR_, safe);

      // Auto-backup: keep last 5 versions before overwriting
      if (fs.existsSync(filePath)) {
        const backupDir = path.join(DATA_DIR_, '_backups');
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
    const fp = path.join(DATA_DIR_, safe);
    if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Not found' });
    try { fs.unlinkSync(fp); sendJson(res, 200, { ok: true }); }
    catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  // ── AI L5X Generation (agentGenerator) ─────────────────────────────────────

  /** POST /api/generate — body: { filename | projectJson, smId, options? }.
   *  Runs promptBuilder -> Claude -> validator (with self-repair) and returns
   *  { ok, l5x, validation, reviewNotes, meta }. The agentGenerator module is
   *  required lazily so the server still runs with only Node built-ins when
   *  node_modules is absent; missing ANTHROPIC_API_KEY surfaces as a 503. */
  async function handleGenerate(req, res) {
    let gen;
    try {
      gen = require('./src/lib/agentGenerator/client.js');
    } catch (e) {
      return sendJson(res, 503, {
        error: 'AI generation not available — run npm install (agentGenerator dependencies missing): ' + e.message,
      });
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      let projectJson = body.projectJson;
      if (!projectJson && body.filename) {
        const safe = safeFilename(body.filename);
        if (!safe) return sendJson(res, 400, { error: 'Invalid filename' });
        const fp = path.join(DATA_DIR_, safe);
        if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found' });
        projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      }
      if (!projectJson) return sendJson(res, 400, { error: 'Provide filename or projectJson' });

      const result = await gen.generateL5X(projectJson, body.smId, body.options || {});
      sendJson(res, 200, result);
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') {
        return sendJson(res, 503, { error: e.message });
      }
      sendJson(res, 500, { error: e.message });
    }
  }

  /** GET /api/generate/stream?filename=&smId= — SSE live-progress generation.
   *  One connection runs the whole pipeline: progress events stream as the
   *  model works, the final `done` event carries the full result payload
   *  (minus nothing — l5x included), and closing the connection aborts the
   *  in-flight SDK stream. On success the L5X is also written to
   *  generated/<project>/<sm>__jarvis_v<version>__<date>.L5X. */
  async function handleGenerateStream(req, res, query) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };

    let gen;
    try {
      gen = require('./src/lib/agentGenerator/client.js');
    } catch (e) {
      send('error', { error: 'AI generation not available — run npm install: ' + e.message });
      return res.end();
    }

    const abort = new AbortController();
    let clientGone = false;
    req.on('close', () => { clientGone = true; abort.abort(); });

    // Monotonic progress guard — repair rounds report inside 88-92 which
    // could otherwise step backward past the validate marker.
    let lastPct = 0;
    const onProgress = (pct, stage, detail) => {
      const p = Math.max(lastPct, Math.min(Math.round(pct * 10) / 10, 99));
      lastPct = p;
      send('progress', { pct: p, stage, detail });
    };

    try {
      const safe = safeFilename(query.filename || '');
      if (!safe) { send('error', { error: 'Invalid or missing filename' }); return res.end(); }
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) { send('error', { error: 'Project not found: ' + safe }); return res.end(); }
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));

      send('progress', { pct: 2, stage: 'start', detail: `Loaded ${safe}` });
      const result = await gen.generateL5X(projectJson, query.smId || undefined, {
        onProgress, signal: abort.signal,
      });

      // Auto-save the generated program so the user always knows where it is.
      let savedPath = null;
      if (result.l5x) {
        try {
          const clean = (s) => String(s || 'unnamed').replace(/[^a-zA-Z0-9_\-]/g, '_');
          const ver = result.meta?.jarvisVersion || '0';
          const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
          const dir = path.join(__dirname, 'generated', clean(projectJson.name || safe.replace('.json', '')));
          fs.mkdirSync(dir, { recursive: true });
          savedPath = path.join(dir, `${clean(result.meta?.smName)}__jarvis_v${ver}__${date}.L5X`);
          fs.writeFileSync(savedPath, result.l5x, 'utf8');
        } catch (e) {
          console.warn('[generate] auto-save failed:', e.message);
        }
      }

      send('progress', { pct: 100, stage: 'done', detail: result.ok ? 'Generation complete' : 'Finished with validation errors' });
      send('done', { ...result, savedPath });
    } catch (e) {
      if (clientGone || (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError'))) {
        // Client cancelled — nothing to report.
      } else if (e && e.code === 'AI_NOT_CONFIGURED') {
        send('error', { error: e.message });
      } else {
        send('error', { error: e.message || String(e) });
      }
    }
    res.end();
  }

  // ── JARVIS describe-your-station -> diagram draft ──────────────────────────

  /** POST /api/jarvis/diagram — body: { description, images: [{name, base64,
   *  mediaType}] }. Authors a State Logic Builder project draft via Claude,
   *  validates it, saves it to projects/<name>_draft.json, and returns
   *  { ok, filename, summary, openQuestions, fixups, meta }. */
  async function handleJarvisDiagram(req, res) {
    let author;
    try {
      author = require('./src/lib/agentGenerator/diagramAuthor.js');
    } catch (e) {
      return sendJson(res, 503, { error: 'Diagram author not available — run npm install: ' + e.message });
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.description || !String(body.description).trim()) {
        return sendJson(res, 400, { error: 'description is required' });
      }
      const result = await author.authorDiagram({
        description: body.description,
        images: Array.isArray(body.images) ? body.images : [],
        station: body.station && typeof body.station === 'object' ? body.station : null,
      });

      // Single-SM mode (Create Station flow): no draft file — the client
      // inserts the SM into its CURRENT project via store actions.
      if (body.station && body.station.name) {
        return sendJson(res, 200, {
          ok: true,
          sm: result.project.stateMachines[0],
          summary: result.summary,
          openQuestions: result.openQuestions,
          fixups: result.fixups,
          meta: result.meta,
        });
      }

      // Save the draft into the projects dir so the app can open it directly.
      const base = String(result.project.name || 'JarvisDraft')
        .replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_') || 'JarvisDraft';
      let filename = `${base}_draft.json`;
      // Don't clobber an existing draft silently — suffix a counter.
      let n = 2;
      while (fs.existsSync(path.join(DATA_DIR_, filename))) {
        filename = `${base}_draft${n++}.json`;
        if (n > 50) break;
      }
      fs.writeFileSync(path.join(DATA_DIR_, filename), JSON.stringify(result.project, null, 2), 'utf8');

      sendJson(res, 200, {
        ok: true,
        filename,
        summary: result.summary,
        openQuestions: result.openQuestions,
        fixups: result.fixups,
        meta: result.meta,
      });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') return sendJson(res, 503, { error: e.message });
      sendJson(res, 500, { error: e.message });
    }
  }

  /** POST /api/jarvis/spec — body: { description, images, sm, otherSms,
   *  existingSpec }. Extracts a machineSpec + devices delta from a free-form
   *  station explanation. Stateless: the client renders a review screen and
   *  persists via its own store on Save. */
  async function handleJarvisSpec(req, res) {
    let author;
    try {
      author = require('./src/lib/agentGenerator/specAuthor.js');
    } catch (e) {
      return sendJson(res, 503, { error: 'Spec author not available — run npm install: ' + e.message });
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.description || !String(body.description).trim()) {
        return sendJson(res, 400, { error: 'description is required' });
      }
      const result = await author.authorSpec({
        description: body.description,
        images: Array.isArray(body.images) ? body.images : [],
        sm: body.sm && typeof body.sm === 'object' ? body.sm : {},
        otherSms: Array.isArray(body.otherSms) ? body.otherSms : [],
        existingSpec: body.existingSpec || null,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') return sendJson(res, 503, { error: e.message });
      sendJson(res, 500, { error: e.message });
    }
  }

  /** POST /api/jarvis/summarize — body: { description, images, checklist,
   *  sm, otherSms, priorSummary, corrections }. Cheap "Done explaining"
   *  call: cleaned restatement + per-checklist coverage verdict + 2-4
   *  follow-up questions. Stateless. */
  async function handleJarvisSummarize(req, res) {
    let author;
    try {
      author = require('./src/lib/agentGenerator/specAuthor.js');
    } catch (e) {
      return sendJson(res, 503, { error: 'Spec author not available — run npm install: ' + e.message });
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.description || !String(body.description).trim()) {
        return sendJson(res, 400, { error: 'description is required' });
      }
      const result = await author.summarizeDescription({
        description: body.description,
        images: Array.isArray(body.images) ? body.images : [],
        checklist: body.checklist && typeof body.checklist === 'object' ? body.checklist : null,
        sm: body.sm && typeof body.sm === 'object' ? body.sm : {},
        otherSms: Array.isArray(body.otherSms) ? body.otherSms : [],
        priorSummary: typeof body.priorSummary === 'string' ? body.priorSummary : '',
        corrections: typeof body.corrections === 'string' ? body.corrections : '',
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') return sendJson(res, 503, { error: e.message });
      sendJson(res, 500, { error: e.message });
    }
  }

  // ── Standards Library (shared across all clients) ─────────────────────────

  /** Read the full standards array from disk. Returns [] if the file is
   *  missing or unreadable. Never throws — callers get an empty list on
   *  any error and can treat it as "no standards yet". */
  function readStandardsArray() {
    try {
      if (!fs.existsSync(STANDARDS_FILE_)) return [];
      const raw = fs.readFileSync(STANDARDS_FILE_, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[standards] read failed:', e.message);
      return [];
    }
  }

  /** Atomically write the array to disk. Backs up the previous version
   *  (last 5 retained) to match the project auto-backup behavior so a bad
   *  import or accidental clear can always be recovered. */
  function writeStandardsArray(arr) {
    try { fs.mkdirSync(STANDARDS_DIR_, { recursive: true }); } catch (_) {}
    if (fs.existsSync(STANDARDS_FILE_)) {
      const backupDir = path.join(STANDARDS_DIR_, '_backups');
      try {
        fs.mkdirSync(backupDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(STANDARDS_FILE_, path.join(backupDir, `standards__${ts}.json`));
        // Prune — keep last 5
        const backups = fs.readdirSync(backupDir)
          .filter(f => f.startsWith('standards__'))
          .sort()
          .reverse();
        for (const old of backups.slice(5)) {
          try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {}
        }
      } catch (e) {
        console.warn('[standards] backup failed:', e.message);
      }
    }
    // Write to a temp file then rename — avoids a half-written file if
    // the process dies mid-write (especially over a network share).
    const tmp = STANDARDS_FILE_ + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
    fs.renameSync(tmp, STANDARDS_FILE_);
  }

  function handleStandardsList(res) {
    sendJson(res, 200, readStandardsArray());
  }

  async function handleStandardsReplace(req, res) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) return sendJson(res, 400, { error: 'Body must be a JSON array' });
      writeStandardsArray(parsed);
      sendJson(res, 200, { ok: true, total: parsed.length });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  async function handleStandardsUpsert(req, res, id) {
    if (!id) return sendJson(res, 400, { error: 'Missing id' });
    try {
      const body = await readBody(req);
      const incoming = JSON.parse(body);
      if (!incoming || typeof incoming !== 'object') return sendJson(res, 400, { error: 'Body must be a JSON object' });
      // Id in the URL is authoritative; overwrite any mismatched id in the body.
      incoming.id = id;
      const current = readStandardsArray();
      const idx = current.findIndex(s => s?.id === id);
      if (idx === -1) current.push(incoming);
      else current[idx] = incoming;
      writeStandardsArray(current);
      sendJson(res, 200, { ok: true, id, total: current.length });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  function handleStandardsDelete(res, id) {
    if (!id) return sendJson(res, 400, { error: 'Missing id' });
    try {
      const current = readStandardsArray();
      const next = current.filter(s => s?.id !== id);
      if (next.length === current.length) return sendJson(res, 404, { error: 'Not found' });
      writeStandardsArray(next);
      sendJson(res, 200, { ok: true, id, total: next.length });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  function serveStatic(res, reqPath) {
    let fp = path.join(DIST_DIR_, reqPath === '/' ? 'index.html' : reqPath);
    if (!path.extname(fp) || !fs.existsSync(fp)) fp = path.join(DIST_DIR_, 'index.html');
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    const content = fs.readFileSync(fp);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Content-Length': content.length });
    res.end(content);
  }

  const server = http.createServer(async (req, res) => {
    const { pathname = '/', query = {} } = url.parse(req.url || '/', true);
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
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

    if (pathname === '/api/generate') {
      if (method === 'POST') return handleGenerate(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/generate/stream') {
      if (method === 'GET') return handleGenerateStream(req, res, query);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/diagram') {
      if (method === 'POST') return handleJarvisDiagram(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/spec') {
      if (method === 'POST') return handleJarvisSpec(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/summarize') {
      if (method === 'POST') return handleJarvisSummarize(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname.startsWith('/api/standards')) {
      const rest = pathname.slice('/api/standards'.length);
      // /api/standards/_debug → diagnostic view of what the server is reading.
      // Useful for "why is my app showing Offline?" — hit this URL in a browser
      // pointed at the running server and see the resolved path + file status.
      if (rest === '/_debug' && method === 'GET') {
        const fileExists = fs.existsSync(STANDARDS_FILE_);
        let entryCount = null;
        let parseError = null;
        if (fileExists) {
          try {
            const raw = fs.readFileSync(STANDARDS_FILE_, 'utf8');
            const arr = JSON.parse(raw);
            entryCount = Array.isArray(arr) ? arr.length : 'non-array';
          } catch (e) { parseError = e.message; }
        }
        return sendJson(res, 200, {
          standardsDir: STANDARDS_DIR_,
          standardsFile: STANDARDS_FILE_,
          fileExists,
          entryCount,
          parseError,
        });
      }
      const id = rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : null;
      if (!id && method === 'GET')    return handleStandardsList(res);
      if (!id && method === 'POST')   return handleStandardsReplace(req, res);
      if (id  && method === 'POST')   return handleStandardsUpsert(req, res, id);
      if (id  && method === 'DELETE') return handleStandardsDelete(res, id);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (fs.existsSync(DIST_DIR_)) return serveStatic(res, pathname);

    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee"><h2 style="color:#f59e0b">App not built yet</h2><p>Run <b>BUILD_AND_RUN.bat</b> to build and start the server.</p></body></html>');
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error('\nPort ' + PORT_ + ' is already in use.\n');
    } else {
      console.error('Server error:', err);
    }
    // Only exit if running standalone — embedded usage lets the caller handle the error
    if (require.main === module) process.exit(1);
  });

  server.listen(PORT_, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter(i => i.family === 'IPv4' && !i.internal)
      .map(i => i.address);
    console.log('\n' + '='.repeat(56));
    console.log('  SDC State Logic Builder - Project Server');
    console.log('='.repeat(56));
    console.log('  Local:    http://localhost:' + PORT_);
    ips.forEach(ip => console.log('  Network:  http://' + ip + ':' + PORT_ + '  <- share with team'));
    console.log('  Projects:  ' + DATA_DIR_);
    console.log('  Standards: ' + STANDARDS_DIR_);
    console.log('='.repeat(56) + '\n  Press Ctrl+C to stop.\n');
  });

  return server;
}

// Standalone mode: node server.js
if (require.main === module) {
  startServer();
}

module.exports = { startServer };
