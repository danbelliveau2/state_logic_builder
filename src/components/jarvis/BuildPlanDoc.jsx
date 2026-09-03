/**
 * BuildPlanDoc.jsx — THE BUILD PLAN stage of the station page (Dan, 2026-09-03).
 *
 * The station page is three stages: INPUTS → BUILD PLAN → SEQUENCE → Build.
 * This file renders the middle one as a DOCUMENT — one page per station, one
 * section per machine with the seven codegen items — plus the stage strip
 * and the per-machine "Use first pass | Build your own" choice card the
 * SEQUENCE stage opens with.
 *
 * REDLINES: the tree comes from buildPlan.mjs#redlinePlan(snapshot, current):
 * removed rows/text struck red, added/changed highlighted; "✓ got it" moves
 * the snapshot and clears the marks. Pure render — every action is a prop.
 *
 * Voice: "SDC Engineer" — never "Jarvis" in rendered text (layout gate).
 */
import { Fragment } from 'react';
import './buildPlan.css';

const isRL = (v) => v && typeof v === 'object' && v.__redline === true;
const rowVal = (r) => (r && typeof r === 'object' && '__row' in r ? r.__row : r);
const rowMark = (r) => (r && typeof r === 'object' ? r._mark ?? null : null);
const rowCls = (r, base = '') => { const m = rowMark(r); return `${base}${m ? ` bp-row--${m}` : ''}`.trim(); };
const str = (v) => (v == null ? '' : typeof v === 'object' && !isRL(v) ? JSON.stringify(v) : String(v));

/** Leaf renderer: plain text, or struck-old + highlighted-new. */
export function L({ v, empty = '' }) {
  if (isRL(v)) {
    const b = str(v.before); const a = str(v.after);
    return (
      <>
        {b ? <span className="bp-del">{b}</span> : null}
        {b && a ? ' ' : null}
        {a ? <span className="bp-ins">{a}</span> : null}
      </>
    );
  }
  const s = str(v);
  return s ? <>{s}</> : <span className="bp-src">{empty}</span>;
}

/* ─────────────────────────────── STAGE STRIP ─────────────────────────────── */

/**
 * @param {object} p
 * @param {'inputs'|'plan'|'sequence'|'build'} p.stage  the active stage
 * @param {Array<{key,label,note,state:'done'|'active'|'todo'|'locked'}>} p.stages
 */
export function StageStrip({ stages, stage, onStage }) {
  return (
    <nav className="bp-stages" data-testid="stage-strip" aria-label="Station stages">
      {stages.map((s, i) => (
        <button
          key={s.key}
          type="button"
          className={`bp-stage bp-stage--${s.key === stage ? 'active' : s.state}`}
          data-testid={`stage-${s.key}`}
          data-state={s.key === stage ? 'active' : s.state}
          disabled={s.state === 'locked'}
          title={s.state === 'locked' ? s.lockedReason ?? 'not yet' : s.note}
          onClick={() => onStage(s.key)}
        >
          <span className="bp-stage__n">{s.state === 'done' && s.key !== stage ? '✓' : i + 1}</span>
          <span className="bp-stage__t">
            <span className="bp-stage__label">{s.label}</span>
            <span className="bp-stage__note">{s.state === 'locked' ? (s.lockedReason ?? s.note) : s.note}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

/* ───────────────────────────── SEQUENCE CHOICE ───────────────────────────── */

export function SequenceChoiceCard({ machine, stepCount = 0, onFirstPass, onOwn, busy = false }) {
  return (
    <div className="bp-choice" data-testid={`sequence-choice-${machine.key}`}>
      <div>
        <div className="bp-choice__t">{machine.name} — how do you want to start the sequence?</div>
        <div className="bp-choice__d">
          {machine.design?.owner === 'standard'
            ? `Standard SDC machine — the first pass comes pre-built from shipped ${machine.design.precedent?.label ?? 'work'}.`
            : `The Build Plan carries ${stepCount} state${stepCount === 1 ? '' : 's'} for this machine.`}
        </div>
      </div>
      <div className="bp-choice__btns">
        <button type="button" className="bp-btn bp-btn--primary" disabled={busy || !stepCount} onClick={onFirstPass} data-testid={`sequence-first-pass-${machine.key}`}
          title={stepCount ? 'Compile the plan\'s sequence onto the canvas — you edit from there' : 'The plan has no sequence for this machine yet'}>
          Use first pass
        </button>
        <button type="button" className="bp-btn" disabled={busy} onClick={onOwn} data-testid={`sequence-build-own-${machine.key}`}
          title="Open the canvas with Home Conditions and this machine's devices — you draw the sequence">
          Build your own
        </button>
      </div>
      <div className="bp-choice__hint">Either way the canvas is yours to edit; "Redraft from sheet" stays available on the canvas bar.</div>
    </div>
  );
}

/* ───────────────────────────── THE DOCUMENT ─────────────────────────────── */

function Sec({ title, count, wide = false, children, testId }) {
  return (
    <div className={`bp-sec${wide ? ' bp-sec--wide' : ''}`} data-testid={testId}>
      <div className="bp-sec__h">{title}{count != null ? <small>{count}</small> : null}</div>
      {children}
    </div>
  );
}

function DevicesTable({ rows }) {
  if (!rows?.length) return <div className="bp-src">No devices owned by this machine.</div>;
  return (
    <table className="bp-table">
      <thead><tr><th>Device</th><th>Type</th><th>Purpose</th><th>Sensors / home</th><th>Values</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={rowCls(r)}>
            <td><b><L v={r.name} /></b></td>
            <td><L v={r.type} /></td>
            <td><L v={r.purpose} empty="—" /></td>
            <td><L v={r.sensors} />{str(r.home) || isRL(r.home) ? <> · home <L v={r.home} /></> : null}</td>
            <td><L v={r.values} empty="standard" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatesTable({ rows }) {
  if (!rows?.length) return <div className="bp-src">No sequence yet — the canvas (next stage) is where it gets drawn.</div>;
  return (
    <table className="bp-table" data-testid="plan-states">
      <thead><tr><th>Step</th><th>State</th><th>Detail</th><th>With</th></tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const kind = isRL(r.kind) ? r.kind.after : r.kind;
          return (
            <tr key={i} className={rowCls(r)}>
              <td className="num"><L v={r.step} empty="" /></td>
              <td>{kind ? <span className={`bp-kind bp-kind--${kind}`}>{kind}</span> : null}<L v={r.title} /></td>
              <td><L v={r.detail} empty="" /></td>
              <td><L v={r.counterpart} empty="" /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BranchesTable({ rows }) {
  if (!rows?.length) return <div className="bp-src">No checks — the sequence runs straight through.</div>;
  return (
    <table className="bp-table">
      <thead><tr><th>Step</th><th>Check</th><th>On</th><th>Off</th><th>Retry</th></tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const retry = r.retry;
          return (
            <tr key={i} className={rowCls(r)}>
              <td className="num"><L v={r.atStep} /></td>
              <td><L v={r.check} /></td>
              <td><L v={r.on} empty="continue" /></td>
              <td><L v={r.off} empty={retry ? '' : 'alternate path'} /></td>
              <td>{retry ? <>×<L v={retry.max} /> back to <L v={retry.backTo} />{retry.backToStep ? <> (step <L v={retry.backToStep} />)</> : null} · exhausted → Initialize</> : <span className="bp-src">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HandshakesTable({ rows }) {
  if (!rows?.length) return <div className="bp-src">Standalone — no signals traded with another machine.</div>;
  return (
    <table className="bp-table">
      <thead><tr><th>Step</th><th>Dir</th><th>Tag</th><th>Signal</th><th>Counterpart</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={rowCls(r)}>
            <td className="num"><L v={r.atStep} /></td>
            <td><L v={r.dir} /></td>
            <td className="tag"><L v={r.tag} /></td>
            <td><L v={r.signal} /></td>
            <td><L v={r.counterpart} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cited({ rows, empty }) {
  if (!rows?.length) return <div className="bp-src">{empty}</div>;
  return (
    <ul className="bp-list">
      {rows.map((r, i) => {
        const v = rowVal(r);
        const text = v && typeof v === 'object' ? v.text : v;
        const source = v && typeof v === 'object' ? v.source : null;
        return <li key={i} className={rowCls(r)}><L v={text} />{source ? <> <span className="bp-src">— <L v={source} /></span></> : null}</li>;
      })}
    </ul>
  );
}

function Asks({ rows }) {
  if (!rows?.length) return null;
  return (
    <div>
      {rows.map((a, i) => {
        const val = isRL(a.value) ? a.value.after : a.value;
        return (
          <div key={i} className={`bp-ask ${rowCls(a)}`}>
            <span className="bp-ask__q"><L v={a.ask} /></span>
            <span className={`bp-ask__v${val ? '' : ' bp-ask__v--needed'}`}>{val ? <L v={a.value} /> : 'needed — tell me in the chat'}</span>
            {val ? <span className="bp-ask__src">from <L v={a.source} /></span> : null}
          </div>
        );
      })}
    </div>
  );
}

function MachineSection({ m, onOpenSequence, canvasState }) {
  const owner = isRL(m.design?.owner) ? m.design.owner.after : m.design?.owner;
  const stdLabel = m.design?.precedent?.label;
  const stepsCount = (m.states ?? []).filter((s) => rowMark(s) !== 'remove').length;
  return (
    <section className={`bp-machine ${rowCls(m)}`} data-testid={`plan-machine-${m.key}`} id={`plan-machine-${m.key}`}>
      <div className="bp-machine__head">
        <span className="bp-machine__name"><L v={m.name} /></span>
        <span className="bp-machine__prog"><L v={m.program} /></span>
        <span className={`bp-chip bp-chip--${owner === 'standard' ? 'standard' : 'yours'}`}>{owner === 'standard' ? 'standard SDC machine' : 'your machine'}</span>
        <span style={{ flex: 1 }} />
        {canvasState ? (
          <span className="bp-src" title="This machine's canvas">{canvasState}</span>
        ) : null}
        {onOpenSequence ? <button type="button" className="bp-btn" onClick={() => onOpenSequence(m.key)} data-testid={`plan-open-sequence-${m.key}`}>Sequence →</button> : null}
        <span className="bp-machine__one"><L v={m.oneLiner} /></span>
      </div>
      <div className="bp-machine__body">
        <Sec title="1 · Design owner" wide>
          <div><L v={m.design?.label} /></div>
          {owner === 'standard' ? (
            <>
              <div className="bp-src" style={{ margin: '2px 0 4px' }}>
                Precedent: <L v={stdLabel} />{m.design?.precedent?.file ? <> — <span className="tag" style={{ fontFamily: 'Consolas, monospace' }}><L v={m.design.precedent.file} /></span></> : null}. <L v={m.design?.precedent?.note} />
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#061d39', margin: '4px 0 2px' }}>The only values you supply</div>
              <Asks rows={m.design?.asks} />
            </>
          ) : null}
        </Sec>
        <Sec title="2 · Devices" count={(m.devices ?? []).filter((d) => rowMark(d) !== 'remove').length} wide>
          <DevicesTable rows={m.devices} />
          {(m.signals?.length || m.counters?.length) ? (
            <div className="bp-src" style={{ marginTop: 4 }}>
              {m.signals?.length ? <>Signals (not devices): {m.signals.map((s, i) => <Fragment key={i}>{i ? ', ' : ''}<span className={rowCls(s)}><L v={s.name} /> <span className="tag" style={{ fontFamily: 'Consolas, monospace' }}>(<L v={s.tag} />)</span></span></Fragment>)}. </> : null}
              {m.counters?.length ? <>Counters (codegen artifacts of the retry config): {m.counters.map((c, i) => <Fragment key={i}>{i ? ', ' : ''}<span className={rowCls(c)}><L v={rowVal(c)} /></span></Fragment>)}.</> : null}
            </div>
          ) : null}
        </Sec>
        <Sec title="3 · Sequence as states" count={stepsCount ? `${stepsCount} states · 4, 7, 10 …` : null} wide>
          <StatesTable rows={m.states} />
        </Sec>
        <Sec title="4 · Branches & retries">
          <BranchesTable rows={m.branches} />
        </Sec>
        <Sec title="5 · Handshakes">
          <HandshakesTable rows={m.handshakes} />
        </Sec>
        <Sec title="6 · Initialization">
          <div className="bp-src" style={{ marginBottom: 3 }}><L v={m.initialization?.template} /></div>
          <pre className="bp-init">{(m.initialization?.lines ?? []).map((l, i) => <div key={i} className={rowCls(l)}><L v={rowVal(l)} /></div>)}</pre>
        </Sec>
        <Sec title="7 · Standards applied">
          <Cited rows={m.standards} empty="—" />
        </Sec>
        <Sec title="Decisions">
          <Cited rows={m.decisions} empty="No judgment calls beyond the standards." />
        </Sec>
        <Sec title="Open questions">
          {(m.openQuestions ?? []).length ? (
            <ul className="bp-list">{m.openQuestions.map((qq, i) => <li key={i} className={rowCls(qq)}><L v={rowVal(qq)} /></li>)}</ul>
          ) : <div className="bp-src">None — nothing is waiting on you for this machine.</div>}
        </Sec>
      </div>
    </section>
  );
}

/**
 * @param {object} p
 * @param {object} p.tree      redlinePlan(...).tree (or the plain plan when no snapshot)
 * @param {number} p.count     redline count
 * @param {'draft'|'approved'} p.status
 */
export function BuildPlanDoc({
  tree, count = 0, status = 'draft', approvedAt = null, approvedBy = null, generatedAt = null,
  onGotIt, onApprove, onReopen, onOpenSequence, onRegenerate, onExportJson, busy = false, canvasStates = {},
}) {
  if (!tree) return null;
  const st = tree.station ?? {};
  const machines = tree.machines ?? [];
  const approved = status === 'approved';
  return (
    <article className="bp-doc" data-testid="build-plan-doc">
      <header className="bp-doc__head">
        <div>
          <div className="bp-doc__title">Build Plan — <L v={st.name} /></div>
          <div className="bp-doc__sub">
            Station <L v={st.number} /> · <L v={st.machineCount} /> machine{(isRL(st.machineCount) ? st.machineCount.after : st.machineCount) === 1 ? '' : 's'}
            {(isRL(st.standardCount) ? st.standardCount.after : st.standardCount) ? <> · <L v={st.standardCount} /> standard SDC machine{(isRL(st.standardCount) ? st.standardCount.after : st.standardCount) === 1 ? '' : 's'} built from shipped work</> : null}
            {generatedAt ? <> · drafted {String(generatedAt).slice(0, 16).replace('T', ' ')}</> : null}
          </div>
        </div>
        <div className="bp-doc__actions">
          <span className={`bp-chip bp-chip--${approved ? 'approved' : 'draft'}`} data-testid="plan-status-chip">
            {approved ? `approved${approvedBy ? ' · ' + approvedBy : ''}${approvedAt ? ' · ' + String(approvedAt).slice(0, 10) : ''}` : 'draft — edit it in the chat'}
          </span>
          {onExportJson ? <button type="button" className="bp-btn bp-btn--ghost" onClick={onExportJson} data-testid="plan-export-json">Plan JSON</button> : null}
          {onRegenerate ? <button type="button" className="bp-btn" onClick={onRegenerate} disabled={busy} data-testid="plan-regenerate" title="Re-propose the machine split and sequences from the explanation — your pinned names and values stay">Re-propose</button> : null}
          {approved
            ? <button type="button" className="bp-btn" onClick={onReopen} disabled={busy} data-testid="plan-reopen">Reopen plan</button>
            : <button type="button" className="bp-btn bp-btn--primary" onClick={onApprove} disabled={busy || count > 0} data-testid="plan-approve" title={count > 0 ? 'Clear the redlines first (✓ got it) — then approve' : 'Approve the plan and move to the SEQUENCE stage'}>Approve plan → Sequence</button>}
        </div>
      </header>

      {count > 0 ? (
        <div className="bp-redline-bar" data-testid="plan-redlines">
          <span>{count} change{count === 1 ? '' : 's'} on the plan — <span className="bp-del" style={{ color: '#ffb4b4' }}>removed</span> struck, <span className="bp-ins" style={{ color: '#061d39' }}>added</span> highlighted.</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="bp-btn bp-btn--gotit" onClick={onGotIt} data-testid="plan-gotit">✓ got it</button>
        </div>
      ) : null}

      {str(st.purpose) || isRL(st.purpose) ? <p className="bp-purpose"><b>Purpose: </b><L v={st.purpose} /></p> : null}

      <div className="bp-station-grid">
        <Sec title="Machine split" count={machines.length}>
          <ul className="bp-list">
            {machines.map((m, i) => (
              <li key={i} className={rowCls(m)}>
                <a href={`#plan-machine-${m.key}`} style={{ color: '#1574c4', fontWeight: 700, textDecoration: 'none' }}><L v={m.name} /></a>
                {' '}<span className="bp-machine__prog"><L v={m.program} /></span>
                {' '}<span className={`bp-chip bp-chip--${(isRL(m.design?.owner) ? m.design.owner.after : m.design?.owner) === 'standard' ? 'standard' : 'yours'}`}>{(isRL(m.design?.owner) ? m.design.owner.after : m.design?.owner) === 'standard' ? 'standard' : 'yours'}</span>
                {str(m.oneLiner) ? <div className="bp-src"><L v={m.oneLiner} /></div> : null}
              </li>
            ))}
          </ul>
          {str(st.splitReasoning) || isRL(st.splitReasoning) ? <div className="bp-src" style={{ marginTop: 4 }}><L v={st.splitReasoning} /></div> : null}
        </Sec>
        <Sec title="Cross-machine signals" count={(tree.signals ?? []).length}>
          {(tree.signals ?? []).length ? (
            <table className="bp-table">
              <thead><tr><th>Tag</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                {tree.signals.map((s, i) => (
                  <tr key={i} className={rowCls(s)}><td className="tag"><L v={s.tag} /></td><td><L v={s.from} /></td><td><L v={s.to} /></td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="bp-src">No signals traded between machines.</div>}
          {(tree.interactions ?? []).length ? (
            <ul className="bp-list" style={{ marginTop: 6 }}>{tree.interactions.map((x, i) => <li key={i} className={rowCls(x)}><b><L v={x.station} /></b>: <L v={x.how} /></li>)}</ul>
          ) : null}
        </Sec>
        <Sec title="Failure handling (your words)" count={(tree.failure ?? []).length}>
          {(tree.failure ?? []).length ? (
            <ul className="bp-list">
              {tree.failure.map((f, i) => (
                <li key={i} className={rowCls(f)}>
                  <b><L v={f.when} /></b> → <L v={f.then} />
                  {(isRL(f.retries) ? f.retries.after : f.retries) ? <> (retries ×<L v={f.retries} />)</> : null}
                  {str(f.whenExhausted) || isRL(f.whenExhausted) ? <div className="bp-src">exhausted: <L v={f.whenExhausted} /></div> : null}
                </li>
              ))}
            </ul>
          ) : <div className="bp-src">—</div>}
        </Sec>
        {(tree.unclaimedDevices ?? []).length || (tree.openQuestions ?? []).length || (tree.controlsNotes ?? []).length ? (
          <Sec title="Station notes">
            {(tree.openQuestions ?? []).length ? <ul className="bp-list">{tree.openQuestions.map((qq, i) => <li key={i} className={rowCls(qq)}><span className="bp-chip bp-chip--red">open</span> <L v={rowVal(qq)} /></li>)}</ul> : null}
            {(tree.unclaimedDevices ?? []).length ? <div className="bp-src">Devices no machine owns: {tree.unclaimedDevices.map((d, i) => <Fragment key={i}>{i ? ', ' : ''}<span className={rowCls(d)}><L v={d.name} /></span></Fragment>)}</div> : null}
            {(tree.controlsNotes ?? []).length ? <ul className="bp-list">{tree.controlsNotes.map((n, i) => <li key={i} className={rowCls(n)}><L v={rowVal(n)} /></li>)}</ul> : null}
          </Sec>
        ) : null}
      </div>

      {machines.map((m) => <MachineSection key={m.key} m={m} onOpenSequence={approved ? onOpenSequence : null} canvasState={canvasStates[m.key] ?? null} />)}
    </article>
  );
}
