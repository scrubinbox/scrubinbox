import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  // @cloudflare/vite-plugin reads wrangler.toml and runs the Worker inside
  // Vite's dev server using workerd. /api/* requests hit our Hono handlers in
  // worker/index.ts; everything else falls through to Vite's SPA pipeline
  // (with HMR). One process, one port, real bindings — matches prod exactly.
  plugins: [svelte(), cloudflare()],
  base: '/',
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
