import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3131,
    open: true,
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
