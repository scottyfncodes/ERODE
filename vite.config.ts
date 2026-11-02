/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
  server: { host: true },
  test: { testTimeout: 120000 },
});
