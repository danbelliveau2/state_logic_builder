# 86-Minute Autopsy — ServoPNP v6 (build b_mt7qbdtl_7i0izo, 2026-08-24)

Dan: "that cannot happen." Target: minutes, not hours. This doc is the honest
breakdown of where the 86 minutes went, what was changed on 2026-08-25, and
what a v6-class station should cost now.

## Where the time went (observed)

| Phase | Time | Notes |
|---|---|---|
| Compile (sequence planning) | 9.5 min | One deep-reasoning pass; not touched this round |
| Pretranslation (generation) | 16.5 min | pm2 log: 15:55:01 → 16:11:31 (990 s). Runs in background at Approve — overlaps ME time when the ME doesn't sit and wait |
| Iterate-and-fix loop | ~56 min | 8 reviewer rounds ≈ 7 min/round (review + fix per round) |
| **Total** | **86 min** | buildScores durationS 5160, $14.17 |

## Why a round cost 7 minutes

Measured on the actual v6 inputs (chars/4 ≈ tokens):

| Review prompt block | ~Tokens |
|---|---|
| Engineering concepts (jarvis-knowledge/concepts) | 25,200 |
| ME knowledge (meKnowledge.md + learned) | 8,400 |
| Template pattern inventory | 1,700 |
| Template routines complete (S05_ServoPNP) | 7,000 |
| **Stable prefix subtotal** | **~42,300** |
| Generated program routines (whole file, EVERY round) | 8,600 |
| Approved-sequence IR + task | ~3,000 |
| **Per-round input** | **~54,000** |

1. **No prompt caching in the reviewer.** client.js cached its generation
   prefix; internalReviewer.js did not — all ~54K tokens were re-prefilled
   at full price and full latency every round.
2. **Every round was a full-file review** at effort HIGH on the full model.
   The model re-read and re-reasoned over 100% of the program to judge a
   3-rung fix — and full re-reads invite NEW findings on unchanged code
   (finding drift), which stretches the round count itself.
3. **Same tier for every round.** The final ship verdict deserves the full
   model; the middle "did the fix land" rounds do not.
4. **Model rounds spent on mechanically-detectable failures.** A fix that
   breaks validateL5X structure costs a full model round to bounce.
5. **A silent JSON parser defect burned output.** L5X rung text contains raw
   backslash paths (`OTL(\Tracking.p_Data…)`); when the model quoted such a
   rung inside its JSON, `\T` is an invalid JSON escape and the parse threw.
   This exact defect killed Jason's v6 correction analysis on 2026-08-25
   (proven by re-run diagnostics: stop_reason=end_turn, clean 4KB response,
   parse failure) and can silently waste generation repair rounds too.

## What changed (implemented 2026-08-25, server-side)

All in `src/lib/agentGenerator/` — server-only modules, no client rebuild.

1. **Prompt caching in internalReviewer.js** — the ~42K-token stable prefix
   (concepts + ME knowledge + inventory + complete template) now carries
   `cache_control` (1h TTL). Rounds 2..N read it at 10% price and near-zero
   prefill latency. Pure win, applies to every review including round 1 of
   the NEXT build of the same station type.
2. **Delta-scoped fix rounds** — `reviewGenerated({ previousL5x,
   priorFindings })` reviews ONLY the changed rungs (mechanical diffL5X)
   plus verification of the prior findings. Full review remains mandatory
   for the first round and the final ship verdict (callers enforce by not
   passing `previousL5x`). Defaults to effort `medium` for delta rounds.
3. **Intermediate model tier** — `reviewGenerated({ model })` +
   `INTERMEDIATE_MODEL` (env `JARVIS_REVIEW_INTERMEDIATE_MODEL`, default
   claude-sonnet-5) for middle delta rounds. Quality gate unchanged: first
   review and final verdict always run the full JARVIS_MODEL on the full
   file at effort high.
4. **Mechanical validators before the model** — `reviewGenerated` now runs
   `validateL5X` first (default on) and returns an instant $0 'fix' verdict
   with the mechanical findings when the file is structurally broken. Free
   rejects never spend a model round.
5. **JSON escape repair** in all three response parsers (correctionLearner,
   internalReviewer, client edit-plan parser): backslashes that don't start
   a valid JSON escape are doubled and the parse retried. Plus a one-retry
   loop and real diagnostics (stop_reason, text head) in the correction
   analyzer, and 32K output headroom.

## Honest projected timing for a v6-class station

Per-round: review side drops from ~5–6 min (full file, full model, high,
uncached) to ~1–2 min (delta, sonnet/medium, cached prefix). The FIX call
between rounds (client.js edit-plan revision) is unchanged this pass:
~2–4 min at effort medium with cached prefix, dominated by output streaming.

| Phase | Was | Projected |
|---|---|---|
| Compile | 9.5 min | 9.5 min (untouched) |
| Pretranslation | 16.5 min | 16.5 min wall, but backgrounded at Approve — effectively 0 when the ME doesn't wait on it |
| Fix loop, 8-round equivalent | 56 min | first full ~6 min + 6 × (fix 3 + delta review 1.5) + final full ~5 min ≈ **~38 min**; with the round count itself falling (free mechanical rejects, no finding drift on unchanged code, no JSON-escape waste), realistic **~25–35 min** |
| **Total (ME waiting on everything)** | **86 min** | **~45–55 min** |
| **Total (Approve-and-walk-away, pretranslation overlapped)** | ~70 min perceived | **~35–45 min** |

That is roughly half, not "minutes." The remaining levers, in impact order:

1. **Round count is the real enemy** — 8 rounds means the writer needed 8
   tries. Every learned lesson (Jason's MCD correction landed 6 concepts
   today) attacks this directly; a 2–3-round loop puts the total near 25 min.
2. **Fix-call latency** — the edit-plan revision could also go
   intermediate-tier for small deltas (same first/final discipline). Not done
   yet: plan quality is the current bottleneck, tier-down deserves a
   benchmark first.
3. **The 25K-token concepts corpus** rides in EVERY prompt (generation,
   review, compile). Caching neutralizes its latency now, but it should be
   split per-device-family so a pneumatic-only station doesn't carry servo
   concepts. Not done — needs curriculum restructure.
4. **Parallelize compile-phase checks / overlap review round 1 with
   validator runs** — marginal (validators are sub-second); listed for
   completeness, deliberately not implemented.

## Verification

- Jason's failed v6 correction analysis re-ran through the fixed path:
  7 lessons, 6 applied to concept docs, 1 queued for the leads, $0.17.
- `POST /api/jarvis/builds/:id/corrected/reanalyze` added — a failed
  analysis is retryable from the stored file, never a dead badge, never a
  re-upload.
- Escape-repair unit-smoked on real `\Tracking.p_Data` payloads (all three
  parsers). Server restarted clean (activeGenerations 0 at restart).
