/**
 * ContextPanelV2 — v2 right panel.
 *
 * Top card: the selected station's machineSpec summary (purpose, outcome
 * rule count, relationships) + "Edit spec" opening SpecEditorModal (reused
 * as-is — it reads the active SM from the store).
 *
 * Below: the classic PropertiesPanel, imported unchanged. It is fully
 * standalone (store-driven, context-sensitive to selection), so v2 gets
 * node/edge/SM properties for free.
 */

import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { PropertiesPanel } from '../components/PropertiesPanel.jsx';
import { SpecEditorModal } from '../components/modals/SpecEditorModal.jsx';

function SpecSummaryCard() {
  const store = useDiagramStore();
  const sm = store.getActiveSm();
  const [specOpen, setSpecOpen] = useState(false);

  if (!sm) return null;
  const spec = sm.machineSpec ?? null;
  const rules = spec?.outcomeRules ?? [];
  const rels = spec?.relationships ?? [];

  return (
    <div className="v2-spec">
      <div className="v2-spec__head">
        <span className="v2-spec__title">Station Spec</span>
        <button className="v2-spec__edit" onClick={() => setSpecOpen(true)}>
          {spec ? 'Edit spec' : 'Create spec'}
        </button>
      </div>
      {spec ? (
        <>
          {spec.purpose ? (
            <p className="v2-spec__purpose">{spec.purpose}</p>
          ) : (
            <p className="v2-spec__purpose v2-spec__purpose--empty">No purpose written yet.</p>
          )}
          <div className="v2-spec__stats">
            <span title="What-if rules (jam, missed pick, failed inspection…)">
              <b>{rules.length}</b> outcome rule{rules.length !== 1 ? 's' : ''}
            </span>
            <span title="How this station interacts with other stations">
              <b>{rels.length}</b> relationship{rels.length !== 1 ? 's' : ''}
            </span>
          </div>
          {rels.length > 0 && (
            <ul className="v2-spec__rels">
              {rels.slice(0, 4).map((r, i) => (
                <li key={r.id ?? i}>
                  <span className="v2-spec__rel-kind">{r.kind}</span> {r.withSmName || '?'}
                </li>
              ))}
              {rels.length > 4 && <li className="v2-spec__rel-more">+{rels.length - 4} more</li>}
            </ul>
          )}
        </>
      ) : (
        <p className="v2-spec__purpose v2-spec__purpose--empty">
          No spec yet. Explain the station in your own words and Jarvis
          extracts purpose, outcome rules and relationships.
        </p>
      )}
      {specOpen && <SpecEditorModal onClose={() => setSpecOpen(false)} />}
    </div>
  );
}

export function ContextPanelV2({ collapsed, onToggle }) {
  return (
    <aside className={`v2-context${collapsed ? ' v2-context--collapsed' : ''}`}>
      <button
        className="v2-context__toggle"
        onClick={onToggle}
        title={collapsed ? 'Show context panel' : 'Hide context panel'}
      >
        {collapsed ? '◀' : '▶'}
      </button>
      {!collapsed && (
        <div className="v2-context__body">
          <SpecSummaryCard />
          {/* Classic properties panel — context-sensitive to the current
              selection (SM / node / decision / edge). Reused unchanged. */}
          <div className="v2-context__props">
            <PropertiesPanel />
          </div>
        </div>
      )}
    </aside>
  );
}
