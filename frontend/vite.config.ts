import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Vite dev server proxies /api (and /media) to the Django backend so
// session cookies + CSRF work exactly as they will in production.
//
// base '/static/': in production Django/WhiteNoise serves the collected
// build at /static/..., so the built index.html must reference
// /static/assets/... — without this, Vite emits /assets/... which Django
// answers with the HTML shell and React never mounts (blank page).
export default defineConfig(({ mode }) => ({
  // base '/static/' only in production: Django/WhiteNoise serves the
  // collected build at /static/... — without it Vite emits /assets/...
  // which Django answers with the HTML shell and React never mounts
  // (blank page). In dev the base must be '/' or BrowserRouter (which has
  // no basename) breaks: the dev server serves at /static/ while routes
  // live at /login, /transactions, ...
  base: mode === 'production' ? '/static/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
}))
