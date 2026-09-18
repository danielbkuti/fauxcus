import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000, // matches CORS_ALLOWED_ORIGINS in backend/flexmaster/settings.py
  },
  // Vitest reads this same config file (`vitest run`/`vitest`) — no
  // separate vitest.config.js needed, so it shares the `@` alias and
  // react() plugin above rather than redeclaring them.
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
})
