// Builds the static, browser-only demo (single JS + CSS file) used for the shareable preview page.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  define: { __DEMO__: true, 'process.env.NODE_ENV': '"production"' },
  resolve: { alias: [{ find: './api.js', replacement: path.resolve('client/src/demoApi.js') }] },
  build: {
    outDir: '../dist-demo', emptyOutDir: true,
    lib: { entry: path.resolve('client/src/main.jsx'), formats: ['iife'], name: 'ReadinessDemo', fileName: () => 'demo.js', cssFileName: 'demo' },
  },
});
