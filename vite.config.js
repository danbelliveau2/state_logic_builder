import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3131,
    // Open the v2 shell by default — `open: true` opened the classic `/`,
    // which read as "the app navigated me back to v1" every dev-server
    // start. Classic stays reachable at `/`.
    open: '/v2.html',
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
