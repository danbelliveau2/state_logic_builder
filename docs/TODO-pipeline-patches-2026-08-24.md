# TODO — pipeline patches (2026-08-24)

STATUS UPDATE (same session, later): the queue went idle, so **Patch 1
(geometry in compile validation) and Patch 2 (hold discipline) are now APPLIED
to coordinationAuthor.js and client.js** — they take effect on the next server
restart (the running node process keeps the old code until then). Patch 2's
applied form filters non-question items client-side into `held.decisions` +
writing notes rather than a separate server filter.

**Patch 3 (verify-loop wiring on the corrections/summarize path) is still
TODO** — it needs the new `specAuthor.selfCheckCorrection` export plus the
server.js endpoint change below, and a deliberate server restart.

NOTE: the compile geometry gate will (correctly) hard-error on Test_Project_v2
ServoPNP until the Horizontal_Axis "PlaceTransition 450" row is fixed or
removed — that row IS the geometric nonsense the gate exists to catch; it is
flagged red on the sheet and in the blocking strip for Dan to resolve.

Everything referenced already exists and is tested UI-side:
- `src/lib/geometrySanity.js` — geometric sanity checks (pure, ESM)
- `src/lib/agentGenerator/verifyLoop.js` — do→check→redo loop (CJS, has
  `loadGeometrySanity()` to bridge ESM from CJS)

---

## Patch 1 — geometric sanity in compile validation
**File:** `src/lib/agentGenerator/coordinationAuthor.js`
**Where:** `compileSequence()`, immediately after
`const validation = validateCompiledIR(ir);` (line ~830).

```js
  // GEOMETRIC SANITY (Dan, Aug 24: the compile invented "PlaceTransition 450"
  // beyond Place 300): arithmetic-impossible axis values are compile ERRORS,
  // stated as plain sentences — they feed the fix loop like any finding.
  try {
    const { loadGeometrySanity } = require('./verifyLoop');
    const { geometryIssuesOf, axisGeometryIssues } = await loadGeometrySanity();
    // (a) the input SM's axis tables as they stand
    for (const g of geometryIssuesOf(sm)) {
      validation.errors.push(`Geometric error — ${g.axisName}: ${g.message}`);
    }
    // (b) any positions the IR itself introduces (params.positionName +
    //     params.positionValue on ServoMove actions): check them against the
    //     axis's table so an invented point is caught even before it lands.
    const axes = (sm.devices ?? []).filter(d => d.type === 'ServoAxis');
    for (const d of axes) {
      const rows = (d.positions ?? []).map(p => ({ name: p.name, value: p.defaultValue }));
      for (const st of ir.states ?? []) {
        for (const a of st.actions ?? []) {
          if (a.operation !== 'ServoMove') continue;
          if (String(a.deviceName || a.device || '') !== String(d.name)) continue;
          const nm = a.params?.positionName;
          const v = a.params?.positionValue;
          if (nm && Number.isFinite(Number(v)) && !rows.some(r => String(r.name).toLowerCase() === String(nm).toLowerCase())) {
            rows.push({ name: nm, value: Number(v) });
          }
        }
      }
      for (const g of axisGeometryIssues(d.displayName || d.name, rows)) {
        validation.errors.push(`Geometric error — ${g.axisName}: ${g.message}`);
      }
    }
  } catch (e) { validation.warnings.push('Geometry sanity unavailable: ' + e.message); }
```

NOTE: `compileSequence` must be (or already is) async at that point; the `sm`
variable name at line 830's scope should be confirmed (it is the compile's
input state machine). If reviewFlags carry `*Verify` band values, no change —
these checks skip null values by design.

**Also mirror one line in `validator.js`** (`validateAgainstCompiledIR`, line
~1323): no geometry there — it compares L5X to IR; geometry belongs at IR
creation (above). Nothing to change in validator.js unless the leads want a
second gate.

## Patch 2 — hold-for-help discipline (statements are not questions)
**File:** `src/lib/agentGenerator/client.js`
**Where:** `formulateHelpQuestions()` prompt (line ~190), and its result
handling.

(a) Add to the `ask` array after the "no padding" line:

```js
    '',
    'HOLD DISCIPLINE — the self-answer test applies HERE too: for each finding,',
    'first ask yourself "can I derive the answer from the sheet, the geometry,',
    'or SDC standards?" If YES, do NOT file a question — decide it, and return',
    'it under "decisions" (it will be recorded for after-the-fact review).',
    'Hold ONLY what genuinely fails that test.',
    'STATEMENTS ARE NOT QUESTIONS (Dan): every held item MUST be an actual',
    'question a human can answer — interrogative, ending in "?", with your',
    'proposed answer. A finding restated as a sentence is not an ask.',
```

and extend the response contract line to:

```js
    '{"questions":[{"question":"...?","proposedSolution":"<REQUIRED>","addressee":"ME"|"CE","domain":"mechanical"|"controls"|"jarvis"}],"decisions":["<derivable finding you decided and how>"]}',
```

(b) In the result handling: parse `decisions` (array of strings), push each
into the build's writingNotes/reviewFlags as
`Decided during hold-formulation: ${s}`; then filter `questions` through the
same real-question test the UI uses (`stationNeeds.isRealQuestion` logic — a
'?' or an interrogative opener); anything failing the test is demoted to a
decision note rather than a held question. The UI already renders
non-questions as notes and excludes them from the red count
(SpecQuestionsSection.jsx / stationNeeds.js), so this server-side filter is
belt-and-braces.

## Patch 3 — verify-before-return on the corrections/summarize path
**Files:** `server.js` (summarize/corrections SSE endpoint, line ~1455) and/or
`src/lib/agentGenerator/specAuthor.js` (`summarizeDescription`).

Wrap the corrections round (when `body.corrections` is non-empty) in
`runVerifiedAction` from `verifyLoop.js`:

```js
const { runVerifiedAction, checkDeviceTwins, checkSheetGeometry, checkTruncation, checkRequestLanded } = require('./src/lib/agentGenerator/verifyLoop.js');

const verdict = await runVerifiedAction({
  request: body.corrections,
  produce: (critique) => author.summarizeDescription({
    ...argsAsToday,
    corrections: critique
      ? body.corrections + '\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED BY REVIEW:\n' + critique
      : body.corrections,
  }),
  mechanicalChecks: async (result) => [
    ...checkDeviceTwins(result?.summary?.devices),
    ...(await checkSheetGeometry(result?.summary?.devices)),
    ...checkTruncation([
      ...(result?.summary?.sequence ?? []),
      ...((result?.questions ?? []).map(q => q.question)),
    ]),
    // the receipt's own computed diff (client already computes it — compute
    // server-side the same way, or accept it from the caller):
    ...checkRequestLanded(body.corrections, computedDiffEntries),
  ],
  selfCheck: async ({ request, result, findings }) => {
    // ONE cheap model call (same client, haiku-class): request + result diff →
    // {"ok":true} or {"ok":false,"critique":"..."}
    return author.selfCheckCorrection ? author.selfCheckCorrection({ request, result, findings }) : { ok: findings.length === 0 };
  },
  isNonTrivial: (result) => (computedDiffEntries?.length ?? 0) > 3,
});
if (verdict.gaveUp) {
  send('done', { ok: true, verified: false,
    honestFailure: `I couldn't get this right — here's what I tried:\n${verdict.tried.join('\n---\n')}`,
    // Do NOT land the wrong sheet: return the PRIOR summary unchanged.
    ...priorResultShape });
} else {
  persistLearnedFacts(verdict.result);
  send('done', { ok: true, verified: true, attempts: verdict.attempts, ...verdict.result });
}
```

`specAuthor.selfCheckCorrection` is a new ~30-line export: one message, cheap
model, JSON verdict. The client (CreateStationPage corrections chat) shows
`honestFailure` as Jarvis's reply text when present.

**Standing pattern:** every FUTURE in-app AI endpoint wires through
`runVerifiedAction` — mechanical checks always, model self-check only when
flagged/non-trivial, max 1 retry, honest failure over wrong data.
(meKnowledge.md line added this session; verifyLoop.js header documents it.)
