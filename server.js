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
 *                                     plus the structured IR as <same base>.ir.json.
 *                                     The done payload (and the build record)
 *                                     carries internalReview — Jarvis's own
 *                                     pre-delivery adversarial review of the
 *                                     file against the template ('ship'|'fix';
 *                                     'fix' = not ready for external delivery,
 *                                     a human decides — never auto-relooped).
 *                                     Gate: JARVIS_INTERNAL_REVIEW=on|off
 *                                     (default on).
 *   GET    /api/jarvis/ir             Latest compiled IR for one station:
 *                                     ?filename=<project.json>&smId=<id|name> ->
 *                                     { file, mtimeMs, smName, ir } (404 when
 *                                     no build has produced an IR yet).
 *                                     ?source=compiled -> the Build-time
 *                                     compiled sequence stored on the project
 *                                     (sm.compiledSequence), 404 if none.
 *   POST   /api/jarvis/compile        JARVIS v1.1 Build-time compile (the ONE
 *                                     thinking step): { filename, smId } ->
 *                                     { ok, ir, questions, cost, validation, meta }.
 *                                     Saves sm.compiledSequence into the project.
 *   POST   /api/jarvis/compile/approve  { filename, smId, approved } — engineer
 *                                     approval flag; approved:true flips
 *                                     /api/generate into translation mode for
 *                                     that station AND kicks off a background
 *                                     PRE-TRANSLATION (in-process; counted in
 *                                     activeGenerations; result saved to
 *                                     generated/<project>/ + sidecar
 *                                     <sm>__pretranslated.json). approved:false
 *                                     marks any pretranslation stale (files kept).
 *   GET    /api/jarvis/pretranslated  ?filename=&smId= -> { ready, fresh,
 *                                     inFlight, savedPath, buildId, validation, … }.
 *                                     fresh = built from the station's CURRENT
 *                                     compiledAt, still approved, validation ok.
 *                                     A fresh pretranslation makes
 *                                     /api/generate/stream return instantly
 *                                     (meta.mode='pretranslated').
 *                                     smId accepts SM id, name, or displayName
 *                                     (all generate/compile endpoints do).
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
 *   POST   /api/jarvis/examples       example intake (ask-for-examples doctrine):
 *                                     { filename, base64|content, topic?, requestId?,
 *                                     uploadedBy? } — saves to plc-reference/
 *                                     training-queue/, resolves the linked
 *                                     example-request question, and spawns an
 *                                     immediate curriculum study pass (~$1)
 *   GET    /api/jarvis/knowledge      { meKnowledge, rulesHeadings } — read-only
 *                                     view of what Jarvis knows (files on disk)
 *   GET    /api/jarvis/librarian/status  inbox librarian: unread count, last run,
 *                                     recent ledger lines, network watch state
 *   POST   /api/jarvis/librarian/run  process the JARVIS Inbox now ("Learn now");
 *                                     also runs on server start + daily timer
 *   GET    /api/jarvis/trackrecord    { version, history, benchmarks, generatedCount,
 *                                       firstPass: { eligible, shipped, rate, avgRoundsToShip } }
 *                                     — firstPass is Jarvis's HEADLINE number
 *                                     (first-pass ship rate; UI should headline it)
 *                                     — jarvisVersion.js HISTORY + benchmarks/*.report.json
 *
 *   GET    /api/jarvis/generations    review-grid rows: { builds, orphans } —
 *                                     every buildScores.json record + orphan
 *                                     generated/*.L5X files with no record
 *   POST   /api/jarvis/builds/:id/continue  resume a HELD generation (Dan's
 *                                     escalation model): optional inline
 *                                     { answers:[{questionId,answer,answeredBy}] }
 *                                     (recorded like the answer route), then
 *                                     re-enters the fix loop from the persisted
 *                                     resume state with the answers in context
 *                                     and completes through THE CHECK. Held
 *                                     builds carry build.help = { questions:
 *                                     [{id,question,proposedSolution,addressee}],
 *                                     status:'waiting'|'resumed'|'resolved' }.
 *   POST   /api/jarvis/builds/:id/approve-changes  { indexes?, approvedBy? } —
 *                                     approve the build's declared structural
 *                                     changes (build.structuralChanges:
 *                                     [{text,approved}]); all when indexes
 *                                     omitted. Unapproved changes never block
 *                                     the file — they persist visibly.
 *   GET    /api/jarvis/builds/:id/file[?which=corrected]  download a saved L5X
 *   POST   /api/jarvis/builds/:id/verify  { verifiedBy, note? } — mark a build
 *                                     engineer-verified-correct: copies its L5X
 *                                     into plc-reference/verified/ (the library
 *                                     preWriteStudy ranks above corrected and
 *                                     delivered exemplars), stamps the build
 *                                     record, registers sources + curriculum,
 *                                     appends the station changelog entry.
 *   POST   /api/jarvis/builds/:id/corrected  { base64, uploadedBy, replace? } —
 *                                     store the engineer's corrected L5X next to
 *                                     the original and learn from the diff in the
 *                                     background (correctionLearner.js: mechanical
 *                                     diff → one model call → lessons; high-
 *                                     confidence lessons append to
 *                                     jarvis-knowledge/concepts/*.md, low-
 *                                     confidence ones queue as questions)
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
      const parsed = JSON.parse(body); // validate JSON

      // PROJECT-IDENTITY GUARD (Aug 2026 data-eater fix, server-side belt &
      // braces): refuse to write a payload whose project name maps to a
      // DIFFERENT filename than the one being saved. This is the server half
      // of the client-side autosave identity check — a debounced save that
      // fires after a project switch must never land the previous project's
      // content under the new project's filename. Every legitimate save path
      // (saveCurrentProject, switchProject, createNewProject, renameProject,
      // importProject, tab snapshots) derives the filename from project.name
      // via the same sanitize rule, so a mismatch is always a bug, never a
      // valid save.
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
        const derived = (parsed.name.replace(/[^a-zA-Z0-9_\- ]/g, '')
          .replace(/\s+/g, '_').replace(/_+/g, '_').trim() || 'project') + '.json';
        if (derived.toLowerCase() !== safe.toLowerCase()) {
          console.warn(`[projects] REFUSED save: payload name "${parsed.name}" (→ ${derived}) does not match target file ${safe}`);
          return sendJson(res, 409, {
            error: `Project identity mismatch: payload is "${parsed.name}" (→ ${derived}) but target file is ${safe}. Save refused to prevent overwriting one project with another's content.`,
            code: 'PROJECT_IDENTITY_MISMATCH',
          });
        }
      }

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

  // ── Spec-sheet images — pictures the ME attaches are SPEC and persist ──────
  // forever (Dan, Aug 23: a pasted picture vanished; Aug 24: SECOND loss —
  // the old whole-set PUT let any client whose state was missing images
  // clobber the server copy). The server copy is AUTHORITATIVE and merges are
  // ADDITIVE: a PUT unions the incoming images with what the file already
  // holds (keyed by a content hash); an image only ever leaves the set via
  // the explicit `removed` hash list (the user's ✕). The merged set is
  // returned so the client can adopt anything it was missing.
  // Keyed by the sheet's draftId: projects/_sheet-images/<draftId>.json.
  const SHEET_IMAGES_DIR_ = path.join(DATA_DIR_, '_sheet-images');
  function sheetImagesPath(draftId) {
    const safe = /^[a-zA-Z0-9_-]{1,80}$/.test(String(draftId || '')) ? String(draftId) : null;
    return safe ? path.join(SHEET_IMAGES_DIR_, `${safe}.json`) : null;
  }

  // ── Sheet-draft MIRROR (Dan's second-vanish incident, 2026-08-27) ─────────
  // The client pushes the serialized draft (sans images) on every autosave so
  // a live incident is diagnosable from the SERVER copy — drafts no longer
  // live only in one browser's localStorage. Best-effort, last-write-wins.
  const SHEET_DRAFTS_DIR_ = path.join(DATA_DIR_, '_sheet-drafts');
  function sheetDraftPath(draftId) {
    const safe = /^[a-zA-Z0-9_-]{1,80}$/.test(String(draftId || '')) ? String(draftId) : null;
    return safe ? path.join(SHEET_DRAFTS_DIR_, `${safe}.json`) : null;
  }
  // SERVER = SINGLE SOURCE OF TRUTH (Dan, 2026-08-30: the 7-line recovery he
  // couldn't see): drafts live HERE with a monotonic rev; every write —
  // client autosave, agent turn, repair — broadcasts to subscribed pages,
  // which render the pushed state within ~1s. localStorage demotes to an
  // offline cache. Stale-DATA class dead; multi-user prerequisite in place.
  const draftSubs_ = new Map(); // draftId -> Set<res>
  function readDraftStore_(draftId) {
    const fp = sheetDraftPath(draftId);
    if (!fp || !fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
  }
  function broadcastDraft_(draftId, payload) {
    for (const sub of (draftSubs_.get(draftId) ?? [])) {
      try { sub.write(`event: draft\ndata: ${JSON.stringify(payload)}\n\n`); } catch (_) { /* drop */ }
    }
  }
  function writeDraftStore_(draftId, draft, { by = 'client', clientId = null } = {}) {
    const fp = sheetDraftPath(draftId);
    if (!fp) return null;
    fs.mkdirSync(SHEET_DRAFTS_DIR_, { recursive: true });
    const prev = readDraftStore_(draftId) ?? {};
    const rev = (Number(prev.rev) || 0) + 1;
    const record = { draftId, rev, updatedAt: Date.now(), updatedBy: by, mirroredAt: Date.now(), draft };
    fs.writeFileSync(fp, JSON.stringify(record));
    broadcastDraft_(draftId, { rev, updatedBy: by, clientId, draft });
    return rev;
  }
  async function handleSheetDraftPut(req, res) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const fp = sheetDraftPath(body.draftId);
      if (!fp) return sendJson(res, 400, { error: 'Invalid draftId' });
      if (!body.draft || typeof body.draft !== 'object') return sendJson(res, 400, { error: 'draft object required' });
      // Optimistic concurrency: a save based on a stale rev conflicts — the
      // client merges (his manual edits win; engine artifacts take the
      // newer server copy) and re-posts. Legacy clients (no baseRev) keep
      // last-write-wins so nothing breaks mid-rollout.
      const current = readDraftStore_(body.draftId);
      if (body.baseRev != null && current && Number(body.baseRev) < (Number(current.rev) || 0)) {
        return sendJson(res, 409, { ok: false, conflict: true, rev: current.rev, updatedBy: current.updatedBy ?? null, draft: current.draft });
      }
      const rev = writeDraftStore_(body.draftId, body.draft, { by: 'client', clientId: body.clientId ?? null });
      sendJson(res, 200, { ok: true, rev });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }
  function handleSheetDraftGet(res, query) {
    const fp = sheetDraftPath(query.draftId);
    if (!fp) return sendJson(res, 400, { error: 'Invalid draftId' });
    try {
      if (!fs.existsSync(fp)) return sendJson(res, 200, { ok: true, draft: null, rev: 0 });
      sendJson(res, 200, { ok: true, ...JSON.parse(fs.readFileSync(fp, 'utf8')) });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }
  /** GET /api/jarvis/draft-events?draftId&clientId — the page's live
   *  subscription: `draft` events on every store write (echoes carry the
   *  writer's clientId so a tab can ignore its own), pings every 15s. */
  function handleDraftEvents(req, res, query) {
    const draftId = String(query.draftId ?? '');
    if (!sheetDraftPath(draftId)) { return sendJson(res, 400, { error: 'Invalid draftId' }); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    if (!draftSubs_.has(draftId)) draftSubs_.set(draftId, new Set());
    draftSubs_.get(draftId).add(res);
    const current = readDraftStore_(draftId);
    try { res.write(`event: hello\ndata: ${JSON.stringify({ rev: Number(current?.rev) || 0 })}\n\n`); } catch (_) {}
    const ping = setInterval(() => { try { res.write(`event: ping\ndata: {}\n\n`); } catch (_) {} }, 15000);
    req.on('close', () => { clearInterval(ping); draftSubs_.get(draftId)?.delete(res); });
  }
  /** FNV-1a over the base64 payload — same function as the client's
   *  (createStationDrafts.imgHash). Content identity for union-by-hash. */
  function sheetImgHash(b64) {
    let h = 0x811c9dc5;
    for (let i = 0; i < b64.length; i++) {
      h ^= b64.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + '_' + b64.length.toString(36);
  }
  function readSheetImages(fp) {
    if (!fp || !fs.existsSync(fp)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      return Array.isArray(data.images) ? data.images.filter(i => i && typeof i.base64 === 'string' && i.base64) : [];
    } catch { return []; }
  }
  async function handleSheetImagesPut(req, res) {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const fp = sheetImagesPath(body.draftId);
      if (!fp) return sendJson(res, 400, { error: 'Invalid draftId' });
      const incoming = (Array.isArray(body.images) ? body.images : [])
        .filter(i => i && typeof i.base64 === 'string' && i.base64)
        .map(i => ({
          name: String(i.name || ''),
          mediaType: String(i.mediaType || 'image/png'),
          base64: i.base64,
        }));
      const removed = new Set(
        (Array.isArray(body.removed) ? body.removed : []).map(String).filter(Boolean)
      );
      // Additive union: existing (server-authoritative order) + new incoming.
      // ONLY the explicit `removed` hashes ever drop an image.
      const byHash = new Map();
      for (const img of readSheetImages(fp)) {
        const h = sheetImgHash(img.base64);
        if (!removed.has(h)) byHash.set(h, img);
      }
      for (const img of incoming) {
        const h = sheetImgHash(img.base64);
        if (!removed.has(h) && !byHash.has(h)) byHash.set(h, img);
      }
      // The store now holds ANY reference material (Dan, Aug 24): pictures,
      // .L5X code, PDFs/docs — same shape ({name, mediaType, base64}).
      const images = [...byHash.values()];
      const totalB64 = images.reduce((n, i) => n + i.base64.length, 0);
      if (totalB64 > 100 * 1024 * 1024) return sendJson(res, 413, { error: 'Reference material exceeds the 100MB total cap' });
      fs.mkdirSync(SHEET_IMAGES_DIR_, { recursive: true });
      fs.writeFileSync(fp, JSON.stringify({ draftId: body.draftId, savedAt: Date.now(), images }));
      sendJson(res, 200, {
        ok: true,
        count: images.length,
        hashes: [...byHash.keys()],
        removedAck: [...removed],
        images,
      });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }
  function handleSheetImagesGet(res, query) {
    const fp = sheetImagesPath(query.draftId);
    if (!fp) return sendJson(res, 400, { error: 'Invalid draftId' });
    if (!fs.existsSync(fp)) return sendJson(res, 200, { ok: true, images: [] });
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      sendJson(res, 200, { ok: true, images: Array.isArray(data.images) ? data.images : [] });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }
  function handleSheetImagesDelete(res, query) {
    const fp = sheetImagesPath(query.draftId);
    if (!fp) return sendJson(res, 400, { error: 'Invalid draftId' });
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      sendJson(res, 200, { ok: true });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
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

      // smId accepts id, name, or displayName — resolve to the stable id here
      // (buildIR matches by id only).
      const sm = findSm_(projectJson, body.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (body.smId || '(first)') });

      const releaseAi = beginAiWork_('generation', projectJson.name || null, sm.name);
      try {
        const result = await gen.generateL5X(projectJson, sm.id, body.options || {});
        sendJson(res, 200, result);
      } finally { releaseAi(); }
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

  // WHAT is running, not just how many — an in-memory map alongside the
  // counter, registered at the same acquire/release points (generation
  // stream, compile, pretranslation). GET /api/jarvis/active serves it so
  // the Generations grid can show live "Generating — Station X" rows.
  // Entries: { type: 'generation'|'compile'|'pretranslation', project, sm, startedAt }.
  const activeWork_ = new Map();
  let activeWorkSeq_ = 0;
  function registerActiveWork_(type, project, sm) {
    const id = 'w' + (++activeWorkSeq_);
    activeWork_.set(id, { type, project: project ?? null, sm: sm ?? null, startedAt: new Date().toISOString() });
    return id;
  }
  function updateActiveWork_(id, project, sm) {
    const w = activeWork_.get(id);
    if (w) { w.project = project ?? w.project; w.sm = sm ?? w.sm; }
  }
  function releaseActiveWork_(id) { activeWork_.delete(id); }

  // Restart-safety clock — the last time ANY model-calling route started or
  // finished work, exposed at GET /api/health as {lastAiRequestAt}.
  // DISCIPLINE (2026-08-24, after a pm2 restart killed Dan's in-flight
  // spec-sheet Build): agents/tooling must NOT restart this server unless
  // activeGenerations === 0 AND lastAiRequestAt is null or more than 60s old.
  let lastAiRequestAt = null;
  const touchAi_ = () => { lastAiRequestAt = new Date().toISOString(); };

  /** Count one in-flight AI request (ANY model-calling route — generation,
   *  compile, diagram build, spec, summarize, correction analysis, continue).
   *  Returns an idempotent release fn for a finally block. register: false
   *  keeps light calls (spec/summarize) out of the Generations grid's live
   *  rows while still gating restarts via activeGenerations. */
  function beginAiWork_(type, project, sm, { register = true } = {}) {
    activeGenerations++;
    touchAi_();
    const workId = register ? registerActiveWork_(type, project, sm) : null;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      touchAi_();
      activeGenerations = Math.max(0, activeGenerations - 1);
      if (workId) releaseActiveWork_(workId);
    };
  }

  // ── Escalation-model persistence helpers (shared by the generate stream
  //    and the held-build continue endpoint) ─────────────────────────────────

  const cleanPathPart_ = (s) => String(s || 'unnamed').replace(/[^a-zA-Z0-9_\-]/g, '_');

  /** Auto-save a generation result's L5X + structured IR to generated/<project>/.
   *  @returns {{ savedPath, savedIrPath }} (both null-able; failures logged) */
  function saveGeneratedResult_(result, projectJson, safe) {
    let savedPath = null;
    let savedIrPath = null;
    if (!result.l5x) return { savedPath, savedIrPath };
    try {
      const ver = result.meta?.jarvisVersion || '0';
      const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
      const dir = path.join(__dirname, 'generated', cleanPathPart_(projectJson.name || safe.replace('.json', '')));
      fs.mkdirSync(dir, { recursive: true });
      savedPath = path.join(dir, `${cleanPathPart_(result.meta?.smName)}__jarvis_v${ver}__${date}.L5X`);
      fs.writeFileSync(savedPath, result.l5x, 'utf8');
    } catch (e) {
      console.warn('[generate] auto-save failed:', e.message);
    }
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
    return { savedPath, savedIrPath };
  }

  /** HOLD-FOR-HELP persistence: file the held generation's questions (each
   *  with Jarvis's proposed solution + addressee) into the leads' queue, and
   *  save the resume state as a sidecar next to the generated files.
   *  @returns {{ helpRecord, resumePath }} — helpRecord matches the UI
   *  contract { questions:[{id, question, proposedSolution, addressee}],
   *  status:'waiting' }; both null on failure (logged, never thrown). */
  function persistHold_(result, projectJson, safe, smName) {
    if (!result.held || !Array.isArray(result.held.questions) || !result.held.questions.length) {
      return { helpRecord: null, resumePath: null };
    }
    try {
      const qr = require('./src/lib/agentGenerator/questionRouter.js');
      const arr = readQuestions();
      const buildRef = `${projectJson.name || safe.replace('.json', '')} / ${smName}`;
      const helpQuestions = result.held.questions.map(q => {
        const domain = qr.resolveQuestionDomain(q.domain, q.question);
        const entry = {
          id: 'q_help_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
          question: String(q.question).trim(),
          // Solutions, not explanations: Jarvis's best answer rides along.
          proposedSolution: q.proposedSolution != null ? String(q.proposedSolution) : null,
          addressee: qr.resolveAddressee(q.addressee, domain),
          kind: qr.resolveQuestionKind(q.kind),
          ...(q.derived ? { proposedSolutionDerived: true } : {}),
          context: `Hold-for-help — generation of ${buildRef} stopped: ${result.held.reason}`,
          source: 'generation',
          buildRef,
          domain,
          askedAt: new Date().toISOString(),
          status: 'open',
          priority: 1,
        };
        arr.push(entry);
        return { id: entry.id, question: entry.question, proposedSolution: entry.proposedSolution, addressee: entry.addressee };
      });
      writeQuestions(arr);

      const dir = path.join(__dirname, 'generated', cleanPathPart_(projectJson.name || safe.replace('.json', '')));
      fs.mkdirSync(dir, { recursive: true });
      const resumePath = path.join(dir, `${cleanPathPart_(smName)}__held__${Date.now().toString(36)}.resume.json`);
      // RESUME REPRESENTATION (documented decision): the generation prompt is
      // deterministic from project + template, so the resume file persists
      // only the session-unique state — the last edit plan, the last merged
      // L5X draft, the findings that forced the hold, and the question ids
      // whose answers unlock the resume. client.js re-seeds the conversation
      // from this on continue.
      fs.writeFileSync(resumePath, JSON.stringify({
        ...result.held.resume,
        projectFilename: safe,
        heldAt: new Date().toISOString(),
        reason: result.held.reason,
        questions: helpQuestions,
      }, null, 2), 'utf8');

      console.log(`[generate] build HELD for help: ${buildRef} — ${helpQuestions.length} question(s) filed, resume state at ${path.basename(resumePath)}`);
      return { helpRecord: { questions: helpQuestions, status: 'waiting' }, resumePath };
    } catch (e) {
      console.warn('[generate] hold-for-help persistence failed:', e.message);
      return { helpRecord: null, resumePath: null };
    }
  }

  /** STRUCTURAL-DELTA persistence: the winning plan declared deliberate
   *  changes vs the approved compiled sequence — write the PATCHED IR back
   *  onto sm.compiledSequence so the flowchart stays truthful (never silent
   *  divergence). The changes themselves ride on the build record
   *  ({text, approved:false}) for Dan's quick approve. */
  function persistStructuralChanges_(result, projectJson, safe, sm) {
    if (!(result.ok === true && Array.isArray(result.structuralChanges) && result.structuralChanges.length
          && result.patchedCompiledIr && sm.compiledSequence)) return;
    try {
      sm.compiledSequence.ir = result.patchedCompiledIr;
      sm.compiledSequence.structuralChanges = [
        ...(Array.isArray(sm.compiledSequence.structuralChanges) ? sm.compiledSequence.structuralChanges : []),
        ...result.structuralChanges.map(c => ({ text: c.text, approved: false, at: new Date().toISOString() })),
      ];
      saveProjectWithBackup_(safe, projectJson);
      console.log(`[generate] ${result.structuralChanges.length} declared structural change(s) applied to ${sm.name}'s compiled sequence (flagged for approval)`);
    } catch (e) {
      console.warn('[generate] structural-change IR persistence failed:', e.message);
    }
  }

  /** GET /api/generate/stream?filename=&smId= — SSE live-progress generation.
   *  One connection runs the whole pipeline: progress events stream as the
   *  model works, the final `done` event carries the full result payload
   *  (minus nothing — l5x included), and closing the connection aborts the
   *  in-flight SDK stream. On success the L5X is also written to
   *  generated/<project>/<sm>__jarvis_v<version>__<date>.L5X. */
  async function handleGenerateStream(req, res, query) {
    activeGenerations++;
    touchAi_();
    const workId = registerActiveWork_('generation'); // names filled in once the SM is resolved
    let counted = true;
    const releaseGeneration = () => {
      if (counted) { counted = false; touchAi_(); activeGenerations = Math.max(0, activeGenerations - 1); releaseActiveWork_(workId); }
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

      // smId accepts id, name, or displayName (buildIR matches by id only).
      const sm = findSm_(projectJson, query.smId);
      if (!sm) { send('error', { error: 'State machine not found: ' + (query.smId || '(first)') }); clearInterval(keepalive); releaseGeneration(); return res.end(); }
      updateActiveWork_(workId, projectJson.name || safe.replace('.json', ''), sm.name);

      // SHORT-CIRCUIT: a FRESH pretranslation (built in the background when
      // the engineer approved the compiled sequence) IS this exact result —
      // serve it instantly instead of re-running a paid translation. Stale
      // (sequence recompiled/edited or approval revoked) = ignored.
      try {
        const { rec, fresh } = pretransStatus_(projectJson, safe, sm);
        if (fresh) {
          const l5x = fs.readFileSync(rec.savedPath, 'utf8');

          // IMPORT-SIM GATE runs on EVERY serve (Aug 2026, Jason's second
          // import failure — AlarmList L5K array literal lost its closing
          // bracket): a cached file that would die at Studio 5000 import
          // NEVER leaves the pipeline. On failure the cached build is marked
          // not-ok and the full (self-repairing, gated) generation runs.
          const gate = require('./src/lib/agentGenerator/validator.js').validateL5X(l5x);
          if (!gate.ok) {
            console.warn('[generate] pretranslated file FAILED the import-sim gate — not serving it:',
              gate.errors.slice(0, 3).join(' | '));
            send('progress', { pct: 3, stage: 'gate',
              detail: `Cached pretranslated build failed the import-simulation gate (${gate.errors.length} error(s)) — running a fresh generation instead` });
            try {
              rec.ok = false;
              rec.validation = { ok: false, errors: gate.errors, warnings: gate.warnings };
              rec.note = ((rec.note || '') + ' [import-sim gate failed at serve time — superseded by fresh generation]').trim();
              fs.writeFileSync(pretransFileFor_(projectJson, safe, sm), JSON.stringify(rec, null, 2), 'utf8');
            } catch (e2) { console.warn('[generate] gate-failure persist failed:', e2.message); }
            throw new Error('pretranslated build failed the import-sim gate — full run proceeds');
          }

          // THE CHECK runs on EVERY path (Dan's doctrine): a pretranslated
          // file whose stored review never completed (verdict null/missing)
          // must not ship unreviewed. Run a review-only pass on the cached
          // file — far cheaper than re-generating — and persist the verdict.
          const reviewOn_ = String(process.env.JARVIS_INTERNAL_REVIEW || 'on').toLowerCase() !== 'off';
          const hasVerdict_ = ['ship', 'fix', 'unsure'].includes(rec.internalReview?.verdict);
          if (reviewOn_ && !hasVerdict_) {
            send('progress', { pct: 40, stage: 'review', detail: 'Pretranslated build found unreviewed — running the standards check (Is this in line with SDC standards?)' });
            try {
              const { reviewGenerated } = require('./src/lib/agentGenerator/internalReviewer.js');
              rec.internalReview = await reviewGenerated({ l5x, projectJson, smId: sm.id, buildId: rec.buildId || null });
            } catch (e2) {
              // Honest failure record — verdict null shows "review failed", never "clean".
              rec.internalReview = { verdict: null, error: e2.message || String(e2), findings: [], standardsQuestions: [], missingVsTemplate: [], summary: '' };
            }
            try {
              fs.writeFileSync(pretransFileFor_(projectJson, safe, sm), JSON.stringify(rec, null, 2), 'utf8');
            } catch (e2) { console.warn('[generate] pretranslation review persist failed:', e2.message); }
          }

          let ir = null;
          try { if (rec.savedIrPath) ir = JSON.parse(fs.readFileSync(rec.savedIrPath, 'utf8')); } catch (_) {}
          let reviewNotes = [];
          try { reviewNotes = gen.extractReviewNotes(l5x); } catch (_) {}
          send('progress', { pct: 100, stage: 'done', detail: `Pretranslated build served instantly (built ${rec.createdAt} on approval)` });
          send('done', {
            ok: rec.ok === true,
            l5x,
            validation: rec.validation,
            internalReview: rec.internalReview ?? null,
            reviewNotes,
            ir,
            meta: {
              mode: 'pretranslated',
              smName: sm.name,
              projectName: projectJson.name,
              jarvisVersion: rec.jarvisVersion,
              pretranslatedAt: rec.createdAt,
              compiledAt: rec.compiledAt,
              costEstimate: { totalUSD: 0, note: `no new spend — translation ($${rec.costUSD ?? '?'}) already ran at approval time` },
            },
            savedPath: rec.savedPath,
            savedIrPath: rec.savedIrPath,
            buildId: rec.buildId,
          });
          clearInterval(keepalive);
          releaseGeneration();
          return res.end();
        }
      } catch (e) { console.warn('[generate] pretranslation check failed (full run proceeds):', e.message); }

      send('progress', { pct: 2, stage: 'start', detail: `Loaded ${safe}` });
      const result = await gen.generateL5X(projectJson, sm.id, {
        onProgress, signal: abort.signal,
      });

      // Auto-save the generated program (+ structured IR) so the user always
      // knows where it is.
      const { savedPath, savedIrPath } = saveGeneratedResult_(result, projectJson, safe);

      // HOLD-FOR-HELP (Dan's escalation model): the fix loop stopped on the
      // round budget — file the questions (with proposed solutions), save the
      // resume state, and record the build as held (help.status 'waiting').
      const { helpRecord, resumePath } = persistHold_(result, projectJson, safe, result.meta?.smName || sm.name);

      // STRUCTURAL-DELTA: declared deviations update the approved compiled
      // sequence so diagram and code never silently diverge.
      persistStructuralChanges_(result, projectJson, safe, sm);

      send('progress', { pct: 100, stage: 'done', detail: result.held
        ? `Held for help — ${helpRecord ? helpRecord.questions.length : 0} question(s) filed (with proposed solutions)`
        : result.ok ? 'Generation complete' : 'Finished with validation errors' });
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
            // THE METRIC (first-pass doctrine): one write, zero fix rounds,
            // single review said ship. Aggregated by /api/jarvis/trackrecord.
            firstPassShip: result.firstPassShip ?? null,
            roundsToShip: result.roundsToShip ?? null,
            filePath: savedPath,
            mode: result.meta?.mode ?? null,
            // Pre-write study provenance — which exemplar was studied and why
            // (the dossier's "studied: <name> (<kind>, <family> family match)").
            study: result.meta?.study ?? null,
            // Pre-delivery internal review — Jarvis's own adversarial pass
            // against the template (client.js last stage). 'fix' = not ready
            // for external delivery until a human decides.
            internalReview: result.internalReview ?? null,
            // Escalation model (Dan, 2026-08) — exact UI contract shapes:
            writingNotes: result.writingNotes ?? [],
            structuralChanges: result.structuralChanges ?? [],
            help: helpRecord,
            resumePath,
          }).id;
        // 'unsure' filed standards questions before the build id existed —
        // stamp it on them now so the queue links back to this build.
        // Hold-for-help questions get the same back-link.
        const idsToStamp = [
          ...(result.internalReview?.questionIds || []),
          ...(helpRecord ? helpRecord.questions.map(q => q.id) : []),
        ];
        if (buildId && idsToStamp.length) {
          require('./src/lib/agentGenerator/internalReviewer.js')
            .attachBuildIdToQuestions(idsToStamp, buildId);
        }
      } catch (e) { console.warn('[generate] build record failed:', e.message); }
      send('done', { ...result, savedPath, savedIrPath, buildId, help: helpRecord });
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
      const sm = findSm_(projectJson, query.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (query.smId || '(first)') });

      // ?source=compiled — the Build-time compiled sequence stored ON the
      // project (JARVIS v1.1), not a generated-build .ir.json. Additive:
      // without the param, behavior below is unchanged.
      if (String(query.source || '') === 'compiled') {
        if (!sm.compiledSequence || !sm.compiledSequence.ir) {
          return sendJson(res, 404, {
            error: 'No compiled sequence yet — compile this station with Jarvis Build first',
            project: projectJson.name || safe.replace('.json', ''),
            smName: sm.name,
          });
        }
        return sendJson(res, 200, {
          file: null,
          source: 'compiled',
          smName: sm.name,
          compiledAt: sm.compiledSequence.compiledAt || null,
          approved: sm.compiledSequence.approved === true,
          jarvisVersion: sm.compiledSequence.jarvisVersion || null,
          cost: sm.compiledSequence.cost ?? null,
          questions: sm.compiledSequence.questions || [],
          ir: sm.compiledSequence.ir,
        });
      }

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

  // ── JARVIS v1.1 pipeline inversion: Build-time compile ─────────────────────
  //
  // Thinking happens ONCE, interactively, at Build time (compileSequence);
  // the compiled sequence is reviewed/edited by the engineer; approving it
  // flips /api/generate into near-mechanical translation mode. Nothing here
  // touches the existing generation path — with no compiledSequence on any
  // SM, every current endpoint behaves exactly as before.

  /** Locate an SM in a project by id, name, OR displayName (case-insensitive);
   *  first SM default. Every endpoint that takes an smId resolves through
   *  this — callers can pass whichever identifier they have. */
  function findSm_(projectJson, smId) {
    const sms = projectJson.stateMachines || [];
    const want = smId ? String(smId) : null;
    if (!want) return sms[0];
    const lc = want.toLowerCase();
    return sms.find(s => s.id === want) ||
           sms.find(s => (s.name || '').toLowerCase() === lc) ||
           sms.find(s => (s.displayName || '').toLowerCase() === lc);
  }

  /** Save a project object with the same last-5 auto-backup discipline as
   *  handleSave (which takes a raw body, so it can't be reused directly). */
  function saveProjectWithBackup_(safe, projectJson) {
    const filePath = path.join(DATA_DIR_, safe);
    if (fs.existsSync(filePath)) {
      const backupDir = path.join(DATA_DIR_, '_backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(backupDir, safe.replace('.json', `__${ts}.json`)));
      const prefix = safe.replace('.json', '__');
      const backups = fs.readdirSync(backupDir).filter(f => f.startsWith(prefix)).sort().reverse();
      for (const old of backups.slice(5)) fs.unlinkSync(path.join(backupDir, old));
    }
    fs.writeFileSync(filePath, JSON.stringify(projectJson, null, 2), 'utf8');
  }

  // ── Per-station build/change log (THE SPEED ARCHITECTURE, Dan 2026-08-25) ──
  // Every applied change — value patch, section patch, scoped recompile, full
  // compile, generate — appends one entry to machineSpec.changeLog so the ME
  // can see what ran, at what cost, and why ("value patch — no recompile" /
  // "re-planned Magnet Pick Head only"). The UI renders it; this is the record.
  // Entry: { when, what (one sentence), class, scope, cost, buildRef }.
  function appendChangeLog_(sm, entry) {
    if (!sm) return;
    sm.machineSpec = sm.machineSpec || {};
    if (!Array.isArray(sm.machineSpec.changeLog)) sm.machineSpec.changeLog = [];
    sm.machineSpec.changeLog.push({
      when: new Date().toISOString(),
      what: String(entry.what || '').trim(),
      class: entry.class || null,        // value | section | structural-sm | decomposition | compile | generate
      scope: entry.scope || null,        // what ran, human-readable
      cost: Number.isFinite(entry.cost) ? Number(entry.cost.toFixed ? entry.cost.toFixed(4) : entry.cost) : 0,
      buildRef: entry.buildRef || null,
    });
    // Cap: keep the last 300 entries (a station's whole life fits comfortably).
    if (sm.machineSpec.changeLog.length > 300) {
      sm.machineSpec.changeLog.splice(0, sm.machineSpec.changeLog.length - 300);
    }
  }

  /** Resolve the project FILE that carries a state machine by name — used by
   *  the summarize corrections path, whose body carries only sm.name. Newest
   *  file wins on ambiguity; null when nothing matches (changelog then skips —
   *  honest, never guessed). */
  function findProjectFileBySmName_(smName) {
    if (!smName) return null;
    const lc = String(smName).toLowerCase();
    let best = null;
    for (const f of fs.readdirSync(DATA_DIR_).filter(x => x.endsWith('.json'))) {
      try {
        const fp = path.join(DATA_DIR_, f);
        const pj = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const sm = (pj.stateMachines || []).find(s =>
          (s.name || '').toLowerCase() === lc || (s.displayName || '').toLowerCase() === lc);
        if (sm) {
          const mtime = fs.statSync(fp).mtimeMs;
          if (!best || mtime > best.mtime) best = { file: f, projectJson: pj, sm, mtime };
        }
      } catch (_) { /* unreadable project — skip */ }
    }
    return best;
  }

  /** Newest generated L5X for an SM (by mtime), or null. */
  function latestGeneratedL5xFor_(projectJson, safe, sm) {
    try {
      const dir = generatedDirFor_(projectJson, safe);
      if (!fs.existsSync(dir)) return null;
      const prefix = cleanGenName_(sm.name) + '__';
      let best = null;
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith(prefix) || !/\.L5X$/i.test(f) || /__corrected_by_/i.test(f)) continue;
        const fp = path.join(dir, f);
        const mtime = fs.statSync(fp).mtimeMs;
        if (!best || mtime > best.mtime) best = { fp, mtime };
      }
      return best ? best.fp : null;
    } catch (_) { return null; }
  }

  // ── EDIT CLASSIFICATION (THE SPEED ARCHITECTURE — Dan, 2026-08-25) ─────────
  //
  // "I can't iterate — every change takes 10 minutes and redoes everything.
  // It should only change what it needs to." Every corrections round through
  // the spec-sheet chat is CLASSIFIED before any expensive pipeline runs, and
  // the Send/Apply routes by class — the ME never chooses:
  //   value          → deterministic patch (sheet + generated L5X tag values),
  //                    NO planning model call. Seconds, $0.
  //   section        → scoped cheap-model sheet round (sonnet tier, scope
  //                    lock: only that section may change). Target <20 s.
  //   structural-sm  → normal sheet round + routing tells the client to
  //                    re-plan ONLY the affected machine (~2-4 min).
  //   decomposition  → normal sheet round + routing says full compile
  //                    (the only case that redoes everything).
  // Every applied round appends a machineSpec.changeLog entry stating the
  // class and what ran.
  const SECTION_MODEL_ = process.env.JARVIS_SECTION_MODEL || 'claude-sonnet-5';

  /** ONE ENGINE, CHECKED (Dan, 2026-08-28): every substantive corrections
   *  round runs thinker → CHECKER before it renders — did the revision apply
   *  every edit embedded in the feedback, the SDC way? fix → ONE bounce with
   *  the violations folded in, then surface honestly. Pure value patches
   *  (zero judgment) keep their deterministic fast path. */
  async function routeCorrectionRound_(author, body, opts = {}) {
    const result = await routeCorrectionRoundInner_(author, body, opts);
    const corrections = String(body.corrections ?? '').trim();
    if (!corrections || !body.sheetState || !result || !result.summary) return result;
    if (result.routing && result.routing.class === 'value') return result; // zero-judgment fast path
    try {
      const { checkProposal } = require('./src/lib/agentGenerator/smDecomposer.js');
      const chk = await checkProposal({
        kind: 'sheet-correction',
        payload: {
          engineersFeedback: corrections,
          changesMade: result.changesMade || [],
          chatReply: result.chatReply || '',
          revised: {
            devices: (result.summary.devices || []).map(d => ({ name: d && d.name, type: d && d.type })),
            sequence: result.summary.sequence || [],
            failureHandling: result.summary.failureHandling || [],
            interactions: result.summary.interactions || [],
          },
        },
        description: String(body.description || ''),
        signal: opts.signal || null,
      });
      let out = result;
      if (chk.verdict === 'fix' && chk.violations.length) {
        const bounced = await routeCorrectionRoundInner_(author, {
          ...body,
          corrections: corrections
            + '\n\nCHECKER FINDINGS (a second SDC engineer reviewed your previous attempt at this '
            + 'exact correction and found these misses — fix every one this time):\n- '
            + chk.violations.join('\n- '),
        }, opts);
        if (bounced && bounced.summary) out = bounced;
        out.checked = { verdict: 'fix', violations: chk.violations, bounced: true };
      } else {
        out.checked = { verdict: chk.verdict, violations: chk.violations };
      }
      if (out.meta) out.meta.costUSD = Number((((out.meta.costUSD || 0) + chk.meta.costUSD)).toFixed(4));
      return out;
    } catch (e) {
      result.checked = { verdict: 'unchecked', violations: ['checker unavailable: ' + e.message] };
      return result;
    }
  }

  async function routeCorrectionRoundInner_(author, body, { signal = null, onProgress = null } = {}) {
    const baseArgs = {
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
      sheetState: body.sheetState && typeof body.sheetState === 'object' ? body.sheetState : null,
      // FULL CONTEXT ON EVERY CHAT TURN (Dan, 2026-08-28): conversation,
      // cascade position, and recent actions ride every summarize call.
      chatHistory: Array.isArray(body.chatHistory) ? body.chatHistory : [],
      cascadePosition: body.cascadePosition && typeof body.cascadePosition === 'object' ? body.cascadePosition : null,
      changeLog: Array.isArray(body.changeLog) ? body.changeLog : [],
      signal, onProgress,
    };
    const corrections = baseArgs.corrections.trim();
    // Only classify real corrections rounds against a structured sheet — the
    // first summary and prose-only rounds keep the existing path byte-for-byte.
    if (!corrections || !baseArgs.sheetState) {
      return await author.summarizeDescription(baseArgs);
    }

    let cls = null;
    let located = null;
    try {
      const classifier = require('./src/lib/agentGenerator/editClassifier.js');
      located = findProjectFileBySmName_(body.sm && body.sm.name);
      const smSplit = located && located.sm.machineSpec ? located.sm.machineSpec.smSplit : null;
      cls = classifier.classifyEdit({ text: corrections, sheet: baseArgs.sheetState, smSplit });
      if (cls.confidence !== 'deterministic') {
        cls = await classifier.classifyEditWithModel({
          text: corrections, sheet: baseArgs.sheetState, smSplit, deterministic: cls, signal,
        });
      }

      // ── class a: VALUE — deterministic patch, no planning model call ──────
      if (cls.class === 'value' && cls.targets.length) {
        if (onProgress) { try { onProgress(30, 'writing'); } catch (_) {} }
        const { sheet, changesMade, unapplied } = classifier.applyValueTargetsToSheet(baseArgs.sheetState, cls.targets);
        if (!unapplied.length && changesMade.length) {
          let codeNote = null;
          // Generated code exists → patch the L5X tag values in place (merge
          // engine setTagData ops; no re-translate, THE CHECK not needed for
          // a pure preset/position value change — validation is structural).
          if (located) {
            try {
              const l5xPath = latestGeneratedL5xFor_(located.projectJson, located.file, located.sm);
              if (l5xPath) {
                const { patchValues } = require('./src/lib/agentGenerator/codePatcher.js');
                const l5x = fs.readFileSync(l5xPath, 'utf8');
                const patched = patchValues({ l5x, targets: cls.targets });
                const notes = [];
                if (patched.xml && patched.applied.length) {
                  fs.writeFileSync(l5xPath, patched.xml, 'utf8');
                  notes.push(`generated code patched in place (${patched.applied.map(a => a.via).join(', ')})`);
                }
                if (patched.hmiParams && patched.hmiParams.length) {
                  notes.push(`HMI parameter(s) — code carries no copy, no patch needed (${patched.hmiParams.map(a => a.via.split(' ')[0]).join(', ')})`);
                }
                if (patched.unresolved.length) {
                  notes.push(`NOT patched into code: ${patched.unresolved.map(u => `${u.name} (${u.why})`).join('; ')} — re-generate to pick these up`);
                }
                codeNote = notes.join('; ') || null;
              }
            } catch (e) { codeNote = 'generated code NOT patched — ' + e.message; }
            appendChangeLog_(located.sm, {
              what: changesMade.map(c => c.text).join('; '),
              class: 'value',
              scope: 'value patch — no recompile' + (codeNote ? `; ${codeNote}` : ''),
              cost: 0,
            });
            try { saveProjectWithBackup_(located.file, located.projectJson); } catch (_) {}
          }
          if (onProgress) { try { onProgress(100, 'done'); } catch (_) {} }
          return {
            summary: sheet,
            ...(baseArgs.priorCoverage ? { coverage: baseArgs.priorCoverage } : {}),
            questions: [],
            learnedFacts: [],
            nonStandardFlags: [],
            changesMade,
            chatReply: 'Done — ' + changesMade.map(c => c.text).join('; ') + '.',
            routing: {
              class: 'value', reason: cls.reason,
              ran: 'value patch — no recompile' + (codeNote ? `; ${codeNote}` : ''),
            },
            meta: { model: 'deterministic-value-patch', usage: null, costUSD: cls.classifierCostUSD || 0 },
          };
        }
        // Value-shaped but not fully resolvable → fall through to a scoped
        // section round (never land half a patch).
        cls = { ...cls, class: 'section', section: cls.section || 'devices', reason: cls.reason + ' (partial resolution — routed to a scoped model round)' };
      }

      // ── class b: SECTION — scoped cheap-model round ────────────────────────
      if (cls.class === 'section') {
        const result = await author.summarizeDescription({
          ...baseArgs,
          modelOverride: SECTION_MODEL_,
          sectionScope: cls.section || null,
        });
        if (located) {
          appendChangeLog_(located.sm, {
            what: (result.changesMade || []).map(c => c.text).join('; ') || corrections.slice(0, 140),
            class: 'section',
            scope: `section patch (${cls.section || 'auto'}) — ${SECTION_MODEL_}, no recompile`,
            cost: result.meta && result.meta.costUSD || 0,
          });
          try { saveProjectWithBackup_(located.file, located.projectJson); } catch (_) {}
        }
        return { ...result, routing: { class: 'section', section: cls.section, reason: cls.reason, ran: `scoped ${SECTION_MODEL_} round — no recompile` } };
      }

      // ── class c/d: STRUCTURAL — normal sheet round + recompile routing ─────
      const result = await author.summarizeDescription(baseArgs);
      const routing = cls.class === 'structural-sm'
        ? { class: 'structural-sm', machine: cls.machine, reason: cls.reason,
            ran: 'sheet updated', recompile: { scope: 'machine', machine: cls.machine } }
        : { class: 'decomposition', reason: cls.reason,
            ran: 'sheet updated', recompile: { scope: 'full' } };
      if (located) {
        appendChangeLog_(located.sm, {
          what: (result.changesMade || []).map(c => c.text).join('; ') || corrections.slice(0, 140),
          class: cls.class,
          scope: cls.class === 'structural-sm'
            ? `sheet updated — re-plan ${cls.machine || 'the affected machine'} pending`
            : 'sheet updated — full compile pending (SM boundaries changed)',
          cost: result.meta && result.meta.costUSD || 0,
        });
        try { saveProjectWithBackup_(located.file, located.projectJson); } catch (_) {}
      }
      return { ...result, routing };
    } catch (e) {
      // Classification must never break the corrections chat — on any routing
      // failure, fall back to the existing full path (honest note attached).
      console.warn('[jarvis-edit-classifier] routing failed, falling back to full round:', e.message);
      const result = await author.summarizeDescription(baseArgs);
      return { ...result, routing: { class: cls ? cls.class : null, error: e.message, ran: 'full round (classifier fallback)' } };
    }
  }

  /** POST /api/jarvis/compile — body: { filename, smId }. Runs the ONE
   *  Build-time reasoning call (coordinationAuthor.compileSequence), saves
   *  sm.compiledSequence = { ir, compiledAt, jarvisVersion, approved:false,
   *  cost, questions } into the project file, returns { ir, questions, cost }. */
  async function handleJarvisCompile(req, res) {
    let author;
    try {
      author = require('./src/lib/agentGenerator/coordinationAuthor.js');
    } catch (e) {
      return sendJson(res, 503, { error: 'Coordination compiler not available — run npm install: ' + e.message });
    }
    // Compiles are paid model runs too — they MUST count as active work so the
    // health check protects them from restarts (a compile was killed mid-run
    // on 2026-08-20 because only generations were counted).
    activeGenerations++;
    touchAi_();
    const compileWorkId = registerActiveWork_('compile');
    let compileCounted = true;
    const releaseCompile = () => {
      if (compileCounted) { compileCounted = false; touchAi_(); activeGenerations = Math.max(0, activeGenerations - 1); releaseActiveWork_(compileWorkId); }
    };
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const safe = safeFilename(body.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sm = findSm_(projectJson, body.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (body.smId || '(first)') });
      updateActiveWork_(compileWorkId, projectJson.name || safe.replace('.json', ''), sm.name);

      // Change notes ride into the compile (fixing the silent drop the modal
      // warned about — "compiler didn't confirm it used your change notes").
      const corrections = String(body.corrections || '').trim();
      let result = await author.compileSequence({ projectJson, smId: sm.id, corrections });

      // SELF-CONSISTENCY GUARD (Dan's three-truths screenshot, 2026-08-25:
      // reasoning said "four programs", stateMachines[] carried 2): a compile
      // whose own reasoning disagrees with its machine list is rejected and
      // retried ONCE with a corrective note. A persistent mismatch ships with
      // an explicit inconsistency flag so the client renders the error state
      // instead of ever mixing the contradiction.
      const decompositionMismatch_ = (ir) => {
        try {
          const flags = (ir && ir.reviewFlags ? ir.reviewFlags : []).map(String);
          const machines = ir && ir.multiSm && Array.isArray(ir.stateMachines) ? ir.stateMachines.length : 0;
          if (machines < 2) return null;
          const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
          for (const f of flags) {
            const m = f.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:state\s*machines?|programs?|machines?)\b/i);
            if (!m) continue;
            const claimed = Number(m[1]) || WORDS[m[1].toLowerCase()] || 0;
            if (claimed >= 2 && claimed !== machines) return { claimed, actual: machines, flag: f.slice(0, 160) };
          }
          return null;
        } catch (_) { return null; }
      };
      let mismatch = decompositionMismatch_(result.ir);
      if (mismatch) {
        console.warn(`[jarvis-compile] inconsistent decomposition (reasoning says ${mismatch.claimed}, list has ${mismatch.actual}) — one retry`);
        const fix = (corrections ? corrections + '\n' : '')
          + `CONSISTENCY REJECTION: your previous output was internally inconsistent — the reasoning claimed ${mismatch.claimed} `
          + `state machines but stateMachines[] contained ${mismatch.actual}. Re-propose so the machine list, the count and the `
          + `reasoning all agree (and actually emit every machine you reason about).`;
        result = await author.compileSequence({ projectJson, smId: sm.id, corrections: fix });
        mismatch = decompositionMismatch_(result.ir);
        if (mismatch) {
          result.ir = result.ir || {};
          result.ir.inconsistentDecomposition = mismatch; // client renders the error state, never the mix
        }
      }

      // Compile questions arrive domain-tagged ({ question, domain }) from
      // coordinationAuthor; older shapes (plain strings) are normalized here.
      // compiledSequence + the response keep the plain string list (existing
      // consumers render strings); the queue filing below keeps the domain.
      const compileQuestionList = (result.questions || [])
        .map(q => (q && typeof q === 'object')
          ? { question: String(q.question || '').trim(), domain: q.domain,
              proposedSolution: q.proposedSolution != null ? String(q.proposedSolution).trim() || null : null,
              addressee: q.addressee }
          : { question: String(q || '').trim(), domain: undefined, proposedSolution: null, addressee: undefined })
        .filter(q => q.question)
        .map(q => {
          const qr = require('./src/lib/agentGenerator/questionRouter.js');
          const domain = qr.resolveQuestionDomain(q.domain, q.question, sm.displayName || sm.name);
          return {
            question: q.question,
            // Solutions, not explanations (Dan, 2026-08-22): the compile
            // prompt REQUIRES a proposed solution with every question.
            proposedSolution: q.proposedSolution,
            addressee: qr.resolveAddressee(q.addressee, domain),
            domain,
          };
        });
      const compileQuestionStrings = compileQuestionList.map(q => q.question);

      sm.compiledSequence = {
        ir: result.ir,
        compiledAt: new Date().toISOString(),
        jarvisVersion: result.meta.compilerVersion,
        approved: false,   // engineer must review + approve before Generate translates
        cost: result.cost,
        questions: compileQuestionStrings,
        ...(result.consumedNotes && result.consumedNotes.length ? { consumedNotes: result.consumedNotes } : {}),
      };
      appendChangeLog_(sm, {
        what: corrections
          ? `Full compile with change notes: ${corrections.slice(0, 140)}`
          : 'Full station compile',
        class: corrections ? 'decomposition' : 'compile',
        scope: result.ir && result.ir.multiSm
          ? `full compile — all ${(result.ir.stateMachines || []).length} machines re-planned`
          : 'full compile',
        cost: result.cost,
        buildRef: sm.compiledSequence.compiledAt,
      });
      saveProjectWithBackup_(safe, projectJson);

      // Compile questions also land in the Jarvis question queue — every one
      // domain-tagged (mechanical questions never belong here; the classifier
      // is a backstop for prompt drift). Answers flow into meKnowledge.md via
      // the existing route. Before filing anything new: stale-question
      // hygiene — close this station's open questions whose premise is gone
      // (e.g. "values are placeholders" after the position tables got real
      // values). Closed entries stay in the queue as history.
      try {
        const qr = require('./src/lib/agentGenerator/questionRouter.js');
        const arr = readQuestions();
        const swept = qr.closeStaleQuestionsForStation(arr, sm);
        if (swept.length) {
          console.log(`[jarvis-compile] stale-question sweep closed ${swept.length} question(s) for ${sm.displayName || sm.name}: ${swept.map(q => q.id).join(', ')}`);
        }
        const qs = compileQuestionList.filter(Boolean);
        for (const { question, domain, proposedSolution, addressee } of qs) {
          arr.push({
            id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
            question,
            proposedSolution: proposedSolution ?? null,
            addressee,
            context: `Station ${sm.displayName || sm.name} — compile of ${projectJson.name || safe}`,
            source: 'generation',
            domain,
            askedAt: new Date().toISOString(),
            status: 'open',
          });
        }
        if (qs.length || swept.length) writeQuestions(arr);
      } catch (e) { console.warn('[jarvis-compile] question queue push failed:', e.message); }

      sendJson(res, 200, {
        ok: result.validation.ok,
        ir: result.ir,
        questions: compileQuestionStrings,
        cost: result.cost,
        validation: result.validation,
        // Change-notes acknowledgment (the modal checks correctionsApplied /
        // meta.correctionsApplied and warns when absent).
        ...(corrections ? { correctionsApplied: result.meta.correctionsApplied === true, consumedNotes: result.consumedNotes || [] } : {}),
        meta: result.meta,
      });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') { releaseCompile(); return sendJson(res, 503, { error: e.message }); }
      // Always log compile failures server-side — a swallowed 500 cost a
      // 4.5-minute paid run with no diagnosable trace (2026-08-20).
      console.error('[jarvis-compile] FAILED:', e && e.stack ? e.stack : e);
      sendJson(res, 500, { error: e.message });
    } finally {
      releaseCompile();
    }
  }

  /** POST /api/jarvis/recompile-machine — body: { filename, smId, machine,
   *  correction }. THE SPEED ARCHITECTURE class c handler: re-plans ONLY the
   *  named machine of a multi-SM compiled sequence (~2-4 min, effort medium);
   *  every other machine is carried forward byte-identical and the handshake
   *  contract is re-validated cheaply. Persists like a compile (approved:false
   *  — the ME re-approves the changed decomposition). */
  async function handleJarvisRecompileMachine(req, res) {
    let author;
    try {
      author = require('./src/lib/agentGenerator/coordinationAuthor.js');
    } catch (e) {
      return sendJson(res, 503, { error: 'Coordination compiler not available: ' + e.message });
    }
    activeGenerations++;
    touchAi_();
    const workId = registerActiveWork_('compile');
    let counted = true;
    const release = () => {
      if (counted) { counted = false; touchAi_(); activeGenerations = Math.max(0, activeGenerations - 1); releaseActiveWork_(workId); }
    };
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const safe = safeFilename(body.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sm = findSm_(projectJson, body.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (body.smId || '(first)') });
      if (!body.machine) return sendJson(res, 400, { error: 'machine is required (a planned machine name from the compiled decomposition)' });
      if (!String(body.correction || '').trim()) return sendJson(res, 400, { error: 'correction is required' });
      updateActiveWork_(workId, projectJson.name || safe.replace('.json', ''), `${sm.name} / ${body.machine}`);

      const result = await author.recompileMachine({
        projectJson, smId: sm.id,
        machineName: String(body.machine),
        correction: String(body.correction).trim(),
      });

      sm.compiledSequence = {
        ...(sm.compiledSequence || {}),
        ir: result.ir,
        compiledAt: new Date().toISOString(),
        jarvisVersion: result.meta.compilerVersion,
        approved: false, // scoped change still needs the ME's re-approve
        cost: result.cost,
        ...(result.consumedNotes.length ? { consumedNotes: result.consumedNotes } : {}),
      };
      appendChangeLog_(sm, {
        what: `Re-planned ${result.machine} only: ${String(body.correction).trim().slice(0, 120)}`,
        class: 'structural-sm',
        scope: result.meta.scope,
        cost: result.cost,
        buildRef: sm.compiledSequence.compiledAt,
      });
      saveProjectWithBackup_(safe, projectJson);

      sendJson(res, 200, {
        ok: result.validation.ok,
        ir: result.ir,
        machine: result.machine,
        validation: result.validation,
        correctionsApplied: result.meta.correctionsApplied === true,
        consumedNotes: result.consumedNotes,
        cost: result.cost,
        meta: result.meta,
      });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') { release(); return sendJson(res, 503, { error: e.message }); }
      console.error('[jarvis-recompile-machine] FAILED:', e && e.stack ? e.stack : e);
      sendJson(res, 500, { error: e.message });
    } finally {
      release();
    }
  }

  /** POST /api/jarvis/patch-code — body: { filename, smId, correction }.
   *  Generation incrementality for VALUE/SECTION changes when code already
   *  exists: ONE scoped model call authors a small edit plan against the
   *  CURRENT generated L5X (never the template), merged deterministically,
   *  validated, then re-reviewed DELTA-SCOPED (THE CHECK runs only on the
   *  changed rungs). Full re-translate stays reserved for structural changes. */
  async function handleJarvisPatchCode(req, res) {
    activeGenerations++;
    touchAi_();
    const workId = registerActiveWork_('generation');
    let counted = true;
    const release = () => {
      if (counted) { counted = false; touchAi_(); activeGenerations = Math.max(0, activeGenerations - 1); releaseActiveWork_(workId); }
    };
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const safe = safeFilename(body.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sm = findSm_(projectJson, body.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (body.smId || '(first)') });
      if (!String(body.correction || '').trim()) return sendJson(res, 400, { error: 'correction is required' });
      const l5xPath = latestGeneratedL5xFor_(projectJson, safe, sm);
      if (!l5xPath) return sendJson(res, 404, { error: 'No generated L5X for this station — generate first (nothing to patch)' });
      updateActiveWork_(workId, projectJson.name || safe.replace('.json', ''), sm.name);

      const { patchSection } = require('./src/lib/agentGenerator/codePatcher.js');
      const l5x = fs.readFileSync(l5xPath, 'utf8');
      const result = await patchSection({
        l5x,
        correction: String(body.correction).trim(),
        compiledIr: (sm.compiledSequence && sm.compiledSequence.ir) || null,
        projectJson, smId: sm.id,
      });
      if (result.ok && result.xml) {
        fs.writeFileSync(l5xPath, result.xml, 'utf8');
        appendChangeLog_(sm, {
          what: `Code patch: ${String(body.correction).trim().slice(0, 120)}`,
          class: 'section',
          scope: `scoped edit plan on ${path.basename(l5xPath)} (${(result.editPlan.operations || []).length} op(s)); delta-scoped review: ${result.review ? result.review.verdict || 'did not run' : 'did not run'}`,
          cost: result.costUSD,
          buildRef: path.basename(l5xPath),
        });
        saveProjectWithBackup_(safe, projectJson);
      }
      sendJson(res, result.ok ? 200 : 422, {
        ok: result.ok,
        file: path.basename(l5xPath),
        validation: result.validation,
        review: result.review,
        editPlanOps: result.editPlan ? (result.editPlan.operations || []).length : 0,
        cost: result.costUSD,
        ...(result.error ? { error: result.error } : {}),
      });
    } catch (e) {
      if (e && e.code === 'AI_NOT_CONFIGURED') { release(); return sendJson(res, 503, { error: e.message }); }
      console.error('[jarvis-patch-code] FAILED:', e && e.stack ? e.stack : e);
      sendJson(res, 500, { error: e.message });
    } finally {
      release();
    }
  }

  /** GET /api/jarvis/changelog?filename=&smId= — the per-station build/change
   *  log (machineSpec.changeLog), newest first. The UI renders it. */
  function handleJarvisChangelog(req, res, query) {
    try {
      const safe = safeFilename(query.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sm = findSm_(projectJson, query.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (query.smId || '(first)') });
      const log = (sm.machineSpec && Array.isArray(sm.machineSpec.changeLog)) ? sm.machineSpec.changeLog : [];
      sendJson(res, 200, { ok: true, sm: sm.name, entries: [...log].reverse() });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  }

  /** POST /api/jarvis/compile/approve — body: { filename, smId, approved }.
   *  Approving is the engineer's "I agree with everything to this point":
   *  the next Generate runs in translation mode against this sequence. */
  async function handleJarvisCompileApprove(req, res) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const safe = safeFilename(body.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sm = findSm_(projectJson, body.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (body.smId || '(first)') });
      if (!sm.compiledSequence || !sm.compiledSequence.ir) {
        return sendJson(res, 404, { error: 'No compiled sequence on this station — compile it first' });
      }
      sm.compiledSequence.approved = body.approved === true;
      sm.compiledSequence.approvedAt = body.approved === true ? new Date().toISOString() : null;
      saveProjectWithBackup_(safe, projectJson);

      // Dan's directive: "once approved, start building the code in the
      // background — you know you're going to need it." Approval kicks off a
      // server-side PRE-TRANSLATION; /api/generate/stream serves it in <1s
      // when it's still fresh. Un-approval invalidates (marks stale, keeps
      // files) any existing pretranslation.
      let pretranslation = null;
      if (body.approved === true) {
        pretranslation = pretransInFlight_.has(safe + '::' + sm.id) ? 'already-running' : 'started';
        if (pretranslation === 'started') {
          setImmediate(() => runPretranslation_(safe, projectJson, sm)
            .catch(e => console.warn('[pretranslate] unhandled failure:', e.message)));
        }
      } else {
        pretranslation = invalidatePretranslation_(safe, projectJson, sm) ? 'invalidated' : 'none';
      }

      sendJson(res, 200, { ok: true, smName: sm.name, approved: sm.compiledSequence.approved, pretranslation });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  }

  // ── JARVIS v2.1: background pre-translation on approval ────────────────────
  //
  // The moment an engineer approves a compiled sequence, the translation is
  // going to be needed — so it runs immediately, in-process, tagged with the
  // compiledAt hash it was built from. A sidecar record at
  // generated/<project>/<sm>__pretranslated.json makes it restart-safe.
  // Freshness = ready + not stale + validation ok + compiledAt still matches
  // the station's current compiledSequence + station still approved. A stale
  // pretranslation is simply ignored (files kept) and a full translate runs.

  const pretransInFlight_ = new Set(); // `${filename}::${smId}`

  const cleanGenName_ = (s) => String(s || 'unnamed').replace(/[^a-zA-Z0-9_\-]/g, '_');
  function generatedDirFor_(projectJson, safe) {
    return path.join(__dirname, 'generated', cleanGenName_(projectJson.name || safe.replace('.json', '')));
  }
  function pretransFileFor_(projectJson, safe, sm) {
    return path.join(generatedDirFor_(projectJson, safe), cleanGenName_(sm.name) + '__pretranslated.json');
  }
  function readPretranslation_(projectJson, safe, sm) {
    try { return JSON.parse(fs.readFileSync(pretransFileFor_(projectJson, safe, sm), 'utf8')); }
    catch (_) { return null; }
  }
  /** Freshness verdict for a station's pretranslation record. */
  function pretransStatus_(projectJson, safe, sm) {
    const rec = readPretranslation_(projectJson, safe, sm);
    const cs = sm.compiledSequence || {};
    const ready = Boolean(rec && rec.ready && rec.savedPath && fs.existsSync(rec.savedPath));
    const fresh = ready && rec.stale !== true && rec.ok === true &&
      cs.approved === true && Boolean(rec.compiledAt) && rec.compiledAt === cs.compiledAt;
    return { rec, ready, fresh };
  }
  /** Mark an existing pretranslation stale (files kept). Returns true if one existed. */
  function invalidatePretranslation_(safe, projectJson, sm) {
    const rec = readPretranslation_(projectJson, safe, sm);
    if (!rec) return false;
    rec.stale = true;
    rec.staleAt = new Date().toISOString();
    rec.staleReason = 'approval revoked';
    try { fs.writeFileSync(pretransFileFor_(projectJson, safe, sm), JSON.stringify(rec, null, 2), 'utf8'); }
    catch (e) { console.warn('[pretranslate] invalidate write failed:', e.message); return false; }
    return true;
  }

  /** Run the normal translation pipeline in the background and persist the
   *  result. Counts in activeGenerations so nobody restarts the server over
   *  a paid in-flight run. Never throws to the caller. */
  async function runPretranslation_(safe, projectJson, sm) {
    const key = safe + '::' + sm.id;
    if (pretransInFlight_.has(key)) return;
    let gen;
    try { gen = require('./src/lib/agentGenerator/client.js'); }
    catch (e) { console.warn('[pretranslate] agentGenerator unavailable:', e.message); return; }

    pretransInFlight_.add(key);
    activeGenerations++;
    touchAi_();
    const pretransWorkId = registerActiveWork_('pretranslation', projectJson.name || safe.replace('.json', ''), sm.name);
    const startedAt = Date.now();
    const compiledAt = sm.compiledSequence?.compiledAt || null;
    const sidecarPath = pretransFileFor_(projectJson, safe, sm);
    console.log(`[pretranslate] started: ${projectJson.name || safe} / ${sm.name} (compiledAt ${compiledAt})`);
    try {
      const result = await gen.generateL5X(projectJson, sm.id, {});
      const durationS = Math.round((Date.now() - startedAt) / 1000);

      let savedPath = null, savedIrPath = null, buildId = null;
      if (result.l5x) {
        const ver = result.meta?.jarvisVersion || '0';
        const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
        const dir = generatedDirFor_(projectJson, safe);
        fs.mkdirSync(dir, { recursive: true });
        savedPath = path.join(dir, `${cleanGenName_(sm.name)}__jarvis_v${ver}__${date}.L5X`);
        fs.writeFileSync(savedPath, result.l5x, 'utf8');
        if (result.ir && result.ir.irVersion) {
          try {
            savedIrPath = savedPath.replace(/\.L5X$/i, '.ir.json');
            fs.writeFileSync(savedIrPath, JSON.stringify({
              ...result.ir,
              generatedAt: new Date().toISOString(),
              jarvisVersion: result.meta?.jarvisVersion ?? null,
              l5xFile: path.basename(savedPath),
              validationOk: result.ok === true,
              pretranslated: true,
              compiledAt,
            }, null, 2), 'utf8');
          } catch (e) { savedIrPath = null; console.warn('[pretranslate] IR save failed:', e.message); }
        }
        try {
          buildId = require('./src/lib/agentGenerator/buildScores.js').recordBuild(
            path.join(__dirname, 'jarvis-knowledge', 'buildScores.json'), {
              project: projectJson.name || safe.replace('.json', ''),
              sm: sm.name,
              jarvisVersion: result.meta?.jarvisVersion ?? null,
              costUSD: result.meta?.costEstimate?.totalUSD ?? null,
              durationS,
              attempts: result.meta?.attempts?.length ?? null,
              validationOk: result.ok === true,
              firstPassShip: result.firstPassShip ?? null,
              roundsToShip: result.roundsToShip ?? null,
              filePath: savedPath,
              mode: 'translation',
              pretranslated: true,
              // Pre-write study provenance — the recorded exemplar pick + why.
              study: result.meta?.study ?? null,
              internalReview: result.internalReview ?? null,
            }).id;
          // An 'unsure' verdict filed standards questions before the build id
          // existed — stamp it on them now so the queue links back to the build.
          if (buildId && result.internalReview?.questionIds?.length) {
            require('./src/lib/agentGenerator/internalReviewer.js')
              .attachBuildIdToQuestions(result.internalReview.questionIds, buildId);
          }
        } catch (e) { console.warn('[pretranslate] build record failed:', e.message); }
      }

      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, JSON.stringify({
        pretranslated: true,
        ready: Boolean(result.l5x),
        ok: result.ok === true,
        stale: false,
        project: projectJson.name || safe.replace('.json', ''),
        smId: sm.id,
        smName: sm.name,
        compiledAt,
        mode: result.meta?.mode ?? null,
        jarvisVersion: result.meta?.jarvisVersion ?? null,
        savedPath, savedIrPath, buildId,
        validation: result.validation ?? null,
        internalReview: result.internalReview ?? null,
        costUSD: result.meta?.costEstimate?.totalUSD ?? null,
        durationS,
        attempts: result.meta?.attempts?.length ?? null,
        createdAt: new Date().toISOString(),
        error: null,
      }, null, 2), 'utf8');
      console.log(`[pretranslate] done: ${sm.name} in ${durationS}s — ok=${result.ok === true}, saved ${savedPath}`);
    } catch (e) {
      console.warn(`[pretranslate] failed for ${sm.name}:`, e.message);
      try {
        fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
        fs.writeFileSync(sidecarPath, JSON.stringify({
          pretranslated: true, ready: false, ok: false, stale: false,
          project: projectJson.name || safe.replace('.json', ''),
          smId: sm.id, smName: sm.name, compiledAt,
          savedPath: null, savedIrPath: null, buildId: null, validation: null,
          createdAt: new Date().toISOString(),
          error: e.message || String(e),
        }, null, 2), 'utf8');
      } catch (e2) { console.warn('[pretranslate] sidecar write failed:', e2.message); }
    } finally {
      touchAi_();
      activeGenerations = Math.max(0, activeGenerations - 1);
      releaseActiveWork_(pretransWorkId);
      pretransInFlight_.delete(key);
    }
  }

  /** GET /api/jarvis/pretranslated?filename=&smId= — is a pretranslated build
   *  ready, and is it FRESH (built from the station's CURRENT compiledAt,
   *  still approved, validation ok)? */
  function handleJarvisPretranslated(res, query) {
    try {
      const safe = safeFilename(query.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sm = findSm_(projectJson, query.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (query.smId || '(first)') });

      const { rec, ready, fresh } = pretransStatus_(projectJson, safe, sm);
      sendJson(res, 200, {
        ready, fresh,
        inFlight: pretransInFlight_.has(safe + '::' + sm.id),
        stale: rec ? rec.stale === true : false,
        savedPath: rec?.savedPath ?? null,
        savedIrPath: rec?.savedIrPath ?? null,
        buildId: rec?.buildId ?? null,
        validation: rec?.validation ?? null,
        ok: rec?.ok ?? null,
        internalReview: rec?.internalReview ?? null,
        compiledAt: rec?.compiledAt ?? null,
        currentCompiledAt: sm.compiledSequence?.compiledAt ?? null,
        approved: sm.compiledSequence?.approved === true,
        jarvisVersion: rec?.jarvisVersion ?? null,
        costUSD: rec?.costUSD ?? null,
        durationS: rec?.durationS ?? null,
        error: rec?.error ?? null,
      });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  }

  // ── JARVIS describe-your-station -> diagram draft ──────────────────────────

  /** SM-split guard (SUPREME LAW extends to diagrams, Dan 2026-08-25): when a
   *  station's compile decomposed it into multiple state machines (recorded as
   *  machineSpec.smSplit and/or compiledSequence.ir.multiSm on its SMs), a
   *  single-SM re-author of THAT STATION is an architecture-standard violation
   *  ("each program must have no more than one state machine") — the braid is
   *  never emitted; the request is HELD with the standard-violation message.
   *  Rebuilding ONE MEMBER of the split (e.g. MagnetLoad of S01_MagnetLoad +
   *  S02_MagnetPickHead) stays allowed — that IS one state machine.
   *  Returns null (no conflict) or { message, splitNames, file }. */
  function findSmSplitConflict_(station) {
    const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = [norm(station?.name), norm(station?.displayName)].filter(Boolean);
    if (!keys.length) return null;
    let files = [];
    try {
      files = fs.readdirSync(DATA_DIR_).filter(f => f.endsWith('.json'));
    } catch (_) { return null; }
    for (const f of files) {
      let proj;
      try { proj = JSON.parse(fs.readFileSync(path.join(DATA_DIR_, f), 'utf8')); } catch (_) { continue; }
      for (const sm of proj?.stateMachines ?? []) {
        const split = (Array.isArray(sm?.machineSpec?.smSplit) && sm.machineSpec.smSplit.length >= 2)
          ? sm.machineSpec.smSplit
          : (sm?.compiledSequence?.ir?.multiSm && (sm.compiledSequence.ir.stateMachines ?? []).length >= 2)
            ? sm.compiledSequence.ir.stateMachines
            : null;
        if (!split) continue;
        const splitNames = split
          .map(e => norm(e?.name ?? e?.programName ?? e?.smName)).filter(Boolean);
        // Rebuilding one member of the split as one SM is legitimate.
        const isMember = keys.some(k => splitNames.some(n => n === k || n.includes(k) || k.includes(n)));
        if (isMember) continue;
        // Names the PARENT (pre-split combined station) is known by.
        const from = sm?.compiledSequence?.ir?.splitFrom ?? {};
        const parents = [sm.name, sm.displayName, from.smName, from.displayName]
          .map(norm).filter(Boolean);
        if (keys.some(k => parents.some(pn => pn === k))) {
          const names = split.map(e => String(e?.name ?? e?.programName ?? e?.smName ?? '?'));
          return {
            file: f,
            splitNames: names,
            message: `HELD — architecture standard: this station decomposes into ${names.length} state machines (${names.join(' + ')}). ` +
              `Rebuilding it as ONE state machine violates "each program must have no more than one state machine". ` +
              `Rebuild each state machine from its own sheet instead (or remove the recorded split first if the decomposition is genuinely wrong).`,
          };
        }
      }
    }
    return null;
  }

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
      // SM-split guard: never re-author a decomposed station as one SM.
      if (body.station && body.station.name) {
        const conflict = findSmSplitConflict_(body.station);
        if (conflict) {
          return sendJson(res, 409, {
            error: conflict.message,
            held: true,
            reason: 'sm-split-violation',
            splitNames: conflict.splitNames,
          });
        }
      }
      // Diagram builds are paid model runs — count them so restart gates see
      // them (a pm2 restart killed one mid-flight on 2026-08-24).
      const releaseAi = beginAiWork_('diagram', null, body.station?.name || null);
      let result;
      let diagramCheck = null;
      try {
        result = await author.authorDiagram({
          description: body.description,
          images: Array.isArray(body.images) ? body.images : [],
          station: body.station && typeof body.station === 'object' ? body.station : null,
        });
        // DIAGRAM CHECK (Dan, 2026-08-25): agentic review of the drawn diagram
        // after every build — granularity, branching, connectivity, SM
        // decomposition, naming. 'fix' loops through the diagram author
        // (capped); a diagram still violating known standards is returned
        // flagged needsFix and never presented as final (zero-authority law).
        // Layout stays deterministic (branchLayout) — the review judges
        // authoring, and the fix pass re-runs validate/servo-split/layout.
        try {
          const reviewer = require('./src/lib/agentGenerator/diagramReviewer.js');
          for (const sm of result.project.stateMachines) {
            const r = await reviewer.reviewAndFixDiagram({
              project: result.project,
              smId: sm.id,
              buildRef: body.station?.name || result.project.name || null,
            });
            diagramCheck = diagramCheck || { reviews: [], costUSD: 0, needsFix: false };
            diagramCheck.reviews.push({ sm: sm.name, ...r });
            diagramCheck.costUSD = Number((diagramCheck.costUSD + (r.costUSD || 0)).toFixed(4));
            diagramCheck.needsFix = diagramCheck.needsFix || r.needsFix;
          }
        } catch (e) {
          // Review infrastructure failure must not eat the build — surface it.
          diagramCheck = { error: e.message, needsFix: false };
          console.warn('[jarvis/diagram] diagram check failed:', e.message);
        }
      } finally { releaseAi(); }

      // Single-SM mode (Create Station flow): no draft file — the client
      // inserts the SM into its CURRENT project via store actions.
      if (body.station && body.station.name) {
        return sendJson(res, 200, {
          ok: true,
          sm: result.project.stateMachines[0],
          summary: result.summary,
          openQuestions: result.openQuestions,
          fixups: result.fixups,
          diagramCheck,
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
        diagramCheck,
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
      const releaseAi = beginAiWork_('spec', null, body.sm?.name || null, { register: false });
      let result;
      try {
        result = await author.authorSpec({
          description: body.description,
          images: Array.isArray(body.images) ? body.images : [],
          sm: body.sm && typeof body.sm === 'object' ? body.sm : {},
          otherSms: Array.isArray(body.otherSms) ? body.otherSms : [],
          existingSpec: body.existingSpec || null,
          corrections: typeof body.corrections === 'string' ? body.corrections : '',
          round: Number(body.round) || 0,
          qaHistory: Array.isArray(body.qaHistory) ? body.qaHistory : [],
        });
      } finally { releaseAi(); }
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

  // (handleJarvisDecompose DELETED — Phase 2, Dan 2026-08-30: the decompose
  //  gate runs through the SDK engine (/api/jarvis/agent-turn/stream with
  //  gate:'decompose' → propose_split). One door; old one-shots die same
  //  release.)

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
      const releaseAi = beginAiWork_('summarize', null, body.sm?.name || null, { register: false });
      let result;
      try {
        // Edit classification routes corrections rounds by class (value /
        // section / structural-sm / decomposition); first summaries and
        // prose-only rounds run the existing path unchanged.
        result = await routeCorrectionRound_(author, body, {});
      } finally { releaseAi(); }
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

    const releaseAi = beginAiWork_('summarize', null, body.sm?.name || null, { register: false });
    try {
      // Edit classification routes corrections rounds by class (value /
      // section / structural-sm / decomposition); first summaries and
      // prose-only rounds run the existing path unchanged.
      const result = await routeCorrectionRound_(author, body, { signal: abort.signal, onProgress });
      persistLearnedFacts(result);
      send('done', { ok: true, ...result });
    } catch (e) {
      if (clientGone || (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError'))) {
        // Client cancelled — nothing to report.
      } else {
        send('error', { error: e.message || String(e) });
      }
    } finally {
      releaseAi();
    }
    res.end();
  }

  // ── JARVIS learning being: question queue + knowledge + track record ───────
  //
  // Jarvis accumulates questions while working (create-station, generation,
  // training, or manually seeded); the controls team answers them; answers
  // become permanent lines in meKnowledge.md "## Learned from the MEs".
  // Queue lives in <repo>/jarvis-knowledge/questions.json.

  // Finished agent-turn results, held per draft for client reconnects.
  const agentTurnResults_ = new Map();
  const SERVER_STARTED_AT_ = Date.now();
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

  /** POST /api/jarvis/questions — { question, context?, source?, domain? }.
   *  Used by integrations (create-station, generation, training) to queue a
   *  question. Every entry gets a domain ('mechanical'|'controls'|'jarvis') —
   *  caller-supplied when valid, else classified by questionRouter. Domain
   *  routes the SURFACE: mechanical → the station's spec sheet (ME),
   *  controls → the leads' queue on the Jarvis page (never per-station —
   *  Jarvis IS the controls engineer, Dan 2026-08-22), jarvis → Dan. */
  async function handleJarvisQuestionAdd(req, res) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const question = String(body.question || '').trim();
      if (!question) return sendJson(res, 400, { error: 'question is required' });
      const VALID_SOURCES = ['create-station', 'generation', 'training', 'manual'];
      const qr = require('./src/lib/agentGenerator/questionRouter.js');
      const domain = qr.resolveQuestionDomain(body.domain, question, body.context);
      const entry = {
        id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        question,
        // Solutions, not explanations (Dan, 2026-08-22): callers pass Jarvis's
        // proposed answer with the question; addressee tags who answers (help
        // is ONE lane). Both tolerated absent for manual/human-filed entries.
        proposedSolution: body.proposedSolution != null ? String(body.proposedSolution).trim() || null : null,
        addressee: qr.resolveAddressee(body.addressee, domain),
        // 'example-request' = ask-for-examples doctrine (Dan, 2026-08-23):
        // Jarvis lacks an SDC example for a pattern; the team answers by
        // uploading one to POST /api/jarvis/examples with requestId = this id.
        kind: qr.resolveQuestionKind(body.kind),
        context: String(body.context || '').trim(),
        source: VALID_SOURCES.includes(body.source) ? body.source : 'manual',
        domain,
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

  /** POST /api/jarvis/questions/close-stale — body { sm } ({ name,
   *  displayName, devices:[{type, positions}] }). VIEW-SIDE stale hygiene
   *  (Dan, Aug 24: the spec sheet showed a placeholder-values question whose
   *  premise died when the tables got real numbers): a filled sheet must
   *  never DISPLAY a mechanical question it already answers. Same rule as
   *  the compile-time pass — closeStaleQuestionsForStation; closed entries
   *  stay in the queue as history. */
  async function handleJarvisQuestionsCloseStale(req, res) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const sm = body.sm && typeof body.sm === 'object' ? body.sm : null;
      if (!sm) return sendJson(res, 400, { error: 'sm is required' });
      const qr = require('./src/lib/agentGenerator/questionRouter.js');
      const arr = readQuestions();
      const closed = qr.closeStaleQuestionsForStation(arr, sm);
      if (closed.length) writeQuestions(arr);
      sendJson(res, 200, { ok: true, closed: closed.length, ids: closed.map(q => q.id) });
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

  /** POST /api/jarvis/examples — example intake (ask-for-examples doctrine,
   *  Dan 2026-08-23). The team answers an 'example-request' question by
   *  uploading a real SDC example; Jarvis trains on it immediately.
   *
   *  Body (JSON): { filename, base64 | content, topic?, requestId?, uploadedBy? }
   *    filename   original file name (.L5X/.l5x/.docx/.md/.txt/.png/.jpg)
   *    base64     file bytes (or `content` as plain utf8 text)
   *    topic      curriculum topic hint (e.g. 'laser-marker', 'vision')
   *    requestId  id of the originating example-request question — it gets
   *               resolved (status 'answered') so the UI's blocker poll clears
   *
   *  Effect: saves to plc-reference/training-queue/, registers it in
   *  jarvis-knowledge/curriculum.json as highest-priority unstudied, and
   *  (unless JARVIS_EXAMPLE_STUDY=0) spawns a detached study pass (~$1) via
   *  scripts/jarvisDailyTraining.cjs --intake, which deepens the concept
   *  file(s), logs to TRAINING_LOG.md, and resolves requestId. */
  async function handleJarvisExampleUpload(req, res) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const rawName = String(body.filename || '').trim();
      if (!rawName) return sendJson(res, 400, { error: 'filename is required' });
      const safeName = rawName.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '_');
      const ALLOWED_EXT = /\.(l5x|docx|md|txt|csv|png|jpg|jpeg|pdf)$/i;
      if (!ALLOWED_EXT.test(safeName)) return sendJson(res, 400, { error: 'unsupported file type: ' + safeName });

      let buf;
      if (body.base64) buf = Buffer.from(String(body.base64), 'base64');
      else if (body.content != null) buf = Buffer.from(String(body.content), 'utf8');
      else return sendJson(res, 400, { error: 'base64 or content is required' });
      if (!buf.length) return sendJson(res, 400, { error: 'empty file' });
      if (buf.length > 50 * 1024 * 1024) return sendJson(res, 400, { error: 'file too large (50MB max)' });

      const queueDir = path.join(__dirname, 'plc-reference', 'training-queue');
      fs.mkdirSync(queueDir, { recursive: true });
      let savedPath = path.join(queueDir, safeName);
      for (let n = 2; fs.existsSync(savedPath); n++) {
        savedPath = path.join(queueDir, safeName.replace(/(\.[^.]+)$/, `-${n}$1`));
      }
      fs.writeFileSync(savedPath, buf);

      const topic = String(body.topic || '').trim() || null;
      const requestId = String(body.requestId || '').trim() || null;

      // Resolve the originating example-request NOW (the blocker poll clears
      // immediately); the study pass appends its own learning independently.
      let resolvedQuestion = null;
      if (requestId) {
        const arr = readQuestions();
        const q = arr.find(x => x && x.id === requestId);
        if (q && q.status === 'open') {
          q.status = 'answered';
          q.answer = `Example provided: ${path.basename(savedPath)} (queued for immediate study)`;
          q.answeredBy = String(body.uploadedBy || '').trim() || 'Controls';
          q.answeredAt = new Date().toISOString();
          writeQuestions(arr);
          resolvedQuestion = q.id;
        }
      }

      // Studyable text formats get the immediate deep pass; images/pdf/docx
      // sit in the queue for the next scheduled session (which can read them).
      const studyable = /\.(l5x|md|txt|csv)$/i.test(savedPath);
      let studyStarted = false;
      if (studyable && process.env.JARVIS_EXAMPLE_STUDY !== '0' && process.env.ANTHROPIC_API_KEY) {
        const { spawn } = require('child_process');
        const args = [path.join(__dirname, 'scripts', 'jarvisDailyTraining.cjs'),
          '--intake', savedPath, '--budget', '1'];
        if (topic) args.push('--topic', topic);
        if (requestId) args.push('--resolve', requestId); // idempotent — adds the study note
        const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', cwd: __dirname });
        child.unref();
        studyStarted = true;
      } else if (studyable) {
        // register in the curriculum as highest-priority even without a study pass
        try {
          const { registerIntake, buildManifest } = require('./scripts/jarvisDailyTraining.cjs');
          registerIntake(savedPath, topic, buildManifest());
        } catch (e) { console.warn('[jarvis-examples] manifest register failed:', e.message); }
      }

      sendJson(res, 200, {
        ok: true,
        savedTo: path.relative(__dirname, savedPath).replace(/\\/g, '/'),
        topic, resolvedQuestion, studyStarted,
        note: studyStarted
          ? 'study pass running in the background — TRAINING_LOG.md and the concept files will show the result'
          : (studyable ? 'registered in the curriculum for the next training run'
                       : 'saved to the training queue; non-text formats are studied by the next scheduled training session'),
      });
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

    // FIRST-PASS SHIP RATE (Dan's headline number, 2026-08-25 — "can you
    // create a correct file with no prior version?"): aggregated from
    // buildScores.json. eligible = builds where the metric could be judged
    // (the internal review ran → firstPassShip is boolean); rate = shipped
    // first-pass / eligible. Note for the UI: the Jarvis page should headline
    // this number.
    const firstPass = { eligible: 0, shipped: 0, rate: null, avgRoundsToShip: null };
    try {
      const builds = require('./src/lib/agentGenerator/buildScores.js')
        .readBuilds(path.join(__dirname, 'jarvis-knowledge', 'buildScores.json'));
      const rounds = [];
      for (const b of builds) {
        if (!b || typeof b.firstPassShip !== 'boolean') continue;
        firstPass.eligible++;
        if (b.firstPassShip === true) firstPass.shipped++;
        if (Number.isFinite(Number(b.roundsToShip)) && b.roundsToShip != null) rounds.push(Number(b.roundsToShip));
      }
      if (firstPass.eligible) firstPass.rate = Number((firstPass.shipped / firstPass.eligible).toFixed(3));
      if (rounds.length) firstPass.avgRoundsToShip = Number((rounds.reduce((a, x) => a + x, 0) / rounds.length).toFixed(2));
    } catch (e) { console.warn('[jarvis-trackrecord] first-pass aggregation failed:', e.message); }

    sendJson(res, 200, { version, history, benchmarks, generatedCount, firstPass });
  }

  // ── JARVIS v2.1.2: review grid + correction-learning loop ──────────────────
  //
  // Dan's spec: "anything you generate should be aligned in a grid… they tell
  // you what was good, what was bad — talk or text — the score… and a place to
  // upload the real correct version, and you use that to learn."
  //
  //   GET  /api/jarvis/generations           grid rows: every buildScores.json
  //                                          record + orphan .L5X files found in
  //                                          generated/ (rows with no record are
  //                                          download-only, marked orphan:true)
  //   GET  /api/jarvis/builds/:id/file       download the saved L5X
  //                                          (?which=corrected for the upload);
  //                                          orphan ids ("f_<base64url relpath>")
  //                                          resolve inside generated/ only
  //   POST /api/jarvis/builds/:id/corrected  { base64, uploadedBy, replace? } —
  //                                          stores <base>__corrected_by_<name>.L5X
  //                                          next to the original, then kicks an
  //                                          in-process background analysis
  //                                          (counted in activeGenerations):
  //                                          correctionLearner diffs the files
  //                                          mechanically, ONE model call turns
  //                                          the differences into lessons; high-
  //                                          confidence lessons land in
  //                                          jarvis-knowledge/concepts/*.md under
  //                                          "## Learned from corrections", low-
  //                                          confidence ones go to the question
  //                                          queue (source 'generation').
  //                                          Duplicate upload → 409 {needsConfirm}
  //                                          unless replace:true.

  const BUILD_SCORES_FILE_ = path.join(__dirname, 'jarvis-knowledge', 'buildScores.json');
  const GENERATED_DIR_ = path.join(__dirname, 'generated');

  function cleanName_(s) { return String(s || 'unnamed').replace(/[^a-zA-Z0-9_\-]/g, '_'); }

  /** GET /api/jarvis/generations — one row per generated build. buildScores
   *  records first (they carry score/notes/correction state), then orphan
   *  .L5X files on disk that no record references (pre-scoring era builds,
   *  manual saves). Corrected uploads never appear as their own rows. */
  function handleJarvisGenerations(res) {
    const scores = require('./src/lib/agentGenerator/buildScores.js');
    const builds = scores.readBuilds(BUILD_SCORES_FILE_);
    const referenced = new Set();
    for (const b of builds) {
      if (b.filePath) { try { referenced.add(path.resolve(b.filePath).toLowerCase()); } catch (_) {} }
      if (b.correction?.filePath) { try { referenced.add(path.resolve(b.correction.filePath).toLowerCase()); } catch (_) {} }
    }
    const orphans = [];
    try {
      const walk = (dir) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, d.name);
          if (d.isDirectory()) { walk(fp); continue; }
          if (!/\.L5X$/i.test(d.name)) continue;
          if (/__corrected_by_/i.test(d.name)) continue;
          if (referenced.has(path.resolve(fp).toLowerCase())) continue;
          const rel = path.relative(GENERATED_DIR_, fp).split(path.sep).join('/');
          const m = d.name.match(/^(.*?)__jarvis_v([^_]+)__/);
          let mtime = null;
          try { mtime = fs.statSync(fp).mtime.toISOString(); } catch (_) {}
          orphans.push({
            id: 'f_' + Buffer.from(rel, 'utf8').toString('base64url'),
            orphan: true,
            at: mtime,
            project: rel.includes('/') ? rel.split('/')[0] : '',
            sm: m ? m[1] : d.name.replace(/\.L5X$/i, ''),
            jarvisVersion: m ? m[2] : null,
            costUSD: null, durationS: null, attempts: null,
            validationOk: null, mode: null, score: null,
            filePath: fp,
          });
        }
      };
      walk(GENERATED_DIR_);
    } catch (_) { /* no generated dir yet — records-only grid is honest */ }
    sendJson(res, 200, { builds, orphans });
  }

  /** GET /api/jarvis/builds/:id/file[?which=corrected] — serve a saved L5X. */
  function handleJarvisBuildFile(res, id, query) {
    try {
      let filePath = null;
      if (id.startsWith('f_')) {
        // Orphan row: id encodes a relative path — resolve INSIDE generated/ only.
        let rel;
        try { rel = Buffer.from(id.slice(2), 'base64url').toString('utf8'); }
        catch (_) { return sendJson(res, 400, { error: 'Bad file id' }); }
        const resolved = path.resolve(GENERATED_DIR_, rel);
        if (!resolved.toLowerCase().startsWith(path.resolve(GENERATED_DIR_).toLowerCase() + path.sep)) {
          return sendJson(res, 400, { error: 'Bad file id' });
        }
        filePath = resolved;
      } else {
        const scores = require('./src/lib/agentGenerator/buildScores.js');
        const build = scores.getBuild(BUILD_SCORES_FILE_, id);
        if (!build) return sendJson(res, 404, { error: 'Build not found' });
        filePath = (query && query.which === 'corrected') ? build.correction?.filePath : build.filePath;
        if (!filePath) return sendJson(res, 404, { error: query?.which === 'corrected' ? 'No corrected file uploaded for this build' : 'This build has no saved file on disk' });
      }
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'File no longer on disk: ' + path.basename(filePath) });
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buf.length,
        'Content-Disposition': `attachment; filename="${path.basename(filePath).replace(/"/g, '')}"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(buf);
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  /** POST /api/jarvis/decisions/review — approve/deny one of Jarvis's compile
   *  decisions (reviewFlags). Body: { filename, smId, decisionText,
   *  verdict: 'good'|'denied', why?, reviewer }.
   *  - Both verdicts land in sm.compiledSequence.decisionReviews[] (the
   *    project file) — ✓ is reinforcement data for later.
   *  - ✗ (denied, why required) also runs the correction-learning lesson
   *    path: the reviewer's why is appended to the matching concept doc,
   *    attributed and dated (same files correction lessons land in).
   *  NOTE: the client MUST mirror decisionReviews into its in-memory store
   *  (same store-consistency rule as compile/approve — auto-save would
   *  otherwise clobber this write). */
  async function handleJarvisDecisionReview(req, res) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const safe = safeFilename(body.filename || '');
      if (!safe) return sendJson(res, 400, { error: 'Invalid or missing filename' });
      const decisionText = String(body.decisionText || '').trim();
      const verdict = body.verdict === 'good' ? 'good' : body.verdict === 'denied' ? 'denied' : null;
      const reviewer = String(body.reviewer || '').trim();
      const why = String(body.why || '').trim();
      if (!decisionText) return sendJson(res, 400, { error: 'decisionText is required' });
      if (!verdict) return sendJson(res, 400, { error: "verdict must be 'good' or 'denied'" });
      if (!reviewer) return sendJson(res, 400, { error: 'reviewer is required' });
      if (verdict === 'denied' && !why) return sendJson(res, 400, { error: 'A denial needs a why — that is what Jarvis learns from' });

      const fp = path.join(DATA_DIR_, safe);
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Project not found: ' + safe });
      const projectJson = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sm = findSm_(projectJson, body.smId);
      if (!sm) return sendJson(res, 404, { error: 'State machine not found: ' + (body.smId || '(first)') });
      if (!sm.compiledSequence) return sendJson(res, 409, { error: 'Station has no compiled sequence to review decisions on' });

      const review = { decisionText, verdict, why: why || null, reviewer, at: new Date().toISOString() };
      const reviews = (sm.compiledSequence.decisionReviews || [])
        .filter(r => r.decisionText !== decisionText); // re-review replaces
      reviews.push(review);
      sm.compiledSequence.decisionReviews = reviews;
      saveProjectWithBackup_(safe, projectJson);

      // Denied → lesson path (same concept docs correction learning writes to).
      let learned = null;
      if (verdict === 'denied') {
        try {
          const learner = require('./src/lib/agentGenerator/correctionLearner.js');
          const t = (decisionText + ' ' + why).toLowerCase();
          const conceptArea =
            /servo|axis|axes|motion|home|position|speed|blend/.test(t) ? 'servo-motion'
            : /vision|camera|inspect/.test(t) ? 'vision-systems'
            : /pneumatic|valve|solenoid|cylinder|gripper/.test(t) ? 'pneumatics'
            : /handshake|coordinat|upstream|downstream|signal/.test(t) ? 'coordination'
            : /recover|e.?stop|lockout/.test(t) ? 'recovery'
            : /alarm|fault/.test(t) ? 'alarms'
            : 'general';
          const date = new Date().toISOString().slice(0, 10);
          const label = `${projectJson.name || safe} / ${sm.name}`;
          const line = `- (${date}, ${reviewer} denied a compile decision on ${label}) ${why} [decision was: "${decisionText.slice(0, 160)}"]`;
          const file = learner.appendCorrectionLesson(learner.CONCEPTS_DIR, conceptArea, line);
          learned = { conceptArea, file: path.basename(file) };
          console.log(`[decision-review] ${reviewer} denied a decision on ${label} → lesson filed in ${conceptArea}`);
        } catch (e) {
          console.warn('[decision-review] lesson filing failed (review still recorded):', e.message);
        }
      }

      sendJson(res, 200, { ok: true, review, learned, decisionReviews: reviews });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
  }

  /** Background correction analysis — in-process async, same pattern as
   *  pretranslation: counted in activeGenerations so nobody restarts the
   *  server mid-model-call; result (or honest failure) lands on the build
   *  record for the grid to render. */
  async function runCorrectionAnalysis_(buildId, uploadedBy) {
    const scores = require('./src/lib/agentGenerator/buildScores.js');
    let learner;
    try { learner = require('./src/lib/agentGenerator/correctionLearner.js'); }
    catch (e) {
      console.warn('[correction] correctionLearner unavailable:', e.message);
      try { scores.updateBuild(BUILD_SCORES_FILE_, buildId, { correction: { ...scores.getBuild(BUILD_SCORES_FILE_, buildId)?.correction, status: 'failed', error: 'analysis module unavailable: ' + e.message } }); } catch (_) {}
      return;
    }
    activeGenerations++;
    touchAi_();
    const startedAt = Date.now();
    const build = scores.getBuild(BUILD_SCORES_FILE_, buildId);
    console.log(`[correction] analysis started: ${build?.project} / ${build?.sm} (build ${buildId}, corrected by ${uploadedBy})`);
    try {
      const originalXml = fs.readFileSync(build.filePath, 'utf8');
      const correctedXml = fs.readFileSync(build.correction.filePath, 'utf8');
      const result = await learner.analyzeCorrection({ originalXml, correctedXml, build, uploadedBy });
      // Route the lessons: high-confidence → concept docs; low-confidence →
      // question queue for the leads to confirm (source 'generation').
      const { applied, queued } = learner.applyLessons({
        lessons: result.lessons,
        reviewer: uploadedBy,
        buildId,
        buildLabel: `${build.project} / ${build.sm}`,
        addQuestion: ({ question, context, source, domain, proposedSolution }) => {
          try {
            const qr = require('./src/lib/agentGenerator/questionRouter.js');
            const resolvedDomain = qr.resolveQuestionDomain(domain, question, context);
            const arr = readQuestions();
            arr.push({
              id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
              question, context, source: source || 'generation',
              // A low-confidence lesson IS Jarvis's proposed solution — the
              // question asks whether it's right (solutions, not explanations).
              proposedSolution: proposedSolution != null ? String(proposedSolution).trim() || null : null,
              addressee: qr.resolveAddressee(undefined, resolvedDomain),
              domain: resolvedDomain,
              askedAt: new Date().toISOString(), status: 'open',
            });
            writeQuestions(arr);
          } catch (e) { console.warn('[correction] question queue push failed:', e.message); }
        },
      });
      scores.updateBuild(BUILD_SCORES_FILE_, buildId, {
        correction: {
          ...scores.getBuild(BUILD_SCORES_FILE_, buildId).correction,
          status: 'done',
          analyzedAt: new Date().toISOString(),
          durationS: Math.round((Date.now() - startedAt) / 1000),
          costUSD: result.costUSD,
          diffStats: result.diffStats,
          summary: result.summary,
          lessons: result.lessons.map(l => ({
            ...l,
            applied: applied.some(a => a.lesson === l.lesson),
            conceptFile: applied.find(a => a.lesson === l.lesson)?.file || null,
          })),
          learnedCount: applied.length,
          queuedCount: queued.length,
        },
      });
      console.log(`[correction] analysis done: build ${buildId} — ${result.lessons.length} lesson(s), ${applied.length} applied to concept docs, ${queued.length} queued for the leads ($${result.costUSD})`);
    } catch (e) {
      console.warn(`[correction] analysis FAILED for build ${buildId}:`, e.message);
      try {
        scores.updateBuild(BUILD_SCORES_FILE_, buildId, {
          correction: {
            ...scores.getBuild(BUILD_SCORES_FILE_, buildId).correction,
            status: 'failed',
            error: e.message,
            analyzedAt: new Date().toISOString(),
          },
        });
      } catch (e2) { console.warn('[correction] failure record failed too:', e2.message); }
    } finally {
      touchAi_();
      activeGenerations = Math.max(0, activeGenerations - 1);
    }
  }

  /** POST /api/jarvis/builds/:id/corrected — { base64, uploadedBy, replace? }. */
  async function handleJarvisBuildCorrected(req, res, id) {
    try {
      const scores = require('./src/lib/agentGenerator/buildScores.js');
      const body = JSON.parse(await readBody(req) || '{}');
      const uploadedBy = String(body.uploadedBy || '').trim() || 'Unknown';
      const build = scores.getBuild(BUILD_SCORES_FILE_, id);
      if (!build) return sendJson(res, 404, { error: 'Build not found (rows without a build record can\'t take corrections)' });
      if (!build.filePath || !fs.existsSync(build.filePath)) {
        return sendJson(res, 409, { error: 'The original generated file is no longer on disk — nothing to diff against' });
      }
      if (!body.base64) return sendJson(res, 400, { error: 'base64 file content is required' });

      let buf;
      try { buf = Buffer.from(String(body.base64), 'base64'); }
      catch (_) { return sendJson(res, 400, { error: 'base64 did not decode' }); }
      if (!buf.length) return sendJson(res, 400, { error: 'Uploaded file is empty' });
      if (buf.length > 10 * 1024 * 1024) return sendJson(res, 413, { error: 'File too large (max 10MB)' });
      const head = buf.slice(0, 512).toString('utf8');
      if (!/^﻿?\s*<\?xml|<RSLogix5000Content/i.test(head)) {
        return sendJson(res, 400, { error: 'That doesn\'t look like an L5X file (no XML declaration or RSLogix5000Content root)' });
      }

      // Duplicate upload replaces only after explicit confirm.
      if (build.correction?.filePath && fs.existsSync(build.correction.filePath) && body.replace !== true) {
        return sendJson(res, 409, {
          error: `A corrected version by ${build.correction.uploadedBy || '?'} already exists for this build`,
          needsConfirm: true,
          existing: { uploadedBy: build.correction.uploadedBy, at: build.correction.at },
        });
      }
      // Replacing: drop the previous corrected file if it was named differently.
      const base = path.basename(build.filePath).replace(/\.L5X$/i, '');
      const correctedPath = path.join(path.dirname(build.filePath), `${base}__corrected_by_${cleanName_(uploadedBy)}.L5X`);
      if (build.correction?.filePath && path.resolve(build.correction.filePath) !== path.resolve(correctedPath)) {
        try { fs.unlinkSync(build.correction.filePath); } catch (_) {}
      }
      fs.writeFileSync(correctedPath, buf);

      const updated = scores.updateBuild(BUILD_SCORES_FILE_, id, {
        correction: {
          filePath: correctedPath,
          uploadedBy,
          at: new Date().toISOString(),
          status: 'analyzing',
        },
      });
      // Kick the background analysis (in-process, counted in activeGenerations).
      setImmediate(() => runCorrectionAnalysis_(id, uploadedBy)
        .catch(e => console.warn('[correction] unhandled analysis failure:', e.message)));
      sendJson(res, 200, { ok: true, build: updated });
    } catch (e) { sendJson(res, e.status || 500, { error: e.message }); }
  }

  /** POST /api/jarvis/builds/:id/corrected/reanalyze — retry a failed (or
   *  finished) correction analysis on the ALREADY-UPLOADED corrected file.
   *  No re-upload needed: the file was persisted at upload time; a failed
   *  analysis must never cost the reviewer their red pen. */
  async function handleJarvisBuildReanalyze(req, res, id) {
    try {
      const scores = require('./src/lib/agentGenerator/buildScores.js');
      const build = scores.getBuild(BUILD_SCORES_FILE_, id);
      if (!build) return sendJson(res, 404, { error: 'Build not found' });
      if (!build.correction?.filePath || !fs.existsSync(build.correction.filePath)) {
        return sendJson(res, 409, { error: 'No corrected file is stored for this build — upload one first' });
      }
      if (!build.filePath || !fs.existsSync(build.filePath)) {
        return sendJson(res, 409, { error: 'The original generated file is no longer on disk — nothing to diff against' });
      }
      if (build.correction.status === 'analyzing') {
        return sendJson(res, 409, { error: 'An analysis is already running for this build' });
      }
      const updated = scores.updateBuild(BUILD_SCORES_FILE_, id, {
        correction: { ...build.correction, status: 'analyzing', error: null },
      });
      setImmediate(() => runCorrectionAnalysis_(id, build.correction.uploadedBy || 'Unknown')
        .catch(e => console.warn('[correction] unhandled reanalysis failure:', e.message)));
      sendJson(res, 200, { ok: true, build: updated });
    } catch (e) { sendJson(res, e.status || 500, { error: e.message }); }
  }

  /** POST /api/jarvis/builds/:id/verify — { verifiedBy, note? }. Marks a
   *  delivered build ENGINEER-VERIFIED-CORRECT (Dan, 2026-08-26: "when you
   *  produce good code, save that — a library to lean on, like a good
   *  controls engineer"). Standing mechanism, any build/any family:
   *    1. copies the build's L5X into plc-reference/verified/ (the verified
   *       library — preWriteStudy ranks it above corrected/delivered),
   *    2. stamps the build record { engineerVerified, verifiedBy, verifiedAt },
   *    3. registers the file in sources.json (verified-exemplars source) and
   *       curriculum.json at the top exemplar rank,
   *    4. appends a station changelog entry when the station resolves. */
  async function handleJarvisBuildVerify(req, res, id) {
    try {
      const scores = require('./src/lib/agentGenerator/buildScores.js');
      const body = JSON.parse(await readBody(req) || '{}');
      const verifiedBy = String(body.verifiedBy || '').trim();
      if (!verifiedBy) return sendJson(res, 400, { error: 'verifiedBy is required — verification is a named engineer\'s signature' });
      const build = scores.getBuild(BUILD_SCORES_FILE_, id);
      if (!build) return sendJson(res, 404, { error: 'Build not found' });
      // The file the engineer actually read: delivered copy first, then the
      // engineer-corrected file, then the generated file.
      const deliveredPath = build.shippedAs ? path.join(__dirname, 'JARVIS Deliveries', build.shippedAs) : null;
      const srcPath = (deliveredPath && fs.existsSync(deliveredPath)) ? deliveredPath
        : (build.correction?.filePath && fs.existsSync(build.correction.filePath)) ? build.correction.filePath
        : (build.filePath && fs.existsSync(build.filePath)) ? build.filePath : null;
      if (!srcPath) return sendJson(res, 409, { error: 'No file on disk for this build — nothing to enshrine' });

      const verifiedDir = path.join(__dirname, 'plc-reference', 'verified');
      fs.mkdirSync(verifiedDir, { recursive: true });
      const base = path.basename(srcPath).replace(/\.L5X$/i, '');
      const libName = `${base}__verified_by_${cleanName_(verifiedBy)}.L5X`;
      const libPath = path.join(verifiedDir, libName);
      fs.copyFileSync(srcPath, libPath);

      const at = new Date().toISOString();
      const note = String(body.note || '').trim() || null;
      const updated = scores.updateBuild(BUILD_SCORES_FILE_, id, {
        engineerVerified: true, verifiedBy, verifiedAt: at,
        ...(note ? { verifiedNote: note } : {}),
        verifiedLibraryPath: libPath,
      });

      // Register in sources.json under the standing verified-exemplars source.
      try {
        const srcFile = path.join(__dirname, 'jarvis-knowledge', 'sources.json');
        const sources = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
        let entry = sources.find(s => s && s.id === 'verified-exemplars');
        if (!entry) {
          entry = { id: 'verified-exemplars', name: 'Engineer-verified-correct builds (the gold rank)',
            location: 'plc-reference/verified/', accessStatus: 'full', lastIngested: at.slice(0, 10), takeaways: [] };
          sources.push(entry);
        }
        entry.lastIngested = at.slice(0, 10);
        const line = `${libName} confirmed CORRECT by ${verifiedBy} (${at.slice(0, 10)})${note ? ' - ' + note : ''}`;
        if (!entry.takeaways.some(t => String(t).includes(libName))) entry.takeaways.push(line);
        fs.writeFileSync(srcFile, JSON.stringify(sources, null, 2) + '\n');
      } catch (e) { console.warn('[verify] sources.json registration failed:', e.message); }

      // Register in the curriculum at top exemplar rank.
      try {
        const curFile = path.join(__dirname, 'jarvis-knowledge', 'curriculum.json');
        const cur = JSON.parse(fs.readFileSync(curFile, 'utf8'));
        const relPath = 'plc-reference/verified/' + libName;
        if (!cur.items.some(i => i && i.path === relPath)) {
          cur.items.unshift({
            id: 'ci_verified_' + String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-12),
            path: relPath, kind: 'engineer-verified-correct',
            topics: [], antiPattern: false, conceptFiles: [],
            status: 'studied', studiedAt: at.slice(0, 10),
            studiedNote: `Confirmed CORRECT by ${verifiedBy} (${at.slice(0, 10)}). Gold exemplar - top rank in preWriteStudy ordering.${note ? ' ' + note : ''}`,
            sizeBytes: fs.statSync(libPath).size, hash: null, priority: 0,
          });
          cur.counts = cur.counts || {}; cur.counts.total = cur.items.length;
          cur.updatedAt = at;
          fs.writeFileSync(curFile, JSON.stringify(cur, null, 2) + '\n');
        }
      } catch (e) { console.warn('[verify] curriculum registration failed:', e.message); }

      // Station changelog entry (best effort — skipped when unresolvable).
      try {
        const located = findProjectFileBySmName_(build.sm);
        if (located) {
          appendChangeLog_(located.sm, {
            what: `Build ${build.label || id} verified CORRECT by ${verifiedBy} — saved to the verified library (${libName})`,
            class: 'verify', scope: 'engineer verification', cost: 0, buildRef: id,
          });
          try { saveProjectWithBackup_(located.file, located.projectJson); } catch (_) {}
        }
      } catch (e) { console.warn('[verify] changelog append failed:', e.message); }

      sendJson(res, 200, { ok: true, build: updated, libraryPath: libPath });
    } catch (e) { sendJson(res, e.status || 500, { error: e.message }); }
  }

  /** POST /api/jarvis/builds/:id/continue — resume a HELD generation (Dan's
   *  escalation model). Body (all optional):
   *    { answers: [{ questionId, answer, answeredBy }] } — inline answers,
   *  recorded exactly like POST /api/jarvis/questions/:id/answer (marked
   *  answered + folded into meKnowledge.md). Answers already recorded via
   *  that route count too. Requires at least one of the build's help
   *  questions answered. Re-enters the fix loop from the persisted resume
   *  state with the answers in context and completes through THE CHECK
   *  (internal review) as normal. Long-running (minutes) — plain JSON
   *  response, counted in activeGenerations. */
  async function handleJarvisBuildContinue(req, res, id) {
    let gen;
    try { gen = require('./src/lib/agentGenerator/client.js'); }
    catch (e) { return sendJson(res, 503, { error: 'AI generation not available — run npm install: ' + e.message }); }
    const scores = require('./src/lib/agentGenerator/buildScores.js');
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    try {
      const build = scores.getBuild(BUILD_SCORES_FILE_, id);
      if (!build) return sendJson(res, 404, { error: 'Build not found' });
      if (!build.help || !Array.isArray(build.help.questions) || !build.help.questions.length) {
        return sendJson(res, 400, { error: 'This build is not held for help — nothing to continue' });
      }
      if (build.help.status === 'resolved') {
        return sendJson(res, 409, { error: 'This held build was already resumed and resolved' });
      }
      if (!build.resumePath || !fs.existsSync(build.resumePath)) {
        return sendJson(res, 409, { error: 'Held build has no resume state on disk — run a fresh generation instead' });
      }

      // (1) Inline answers: same effect as the answer route — the question is
      // marked answered AND the answer becomes standing knowledge, so the
      // resumed run (and every future prompt) carries it.
      const inline = Array.isArray(body.answers) ? body.answers : [];
      if (inline.length) {
        const arr = readQuestions();
        let changed = false;
        for (const a of inline) {
          const q = arr.find(x => x && x.id === String(a.questionId || ''));
          const answer = String(a.answer || '').trim();
          if (!q || !answer || q.status === 'answered') continue;
          const answeredBy = String(a.answeredBy || '').trim() || 'ME';
          try {
            appendLearnedLine({ answer, answeredBy, question: q.question });
            q.learnedFactId = 'learned_' + Date.now().toString(36);
          } catch (e) { console.warn('[continue] meKnowledge append failed:', e.message); }
          q.status = 'answered';
          q.answer = answer;
          q.answeredBy = answeredBy;
          q.answeredAt = new Date().toISOString();
          changed = true;
        }
        if (changed) writeQuestions(arr);
      }

      // (2) Collect this build's answered help questions from the queue.
      const helpIds = build.help.questions.map(q => q.id);
      const answered = readQuestions().filter(q =>
        q && helpIds.includes(q.id) && q.status === 'answered' && String(q.answer || '').trim());
      if (!answered.length) {
        return sendJson(res, 409, {
          error: 'None of this build\'s help questions are answered yet — answer them (via the answer route or inline in this request) first',
          questions: build.help.questions,
        });
      }

      // (3) Load resume state + the CURRENT project, re-enter the fix loop.
      let resume;
      try { resume = JSON.parse(fs.readFileSync(build.resumePath, 'utf8')); }
      catch (e) { return sendJson(res, 500, { error: 'Resume state unreadable: ' + e.message }); }
      const safe = safeFilename(resume.projectFilename || '');
      if (!safe || !fs.existsSync(path.join(DATA_DIR_, safe))) {
        return sendJson(res, 409, { error: 'The held build\'s project file is gone: ' + (resume.projectFilename || '(unknown)') });
      }
      const projectJson = JSON.parse(fs.readFileSync(path.join(DATA_DIR_, safe), 'utf8'));
      const sm = findSm_(projectJson, resume.smId || build.sm);
      if (!sm) return sendJson(res, 409, { error: 'State machine not found in project: ' + (resume.smId || build.sm) });

      activeGenerations++;
      touchAi_();
      const workId = registerActiveWork_('generation', projectJson.name || safe.replace('.json', ''), sm.name);
      const startedAt = Date.now();
      try {
        scores.updateBuild(BUILD_SCORES_FILE_, id, { help: { ...build.help, status: 'resumed' } });
        console.log(`[continue] resuming held build ${id} (${build.project} / ${build.sm}) with ${answered.length} answer(s)`);

        const result = await gen.generateL5X(projectJson, sm.id, {
          resume: {
            lastEditPlan: resume.lastEditPlan,
            persistentFindings: resume.persistentFindings,
            attemptCount: resume.attemptCount,
            answers: answered.map(q => ({
              question: q.question,
              proposedSolution: q.proposedSolution ?? null,
              answer: q.answer,
              answeredBy: q.answeredBy,
            })),
          },
        });

        const { savedPath, savedIrPath } = saveGeneratedResult_(result, projectJson, safe);
        // Held AGAIN (rare): new questions filed, new resume state, back to
        // waiting with the fresh question set appended.
        const { helpRecord, resumePath } = persistHold_(result, projectJson, safe, result.meta?.smName || sm.name);
        persistStructuralChanges_(result, projectJson, safe, sm);

        const patch = {
          validationOk: result.ok === true,
          attempts: (Number(build.attempts) || 0) + (result.meta?.attempts?.length ?? 0),
          costUSD: Number(((Number(build.costUSD) || 0) + (result.meta?.costEstimate?.totalUSD || 0)).toFixed(4)),
          durationS: (Number(build.durationS) || 0) + Math.round((Date.now() - startedAt) / 1000),
          internalReview: result.internalReview ?? null,
          writingNotes: scores.normalizeWritingNotes([...(build.writingNotes || []), ...(result.writingNotes || [])]),
          structuralChanges: scores.normalizeStructuralChanges([...(build.structuralChanges || []), ...(result.structuralChanges || [])]),
          resumedAt: new Date().toISOString(),
          ...(savedPath ? { filePath: savedPath } : {}),
          help: helpRecord
            ? scores.normalizeHelp({ questions: [...build.help.questions, ...helpRecord.questions], status: 'waiting' })
            : scores.normalizeHelp({ questions: build.help.questions, status: 'resolved' }),
          ...(resumePath ? { resumePath } : {}),
        };
        const updated = scores.updateBuild(BUILD_SCORES_FILE_, id, patch);
        if (helpRecord) {
          require('./src/lib/agentGenerator/internalReviewer.js')
            .attachBuildIdToQuestions(helpRecord.questions.map(q => q.id), id);
        }
        console.log(`[continue] build ${id} ${result.held ? 'HELD AGAIN' : result.ok ? 'completed' : 'finished with validation errors'} ($${result.meta?.costEstimate?.totalUSD ?? '?'})`);
        sendJson(res, 200, {
          ok: result.ok === true,
          build: updated,
          validation: result.validation,
          internalReview: result.internalReview ?? null,
          savedPath, savedIrPath,
          held: result.held ? { reason: result.held.reason, questions: helpRecord ? helpRecord.questions : [] } : null,
        });
      } catch (e) {
        // Honest failure: back to waiting so the build stays resumable.
        try { scores.updateBuild(BUILD_SCORES_FILE_, id, { help: { ...build.help, status: 'waiting' } }); } catch (_) {}
        if (e && e.code === 'AI_NOT_CONFIGURED') return sendJson(res, 503, { error: e.message });
        console.error('[continue] FAILED:', e && e.stack ? e.stack : e);
        sendJson(res, 500, { error: e.message });
      } finally {
        touchAi_();
        activeGenerations = Math.max(0, activeGenerations - 1);
        releaseActiveWork_(workId);
      }
    } catch (e) { sendJson(res, e.status || 500, { error: e.message }); }
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

    // Health/liveness — check BEFORE restarting this server: a restart
    // mid-request kills the SSE/HTTP call and loses a paid model run.
    // RESTART DISCIPLINE: only restart when activeGenerations === 0 AND
    // lastAiRequestAt is null or more than 60 seconds old. activeGenerations
    // counts EVERY model-calling route (generate, generate/stream, compile,
    // diagram, spec, summarize, summarize/stream, correction analysis,
    // held-build continue, pretranslation).
    if (pathname === '/api/health') {
      if (method === 'GET') return sendJson(res, 200, { ok: true, activeGenerations, lastAiRequestAt, uptimeS: Math.round(process.uptime()) });
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

    if (pathname === '/api/jarvis/compile') {
      if (method === 'POST') return handleJarvisCompile(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/compile/approve') {
      if (method === 'POST') return handleJarvisCompileApprove(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // THE SPEED ARCHITECTURE: scoped re-plan of ONE machine (class c) and the
    // per-station build/change log the classification routes write to.
    if (pathname === '/api/jarvis/recompile-machine') {
      if (method === 'POST') return handleJarvisRecompileMachine(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/changelog') {
      if (method === 'GET') return handleJarvisChangelog(req, res, query);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/patch-code') {
      if (method === 'POST') return handleJarvisPatchCode(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/pretranslated') {
      if (method === 'GET') return handleJarvisPretranslated(res, query);
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

    // (/api/jarvis/decompose is DELETED — Phase 2, one-door law: the
    // decompose gate runs the embedded SDK engine at /agent-turn/stream
    // with gate:'decompose'. Dan, 2026-08-30.)

    // THE RELOAD BAR's version source (Dan, 2026-08-30 — ported from the SDC
    // Scheduler's new-build watcher): the UI_BUILD currently on disk, read
    // fresh per request (no require cache — whatsNew.js is ESM), plus the
    // server's start time. A stale tab compares and offers ONE reload.
    if (pathname === '/api/version') {
      let uiBuild = null;
      try {
        const txt = fs.readFileSync(path.join(__dirname, 'src', 'lib', 'whatsNew.js'), 'utf8');
        uiBuild = (txt.match(/UI_BUILD\s*=\s*'([^']+)'/) || [])[1] ?? null;
      } catch (_) { /* absent in odd deploys — bar just stays quiet */ }
      return sendJson(res, 200, { ok: true, uiBuild, serverStartedAt: SERVER_STARTED_AT_ });
    }

    // RECONNECT SUPPORT (Dan's dead-gauge report, 2026-08-30): a finished
    // turn's result is held per draft so a client that lost the stream can
    // fetch it instead of declaring the turn dead. Memory-only, last 20.
    if (pathname === '/api/jarvis/agent-turn/last') {
      const draftId = String(query?.draftId ?? '');
      const hit = agentTurnResults_.get(draftId);
      return sendJson(res, 200, hit ? { ok: true, at: hit.at, result: hit.result } : { ok: false });
    }

    // THE AGENT LOOP (Dan approved 2026-08-28 — docs/jarvis-agent-loop-design.md):
    // one chat turn = read tools + typed diff-returning edits + checker over
    // the diffs. SSE: `state` events (the live activity line), then `done`
    // with { reply, diffs, draft, asks, notes, meta }.
    if (pathname === '/api/jarvis/agent-turn/stream') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      let loop;
      try {
        // THE EMBEDDED HARNESS (Dan, 2026-08-30): the Claude Agent SDK engine
        // — same window, same contract; the hand-rolled loop is deleted.
        loop = require('./src/lib/agentGenerator/agentLoopSdk.js');
      } catch (e) {
        return sendJson(res, 503, { error: 'Agent loop not available: ' + e.message });
      }
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad JSON' }); }
      if (!String(body.message ?? '').trim()) return sendJson(res, 400, { error: 'message is required' });
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
      // A lost connection does NOT abort the turn — it finishes server-side
      // and the client re-attaches via /api/jarvis/agent-turn/last (Dan,
      // 2026-08-30: "the turn is still running on the server; reconnecting").
      // The caps bound the cost of a truly abandoned turn.
      req.on('close', () => { clientGone = true; });
      // Keepalive pings so the client watchdog can tell "long model call"
      // from "dead turn" (stuck-forever is impossible either way now).
      const keepalive = setInterval(() => send('ping', { t: Date.now() }), 5000);
      const releaseAi = beginAiWork_('agent-turn', null, body.draft?.name || null, { register: false });
      try {
        const runOnce = () => loop.runAgentTurn({
          draft: body.draft ?? {},
          message: String(body.message),
          cascadePosition: body.cascadePosition ?? null,
          // KNOW YOUR AUDIENCE (Dan, 2026-08-30): ME (default) or CE.
          audience: body.audience === 'CE' ? 'CE' : 'ME',
          // TIER 2/3 attribution: who's speaking (laws from Dan activate
          // immediately; anyone else's queue pending).
          speaker: String(body.speaker ?? 'Dan').slice(0, 60),
          // Session continuity: one SDK session per draft.
          draftId: body.draftId ? String(body.draftId) : null,
          // PHASE 2: gate turns (decompose) ride the same engine with the
          // gate's doctrine block + domain checker.
          gate: body.gate === 'decompose' ? 'decompose' : null,
          signal: abort.signal,
          // Two event shapes: {reading} = the model's spoken reading of the
          // request (a chat turn, streamed early); a string = activity state.
          onEvent: (ev) => {
            if (ev && typeof ev === 'object' && ev.reading) send('reading', { text: ev.reading });
            else send('state', { label: String(ev) });
          },
        });
        let result;
        try {
          result = await runOnce();
        } catch (e1) {
          const retriable = !clientGone && e1?.name !== 'AbortError' && e1?.name !== 'APIUserAbortError'
            && e1?.code !== 'AI_NOT_CONFIGURED';
          if (!retriable) throw e1;
          // RETRY, DON'T RE-TYPE (Dan, 2026-08-30): transient/transcript
          // errors repair by rerunning the whole turn once on a fresh
          // working copy — the engineer never sees raw API JSON.
          console.warn('[agent-turn] first attempt failed, retrying once:', e1.message);
          send('state', { label: 'hit a snag on my side — retrying…' });
          result = await runOnce();
        }
        // Held for reconnect (the stream may have died mid-turn).
        if (body.draftId) {
          agentTurnResults_.set(String(body.draftId), { at: Date.now(), result: { ok: true, ...result } });
          if (agentTurnResults_.size > 20) agentTurnResults_.delete(agentTurnResults_.keys().next().value);
          // SERVER IS THE SOURCE OF TRUTH (Dan, 2026-08-30): the turn's
          // applied draft lands in the store HERE — every subscribed page
          // sees it within ~1s whether or not the requesting tab survives.
          // The requester ignores its own echo via clientId.
          try {
            if (result?.draft) writeDraftStore_(String(body.draftId), result.draft, { by: 'agent', clientId: body.clientId ?? null });
          } catch (e) { console.warn('[agent-turn] store write failed:', e.message); }
        }
        send('done', { ok: true, ...result });
      } catch (e) {
        if (clientGone || (e && (e.name === 'AbortError' || e.name === 'APIUserAbortError'))) {
          // client cancelled
        } else {
          console.error('[agent-turn] failed after retry:', e.message);
          send('error', { error: 'an internal error on my side — the retry failed too' });
        }
      } finally {
        clearInterval(keepalive);
        releaseAi();
      }
      return res.end();
    }

    // AGENTIC device→machine assignment (Dan, 2026-08-28: "aren't you using
    // our standards, our history?") — batched, cheap tier, evidence-cited.
    if (pathname === '/api/jarvis/assign-devices') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      return (async () => {
        try {
          const body = JSON.parse(await readBody(req) || '{}');
          const decomposer = require('./src/lib/agentGenerator/smDecomposer.js');
          const releaseAi = beginAiWork_('assign-devices', null, body.smName || null, { register: false });
          let result;
          try {
            result = await decomposer.assignDevices({
              devices: Array.isArray(body.devices) ? body.devices : [],
              machines: Array.isArray(body.machines) ? body.machines : [],
              description: typeof body.description === 'string' ? body.description : '',
            });
          } finally { releaseAi(); }
          sendJson(res, 200, { ok: true, ...result });
        } catch (e) {
          if (e && e.code === 'AI_NOT_CONFIGURED') return sendJson(res, 503, { error: e.message });
          sendJson(res, 500, { error: e.message });
        }
      })();
    }

    // DEVICE-OWNERSHIP DOCTRINE (Dan, 2026-08-28: a no-precedent ruling files
    // as a dated fact — asked ONCE, ever, company-wide).
    if (pathname === '/api/jarvis/learn-ownership') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      return (async () => {
        try {
          const body = JSON.parse(await readBody(req) || '{}');
          const fact = String(body.fact ?? '').trim();
          if (!fact) return sendJson(res, 400, { error: 'fact required' });
          const { appendLearnedFacts } = require('./src/lib/agentGenerator/meKnowledge.js');
          const { recorded } = appendLearnedFacts([{ scope: 'sdc-standard', fact }], { who: body.who || 'ME' });
          sendJson(res, 200, { ok: true, recorded: recorded.length > 0 });
        } catch (e) { sendJson(res, 500, { error: e.message }); }
      })();
    }

    // Sheet-draft mirror — the serialized draft persists server-side so live
    // incidents are diagnosable from real data (2026-08-27).
    if (pathname === '/api/jarvis/sheet-draft') {
      if (method === 'POST' || method === 'PUT') return handleSheetDraftPut(req, res);
      if (method === 'GET') return handleSheetDraftGet(res, query);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Live draft subscription (server = source of truth, Dan 2026-08-30).
    if (pathname === '/api/jarvis/draft-events') {
      if (method === 'GET') return handleDraftEvents(req, res, query);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // TIER 2/3 queues (Dan's boundary design, 2026-08-30): pending laws
    // (approve/reject — approval files the law dated + attributed) and app
    // suggestions (review; accepted ones flow to the dev loop).
    if (pathname === '/api/jarvis/pending-laws') {
      const p = path.join(__dirname, 'jarvis-knowledge', 'pending-laws.json');
      const readArr = () => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; } };
      if (method === 'GET') return sendJson(res, 200, { ok: true, laws: readArr() });
      if (method === 'POST') {
        return (async () => {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const arr = readArr();
            const it = arr.find(x => x.id === body.id);
            if (!it) return sendJson(res, 404, { error: 'no such pending law' });
            if (body.action === 'approve') {
              const { appendLearnedFacts } = require('./src/lib/agentGenerator/meKnowledge.js');
              appendLearnedFacts([{ scope: 'sdc-standard', fact: `${it.kind === 'law' ? 'LAW' : 'FACT'} (${it.speaker}, approved by Dan): ${it.rule}` }], { who: it.speaker });
              it.status = 'approved'; it.decidedAt = new Date().toISOString();
            } else if (body.action === 'reject') {
              it.status = 'rejected'; it.decidedAt = new Date().toISOString();
            } else return sendJson(res, 400, { error: 'action must be approve|reject' });
            fs.writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
            return sendJson(res, 200, { ok: true, law: it });
          } catch (e) { return sendJson(res, 500, { error: e.message }); }
        })();
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    if (pathname === '/api/jarvis/app-suggestions') {
      const p = path.join(__dirname, 'jarvis-knowledge', 'app-suggestions.json');
      const readArr = () => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; } };
      if (method === 'GET') return sendJson(res, 200, { ok: true, suggestions: readArr() });
      if (method === 'POST') {
        return (async () => {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const arr = readArr();
            const it = arr.find(x => x.id === body.id);
            if (!it) return sendJson(res, 404, { error: 'no such suggestion' });
            if (!['accepted', 'dismissed', 'new'].includes(body.status)) return sendJson(res, 400, { error: 'bad status' });
            it.status = body.status; it.decidedAt = new Date().toISOString();
            fs.writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
            return sendJson(res, 200, { ok: true, suggestion: it });
          } catch (e) { return sendJson(res, 500, { error: e.message }); }
        })();
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Spec-sheet images — the ME's attached pictures persist server-side.
    if (pathname === '/api/jarvis/sheet-images') {
      if (method === 'POST' || method === 'PUT') return handleSheetImagesPut(req, res);
      if (method === 'GET') return handleSheetImagesGet(res, query);
      if (method === 'DELETE') return handleSheetImagesDelete(res, query);
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

    // Live in-flight work — what's generating RIGHT NOW (generation stream,
    // compile, pretranslation), for the Generations grid's in-progress rows.
    if (pathname === '/api/jarvis/active') {
      if (method === 'GET') {
        return sendJson(res, 200, {
          activeGenerations,
          lastAiRequestAt,
          active: [...activeWork_.entries()].map(([id, w]) => ({ id, ...w })),
        });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Approve/deny one of Jarvis's compile decisions (Code grid).
    if (pathname === '/api/jarvis/decisions/review') {
      if (method === 'POST') return handleJarvisDecisionReview(req, res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Build scoring — module owns the routes; see src/lib/agentGenerator/buildScores.js
    if (pathname === '/api/jarvis/generations') {
      if (method === 'GET') return handleJarvisGenerations(res);
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    {
      // Grid file download + corrected-version upload (before the generic
      // buildScores dispatch, which owns list/record/score).
      const mFile = pathname.match(/^\/api\/jarvis\/builds\/([^/]+)\/file$/);
      if (mFile) {
        if (method === 'GET') return handleJarvisBuildFile(res, decodeURIComponent(mFile[1]), query);
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      const mCorr = pathname.match(/^\/api\/jarvis\/builds\/([^/]+)\/corrected$/);
      if (mCorr) {
        if (method === 'POST') return handleJarvisBuildCorrected(req, res, decodeURIComponent(mCorr[1]));
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      // Retry a correction analysis on the already-stored corrected file —
      // a failed analysis must never require re-uploading Jason's red pen.
      const mRean = pathname.match(/^\/api\/jarvis\/builds\/([^/]+)\/corrected\/reanalyze$/);
      if (mRean) {
        if (method === 'POST') return handleJarvisBuildReanalyze(req, res, decodeURIComponent(mRean[1]));
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      // Resume a held generation (hold-for-help) — needs server context
      // (project files, question queue, generation), so it lives here rather
      // than in the buildScores module (which owns approve-changes).
      const mCont = pathname.match(/^\/api\/jarvis\/builds\/([^/]+)\/continue$/);
      if (mCont) {
        if (method === 'POST') return handleJarvisBuildContinue(req, res, decodeURIComponent(mCont[1]));
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      // Mark a build engineer-verified-correct and enshrine its file in the
      // verified library (Dan 2026-08-26: "save the good code — a library to
      // lean on"). UI: a "verified correct" affordance on delivered rows.
      const mVerify = pathname.match(/^\/api\/jarvis\/builds\/([^/]+)\/verify$/);
      if (mVerify) {
        if (method === 'POST') return handleJarvisBuildVerify(req, res, decodeURIComponent(mVerify[1]));
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
    }

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
      if (rest === '/close-stale' && method === 'POST') {
        return handleJarvisQuestionsCloseStale(req, res);
      }
      const m = rest.match(/^\/([^/]+)\/(answer|dismiss)$/);
      if (m && method === 'POST') {
        const id = decodeURIComponent(m[1]);
        if (m[2] === 'answer')  return handleJarvisQuestionAnswer(req, res, id);
        if (m[2] === 'dismiss') return handleJarvisQuestionDismiss(res, id);
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/jarvis/examples') {
      if (method === 'POST') return handleJarvisExampleUpload(req, res);
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

    // ── Guide rails (Dan, Aug 23): the concept files are browsable AND
    // editable on the Jarvis page's Knowledge tab — "these are my guide rails
    // for this, for that; we can edit and tweak and teach."
    //   GET /api/jarvis/concepts           → { concepts: [{name, md, mtime}] }
    //   PUT /api/jarvis/concepts/:name     { md, editedBy? } → save the file
    //     (file-level attribution line appended/updated at the bottom)
    if (pathname === '/api/jarvis/concepts' || pathname.startsWith('/api/jarvis/concepts/')) {
      const conceptsDir = path.join(__dirname, 'jarvis-knowledge', 'concepts');
      if (pathname === '/api/jarvis/concepts') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        try {
          const concepts = fs.readdirSync(conceptsDir)
            .filter(f => f.endsWith('.md'))
            .map(f => {
              const fp = path.join(conceptsDir, f);
              let mtime = null;
              try { mtime = fs.statSync(fp).mtime.toISOString(); } catch (_) {}
              return { name: f.replace(/\.md$/, ''), md: fs.readFileSync(fp, 'utf8'), mtime };
            });
          return sendJson(res, 200, { concepts });
        } catch (e) {
          return sendJson(res, 200, { concepts: [], error: e.message });
        }
      }
      // PUT /api/jarvis/concepts/:name
      const name = decodeURIComponent(pathname.slice('/api/jarvis/concepts/'.length));
      if (method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return sendJson(res, 400, { error: 'Bad concept name' });
      const fp = path.join(conceptsDir, name + '.md');
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Concept not found' });
      return readBody(req).then(raw => {
        let body;
        try { body = JSON.parse(raw || '{}'); } catch (_) { return sendJson(res, 400, { error: 'Bad JSON' }); }
        let md = String(body.md ?? '');
        if (!md.trim()) return sendJson(res, 400, { error: 'Empty content refused — delete lines, not the file' });
        // File-level attribution (cheap and honest): one line at the bottom.
        const who = String(body.editedBy || 'the team').slice(0, 40);
        const stamp = `_Last edited by ${who} on ${new Date().toISOString().slice(0, 10)} (Knowledge tab)._`;
        const attrRe = /\n?_Last edited by .* \(Knowledge tab\)\._\s*$/;
        md = md.replace(attrRe, '').trimEnd() + '\n\n' + stamp + '\n';
        try {
          fs.writeFileSync(fp, md, 'utf8');
          return sendJson(res, 200, { ok: true, name, md });
        } catch (e) { return sendJson(res, 500, { error: e.message }); }
      }).catch(e => sendJson(res, 500, { error: e.message }));
    }

    /** GET /api/jarvis/sources — the knowledge-source manifest ("what Jarvis
     *  knows and where it came from"), written by the ingestion pipeline to
     *  jarvis-knowledge/sources.json:
     *    [{ name, location, accessStatus, lastIngested, takeaways: [string] }]
     *  Missing file → { ok:true, sources: null } (the UI shows "no manifest
     *  yet" rather than an error). */
    if (pathname === '/api/jarvis/sources') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const srcFile = path.join(__dirname, 'jarvis-knowledge', 'sources.json');
      try {
        if (!fs.existsSync(srcFile)) return sendJson(res, 200, { ok: true, sources: null });
        const parsed = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
        const sources = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.sources) ? parsed.sources : []);
        return sendJson(res, 200, { ok: true, sources });
      } catch (e) {
        return sendJson(res, 200, { ok: true, sources: null, error: `sources.json unreadable: ${e.message}` });
      }
    }

    /** The JARVIS Inbox librarian (Dan, 2026-08-28) — classify + distill
     *  everything dropped in JARVIS Inbox\ (and the network watch folders)
     *  into the ONE knowledge store.
     *    GET  /api/jarvis/librarian/status → unread count, last run, recent
     *         ledger lines, network watch-folder state
     *    POST /api/jarvis/librarian/run    → process now ("Learn now") */
    if (pathname === '/api/jarvis/librarian/status') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      try {
        return sendJson(res, 200, require('./src/lib/agentGenerator/librarian.js').getStatus());
      } catch (e) { return sendJson(res, 500, { error: e.message }); }
    }
    if (pathname === '/api/jarvis/librarian/run') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      // Counts as in-flight AI work (distill calls) so restart discipline holds,
      // but stays out of the Generations grid — it's not a build.
      const release = beginAiWork_('librarian', null, null, { register: false });
      return require('./src/lib/agentGenerator/librarian.js')
        .runLibrarian({ trigger: 'learn-now' })
        .then(r => sendJson(res, 200, r))
        .catch(e => sendJson(res, 500, { error: e.message }))
        .finally(release);
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
    res.end('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee"><h2 style="color:#f59e0b">App not built yet</h2><p>Run <b>npm run build</b> (or use START_APP.bat for the dev server).</p></body></html>');
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

  // ── JARVIS Inbox librarian — on-start scan + daily run (Dan, 2026-08-28:
  //    "Jarvis reads new files daily"). Both fire the same run the "Learn
  //    now" button uses; the single-flight lock inside runLibrarian makes
  //    overlap harmless. Timers are unref'd so they never hold the process.
  const runLibrarian_ = (trigger) => {
    let release = () => {};
    try {
      const librarian = require('./src/lib/agentGenerator/librarian.js');
      release = beginAiWork_('librarian', null, null, { register: false });
      librarian.runLibrarian({ trigger })
        .then(r => {
          if (r.processed?.length || r.errors?.length) {
            console.log(`[librarian] ${trigger}: ${r.processed.length} processed, ${r.errors.length} error(s)`);
          }
        })
        .catch(e => console.warn('[librarian] run failed:', e.message))
        .finally(release);
    } catch (e) {
      release();
      console.warn('[librarian] unavailable:', e.message);
    }
  };
  setTimeout(() => runLibrarian_('startup'), 20 * 1000).unref();
  setInterval(() => runLibrarian_('daily'), 24 * 60 * 60 * 1000).unref();

  return server;
}

// Standalone mode: node server.js
if (require.main === module) {
  startServer();
}

module.exports = { startServer };
