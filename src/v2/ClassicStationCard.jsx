/**
 * ClassicStationCard — the ONLY thing v2 shows for a v1 canvas station
 * (hand-drawn nodes/edges, no describe-first sheet): a read-only card that
 * says what it is and points at the frozen classic shell. The classic
 * canvas itself is NEVER mounted in v2 (one door — openStation.js).
 */

import { useDiagramStore } from '../store/useDiagramStore.js';
import { openFreshStationDraft } from './openStation.js';

export function ClassicStationCard({ sm }) {
  const currentFilename = useDiagramStore(s => s.currentFilename);
  if (!sm) return null;
  const nodes = sm.nodes?.length ?? 0;
  const edges = sm.edges?.length ?? 0;
  const devices = sm.devices?.length ?? 0;
  const classicHref = `/classic.html${currentFilename ? `?project=${encodeURIComponent(currentFilename)}` : ''}`;
  return (
    <div data-testid="classic-station-card" style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '36px 28px' }}>
      <div style={{
        maxWidth: 640, margin: '0 auto', background: '#fff', border: '1px solid var(--color-border)',
        borderLeft: '4px solid #8896a8', borderRadius: 8, padding: '16px 20px 18px',
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#5a6a7e' }}>
          Classic station
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--color-text)', margin: '4px 0 6px' }}>
          S{String(sm.stationNumber ?? 0).padStart(2, '0')} — {sm.displayName ?? sm.name}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          This station was drawn by hand in the classic canvas ({nodes} state{nodes === 1 ? '' : 's'},
          {' '}{edges} transition{edges === 1 ? '' : 's'}, {devices} device{devices === 1 ? '' : 's'}). It has no station
          sheet, so there is nothing to walk here — the v2 app is read-only for it.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <a
            href={classicHref}
            target="_blank"
            rel="noreferrer"
            data-testid="classic-station-open-link"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
              background: 'var(--color-primary)', color: '#fff', borderRadius: 6,
              padding: '7px 16px', fontSize: 12.5, fontWeight: 700,
            }}
          >Open in classic.html ↗</a>
          <button
            type="button"
            data-testid="classic-station-describe-btn"
            onClick={openFreshStationDraft}
            title="Describe this station to SDC Engineer — the cascade walk builds the real thing"
            style={{
              background: '#fff', color: 'var(--color-primary)', border: '1px solid var(--color-primary)',
              borderRadius: 6, padding: '7px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}
          >Describe it as a new station →</button>
        </div>
      </div>
    </div>
  );
}
