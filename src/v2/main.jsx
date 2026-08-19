/**
 * v2 entry point — mounted by /v2.html.
 *
 * The v2 shell is a ground-up interface rebuild around the Jarvis-centered
 * workflow. It shares EVERYTHING below the shell with the classic app:
 * the Zustand store (same localStorage key, same server API), the React
 * Flow canvas, nodes/edges, and the existing modals. Only the frame
 * (panels / top bar / build menu) is new.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppV2 } from './AppV2.jsx';
import '../index.css';
import './v2.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppV2 />
  </React.StrictMode>
);
