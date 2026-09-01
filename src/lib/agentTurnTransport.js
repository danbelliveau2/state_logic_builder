/**
 * agentTurnTransport.js — THE TRANSPORT CONTRACT for chat turns
 * (Dan, 2026-08-31: "there can NEVER be a connection loss — it has to be
 * reliable"). SERVER IS TRUTH:
 *
 *   • BASELINE: a 3s poll of /agent-turn/last — it alone completes every
 *     turn. Works through server restarts (results are disk-persisted
 *     server-side), dropped streams, laptop sleeps.
 *   • ENHANCEMENT: the SSE stream, for instant activity labels and the
 *     streamed reading. If it drops, NOTHING is said and nothing changes —
 *     the poll delivers the result within seconds. Connection vocabulary is
 *     BANNED from the product (a layout-gate invariant enforces it).
 *   • The ONLY user-visible failure: the server itself reports the turn dead
 *     (not running, no fresh result) → the caller renders one line + Retry.
 *     No timers counting past a live turn, no transport language anywhere.
 *
 * Plain ESM with injectable fetch/timing so the liveness gate
 * (scripts/regressTurnTransport.cjs) can kill the stream mid-turn and prove
 * the result still lands within seconds.
 */

/** The one user-visible failure line (no connection vocabulary). */
export const TURN_DEAD_MESSAGE = 'that turn was dropped before it finished — nothing was applied. Retry runs it again.';

/** Minimal SSE reader over a fetch Response body. Calls onEvent(event, data)
 *  per event; resolves when the stream closes. */
export async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      let dataStr = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (dataStr) {
        try { onEvent(event, JSON.parse(dataStr)); } catch { /* skip bad frame */ }
      }
    }
  }
}

/**
 * Run one agent turn. Resolves with the done payload; rejects ONLY with a
 * server-reported failure (err.serverReported = true) or, for legacy calls
 * without a draftId, a transport error (no poll key to fall back on).
 *
 * @param {object}   payload    the turn body ({ draftId, message, ... })
 * @param {function} onState    live activity label (enhancement only)
 * @param {function} onReading  streamed reading (enhancement only)
 * @param {object}   opts       test hooks: { fetch, pollMs, streamSilenceMs, offerReload }
 */
export async function agentTurnRequest(payload, onState, onReading, opts = {}) {
  const F = opts.fetch ?? ((...a) => fetch(...a));
  const pollMs = opts.pollMs ?? 3000;
  const streamSilenceMs = opts.streamSilenceMs ?? 20000;
  const offerReload = opts.offerReload ?? ((m) => { try { window.__slbOfferReload?.(m); } catch { /* no bar host */ } });

  const turnStart = Date.now();
  const draftId = payload.draftId ? String(payload.draftId) : null;
  const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));
  const NEVER = new Promise(() => {});
  let settled = false;      // stops the poll once anything wins
  let streamAlive = true;   // a dead-call needs the stream gone too (grace)

  // ── The POLL BASELINE ──────────────────────────────────────────────────
  const pollBaseline = draftId ? (async () => {
    let deadConfirms = 0;
    while (!settled) {
      await sleep(pollMs);
      if (settled) break;
      try {
        const r = await F(`/api/jarvis/agent-turn/last?draftId=${encodeURIComponent(draftId)}`);
        const d = await r.json().catch(() => null);
        // 2s skew grace: `at` is server-stamped, turnStart is this machine.
        if (d?.ok && d.at >= turnStart - 2000 && d.result?.ok) return d.result;
        if (d && d.running === false && !streamAlive) {
          // Server truth, confirmed thrice, with the stream also gone:
          // no turn running and no fresh result — the turn is dead.
          if (++deadConfirms >= 3) return 'TURN_DEAD';
        } else {
          deadConfirms = 0;
        }
      } catch { /* server unreachable this tick — keep polling, say nothing */ }
    }
    return NEVER;
  })() : NEVER;

  // ── The SSE ENHANCEMENT (never a dependency when a draftId exists) ─────
  const ctrl = new AbortController();
  let lastEvent = Date.now();
  const watchdog = setInterval(() => {
    // A silent stream (server pings every 5s when alive) is abandoned
    // QUIETLY — the poll owns the outcome. No message, no state change.
    if (Date.now() - lastEvent > streamSilenceMs) { clearInterval(watchdog); streamAlive = false; ctrl.abort(); }
  }, Math.min(3000, pollMs));
  const streamPromise = (async () => {
    try {
      const res = await F('/api/jarvis/agent-turn/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const isSse = res.ok && (res.headers.get('content-type') || '').includes('text/event-stream') && !!res.body;
      if (!isSse) {
        const data = await res.json().catch(() => ({}));
        // A 200-but-not-a-stream answer = this tab is older than the server.
        // Never tell him to hard-reload in words — offer the bar (Dan).
        if (res.ok) offerReload('The app updated underneath this tab.');
        const e = new Error(data.error || (res.ok ? 'this tab is out of date — use the Reload bar below' : `The engine returned an error (${res.status})`));
        e.serverReported = true; // a real server answer — surface it
        throw e;
      }
      let result = null; let err = null;
      await readSse(res, (event, data) => {
        lastEvent = Date.now();
        if (event === 'state') onState?.(data.label);
        else if (event === 'reading') onReading?.(data.text); // his catch-the-misread-early moment
        else if (event === 'trace') opts.onTrace?.(data); // full working transcript (Dan, 2026-08-31)
        else if (event === 'done') result = data;
        else if (event === 'error') { err = new Error(data.error || 'the turn failed'); err.serverReported = true; }
        // 'ping' just refreshes lastEvent
      });
      if (err) throw err;
      if (result && result.ok) return result;
      // Stream closed without a done event — a transport artifact, not an
      // answer. The poll decides; a legacy call without a draftId fails.
      streamAlive = false;
      if (!draftId) { const e = new Error(TURN_DEAD_MESSAGE); e.serverReported = true; throw e; }
      return NEVER;
    } catch (e) {
      streamAlive = false;
      if (e?.serverReported) throw e;              // the server really answered
      if (!draftId) throw e;                       // no poll to fall back on
      return NEVER;                                // silent — the poll owns it
    }
  })();

  try {
    const winner = await Promise.race([pollBaseline, streamPromise]);
    if (winner === 'TURN_DEAD') { const e = new Error(TURN_DEAD_MESSAGE); e.serverReported = true; throw e; }
    return winner;
  } finally {
    settled = true;
    clearInterval(watchdog);
    try { ctrl.abort(); } catch { /* already closed */ }
  }
}
