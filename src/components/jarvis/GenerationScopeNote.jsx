/**
 * GenerationScopeNote — ONE quiet line under the spec sheet's interactions
 * section (Dan, Aug 23 — after rejecting a checklist UI: "no checkboxes,
 * nothing to configure").
 *
 * The generation scope itself is an internal default (see
 * lib/agentGenerator/generationScope.js — machineSpec.generationScope feeds
 * the compile/generation prompts); this component only tells the ME what that
 * means in plain words. *Replace stub flags are SDC Engineer's own standalone-build
 * decisions — never questions, never red (SpecQuestionsSection excludes
 * them); the raw flags ride in this line's tooltip for the curious.
 */

import { useDiagramStore } from '../../store/useDiagramStore.js';
import { replaceFlagsOf } from '../../v2/stationNeeds.js';

export function GenerationScopeNote({ smId, hasOtherSms }) {
  const sm = useDiagramStore((s) =>
    (s.project?.stateMachines ?? []).find((m) => m.id === smId) ?? null
  );
  if (!sm) return null;
  const stubs = replaceFlagsOf(sm);
  // Quiet line only where it applies: a standalone build, or a compile that
  // actually stubbed partner signals.
  if (hasOtherSms && stubs.length === 0) return null;

  return (
    <div
      data-testid="generation-scope-note"
      title={stubs.length ? stubs.join('\n\n') : undefined}
      style={{
        margin: '2px 0 10px', fontSize: 11, color: 'var(--color-text-light)',
        fontStyle: 'italic', lineHeight: 1.5,
      }}
    >
      Standalone station build — full station file; interactions stubbed until
      this station joins a machine.
      {stubs.length > 0 && ' (Next-cycle signal stubbed — wire to the supervisor then.)'}
    </div>
  );
}
