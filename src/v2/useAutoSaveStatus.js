/**
 * useAutoSaveStatus — surfaces the store's debounced server auto-save as a
 * simple status string for the v2 top bar.
 *
 * The store's auto-save (useDiagramStore.subscribe at the bottom of
 * useDiagramStore.js) is fire-and-forget with a 2s debounce and exposes no
 * state, so we mirror its timing here rather than modify the store:
 * any project change -> 'pending', then after the debounce window has
 * comfortably elapsed -> 'saved'. When the API server is unreachable the
 * store persists to localStorage only, so we report 'local'.
 */

import { useEffect, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';

export function useAutoSaveStatus() {
  const serverAvailable = useDiagramStore(s => s.serverAvailable);
  const [status, setStatus] = useState('idle'); // idle | pending | saved

  useEffect(() => {
    let timer = null;
    const unsub = useDiagramStore.subscribe(
      (state) => state.project,
      () => {
        setStatus('pending');
        if (timer) clearTimeout(timer);
        // Store debounce is 2000ms; give the network write a little headroom.
        timer = setTimeout(() => setStatus('saved'), 2600);
      }
    );
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);

  if (!serverAvailable) return 'local';
  return status;
}
