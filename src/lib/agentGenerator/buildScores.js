/**
 * buildScores.js — per-build scoring records for Jarvis (Dan's ask: every
 * build gets scored by the person who ran it; the data accumulates per
 * Jarvis version).
 *
 * Storage: <repo>/jarvis-knowledge/buildScores.json — a flat array:
 *   [{ id, at, project, sm, jarvisVersion, costUSD, durationS, attempts,
 *      validationOk, internalReview | null, score (1-100) | null, scoreScale,
 *      scoredBy, scoreComment, filePath }]
 *
 * SCORE SCALE (Dan, 2026-08): scores are out of 100 ("more fun, more level of
 * detail"). Legacy 1-10 records are migrated ×10 on first read and stamped
 * scoreScale: 100 so the migration never runs twice.
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
 *   POST /api/jarvis/builds/:id/approve-changes → { indexes?, approvedBy? }
 *                                        marks structuralChanges approved (all
 *                                        when indexes omitted) → { ok, build }
 *
 * Escalation-model fields (Dan, 2026-08 — exact UI contract):
 *   build.writingNotes      [{ text }]
 *   build.structuralChanges [{ text, irPatch?, approved }]
 *   build.help              { questions:[{ id, question, proposedSolution,
 *                             addressee:'ME'|'CE' }], status:'waiting'|
 *                             'resumed'|'resolved' } | null
 *   build.resumePath        sidecar resume-state file for held builds
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

const { resolveQuestionDomain, resolveAddressee } = require('./questionRouter');

const LEARNED_HEADING = '## Learned from the MEs';

// ── Escalation-model normalizers (Dan's escalation model, 2026-08) ──────────
// Schemas are a CONTRACT with the v2 UI agent — keep them exact:
//   build.writingNotes:       [{ text }]
//   build.structuralChanges:  [{ text, approved }]  (+ irPatch when declared)
//   build.help:               { questions: [{ id, question, proposedSolution,
//                               addressee }], status }

/** [{text}] — the right-amount one-sentence notes of what came up while
 *  writing. Never filler: blank entries are dropped, strings tolerated. */
function normalizeWritingNotes(v) {
  return (Array.isArray(v) ? v : [])
    .map(n => ({ text: String((n && typeof n === 'object') ? n.text : n || '').trim() }))
    .filter(n => n.text);
}

/** [{text, irPatch?, approved}] — deliberate weeds-decisions the writer made
 *  vs the approved compiled IR. Unapproved changes don't block the file but
 *  persist visibly until approved. */
function normalizeStructuralChanges(v) {
  return (Array.isArray(v) ? v : [])
    .filter(c => c && String(c.text || '').trim())
    .map(c => ({
      text: String(c.text).trim(),
      ...(c.irPatch !== undefined ? { irPatch: c.irPatch } : {}),
      approved: c.approved === true,
      ...(c.approvedBy ? { approvedBy: String(c.approvedBy) } : {}),
      ...(c.approvedAt ? { approvedAt: String(c.approvedAt) } : {}),
    }));
}

/** { questions:[{id, question, proposedSolution, addressee}], status } | null
 *  — hold-for-help state. status: 'waiting' | 'resumed' | 'resolved'. */
function normalizeHelp(v) {
  if (!v || typeof v !== 'object') return null;
  const questions = (Array.isArray(v.questions) ? v.questions : [])
    .filter(q => q && String(q.question || '').trim())
    .map(q => {
      const domain = resolveQuestionDomain(q.domain, String(q.question), '');
      return {
        id: String(q.id || ''),
        question: String(q.question).trim(),
        // Solutions, not explanations: every question carries Jarvis's best
        // answer. null = Jarvis honestly had no proposal (kept visible).
        proposedSolution: q.proposedSolution != null ? String(q.proposedSolution).trim() || null : null,
        addressee: resolveAddressee(q.addressee, domain),
      };
    });
  const status = ['waiting', 'resumed', 'resolved'].includes(v.status) ? v.status : 'waiting';
  return { questions, status };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readBuilds(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? migrateScoreScale(file, parsed) : [];
  } catch (e) {
    console.warn('[jarvis-builds] read failed:', e.message);
    return [];
  }
}

/** One-time 1-10 → 1-100 migration (scores are out of 100 now). A scored
 *  record without scoreScale: 100 is a legacy 1-10 score — ×10, stamp the
 *  scale + scoreMigratedAt, write back. Idempotent: once stamped it never
 *  re-runs; unscored legacy records get stamped when they're first scored. */
function migrateScoreScale(file, arr) {
  let changed = false;
  for (const b of arr) {
    if (b && b.score != null && b.scoreScale !== 100) {
      b.score = Math.max(1, Math.min(100, Math.round(Number(b.score) * 10)));
      b.scoreScale = 100;
      b.scoreMigratedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    try { writeBuilds(file, arr); }
    catch (e) { console.warn('[jarvis-builds] score-scale migration write failed:', e.message); }
  }
  return arr;
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
    // THE METRIC (Dan's first-pass doctrine, 2026-08-25): firstPassShip =
    // one write, zero fix rounds, validation clean, single review said ship.
    // null = the review didn't run (an honest ship claim is impossible).
    // roundsToShip = total attempts when the build shipped, else null.
    // Aggregated by GET /api/jarvis/trackrecord as the first-pass ship rate —
    // Jarvis's headline number.
    firstPassShip: b.firstPassShip === true ? true : b.firstPassShip === false ? false : null,
    // Number(null) === 0, so null must short-circuit BEFORE numOrNull — an
    // unshipped build has no roundsToShip, and 0 would poison the average.
    roundsToShip: b.roundsToShip == null ? null : numOrNull(b.roundsToShip),
    // 'authoring' | 'translation' | null (pre-v2.1 records have null)
    mode: b.mode ? String(b.mode) : null,
    // PRE-WRITE STUDY provenance (Dan, 2026-08-26: "18 examples — which one do
    // I pick? that's key"). Records WHICH exemplar was studied and WHY, e.g.
    // studied: SDCServoPNP_JARVIS_v7.L5X (engineer-verified, servo family
    // match). null on pre-study or study-less builds. Shape:
    // { exemplar: {name, kind, family, reason, complete}|null, studied: '<line>'|null }
    study: (b.study && typeof b.study === 'object') ? (() => {
      const ex = (b.study.exemplar && typeof b.study.exemplar === 'object') ? {
        name: String(b.study.exemplar.name || ''),
        kind: String(b.study.exemplar.kind || ''),
        family: b.study.exemplar.family ? String(b.study.exemplar.family) : null,
        reason: b.study.exemplar.reason ? String(b.study.exemplar.reason) : null,
        complete: b.study.exemplar.complete === true,
      } : null;
      return {
        exemplar: ex,
        studied: ex && ex.name
          ? `studied: ${ex.name} (${[ex.kind, ex.family ? `${ex.family} family match` : null].filter(Boolean).join(', ')})`
          : null,
      };
    })() : null,
    // true when this build ran in the background on compile-approval
    pretranslated: b.pretranslated === true,
    // PRE-DELIVERY INTERNAL REVIEW (internalReviewer.js) — Jarvis's own
    // adversarial pass against the template before the file can go external.
    // { verdict: 'ship'|'fix'|'unsure'|null, findings, standardsQuestions,
    //   questionIds, heldStatus, missingVsTemplate, summary, costUSD, error? }
    //   — null when the review didn't run (gated off or pre-review build).
    //   verdict null with error = review attempted, failed. 'unsure' = build
    //   HELD, standards questions filed to jarvis-knowledge/questions.json.
    internalReview: (b.internalReview && typeof b.internalReview === 'object') ? {
      verdict: b.internalReview.verdict ?? null,
      findings: Array.isArray(b.internalReview.findings) ? b.internalReview.findings : [],
      standardsQuestions: Array.isArray(b.internalReview.standardsQuestions) ? b.internalReview.standardsQuestions : [],
      questionIds: Array.isArray(b.internalReview.questionIds) ? b.internalReview.questionIds : [],
      heldStatus: b.internalReview.heldStatus ? String(b.internalReview.heldStatus) : null,
      missingVsTemplate: Array.isArray(b.internalReview.missingVsTemplate) ? b.internalReview.missingVsTemplate : [],
      summary: String(b.internalReview.summary || ''),
      costUSD: numOrNull(b.internalReview.costUSD),
      ...(b.internalReview.error ? { error: String(b.internalReview.error) } : {}),
    } : null,
    // ── Escalation model (Dan, 2026-08) — all additive, backward-compatible:
    // pre-escalation records simply lack the fields; readers treat absent as
    // empty/null exactly like the defaults below.
    writingNotes: normalizeWritingNotes(b.writingNotes),
    structuralChanges: normalizeStructuralChanges(b.structuralChanges),
    help: normalizeHelp(b.help),
    // Path to the persisted resume state for a held build (sidecar file next
    // to the generated L5X) — kept OUTSIDE help so the UI schema stays exact.
    resumePath: b.resumePath ? String(b.resumePath) : null,
    // ── Review-loop transparency (Dan, 2026-08-25) — the FULL round log rides
    // on the record so the UI's timeline + final-verdict chip never show a
    // stale intermediate. All additive; older records simply lack them.
    //   label:        the delivered version name ('v7') — delivered builds only
    //   verdict:      the FINAL review verdict ('ship'|'fix'|'unsure')
    //   shippedAs/At: the delivered filename in JARVIS Deliveries
    //   reviewHistory:[{ round, verdict, blockers, note }] — every round
    //   notes:        rulings/lessons applied, '; '-separated one-liners
    ...(b.label ? { label: String(b.label) } : {}),
    ...(b.verdict ? { verdict: String(b.verdict) } : {}),
    ...(b.shippedAs ? { shippedAs: String(b.shippedAs) } : {}),
    ...(b.shippedAt ? { shippedAt: String(b.shippedAt) } : {}),
    ...(Array.isArray(b.reviewHistory) ? {
      reviewHistory: b.reviewHistory
        .filter(r => r && (r.verdict || r.round))
        .map(r => ({
          round: String(r.round ?? ''),
          verdict: String(r.verdict ?? ''),
          ...(Number.isFinite(Number(r.blockers)) ? { blockers: Number(r.blockers) } : {}),
          ...(r.note ? { note: String(r.note) } : {}),
        })),
    } : {}),
    ...(b.notes ? { notes: String(b.notes) } : {}),
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
  if (!Number.isInteger(s) || s < 1 || s > 100) {
    const err = new Error('score must be an integer 1-100 (scores are out of 100)');
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
  build.scoreScale = 100; // out of 100 — also marks the record as post-migration
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
 * Approve one or more of a build's structural changes (Dan's quick approve:
 * "here's the code, by the way I changed a couple sequences — check, approve,
 * we go"). indexes omitted/empty = approve ALL unapproved changes.
 * Returns the updated build or throws { status, message }.
 */
function approveStructuralChanges(file, id, { indexes, approvedBy } = {}) {
  const arr = readBuilds(file);
  const build = arr.find(x => x && x.id === id);
  if (!build) {
    const err = new Error('Build not found');
    err.status = 404;
    throw err;
  }
  const changes = Array.isArray(build.structuralChanges) ? build.structuralChanges : [];
  if (!changes.length) {
    const err = new Error('This build has no structural changes to approve');
    err.status = 400;
    throw err;
  }
  const want = Array.isArray(indexes) && indexes.length
    ? indexes.map(Number)
    : changes.map((_, i) => i);
  const bad = want.filter(i => !Number.isInteger(i) || i < 0 || i >= changes.length);
  if (bad.length) {
    const err = new Error(`Invalid structural-change index(es): ${bad.join(', ')} (build has ${changes.length})`);
    err.status = 400;
    throw err;
  }
  const at = new Date().toISOString();
  const who = String(approvedBy || '').trim() || 'Unknown';
  for (const i of want) {
    changes[i].approved = true;
    changes[i].approvedBy = who;
    changes[i].approvedAt = at;
  }
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

    // POST /api/jarvis/builds/:id/approve-changes — { indexes?, approvedBy? }
    // marks the build's structural changes approved (all when indexes omitted).
    const mApprove = rest.match(/^\/([^/]+)\/approve-changes$/);
    if (mApprove && method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const build = approveStructuralChanges(file, decodeURIComponent(mApprove[1]), body);
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
  approveStructuralChanges,
  normalizeWritingNotes, normalizeStructuralChanges, normalizeHelp,
};
