/**
 * v2 entry point — mounted by /v2.html.
 *
 * The v2 shell is a ground-up interface rebuild around the SDC Engineer-centered
 * workflow. It shares EVERYTHING below the shell with the classic app:
 * the Zustand store (same localStorage key, same server API), the React
 * Flow canvas, nodes/edges, and the existing modals. Only the frame
 * (panels / top bar / build menu) is new.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppV2 } from './AppV2.jsx';
import { initAppScale } from './appScale.js';
import '../index.css';
import './v2.css';

// Restore the persisted UI scale BEFORE first paint — no 100% flash.
initAppScale();

// Dev-only handle for the layout-acceptance harness (same as classic entry).
if (import.meta.env.DEV) {
  import('../store/useDiagramStore.js').then(m => { window.__sdcStore = m.useDiagramStore; });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppV2 />
  </React.StrictMode>
);
