/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev:web --api-port=4100` points the dev proxy at an API on another port.
const apiTarget = process.env.VITE_API_PROXY ?? `http://localhost:${process.env.npm_config_api_port ?? 4000}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    // One React for the app and every library (testing-library can pull in a newer react-dom).
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Shared constants are consumed from source (no build step, no symlink needed).
      '@recrm/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: !!process.env.PORT,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
