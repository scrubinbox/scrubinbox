import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: '/',
  server: {
    // Local dev split: Vite serves the SPA with HMR on :5173, wrangler runs
    // the Worker on :8787. The proxy forwards /api/* to wrangler so the
    // browser sees same-origin requests (no CORS to fight) — the production
    // build is a single Worker that serves both, so this matches prod behavior.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
