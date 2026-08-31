/**
 * verifyLoop.js — the DO → CHECK → REDO loop for EVERY in-app AI action.
 *
 * Dan (2026-08-24): "in the app it doesn't think like you do here." An in-app
 * model call (corrections apply, summarize, compile-adjacent edits) must never
 * hand the user its FIRST draft — it verifies before it returns, the way a
 * person re-reads their own work. THIS IS THE STANDING PATTERN FOR ALL FUTURE
 * IN-APP AI ENDPOINTS:
 *
 *   1. MECHANICAL CHECKS — always, free, no model call:
 *      schema validation, geometric sanity (geometrySanity.js), twin
 *      detection, truncation detection, did-the-request-actually-land
 *      (diff vs the ME's ask). Pure functions over the result.
 *   2. MODEL SELF-CHECK — ONE cheap call, only when a mechanical check
 *      flagged OR the change is non-trivial: "here was the request, here's
 *      the result and diff — does the result correctly satisfy it? anything
 *      a reasonable engineer would flag?"
 *   3. RETRY — on a failed self-check the producer runs ONCE more with the
 *      critique in context (max 1 retry — latency stays sane).
 *   4. HONESTY — on persistent failure the reply says "I couldn't get this
 *      right — here's what I tried" instead of landing wrong data.
 *
 * CJS (server-side). geometrySanity.js is ESM — use loadGeometrySanity().
 */

'use strict';

/** Dynamic-import the ESM geometry checks from CJS. Cached. */
let _geomP = null;
function loadGeometrySanity() {
  if (!_geomP) {
    const { pathToFileURL } = require('url');
    const path = require('path');
    _geomP = import(pathToFileURL(path.join(__dirname, '..', 'geometrySanity.js')).href);
  }
  return _geomP;
}

// ── Canned mechanical checks (each returns an array of plain-sentence findings) ──

/** Geometric sanity over sheet-shaped device rows ({positions:[{name,valueMm}]}). */
async function checkSheetGeometry(devices) {
  const { sheetGeometryIssues } = await loadGeometrySanity();
  return sheetGeometryIssues(devices).map((g) => `${g.axisName}: ${g.message}`);
}

/** Twin detection: two device rows whose normalized names contain each other
 *  (same type or a type missing) are the SAME device — flag them. */
function checkDeviceTwins(devices) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const findings = [];
  const rows = (devices ?? []).filter((d) => d && d.name);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = norm(rows[i].name);
      const b = norm(rows[j].name);
      if (!a || !b) continue;
      const ta = rows[i].type ?? null;
      const tb = rows[j].type ?? null;
      if (ta && tb && ta !== tb) continue;
      if (a === b || a.includes(b) || b.includes(a)) {
        findings.push(`"${rows[i].name}" and "${rows[j].name}" look like the SAME device listed twice — merge them into one card.`);
      }
    }
  }
  return findings;
}

/** Truncation detection: user-facing strings must never be cut off. */
function checkTruncation(strings) {
  const findings = [];
  for (const s of strings ?? []) {
    const t = String(s ?? '');
    if (/(…|\.\.\.)$/.test(t.trim())) {
      findings.push(`Text ends in an ellipsis — never truncate, full text always: "${t.trim().slice(-80)}"`);
    }
  }
  return findings;
}

/**
 * Did the request actually land? Caller supplies the computed diff (the same
 * honest diff the receipt uses — never the model's claims). A non-empty
 * request with an EMPTY diff is the classic silent no-op.
 */
function checkRequestLanded(requestText, diffEntries) {
  const req = String(requestText ?? '').trim();
  if (!req) return [];
  if (!Array.isArray(diffEntries) || diffEntries.length === 0) {
    return [`The request ("${req.slice(0, 120)}") produced NO actual change — nothing landed on the sheet.`];
  }
  return [];
}

/**
 * The loop.
 *
 * @param {object} opts
 * @param {string} opts.request           the ME's ask, verbatim
 * @param {(critique:string|null)=>Promise<any>} opts.produce
 *        runs the model action; on retry receives the critique to fold in
 * @param {(result:any)=>Promise<string[]>|string[]} opts.mechanicalChecks
 *        free checks over the result → plain-sentence findings
 * @param {null|((args:{request:string,result:any,findings:string[]})=>Promise<{ok:boolean,critique?:string}>)} [opts.selfCheck]
 *        ONE cheap model call; null to skip (mechanical-only endpoints)
 * @param {(result:any)=>boolean} [opts.isNonTrivial]  forces the self-check
 * @param {number} [opts.maxRetries=1]
 * @returns {Promise<{ok:boolean, result:any, findings:string[], attempts:number,
 *          gaveUp:boolean, tried:string[]}>}
 *          gaveUp=true → the caller MUST answer honestly ("I couldn't get
 *          this right — here's what I tried: …tried") instead of landing data.
 */
async function runVerifiedAction(opts) {
  const { request, produce, mechanicalChecks, selfCheck = null, isNonTrivial = () => false, maxRetries = 1 } = opts;
  const tried = [];
  let critique = null;
  let result = null;
  let findings = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    result = await produce(critique);
    findings = (await mechanicalChecks(result)) || [];

    let selfCheckFail = null;
    if (selfCheck && (findings.length > 0 || isNonTrivial(result))) {
      const sc = await selfCheck({ request, result, findings });
      if (!sc.ok) selfCheckFail = sc.critique || 'self-check failed';
    }

    if (findings.length === 0 && !selfCheckFail) {
      return { ok: true, result, findings: [], attempts: attempt + 1, gaveUp: false, tried };
    }

    critique = [
      findings.length ? `Mechanical checks flagged:\n${findings.map((f) => `- ${f}`).join('\n')}` : null,
      selfCheckFail ? `Self-review flagged: ${selfCheckFail}` : null,
      'Redo the work fixing exactly these — change nothing else.',
    ].filter(Boolean).join('\n');
    tried.push(critique);
  }

  // Persistent failure — be honest, never land wrong data.
  return { ok: false, result, findings, attempts: maxRetries + 1, gaveUp: true, tried };
}

module.exports = {
  runVerifiedAction,
  checkSheetGeometry,
  checkDeviceTwins,
  checkTruncation,
  checkRequestLanded,
  loadGeometrySanity,
};
