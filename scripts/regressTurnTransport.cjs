/**
 * regressTurnTransport.cjs — THE POLL-BASELINE LIVENESS GATE
 * (Dan, 2026-08-31: "there can NEVER be a connection loss").
 *
 * Proves, with a mocked server:
 *   A. Stream killed mid-turn → the result still lands via the poll in <5s,
 *      and NO state label ever contains connection vocabulary.
 *   B. Server reports the turn dead → rejection with the one sanctioned
 *      failure line (serverReported), quickly — no open-ended wait.
 *   C. Healthy stream → instant done payload (the enhancement fast-path).
 *
 * Run: node scripts/regressTurnTransport.cjs   (exit 0 = pass)
 */
const path = require('path');
const { pathToFileURL } = require('url');

const enc = new TextEncoder();
function sseResponse(frames /* [{delayMs, text} | {delayMs, die:true}] */) {
  let i = 0;
  return {
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= frames.length) return { done: true, value: undefined };
          const f = frames[i++];
          await new Promise(ok => setTimeout(ok, f.delayMs ?? 0));
          if (f.die) throw new Error('socket reset (simulated)');
          return { done: false, value: enc.encode(f.text) };
        },
      }),
    },
  };
}
const jsonResponse = (obj) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => obj });

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'agentTurnTransport.js')).href);
  const { agentTurnRequest, TURN_DEAD_MESSAGE } = mod;
  const failures = [];
  const states = [];
  const noConnectionVocab = () => states.every(s => !/connection|reconnect/i.test(String(s)));

  // ── A. stream dies mid-turn; poll delivers ───────────────────────────────
  {
    states.length = 0;
    const t0 = Date.now();
    let lastCalls = 0;
    const F = async (url) => {
      if (String(url).includes('/agent-turn/stream')) {
        return sseResponse([
          { delayMs: 10, text: 'event: state\ndata: {"label":"reading the sheet…"}\n\n' },
          { delayMs: 50, die: true }, // the stream is KILLED mid-turn
        ]);
      }
      lastCalls++;
      // First poll: still running; second: the result landed server-side.
      if (lastCalls < 2) return jsonResponse({ ok: false, running: true });
      return jsonResponse({ ok: true, at: Date.now(), running: false, result: { ok: true, reply: 'landed via poll' } });
    };
    try {
      const r = await agentTurnRequest({ draftId: 'd_test', message: 'x' }, s => states.push(s), null, { fetch: F, pollMs: 300, streamSilenceMs: 800 });
      const ms = Date.now() - t0;
      if (r?.reply !== 'landed via poll') failures.push(`A: wrong result ${JSON.stringify(r)}`);
      if (ms > 5000) failures.push(`A: result took ${ms}ms (>5s)`);
      if (!noConnectionVocab()) failures.push(`A: connection vocabulary in states: ${states.join(' | ')}`);
      console.log(`A. stream killed mid-turn -> result via poll in ${ms}ms, states clean: PASS`);
    } catch (e) { failures.push(`A: rejected: ${e.message}`); }
  }

  // ── B. server says dead → the one sanctioned failure, fast ───────────────
  {
    states.length = 0;
    const t0 = Date.now();
    const F = async (url) => {
      if (String(url).includes('/agent-turn/stream')) {
        return sseResponse([{ delayMs: 30, die: true }]); // stream dies immediately
      }
      return jsonResponse({ ok: false, running: false }); // server truth: nothing running
    };
    try {
      await agentTurnRequest({ draftId: 'd_test2', message: 'x' }, s => states.push(s), null, { fetch: F, pollMs: 200, streamSilenceMs: 600 });
      failures.push('B: resolved but the server reported the turn dead');
    } catch (e) {
      const ms = Date.now() - t0;
      if (e.message !== TURN_DEAD_MESSAGE) failures.push(`B: wrong message: ${e.message}`);
      if (!e.serverReported) failures.push('B: dead-turn error not marked serverReported');
      if (ms > 5000) failures.push(`B: took ${ms}ms to report dead (>5s at 200ms poll)`);
      if (!noConnectionVocab()) failures.push(`B: connection vocabulary in states: ${states.join(' | ')}`);
      console.log(`B. server-dead turn -> one sanctioned failure line in ${ms}ms: PASS`);
    }
  }

  // ── C. healthy stream fast-path ──────────────────────────────────────────
  {
    const F = async (url) => {
      if (String(url).includes('/agent-turn/stream')) {
        return sseResponse([
          { delayMs: 5, text: 'event: state\ndata: {"label":"working"}\n\nevent: done\ndata: {"ok":true,"reply":"via stream"}\n\n' },
        ]);
      }
      return jsonResponse({ ok: false, running: true });
    };
    const r = await agentTurnRequest({ draftId: 'd_test3', message: 'x' }, () => {}, null, { fetch: F, pollMs: 5000 });
    if (r?.reply !== 'via stream') failures.push(`C: wrong result ${JSON.stringify(r)}`);
    else console.log('C. healthy stream -> instant done payload: PASS');
  }

  if (failures.length) {
    console.error('\nFAILURES:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('\nAll transport liveness checks PASS.');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
