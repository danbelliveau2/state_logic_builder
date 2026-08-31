import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.jsx';
import { useDiagramStore } from './store/useDiagramStore.js';
import './index.css';

// Dev-only handle for the layout-acceptance harness (scripts/layoutAcceptance).
// Lets a driver load a project, run the column re-layout and read back real
// measured node geometry without any UI clicking. Stripped from prod builds.
if (import.meta.env.DEV) {
  window.__sdcStore = useDiagramStore;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
