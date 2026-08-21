/**
 * CompiledControlsView — the "Full Controls" review screen (v2.1.3 —
 * the TEN-SECOND screen).
 *
 * Dan rejected every long-form rendering of the compiled sequence (per-state
 * text wall, detailed diagram, CE briefs, and the decisions/flags exception
 * list — "it would take me longer to read than to write it myself").
 * What remains fits one glance:
 *   1. Meta strip (compiledAt / cost / compiler version / counts) + the big
 *      green APPROVE toggle + ↻ Re-compile + the LIVE pretranslation status
 *      strip (building… / ✓ ready + Generate / stale / failed + Retry)
 *   2. The summary paragraph (Jarvis's 3-5 sentence narrative) — nothing more
 *   3. VALUE BLANKS: the "*Verify" flags that need a real number become
 *      literal fill-in inputs, one short label each (full flag text in the
 *      tooltip), mic on every blank; filling one feeds a re-compile
 *   4. Handshakes collapsed to ONE line — expandable, collapsed by default
 *
 * Everything else (decision prose, mapping notes, per-state detail, open
 * questions) lives in the build record / Jarvis queue / generated-file
 * comments — NOT on this screen. The screen's job: read 5 sentences, fill
 * any blanks you know, click Approve / Generate. Ten seconds.
 *
 * No compiled sequence → the honest banner plus an inline "Compile
 * sequence" button. Endpoints are consumed defensively; the pretranslation
 * status endpoint is feature-detected.
 */

import { useEffect, useMemo, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { DictatedTextarea } from '../components/jarvis/DictatedTextarea.jsx';
import { useV2Shell } from './useV2Shell.js';
import {
  canCompile,
  compileBlockReason,
  fetchCompiledIr,
  fetchPretranslated,
  isPretranslatedReady,
  mirrorApproved,
} from './compiledSequence.js';

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Approve toggle ──────────────────────────────────────────────────────────
function ApproveControl({ filename, smId, approved, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function setApproved(next) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/jarvis/compile/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, smId, approved: next }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `Approve failed (${r.status})`);
      // Mirror the server's write into the in-memory store so the 2s
      // auto-save can't clobber it.
      mirrorApproved(smId, d?.approved === true);
      onChanged(d?.approved === true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="v2-cc__approve" data-testid="cc-approve">
      {approved ? (
        <div className="v2-cc__approved-box">
          <span className="v2-cc__approved-text" data-testid="cc-approved-text">
            ✓ Approved — Generate now runs as a fast translation of this sequence
          </span>
          <button
            className="v2-cc__revoke"
            data-testid="cc-revoke-btn"
            disabled={busy}
            onClick={() => setApproved(false)}
          >{busy ? '…' : 'Revoke'}</button>
        </div>
      ) : (
        <button
          className="v2-cc__approve-btn"
          data-testid="cc-approve-btn"
          disabled={busy}
          onClick={() => setApproved(true)}
        >
          {busy ? 'Saving…' : 'Approve — I agree with this sequence'}
        </button>
      )}
      {err && <div className="v2-cc__err">{err}</div>}
    </div>
  );
}

// ── Pretranslation status strip — nothing waits silently ───────────────────
// After Approve, the code pre-builds in the background; this strip always
// says what's happening: building (pulse + elapsed), ready (Generate right
// there), stale, failed (+Retry), or invalidated after Revoke.
function PretransStrip({ approved, revokedAt, approvedAt, pretrans: p, onRetry, retryBusy }) {
  const openGenerate = useV2Shell((s) => s.openGenerate);
  const [, forceTick] = useState(0);

  const ready = !!p && isPretranslatedReady(p);
  const validationFailed = !!p && p.ready === true && p.validation && p.validation.ok === false;
  const failed = !!p && !p.inFlight && (p.error != null || validationFailed);
  // "Building": the server says so, or we just approved and the sidecar
  // hasn't appeared yet (grace window so the strip never sits silent).
  const building = approved && !ready && !failed && (
    p?.inFlight === true ||
    (approvedAt != null && !p?.ready && Date.now() - approvedAt < 8 * 60_000)
  );

  // 1s tick for the elapsed counter while building.
  useEffect(() => {
    if (!building) return undefined;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [building]);

  if (!approved) {
    if (!revokedAt) return null;
    return (
      <div className="v2-cc__pretrans v2-cc__pretrans--muted" data-testid="cc-pretrans-revoked">
        Pre-built code invalidated — approve again to rebuild it.
      </div>
    );
  }
  if (ready) {
    return (
      <div className="v2-cc__pretrans v2-cc__pretrans--ready" data-testid="cc-instant-note">
        <span>✓ Code is built — Generate is instant</span>
        <button
          className="v2-cc__pretrans-btn"
          data-testid="cc-pretrans-generate-btn"
          onClick={openGenerate}
        >Generate</button>
      </div>
    );
  }
  if (building) {
    const secs = approvedAt != null ? Math.max(0, Math.floor((Date.now() - approvedAt) / 1000)) : null;
    const elapsed = secs != null ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : null;
    return (
      <div className="v2-cc__pretrans v2-cc__pretrans--building" data-testid="cc-pretrans-building">
        <span className="v2-cc__pretrans-pulse" aria-hidden="true" />
        <span>
          ⚙ Jarvis is building the code in the background — ready in ~4 min
          {elapsed ? ` · ${elapsed} elapsed` : ''}
        </span>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="v2-cc__pretrans v2-cc__pretrans--failed" data-testid="cc-pretrans-failed">
        <span>
          Background build {validationFailed ? 'failed validation' : 'failed'}
          {p.error ? `: ${String(p.error)}` : ''} — Generate still works (full translation).
        </span>
        <button
          className="v2-cc__pretrans-btn"
          data-testid="cc-pretrans-retry-btn"
          disabled={retryBusy}
          onClick={onRetry}
        >{retryBusy ? 'Retrying…' : 'Retry'}</button>
      </div>
    );
  }
  if (p && p.ready) {
    return (
      <div className="v2-cc__pretrans v2-cc__pretrans--muted" data-testid="cc-pretrans-stale">
        Sequence changed since the last build — Generate will re-translate (~2 min).
      </div>
    );
  }
  if (p) {
    return (
      <div className="v2-cc__pretrans v2-cc__pretrans--muted" data-testid="cc-pretrans-none">
        No pre-built code yet — Generate will translate (~2 min).
      </div>
    );
  }
  return null;
}

// ── Value blanks — the *Verify flags as literal fill-in inputs ──────────────
// A "*Verify …" (or "*Replace …") flag is Jarvis saying "I defaulted this,
// give me the real value." Instead of prose, each becomes one line:
//   {short label}: [___] {unit} (default N)      — full flag text in tooltip.

const BLANK_MAX = 5;

/** Derive { label, unit, defaultVal, full } from one *-flag's prose. */
function parseBlankFlag(text) {
  const full = String(text).trim();
  // Strip the "*Verify (…): " / "*Replace: " prefix.
  let rest = full.replace(/^\*\s*\w+\s*(\([^)]*\))?\s*:?\s*/i, '');
  // Label = first clause, cut at sentence end or " — ", capped.
  let label = rest.split(/(?<=[a-z0-9)])\.\s|—|\. /)[0].trim();
  if (label.length > 90) label = label.slice(0, 87).trimEnd() + '…';
  if (label) label = label[0].toUpperCase() + label.slice(1);
  const def = /defaulted to\s+(\d+(?:\.\d+)?)\s*(mm|ms|s|deg|°|%)?/i.exec(full);
  const unitMatch = def?.[2] ?? (/(\d+(?:\.\d+)?)\s*(mm|ms|deg|°)\b/.exec(full)?.[2] ?? '');
  return {
    full,
    label: label || full.slice(0, 90),
    unit: unitMatch || '',
    defaultVal: def ? def[1] : null,
  };
}

function ValueBlanks({ flags, smId }) {
  const openCompile = useV2Shell((s) => s.openCompile);
  const [vals, setVals] = useState({});

  const blanks = useMemo(
    () => (flags ?? []).map(String).filter((f) => f.trimStart().startsWith('*')).map(parseBlankFlag),
    [flags]
  );
  if (blanks.length === 0) return null;

  const shown = blanks.slice(0, BLANK_MAX);
  const extra = blanks.length - shown.length;
  const filled = shown.map((b, i) => ({ b, v: (vals[i] ?? '').trim() })).filter((x) => x.v);

  function apply() {
    if (filled.length === 0) return;
    const block =
      'Verified values from the ME — replace the defaults with these:\n' +
      filled.map(({ b, v }) => `- ${b.label}: ${v}${b.unit && !/[a-z]/i.test(v) ? ` ${b.unit}` : ''}\n  (flag: ${b.full})`).join('\n');
    openCompile(smId, block);
    setVals({});
  }

  return (
    <div className="v2-cc__blanks" data-testid="cc-blanks">
      <div className="v2-cc__blanks-head">
        Jarvis needs {blanks.length} real value{blanks.length === 1 ? '' : 's'} — fill what you know
      </div>
      {shown.map((b, i) => (
        <div className="v2-cc__blank" key={i} title={b.full} data-testid={`cc-blank-${i}`}>
          <span className="v2-cc__blank-label">{b.label}</span>
          <DictatedTextarea
            value={vals[i] ?? ''}
            onChange={(v) => setVals((o) => ({ ...o, [i]: v.replace(/\n/g, ' ') }))}
            rows={1}
            placeholder={b.defaultVal != null ? `default ${b.defaultVal}${b.unit ? ` ${b.unit}` : ''}` : b.unit || 'value'}
            micTestId={`cc-blank-mic-${i}`}
            data-testid={`cc-blank-input-${i}`}
            className="v2-cc__blank-input"
          />
          {b.unit && <span className="v2-cc__blank-unit">{b.unit}</span>}
        </div>
      ))}
      {extra > 0 && (
        <div className="v2-cc__blanks-more" data-testid="cc-blanks-more">
          +{extra} more in Jarvis's notes (with the build in the Code grid)
        </div>
      )}
      <div className="v2-cc__blanks-actions">
        <button
          className="v2-cc__compile-btn"
          data-testid="cc-blanks-apply-btn"
          disabled={filled.length === 0}
          title={filled.length === 0 ? 'Fill at least one value first' : 'Re-compile the sequence with these values applied'}
          onClick={apply}
        >Apply value{filled.length === 1 ? '' : 's'} (re-compile)</button>
      </div>
    </div>
  );
}

// ── Handshakes — ONE line, expandable ───────────────────────────────────────
function HandshakesLine({ handshakes }) {
  const list = handshakes ?? [];
  if (list.length === 0) return null;
  const oneLine = list
    .map((h) => `${h.signal} ${h.direction === 'out' ? '⇒' : '⇐'}`)
    .join(', ');
  return (
    <details className="v2-cc__hsline" data-testid="cc-handshakes">
      <summary className="v2-cc__hsline-summary" data-testid="cc-handshakes-line">
        Handshakes: {list.length} ({oneLine})
      </summary>
      <div className="v2-cc__hs-grid">
        {list.map((h, i) => (
          <div className="v2-cc__hs" key={i}>
            <div className="v2-cc__hs-head">
              <span className={`v2-cc__hs-dir ${h.direction === 'out' ? 'v2-cc__hs-dir--out' : 'v2-cc__hs-dir--in'}`}>
                {h.direction === 'out' ? '⇒' : '⇐'}
              </span>
              <code className="v2-cc__hs-sig">{h.signal}</code>
              {h.partner && <span className="v2-cc__hs-partner">{h.partner}</span>}
            </div>
            {h.purpose && <div className="v2-cc__hs-purpose">{h.purpose}</div>}
            {(h.setAtState != null || h.clearAtState != null) && (
              <div className="v2-cc__hs-states">
                {h.setAtState != null && <span>set @ {h.setAtState}</span>}
                {h.clearAtState != null && <span>clear @ {h.clearAtState}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────
export function CompiledControlsView({ headerExtra }) {
  const sm = useDiagramStore((s) =>
    (s.project?.stateMachines ?? []).find((m) => m.id === s.activeSmId) ??
    s.project?.stateMachines?.[0] ?? null
  );
  const filename = useDiagramStore((s) => s.currentFilename);
  const compiledBump = useV2Shell((s) => s.compiledBump);
  const openCompile = useV2Shell((s) => s.openCompile);

  const [state, setState] = useState({ status: 'loading' }); // loading | ok | none | error
  const [approved, setApproved] = useState(false);
  const [pretrans, setPretrans] = useState(null);
  const [approvedAt, setApprovedAt] = useState(null); // Date.now() of this session's approve — anchors the elapsed counter
  const [revokedAt, setRevokedAt] = useState(null);
  const [retryBusy, setRetryBusy] = useState(false);

  const smId = sm?.id ?? null;

  useEffect(() => {
    let alive = true;
    if (!filename || !smId) { setState({ status: 'none' }); return; }
    setState({ status: 'loading' });
    fetchCompiledIr(filename, smId).then((res) => {
      if (!alive) return;
      if (res.status === 'ok') {
        setState({ status: 'ok', data: res.data });
        setApproved(res.data.approved === true);
      } else {
        setState(res);
        setApproved(false);
      }
    });
    return () => { alive = false; };
  }, [filename, smId, compiledBump]);

  // Pretranslation status (feature-detected) — POLLED every 5s while approved
  // so the strip tracks the background build live. Stops re-fetching once the
  // build is ready+fresh (nothing left to learn until the next re-compile).
  useEffect(() => {
    let alive = true;
    let latest = null;
    setPretrans(null);
    if (!filename || !smId || !approved) return undefined;
    const poll = () => {
      if (latest && isPretranslatedReady(latest)) return; // terminal — done
      fetchPretranslated(filename, smId).then((p) => {
        if (!alive) return;
        latest = p;
        setPretrans(p);
      });
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [filename, smId, approved, compiledBump]);

  const ir = state.status === 'ok' ? state.data.ir : null;
  const stateCount = ir?.states?.length ?? 0;

  const compilable = canCompile(sm);
  const blockReason = compileBlockReason(sm);

  function onApprovedChanged(next) {
    setApproved(next);
    if (next) { setApprovedAt(Date.now()); setRevokedAt(null); }
    else { setRevokedAt(Date.now()); setApprovedAt(null); setPretrans(null); }
  }

  // Retry a failed background build — re-approving kicks the server's
  // pretranslation off again.
  async function retryPretranslation() {
    setRetryBusy(true);
    try {
      const r = await fetch('/api/jarvis/compile/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, smId, approved: true }),
      });
      if (r.ok) {
        mirrorApproved(smId, true);
        setApprovedAt(Date.now());
        setPretrans(null); // forget the failed record; the poll refreshes it
      }
    } catch { /* strip keeps showing the failure — retry again */ }
    finally { setRetryBusy(false); }
  }

  return (
    <div className="v2-cc" data-testid="cc-view">
      {/* Header — mirrors the canvas SM-title pill row so the view switcher
          stays in the same place in both views. */}
      <div className="v2-cc__topbar">
        <span className="v2-cc__station">
          <span className="v2-cc__station-num">S{String(sm?.stationNumber ?? 0).padStart(2, '0')}</span>
          <b>{sm?.displayName ?? sm?.name ?? 'No station'}</b>
          <span className="v2-cc__mode">Full Controls — compiled sequence</span>
        </span>
        {headerExtra}
      </div>

      <div className="v2-cc__scroll">
        {state.status === 'loading' && (
          <div className="v2-cc__empty">Loading compiled sequence…</div>
        )}

        {state.status === 'error' && (
          <div className="v2-cc__banner v2-cc__banner--amber" data-testid="cc-error">
            Couldn't load the compiled sequence: {state.error}
          </div>
        )}

        {/* ── No compiled sequence yet — honest banner + inline compile ── */}
        {state.status === 'none' && (
          <div className="v2-cc__emptycard" data-testid="cc-empty">
            <div className="v2-cc__banner v2-cc__banner--amber">
              No compiled sequence yet — this view fills in when Jarvis
              compiles the station.
            </div>
            <p className="v2-cc__empty-sub">
              Compile makes Jarvis think through the full sequence ONCE — every
              state, transition, wait and handshake — so you review and approve
              the logic before any code is generated.
            </p>
            <p className="v2-cc__empty-sub" data-testid="cc-empty-why">
              ~4 min, ~$0.60 — you review and approve the logic before any code
              exists.
            </p>
            <button
              className="v2-cc__compile-btn"
              data-testid="cc-compile-btn"
              disabled={!compilable}
              title={blockReason ?? 'Compile this station'}
              onClick={() => openCompile(smId)}
            >⚙ Compile sequence (Jarvis)</button>
            {!compilable && blockReason && (
              <div className="v2-cc__empty-block">{blockReason}</div>
            )}
          </div>
        )}

        {/* ── Compiled sequence — the ten-second screen ── */}
        {state.status === 'ok' && ir && (
          <>
            {/* 1 — meta + approve + live pretranslation status */}
            <div className="v2-cc__meta" data-testid="cc-meta">
              <div className="v2-cc__meta-facts">
                <span title={state.data.compiledAt ?? ''}>Compiled <b>{fmtWhen(state.data.compiledAt)}</b></span>
                {typeof state.data.cost === 'number' && <span>Cost <b>${state.data.cost.toFixed(2)}</b></span>}
                {state.data.jarvisVersion && <span>Compiler <b>v{state.data.jarvisVersion}</b></span>}
                <span><b>{stateCount}</b> states · <b>{(ir.transitions ?? []).length}</b> transitions</span>
                <button
                  className="v2-cc__recompile"
                  data-testid="cc-recompile-btn"
                  onClick={() => openCompile(smId)}
                  title="Re-compile from the current spec + diagram (clears approval)"
                >↻ Re-compile</button>
              </div>
              <ApproveControl
                filename={filename}
                smId={smId}
                approved={approved}
                onChanged={onApprovedChanged}
              />
              <PretransStrip
                approved={approved}
                approvedAt={approvedAt}
                revokedAt={revokedAt}
                pretrans={pretrans}
                onRetry={retryPretranslation}
                retryBusy={retryBusy}
              />
            </div>

            {/* 2 — the summary paragraph. Nothing more. */}
            {ir.summary && <p className="v2-cc__summary" data-testid="cc-summary">{ir.summary}</p>}

            {/* 3 — value blanks: the *Verify flags as fill-in inputs */}
            <ValueBlanks flags={ir.reviewFlags} smId={smId} />

            {/* 4 — handshakes, one line, expandable */}
            <HandshakesLine handshakes={ir.handshakes} />

            {/* Everything else — decision prose, mappings, per-state detail —
                lives with the build in the Code grid and in the generated
                file's comments, not on this screen. */}
            <div className="v2-cc__rest-note" data-testid="cc-rest-note">
              Jarvis's full notes and the per-state detail travel with the
              build — see the file's entry in the Code grid.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
