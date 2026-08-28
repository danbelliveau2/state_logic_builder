import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3131,
    open: true,
  },
  // Explicitly pre-bundle React to avoid Node 24 resolution issues
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'],
  },
});
