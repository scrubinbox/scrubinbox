import { mount } from 'svelte'
// Fonts imported via JS so Vite's CSS URL rewriter processes the woff2
// references. Tailwind v4's @import in app.css leaves node_modules URLs
// unresolved, which silently 404s in prod. See PR chain on 2026-07-29.
import '@fontsource/instrument-sans/400.css'
import '@fontsource/instrument-sans/500.css'
import '@fontsource/instrument-sans/600.css'
import '@fontsource/instrument-sans/700.css'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app'),
})

export default app
