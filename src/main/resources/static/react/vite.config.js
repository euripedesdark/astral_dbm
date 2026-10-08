import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build de producao: gera em src/main/resources/static/dist, servido pelo Spring.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8091',
        changeOrigin: true,
      },
    },
  },
});