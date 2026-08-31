import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  // Three HTML entries, all shipped in the production build:
  //   index.html   → v2 shell (src/v2/) — THE DEFAULT / LIVE APP
  //   v2.html      → alias for the v2 shell (legacy links/bookmarks)
  //   classic.html → FROZEN v1 classic shell (src/main.jsx) — do not modify
  build: {
    rollupOptions: {
      input: {
        index:   resolve(__dirname, 'index.html'),
        v2:      resolve(__dirname, 'v2.html'),
        classic: resolve(__dirname, 'classic.html'),
      },
    },
  },
  server: {
    port: 3131,
    watch: {
      // Runtime-written knowledge/data files live under src/lib/agentGenerator
      // (meKnowledge.md, generationRules.md). The pipeline appends to them
      // DURING generations — without this ignore, every lesson Jarvis learns
      // hot-reloads the user's live page and eats in-progress drafts.
      ignored: ['**/src/lib/agentGenerator/*.md'],
    },
    // v2 is now the default entry at `/` (index.html). The frozen classic
    // v1 shell stays reachable at /classic.html; /v2.html remains an alias.
    open: '/',
    proxy: {
      // Project API server — START_APP.bat launches it on port 3000
      '/api': 'http://localhost:3000',
    },
  },
  // Explicitly pre-bundle React to avoid Node 24 resolution issues
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'],
  },
});
