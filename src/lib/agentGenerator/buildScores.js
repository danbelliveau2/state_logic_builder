/**
 * buildScores.js — per-build scoring records for Jarvis (Dan's ask: every
 * build gets scored by the person who ran it; the data accumulates per
 * Jarvis version).
 *
 * Storage: <repo>/jarvis-knowledge/buildScores.json — a flat array:
 *   [{ id, at, project, sm, jarvisVersion, costUSD, durationS, attempts,
 *      validationOk, score (1-10) | null, scoredBy, scoreComment, filePath }]
 *
 * Server-side only (CommonJS, Node built-ins). server.js mounts
 * handleBuildsRoute() for:
 *   GET  /api/jarvis/builds            → the full array (oldest first)
 *   POST /api/jarvis/builds            → record a build (called automatically
 *                                        by the /api/generate/stream done path,
 *                                        or manually) → { ok, build }
 *   POST /api/jarvis/builds/:id/score  → { score, comment?, goodNotes?,
 *                                        badNotes?, scoredBy? } → { ok, build }
 *                                        (goodNotes/badNotes: Dan's review-grid
 *                                        "what was good / what was bad" fields)
 *
 * recordBuild() is also called directly (in-process) by the generate-stream
 * done handler so recording needs zero client changes.
 *
 * Also home to the learned-knowledge line editor (Dan: "some ability to look
 * at that and adjust it occasionally"):
 *   PUT /api/jarvis/knowledge/learned  → { oldLine, newLine } — exact-match
 *     replace of ONE bullet line inside meKnowledge.md's "## Learned from the
 *     MEs" section (empty/blank newLine deletes the line). 404 if the line
 *     isn't found. Standing sections are NOT editable through this route.
 */

const fs = require('fs');
const path = require('path');

const LEARNED_HEADING = '## Learned from the MEs';

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readBuilds(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[jarvis-builds] read failed:', e.message);
    return [];
  }
}

/** Atomic write (tmp + rename), one retry — same pattern as questions.json. */
function writeBuilds(file, arr) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const body = JSON.stringify(arr, null, 2);
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  }
}

/** Append one build record. Returns the stored build (with id/at). */
function recordBuild(file, b = {}) {
  const build = {
    id: 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    at: new Date().toISOString(),
    project: String(b.project || '').trim(),
    sm: String(b.sm || '').trim(),
    jarvisVersion: b.jarvisVersion != null ? String(b.jarvisVersion) : null,
    costUSD: numOrNull(b.costUSD),
    durationS: numOrNull(b.durationS),
    attempts: numOrNull(b.attempts),
    validationOk: b.validationOk === true,
    // 'authoring' | 'translation' | null (pre-v2.1 records have null)
    mode: b.mode ? String(b.mode) : null,
    // true when this build ran in the background on compile-approval
    pretranslated: b.pretranslated === true,
    score: null,
    scoredBy: null,
    scoreComment: null,
    filePath: b.filePath ? String(b.filePath) : null,
  };
  const arr = readBuilds(file);
  arr.push(build);
  writeBuilds(file, arr);
  return build;
}

/** Attach a score to an existing build. Returns the updated build,
 *  or throws { status, message } for client errors. */
function scoreBuild(file, id, { score, comment, scoredBy, goodNotes, badNotes } = {}) {
  const s = Number(score);
  if (!Number.isInteger(s) || s < 1 || s > 10) {
    const err = new Error('score must be an integer 1-10');
    err.status = 400;
    throw err;
  }
  const arr = readBuilds(file);
  const build = arr.find(x => x && x.id === id);
  if (!build) {
    const err = new Error('Build not found');
    err.status = 404;
    throw err;
  }
  build.score = s;
  build.scoredBy = String(scoredBy || '').trim() || 'Unknown';
  build.scoreComment = String(comment || '').trim();
  // Review-grid fields (v2.1.2): what was good / what was bad — talk or text.
  build.goodNotes = String(goodNotes || '').trim();
  build.badNotes = String(badNotes || '').trim();
  build.scoredAt = new Date().toISOString();
  writeBuilds(file, arr);
  return build;
}

/** Find one build record by id (or null). */
function getBuild(file, id) {
  return readBuilds(file).find(x => x && x.id === id) || null;
}

/** Shallow-merge a patch into one build record (read-modify-write, atomic).
 *  Used by the correction-learning loop to attach upload/analysis state.
 *  Returns the updated build or throws { status: 404 }. */
function updateBuild(file, id, patch) {
  const arr = readBuilds(file);
  const build = arr.find(x => x && x.id === id);
  if (!build) {
    const err = new Error('Build not found');
    err.status = 404;
    throw err;
  }
  Object.assign(build, patch);
  writeBuilds(file, arr);
  return build;
}

/**
 * Route handler for everything under /api/jarvis/builds. server.js passes its
 * own sendJson/readBody helpers so this module stays dependency-free.
 * @returns {Promise<void>} always responds.
 */
async function handleBuildsRoute(req, res, { pathname, method, sendJson, readBody, file }) {
  try {
    const rest = pathname.slice('/api/jarvis/builds'.length);

    if (rest === '' || rest === '/') {
      if (method === 'GET') return sendJson(res, 200, readBuilds(file));
      if (method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        return sendJson(res, 200, { ok: true, build: recordBuild(file, body) });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const m = rest.match(/^\/([^/]+)\/score$/);
    if (m && method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const build = scoreBuild(file, decodeURIComponent(m[1]), body);
      return sendJson(res, 200, { ok: true, build });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return sendJson(res, e.status || 500, { error: e.message });
  }
}

// ── Learned-knowledge line editing ──────────────────────────────────────────

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Atomic write (tmp + rename), one retry — Windows-safe. */
function writeFileAtomic(file, body) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  }
}

/**
 * Replace (or delete, when newLine is blank) ONE exact-match bullet line
 * inside meKnowledge.md's "## Learned from the MEs" section. Lines outside
 * that section are never touched — the standing sections stay read-only.
 * Throws { status, message } on client errors.
 */
function updateLearnedLine(mdPath, oldLine, newLine) {
  const old = String(oldLine ?? '');
  if (!old.trim().startsWith('- ')) throw httpError(400, 'oldLine must be a learned bullet line ("- …")');
  let md;
  try { md = fs.readFileSync(mdPath, 'utf8'); }
  catch (_) { throw httpError(404, 'meKnowledge.md not found'); }

  const headIdx = md.indexOf(LEARNED_HEADING);
  if (headIdx === -1) throw httpError(404, '"' + LEARNED_HEADING + '" section not found');

  const head = md.slice(0, headIdx);
  const lines = md.slice(headIdx).split('\n');
  const idx = lines.findIndex(l => l === old || l.trimEnd() === old.trimEnd());
  if (idx === -1) throw httpError(404, 'Line not found in the Learned section (it may have changed on disk — reload and retry)');

  const next = String(newLine ?? '').replace(/\r?\n/g, ' ').trimEnd();
  const removed = !next.trim();
  if (removed) lines.splice(idx, 1);
  else {
    if (!next.trim().startsWith('- ')) throw httpError(400, 'newLine must stay a bullet line ("- …")');
    lines[idx] = next;
  }
  writeFileAtomic(mdPath, head + lines.join('\n'));
  return { removed, line: removed ? null : next };
}

/** Route handler for PUT /api/jarvis/knowledge/learned. */
async function handleLearnedLineRoute(req, res, { sendJson, readBody, mdPath }) {
  try {
    const body = JSON.parse(await readBody(req) || '{}');
    if (!body.oldLine) return sendJson(res, 400, { error: 'oldLine is required' });
    const result = updateLearnedLine(mdPath, body.oldLine, body.newLine);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (e) {
    return sendJson(res, e.status || 500, { error: e.message });
  }
}

module.exports = {
  readBuilds, recordBuild, scoreBuild, getBuild, updateBuild, handleBuildsRoute,
  updateLearnedLine, handleLearnedLineRoute,
};
