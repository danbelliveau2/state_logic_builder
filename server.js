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
 *   GET    /api/projects/:filename/docs           list attached documents
 *   POST   /api/projects/:filename/docs           upload { name, base64 } (max 25MB)
 *   GET    /api/projects/:filename/docs/:docname  download a document
 *   DELETE /api/projects/:filename/docs/:docname  delete a document
 *                                     Files live in projects/_docs/<projectBasename>/.
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
 *                                     plus the structured IR as <same base>.ir.json
 *   GET    /api/jarvis/ir             Latest compiled IR for one station:
 *                                     ?filename=<project.json>&smId=<id|name> ->
 *                                     { file, mtimeMs, smName, ir } (404 when
 *                                     no build has produced an IR yet)
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
 *   POST   /api/jarvis/summarize/stream  Same call with LIVE PROGRESS over SSE
 *                                     (chunked response; body identical to
 *                                     /api/jarvis/summarize). Events:
 *                                     progress {pct,stage}, done {ok,...result},
 *                                     error {error}. Closing the connection
 *                                     aborts the model stream. POST (not GET)
 *                                     because the description/images ride in
 *                                     the body — read it with fetch(), not
 *                                     EventSource.
 *
 *   GET    /api/jarvis/questions      Jarvis's question queue (array, newest last)
 *   POST   /api/jarvis/questions      append a question: { question, context?, source? }
 *   POST   /api/jarvis/questions/:id/answer   { answer, answeredBy } — marks the
 *                                     question answered AND appends the answer to
 *                                     meKnowledge.md "## Learned from the MEs"
 *                                     (dated, attributed; section/file created if
 *                                     missing; one retry on write conflict)
 *   POST   /api/jarvis/questions/:id/dismiss   mark a question dismissed
 *   GET    /api/jarvis/knowledge      { meKnowledge, rulesHeadings } — read-only
 *                                     view of what Jarvis knows (files on disk)
 *   GET    /api/jarvis/trackrecord    { version, history, benchmarks, generatedCount }
 *                                     — jarvisVersion.js HISTORY + benchmarks/*.report.json
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
    try {
      fs.unlinkSync(fp);
      // Also drop the project's attached documents (projects/_docs/<base>/)
      // so deleted projects don't orphan their document dumps.
      try {
        const docsDir = path.join(DATA_DIR_, '_docs', safe.replace(/\.json$/i, ''));
        if (fs.existsSync(docsDir)) fs.rmSync(docsDir, { recursive: true, force: true });
      } catch (e) { console.warn('[projects] docs cleanup failed:', e.message); }
      sendJson(res, 200, { ok: true });
    }
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

  // In-flight generation counter — exposed at GET /api/health so tooling
  // (and humans) can check {activeGenerations} BEFORE restarting this server.
  // Restarting mid-generation kills the SSE and loses a paid model run.
  let activeGenerations = 0;

  /** GET /api/generate/stream?filename=&smId= — SSE live-progress generation.
   *  One connection runs the whole pipeline: progress events stream as the
   *  model works, the final `done` event carries the full result payload
   *  (minus nothing — l5x included), and closing the connection aborts the
   *  in-flight SDK stream. On success the L5X is also written to
   *  generated/<project>/<sm>__jarvis_v<version>__<date>.L5X. */
  async function handleGenerateStream(req, res, query) {
    activeGenerations++;
    let counted = true;
    const releaseGeneration = () => {
      if (counted) { counted = false; activeGenerations = Math.max(0, activeGenerations - 1); }
    };
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
      releaseGeneration();
      return res.end();
    }

    const abort = new AbortController();
    let clientGone = false;
    // Keepalive ping every 15s — the model's silent reasoning phase can run
    // minutes with zero progress events; the client uses pings to tell
    // "alive but thinking" apart from "connection stalled" (>90s of silence).
    const keepalive = setInterval(() => send('ping', { t: Date.now() }), 15000);
    req.on('close', () => { clientGone = true; clearInterval(keepalive); releaseGeneration(); abort.abort(); });

    const startedAt = Date.now(); // wall-clock duration for the build record

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
      if (!safe) { send('error', { error: 'Invalid or missing filename' }); clearInterval(keepalive); releaseGeneration(); return res.end(); }
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) { send('error', { error: 'Project not found: ' + safe }); clearInterval(keepalive); releaseGeneration(); return res.end(); }
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));

      send('progress', { pct: 2, stage: 'start', detail: `Loaded ${safe}` });
      const result = await gen.generateL5X(projectJson, query.smId || undefined, {
        onProgress, signal: abort.signal,
      });

      // Auto-save the generated program so the user always knows where it is.
      let savedPath = null;
      let savedIrPath = null;
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
        // Persist the structured IR next to the L5X so the UI can render the
        // compiled "Full Controls" view later (GET /api/jarvis/ir).
        if (savedPath && result.ir && result.ir.irVersion) {
          try {
            savedIrPath = savedPath.replace(/\.L5X$/i, '.ir.json');
            fs.writeFileSync(savedIrPath, JSON.stringify({
              ...result.ir,
              generatedAt: new Date().toISOString(),
              jarvisVersion: result.meta?.jarvisVersion ?? null,
              l5xFile: path.basename(savedPath),
              validationOk: result.ok === true,
            }, null, 2), 'utf8');
          } catch (e) {
            savedIrPath = null;
            console.warn('[generate] IR auto-save failed:', e.message);
          }
        }
      }

      send('progress', { pct: 100, stage: 'done', detail: result.ok ? 'Generation complete' : 'Finished with validation errors' });
      // Record the build for ME scoring (jarvis-knowledge/buildScores.json) —
      // buildId rides in the done payload so the client can POST a score.
      let buildId = null;
      try {
        buildId = require('./src/lib/agentGenerator/buildScores.js').recordBuild(
          path.join(__dirname, 'jarvis-knowledge', 'buildScores.json'), {
            project: projectJson.name || safe.replace('.json', ''),
            sm: result.meta?.smName || query.smId || '',
            jarvisVersion: result.meta?.jarvisVersion ?? null,
            costUSD: result.meta?.costEstimate?.totalUSD ?? null,
            durationS: Math.round((Date.now() - startedAt) / 1000),
            attempts: result.meta?.attempts?.length ?? null,
            validationOk: result.ok === true,
            filePath: savedPath,
          }).id;
      } catch (e) { console.warn('[generate] build record failed:', e.message); }
      send('done', { ...result, savedPath, savedIrPath, buildId });
    } catch (e) {
      if (clientGone || (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError'))) {
        // Client cancelled — nothing to report.
      } else if (e && e.code === 'AI_NOT_CONFIGURED') {
        send('error', { error: e.message });
      } else {
        send('error', { error: e.message || String(e) });
      }
    }
    clearInterval(keepalive);
    releaseGeneration();
    res.end();
  }

  /** GET /api/jarvis/ir?filename=&smId= — latest compiled IR for one station.
   *  Scans generated/<project>/ for <smName>__*.ir.json (written by the
   *  /api/generate/stream done handler), returns the newest by mtime. smId is
   *  the SM's id (or name, tolerated); omit to use the project's first SM.
   *  404 when the project/SM exists but no build has produced an IR yet. */
  function handleJarvisIr(res, query) {
    try {
      const safe = safeFilename(query.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sms = projectJson.stateMachines || [];
      const want = query.smId ? String(query.smId) : null;
      const sm = want
        ? (sms.find(s => s.id === want) ||
           sms.find(s => (s.name || '').toLowerCase() === want.toLowerCase()))
        : sms[0];
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (want || '(first)') });

      // Same sanitizers the auto-save uses, so prefixes line up exactly.
      const clean = (s) => String(s || 'unnamed').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const dir = path.join(__dirname, 'generated', clean(projectJson.name || safe.replace('.json', '')));
      const prefix = clean(sm.name) + '__';
      let candidates = [];
      if (fs.existsSync(dir)) {
        candidates = fs.readdirSync(dir)
          .filter(f => f.startsWith(prefix) && f.toLowerCase().endsWith('.ir.json'))
          .map(f => {
            const full = path.join(dir, f);
            return { file: f, full, mtimeMs: fs.statSync(full).mtimeMs };
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs);
      }
      if (!candidates.length) {
        return sendJson(res, 404, {
          error: 'No compiled build yet — generate this station with Jarvis first',
          project: projectJson.name || safe.replace('.json', ''),
          smName: sm.name,
        });
      }
      const latest = candidates[0];
      const ir = JSON.parse(fs.readFileSync(latest.full, 'utf8'));
      sendJson(res, 200, {
        file: latest.file,
        mtimeMs: latest.mtimeMs,
        smName: sm.name,
        ir,
      });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
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
        corrections: typeof body.corrections === 'string' ? body.corrections : '',
        round: Number(body.round) || 0,
        qaHistory: Array.isArray(body.qaHistory) ? body.qaHistory : [],
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') return sendJson(res, 503, { error: e.message });
      sendJson(res, 500, { error: e.message });
    }
  }

  /** Persist 'sdc-standard' learnedFacts to meKnowledge.md (append-only,
   *  fuzzy-deduped) and annotate each fact with whether it was recorded.
   *  Never throws — learning failures must not break the summarize result. */
  function persistLearnedFacts(result) {
    try {
      if (!result || !Array.isArray(result.learnedFacts) || !result.learnedFacts.length) return result;
      const { appendLearnedFacts } = require('./src/lib/agentGenerator/meKnowledge.js');
      const { recorded } = appendLearnedFacts(result.learnedFacts, { who: 'ME' });
      const recordedSet = new Set(recorded);
      result.learnedFacts = result.learnedFacts.map(f => ({
        ...f,
        recorded: f.scope === 'sdc-standard' && recordedSet.has(String(f.fact).trim().replace(/\s+/g, ' ')),
      }));
      if (recorded.length) console.log('[jarvis] learned:', recorded.join(' | '));
    } catch (e) {
      console.warn('[jarvis] learned-fact persistence failed:', e.message);
    }
    return result;
  }

  /** POST /api/jarvis/summarize — body: { description, images, checklist,
   *  sm, otherSms, priorSummary, corrections }. Cheap "Done explaining"
   *  call: cleaned restatement + per-checklist coverage verdict + 0-3
   *  follow-up questions. Stateless except learnedFacts persistence. */
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
        round: Number(body.round) || 0,
        qaHistory: Array.isArray(body.qaHistory) ? body.qaHistory : [],
        priorCoverage: body.priorCoverage && typeof body.priorCoverage === 'object' ? body.priorCoverage : null,
      });
      persistLearnedFacts(result);
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') return sendJson(res, 503, { error: e.message });
      sendJson(res, 500, { error: e.message });
    }
  }

  /** POST /api/jarvis/summarize/stream — same body as /api/jarvis/summarize,
   *  but the response is SSE (chunked): `progress` events with real 0-100
   *  model progress, then one `done` event carrying the full result (or an
   *  `error` event). Closing the connection aborts the in-flight SDK stream.
   *  The plain POST endpoint above stays for non-streaming callers. */
  async function handleJarvisSummarizeStream(req, res) {
    // Read the body BEFORE switching the response to SSE so a bad request
    // can still fail as plain JSON.
    let body;
    try {
      body = JSON.parse(await readBody(req) || '{}');
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON body: ' + e.message });
    }
    if (!body.description || !String(body.description).trim()) {
      return sendJson(res, 400, { error: 'description is required' });
    }
    let author;
    try {
      author = require('./src/lib/agentGenerator/specAuthor.js');
    } catch (e) {
      return sendJson(res, 503, { error: 'Spec author not available — run npm install: ' + e.message });
    }

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

    const abort = new AbortController();
    let clientGone = false;
    req.on('close', () => { clientGone = true; abort.abort(); });

    // Monotonic guard (matches /api/generate/stream).
    let lastPct = 0;
    const onProgress = (pct, stage) => {
      const p = Math.max(lastPct, Math.min(Math.round(pct * 10) / 10, 100));
      lastPct = p;
      send('progress', { pct: p, stage });
    };

    try {
      const result = await author.summarizeDescription({
        description: body.description,
        images: Array.isArray(body.images) ? body.images : [],
        checklist: body.checklist && typeof body.checklist === 'object' ? body.checklist : null,
        sm: body.sm && typeof body.sm === 'object' ? body.sm : {},
        otherSms: Array.isArray(body.otherSms) ? body.otherSms : [],
        priorSummary: typeof body.priorSummary === 'string' ? body.priorSummary : '',
        corrections: typeof body.corrections === 'string' ? body.corrections : '',
        round: Number(body.round) || 0,
        qaHistory: Array.isArray(body.qaHistory) ? body.qaHistory : [],
        priorCoverage: body.priorCoverage && typeof body.priorCoverage === 'object' ? body.priorCoverage : null,
        signal: abort.signal,
        onProgress,
      });
      persistLearnedFacts(result);
      send('done', { ok: true, ...result });
    } catch (e) {
      if (clientGone || (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError'))) {
        // Client cancelled — nothing to report.
      } else {
        send('error', { error: e.message || String(e) });
      }
    }
    res.end();
  }

  // ── JARVIS learning being: question queue + knowledge + track record ───────
  //
  // Jarvis accumulates questions while working (create-station, generation,
  // training, or manually seeded); the controls team answers them; answers
  // become permanent lines in meKnowledge.md "## Learned from the MEs".
  // Queue lives in <repo>/jarvis-knowledge/questions.json.

  const JARVIS_QUESTIONS_DIR_  = path.join(__dirname, 'jarvis-knowledge');
  const JARVIS_QUESTIONS_FILE_ = path.join(JARVIS_QUESTIONS_DIR_, 'questions.json');
  const ME_KNOWLEDGE_PATH_     = path.join(__dirname, 'src', 'lib', 'agentGenerator', 'meKnowledge.md');
  const LEARNED_HEADING_       = '## Learned from the MEs';

  function readQuestions() {
    try {
      if (!fs.existsSync(JARVIS_QUESTIONS_FILE_)) return [];
      const parsed = JSON.parse(fs.readFileSync(JARVIS_QUESTIONS_FILE_, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[jarvis-questions] read failed:', e.message);
      return [];
    }
  }

  /** Atomic write (tmp + rename), one retry — the file may be contended by
   *  a concurrent answer/dismiss or an external seed script. */
  function writeQuestions(arr) {
    fs.mkdirSync(JARVIS_QUESTIONS_DIR_, { recursive: true });
    const tmp = JARVIS_QUESTIONS_FILE_ + '.tmp';
    const body = JSON.stringify(arr, null, 2);
    try {
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, JARVIS_QUESTIONS_FILE_);
    } catch (e) {
      // Retry once (Windows rename can transiently fail if the file is open)
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, JARVIS_QUESTIONS_FILE_);
    }
  }

  /** Append one dated, attributed learned line to meKnowledge.md's
   *  "## Learned from the MEs" section. Creates the file and/or section if
   *  missing. Coordinate-safe: read-modify-write is append-only and retried
   *  once on failure. Returns the appended line text. */
  function appendLearnedLine({ answer, answeredBy, question }) {
    const date = new Date().toISOString().slice(0, 10);
    const q = String(question || '').replace(/\s+/g, ' ').trim();
    const qShort = q.length > 120 ? q.slice(0, 117) + '…' : q;
    const line = `- (${date}, ${answeredBy}) ${String(answer).replace(/\s+/g, ' ').trim()}`
      + (qShort ? ` [answers: "${qShort}"]` : '');

    const doAppend = () => {
      let md = '';
      try { md = fs.readFileSync(ME_KNOWLEDGE_PATH_, 'utf8'); } catch (_) { md = ''; }
      if (!md.trim()) {
        md = '# ME-Facing Standing Knowledge\n\n' + LEARNED_HEADING_ + '\n\n'
           + 'Append-only. One line per fact: `- (date, who) fact`.\n';
      } else if (!md.includes(LEARNED_HEADING_)) {
        md = md.replace(/\s*$/, '') + '\n\n' + LEARNED_HEADING_ + '\n\n'
           + 'Append-only. One line per fact: `- (date, who) fact`.\n';
      }
      const updated = md.replace(/\s*$/, '') + '\n' + line + '\n';
      fs.writeFileSync(ME_KNOWLEDGE_PATH_, updated, 'utf8');
    };
    try { doAppend(); }
    catch (e) { doAppend(); } // one retry on write conflict
    return line;
  }

  function handleJarvisQuestionsList(res) {
    sendJson(res, 200, readQuestions());
  }

  /** POST /api/jarvis/questions — { question, context?, source? }. Used by
   *  future integrations (create-station, generation, training) to queue a
   *  question for the controls team. */
  async function handleJarvisQuestionAdd(req, res) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const question = String(body.question || '').trim();
      if (!question) return sendJson(res, 400, { error: 'question is required' });
      const VALID_SOURCES = ['create-station', 'generation', 'training', 'manual'];
      const entry = {
        id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        question,
        context: String(body.context || '').trim(),
        source: VALID_SOURCES.includes(body.source) ? body.source : 'manual',
        askedAt: new Date().toISOString(),
        status: 'open',
      };
      const arr = readQuestions();
      arr.push(entry);
      writeQuestions(arr);
      sendJson(res, 200, { ok: true, question: entry });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  /** POST /api/jarvis/questions/:id/answer — { answer, answeredBy }. Marks
   *  answered AND appends the answer to meKnowledge.md so Jarvis's very next
   *  prompt includes it (loadMeKnowledge() reads the file fresh). */
  async function handleJarvisQuestionAnswer(req, res, id) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const answer = String(body.answer || '').trim();
      const answeredBy = String(body.answeredBy || '').trim() || 'Controls';
      if (!answer) return sendJson(res, 400, { error: 'answer is required' });
      const arr = readQuestions();
      const q = arr.find(x => x && x.id === id);
      if (!q) return sendJson(res, 404, { error: 'Question not found' });
      if (q.status === 'answered') return sendJson(res, 409, { error: 'Already answered' });

      const learnedFactId = 'learned_' + Date.now().toString(36);
      let learnedLine = null;
      try {
        learnedLine = appendLearnedLine({ answer, answeredBy, question: q.question });
      } catch (e) {
        // Honest failure: the answer is still recorded on the question, but
        // the client is told Jarvis could NOT persist it to standing knowledge.
        console.warn('[jarvis-questions] meKnowledge append failed:', e.message);
      }

      q.status = 'answered';
      q.answer = answer;
      q.answeredBy = answeredBy;
      q.answeredAt = new Date().toISOString();
      if (learnedLine) q.learnedFactId = learnedFactId;
      writeQuestions(arr);
      sendJson(res, 200, { ok: true, question: q, learned: !!learnedLine, learnedLine });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  /** POST /api/jarvis/questions/:id/dismiss */
  async function handleJarvisQuestionDismiss(res, id) {
    try {
      const arr = readQuestions();
      const q = arr.find(x => x && x.id === id);
      if (!q) return sendJson(res, 404, { error: 'Question not found' });
      q.status = 'dismissed';
      writeQuestions(arr);
      sendJson(res, 200, { ok: true, question: q });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  /** GET /api/jarvis/knowledge — what Jarvis knows, read fresh from disk:
   *  meKnowledge.md full text (null if absent) + generationRules.md headings. */
  function handleJarvisKnowledge(res) {
    let meKnowledge = null;
    try { meKnowledge = fs.readFileSync(ME_KNOWLEDGE_PATH_, 'utf8'); } catch (_) {}
    let rulesHeadings = [];
    try {
      const rules = fs.readFileSync(path.join(__dirname, 'src', 'lib', 'agentGenerator', 'generationRules.md'), 'utf8');
      rulesHeadings = rules.split('\n')
        .filter(l => /^#{1,2}\s/.test(l))
        .map(l => l.replace(/^#+\s*/, '').trim());
    } catch (_) {}
    sendJson(res, 200, { meKnowledge, rulesHeadings });
  }

  /** GET /api/jarvis/trackrecord — jarvisVersion HISTORY + every
   *  benchmarks/<project>/<name>.report.json + generated-file count. All read
   *  fresh so a benchmark run shows up on refresh. */
  function handleJarvisTrackRecord(res) {
    let version = null, history = [];
    try {
      // Bust the require cache so a version bump shows without a restart.
      const vPath = require.resolve('./src/lib/agentGenerator/jarvisVersion.js');
      delete require.cache[vPath];
      const jv = require('./src/lib/agentGenerator/jarvisVersion.js');
      version = jv.JARVIS_VERSION;
      history = jv.HISTORY;
    } catch (e) {
      console.warn('[jarvis-trackrecord] version load failed:', e.message);
    }

    const benchmarks = [];
    try {
      const benchDir = path.join(__dirname, 'benchmarks');
      for (const sub of fs.readdirSync(benchDir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const subDir = path.join(benchDir, sub.name);
        for (const f of fs.readdirSync(subDir)) {
          if (!f.endsWith('.report.json')) continue;
          try {
            const r = JSON.parse(fs.readFileSync(path.join(subDir, f), 'utf8'));
            benchmarks.push({
              file: `${sub.name}/${f}`,
              version: r.jarvisVersion || null,
              project: r.project || sub.name,
              smName: r.smName || null,
              ok: r.ok === true,
              attemptsUsed: r.attemptsUsed ?? null,
              durationMs: r.durationMs ?? null,
              costUSD: r.costEstimate?.totalUSD ?? null,
              ranAt: r.ranAt || null,
              errors: r.validation?.errors?.length ?? null,
              warnings: r.validation?.warnings?.length ?? null,
            });
          } catch (e) {
            benchmarks.push({ file: `${sub.name}/${f}`, parseError: e.message, ok: false });
          }
        }
      }
      benchmarks.sort((a, b) => String(a.ranAt || '').localeCompare(String(b.ranAt || '')));
    } catch (_) { /* no benchmarks dir — empty list is honest */ }

    let generatedCount = 0;
    try {
      const walk = (dir) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, d.name);
          if (d.isDirectory()) walk(fp);
          else if (/\.L5X$/i.test(d.name)) generatedCount++;
        }
      };
      walk(path.join(__dirname, 'generated'));
    } catch (_) {}

    sendJson(res, 200, { version, history, benchmarks, generatedCount });
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

  // ── Per-project document dump ──────────────────────────────────────────────
  //
  // Files attached to a project for context (drawings, notes, quotes…).
  // Stored on disk at <DATA_DIR>/_docs/<projectBasename>/<docname>.
  // Jarvis consumption is a later milestone — today this is store + list only.
  //
  //   GET    /api/projects/:filename/docs            list  -> [{name,size,mtime}]
  //   POST   /api/projects/:filename/docs            upload { name, base64 }
  //   GET    /api/projects/:filename/docs/:docname   download (attachment)
  //   DELETE /api/projects/:filename/docs/:docname   delete

  const DOCS_ROOT_ = path.join(DATA_DIR_, '_docs');
  const MAX_DOC_BYTES_ = 25 * 1024 * 1024; // 25 MB per file

  /** Sanitize a document name: no paths, no hidden files, sane charset. */
  function safeDocName(name) {
    const n = String(name || '').trim();
    if (!n || n.length > 200) return null;
    if (n.startsWith('.') || n.includes('..') || /[\\/:*?"<>|\x00-\x1f]/.test(n)) return null;
    return n;
  }

  function docsDirFor(projectFilename) {
    return path.join(DOCS_ROOT_, projectFilename.replace(/\.json$/i, ''));
  }

  function handleDocsList(res, projectFilename) {
    const dir = docsDirFor(projectFilename);
    try {
      if (!fs.existsSync(dir)) return sendJson(res, 200, []);
      const list = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isFile())
        .map(d => {
          const st = fs.statSync(path.join(dir, d.name));
          return { name: d.name, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      sendJson(res, 200, list);
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  async function handleDocUpload(req, res, projectFilename) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const name = safeDocName(body.name);
      if (!name) return sendJson(res, 400, { error: 'Invalid or missing document name' });
      if (!body.base64 || typeof body.base64 !== 'string') {
        return sendJson(res, 400, { error: 'base64 content is required' });
      }
      const buf = Buffer.from(body.base64, 'base64');
      if (buf.length === 0) return sendJson(res, 400, { error: 'Empty file' });
      if (buf.length > MAX_DOC_BYTES_) {
        return sendJson(res, 413, { error: `File too large (max ${MAX_DOC_BYTES_ / 1024 / 1024} MB)` });
      }
      const dir = docsDirFor(projectFilename);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buf);
      sendJson(res, 200, { ok: true, name, size: buf.length });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  function handleDocDownload(res, projectFilename, docname) {
    const name = safeDocName(docname);
    if (!name) return sendJson(res, 400, { error: 'Invalid document name' });
    const fp = path.join(docsDirFor(projectFilename), name);
    if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Not found' });
    try {
      const content = fs.readFileSync(fp);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
        'Content-Length': content.length,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content);
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  function handleDocDelete(res, projectFilename, docname) {
    const name = safeDocName(docname);
    if (!name) return sendJson(res, 400, { error: 'Invalid document name' });
    const fp = path.join(docsDirFor(projectFilename), name);
    if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Not found' });
    try { fs.unlinkSync(fp); sendJson(res, 200, { ok: true }); }
    catch (e) { sendJson(res, 500, { error: e.message }); }
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
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    if (pathname.startsWith('/api/projects')) {
      const rest     = pathname.slice('/api/projects'.length);

      // Per-project docs: /api/projects/:filename/docs[/:docname]
      const docsM = rest.match(/^\/([^/]+)\/docs(?:\/(.+))?$/);
      if (docsM) {
        const projFn = safeFilename(decodeURIComponent(docsM[1]));
        if (!projFn) return sendJson(res, 400, { error: 'Invalid project filename' });
        const docname = docsM[2] ? decodeURIComponent(docsM[2]) : null;
        if (!docname && method === 'GET')    return handleDocsList(res, projFn);
        if (!docname && method === 'POST')   return handleDocUpload(req, res, projFn);
        if (docname  && method === 'GET')    return handleDocDownload(res, projFn, docname);
        if (docname  && method === 'DELETE') return handleDocDelete(res, projFn, docname);
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      const filename = rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : null;
      if (!filename && method === 'GET')    return handleList(res);
      if (filename  && method === 'GET')    return handleLoad(res, filename);
      if (filename  && method === 'POST')   return handleSave(req, res, filename);
      if (filename  && method === 'DELETE') return handleDelete(res, filename);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Health/liveness — check activeGenerations BEFORE restarting this server:
    // a restart mid-generation kills the SSE and loses a paid model run.
    if (pathname === '/api/health') {
      if (method === 'GET') return sendJson(res, 200, { ok: true, activeGenerations, uptimeS: Math.round(process.uptime()) });
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

    if (pathname === '/api/jarvis/ir') {
      if (method === 'GET') return handleJarvisIr(res, query);
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

    if (pathname === '/api/jarvis/summarize/stream') {
      if (method === 'POST') return handleJarvisSummarizeStream(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Learned-knowledge line edit/remove — module owns the logic
    if (pathname === '/api/jarvis/knowledge/learned' && method === 'PUT') {
      return require('./src/lib/agentGenerator/buildScores.js').handleLearnedLineRoute(req, res, {
        sendJson, readBody, mdPath: ME_KNOWLEDGE_PATH_,
      });
    }

    // Build scoring — module owns the routes; see src/lib/agentGenerator/buildScores.js
    if (pathname.startsWith('/api/jarvis/builds')) {
      return require('./src/lib/agentGenerator/buildScores.js').handleBuildsRoute(req, res, {
        pathname, method, sendJson, readBody,
        file: path.join(__dirname, 'jarvis-knowledge', 'buildScores.json'),
      });
    }

    if (pathname.startsWith('/api/jarvis/questions')) {
      const rest = pathname.slice('/api/jarvis/questions'.length);
      if (rest === '' || rest === '/') {
        if (method === 'GET')  return handleJarvisQuestionsList(res);
        if (method === 'POST') return handleJarvisQuestionAdd(req, res);
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      const m = rest.match(/^\/([^/]+)\/(answer|dismiss)$/);
      if (m && method === 'POST') {
        const id = decodeURIComponent(m[1]);
        if (m[2] === 'answer')  return handleJarvisQuestionAnswer(req, res, id);
        if (m[2] === 'dismiss') return handleJarvisQuestionDismiss(res, id);
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/knowledge') {
      if (method === 'GET') return handleJarvisKnowledge(res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/trackrecord') {
      if (method === 'GET') return handleJarvisTrackRecord(res);
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
