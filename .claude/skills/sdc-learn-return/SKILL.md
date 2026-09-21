---
name: sdc-learn-return
description: Turn a returned or corrected L5X, a CE note, or a CE session export into rules — diff against the stamped baseline, distill every change into the knowledge file or the playbook, and re-verify the build. Use when the CE sends a file back, posts corrections, or drops a session export in X:\...\SDC Engineer\Sessions.
---

1. **Returned L5X**: split both files (`node "X:\Electrical Dept\SDC Engineer\Scripts\splitL5x.cjs" <file.L5X> <outDir>`, also in the repo at `scripts/experiments/splitL5x.cjs`), diff per program and rung against the `_history` stamp in `Deliveries\<job>\`. Sort each change: standard miss · template miss · machine decision. Each becomes one dated line in `src/lib/agentGenerator/meKnowledge.md`; CE rulings in the CE's words go to the knowledge file's `## Engineer additions` only if the CE asks.
2. **CE note** (Teams, email): every sentence that changes code becomes a numbered ruling in the job's NAMES CONTRACT addendum and a playbook line if it is general. Apply to the code; deliver; add a revision-history row.
3. **Session export**: `node "X:\Electrical Dept\SDC Engineer\Scripts\extractSession.cjs" "<zip>" <outDir>` (repo: `scripts/experiments/extractSession.cjs`); read the engineer's messages in full; his words are rulings, his assistant's inferences are not. Distill to `generated/<job>/plan/<session>-distilled.md`; port any pipeline fixes he made in his clone.
4. Positive confirmations ("much easier to read") are laws too — record them the same day.
5. Report: what changed, what rule it produced, where it now lives.
